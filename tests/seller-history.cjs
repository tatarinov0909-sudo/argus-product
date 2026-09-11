// Offline UI regression: test-only data never reaches the live API.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const page=await browser.newPage({viewport:{width:2048,height:1120}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let failMore=true,moreCalls=0;
    const row={sku:'history-test',name:'Товар для проверки истории',barcode:'000001',stockKnown:true,onHand:20,ordered:4,available:16,blockedOrdered:2};
    const orders=[
      {id:'active',number:'ACTIVE',status:'open'},
      {id:'cancel',number:'CANCEL',status:'open',mp_closed_at:'2026-09-11T08:00:00Z',mp_close_reason:'canceled'},
      {id:'done',number:'DONE',status:'open',mp_closed_at:'2026-09-11T08:00:00Z',mp_close_reason:'fulfilled',stock_conflict:true},
      {id:'ship',number:'SHIP',status:'shipped'},
    ].map(r=>({...row,qty:2,created_at:'2026-09-11T08:00:00Z',...r}));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin==='http://argus.test'){
        const file=path.join(root,url.pathname);
        return route.fulfill({body:fs.readFileSync(file),contentType:url.pathname.endsWith('.html')?'text/html; charset=utf-8':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.js')?'text/javascript':'image/svg+xml'});
      }
      if(url.origin!=='https://api.argus-ai.online')return route.abort();
      let data;
      if(url.pathname.endsWith('/profile'))data={id:'history-test-company',name:'Проверка истории'};
      else if(url.pathname.endsWith('/catalog'))data={products:[]};
      else if(url.pathname.endsWith('/stock'))data=[row];
      else if(url.pathname.endsWith('/orders'))data={rows:orders,hasMore:false};
      else if(url.pathname.endsWith('/history')){
        if(url.searchParams.has('cursor')){
          moreCalls++;assert.equal(url.searchParams.get('cursor'),'test-next-cursor');
          if(failMore){failMore=false;return route.fulfill({status:503,json:{error:'Проверка повторной загрузки'}});}
          data={events:[{id:'2',eventKey:'received:2',kind:'received',qty:24,at:'2026-09-10T10:00:00Z',document:'ПРИЁМКА',toCell:{label:'01-04-002'}}],hasMore:false,nextCursor:null};
        }else data={events:[{id:'1',eventKey:'shipped:1',kind:'shipped',qty:4,at:'2026-09-11T10:00:00Z',document:'ОТГРУЗКА',fromCell:{label:'01-04-002'},supplyNumber:'ПС-ТЕСТ'}],hasMore:true,nextCursor:'test-next-cursor'};
      }else throw Error('Unmocked request '+url.pathname);
      return route.fulfill({json:data});
    });
    await page.addInitScript(()=>{localStorage.setItem('argus_token','synthetic-offline-token');localStorage.setItem('argus_role','seller');});
    await page.goto('http://argus.test/client_access.html');
    await page.locator('[data-open-product]').click();
    await page.locator('#historyMore').waitFor();
    assert.equal(await page.locator('.timeline li').count(),1);
    assert.ok((await page.locator('.timeline').textContent()).includes('−4 шт.'));
    assert.ok((await page.locator('.timeline').textContent()).includes('Из ячейки: 01-04-002'));
    await page.locator('#historyMore').click();
    await page.getByText('Проверка повторной загрузки',{exact:true}).waitFor();
    assert.equal(await page.locator('.timeline li').count(),1,'failed page retains first page');
    await page.locator('#historyMore').click();
    await page.waitForFunction(()=>document.querySelectorAll('.timeline li').length===2);
    assert.equal(moreCalls,2);assert.equal(await page.locator('#historyMore').count(),0);
    assert.ok((await page.locator('.timeline').textContent()).includes('В ячейку: 01-04-002'));
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.locator('#drawer').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'history fits mobile drawer');
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:2048,height:1120});
    await page.locator('[data-nav="orders"]').click();
    await page.getByText('Отменён на WB',{exact:true}).waitFor();
    assert.ok((await page.locator('.orders-table').textContent()).includes('Склад сверяет заказ'));
    await page.locator('[data-order-filter="active"]').click();
    assert.equal(await page.locator('.orders-table tbody tr').count(),1);
    await page.locator('[data-order-filter="closed"]').click();
    assert.equal(await page.locator('.orders-table tbody tr').count(),2);
    await page.locator('[data-order-filter="shipped"]').click();
    assert.equal(await page.locator('.orders-table tbody tr').count(),1);
    assert.deepEqual(errors,[]);
    console.log('PASS seller history UI: pagination, retry, addresses, mobile width, canceled/fulfilled WB filters');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
