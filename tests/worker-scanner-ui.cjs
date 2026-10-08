const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('../mobile/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'loader.html'), 'utf8');
const script = source.slice(source.indexOf('  let scanStream ='), source.indexOf('  // ---------- Автообновление'));
const markup = source.slice(source.indexOf('    <div class="scan-overlay"'), source.indexOf('    <!-- Главный экран:'));
const css = source.slice(source.indexOf('  .scan-open{'), source.indexOf('  /* Коды строки'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function setup(browser, width = 390, height = 844) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('http://scanner.test/**', route => route.fulfill({contentType:'text/html',body:'<!doctype html><title>Scanner fixture</title>'}));
  await page.goto('http://scanner.test/loader.html');
  await page.setContent(`<style>:root{--text:#f1f0ea;--muted:#c3c5c7;--accent:#bcd4ad;--accent-2:#88c9bd;--line:#535b61;--panel:#1c2024;--sans:Arial,sans-serif}*{box-sizing:border-box}body{margin:0;font:16px Arial,sans-serif}${css}</style>${markup}`);
  await page.evaluate(() => {
    window.__media = { mode: 'allow', requests: [], tracks: [], reads: 0, nextQr: null, papers: [], cells: [], cancels: 0 };
    window.__media.resolve = (index, kind = 'allow') => {
      const request = __media.requests[index];
      if (kind === 'deny') { request.reject(new DOMException('denied', 'NotAllowedError')); return; }
      const track = new EventTarget(); track.stopped = false; track.stop = () => { track.stopped = true; };
      const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
      __media.tracks.push(track); request.resolve(stream);
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise((resolve, reject) => {
      const i = __media.requests.push({ resolve, reject }) - 1;
      if (__media.mode !== 'pending') __media.resolve(i, __media.mode);
    }) } });
    const video = document.querySelector('video');
    Object.defineProperty(video, 'srcObject', { configurable: true, writable: true, value: null });
    Object.defineProperty(video, 'readyState', { configurable: true, get: () => video.srcObject && __media.mode !== 'noframes' ? 4 : 0 });
    Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => video.readyState ? 640 : 0 });
    video.play = () => __media.mode === 'play-reject' ? Promise.reject(new DOMException('blocked', 'NotAllowedError')) : Promise.resolve();
    video.pause = () => {};
    video.requestVideoFrameCallback = callback => __media.mode === 'noframes' ? 0 : setTimeout(callback, 20);
    video.cancelVideoFrameCallback = id => clearTimeout(id);
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ['qr_code']; }
      async detect() { __media.reads++; const rawValue = __media.nextQr; __media.nextQr = null; return rawValue ? [{ rawValue }] : []; }
    };
    window.refreshWork = async () => {};
    window.openPaper = id => __media.papers.push(id);
    window.ArgusWorker = { cancelScan: () => __media.cancels++, handleQr: text => {
      if (!text.startsWith('argus:cell:')) return false;
      __media.cells.push(text); closeScanner(); return true;
    } };
  });
  await page.addScriptTag({ content: script });
  return { page, errors };
}

async function runSuite(name, browser) {
  const checks = [];
  for (const [width, height] of [[375,667],[390,844],[768,1024],[1440,900],[844,390]]) {
    const {page, errors} = await setup(browser, width, height);
    await page.evaluate(() => { __media.mode = 'pending'; openScanner(); });
    const before = await page.evaluate(() => ({ opacity: getComputedStyle(scanVideo).opacity, autoplay: scanVideo.autoplay,
      muted: scanVideo.muted, inline: scanVideo.playsInline, controls: scanVideo.controls, poster: scanVideo.hasAttribute('poster'),
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth, closeBottom: document.querySelector('.scan-close').getBoundingClientRect().bottom }));
    assert.deepEqual({opacity:before.opacity,autoplay:before.autoplay,muted:before.muted,inline:before.inline,controls:before.controls,poster:before.poster},
      {opacity:'0',autoplay:true,muted:true,inline:true,controls:false,poster:false});
    assert.ok(before.scrollWidth <= width); assert.ok(before.closeBottom <= height, `Close outside ${width}x${height}`);
    if(width === 390) await page.screenshot({path:path.join(root, `test-results/scanner-${name}-loading.png`)});
    await page.evaluate(() => __media.resolve(0));
    await page.locator('#scanView[data-ready="true"]').waitFor();
    await page.waitForFunction(() => document.querySelector('#scanStatus').textContent === 'Ищу QR…');
    await page.screenshot({path:path.join(root, `test-results/scanner-${name}-${width}.png`)});
    await page.evaluate(() => closeScanner());
    assert.equal(await page.evaluate(() => __media.tracks.every(t => t.stopped) && scanVideo.srcObject === null), true);
    assert.deepEqual(errors, []); await page.close();
  }
  checks.push('loading/first-frame/close/layout:375,390,768,1440,844x390');
  {
    const {page,errors}=await setup(browser);
    await page.evaluate(() => { __media.mode='deny'; openScanner({kind:'cell'}); });
    await page.locator('#scanRetry:visible').waitFor();
    assert.match(await page.locator('#scanStatus').innerText(), /Нет доступа/);
    await page.screenshot({path:path.join(root, `test-results/scanner-${name}-denied.png`)});
    assert.equal(await page.locator('#scanTitle').innerText(), 'Наведите камеру на QR ячейки');
    await page.evaluate(() => { __media.mode='allow'; }); await page.locator('#scanRetry').click();
    await page.locator('#scanView[data-ready="true"]').waitFor();
    await page.evaluate(() => { __media.nextQr='argus:cell:v1:test-warehouse:test-cell'; });
    await page.waitForFunction(() => __media.cells.length === 1 && scanOverlay.hidden);
    assert.equal(await page.evaluate(() => __media.tracks.every(t=>t.stopped)),true);
    await page.evaluate(() => { __media.mode='play-reject'; openScanner(); });
    await page.locator('#scanRetry:visible').waitFor();
    assert.match(await page.locator('#scanStatus').innerText(), /изображение камеры/);
    assert.equal(await page.evaluate(() => __media.tracks.every(t=>t.stopped) && getComputedStyle(scanVideo).opacity==='0'),true);
    await page.evaluate(() => { __media.mode='allow'; scanVideo.requestVideoFrameCallback=undefined; retryScanner(); });
    await page.locator('#scanView[data-ready="true"]').waitFor();
    await page.evaluate(() => closeScanner());
    assert.deepEqual(errors,[]); await page.close();
  }
  checks.push('deny→retry preserves cell mode; playback rejection stops camera');
  {
    const {page,errors}=await setup(browser);
    await page.evaluate(() => { __media.mode='pending'; openScanner(); closeScanner(); openScanner(); });
    await page.evaluate(() => __media.resolve(1)); await page.locator('#scanView[data-ready="true"]').waitFor();
    await page.evaluate(() => __media.resolve(0)); await sleep(50);
    assert.deepEqual(await page.evaluate(() => __media.tracks.map(t=>t.stopped)), [false,true]);
    await page.evaluate(() => { __media.nextQr='https://example.invalid/loader.html#paper=11000000-0000-4000-8000-000000000001'; });
    await page.waitForFunction(() => __media.papers.length === 1 && scanOverlay.hidden);
    assert.equal(await page.evaluate(() => __media.tracks.every(t=>t.stopped)),true);
    assert.deepEqual(errors,[]); await page.close();
  }
  checks.push('late permission cannot replace reopened camera; paper QR closes tracks');
  {
    const {page,errors}=await setup(browser);
    await page.evaluate(() => { __media.mode='noframes'; openScanner(); });
    await page.locator('#scanRetry:visible').waitFor({timeout:13000});
    assert.match(await page.locator('#scanStatus').innerText(), /не передаёт изображение/);
    assert.equal(await page.evaluate(() => __media.tracks.every(t=>t.stopped)),true);
    await page.evaluate(() => { __media.mode='allow'; retryScanner(); });
    await page.locator('#scanView[data-ready="true"]').waitFor();
    await page.evaluate(() => __media.tracks.at(-1).dispatchEvent(new Event('ended')));
    await page.locator('#scanRetry:visible').waitFor();
    assert.match(await page.locator('#scanStatus').innerText(), /Камера отключилась/);
    await page.evaluate(() => { __media.mode='pending'; retryScanner(); dispatchEvent(new Event('pagehide')); __media.resolve(__media.requests.length-1); });
    await sleep(50); assert.equal(await page.evaluate(() => __media.tracks.every(t=>t.stopped) && scanOverlay.hidden),true);
    assert.deepEqual(errors,[]); await page.close();
  }
  checks.push('no-frame deadline; ended track; pagehide stops late camera');
  {
    const {page,errors}=await setup(browser);
    await page.addScriptTag({path:path.join(root,'back.js')});
    await page.evaluate(()=>{
      const taskBack=document.createElement('button');taskBack.id='invoiceSwitch';taskBack.textContent='Назад из работы';
      taskBack.onclick=()=>{window.__taskBackUsed=true;};document.body.appendChild(taskBack);
      const open=document.createElement('button');open.id='cameraOpen';open.textContent='Камера';open.onclick=()=>openScanner({kind:'cell'});document.body.appendChild(open);
      argusBackButton({buttons:'#invoiceSwitch'});
    });
    await page.locator('#cameraOpen').click();await page.locator('#scanView[data-ready="true"]').waitFor();
    await page.evaluate(()=>history.back());await page.locator('#scanOverlay').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>Boolean(window.__taskBackUsed)),false);
    assert.equal(await page.evaluate(()=>__media.tracks.every(t=>t.stopped)),true);
    await page.evaluate(()=>history.back());await page.waitForFunction(()=>window.__taskBackUsed);
    assert.deepEqual(errors,[]);await page.close();
  }
  checks.push('shared Back prioritizes scanner over task then restores task Back');
  console.log(JSON.stringify({browser:name,passed:true,checks}));
}
(async()=>{
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  const chrome=await chromium.launch({channel:'chrome',headless:true});
  try{await runSuite('chromium',chrome);}finally{await chrome.close();}
  const safari=await webkit.launch({headless:true});
  try{await runSuite('webkit',safari);}finally{await safari.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
