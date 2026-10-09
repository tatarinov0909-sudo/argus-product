// Real Android lifecycle checks. Run only after installing the current debug APK.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { chromium } = require('@playwright/test');
const run = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const packageName = 'online.argus.worker.debug';
const serial = 'emulator-5554';
const adbPath = process.env.ARGUS_ADB || path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const adb = async (...args) => (await run(adbPath, ['-s', serial, ...args], { windowsHide: true, timeout: 15000 })).stdout;
const serviceRunning = async () => /ServiceRecord\{[^\n]*WorkerPauseService/.test(await adb('shell', 'dumpsys', 'activity', 'services', packageName));

(async () => {
  const fixturePath = process.env.ARGUS_WORKER_FIXTURE_PATH;
  if (!fixturePath) throw new Error('ARGUS_WORKER_FIXTURE_PATH must point to the disposable local fixture.');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(fixture.synthetic, true, 'Only a synthetic fixture is permitted.');
  assert.match(fixture.invoice.id, /^[0-9a-f-]{36}$/i);
  const base = new URL(fixture.baseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname) && base.port === '3110', 'Only the local API stand is permitted.');
  const devices = await adb('get-state');
  assert.equal(devices.trim(), 'device', 'Debug emulator must be connected.');
  const browser = await chromium.connectOverCDP(process.env.ARGUS_ANDROID_CDP || 'http://127.0.0.1:9224');
  const report = { package: packageName, checks: [], pageErrors: [] };
  let page, token;
  try {
    page = browser.contexts()[0].pages()[0];
    assert.ok(page, 'Debug WebView is missing.');
    page.on('pageerror', error => report.pageErrors.push(error.message));
    const config = await page.evaluate(() => window.ARGUS_WORKER_CONFIG);
    assert.equal(config.native, true);
    assert.ok(['http://10.0.2.2:3110', 'http://127.0.0.1:3110'].includes(config.apiBase));
    report.apiBase = config.apiBase;
    if (!(await page.locator('#workerLogin').count())) {
      // Installation may restore a draft asynchronously; do not navigate away mid-restore.
      await page.addInitScript(() => {
        window.__argusLifecycleRestored = false;
        window.addEventListener('argus:worker-ready', () => { window.__argusLifecycleRestored = true; });
      });
      await page.reload();
      await page.waitForFunction(() => window.__argusLifecycleRestored === true);
      await page.locator('#workerStatus').waitFor();
      if (await page.locator('#sheetOverlay.show').isVisible()) await page.locator('#sheetOverlay').click({ position: { x: 3, y: 3 } });
      if (await page.locator('#invoiceSwitch').isVisible()) await page.locator('#invoiceSwitch').click();
    }
    if (!(await page.locator('#workerLogin').count())) {
      const currentWarehouse = await page.evaluate(() => window.ArgusAuth.payload(window.ArgusAuth.get(['worker']).token).warehouseId);
      assert.equal(currentWarehouse, fixture.warehouseId, 'Refusing to switch a non-fixture account.');
      const logout = page.locator('.job-logout:visible, .task-logout:visible').first();
      if (await logout.isVisible()) await logout.click();
      else {
        await page.locator('.worker-chip').click();
        await page.locator('.worker-menu-item').filter({ hasText: 'Выйти' }).click();
      }
      await page.waitForURL('**/login.html');
    }
    if (await page.locator('#workerLogin').count()) {
      await page.locator('#key').fill(fixture.keyCode);
      await page.locator('#loginButton').click();
      await page.waitForURL('**/loader.html', { timeout: 15000 });
    }
    await page.locator('#workerStatus').waitFor();
    const session = await page.evaluate(() => {
      const auth = window.ArgusAuth.get(['worker']);
      return { token: auth.token, warehouseId: window.ArgusAuth.payload(auth.token).warehouseId };
    });
    assert.equal(session.warehouseId, fixture.warehouseId, 'WebView is not signed into the synthetic warehouse.');
    token = session.token; // Never print fixture credentials or tokens.
    const readSession = async () => {
      const response = await fetch(base.origin + '/api/receiving/session/' + fixture.invoice.id, {
        headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000)
      });
      assert.equal(response.status, 200, 'Cannot read synthetic receiving session.');
      const data = await response.json();
      return data.assembly || {};
    };
    const awaitStatus = async (status, timeout = 15000) => {
      const deadline = Date.now() + timeout;
      let session;
      do { session = await readSession(); if (session.status === status) return session; await sleep(250); } while (Date.now() < deadline);
      throw new Error('Expected server status ' + status + ', got ' + session.status);
    };
    const closeSheet = async () => {
      if (await page.locator('#sheetOverlay.show').isVisible()) {
        await page.locator('#sheetOverlay').click({ position: { x: 3, y: 3 } });
      }
    };
    const continueWork = async () => {
      await closeSheet();
      if ((await readSession()).status === 'paused' && await page.locator('#invoiceSwitch').isVisible()) {
        await page.locator('#pauseResumeBtn').waitFor();
      }
      if (await page.locator('#pauseResumeBtn').isVisible()) await page.locator('#pauseResumeBtn').click();
      else if (await page.locator('#receiptBody .asm-actions button').first().isVisible()) await page.locator('#receiptBody .asm-actions button').first().click();
      await awaitStatus('active');
      await closeSheet();
    };
    // Start from the app's visible navigation, preserving any existing synthetic session.
    await page.addInitScript(() => {
      window.__argusLifecycleRestored = false;
      window.addEventListener('argus:worker-ready', () => { window.__argusLifecycleRestored = true; });
    });
    await page.reload();
    await page.locator('#workerStatus').waitFor();
    await page.waitForFunction(() => window.__argusLifecycleRestored === true);
    await closeSheet();
    if (await page.locator('#invoiceSwitch').isVisible()) await page.locator('#invoiceSwitch').click();
    await page.locator('#homeBody').getByText('Приёмка товара', { exact: true }).click();
    await page.locator('.recv-row').filter({ hasText: fixture.invoice.number }).click();
    const start = page.getByRole('button', { name: /Начать приёмку/ });
    if (await start.isVisible()) {
      await start.click(); await page.locator('#startGoBtn').click();
    } else {
      await page.locator('#receiptBody .asm-actions button').first().click();
    }
    let active = await awaitStatus('active');
    await closeSheet();
    await page.evaluate(() => {
      window.__argusLifecycleTrace = [];
      const original = window.ArgusWorker.lifecycle;
      window.ArgusWorker.lifecycle = async event => {
        window.__argusLifecycleTrace.push({ receivedAt: Date.now(), event });
        const result = await original(event);
        window.__argusLifecycleTrace.push({ completedAt: Date.now(), id: event.id, ack: result?.ack });
        return result;
      };
      const fetchOriginal = window.fetch;
      window.fetch = async (...args) => {
        if (String(args[0]).includes('/api/journal/pause')) window.__argusLifecycleTrace.push({ fetchStartedAt: Date.now() });
        const result = await fetchOriginal(...args);
        if (String(args[0]).includes('/api/journal/pause')) window.__argusLifecycleTrace.push({ fetchCompletedAt: Date.now(), status: result.status });
        return result;
      };
      if (navigator.locks) {
        const lockOriginal = navigator.locks.request.bind(navigator.locks);
        navigator.locks.request = (...args) => {
          const callback = args.pop();
          window.__argusLifecycleTrace.push({ lockRequestedAt: Date.now() });
          return lockOriginal(...args, lock => { window.__argusLifecycleTrace.push({ lockGrantedAt: Date.now() }); return callback(lock); });
        };
      }
      const http = window.Capacitor.Plugins.CapacitorHttp;
      const nativeRequest = http.request;
      http.request = async options => {
        const track = String(options.url).includes('/api/journal/pause');
        if (track) window.__argusLifecycleTrace.push({ nativeHttpStartedAt: Date.now() });
        try {
          const result = await nativeRequest(options);
          if (track) window.__argusLifecycleTrace.push({ nativeHttpCompletedAt: Date.now(), status: result.status });
          return result;
        } catch (error) {
          if (track) window.__argusLifecycleTrace.push({ nativeHttpFailedAt: Date.now(), error: error.message });
          throw error;
        }
      };
    });
    report.checks.push({ name: 'receiving_started_through_ui', status: active.status });
    const beforeShort = Number(active.eventSequence || 0);
    await adb('shell', 'input', 'keyevent', '223');
    await sleep(5000);
    assert.equal(await serviceRunning(), true, 'Active work needs a short foreground service during screen-off grace');
    await adb('shell', 'input', 'keyevent', '224');
    await adb('shell', 'wm', 'dismiss-keyguard');
    await sleep(1800);
    active = await readSession();
    assert.equal(active.status, 'active', 'A five-second screen lock must not pause work.');
    assert.equal(Number(active.eventSequence || 0), beforeShort, 'Short lock wrote an unexpected server event.');
    assert.equal(await serviceRunning(), false, 'Short foreground service must stop after quick resume');
    report.checks.push({ name: 'screen_off_5s', status: active.status, eventSequenceUnchanged: true });
    if (process.env.ARGUS_PUBLIC_HEALTH_CHECK === '1') {
      await page.evaluate(() => {
        window.__argusPublicHealth = null;
        setTimeout(async () => {
          const startedAt = Date.now();
          try {
            const result = await Capacitor.Plugins.CapacitorHttp.request({ url: 'https://api.argus-ai.online/health', method: 'GET',
              disableRedirects: true, connectTimeout: 5000, readTimeout: 5000 });
            window.__argusPublicHealth = { status: result.status, startedAt, completedAt: Date.now() };
          } catch (error) { window.__argusPublicHealth = { error: error.message, startedAt, completedAt: Date.now() }; }
        }, 12000);
      });
    }
    const powerOffStart = Date.now();
    await adb('shell', 'input', 'keyevent', '223');
    const powerOffEnd = Date.now();
    await sleep(16000);
    const whileScreenOff = await awaitStatus('paused', 4000);
    report.checks.push({ name: 'server_while_screen_off_before_wakeup', status: whileScreenOff.status, observedAfterMs: Date.now() - powerOffStart });
    if (process.env.ARGUS_PUBLIC_HEALTH_CHECK === '1') {
      const health = await page.evaluate(() => window.__argusPublicHealth);
      assert.equal(health?.status, 200, 'Public HTTPS health must work while the screen is still off');
      report.checks.push({ name: 'public_https_health_while_screen_off', ...health });
    }
    await sleep(500);
    assert.equal(await serviceRunning(), false, 'Foreground service must stop after pause delivery is acknowledged');
    await adb('shell', 'input', 'keyevent', '224');
    await adb('shell', 'wm', 'dismiss-keyguard');
    const paused = await awaitStatus('paused');
    const pausedAt = new Date(paused.pausedAt).getTime();
    assert.ok(pausedAt >= powerOffStart + 13000 && pausedAt <= powerOffEnd + 17000,
      'Pause timestamp must reflect screen-off plus 15 seconds, not delayed WebView execution.');
    assert.ok(Number(paused.eventSequence || 0) > beforeShort, 'Long screen lock did not add a server lifecycle event.');
    await page.locator('#pauseBanner.show').waitFor();
    report.checks.push({ name: 'screen_off_deadline', status: paused.status, pausedAt: paused.pausedAt, deadlineDeltaMs: pausedAt - powerOffStart - 15000 });
    await continueWork();
    const beforeHome = Date.now();
    await adb('shell', 'input', 'keyevent', '3');
    await sleep(3000);
    const whileBackground = await readSession();
    report.checks.push({ name: 'server_while_home_3s', status: whileBackground.status });
    assert.equal(whileBackground.status, 'paused', 'Online Home departure must reach the server before returning.');
    await adb('shell', 'am', 'start', '-n', packageName + '/online.argus.worker.MainActivity');
    const homePaused = await awaitStatus('paused');
    assert.ok(new Date(homePaused.pausedAt).getTime() >= beforeHome - 2000 && new Date(homePaused.pausedAt).getTime() <= beforeHome + 4000,
      'Home departure must be paused at the actual departure time.');
    report.checks.push({ name: 'home_and_return', status: homePaused.status });
    await continueWork();
    await page.getByRole('button', { name: 'Сохранённые действия', exact: true }).click();
    await page.locator('#workerQueue[open]').waitFor();
    await adb('shell', 'input', 'keyevent', '4');
    await page.waitForFunction(() => !document.querySelector('#workerQueue[open]'));
    const native = await page.evaluate(() => window.Capacitor.Plugins.WorkerDevice.getLifecycle());
    assert.equal(native.state, 'active', 'Back should close the dialog instead of leaving the app.');
    assert.equal((await readSession()).status, 'active');
    report.checks.push({ name: 'system_back_closes_dialog', status: 'active' });
    await adb('shell', 'input', 'keyevent', '4');
    await page.locator('#homeBody').getByText('Приёмка товара', { exact: true }).waitFor();
    await awaitStatus('paused');
    report.checks.push({ name: 'system_back_returns_to_home', status: 'paused' });
    assert.deepEqual(report.pageErrors, []);
    const output = path.resolve(__dirname, '../test-results');
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'android-lifecycle.png'), fullPage: true });
    fs.writeFileSync(path.join(output, 'android-lifecycle.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, ...report }));
  } catch (error) {
    report.lifecycleTrace = await page.evaluate(() => window.__argusLifecycleTrace || []).catch(() => []);
    console.error(JSON.stringify({ passed: false, error: error.message, ...report }));
    throw error;
  } finally {
    token = undefined;
    await adb('shell', 'input', 'keyevent', '224').catch(() => {});
    await adb('shell', 'wm', 'dismiss-keyguard').catch(() => {});
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
