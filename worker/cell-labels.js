(function () {
  'use strict';
  const config = window.ARGUS_WORKER_CONFIG || {}, auth = ArgusAuth.get(['worker']);
  const $ = id => document.getElementById(id);
  let cells = [], selected = new Set(), busy = false;
  function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
  async function request(path) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(String(config.apiBase || '').replace(/\/$/, '') + path, { signal: controller.signal, headers: { Authorization: 'Bearer ' + auth.token } });
      const renewed = response.headers.get('X-Argus-Token');
      if (renewed && ArgusAuth.sameUser(renewed, auth.token)) { ArgusAuth.renew('worker', auth.token, renewed); auth.token = renewed; }
      if (response.status === 401 || response.status === 403) throw new Error('Нет доступа. Вернитесь к работе и войдите своим ключом.');
      if (!response.ok) throw new Error('Сервер не вернул ячейки. Повторите загрузку при восстановлении связи.');
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('Нет ответа от сервера. Проверьте связь и повторите.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  const range = (start, end) => start === end ? String(start) : start + '–' + end;
  const filtered = () => cells.filter(cell => cell.label.toLowerCase().includes($('filter').value.trim().toLowerCase()));
  function update() {
    $('count').textContent = 'Выбрано: ' + selected.size + ' из 100 за одну печать.';
    $('prepare').disabled = busy || !selected.size;
    $('clear').disabled = busy || !selected.size;
    $('selectAll').disabled = busy || !filtered().length;
    $('filter').disabled = busy || !cells.length;
  }
  function invalidate() { $('labels').replaceChildren(); $('print').disabled = true; $('printHint').textContent = 'Выбор изменён. Подготовьте этикетки заново.'; }
  function render() {
    const list = filtered(); $('cells').replaceChildren();
    for (const cell of list) {
      const row = document.createElement('label'); row.className = 'cell-row';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(cell.id); input.disabled = busy;
      input.onchange = () => {
        if (input.checked && selected.size >= 100) { input.checked = false; status('За одну печать можно выбрать до 100 ячеек. Сначала распечатайте выбранные.', true); return; }
        if (input.checked) selected.add(cell.id); else selected.delete(cell.id);
        invalidate(); update();
      };
      const name = document.createElement('span'); name.textContent = cell.label; row.append(input, name); $('cells').append(row);
    }
    if (!list.length && cells.length) status('По этому адресу ячеек нет. Измените поиск.');
    else if (cells.length) status('Найдено ячеек: ' + list.length + '. Выберите нужные адреса.');
    update();
  }
  async function load() {
    busy = true; $('retry').hidden = true; status('Загружаем ячейки склада…'); update();
    try {
      const rows = await request('/api/cells/rows');
      if (!Array.isArray(rows)) throw new Error('Не удалось прочитать список ячеек. Повторите загрузку.');
      cells = rows.flatMap(row => (row.blocks || []).map(block => ({ id: block.id, label: Number(row.row_num) === 0 ? 'Склад' : row.row_num + '.' + range(block.rack_start, block.rack_end) + '.' + range(block.tier_start, block.tier_end) })));
      render(); if (!cells.length) status('В этом складе ещё нет ячеек. Попросите руководителя создать карту склада, затем обновите список.');
    } catch (error) { status(error.message, true); $('retry').hidden = false; }
    finally { busy = false; renderControls(); }
  }
  function renderControls() { for (const input of $('cells').querySelectorAll('input')) input.disabled = busy; update(); }
  $('filter').oninput = render;
  $('selectAll').onclick = () => { const list = filtered(); for (const cell of list) { if (selected.size >= 100) break; selected.add(cell.id); } invalidate(); render(); if (list.some(cell => !selected.has(cell.id))) status('Выбраны первые 100 ячеек. Остальные распечатайте следующим набором.'); };
  $('clear').onclick = () => { selected.clear(); invalidate(); render(); };
  $('retry').onclick = load;
  $('prepare').onclick = async () => {
    if (busy || !selected.size) return;
    busy = true; $('prepare').textContent = 'Готовим QR…'; $('print').disabled = true; $('labels').replaceChildren(); renderControls();
    try {
      const ids = [...selected], results = new Array(ids.length); let next = 0, finished = 0, failure = null;
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (next < ids.length && !failure) {
          const index = next++;
          try { results[index] = await request('/api/worker/cells/' + encodeURIComponent(ids[index]) + '/qr'); status('Подготовлено: ' + (++finished) + ' из ' + ids.length + '.'); }
          catch (error) { failure = error; }
        }
      }));
      if (failure) throw failure;
      const warehouseId = ArgusAuth.payload(auth.token).warehouseId;
      const fragment = document.createDocumentFragment();
      results.forEach((cell, index) => {
        if (cell.cellBlockId !== ids[index] || cell.qr !== 'argus:cell:v1:' + warehouseId + ':' + ids[index]) throw new Error('Не совпал адрес QR и выбранной ячейки. Обновите список перед печатью.');
        const code = qrcode(0, 'M'); code.addData(cell.qr); code.make();
        const count = code.getModuleCount(), scale = 6, canvas = document.createElement('canvas'); canvas.width = canvas.height = (count + 8) * scale;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#000';
        for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (code.isDark(row, col)) ctx.fillRect((col + 4) * scale, (row + 4) * scale, scale, scale);
        const label = document.createElement('article'); label.className = 'label';
        const img = document.createElement('img'); img.src = canvas.toDataURL('image/png'); img.alt = 'QR ячейки ' + cell.label;
        const address = document.createElement('strong'); address.textContent = cell.label;
        const caption = document.createElement('small'); caption.textContent = 'АРГУС · ЯЧЕЙКА'; label.append(img, address, caption); fragment.append(label);
      });
      $('labels').append(fragment); await Promise.all([...$('labels').querySelectorAll('img')].map(image => image.decode()));
      $('print').disabled = false; status('Этикетки готовы: ' + ids.length + '. Проверьте адреса перед печатью.'); $('printHint').textContent = 'Печатайте в масштабе 100%. Сначала проверьте один QR сканером склада.';
    } catch (error) { $('labels').replaceChildren(); status(error.message, true); }
    finally { busy = false; $('prepare').textContent = 'Подготовить этикетки'; renderControls(); }
  };
  $('print').onclick = async () => {
    try {
      if (config.native) await window.Capacitor.Plugins.WorkerDevice.printCurrentPage();
      else window.print();
    } catch (_) { status('Не удалось открыть печать. Повторите или откройте этикетки в браузере.', true); }
  };
  if (!auth) { status('Для печати войдите ключом комплектовщика. Нажмите «К работе».', true); return; }
  load();
})();
