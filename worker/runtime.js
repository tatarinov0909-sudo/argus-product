(function () {
  'use strict';
  const config = window.ARGUS_WORKER_CONFIG || {};
  const apiBase = String(config.apiBase || '').replace(/\/$/, '');
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const cellPattern = new RegExp('^argus:cell:v1:(' + uuid + '):(' + uuid + ')$', 'i');
  let actor = '', auth = null, hooks = {}, caps = null, ready = Promise.resolve();
  let connected = navigator.onLine, cachedAt = null, syncPromise = null, needsRefresh = false;
  let scanning = false, scanned = null, screenTimer = null, screenOffAt = 0, locallyPaused = false, draftTimer = null;
  const inFlight = new Map();
  const lifecycleInFlight = new Map();
  const rejectedCodes = new Set(['receiving_changed','placement_changed','wrong_cell','wrong_cell_warehouse','work_session_changed','work_event_order','work_event_time','work_event_state','addressing_changed','worker_command_rejected']);
  const canCorrect = row => row.status === 'conflict' && [400,409].includes(row.errorStatus) && rejectedCodes.has(row.errorCode);
  let pendingLifecycle = null, restored = false, nativeActorSince = null;
  let nativeStatePromise = Promise.resolve(), nativeLastState = '', nativePendingPauses = false, nativeFlushSettled = false, nativeCommandRows = [];
  const db = new Promise((resolve, reject) => {
    const req = indexedDB.open('argus-worker-v1', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('values', { keyPath: 'key' });
      req.result.createObjectStore('commands', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('Не удалось открыть память устройства. Записи не отправлены.'));
  });
  // Surface storage failure before a worker can perform a physical step.
  db.catch(() => {});
  function storage(store, mode, fn) {
    return db.then(database => new Promise((resolve, reject) => {
      const tx = database.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = tx.onabort = () => reject(new Error('Не удалось сохранить на устройстве. Освободите память и повторите.'));
    }));
  }
  const value = key => storage('values', 'readonly', s => s.get(key));
  const putValue = (key, data) => storage('values', 'readwrite', s => s.put({ key, data }));
  const commands = async () => (await storage('commands', 'readonly', s => s.getAll()))
    .filter(x => x.actor === actor).sort((a, b) => a.createdAt - b.createdAt);
  const pending = row => !['confirmed', 'resolved'].includes(row.status);
  function matches(list, method, path) {
    return (list || []).some(rule => {
      if (typeof rule === 'string') { const parts = rule.split(' '); rule = { method: parts[0], path: parts[1] }; }
      if (!rule || rule.method !== method || !rule.path) return false;
      const pattern = rule.path.split('/').map(p => p.startsWith(':') ? '[^/]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/');
      return new RegExp('^' + pattern + '$').test(path.split('?')[0]);
    });
  }
  function token() {
    const current = window.ArgusAuth && ArgusAuth.get(['worker']);
    if (!current || !auth || !ArgusAuth.sameUser(current.token, auth.token)) throw Object.assign(new Error('Войдите снова тем же ключом, чтобы отправить сохранённые действия.'), { auth: true });
    return current.token;
  }
  async function transport(path, options, headers) {
    const url = apiBase + path, method = options.method || 'GET';
    if (!config.native) return fetch(url, { method, headers,
      body: options.body ? JSON.stringify(options.body) : undefined, keepalive: Boolean(options.keepalive) });
    // Native HTTP continues when Android suspends WebView networking at screen-off.
    // Keep every FIFO request on the same transport, including the step before a pause.
    const http = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.CapacitorHttp;
    if (!http || typeof http.request !== 'function') throw new Error('Native HTTP unavailable');
    const response = await http.request({ url, method, headers, ...(options.body ? { data: options.body } : {}),
      responseType: 'json', disableRedirects: true, connectTimeout: 10000, readTimeout: 20000 });
    if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) throw new Error('Incomplete native response');
    const responseHeaders = response.headers || {};
    return { status: response.status, ok: response.status >= 200 && response.status < 300,
      headers: { get: name => responseHeaders[Object.keys(responseHeaders).find(key => key.toLowerCase() === name.toLowerCase())] || null },
      json: async () => typeof response.data === 'string' ? JSON.parse(response.data) : response.data };
  }
  async function network(path, options, id, offline) {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() };
    if (id) headers['X-Argus-Operation-Id'] = id;
    if (offline) headers['X-Argus-Offline'] = '1';
    let res;
    const wasDisconnected = !connected;
    try {
      res = await transport(path, options, headers);
    } catch (_) { connected = false; throw Object.assign(new Error('Нет связи с сервером.'), { network: true }); }
    connected = true;
    if(wasDisconnected) setTimeout(() => sync(), 0);
    const renewed = res.headers.get('X-Argus-Token');
    if (renewed && ArgusAuth.sameUser(renewed, auth.token)) { ArgusAuth.renew('worker', auth.token, renewed); auth.token = renewed; }
    let data;
    try { data = await res.json(); }
    catch (_) { throw Object.assign(new Error('Ответ сервера пришёл не полностью. Подтверждение действия ещё не получено.'), { network: true }); }
    if(res.ok && (data === null || typeof data !== 'object')) throw Object.assign(new Error('Сервер не прислал полное подтверждение действия.'), { network: true });
    if (!res.ok) {
      if (res.status === 401) ArgusAuth.clear('worker', auth.token);
      throw Object.assign(new Error(data && data.error || 'Сервер не принял действие.'), { status: res.status, code: data && data.code, auth: res.status === 401 });
    }
    if (/\/start$/.test(path) && data && data.assembly && data.assembly.status === 'active') { locallyPaused = false; nativeFlushSettled = false; }
    if (path === '/api/journal/pause' && options.body && options.body.resumed) { locallyPaused = false; nativeFlushSettled = false; }
    return data;
  }
  function actionName(path) {
    if (path === '/api/journal/pause') return 'Пауза / продолжение';
    if (path === '/api/receiving') return 'Приёмка товара';
    if (/\/place$/.test(path)) return 'Размещение в ячейке';
    if (/\/move/.test(path)) return 'Перемещение товара';
    if (path.startsWith('/api/shipping')) return 'Сборка';
    return 'Складское действие';
  }
  function context() { return hooks.context ? hooks.context() : {}; }
  function prepare(path, original, offline) {
    const body = JSON.parse(JSON.stringify(original || {}));
    const ctx = context();
    if (ctx.workSessionId && (path === '/api/receiving' || /\/receiving\/items\/[^/]+\/place$/.test(path) || path === '/api/journal/pause')) {
      body.workSessionId = body.workSessionId || ctx.workSessionId;
    }
    if (path === '/api/receiving') body.expected = { received: false };
    if (/\/receiving\/items\/[^/]+\/place$/.test(path) && Number.isFinite(ctx.unplacedQty)) body.expected = { unplacedQty: ctx.unplacedQty };
    const proof = id => {
      if (scanned && scanned.cellId === id && scanned.itemId === ctx.itemId) return { cellQr: scanned.text };
      return { cellVerification: 'manual' };
    };
    if (path === '/api/receiving' || /\/receiving\/items\/[^/]+\/place$/.test(path)) {
      body.occurredAt = body.occurredAt || new Date(Date.now() + Number(ctx.skewMs || 0)).toISOString();
      if (Array.isArray(body.placements)) body.placements = body.placements.map(p => Object.assign(p, proof(p.cellBlockId)));
      if (body.cellBlockId) Object.assign(body, proof(body.cellBlockId));
      if (body.defect && body.defect.cellBlockId) Object.assign(body.defect, proof(body.defect.cellBlockId));
      if (offline) {
        const places = body.placements || (body.cellBlockId ? [body] : []);
        if (places.some(p => !p.cellQr) || (body.defect && !body.defect.cellQr)) throw new Error('Без связи размещение подтверждается сканом QR ячейки. Для ручного выбора восстановите связь.');
      }
    }
    if (offline && !body.workSessionId) throw new Error('Сначала начните работу при подключении к серверу. Без связи новый заход не начинается.');
    return body;
  }
  async function enqueue(path, body, offline) {
    const ctx = context();
    const row = { id: crypto.randomUUID(), actor, path, method: 'POST', body, offline,
      fingerprint: JSON.stringify([path, body]), createdAt: Date.now(), status: 'queued', error: '',
      summary: { document: ctx.documentNumber || '', item: ctx.itemName || '', cell: ctx.cellLabel || '',
        qty: body.qty ?? body.acceptedQty ?? body.pickedQty ?? null } };
    const database = await db;
    return new Promise((resolve, reject) => {
      const tx = database.transaction('commands', 'readwrite'), store = tx.objectStore('commands');
      let result, error;
      const all = store.getAll();
      all.onsuccess = () => {
        try {
        const outstanding = all.result.filter(x => x.actor === actor && pending(x));
        if(path === '/api/journal/pause' && body.workSessionId){
          if(body.exit || body.resumed){
            // Logout and a native departure can arrive together. Reuse inside
            // this transaction, not only after the earlier asynchronous read.
            const latest = all.result.filter(x => x.actor === actor && x.path === path && x.body.workSessionId === body.workSessionId &&
              x.status !== 'resolved' && Number(x.body.eventSequence || 0) >= Number(body.eventSequence || 1))
              .sort((a, b) => b.body.eventSequence - a.body.eventSequence)[0];
            const sameExit = body.exit && !body.resumed && latest && !latest.body.resumed;
            const pendingResume = body.resumed && latest && latest.body.resumed && pending(latest);
            if(sameExit || pendingResume){ result = latest; return; }
          }
          const previous = all.result.find(x => x.actor === actor && x.path === path && x.body.workSessionId === body.workSessionId && x.body.eventAt === body.eventAt && Boolean(x.body.resumed) === Boolean(body.resumed));
          if(previous){ result = previous; return; }
          const highest = all.result.filter(x => x.actor === actor && x.path === path && x.body.workSessionId === body.workSessionId && x.status !== 'resolved')
            .reduce((n, x) => Math.max(n, Number(x.body.eventSequence || 0)), Number(body.eventSequence || 1) - 1);
          row.body.eventSequence = highest + 1;
          row.fingerprint = JSON.stringify([path, row.body]);
        }
        const existing = all.result.find(x => x.actor === actor && x.fingerprint === row.fingerprint && (pending(x) || path === '/api/journal/pause'));
        if (existing) { result = existing; return; }
        if (outstanding.length && path !== '/api/journal/pause') {
          error = new Error('Предыдущее действие ещё не подтверждено сервером. Откройте «Сохранённые действия».'); return;
        }
        store.put(row); result = row;
        } catch (_) { tx.abort(); }
      };
      tx.oncomplete = () => error ? reject(error) : resolve(result);
      tx.onabort = tx.onerror = () => reject(new Error('Не удалось сохранить действие на устройстве. Не повторяйте физическую операцию.'));
    });
  }
  async function saveCommand(row) { await storage('commands', 'readwrite', s => s.put(row)); await renderStatus(); }
  async function invalidateCache() {
    const all = await storage('values', 'readonly', s => s.getAll());
    await Promise.all(all.filter(x => x.key.startsWith(actor + '|cache|')).map(x => storage('values', 'readwrite', s => s.delete(x.key))));
  }
  const commandLock = (id, fn) => navigator.locks ? navigator.locks.request('argus-worker|' + actor + '|' + id, fn) : fn();
  function send(row) {
    if(inFlight.has(row.id)) return inFlight.get(row.id);
    const promise = commandLock(row.id, () => transmit(row)).finally(() => inFlight.delete(row.id));
    inFlight.set(row.id, promise);
    return promise;
  }
  async function transmit(row) {
    const latest = await storage('commands', 'readonly', s => s.get(row.id));
    if(!latest || latest.actor !== actor) throw new Error('Сохранённое действие не найдено для этого работника.');
    if(latest.status === 'confirmed') return latest.result;
    if(latest.status === 'resolved' || canCorrect(latest)) throw Object.assign(new Error('Действие отклонено. Сверьте товар и исправьте ввод после обновления данных.'), { persisted: true });
    row = latest;
    try {
      const data = await network(row.path, { method: row.method, body: row.body, keepalive: row.path === '/api/journal/pause' }, row.id, row.offline);
      row.status = 'confirmed'; row.confirmedAt = Date.now(); row.error = ''; row.result = data;
      await saveCommand(row); await invalidateCache();
      if(row.path !== '/api/journal/pause') await putValue(actor + '|draft', null);
      return data;
    } catch (error) {
      row.status = error.auth ? 'auth' : error.network || [408,429].includes(error.status) || error.status >= 500 ? 'queued' : 'conflict';
      row.error = error.message; row.errorCode = error.code || null; row.errorStatus = error.status || null;
      await saveCommand(row);
      error.persisted = true;
      throw error;
    }
  }
  async function request(path, options = {}) {
    await ready;
    const method = options.method || 'GET';
    if (method === 'GET') {
      const key = actor + '|cache|' + path;
      try {
        const data = await network(path, options);
        await putValue(key, { at: Date.now(), result: data });
        await renderStatus(); return data;
      } catch (error) {
        if (!error.network) throw error;
        const cached = await value(key);
        if (!cached) throw new Error('Нет связи. Этот экран ещё не загружен на устройство.');
        cachedAt = cached.data.at; await renderStatus(); return cached.data.result;
      }
    }
    if (needsRefresh && (path !== '/api/journal/pause' || options.body && options.body.resumed)) throw new Error('Действие принято сервером. Нажмите «Обновить данные» перед следующим шагом.');
    if (locallyPaused && path !== '/api/journal/pause' && !/\/start$/.test(path)) throw new Error('Работа на паузе. Дождитесь передачи паузы и нажмите «Продолжить».');
    await saveDraft();
    const offline = !navigator.onLine || !connected;
    const idempotent = matches(caps && caps.offline && caps.offline.idempotentOperations, method, path);
    const permitted = matches(caps && caps.offline && caps.offline.supportedOperations, method, path);
    if (!idempotent) {
      if (offline) throw new Error('Это действие доступно только при связи с сервером. Введённые данные остаются на экране.');
      if ((await commands()).some(pending)) throw new Error('Сначала дождитесь передачи сохранённых действий.');
      return network(path, options);
    }
    if (offline && !permitted) throw new Error('Этот шаг нельзя выполнять без связи. Дождитесь подключения.');
    const body = prepare(path, options.body, offline);
    const row = await enqueue(path, body, offline);
    await renderStatus();
    if(row.status === 'confirmed') return row.result;
    if(row.status === 'resolved') throw new Error('Эта попытка отклонена. Обновите данные и исправьте ввод для нового действия.');
    if (offline || (await commands()).find(pending).id !== row.id) throw queuedError();
    try { return await send(row); }
    catch (error) { if (error.network || error.status >= 500) throw queuedError(); throw error; }
  }
  const queuedError = () => Object.assign(new Error('Сохранено на устройстве. Сервер ещё не подтвердил. Не повторяйте действие; передадим после восстановления связи.'), { queued: true });
  async function sync(options = {}) {
    await ready;
    if (syncPromise) return syncPromise;
    if (!navigator.onLine || !actor) return;
    syncPromise = (async () => {
      while (navigator.onLine) {
        // A departure may append its pause while the previous stock step is in flight.
        const row = (await commands()).find(pending);
        if (!row || canCorrect(row) || row.status === 'conflict' && !options.retryConflicts) break;
        try { await send(row); needsRefresh = true; }
        catch (_) { break; }
      }
    })().finally(async () => { syncPromise = null; await renderStatus(); });
    return syncPromise;
  }
  function publishWorkState(flushFinished = false) {
    if (!config.native || !restored) return Promise.resolve();
    if (flushFinished) nativeFlushSettled = true;
    nativeStatePromise = nativeStatePromise.then(async () => {
      const device = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.WorkerDevice;
      if (!device || typeof device.setWorkActive !== 'function') return;
      const ctx = context();
      const working = Boolean(ctx.workActive && ctx.mine !== false && ctx.workSessionId && ctx.status === 'active');
      const pauseRecorded = durablePauseAfterContext(nativeCommandRows, ctx);
      if (working && !pauseRecorded) nativeFlushSettled = false;
      // A manual offline pause can leave the last server snapshot active. Its
      // durable local pause still ends the bounded native network attempt.
      const active = working && !(nativeFlushSettled && pauseRecorded);
      const state = { active, pendingPause: !nativeFlushSettled && Boolean(ctx.pauseLocal || nativePendingPauses) };
      const signature = JSON.stringify(state);
      if (signature === nativeLastState) return;
      await device.setWorkActive(state); nativeLastState = signature;
    }).catch(() => { /* the next context update retries a failed native flag */ });
    return nativeStatePromise;
  }
  function dom(tag, text, className) { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; }
  async function renderStatus() {
    const box = document.getElementById('workerStatus');
    if (!box || !actor) return;
    const rows = await commands();
    nativeCommandRows = rows;
    nativePendingPauses = rows.some(row => pending(row) && row.path === '/api/journal/pause');
    await publishWorkState();
    const unresolved = rows.filter(pending), conflict = unresolved.some(x => x.status === 'conflict'), loginRequired = unresolved.some(x => x.status === 'auth');
    const text = loginRequired ? 'Нужно войти тем же ключом для передачи сохранённых действий.' : conflict ? 'Нужен разбор: сервер не подтвердил действие.'
      : unresolved.length ? 'На устройстве: ' + unresolved.length + '. Сервер ещё не подтвердил.'
      : needsRefresh ? 'Состояние изменилось. Обновите данные перед следующим шагом.'
      : !connected || !navigator.onLine ? 'Без связи. Доступны ранее загруженные данные.'
      : 'Подключено к серверу';
    box.dataset.state = conflict ? 'conflict' : unresolved.length || !connected ? 'queued' : 'confirmed';
    box.replaceChildren(dom('span', (config.environment === 'stand' ? 'Тестовый стенд · ' : '') + text));
    if (cachedAt) box.append(dom('small', 'Снимок: ' + new Date(cachedAt).toLocaleString('ru-RU') + '. Остатки могли измениться.'));
    const controls = dom('div', '', 'worker-status-actions');
    const queue = dom('button', 'Сохранённые действия'); queue.type = 'button'; queue.onclick = showQueue; controls.append(queue);
    if(loginRequired){ const login = dom('a', 'Войти снова'); login.href = 'login.html'; controls.append(login); }
    const labels = dom('a', 'QR ячеек'); labels.href = 'cell-labels.html';
    labels.onclick = async event => {
      event.preventDefault();
      try { if(hooks.pause) await hooks.pause(Date.now()); location.href = labels.href; }
      catch(error){ if(error.queued || error.persisted) location.href = labels.href; else if(hooks.toast) hooks.toast(error.message); }
    };
    controls.append(labels);
    if (needsRefresh) { const refresh = dom('button', 'Обновить данные'); refresh.onclick = () => location.reload(); controls.append(refresh); }
    box.append(controls);
  }
  async function showQueue() {
    let dialog = document.getElementById('workerQueue');
    if (!dialog) { dialog = dom('dialog'); dialog.id = 'workerQueue'; document.body.append(dialog); }
    const heading = dom('h2', 'Сохранённые действия'); dialog.replaceChildren(heading);
    const rows = (await commands()).slice(-100).reverse();
    if (!rows.length) dialog.append(dom('p', 'Очередь пуста. Все новые действия будут показаны здесь.'));
    for (const row of rows) {
      const item = dom('article', '', 'worker-command');
      item.dataset.state = row.status;
      item.append(dom('strong', actionName(row.path)), dom('p', row.status === 'confirmed' ? 'Принято сервером' : row.status === 'resolved' ? 'Отклонено сервером — работник подтвердил сверку для исправления ввода' : row.status === 'auth' ? 'Ждёт повторного входа тем же ключом' : canCorrect(row) ? 'Действие отклонено сервером без применения' : row.status === 'conflict' ? 'Нужен разбор с руководителем' : 'Сохранено на устройстве — ожидает отправки'));
      if (row.error) item.append(dom('p', row.error));
      if(row.summary){
        const s = row.summary;
        item.append(dom('p', [s.document, s.item, s.qty != null ? s.qty + ' шт.' : '', s.cell ? 'ячейка ' + s.cell : ''].filter(Boolean).join(' · ')));
      }
      item.append(dom('small', new Date(row.createdAt).toLocaleString('ru-RU') + ' · № ' + row.id));
      if(canCorrect(row)){
        const correct = dom('button', 'Сверил товар, исправлю ввод');
        if(!navigator.locks){ correct.disabled = true; item.append(dom('p', 'Для безопасного исправления в нескольких вкладках обновите браузер или Android System WebView. Действие сохранено, повторять перемещение не нужно.')); }
        correct.onclick = async () => {
          if(!window.confirm('Сервер отклонил этот шаг без изменения учёта. Перед исправлением ввода сверьте фактически положенный товар и ячейку; при необходимости обратитесь к руководителю. Вы сверили товар и готовы исправить ввод?')) return;
          correct.disabled = true;
          await commandLock(row.id, async () => {
            const current = await storage('commands', 'readonly', s => s.get(row.id));
            if(current && current.actor === actor && canCorrect(current)){
              current.status = 'resolved'; current.resolvedAt = Date.now(); current.resolution = 'worker_reconciled_before_correcting';
              await saveCommand(current); await invalidateCache(); needsRefresh = true;
            }
          });
          await sync(); await showQueue();
        };
        item.append(correct);
      }
      dialog.append(item);
    }
    dialog.append(dom('p', 'Если нужен разбор, покажите руководителю действие и его номер. Не повторяйте перемещение товара. Запись остаётся на устройстве.'));
    if (rows.some(row => row.status === 'auth')) {
      const login = dom('button', 'Войти снова тем же ключом'); login.type = 'button'; login.onclick = () => { location.href = 'login.html'; }; dialog.append(login);
    }
    const retry = dom('button', 'Проверить связь и отправить'); retry.onclick = async () => { retry.disabled = true; try { await sync({ retryConflicts: true }); await showQueue(); } finally { retry.disabled = false; } };
    const close = dom('button', 'Закрыть'); close.onclick = () => dialog.close(); dialog.append(retry, close);
    if (!dialog.open) dialog.showModal();
  }
  async function loadCapabilities() {
    const key = actor + '|capabilities', cached = await value(key);
    caps = cached && cached.data;
    try { caps = await network('/api/worker/capabilities', {}); await putValue(key, caps); } catch (_) { /* offline uses the last server capability list */ }
  }
  async function bindNativeActor() {
    const boundAt = Date.now(), database = await db;
    nativeActorSince = await new Promise((resolve, reject) => {
      const tx = database.transaction('values', 'readwrite'), store = tx.objectStore('values');
      const req = store.get('native-bound-actor');
      let since;
      req.onsuccess = () => {
        const previous = req.result && req.result.data;
        since = previous && previous.actor === actor && Number.isFinite(previous.at) ? previous.at : boundAt;
        if (!previous || previous.actor !== actor || !Number.isFinite(previous.at)) store.put({ key: 'native-bound-actor', data: { actor, at: since } });
      };
      tx.oncomplete = () => resolve(since);
      tx.onerror = tx.onabort = () => reject(new Error('Не удалось сохранить вход устройства. Пауза будет восстановлена после повторного открытия.'));
    });
  }
  function bind(session, callbacks) {
    auth = session; hooks = callbacks;
    document.body.classList.add('argus-worker-root');
    const p = ArgusAuth.payload(auth.token);
    if (p.role !== 'worker' || !p.staffKeyId || !p.warehouseId) throw new Error('Ключ работника не содержит склада. Войдите заново.');
    actor = [apiBase, p.warehouseId, p.staffKeyId].join('|');
    const status = dom('section'); status.id = 'workerStatus'; status.setAttribute('aria-live', 'polite'); document.body.prepend(status);
    const cellArea = document.getElementById('cellBlock');
    if (cellArea) {
      const scan = dom('button', 'Сканировать QR ячейки', 'worker-scan'); scan.type = 'button'; scan.id = 'workerCellScan';
      scan.onclick = () => { scanning = true; if (hooks.openScanner) hooks.openScanner({ kind: 'cell' }); };
      const input = dom('input'); input.id = 'workerScanInput'; input.placeholder = 'Сканер ТСД: код и Enter'; input.setAttribute('aria-label', 'QR ячейки со сканера ТСД'); input.autocomplete = 'off';
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); scanning = true; handleQr(input.value); input.value = ''; } });
      const note = dom('p', 'Отсканируйте ячейку, положите товар и подтвердите. Если сканер недоступен, выберите ячейку вручную при наличии связи.'); note.id = 'workerCellStatus'; note.setAttribute('aria-live', 'polite');
      cellArea.prepend(note); cellArea.prepend(input); cellArea.prepend(scan);
    }
    document.addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(() => saveDraft().catch(e => { status.textContent = e.message; }), 150); });
    ready = (config.native ? bindNativeActor() : Promise.resolve()).then(loadCapabilities).then(async () => {
      locallyPaused = (await commands()).some(row => pending(row) && row.path === '/api/journal/pause' && !row.body.resumed);
      await renderStatus();
    }).catch(error => { status.textContent = error.message; status.dataset.state = 'conflict'; });
    ready.then(sync);
    if (config.native) setInterval(() => { publishWorkState(); }, 1000);
    if ('serviceWorker' in navigator && !config.native) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  function handleQr(text) {
    const match = cellPattern.exec(String(text || '').trim());
    if (!match && !scanning) return false;
    if (!match) { if (hooks.scanStatus) hooks.scanStatus('Нужен QR ячейки Аргуса. QR листа запускается с главного экрана.'); return true; }
    const ctx = context(), owner = ArgusAuth.payload(auth.token);
    if (match[1].toLowerCase() !== String(owner.warehouseId).toLowerCase()) { hooks.scanStatus('Эта ячейка другого склада.'); return true; }
    if (!ctx.itemId) { hooks.scanStatus('Сначала откройте товар для приёмки или сборки.'); return true; }
    const found = hooks.findCell && hooks.findCell(match[2]);
    if (!found) { hooks.scanStatus('Ячейка не найдена в загруженной карте склада. Обновите данные при наличии связи.'); return true; }
    scanned = { text: String(text).trim(), cellId: found.id, itemId: ctx.itemId };
    try { hooks.selectCell(found); } catch (error) { scanned = null; hooks.scanStatus(error.message); return true; }
    const selectedLabel = document.querySelector('#customCellDisplay .custom-cell-label');
    if(selectedLabel) selectedLabel.textContent = 'QR ячейки подтверждён';
    scanning = false;
    const note = document.getElementById('workerCellStatus');
    if(note) note.textContent = 'QR подтверждён: ' + found.label + '. Положите товар и нажмите подтверждение.';
    saveDraft().catch(error => hooks.toast(error.message));
    if (hooks.closeScanner) hooks.closeScanner();
    if (hooks.toast) hooks.toast('QR ячейки ' + found.label + ' подтверждён');
    return true;
  }
  function resetScan() {
    scanned = null; scanning = false;
    const note = document.getElementById('workerCellStatus');
    if(note) note.textContent = 'Отсканируйте ячейку, положите товар и подтвердите. Ручной выбор доступен при наличии связи.';
  }
  async function saveDraft() {
    if (!actor || !hooks.draft) return;
    const draft = hooks.draft();
    if (draft) await putValue(actor + '|draft', Object.assign(draft, { scanned, at: Date.now() }));
  }
  async function restoreDraft() {
    await ready;
    try {
      const saved = await value(actor + '|draft');
      if(saved && saved.data && hooks.restoreDraft){
        await hooks.restoreDraft(saved.data);
        const ctx = context();
        if(saved.data.scanned && saved.data.scanned.itemId === ctx.itemId && saved.data.workSessionId === ctx.workSessionId) scanned = saved.data.scanned;
      }
      if(pendingLifecycle && !context().workSessionId && hooks.restoreActive) await hooks.restoreActive();
    } catch(error) { if(hooks.toast) hooks.toast('Ввод сохранён. Не удалось открыть задачу: ' + error.message); }
    finally {
      restored = true;
      await publishWorkState();
      if(pendingLifecycle){
        const event = pendingLifecycle; pendingLifecycle = null;
        // Native owns the complete ordered pending list. Its worker-ready replay
        // must run first, so a later buffered departure cannot replace an earlier pause.
        if(!config.native) lifecycle(event);
      }
      window.dispatchEvent(new CustomEvent('argus:worker-ready'));
    }
  }
  function confirmPlacement() {
    if(window.ArgusWorker.hasCellScan()) return true;
    if(!navigator.onLine || !connected){ hooks.toast('Без связи сначала отсканируйте QR ячейки.'); return false; }
    return window.confirm('Ячейка выбрана без сканирования. Проверьте адрес на полке и подтвердите: товар уже положен в выбранную ячейку?');
  }
  async function recordPause(body) {
    const ctx = context();
    if (!ctx.workSessionId) return request('/api/journal/pause', { method: 'POST', body });
    if(!body.resumed) locallyPaused = true;
    const eventAt = body.at || new Date(Date.now() + (ctx.skewMs || 0)).toISOString();
    return request('/api/journal/pause', { method: 'POST', body: Object.assign({}, body, {
      workSessionId: ctx.workSessionId, eventSequence: Number(ctx.eventSequence || 0) + 1, eventAt
    }) });
  }
  function durablePauseAfterContext(rows, ctx) {
    const latest = rows.filter(row => row.path === '/api/journal/pause' && row.body.workSessionId === ctx.workSessionId &&
      row.body.eventSequence > Number(ctx.eventSequence || 0) && (pending(row) || row.status === 'confirmed'))
      .sort((a, b) => b.body.eventSequence - a.body.eventSequence)[0];
    return latest && !latest.body.resumed;
  }
  async function beforeLogout() {
    await ready;
    if (!restored) throw new Error('Подождите: восстанавливаем текущую работу перед выходом.');
    if ((!context().workSessionId || context().mine === false) && hooks.restoreActive) await hooks.restoreActive();
    const ctx = context(), rows = await commands();
    const recordedExit = durablePauseAfterContext(rows, ctx);
    if (ctx.mine !== false && !recordedExit && (ctx.status === 'active' || ctx.pauseLocal)) {
      try { await hooks.pause(Date.now()); }
      catch (error) { if (!error.queued && !error.persisted) throw error; }
      const savedExit = (await commands()).some(row => row.path === '/api/journal/pause' && row.body.exit &&
        row.body.workSessionId === ctx.workSessionId && row.body.eventSequence > Number(ctx.eventSequence || 0));
      if (!savedExit) throw new Error('Пауза ещё не сохранена. Откройте текущую работу и повторите выход.');
    }
    await sync();
    if ((await commands()).some(pending)) {
      await showQueue();
      throw new Error('Выход пока недоступен: есть неподтверждённые действия. Восстановите связь или разберите отклонённый шаг в «Сохранённых действиях». Текущий ключ сохранён.');
    }
  }
  function lifecycle(event) {
    const key = event && (event.id || event.state + ':' + event.at);
    if(lifecycleInFlight.has(key)) return lifecycleInFlight.get(key);
    const result = (async () => {
      const result = await applyLifecycle(event);
      if (config.native && result.ack && event && event.state !== 'active') {
        // Durable ACK permits deleting the native event, but keep Android's short
        // network window until the stock step and its following pause have drained.
        let timeout;
        try { await Promise.race([sync(), new Promise(resolve => { timeout = setTimeout(resolve, 65000); })]); }
        catch (_) { /* the durable outbox remains retryable after a failed attempt */ }
        finally { clearTimeout(timeout); await publishWorkState(true); }
      }
      return result;
    })().finally(() => lifecycleInFlight.delete(key));
    lifecycleInFlight.set(key, result); return result;
  }
  async function applyLifecycle(event) {
    clearTimeout(screenTimer);
    if(!event) return { ack: false };
    if(!restored){
      if(event.state !== 'active') {
        if(!pendingLifecycle || Number(event.at) < Number(pendingLifecycle.at)) pendingLifecycle = { ...event };
      } else if(pendingLifecycle && !pendingLifecycle.resumedAt) pendingLifecycle.resumedAt = Number(event.at) || Date.now();
      return { ack: false };
    }
    const at = Number(event.at) || Date.now();
    if (config.native) {
      if (nativeActorSince === null) return { ack: false };
      // A retained device event belongs to the key active when it departed, not
      // another worker whose pre-existing session is restored after a key change.
      if (event.state !== 'active' && at < nativeActorSince) return { ack: true };
    }
    const pause = async factAt => {
      const ctx = context();
      if(ctx.startedAt && factAt < new Date(ctx.startedAt).getTime() - Number(ctx.skewMs || 0)) return { ack: true };
      if(ctx.status === 'paused' && !ctx.pauseLocal) return { ack: true };
      if(ctx.status && !['active', 'paused'].includes(ctx.status)) return { ack: true };
      if(!ctx.workSessionId){
        return { ack: Boolean(connected && !cachedAt && hooks.noActiveWork && hooks.noActiveWork()) };
      }
      const at = new Date(factAt + Number(ctx.skewMs || 0)).toISOString();
      try {
        const rows = await commands();
        const stored = durablePauseAfterContext(rows, ctx) || rows.some(row => row.path === '/api/journal/pause' && row.body.workSessionId === ctx.workSessionId && row.body.eventAt === at && row.body.exit && row.status !== 'resolved');
        if(stored) return { ack: true };
      } catch (_) { return { ack: false }; }
      try { await hooks.pause(factAt); return { ack: true }; }
      catch(error){ return { ack: Boolean(error.queued || error.persisted) }; }
    };
    if(event.state === 'active'){
      const result = screenOffAt && at - screenOffAt >= 15000 ? await pause(screenOffAt + 15000) : { ack: true };
      screenOffAt = 0; return result;
    }
    if(event.state === 'screen-off'){
      if(event.resumedAt && Number(event.resumedAt) < at + 15000) return { ack: true };
      screenOffAt = at;
      if(Date.now() >= at + 15000 || Number(event.resumedAt) >= at + 15000) { screenOffAt = 0; return pause(at + 15000); }
      screenTimer = setTimeout(async () => { await pause(at + 15000); screenOffAt = 0; window.dispatchEvent(new CustomEvent('argus:worker-ready')); }, at + 15000 - Date.now());
      return { ack: false };
    }
    if(event.state === 'background'){ screenOffAt = 0; return pause(at); }
    return { ack: false };
  }
  window.addEventListener('online', () => { connected = true; sync(); });
  window.addEventListener('offline', () => { connected = false; renderStatus(); });
  window.addEventListener('argus:scan', event => { scanning = true; handleQr(event.detail && event.detail.value); });
  window.ArgusWorker = { apiBase, native: Boolean(config.native), bind, request, sync, showQueue, handleQr, resetScan, recordPause, lifecycle, confirmPlacement, restoreDraft, beforeLogout, publishWorkState,
    cancelScan() { scanning = false; }, resumed() { locallyPaused = false; nativeFlushSettled = false; },
    inspect: commands, hasCellScan() { const ctx = context(); return !!scanned && scanned.cellId === ctx.cellId && scanned.itemId === ctx.itemId; } };
})();
