const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.ARGUS_PLAYWRIGHT_MODULE || '../mobile/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const ids = { warehouse: '11000000-0000-4000-8000-000000000001', worker: '22000000-0000-4000-8000-000000000002',
  other: '22000000-0000-4000-8000-000000000003', cell: '33000000-0000-4000-8000-000000000003', session: '44000000-0000-4000-8000-000000000004' };
const routes = [{ method: 'POST', path: '/api/receiving' }, { method: 'POST', path: '/api/receiving/items/:id/place' }, { method: 'POST', path: '/api/journal/pause' }];

async function harness(browser, behavior = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const state = { offline: false, requests: [], nativeRequests: [], effects: 0, ledger: new Map(), conflict: false, loseResponse: false, truncateResponse: false, authOnce: false };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  async function apiResponse(request) {
    if (state.offline) throw new Error('Synthetic disconnection');
    if (request.path === '/api/worker/capabilities') return { status: 200, data: { offline: { version: 1, supportedOperations: routes, idempotentOperations: routes }, cellQr: { version: 1, prefix: 'argus:cell:v1:' } } };
    if (request.method === 'GET') return { status: 200, data: { rows: [1, 2, 3], fromServer: true } };
    state.requests.push(request);
    if (state.responseGate) await state.responseGate;
    if (state.authOnce) { state.authOnce = false; return { status: 401, data: { error: 'Войдите снова' } }; }
    if (state.conflict) return { status: 409, data: { error: 'Остаток изменился. Нужна проверка руководителем.', code: 'placement_changed' } };
    const id = request.headers['x-argus-operation-id'];
    if (!state.ledger.has(id)) { state.effects++; state.ledger.set(id, { accepted: true, operationId: id }); }
    if (state.loseResponse) { state.loseResponse = false; throw new Error('Synthetic lost response'); }
    if (state.truncateResponse) { state.truncateResponse = false; return { status: 200, data: '{"accepted":' }; }
    return { status: 200, data: state.ledger.get(id), headers: state.renewedToken ? { 'x-ArGuS-ToKeN': state.renewedToken } : {} };
  }
  if (behavior.nativeHttp) await context.exposeBinding('__nativeRequest', async (_, options) => {
    state.nativeRequests.push(options);
    return apiResponse({ path: new URL(options.url).pathname, method: options.method, body: options.data,
      headers: Object.fromEntries(Object.entries(options.headers).map(([key, val]) => [key.toLowerCase(), val])) });
  });
  await context.addInitScript(({ ids, nativeHttp }) => {
    window.testIds = ids;
    if (nativeHttp) {
      window.nativeFlags = [];
      window.Capacitor = { Plugins: {
        CapacitorHttp: { request: options => window.__nativeRequest(options) },
        WorkerDevice: { setWorkActive: async state => { nativeFlags.push(state); } }
      } };
      window.fetch = () => { throw new Error('Native runtime must not call WebView fetch'); };
    }
    const payload = { role: 'worker', staffKeyId: ids.worker, warehouseId: ids.warehouse, exp: Math.floor(Date.now() / 1000) + 3600 };
    if (location.pathname !== '/login.html' && !localStorage.getItem('argus_auth_worker')) localStorage.setItem('argus_auth_worker', 'test.' + btoa(JSON.stringify(payload)) + '.fixture');
  }, { ids, nativeHttp: Boolean(behavior.nativeHttp) });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'worker.test') {
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/worker.css"></head><body><div id="cellBlock"></div><script>window.ARGUS_WORKER_CONFIG={apiBase:'https://api.worker.test',native:${Boolean(behavior.nativeHttp)}}</script><script src="/auth.js"></script><script src="/runtime.js"></script><script>
        window.ctx={workSessionId:testIds.session,itemId:'item-1',cellId:testIds.cell,eventSequence:0,unplacedQty:5,status:'active',mine:true,workActive:true,startedAt:new Date(Date.now()-60000).toISOString()};
        window.messages=[];window.pauses=[];window.pauseFailure=false;window.durablePause=false;
        ArgusWorker.bind(ArgusAuth.get(['worker']),{context:()=>ctx,findCell:id=>id===testIds.cell?{id,label:'1.1.1'}:null,selectCell:c=>{ctx.cellId=c.id},scanStatus:t=>messages.push(t),toast:t=>messages.push(t),closeScanner:()=>{},pause:async at=>{pauses.push(at);if(pauseFailure)throw Error('Storage unavailable');if(durablePause){ctx.status='paused';ctx.pauseLocal=true;return ArgusWorker.recordPause({invoiceId:'doc-1',reason:'Вышел из приёмки',exit:true,at:new Date(at).toISOString()});}},noActiveWork:()=>false});
        ${behavior.delayRestore ? 'window.finishRestore = () => ArgusWorker.restoreDraft();' : 'ArgusWorker.restoreDraft();'}
      </script></body></html>` });
      const file = url.pathname === '/auth.js' ? 'auth.js' : url.pathname === '/fonts/golos-text.ttf' ? 'fonts/golos-text.ttf' : 'worker' + url.pathname;
      return route.fulfill({ path: path.join(root, file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
    }
    if (url.hostname !== 'api.worker.test') return route.abort();
    let response;
    try { response = await apiResponse({ path: url.pathname, method: route.request().method(), body: route.request().postDataJSON(), headers: route.request().headers() }); }
    catch (_) { return route.abort('failed'); }
    return route.fulfill({ status: response.status, headers: response.headers, contentType: 'application/json', body: typeof response.data === 'string' ? response.data : JSON.stringify(response.data) });
  });
  await page.goto('https://worker.test/');
  await page.waitForFunction(() => document.querySelector('#workerStatus')?.textContent.includes('Подключено'), null, {timeout:5000})
    .catch(async error => { throw new Error(error.message + ' · ' + JSON.stringify(errors) + ' · ' + await page.locator('body').innerText()); });
  return { context, page, state, errors };
}
async function submit(page, path = '/api/receiving', body = { invoiceItemId: 'item-1', acceptedQty: 5, placements: [{ cellBlockId: ids.cell, qty: 5 }] }) {
  return page.evaluate(async ({ path, body }) => { try { return { result: await ArgusWorker.request(path, { method: 'POST', body }) }; } catch (e) { return { error: e.message, queued: e.queued }; } }, { path, body });
}

test('native HTTP preserves offline FIFO, same-ID uncertainty/auth retries, headers and token renewal without WebView fetch', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { context, page, state, errors } = await harness(browser, { nativeHttp: true });
    await page.evaluate(() => ArgusWorker.request('/api/invoices'));
    state.offline = true;
    assert.equal((await page.evaluate(() => ArgusWorker.request('/api/invoices'))).fromServer, true);
    await page.evaluate(ids => ArgusWorker.handleQr('argus:cell:v1:' + ids.warehouse + ':' + ids.cell), ids);
    assert.equal((await submit(page)).queued, true);
    await page.evaluate(async () => { try { await ArgusWorker.recordPause({ invoiceId: 'doc-1', reason: 'Вышел из приёмки', exit: true, at: new Date().toISOString() }); } catch (_) {} });
    state.offline = false; state.loseResponse = true;
    await page.evaluate(() => ArgusWorker.sync());
    assert.equal(state.effects, 1);
    assert.equal((await page.evaluate(() => ArgusWorker.inspect()))[0].status, 'queued');
    state.authOnce = true;
    await page.evaluate(() => ArgusWorker.sync());
    assert.equal((await page.evaluate(() => ArgusWorker.inspect()))[0].status, 'auth');
    await page.evaluate(() => ArgusWorker.showQueue());
    const recover = page.getByRole('button', { name: 'Войти снова тем же ключом' });
    assert.equal(await recover.isVisible(), true);
    assert.ok((await recover.boundingBox()).height >= 48);
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    state.renewedToken = await page.evaluate(ids => {
      const payload = { role: 'worker', staffKeyId: ids.worker, warehouseId: ids.warehouse, exp: Math.floor(Date.now()/1000)+7200 };
      const token = 'test.' + btoa(JSON.stringify(payload)) + '.renewed';
      ArgusAuth.set('worker', token);
      return token.replace('.renewed', '.server-renewed');
    }, ids);
    await page.evaluate(() => ArgusWorker.sync());
    assert.equal(state.effects, 2);
    assert.deepEqual(state.requests.map(row => row.path), ['/api/receiving', '/api/receiving', '/api/receiving', '/api/journal/pause']);
    assert.equal(new Set(state.requests.slice(0, 3).map(row => row.headers['x-argus-operation-id'])).size, 1);
    assert.deepEqual(state.requests[0].body, state.requests[2].body);
    assert.equal(state.requests[3].body.eventSequence, 1);
    for (const request of state.nativeRequests) {
      assert.match(request.url, /^https:\/\/api\.worker\.test\/api\//);
      assert.equal(request.disableRedirects, true);
      assert.equal(request.responseType, 'json');
      assert.equal(request.connectTimeout, 10000);
      assert.equal(request.readTimeout, 20000);
      assert.equal(request.headers['Content-Type'], 'application/json');
      assert.match(request.headers.Authorization, /^Bearer test\./);
      if (request.method === 'POST') { assert.equal(request.headers['X-Argus-Offline'], '1'); assert.equal(typeof request.data, 'object'); }
      else assert.equal(request.data, undefined);
    }
    assert.equal(await page.evaluate(() => ArgusAuth.get(['worker']).token), state.renewedToken);
    assert.ok((await page.evaluate(() => ArgusWorker.inspect())).every(row => row.status === 'confirmed'));
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('native HTTP never confirms malformed JSON and retains typed business rejection', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { context, page, state, errors } = await harness(browser, { nativeHttp: true });
    state.truncateResponse = true;
    assert.equal((await submit(page)).queued, true);
    const unknown = (await page.evaluate(() => ArgusWorker.inspect()))[0];
    assert.equal(unknown.status, 'queued');
    await page.evaluate(() => ArgusWorker.sync());
    assert.equal(state.effects, 1);
    assert.equal((await page.evaluate(() => ArgusWorker.inspect()))[0].id, unknown.id);
    assert.deepEqual(state.requests[0].body, state.requests[1].body);
    assert.equal(state.requests[0].headers['x-argus-offline'], undefined);
    await page.reload();
    state.conflict = true;
    assert.match((await submit(page, '/api/receiving/items/item-1/place', { cellBlockId: ids.cell, qty: 2 })).error, /Остаток изменился/);
    const rejected = (await page.evaluate(() => ArgusWorker.inspect())).find(row => row.status === 'conflict');
    assert.equal(rejected.errorCode, 'placement_changed');
    assert.equal(rejected.errorStatus, 409);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('native pending departure survives same-key restart but cannot pause a different worker with an older active session', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { context, page, errors } = await harness(browser, { nativeHttp: true });
    const departureAt = await page.evaluate(() => Date.now());
    await page.reload();
    await page.waitForFunction(async () => (await ArgusWorker.lifecycle({ state: 'active', at: Date.now() })).ack);
    assert.equal((await page.evaluate(at => ArgusWorker.lifecycle({ id: 'same-key', state: 'background', at }), departureAt)).ack, true);
    assert.deepEqual(await page.evaluate(() => pauses), [departureAt]);
    await page.evaluate(ids => {
      const p = { role: 'worker', staffKeyId: ids.other, warehouseId: ids.warehouse, exp: Math.floor(Date.now()/1000)+3600 };
      ArgusAuth.set('worker', 'test.' + btoa(JSON.stringify(p)) + '.fixture');
    }, ids);
    await page.reload();
    await page.waitForFunction(async () => (await ArgusWorker.lifecycle({ state: 'active', at: Date.now() })).ack);
    assert.ok(await page.evaluate(at => new Date(ctx.startedAt).getTime() < at, departureAt), 'New worker already had an older active session.');
    assert.equal((await page.evaluate(at => ArgusWorker.lifecycle({ id: 'old-worker-background', state: 'background', at }), departureAt)).ack, true);
    assert.equal((await page.evaluate(at => ArgusWorker.lifecycle({ id: 'old-worker-screen', state: 'screen-off', at, resumedAt: at + 16000 }), departureAt)).ack, true);
    assert.deepEqual(await page.evaluate(() => pauses), [], 'Use the original departure, not a deadline after the key change.');
    const newDepartureAt = await page.evaluate(() => Date.now());
    await page.reload();
    await page.waitForFunction(async () => (await ArgusWorker.lifecycle({ state: 'active', at: Date.now() })).ack);
    assert.equal((await page.evaluate(at => ArgusWorker.lifecycle({ id: 'new-worker-own', state: 'background', at }), newDepartureAt)).ack, true);
    assert.deepEqual(await page.evaluate(() => pauses), [newDepartureAt]);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('actual loader native logout retains key on failed persistence/offline and exits only after one confirmed pause', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { context, page, state, errors } = await harness(browser, { nativeHttp: true });
    const loader = fs.readFileSync(path.join(root, 'loader.html'), 'utf8');
    const logoutSource = loader.match(/  const WORKER_LOGIN = [^\n]+/)[0] + '\n' + loader.slice(loader.indexOf('  let logoutPending = false;'), loader.indexOf('  let invoices = []'));
    assert.match(logoutSource, /await ArgusWorker.beforeLogout\(\)/);
    await context.route('https://worker.test/login.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>Logged out</p>' }));
    await page.evaluate(source => {
      window.TOKEN = ArgusAuth.get(['worker']).token; window.ROLE = 'worker'; window.showToast = text => messages.push(text);
      (0, eval)(source + '\nwindow.testLogout = logout;');
      durablePause = true;
      const original = IDBObjectStore.prototype.put;
      window.failCommandPut = 1;
      IDBObjectStore.prototype.put = function(...args) {
        if(this.name === 'commands' && window.failCommandPut > 0) { window.failCommandPut--; throw new DOMException('Synthetic storage failure', 'QuotaExceededError'); }
        return original.apply(this, args);
      };
    }, logoutSource);
    await page.evaluate(() => testLogout());
    assert.ok(await page.evaluate(() => ArgusAuth.get(['worker'])));
    assert.match((await page.evaluate(() => messages)).at(-1), /Не удалось сохранить/);
    assert.equal(state.requests.length, 0);
    state.offline = true;
    await page.evaluate(() => testLogout());
    const stored = await page.evaluate(() => ArgusWorker.inspect());
    assert.equal(stored.length, 1);
    assert.equal(stored[0].status, 'queued');
    assert.ok(await page.evaluate(() => ArgusAuth.get(['worker'])));
    assert.equal(await page.locator('#workerQueue').isVisible(), true);
    assert.match((await page.evaluate(() => messages)).at(-1), /Текущий ключ сохранён/);
    state.offline = false;
    await page.evaluate(() => { void testLogout(); });
    await page.waitForURL('https://worker.test/login.html');
    assert.equal(await page.evaluate(() => localStorage.getItem('argus_auth_worker')), null);
    assert.equal(state.effects, 1);
    assert.equal(state.requests[0].path, '/api/journal/pause');
    assert.equal(state.requests[0].headers['x-argus-operation-id'], stored[0].id);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('repeated native departure reuses durable pause until an explicit resume', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { context, page, state, errors } = await harness(browser, { nativeHttp: true });
    await page.evaluate(() => { durablePause = true; });
    state.offline = true;
    assert.equal((await page.evaluate(() => ArgusWorker.lifecycle({ id: 'first-exit', state: 'background', at: Date.now() }))).ack, true);
    await page.evaluate(() => ArgusWorker.lifecycle({ state: 'active', at: Date.now() }));
    assert.equal((await page.evaluate(() => ArgusWorker.lifecycle({ id: 'second-exit', state: 'background', at: Date.now() }))).ack, true);
    assert.equal((await page.evaluate(() => ArgusWorker.inspect())).length, 1);
    assert.equal((await page.evaluate(() => pauses)).length, 1);
    state.offline = false;
    await page.evaluate(() => ArgusWorker.sync());
    await page.evaluate(() => ArgusWorker.lifecycle({ id: 'third-exit', state: 'background', at: Date.now() }));
    assert.equal((await page.evaluate(() => ArgusWorker.inspect())).length, 1, 'A confirmed pause is also reused before resume.');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#workerStatus')?.textContent.includes('Подключено'));
    await page.evaluate(async () => {
      ctx.eventSequence = 1; ctx.status = 'paused'; durablePause = true;
      await ArgusWorker.recordPause({ invoiceId: 'doc-1', resumed: true, at: new Date().toISOString() });
      ctx.status = 'active'; ctx.pauseLocal = false;
    });
    assert.equal((await page.evaluate(() => ArgusWorker.lifecycle({ id: 'exit-after-resume', state: 'background', at: Date.now() }))).ack, true);
    const rows = await page.evaluate(() => ArgusWorker.inspect());
    assert.deepEqual(rows.map(row => row.body.eventSequence), [1, 2, 3]);
    assert.deepEqual(rows.map(row => Boolean(row.body.resumed)), [false, true, false]);
    assert.equal((await page.evaluate(() => pauses)).length, 1);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('cold native restore lets authoritative bridge replay the earliest departure before later buffered events', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { context, page, state, errors } = await harness(browser, { nativeHttp: true, delayRestore: true });
    state.offline = true;
    const firstAt = await page.evaluate(() => Date.now());
    await page.evaluate(async at => {
      durablePause = true;
      window.nativePending = [{ id: 'first-before-restore', state: 'background', at }, { id: 'second-before-restore', state: 'background', at: at + 20 }];
      window.Capacitor.Plugins.WorkerDevice = {
        addListener: async () => ({}),
        getLifecycle: async () => ({ state: 'active', at: at + 21, pending: nativePending.slice() }),
        ackLifecycle: async ({ ids }) => { nativePending = nativePending.filter(event => !ids.includes(event.id)); }
      };
      await ArgusWorker.lifecycle(nativePending[0]);
      await ArgusWorker.lifecycle({ state: 'active', at: at + 10 });
      await ArgusWorker.lifecycle(nativePending[1]);
    }, firstAt);
    await page.evaluate(source => { (0, eval)(source); }, fs.readFileSync(path.join(root, 'mobile/native-bridge.js'), 'utf8'));
    await page.evaluate(() => finishRestore());
    await page.waitForFunction(() => nativePending.length === 0);
    const rows = await page.evaluate(() => ArgusWorker.inspect());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].body.eventAt, new Date(firstAt).toISOString());
    assert.equal(rows[0].body.eventSequence, 1);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('concurrent native logout and departure atomically reuse one pause operation', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { context, page, state, errors } = await harness(browser, { nativeHttp: true });
    state.offline = true;
    const results = await page.evaluate(async () => {
      durablePause = true;
      return Promise.allSettled([ArgusWorker.beforeLogout(), ArgusWorker.lifecycle({ id: 'departure-during-logout', state: 'background', at: Date.now() + 5 })]);
    });
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].value.ack, true);
    const rows = await page.evaluate(() => ArgusWorker.inspect());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].body.eventSequence, 1);
    assert.equal(rows[0].status, 'queued');
    state.offline = false;
    await page.evaluate(() => ArgusWorker.sync());
    assert.equal(state.effects, 1);
    assert.equal(state.requests[0].headers['x-argus-operation-id'], rows[0].id);
    assert.deepEqual(state.requests[0].body, rows[0].body);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('native work flag and durable ACK keep the network window through in-flight stock then FIFO pause', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { context, page, state, errors } = await harness(browser, { nativeHttp: true });
    await page.waitForFunction(() => nativeFlags.length > 0);
    assert.deepEqual((await page.evaluate(() => nativeFlags)).at(-1), { active: true, pendingPause: false });
    await page.evaluate(async () => { ctx.workActive = false; await ArgusWorker.publishWorkState(); });
    assert.equal((await page.evaluate(() => nativeFlags)).at(-1).active, false, 'A viewed document without current work must not arm native service.');
    await page.evaluate(async () => { ctx.workActive = true; ctx.mine = false; await ArgusWorker.publishWorkState(); });
    assert.equal((await page.evaluate(() => nativeFlags)).at(-1).active, false, 'Another worker session must not arm native service.');
    await page.evaluate(async () => { ctx.mine = true; durablePause = true; await ArgusWorker.publishWorkState(); });
    let release;
    state.responseGate = new Promise(resolve => { release = resolve; });
    const stock = submit(page);
    while (!state.requests.length) await new Promise(resolve => setTimeout(resolve, 10));
    const priorSync = page.evaluate(() => ArgusWorker.sync());
    let acknowledged = false;
    const departure = page.evaluate(async () => {
      const result = await ArgusWorker.lifecycle({ id: 'exit-during-stock', state: 'background', at: Date.now() });
      window.flagsAtAck = nativeFlags.at(-1);
      return result;
    }).then(result => { acknowledged = true; return result; });
    await page.waitForFunction(async () => (await ArgusWorker.inspect()).length === 2);
    assert.equal(acknowledged, false, 'Durable enqueue alone must not close the service while stock HTTP is still pending.');
    assert.deepEqual((await page.evaluate(() => nativeFlags)).at(-1), { active: false, pendingPause: true });
    release();
    await Promise.all([stock, priorSync]);
    assert.equal((await departure).ack, true);
    assert.deepEqual(state.requests.map(row => row.path), ['/api/receiving', '/api/journal/pause']);
    assert.ok((await page.evaluate(() => ArgusWorker.inspect())).every(row => row.status === 'confirmed'));
    assert.deepEqual(await page.evaluate(() => flagsAtAck), { active: false, pendingPause: false });
    await page.evaluate(() => ArgusWorker.publishWorkState());
    assert.equal((await page.evaluate(() => nativeFlags)).at(-1).pendingPause, false, 'A settled attempt must not rearm during the ACK gap.');
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('offline native pause remains durable but releases the short network attempt before ACK', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { context, page, state } = await harness(browser, { nativeHttp: true });
    await page.evaluate(() => { durablePause = true; });
    state.offline = true;
    assert.equal((await page.evaluate(() => ArgusWorker.lifecycle({ id: 'offline-exit', state: 'background', at: Date.now() }))).ack, true);
    assert.equal((await page.evaluate(() => ArgusWorker.inspect()))[0].status, 'queued');
    assert.deepEqual((await page.evaluate(() => nativeFlags)).at(-1), { active: false, pendingPause: false });
    await page.evaluate(() => ArgusWorker.publishWorkState());
    assert.equal((await page.evaluate(() => nativeFlags)).at(-1).pendingPause, false);
    await page.evaluate(async () => { ctx.status = 'active'; ctx.pauseLocal = false; await ArgusWorker.publishWorkState(); });
    assert.deepEqual((await page.evaluate(() => nativeFlags)).at(-1), { active: false, pendingPause: false }, 'A manual offline pause can retain an old active server snapshot without keeping the service alive.');
    await context.close();
  } finally { await browser.close(); }
});

test('native task and paper resume keep real work controls locked until confirmed, including offline and auth failure', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const loader = fs.readFileSync(path.join(root, 'loader.html'), 'utf8');
  const section = (from, to) => loader.slice(loader.indexOf(from), loader.indexOf(to, loader.indexOf(from)));
  const source = [section('  function reportPause(body)', '  function setPauseBannerText'),
    section('  function setPauseLock(on)', '  function pauseTask'),
    section('  let nativeResumePending = false;', '  function formatDuration'),
    section('  async function paperResume()', '  window.paperResume')].join('\n');
  try {
    for (const mode of ['task', 'paper']) {
      const { context, page, errors } = await harness(browser, { nativeHttp: true });
      await page.evaluate(({ source, mode }) => {
        document.body.insertAdjacentHTML('beforeend', '<div id="taskScreen"><div class="task-body"><input id="taskField"></div><div class="task-footer"><button id="confirmBtn">Принять</button></div></div><div id="pauseBanner"><button id="pauseResumeBtn">Продолжить</button></div><textarea id="pauseComment">Проверить остаток</textarea><div id="paperScreen"></div><div id="paperPauseBanner"><button>Возобновить</button></div><div id="paperBody" inert></div>');
        document.getElementById('paperScreen').classList.toggle('show', mode === 'paper');
        window.pauseStart = new Date(Date.now() - 5000); window.totalPausedMs = 0;
        window.pauseLog = [{ reason: 'Перерыв', start: pauseStart, end: null }];
        window.productRun = null; window.recvRun = { invoiceId: 'fixture-doc' }; window.currentInvoice = { id: 'fixture-doc' };
        window.paper = mode === 'paper' ? { supplyId: 'fixture-supply', pauseAt: pauseStart.toISOString(), pauseReason: 'Перерыв', pausedMs: 0 } : null;
        window.pauseWrites = 0; window.showToast = text => messages.push(text);
        window.apiFetch = () => { pauseWrites++; return new Promise((resolve, reject) => {
          window.acceptResume = () => resolve({ assembly: { confirmed: true } });
          window.rejectResume = message => reject(Object.assign(new Error(message), { queued: true }));
        }); };
        window.applyAssemblyState = () => { ctx.status = 'active'; };
        window.syncPaperFromState = () => { if(paper){ paper.pauseAt = null; paper.pauseReason = ''; } };
        window.renderTaskTimer = window.savePaper = window.updatePickConfirm = window.updateConfirmState = () => {};
        window.renderPaperTimer = () => { document.getElementById('paperBody').inert = Boolean(paper.pauseAt); };
        window.isPicking = () => false;
        (0, eval)(source + '\nwindow.testResume = ' + (mode === 'paper' ? 'paperResume' : 'resumeTask') + ';');
        setPauseLock(true);
      }, { source, mode });
      for (const message of ['Нет связи. Сохранено на устройстве.', 'Войдите снова тем же ключом.']) {
        await page.evaluate(() => { window.resumeAttempt = testResume(); });
        assert.equal(await page.evaluate(() => document.querySelector('#taskScreen .task-body').inert), true);
        assert.ok(await page.evaluate(mode => mode === 'paper' ? paper.pauseAt : pauseStart, mode));
        const writes = await page.evaluate(() => pauseWrites);
        assert.equal(await page.evaluate(() => testResume()), false, 'Repeated click must not issue a second resume.');
        assert.equal(await page.evaluate(() => pauseWrites), writes);
        await page.evaluate(message => rejectResume(message), message);
        assert.equal(await page.evaluate(() => resumeAttempt), false);
        assert.ok(await page.evaluate(mode => mode === 'paper' ? paper.pauseAt : pauseStart, mode));
        if(mode === 'paper') assert.equal(await page.locator('#paperBody').evaluate(node => node.inert), true);
        else assert.equal(await page.locator('#taskField').isDisabled(), true);
        assert.equal(await page.locator('#pauseComment').inputValue(), 'Проверить остаток');
      }
      await page.evaluate(() => { window.resumeAttempt = testResume(); });
      await page.evaluate(() => acceptResume());
      assert.equal(await page.evaluate(() => resumeAttempt), true);
      if(mode === 'paper') assert.equal(await page.locator('#paperBody').evaluate(node => node.inert), false);
      else { assert.equal(await page.locator('#taskField').isDisabled(), false); assert.equal(await page.locator('#pauseComment').inputValue(), ''); }
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
});

test('repeated queued resume keeps its ID/body and requires fresh state after background confirmation', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { context, page, state, errors } = await harness(browser, { nativeHttp: true });
    state.offline = true;
    await page.evaluate(async () => {
      ctx.status = 'paused';
      const at = Date.now();
      await Promise.allSettled([
        ArgusWorker.recordPause({ invoiceId: 'doc-1', resumed: true, comment: 'Первый ввод', at: new Date(at).toISOString() }),
        ArgusWorker.recordPause({ invoiceId: 'doc-1', resumed: true, comment: 'Повтор нажатия', at: new Date(at + 5).toISOString() })
      ]);
      try { await ArgusWorker.recordPause({ invoiceId: 'doc-1', resumed: true, comment: 'Поздний повтор', at: new Date(at + 10).toISOString() }); } catch (_) {}
    });
    const original = await page.evaluate(() => ArgusWorker.inspect());
    assert.equal(original.length, 1);
    assert.equal(original[0].body.comment, 'Первый ввод');
    assert.equal(original[0].body.eventSequence, 1);
    state.offline = false;
    await page.evaluate(() => ArgusWorker.sync());
    assert.equal(state.effects, 1);
    assert.equal(state.requests[0].headers['x-argus-operation-id'], original[0].id);
    assert.deepEqual(state.requests[0].body, original[0].body);
    const blocked = await page.evaluate(async () => { try { await ArgusWorker.recordPause({ invoiceId: 'doc-1', resumed: true }); } catch (error) { return error.message; } });
    assert.match(blocked, /Обновить данные/);
    assert.equal((await page.evaluate(() => ArgusWorker.inspect())).length, 1);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#workerStatus')?.textContent.includes('Подключено'));
    await page.evaluate(async () => {
      ctx.eventSequence = 1;
      await ArgusWorker.recordPause({ invoiceId: 'doc-1', exit: true, at: new Date().toISOString() });
      ctx.eventSequence = 2; ctx.status = 'paused';
      await ArgusWorker.recordPause({ invoiceId: 'doc-1', resumed: true, at: new Date().toISOString() });
    });
    const final = await page.evaluate(() => ArgusWorker.inspect());
    assert.deepEqual(final.map(row => Boolean(row.body.resumed)), [true, false, true]);
    assert.deepEqual(final.map(row => row.body.eventSequence), [1, 2, 3]);
    assert.notEqual(final[2].id, original[0].id, 'An intervening pause allows a new resume.');
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('worker durable offline step, FIFO pause, restart and actor isolation', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { context, page, state, errors } = await harness(browser);
    await page.evaluate(() => ArgusWorker.request('/api/invoices'));
    state.offline = true;
    const cached = await page.evaluate(() => ArgusWorker.request('/api/invoices'));
    assert.deepEqual(cached.rows, [1, 2, 3]);
    await page.evaluate(ids => ArgusWorker.handleQr('argus:cell:v1:' + ids.warehouse + ':' + ids.cell), ids);
    assert.equal((await submit(page)).queued, true);
    assert.match((await submit(page, '/api/receiving/items/item-2/place', { cellBlockId: ids.cell, qty: 1 })).error, /Предыдущее/);
    await page.evaluate(async () => { try { await ArgusWorker.recordPause({ invoiceId: 'doc-1', reason: 'Вышел из приёмки', exit: true, at: new Date().toISOString() }); } catch (_) {} });
    const before = await page.evaluate(() => ArgusWorker.inspect());
    assert.equal(before.length, 2);
    assert.equal(before[0].body.expected.received, false);
    assert.equal(before[0].body.workSessionId, ids.session);
    assert.equal(before[1].body.eventSequence, 1);
    await page.reload();
    await page.waitForFunction(async () => (await ArgusWorker.inspect()).length === 2);
    assert.equal((await page.evaluate(() => ArgusWorker.inspect()))[0].id, before[0].id);
    state.offline = false;
    await page.evaluate(() => ArgusWorker.sync());
    assert.deepEqual(state.requests.map(r => r.path), ['/api/receiving', '/api/journal/pause']);
    assert.equal(state.requests[0].headers['x-argus-offline'], '1');
    assert.equal(state.effects, 2);
    assert.equal((await page.evaluate(() => ArgusWorker.inspect())).filter(r => r.status === 'confirmed').length, 2);
    await page.evaluate(ids => {
      const p = { role: 'worker', staffKeyId: ids.other, warehouseId: ids.warehouse, exp: Math.floor(Date.now()/1000)+3600 };
      ArgusAuth.set('worker', 'test.' + btoa(JSON.stringify(p)) + '.fixture');
    }, ids);
    state.offline = true;
    await page.reload();
    assert.equal((await page.evaluate(() => ArgusWorker.inspect())).length, 0);
    const miss = await page.evaluate(async () => { try { await ArgusWorker.request('/api/invoices'); } catch (e) { return e.message; } });
    assert.match(miss, /ещё не загружен/);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('worker lost response replays same ID once; conflicts persist and block new stock actions', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { context, page, state, errors } = await harness(browser);
    state.truncateResponse = true;
    assert.equal((await submit(page)).queued, true);
    await page.evaluate(() => ArgusWorker.sync());
    assert.equal(state.effects, 1);
    assert.equal(state.requests.length, 2);
    assert.equal(state.requests[0].headers['x-argus-operation-id'], state.requests[1].headers['x-argus-operation-id']);
    assert.deepEqual(state.requests[0].body, state.requests[1].body);
    assert.match((await submit(page)).error, /Обновить данные/);
    await page.reload();
    state.conflict = true;
    assert.match((await submit(page, '/api/receiving/items/item-1/place', { cellBlockId: ids.cell, qty: 2 })).error, /Остаток изменился/);
    await page.reload();
    assert.equal((await page.evaluate(() => ArgusWorker.inspect())).filter(r => r.status === 'conflict').length, 1);
    assert.match((await submit(page)).error, /Предыдущее/);
    await page.evaluate(() => ArgusWorker.showQueue());
    assert.equal(await page.locator('#workerQueue').getByText('Действие отклонено сервером без применения', { exact: true }).count(), 1);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Сверил товар, исправлю ввод' }).click();
    await page.waitForFunction(async () => (await ArgusWorker.inspect()).some(row => row.status === 'resolved'));
    assert.ok((await page.evaluate(() => ArgusWorker.inspect())).find(row => row.status === 'resolved').resolvedAt);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('worker authentication retry preserves unknown operation; IDB failure cannot acknowledge a native pause or consume sequence', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { context, page, state, errors } = await harness(browser);
    state.loseResponse = true;
    assert.equal((await submit(page)).queued, true);
    state.authOnce = true;
    await page.evaluate(() => ArgusWorker.sync());
    assert.equal((await page.evaluate(() => ArgusWorker.inspect()))[0].status, 'auth');
    await page.evaluate(ids => {
      const p = { role: 'worker', staffKeyId: ids.worker, warehouseId: ids.warehouse, exp: Math.floor(Date.now()/1000)+3600 };
      ArgusAuth.set('worker', 'test.' + btoa(JSON.stringify(p)) + '.fixture');
    }, ids);
    await page.evaluate(() => ArgusWorker.sync());
    assert.equal(state.effects, 1);
    assert.equal(new Set(state.requests.map(r => r.headers['x-argus-operation-id'])).size, 1);
    await page.reload();
    await page.evaluate(() => {
      durablePause = true;
      const original = IDBObjectStore.prototype.put;
      window.failCommandPut = 1;
      IDBObjectStore.prototype.put = function(...args){
        if(this.name === 'commands' && window.failCommandPut > 0){ window.failCommandPut--; throw new DOMException('Synthetic storage failure', 'QuotaExceededError'); }
        return original.apply(this, args);
      };
    });
    const event = { id: 'durable-retry', state: 'background', at: Date.now() };
    const first = await page.evaluate(e => ArgusWorker.lifecycle(e), event);
    assert.equal(first.ack, false);
    const second = await page.evaluate(e => ArgusWorker.lifecycle(e), event);
    assert.equal(second.ack, true);
    const pauseRows = (await page.evaluate(() => ArgusWorker.inspect())).filter(row => row.path === '/api/journal/pause');
    assert.equal(pauseRows.length, 1);
    assert.equal(pauseRows[0].body.eventSequence, 1);
    assert.equal((await page.evaluate(e => ArgusWorker.lifecycle(e), event)).ack, true);
    assert.equal((await page.evaluate(() => ArgusWorker.inspect())).filter(row => row.path === '/api/journal/pause').length, 1);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('two tabs cannot replay a typed rejection after waiting for the first sender', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { context, page, state } = await harness(browser);
    const secondPage = await context.newPage();
    await secondPage.goto('https://worker.test/');
    await secondPage.waitForFunction(() => document.querySelector('#workerStatus')?.textContent.includes('Подключено'));
    let release;
    state.responseGate = new Promise(resolve => { release = resolve; });
    state.conflict = true;
    const body = { invoiceItemId: 'item-1', acceptedQty: 5, placements: [{ cellBlockId: ids.cell, qty: 5 }], occurredAt: new Date().toISOString() };
    const first = submit(page, '/api/receiving', body);
    while(!state.requests.length) await new Promise(resolve => setTimeout(resolve, 10));
    const second = submit(secondPage, '/api/receiving', body);
    release();
    const results = await Promise.all([first, second]);
    assert.ok(results.every(result => result.error));
    assert.equal(state.requests.length, 1, 'The tab waiting on the shared lock must reread the recorded rejection.');
    await secondPage.evaluate(() => ArgusWorker.sync({ retryConflicts: true }));
    assert.equal(state.requests.length, 1, 'Known rejected actions are corrected, never replayed.');
    await context.close();
  } finally { await browser.close(); }
});

test('worker native frozen lifecycle threshold, durable ack, QR isolation and responsive controls', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { context, page, errors } = await harness(browser);
    const now = Date.now();
    const short = await page.evaluate(event => ArgusWorker.lifecycle(event), { id: 'short', state: 'screen-off', at: now - 14900, resumedAt: now });
    assert.equal(short.ack, true);
    assert.equal((await page.evaluate(() => pauses)).length, 0);
    const long = await page.evaluate(event => ArgusWorker.lifecycle(event), { id: 'long', state: 'screen-off', at: now - 16000, resumedAt: now });
    assert.equal(long.ack, true);
    assert.equal((await page.evaluate(() => pauses))[0], now - 1000);
    await page.evaluate(() => { pauseFailure = true; });
    assert.equal((await page.evaluate(event => ArgusWorker.lifecycle(event), { id: 'failure', state: 'background', at: now })).ack, false);
    await page.evaluate(ids => ArgusWorker.handleQr('argus:cell:v1:' + ids.other + ':' + ids.cell), ids);
    assert.match((await page.evaluate(() => messages)).at(-1), /другого склада/);
    await page.locator('#workerScanInput').fill('argus:cell:v1:' + ids.warehouse + ':' + ids.cell);
    await page.locator('#workerScanInput').press('Enter');
    assert.equal(await page.evaluate(() => ArgusWorker.hasCellScan()), true);
    for (const width of [375, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow at ' + width);
      assert.ok((await page.locator('#workerCellScan').boundingBox()).height >= 48);
      await page.evaluate(() => ArgusWorker.showQueue());
      assert.equal(await page.locator('#workerQueue').isVisible(), true);
      assert.ok((await page.locator('#workerQueue').boundingBox()).width <= width);
      await page.locator('#workerQueue').getByRole('button', { name: 'Закрыть', exact: true }).click();
    }
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});
