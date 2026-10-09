// Offline UI regression: test-only data never reaches the live API.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
// auth.js берёт только живой вход своей роли — похожий на настоящий, не «синтетическая строка».
const TOKEN='test.'+Buffer.from(JSON.stringify({role:'seller',sellerKeyId:'test-key',warehouseId:'test-warehouse'})).toString('base64url')+'.test';
// Свой выпадающий список кабинета: открыть и выбрать пункт.
const pick=async(page,key,value)=>{await page.locator(`.dd[data-dd="${key}"] .dd-btn`).click();await page.locator(`.dd[data-dd="${key}"] .dd-option[data-value="${value}"]`).click();};
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const page=await browser.newPage({viewport:{width:2048,height:1120}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let failMore=true,moreCalls=0;
    const row={sku:'history-test',name:'Товар для проверки истории',barcode:'000001',totalKnown:true,total:20,ordered:2,inAssembly:2,inTransit:0,available:16,defective:0,updatedAt:'2026-09-10T10:00:00Z'};
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
      else if(url.pathname.endsWith('/stock'))data={rows:[row],summary:null};
      else if(url.pathname.endsWith('/orders'))data={rows:orders,hasMore:false};
      else if(url.pathname.endsWith('/history')){
        if(url.searchParams.has('cursor')){
          moreCalls++;assert.equal(url.searchParams.get('cursor'),'test-next-cursor');
          if(failMore){failMore=false;return route.fulfill({status:503,json:{error:'Проверка повторной загрузки'}});}
          data={events:[{id:'2',eventKey:'received:2',kind:'received',qty:24,at:'2026-09-10T10:00:00Z',document:'ПРИЁМКА',toCell:{label:'01-04-002'}}],hasMore:false,nextCursor:null};
        }else data={events:[{id:'1',eventKey:'shipped:1',kind:'shipped',qty:4,at:'2026-09-11T10:00:00Z',document:'ОТГРУЗКА',fromCell:{label:'01-04-002'},supplyNumber:'ПС-ТЕСТ'}],hasMore:true,nextCursor:'test-next-cursor'};
      }else return route.fulfill({status:404,json:{error:'Нет в тестовых данных'}});   // дополнения кабинета (склады WB, приходы…)
      return route.fulfill({json:data});
    });
    await page.addInitScript(token=>{localStorage.setItem('argus_auth_seller',token);sessionStorage.setItem('argus_tab_role','seller');},TOKEN);
    await page.goto('http://argus.test/client_access.html');
    await page.locator('[data-open-product]').first().click();
    await page.locator('#historyMore').waitFor();
    assert.equal(await page.locator('.timeline li').count(),1);
    assert.ok((await page.locator('.timeline').textContent()).includes('−4 шт.'));
    assert.ok(!(await page.locator('.timeline').textContent()).includes('ячейк'));
    await page.locator('#historyMore').click();
    await page.getByText('Проверка повторной загрузки',{exact:true}).waitFor();
    assert.equal(await page.locator('.timeline li').count(),1,'failed page retains first page');
    await page.locator('#historyMore').click();
    await page.waitForFunction(()=>document.querySelectorAll('.timeline li').length===2);
    assert.equal(moreCalls,2);assert.equal(await page.locator('#historyMore').count(),0);
    assert.ok(!(await page.locator('.timeline').textContent()).includes('01-04-002'));
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.locator('#drawer').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'history fits mobile drawer');
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:2048,height:1120});
    await page.locator('[data-nav-list] a[href="#orders"]:visible').first().click();
    await page.getByText('Отменён на WB',{exact:true}).waitFor();
    assert.ok((await page.locator('table.grid').textContent()).includes('Склад сверяет заказ'));
    const rows=()=>page.locator('table.grid tbody tr').count();
    assert.equal(await rows(),4);
    // «В работе»: открытый и тот, что закрыт на WB, но склад ещё сверяет (остаток под вопросом).
    await pick(page,'o-status','active');assert.equal(await rows(),2);
    await pick(page,'o-status','canceled');assert.equal(await rows(),1);
    await pick(page,'o-status','conflict');assert.equal(await rows(),1);
    await pick(page,'o-status','shipped');assert.equal(await rows(),1);
    assert.deepEqual(errors,[]);
    console.log('PASS seller history UI: pagination, retry, no cell addresses, mobile width, order status filters (active/canceled/conflict/shipped)');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
