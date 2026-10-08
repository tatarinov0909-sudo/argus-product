// Real camera/permission smoke on the debug emulator, using only its synthetic worker account.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {chromium} = require('@playwright/test');
const run=promisify(execFile), sleep=ms=>new Promise(r=>setTimeout(r,ms));
const adbPath=path.join(process.env.LOCALAPPDATA,'Android/Sdk/platform-tools/adb.exe');
const adb=async(...args)=>(await run(adbPath,['-s','emulator-5554',...args],{windowsHide:true,timeout:15000})).stdout;
const output=path.resolve(__dirname,'../test-results');
const screenshot=async name=>{
  const {stdout}=await run(adbPath,['-s','emulator-5554','exec-out','screencap','-p'],{windowsHide:true,encoding:'buffer',maxBuffer:10*1024*1024});
  fs.writeFileSync(path.join(output,name),stdout);
};
const permission=async id=>{
  await adb('shell','uiautomator','dump','/sdcard/argus-scanner-ui.xml');
  const xml=await adb('shell','cat','/sdcard/argus-scanner-ui.xml');
  const node=xml.match(new RegExp('<node[^>]*resource-id="[^\"]*:'+id+'"[^>]*>'));
  assert.ok(node,'Expected Android permission button '+id);
  const rect=node[0].match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);
  await adb('shell','input','tap',String(Math.floor((rect[0]+rect[2])/2)),String(Math.floor((rect[1]+rect[3])/2)));
};
(async()=>{
  const fixture=JSON.parse(fs.readFileSync(process.env.ARGUS_WORKER_FIXTURE_PATH,'utf8'));
  assert.equal(fixture.synthetic,true);
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9224');
  const page=browser.contexts()[0].pages()[0],report={checks:[],errors:[]};
  page.on('pageerror',e=>report.errors.push(e.message));
  try{
    assert.deepEqual(await page.evaluate(()=>({native:ARGUS_WORKER_CONFIG.native,base:ARGUS_WORKER_CONFIG.apiBase})),{native:true,base:'http://10.0.2.2:3110'});
    await page.addInitScript(()=>{window.__scannerReady=false;addEventListener('argus:worker-ready',()=>window.__scannerReady=true);});
    if(await page.locator('#workerLogin').count()){
      await page.locator('#key').fill(fixture.keyCode);await page.locator('#loginButton').click();await page.waitForURL('**/loader.html');
    }
    assert.equal(await page.evaluate(()=>ArgusAuth.payload(ArgusAuth.get(['worker']).token).warehouseId),fixture.warehouseId);
    if(await page.locator('#cells').count())await page.getByRole('link',{name:'← К работе',exact:true}).click();
    await page.reload();await page.waitForFunction(()=>window.__scannerReady);
    if(await page.locator('#sheetOverlay.show').isVisible())await page.locator('#sheetOverlay').click({position:{x:3,y:3}});
    if(await page.locator('#invoiceSwitch').isVisible())await page.locator('#invoiceSwitch').click();
    await page.locator('.scan-open:visible').first().click();await sleep(500);
    assert.equal(await page.evaluate(()=>getComputedStyle(scanVideo).opacity),'0');
    const duringPermission=await page.evaluate(()=>Capacitor.Plugins.WorkerDevice.getLifecycle());
    assert.equal(duringPermission.state,'active','Permission dialog must not signal an app departure');
    await permission('id/permission_deny_button');
    await page.locator('#scanRetry:visible').waitFor();
    assert.match(await page.locator('#scanStatus').innerText(),/Нет доступа/);
    await screenshot('android-scanner-denied.png');
    report.checks.push('denied permission hides video and offers retry; no native departure');
    await page.locator('#scanRetry').click();await sleep(500);
    await permission('id/permission_allow_foreground_only_button');
    await page.locator('#scanView[data-ready="true"]').waitFor({timeout:15000});
    await page.waitForFunction(()=>scanStatus && document.querySelector('#scanStatus').textContent==='Ищу QR…');
    const active=await page.evaluate(()=>({width:scanVideo.videoWidth,height:scanVideo.videoHeight,currentTime:scanVideo.currentTime,paused:scanVideo.paused,
      autoplay:scanVideo.autoplay,muted:scanVideo.muted,inline:scanVideo.playsInline,controls:scanVideo.controls,opacity:getComputedStyle(scanVideo).opacity}));
    assert.ok(active.width>0&&active.height>0);assert.equal(active.paused,false);assert.equal(active.opacity,'1');assert.equal(active.controls,false);
    await sleep(500);assert.ok(await page.evaluate(t=>scanVideo.currentTime>t,active.currentTime));
    await screenshot('android-scanner-camera.png');
    await page.evaluate(()=>window.__scannerTracks=scanVideo.srcObject.getTracks());
    await page.getByRole('button',{name:'Закрыть',exact:true}).click();
    assert.equal(await page.evaluate(()=>__scannerTracks.every(t=>t.readyState==='ended')&&scanVideo.srcObject===null),true);
    report.checks.push({name:'real_camera_frames_without_play_overlay',...active});
    await page.locator('.scan-open:visible').first().click();
    await page.locator('#scanView[data-ready="true"]').waitFor();
    await page.evaluate(()=>window.__scannerTracks=scanVideo.srcObject.getTracks());
    await adb('shell','input','keyevent','4');
    await page.locator('#scanOverlay').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>__scannerTracks.every(t=>t.readyState==='ended')),true);
    report.checks.push('reopen works; native Back closes scanner and stops tracks');
    // The work screen has later Back buttons in DOM: scanner Back must still win.
    await page.locator('#homeBody').getByText('Приёмка товара',{exact:true}).click();
    await page.locator('.recv-row').filter({hasText:fixture.invoice.number}).click();
    await page.locator('#receiptBody .asm-actions button').first().click();
    if(await page.locator('#pauseResumeBtn').isVisible())await page.locator('#pauseResumeBtn').click();
    await page.locator('#workerCellScan').waitFor();
    if(await page.locator('#sheetOverlay.show').isVisible())await page.locator('#sheetOverlay').click({position:{x:3,y:3}});
    await page.locator('#workerCellScan').click();
    await page.locator('#scanView[data-ready="true"]').waitFor();
    assert.equal(await page.locator('#scanTitle').innerText(),'Наведите камеру на QR ячейки');
    await page.evaluate(()=>window.__scannerTracks=scanVideo.srcObject.getTracks());
    await adb('shell','input','keyevent','4');
    await page.locator('#scanOverlay').waitFor({state:'hidden'});
    assert.equal(await page.locator('#invoiceSwitch').isVisible(),true,'Scanner Back must leave work screen open');
    assert.equal(await page.evaluate(()=>__scannerTracks.every(t=>t.readyState==='ended')),true);
    report.checks.push('cell camera real frames; Back closes scanner over active task');
    await page.locator('#invoiceSwitch').click();
    assert.deepEqual(report.errors,[]);
    fs.writeFileSync(path.join(output,'android-scanner.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({passed:true,...report}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
