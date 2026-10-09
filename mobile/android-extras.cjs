// Actual emulator viewport, printing and login checks; requires the synthetic stand account.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { chromium } = require('@playwright/test');
const run = promisify(execFile), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const adbPath = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const adb = async (...args) => (await run(adbPath, ['-s', 'emulator-5554', ...args], { windowsHide: true, timeout: 15000 })).stdout;
const output = path.resolve(__dirname, '../test-results');
const capture = async name => {
  const { stdout } = await run(adbPath, ['-s', 'emulator-5554', 'exec-out', 'screencap', '-p'], { windowsHide: true, encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 });
  fs.writeFileSync(path.join(output, name), stdout);
};
(async () => {
  const fixture = JSON.parse(fs.readFileSync(process.env.ARGUS_WORKER_FIXTURE_PATH, 'utf8'));
  assert.equal(fixture.synthetic, true);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
  const page = browser.contexts()[0].pages()[0], report = { checks: [], errors: [] };
  page.on('pageerror', error => report.errors.push(error.message));
  await page.addInitScript(() => {
    window.__argusExtrasReady = false;
    addEventListener('argus:worker-ready', () => { window.__argusExtrasReady = true; });
  });
  const home = async () => {
    await page.locator('#workerStatus').waitFor();
    await page.waitForFunction(() => window.__argusExtrasReady !== false);
    if (await page.locator('#sheetOverlay.show').isVisible()) await page.locator('#sheetOverlay').click({ position: { x: 3, y: 3 } });
    if (await page.locator('#invoiceSwitch').isVisible()) await page.locator('#invoiceSwitch').click();
    await page.locator('#homeBody').getByText('Приёмка товара', { exact: true }).waitFor();
  };
  try {
    assert.deepEqual(await page.evaluate(() => ({ native: ARGUS_WORKER_CONFIG.native, api: ARGUS_WORKER_CONFIG.apiBase })), { native: true, api: 'http://10.0.2.2:3110' });
    assert.equal(await page.evaluate(() => ArgusAuth.payload(ArgusAuth.get(['worker']).token).warehouseId), fixture.warehouseId);
    if (await page.locator('#cells').count()) await page.getByRole('link', { name: '← К работе', exact: true }).click();
    await home();
    await page.evaluate(() => scrollTo(0, 0));
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      status: document.querySelectorAll('#workerStatus').length, phone: document.querySelectorAll('.phone').length, home: document.querySelectorAll('#homeScreen').length }));
    assert.ok(layout.scrollWidth <= layout.width + 1); assert.equal(layout.status, 1); assert.equal(layout.phone, 1); assert.equal(layout.home, 1);
    await capture('android-home-viewport.png'); report.checks.push({ name: 'single_home_no_horizontal_overflow', ...layout });
    await page.getByRole('link', { name: 'QR ячеек', exact: true }).click();
    await page.locator('#cells input[type=checkbox]').first().waitFor();
    await page.locator('#cells input[type=checkbox]').first().check();
    await page.locator('#prepare').click();
    await page.locator('#labels img').waitFor();
    await page.locator('#print').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await capture('android-labels-viewport.png');
    await page.locator('#print').click(); await sleep(5000);
    assert.match(await adb('shell', 'dumpsys', 'activity', 'activities'), /com\.android\.printspooler/);
    await capture('android-native-print.png'); report.checks.push({ name: 'native_print_dialog', opened: true, physicallyPrinted: false });
    await adb('shell', 'input', 'keyevent', '4'); await sleep(500);
    await page.getByRole('link', { name: '← К работе', exact: true }).click();
    await home();
    await sleep(1000);
    const logout = page.locator('.job-logout:visible, .task-logout:visible').first();
    if (await logout.isVisible()) await logout.click();
    else {
      await page.locator('.worker-chip').click();
      await page.locator('.worker-menu-item').filter({ hasText: 'Выйти' }).click();
    }
    await page.waitForURL('**/login.html');
    await page.locator('#key').click(); await sleep(700);
    await capture('android-login-keyboard.png');
    const login = await page.evaluate(() => {
      const key = document.querySelector('#key').getBoundingClientRect(), button = document.querySelector('#loginButton').getBoundingClientRect();
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, viewportHeight: visualViewport.height, inputBottom: key.bottom, buttonBottom: button.bottom };
    });
    assert.ok(login.scrollWidth <= login.width + 1); assert.ok(login.inputBottom <= login.viewportHeight + 1);
    report.checks.push({ name: 'login_keyboard_input_visible', ...login });
    await adb('shell', 'input', 'keyevent', '4');
    await adb('shell', 'input', 'keyevent', '223'); await sleep(5000);
    assert.equal(/ServiceRecord\{[^\n]*WorkerPauseService/.test(await adb('shell', 'dumpsys', 'activity', 'services', 'online.argus.worker.debug')), false);
    await adb('shell', 'input', 'keyevent', '224'); await adb('shell', 'wm', 'dismiss-keyguard');
    report.checks.push({ name: 'login_does_not_start_service', passed: true });
    await page.locator('#key').fill(fixture.keyCode); await page.locator('#loginButton').click();
    await page.waitForURL('**/loader.html'); await page.locator('#workerStatus').waitFor();
    assert.deepEqual(report.errors, []);
    fs.writeFileSync(path.join(output, 'android-native-extras.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, ...report }));
  } finally {
    await adb('shell', 'input', 'keyevent', '224').catch(() => {});
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
