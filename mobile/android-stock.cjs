// Real native transport/offline checks; only the disposable emulator and synthetic stand.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { chromium } = require('@playwright/test');
const run = promisify(execFile), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const adbPath = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const adb = async (...args) => (await run(adbPath, ['-s', 'emulator-5554', ...args], { windowsHide: true, timeout: 15000 })).stdout;
const until = async (check, timeout = 15000) => {
  const end = Date.now() + timeout;
  do { const value = await check(); if (value) return value; await sleep(200); } while (Date.now() < end);
  throw new Error('Timed out waiting for native stock verification');
};
(async () => {
  assert.ok(process.env.ARGUS_WORKER_FIXTURE_PATH, 'Synthetic fixture path required');
  const fixture = JSON.parse(fs.readFileSync(process.env.ARGUS_WORKER_FIXTURE_PATH));
  assert.equal(fixture.synthetic, true);
  const base = new URL(fixture.baseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname) && base.port === '3110');
  const browser = await chromium.connectOverCDP(process.env.ARGUS_ANDROID_CDP || 'http://127.0.0.1:9224');
  const page = browser.contexts()[0].pages()[0], errors = [], checks = [];
  let networkChanged = false;
  let reverseRequired = false;
  const wifi = (await adb('shell', 'settings', 'get', 'global', 'wifi_on')).trim() !== '0';
  const data = (await adb('shell', 'settings', 'get', 'global', 'mobile_data')).trim() !== '0';
  async function restoreNetwork() {
    if (!networkChanged) return;
    if (reverseRequired) await adb('reverse', 'tcp:3110', 'tcp:3110');
    await adb('shell', 'svc', 'wifi', wifi ? 'enable' : 'disable');
    await adb('shell', 'svc', 'data', data ? 'enable' : 'disable');
    networkChanged = false;
  }
  try {
    page.on('pageerror', e => errors.push(e.message));
    assert.equal(await page.evaluate(() => ARGUS_WORKER_CONFIG.native && ['http://10.0.2.2:3110', 'http://127.0.0.1:3110'].includes(ARGUS_WORKER_CONFIG.apiBase)), true);
    reverseRequired = await page.evaluate(() => ARGUS_WORKER_CONFIG.apiBase === 'http://127.0.0.1:3110');
    const auth = await page.evaluate(() => {
      const token = ArgusAuth.get(['worker']).token;
      return { token, warehouse: ArgusAuth.payload(token).warehouseId };
    });
    assert.equal(auth.warehouse, fixture.warehouseId);
    const read = async route => {
      const response = await fetch(base.origin + route, { headers: { Authorization: 'Bearer ' + auth.token }, signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200); return response.json();
    };
    const closeSheet = async () => {
      if (await page.locator('#sheetOverlay.show').isVisible()) await page.locator('#sheetOverlay').click({ position: { x: 3, y: 3 } });
    };
    await closeSheet();
    if (await page.locator('#invoiceSwitch').isVisible()) await page.locator('#invoiceSwitch').click();
    await page.locator('#homeBody').getByText('Приёмка товара', { exact: true }).click();
    await page.locator('.recv-row').filter({ hasText: fixture.invoice.number }).click();
    await page.locator('#receiptBody .asm-actions button').first().click();
    if (await page.locator('#startGoBtn').isVisible()) await page.locator('#startGoBtn').click();
    await until(async () => (await read('/api/receiving/session/' + fixture.invoice.id)).assembly.status === 'active');
    await closeSheet();
    const largerItem = await page.evaluate(() => currentInvoice.items
      .map(item => ({ name: item.name, qty: recvLeft(item) === null ? Number(item.declared_qty) : recvLeft(item) }))
      .sort((a, b) => b.qty - a.qty)[0]);
    await page.locator('#runAllBtn').click();
    await page.locator('#sheetOverlay').getByText(largerItem.name, { exact: true }).click();
    await closeSheet();
    const target = await page.evaluate(() => {
      const item = currentInvoice.items[currentItemIndex];
      return { id: item.id, qty: recvLeft(item) === null ? Number(item.declared_qty) : recvLeft(item), received: recvLeft(item) !== null };
    });
    assert.ok(target.qty >= 3, 'Fixture needs at least three unplaced units');
    const placed = async () => {
      const invoice = await read('/api/invoices/' + fixture.invoice.id);
      return (invoice.items.find(x => x.id === target.id).placements || []).reduce((n, p) => n + Number(p.qty || 0), 0);
    };
    const prepare = async index => {
      await page.locator('#workerScanInput').fill(fixture.cells[index].qr);
      await page.locator('#workerScanInput').press('Enter');
      await page.locator('#placeQty').fill('1');
      await page.locator('#placeQty').dispatchEvent('input');
    };
    const baseline = await placed();
    await prepare(0);
    await page.locator('#confirmBtn').click();
    await until(async () => await placed() === baseline + 1);
    await page.waitForFunction(() => !document.querySelector('#confirmBtn').textContent.includes('Сохраняю'));
    checks.push({ name: 'native_http_partial_placement', increment: 1 });
    await prepare(1);
    networkChanged = true;
    if (reverseRequired) await adb('reverse', '--remove', 'tcp:3110');
    if (reverseRequired) await page.evaluate(async () => {
      // Removing adb reverse leaves pooled TCP sessions alive; close them before simulating loss.
      for (let i = 0; i < 10; i++) {
        try { await Capacitor.Plugins.CapacitorHttp.request({ url: ARGUS_WORKER_CONFIG.apiBase + '/health', method: 'GET',
          headers: { Connection: 'close' }, connectTimeout: 1000, readTimeout: 1000 }); }
        catch (_) { break; }
      }
    });
    await adb('shell', 'svc', 'wifi', 'disable');
    await adb('shell', 'svc', 'data', 'disable');
    // Android may keep navigator.onLine=true for its virtual interface after the route is lost.
    assert.equal(await page.evaluate(async () => {
      try { await ArgusWorker.request('/api/worker/capabilities'); return false; }
      catch (_) { return true; }
    }), true, 'The actual API route must be unreachable before the offline action');
    const offlineAt = await page.evaluate(() => Date.now());
    await page.locator('#confirmBtn').click();
    const pendingId = await until(async () => page.evaluate(async cutoff => {
      const command = (await ArgusWorker.inspect()).find(x => x.createdAt >= cutoff && x.path.endsWith('/place') && x.status === 'queued');
      return command?.id;
    }, offlineAt));
    assert.equal(await placed(), baseline + 1, 'Offline placement must not claim server success');
    checks.push({ name: 'offline_placement_durable', status: 'queued', serverUnchanged: true });
    await restoreNetwork();
    await page.waitForFunction(() => navigator.onLine);
    await page.getByRole('button', { name: 'Сохранённые действия', exact: true }).click();
    await page.getByRole('button', { name: 'Проверить связь и отправить', exact: true }).click();
    await until(async () => page.evaluate(async id => (await ArgusWorker.inspect()).some(x => x.id === id && x.status === 'confirmed'), pendingId), 25000);
    assert.equal(await placed(), baseline + 2);
    await page.evaluate(() => Promise.all([ArgusWorker.sync(), ArgusWorker.sync()]));
    assert.equal(await placed(), baseline + 2, 'Replay must not duplicate stock placement');
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    checks.push({ name: 'offline_replay_idempotent', totalIncrement: 2, sameCommandConfirmed: true });
    await page.locator('#invoiceSwitch').click();
    await until(async () => (await read('/api/receiving/session/' + fixture.invoice.id)).assembly.status === 'paused');
    assert.deepEqual(errors, []);
    fs.mkdirSync(path.resolve(__dirname, '../test-results'), { recursive: true });
    fs.writeFileSync(path.resolve(__dirname, '../test-results/android-stock.json'), JSON.stringify({ passed: true, checks, errors }, null, 2));
    console.log(JSON.stringify({ passed: true, checks, errors }));
  } catch (error) {
    console.error(JSON.stringify({ passed: false, error: error.message, checks, errors }));
    throw error;
  } finally { await restoreNetwork(); await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
