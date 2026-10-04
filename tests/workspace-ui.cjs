// Synthetic UI regression: no production requests or credentials.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),site='https://workspace.invalid';
const company='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const prices={receiving:'1.01',picking:'10.00',returns:'3.00',storage:'2.00'};
const tariff={configured:true,companyId:company,prices,storageUnit:'cell_day',showSellers:true,history:[{id:'history',prices,storageUnit:'cell_day',effectiveFrom:'2001-01-01'}]};
const schedule={showSellers:true,enabled:false,cadence:'monthly',intervalDays:30,startDate:'2001-01-01',paymentDays:7};
const line={service:'receiving',title:'Приёмка',qty:2,unit:'шт.',rate:'1.01',amount:'2.02',details:[{label:'Тестовый приход',qty:2,rate:'1.01',amount:'2.02'}]};
const invoice={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',number:'ТЕСТ-001',companyId:company,companyName:'Тестовый клиент',from:'2001-01-01',to:'2001-01-02',issuedAt:'2001-01-03',dueDate:'2001-01-10',lines:[line],total:'2.02',totalCents:'202',paid:'0.00',paidCents:'0',balance:'2.02',balanceCents:'202',status:'unpaid',payments:[]};
const waiting={id:'pending-test',created_at:'2000-12-31T10:00:00Z',action_text:'Тестовый вопрос вне выбранного дня',status:'pending',answered:false,entity_type:'item_note',category:'agent',agent_name:'Кладовщик',details:{}};
const history=(id,text)=>({id,created_at:'2001-01-01T10:00:00Z',action_text:text,status:'auto',entity_type:'item_note',category:'agent',agent_name:'Кладовщик',details:{}});
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.ARGUS_BROWSER_CHANNEL||'msedge'});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:700}}),errors=[],calls=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const req=route.request(),u=new URL(req.url());
      if(u.origin===site){
        const file=path.join(root,decodeURIComponent(u.pathname));
        if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
        return route.fulfill({body:fs.readFileSync(file),contentType:u.pathname.endsWith('.html')?'text/html; charset=utf-8':u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':u.pathname.endsWith('.woff2')?'font/woff2':'image/svg+xml'});
      }
      if(u.origin!=='https://api.argus-ai.online')return route.abort();
      const body=req.postDataJSON();calls.push({path:u.pathname,query:Object.fromEntries(u.searchParams),method:req.method(),body});
      let data=[];
      if(u.pathname==='/api/leads/manage/access')return route.fulfill({status:403,json:{error:'test'}});
      if(u.pathname==='/api/warehouses/me')data={name:'Проверочный склад',warehouse_code:'DEMO',city:'Тестовый город',timezone:'Europe/Moscow',setup_at:'2001-01-01',settings:{}};
      if(u.pathname==='/api/warehouses/me/readiness')data={ready:true,steps:[]};
      if(u.pathname==='/api/alerts/today')data={date:'2001-01-01',supplies:{active:0,items:[]},receiving:{expected:0,items:[]},decisions:{waiting:0,items:[]},exchange:{},messages:{}};
      if(u.pathname==='/api/sync/status')data={};
      if(u.pathname==='/api/sellers/stock-summary')data={sellers:[]};
      if(u.pathname==='/api/inventory/advice')data={reasons:[],recountAfterDays:30,cellsPerRun:10,minDaysBetweenRuns:7,cycleDays:0};
      if(u.pathname==='/api/sellers/companies')data=[{id:company,name:'Тестовый клиент',keys:[],active:true}];
      if(u.pathname==='/api/staff')data=[{id:'worker',name:'Тестовый кладовщик',kind:'worker',active:true,key_code:'DEMO-WORKER',issued_at:'2001-01-01'}, {id:'manager',name:'Тестовый менеджер',kind:'manager',active:true,key_code:'DEMO-MANAGER',issued_at:'2001-01-01',permissions:['warehouse']}];
      if(u.pathname==='/api/journal')data={date:u.searchParams.get('date'),timezone:'Europe/Moscow',entries:u.searchParams.get('date')==='2001-01-01'?[history(u.searchParams.has('cursor')?'old-2':'old-1',u.searchParams.has('cursor')?'Вторая работа за старый день':'Работа за старый день')]:[],pending:[waiting],nextCursor:u.searchParams.get('date')==='2001-01-01'&&!u.searchParams.has('cursor')?'next-test':null,pendingNextCursor:null};
      if(u.pathname==='/api/warehouses/billing/charges')data={from:u.searchParams.get('from'),to:u.searchParams.get('to'),total:'2.02',sellers:[{companyId:company,name:'Тестовый клиент',configured:true,lines:[line],total:'2.02'},{companyId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'Без прайса',configured:false,lines:[],total:'0.00'}]};
      if(u.pathname==='/api/warehouses/billing/tariff')data=tariff;
      if(u.pathname==='/api/warehouses/billing/schedule')data=schedule;
      if(u.pathname==='/api/warehouses/billing/invoices')data=req.method()==='POST'?invoice:{items:[invoice],nextCursor:null};
      if(u.pathname.endsWith('/payments')){invoice.payments=[{id:'pay',amount:'1.01',amountCents:'101',paidOn:body.paidOn,note:body.note}];invoice.paid='1.01';invoice.paidCents='101';invoice.balance='1.01';invoice.balanceCents='101';invoice.status='partial';data=invoice;}
      if(u.pathname==='/api/sellers/profile')data={id:company,name:'Тестовый клиент',timezone:'Europe/Moscow',warehouseName:'Проверочный склад'};
      if(u.pathname==='/api/sellers/billing')data={enabled:true,shownToSeller:true,total:'2.02',lines:[line],tariff,schedule,invoices:[invoice],nextInvoiceCursor:null};
      return route.fulfill({json:data});
    });
    const payload=Buffer.from(JSON.stringify({role:'owner',warehouseId:'fixture',ownerId:'fixture',name:'Тест'})).toString('base64url');
    await page.addInitScript(token=>{localStorage.setItem('argus_token',token);localStorage.setItem('argus_role','owner');},'test.'+payload+'.test');
    await page.goto(site+'/cabinet_main.html');
    await page.locator('#view-home.active').waitFor();
    assert.equal(await page.locator('.sidebar-nav .nav-item').count(),11);
    await page.locator('#nav-staff').click();
    await page.getByText('Тестовый кладовщик',{exact:true}).waitFor();
    assert.equal(await page.locator('#staffWorkerForm').isVisible(),false);
    assert.equal(await page.locator('#staffManagerForm').isVisible(),false);
    assert.equal(await page.locator('#staffEdit-manager').isVisible(),false);
    const worker=await page.locator('.staff-workers').boundingBox(),manager=await page.locator('.staff-managers').boundingBox();
    assert.ok(worker.x<manager.x&&Math.abs(worker.y-manager.y)<2,'workers left, managers right');
    await page.locator('#staffManagerFormButton').click();
    assert.equal(await page.locator('#managerNameInput').isVisible(),true);
    assert.equal(await page.locator('#staffGrantsList').isVisible(),true);
    await page.locator('#staffManagerFormButton').click();
    await page.locator('#nav-journal').click();
    await page.locator('#jList').getByText('Тестовый вопрос вне выбранного дня',{exact:true}).waitFor();
    await page.locator('.cal-btn').click();
    await page.getByLabel('Дата журнала').fill('2001-01-01');
    await page.getByText('Работа за старый день',{exact:true}).waitFor();
    assert.equal(await page.locator('#jList').getByText('Тестовый вопрос вне выбранного дня',{exact:true}).isVisible(),true);
    await page.getByRole('button',{name:'Ещё записи за этот день',exact:true}).click();
    await page.getByText('Вторая работа за старый день',{exact:true}).waitFor();
    assert.ok(calls.some(c=>c.path==='/api/journal'&&c.query.date==='2001-01-01'&&c.query.cursor==='next-test'));
    await page.locator('#nav-billing').click();
    await page.locator('#billCompanyChoice summary').waitFor();
    await page.locator('#billCompanyChoice summary').click();
    await page.locator('#billCompanyChoice [data-bill-company="'+company+'"]').click();
    await page.locator('#billTariffPanel').waitFor();
    await page.locator('#billTariffPanel>summary').click();
    await page.locator('[data-bill-price="receiving"]').fill('2,03');
    await page.locator('#billSave').click();
    await page.waitForFunction(()=>!!document.querySelector('#billSave')&&!document.querySelector('#billSave').disabled);
    const saved=calls.find(c=>c.path.endsWith('/billing/tariff')&&c.method==='PUT');
    assert.equal(saved.body.companyId,company);assert.equal(saved.body.prices.receiving,'2.03');assert.equal(Object.keys(saved.body.prices).length,4);
    await page.locator('#billIssue').click();
    await page.waitForFunction(()=>!!document.querySelector('#billIssue')&&!document.querySelector('#billIssue').disabled);
    assert.equal(calls.find(c=>c.path.endsWith('/billing/invoices')&&c.method==='POST').body.companyId,company);
    await page.locator('[data-invoice] > summary').click();
    await page.getByText('Отметить полученную оплату',{exact:true}).click();
    await page.locator('[data-pay-amount]').fill('1,01');
    await page.locator('[data-pay-invoice]').click();
    await page.getByText('Оплачен частично',{exact:true}).waitFor();
    const pay=calls.find(c=>c.path.endsWith('/payments'));assert.equal(pay.body.amount,'1.01');assert.ok(pay.body.idempotencyKey);
    assert.equal(await page.locator('[data-invoice]').getAttribute('open'),'');
    if(process.env.ARGUS_SCREENSHOT_DIR){
      fs.mkdirSync(process.env.ARGUS_SCREENSHOT_DIR,{recursive:true});
      for(const width of [1440,2048,2560,375]){await page.setViewportSize({width,height:700});await page.locator('#view-billing .staff-wrap').evaluate(e=>{e.scrollTop=0;});await page.screenshot({animations:'disabled',path:path.join(process.env.ARGUS_SCREENSHOT_DIR,'billing-'+width+'.png')});await page.locator('#nav-staff').click();await page.screenshot({animations:'disabled',path:path.join(process.env.ARGUS_SCREENSHOT_DIR,'staff-'+width+'.png')});await page.locator('#nav-billing').click();await page.locator('#billTariffPanel').waitFor();}
    }
    await page.goto(site+'/client_access.html#billing');
    await page.getByText('Ваш прайс услуг',{exact:true}).waitFor();
    await page.locator('[data-seller-invoice]>summary').click();
    await page.getByRole('heading',{name:'Полученные складом оплаты',exact:true}).waitFor();
    assert.equal(await page.locator('#sellerBillMonth').count(),1);
    assert.equal(await page.locator('[data-pay-invoice]').count(),0,'seller cannot record payments');
    assert.deepEqual(errors,[]);
    console.log('PASS: staff disclosure/layout; arbitrary journal date, pending and paging; personal tariff, selected-client invoice, exact payment, seller read-only invoice.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
