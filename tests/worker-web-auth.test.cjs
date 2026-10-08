const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('../mobile/node_modules/playwright');
const browserType = process.env.ARGUS_AUTH_BROWSER === 'webkit' ? webkit : chromium;
const launchOptions = { headless: true, ...(browserType === chromium ? { channel: 'chrome' } : {}) };
const root = path.resolve(__dirname, '..');
const site = 'https://worker-web.test';
const output = path.join(root, 'test-results', 'worker-web-auth');
fs.mkdirSync(output, { recursive: true });
const key = 'SYNTHETIC-WORKER-KEY';
function token(role = 'worker', seconds = 3600, id = 'staff-fixture') {
  return 'fixture.' + Buffer.from(JSON.stringify({ role, staffKeyId: role === 'worker' || role === 'manager' ? id : undefined,
    ownerId: role === 'owner' ? 'owner-fixture' : undefined, sellerKeyId: role === 'seller' ? 'seller-fixture' : undefined,
    warehouseId: 'warehouse-fixture', name: 'Работник', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + seconds })).toString('base64url') + '.unsigned';
}
async function prepare(context, state) {
  state.calls ||= [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === site) {
      if (url.pathname === '/empty.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture</title>' });
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      assert.ok(file.startsWith(root + path.sep));
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' }[path.extname(file)];
      return route.fulfill({ path: file, contentType: mime || 'application/octet-stream' });
    }
    if (url.origin !== 'https://api.argus-ai.online') return route.abort();
    // No real network, business writes, or integration calls are allowed in this suite.
    state.calls.push({ path: url.pathname, method: req.method(), authorization: req.headers().authorization });
    if (state.offline) return route.abort('failed');
    if (url.pathname === '/api/auth/staff/login') {
      assert.equal(req.method(), 'POST');
      assert.deepEqual(req.postDataJSON(), { keyCode: key, as: 'worker' });
      if (state.loginGate) await state.loginGate;
      const role = state.loginRole || 'worker';
      return route.fulfill({ status: state.loginError ? 403 : 200, contentType: 'application/json', body: JSON.stringify(state.loginError ? { error: 'Ключ не найден. Проверьте ввод.' } : { role, token: state.loginToken || token(role) }) });
    }
    assert.equal(req.method(), 'GET', 'Unexpected business mutation');
    if (url.pathname === '/api/test-deferred') {
      state.requestStarted(); await state.requestGate;
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"old session"}' });
    }
    const headers = state.renewed ? { 'X-Argus-Token': state.renewed, 'Access-Control-Expose-Headers': 'X-Argus-Token' } : {};
    if (state.revoked) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"revoked"}' });
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: '[]' });
  });
}
async function seed(page, entries) {
  await page.goto(site + '/empty.html');
  await page.evaluate(entries => { for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value); }, entries);
}
async function enter(page) {
  await page.locator('#key').fill(key);
  await page.getByRole('button', { name: 'Войти в работу', exact: true }).click();
  await page.waitForURL('**/loader.html');
  await page.waitForFunction(() => document.querySelector('#homeSub')?.textContent === 'Работник');
}

test('worker entry persists across browser restart, renews, isolates roles, and explicitly logs out', async () => {
  const profile = fs.mkdtempSync(path.join(output, 'profile-'));
  const owner = token('owner'), seller = token('seller'), renewed = token('worker', 30 * 86400);
  let context = await browserType.launchPersistentContext(profile, { ...launchOptions, serviceWorkers: 'block' });
  const state = { renewed };
  try {
    await prepare(context, state);
    let page = context.pages()[0];
    await seed(page, { argus_auth_owner: owner, argus_auth_seller: seller });
    await page.goto(site + '/worker-login.html');
    assert.equal(await page.locator('#workerLogin').isVisible(), true);
    await enter(page);
    await page.waitForFunction(expected => localStorage.getItem('argus_auth_worker') === expected, renewed);
    assert.equal(await page.evaluate(() => typeof window.ArgusWorker), 'undefined', 'Browser must retain legacy timer behavior');
    assert.equal(await page.locator('link[rel=manifest]').getAttribute('href'), 'worker-web.webmanifest');
    const stored = await page.evaluate(() => ({ ...localStorage }));
    assert.equal(stored.argus_auth_owner, owner); assert.equal(stored.argus_auth_seller, seller);
    assert.ok(!JSON.stringify(stored).includes(key), 'Raw key must not be persisted');
    await context.close();
    state.calls = []; state.renewed = null;
    context = await browserType.launchPersistentContext(profile, { ...launchOptions, serviceWorkers: 'block' });
    await prepare(context, state); page = context.pages()[0];
    await page.goto(site + '/worker-login.html');
    await page.waitForURL('**/loader.html');
    await page.locator('#homeScreen.show').waitFor();
    assert.ok(state.calls.some(call => call.authorization === 'Bearer ' + renewed));
    assert.ok(!state.calls.some(call => call.path === '/api/auth/staff/login'));
    await page.locator('#homeScreen [onclick="logout()"]').click();
    await page.waitForURL('**/worker-login.html');
    assert.equal(await page.locator('#key').inputValue(), '');
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem('argus_auth_worker'), localStorage.getItem('argus_auth_owner'), localStorage.getItem('argus_auth_seller')]), [null, owner, seller]);
    await page.reload(); assert.equal(await page.locator('#workerLogin').isVisible(), true);
  } finally { await context.close(); }
});

test('expired/revoked worker returns to worker-only login; wrong roles and blocked storage cannot enter', async () => {
  const browser = await browserType.launch(launchOptions);
  const context = await browser.newContext({ serviceWorkers: 'block' }); const state = {};
  try {
    await prepare(context, state); const page = await context.newPage();
    await seed(page, { argus_auth_worker: token('worker', -1), argus_auth_manager: token('manager') });
    await page.goto(site + '/loader.html'); await page.waitForURL('**/worker-login.html');
    state.loginRole = 'manager'; await page.locator('#key').fill(key); await page.locator('#loginButton').click();
    await page.getByText('Нужен ключ работника склада.', { exact: false }).waitFor();
    assert.ok(page.url().endsWith('/worker-login.html'));
    state.loginRole = 'worker'; await enter(page);
    state.revoked = true; await page.evaluate(() => { apiFetch('/api/cells/rows').catch(() => {}); }); await page.waitForURL('**/worker-login.html');
    assert.equal(await page.evaluate(() => localStorage.getItem('argus_auth_worker')), null);
    assert.ok(await page.evaluate(() => localStorage.getItem('argus_auth_manager')));
    state.revoked = false;
    await page.evaluate(() => { Storage.prototype.setItem = function () { throw new DOMException('Blocked', 'SecurityError'); }; });
    await page.locator('#key').fill(key); await page.locator('#loginButton').click();
    await page.getByText('Браузер не сохранил вход.', { exact: false }).waitFor();
    assert.ok(page.url().endsWith('/worker-login.html'));
  } finally { await browser.close(); }
});

test('worker uses a newer token from another tab and an old 401 cannot erase it; alien renewal is ignored', async () => {
  const browser = await browserType.launch(launchOptions);
  const context = await browser.newContext({ serviceWorkers: 'block' }); const state = {};
  try {
    await prepare(context, state); const page = await context.newPage();
    const original = token(), renewed = token('worker', 30 * 86400);
    await seed(page, { argus_auth_worker: original });
    await page.goto(site + '/loader.html'); await page.locator('#homeScreen.show').waitFor();
    const started = new Promise(resolve => { state.requestStarted = resolve; });
    let release; state.requestGate = new Promise(resolve => { release = resolve; });
    await page.evaluate(() => { apiFetch('/api/test-deferred').catch(() => {}); });
    await started;
    const other = await context.newPage(); await seed(other, { argus_auth_worker: renewed });
    const redirected = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() && frame.url().endsWith('/worker-login.html') });
    release(); await redirected; await page.waitForURL('**/loader.html');
    await page.waitForFunction(() => document.querySelector('#homeSub')?.textContent === 'Работник');
    await page.waitForFunction(expected => localStorage.getItem('argus_auth_worker') === expected, renewed);
    await page.evaluate(() => apiFetch('/api/cells/rows'));
    assert.equal(state.calls.at(-1).authorization, 'Bearer ' + renewed);
    state.renewed = token('worker', 31 * 86400, 'other-worker');
    await page.evaluate(() => apiFetch('/api/cells/rows'));
    assert.equal(await page.evaluate(() => localStorage.getItem('argus_auth_worker')), renewed);
  } finally { await browser.close(); }
});

test('worker-only login and download controls fit 375/390/660/768/1440, including loading/error/install instructions', async () => {
  const browser = await browserType.launch(launchOptions);
  const context = await browser.newContext({ serviceWorkers: 'block' }); const state = { loginError: true };
  try {
    await prepare(context, state); const page = await context.newPage();
    for (const width of [375, 390, 659, 660, 661, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(site + '/worker-login.html');
      await page.locator('#iosInstall summary').click();
      const rects = await page.locator('main h1, main p, main label, main input, main button, main summary, main li').evaluateAll(els => els.map(el => {
        const r = el.getBoundingClientRect(); return { text: el.textContent, x: r.left, right: r.right, height: r.height, visible: !!el.getClientRects().length };
      }));
      for (const rect of rects.filter(r => r.visible)) assert.ok(rect.x >= 0 && rect.right <= width + 1 && rect.height > 0, 'Clipped: ' + rect.text);
      assert.ok((await page.locator('#loginButton').boundingBox()).height >= 48);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      let release; state.loginGate = new Promise(resolve => { release = resolve; });
      await page.locator('#key').fill(key); await page.locator('#loginButton').click();
      assert.equal(await page.locator('#loginButton').isDisabled(), true);
      assert.equal(await page.locator('#loginButton').innerText(), 'Проверяем ключ…');
      release(); await page.locator('#loginError:not([hidden])').waitFor();
      assert.match(await page.locator('#loginError').innerText(), /Ключ не найден/);
      if ([390, 768, 1440].includes(width)) await page.screenshot({ path: path.join(output, 'worker-login-' + width + '.png'), fullPage: true });
      await page.goto(site + '/worker-app.html');
      assert.equal(await page.locator('#downloadAndroid').getAttribute('href'), 'downloads/argus-worker-0.1.1.apk');
      await page.getByText('Как установить', { exact: true }).click(); await page.getByText('Добавить на экран «Домой»', { exact: true }).click();
      const buttons = await page.locator('a, summary, h1, h2').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; }));
      assert.ok(buttons.every(r => r.left >= 0 && r.right <= width + 1 && r.width > 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if ([390, 768, 1440].includes(width)) await page.screenshot({ path: path.join(output, 'worker-download-' + width + '.png'), fullPage: true });
      await page.getByRole('link', { name: 'Открыть вход грузчика', exact: true }).click();
      await page.waitForURL('**/worker-login.html');
    }
    state.offline = true; await page.locator('#key').fill(key); await page.locator('#loginButton').click();
    await page.getByText('Нет связи с сервером.', { exact: false }).waitFor();
  } finally { await browser.close(); }
});
