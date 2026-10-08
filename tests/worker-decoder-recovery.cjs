// Real jsQR and canvas video; only camera acquisition/native decoder faults are synthetic.
// No API, fixture credentials, external network, Android installation or product writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('../mobile/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(process.env.ARGUS_SCANNER_HTML || path.join(root, 'loader.html'), 'utf8');
const scanner = html.slice(html.indexOf('  let scanStream ='), html.indexOf('  // ---------- Автообновление'));
const markup = html.slice(html.indexOf('    <div class="scan-overlay"'), html.indexOf('    <!-- Главный экран:'));
const css = html.slice(html.indexOf('  .scan-open{'), html.indexOf('  /* Коды строки'));
assert.ok(scanner.includes('makeQrReader') && markup.includes('scanRetry') && css.includes('.scan-overlay'));
const jsqr = fs.readFileSync(path.join(root, 'mobile/node_modules/jsqr/dist/jsQR.js'), 'utf8');
const qrGenerator = fs.readFileSync(path.join(root, 'qrcode.min.js'), 'utf8');
const qrText = 'https://warehouse.example/loader.html#paper=12345678-1234-1234-1234-123456789abc';
const paperId = qrText.split('=')[1];
const out = path.join(root, 'test-results/worker-decoder-recovery');
fs.mkdirSync(out, { recursive: true });

async function fixture(browser, { web = false, width = 390 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const errors = [], unexpected = [], scripts = [];
  let libraryMode = 'ok';
  const held = [];
  await context.route('**/*', async route => {
    const url = route.request().url();
    if(url === 'http://127.0.0.1:19878/loader.html') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Isolated QR test</title>' });
    }
    if(url === 'http://127.0.0.1:19878/jsqr.js' || url === 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js') {
      scripts.push(url);
      if(libraryMode === 'hold') return new Promise(resolve => held.push({ route, resolve }));
      if(libraryMode === 'fail') return route.abort('failed');
      return route.fulfill({ contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: jsqr });
    }
    unexpected.push(url); return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:19878/loader.html');
  await page.setContent(`<style>:root{--text:#f1f0ea;--muted:#c3c5c7;--accent:#bcd4ad;--accent-2:#88c9bd;--line:#535b61;--panel:#1c2024;--sans:Arial,sans-serif}*{box-sizing:border-box}body{margin:0;background:#111315;color:#f1f0ea;font:16px Arial}${css}</style><button id="open">Сканировать</button>${markup}`);
  await page.addScriptTag({ content: qrGenerator });
  await page.evaluate(({ qrText, web }) => {
    window.testState = { nativeCalls: 0, papers: [], streams: [], decoderFault: false, blank: false };
    const qr = qrcode(0, 'M'); qr.addData(qrText); qr.make();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 640;
    const ctx = canvas.getContext('2d'), n = qr.getModuleCount(), size = Math.floor(440 / n);
    const draw = () => {
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 640, 640);
      if(testState.blank) return;
      ctx.fillStyle = 'black';
      for(let y = 0; y < n; y++) for(let x = 0; x < n; x++) if(qr.isDark(y, x)) ctx.fillRect(100 + x * size, 100 + y * size, size, size);
    };
    draw(); window.drawTimer = setInterval(draw, 80);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => { const stream = canvas.captureStream(12); testState.streams.push(stream); return stream; }
    } });
    delete window.BarcodeDetector;
    window.refreshWork = async () => {};
    window.openPaper = id => testState.papers.push(id);
    if(!web) window.ArgusWorker = { handleQr: () => false, cancelScan: () => {} };
  }, { qrText, web });
  await page.addScriptTag({ content: scanner });
  await page.evaluate(() => document.getElementById('open').onclick = () => openScanner());
  return {
    page, scripts, errors, unexpected,
    library(mode) { libraryMode = mode; },
    async releaseLibraries() {
      for(const item of held.splice(0)) {
        await item.route.fulfill({ contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: jsqr }); item.resolve();
      }
    },
    async close() {
      for(const item of held.splice(0)) { await item.route.abort(); item.resolve(); }
      await context.close(); assert.deepEqual(unexpected, [], 'External request escaped fixture allowlist'); assert.deepEqual(errors, [], 'Unhandled page errors');
    }
  };
}
async function state(page) {
  return page.evaluate(() => ({ hidden: scanOverlay.hidden, retry: !scanRetry.hidden,
    status: document.getElementById('scanStatus').textContent, ready: scanView.dataset.ready,
    nativeCalls: testState.nativeCalls, papers: [...testState.papers],
    tracks: testState.streams.flatMap(stream => stream.getTracks().map(track => track.readyState)) }));
}
async function decoded(page) {
  await page.waitForFunction(() => testState.papers.length === 1);
  const result = await state(page);
  assert.deepEqual(result.papers, [paperId]); assert.equal(result.hidden, true);
  assert.ok(result.tracks.every(track => track === 'ended'), 'Decoded QR must release camera');
  return result;
}
async function nativeFailure(page, transient = false) {
  await page.evaluate(transient => {
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ['qr_code']; }
      async detect() {
        testState.nativeCalls++;
        if(transient && testState.nativeCalls > 1) return [];
        throw new DOMException('Injected native decoder failure', 'NotSupportedError');
      }
    };
  }, transient);
}
const results = [];
async function check(browser, name, run, options) {
  const f = await fixture(browser, options);
  try { await run(f); results.push({ name, result: 'PASS' }); console.log('PASS', name); }
  catch(error) { results.push({ name, result: 'FAIL', error: error.message, state: await state(f.page) }); console.error('FAIL', name, error.message); }
  finally { await f.close(); }
}
(async () => {
  const browser = await chromium.launch({ channel: process.env.ARGUS_BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    await check(browser, 'Bundled jsQR decodes a real QR video frame', async ({ page, scripts }) => {
      await page.click('#open'); await decoded(page); assert.deepEqual(scripts, ['http://127.0.0.1:19878/jsqr.js']);
    });
    await check(browser, 'Working native decoder requires no fallback download', async ({ page, scripts }) => {
      await page.evaluate(qrText => { window.BarcodeDetector = class {
        static async getSupportedFormats() { return ['qr_code']; }
        async detect() { testState.nativeCalls++; return [{ rawValue: qrText }]; }
      }; }, qrText);
      await page.click('#open'); await decoded(page); assert.equal(scripts.length, 0);
    });
    for(const transient of [false, true]) await check(browser, `${transient ? 'Transient' : 'Persistent'} native failure switches to real jsQR`, async ({ page, scripts }) => {
      await nativeFailure(page, transient); await page.click('#open'); const result = await decoded(page);
      assert.equal(result.nativeCalls, 1); assert.equal(scripts.length, 1);
    });
    await check(browser, 'Blank frame remains ordinary search, then actual QR succeeds', async ({ page }) => {
      await page.evaluate(() => testState.blank = true); await page.click('#open');
      await page.waitForFunction(() => document.getElementById('scanStatus').textContent === 'Ищу QR…');
      await page.waitForTimeout(550); assert.equal((await state(page)).retry, false);
      await page.evaluate(() => testState.blank = false); await decoded(page);
    });
    for(const width of [390, 768, 1440]) await check(browser, `Both decoders fail visibly; retry recovers, ${width}px`, async ({ page }) => {
      await page.addScriptTag({ content: jsqr });
      await page.evaluate(() => { window.realJsQr = jsQR; window.jsQR = () => { throw new Error('Injected jsQR failure'); }; });
      await nativeFailure(page); await page.click('#open'); await page.locator('#scanRetry:visible').waitFor();
      const failed = await state(page); assert.match(failed.status, /Не удалось распознать QR.*Повторить/);
      assert.ok(failed.tracks.every(track => track === 'ended')); assert.equal(failed.ready, 'false');
      const layout = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth,
        buttons: [...document.querySelectorAll('#scanOverlay button')].map(el => { const r = el.getBoundingClientRect(); return { right: r.right, bottom: r.bottom, height: r.height }; }) }));
      assert.ok(layout.overflow <= width);
      assert.ok(layout.buttons.every(r => r.right <= width && r.bottom <= 844 && r.height >= 44));
      await page.screenshot({ path: path.join(out, `decoder-error-${width}.png`) });
      await page.evaluate(() => window.jsQR = realJsQr); await page.click('#scanRetry'); await decoded(page);
    }, { width });
    await check(browser, 'Web fallback network error stops camera; retry fetches real SRI-checked jsQR', async f => {
      f.library('fail'); await nativeFailure(f.page); await f.page.click('#open'); await f.page.locator('#scanRetry:visible').waitFor();
      const failed = await state(f.page); assert.match(failed.status, /Проверьте интернет.*Повторить/);
      assert.ok(failed.tracks.every(track => track === 'ended'));
      f.library('ok'); await f.page.click('#scanRetry'); await decoded(f.page);
      assert.deepEqual(f.scripts, Array(2).fill('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'));
    }, { web: true });
    await check(browser, 'Stalled web decoder download has a bounded error and retry', async f => {
      f.library('hold'); await f.page.click('#open');
      await f.page.locator('#scanRetry:visible').waitFor({ timeout: 14000 });
      const failed = await state(f.page); assert.match(failed.status, /Не загрузился распознаватель QR.*Повторить/);
      assert.ok(failed.tracks.every(track => track === 'ended'));
      f.library('ok'); await f.releaseLibraries(); await f.page.click('#scanRetry'); await decoded(f.page);
    }, { web: true });
    await check(browser, 'Late library load after Close cannot reopen or change status', async f => {
      f.library('hold'); await f.page.click('#open');
      await f.page.waitForFunction(() => document.getElementById('scanStatus').textContent === 'Готовлю распознавание QR…');
      await f.page.click('.scan-close'); const before = await state(f.page);
      await f.releaseLibraries(); await f.page.waitForTimeout(350); assert.deepEqual(await state(f.page), before);
    }, { web: true });
    for(const outcome of ['resolve', 'reject']) await check(browser, `Late native ${outcome} cannot affect a new scanner`, async ({ page }) => {
      await page.evaluate(() => { window.BarcodeDetector = class {
        static async getSupportedFormats() { return ['qr_code']; }
        detect() { testState.nativeCalls++; return new Promise((resolve, reject) => { window.oldResolve = resolve; window.oldReject = reject; }); }
      }; });
      await page.click('#open'); await page.waitForFunction(() => testState.nativeCalls === 1);
      await page.click('.scan-close');
      await page.evaluate(() => { delete window.BarcodeDetector; testState.blank = true; });
      await page.click('#open'); await page.waitForFunction(() => document.getElementById('scanStatus').textContent === 'Ищу QR…');
      await page.evaluate(({ outcome, qrText }) => outcome === 'resolve' ? oldResolve([{ rawValue: qrText }]) : oldReject(new Error('Late old failure')), { outcome, qrText });
      await page.waitForTimeout(350); const current = await state(page);
      assert.equal(current.hidden, false); assert.equal(current.retry, false); assert.equal(current.status, 'Ищу QR…'); assert.deepEqual(current.papers, []);
      assert.deepEqual(current.tracks, ['ended', 'live']);
      await page.evaluate(() => testState.blank = false); await decoded(page);
    });
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`${results.filter(r => r.result === 'PASS').length}/${results.length} passed`);
  if(results.some(r => r.result === 'FAIL')) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
