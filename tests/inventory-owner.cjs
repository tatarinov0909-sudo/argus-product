// Offline owner review of actual counted lines; no request reaches a live service.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],decisions=[];
    page.on('pageerror',error=>errors.push(error.message));
    const task={id:'test-task',label:'1.1.1',expected:[],reason:'Test assignment',countedAt:'2026-09-11T10:00:00Z',counted:[
      {sku:'SAME',name:'Test product',companyName:'Продавец А',companyId:'a',quality:'good',qty:3},
      {sku:'SAME',name:'Test product',companyName:'Продавец Б',companyId:'b',quality:'defective',qty:2},
    ]};
    await page.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.origin==='http://argus.test'){
        return route.fulfill({body:fs.readFileSync(path.join(root,u.pathname)),contentType:u.pathname.endsWith('.html')?'text/html; charset=utf-8':u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':'image/svg+xml'});
      }
      if(u.origin!=='https://api.argus-ai.online')return route.abort();
      let data=[];
      if(u.pathname==='/api/warehouses/me')data={name:'Test warehouse',warehouse_code:'test'};
      if(u.pathname==='/api/inventory/settings')data={recountAfterDays:90,cellsPerRun:10,minDaysBetweenRuns:7};
      if(u.pathname==='/api/inventory/tasks')data=decisions.length?[]:[task];
      if(u.pathname==='/api/inventory/tasks/test-task/resolve'){
        decisions.push(route.request().postDataJSON());data={applied:false,recount:true,changes:[]};
      }
      if(u.pathname==='/api/sync/status')data={};
      if(u.pathname==='/api/leads/manage/access'||u.pathname==='/api/inventory/advice')return route.fulfill({status:403,json:{error:'test'}});
      return route.fulfill({json:data});
    });
    await page.addInitScript(()=>{localStorage.setItem('argus_token','offline-test');localStorage.setItem('argus_role','owner');});
    await page.goto('http://argus.test/cabinet_main.html');
    await page.locator('#nav-inv').click();
    const preview=page.locator('#invWaitingList');
    await preview.getByRole('button',{name:'Посчитать заново',exact:true}).waitFor();
    const text=await preview.textContent();
    assert.ok(text.includes('SAME · Продавец А · годный'));
    assert.ok(text.includes('SAME · Продавец Б · брак'));
    assert.ok(text.includes('насчитали 3')&&text.includes('насчитали 2'));
    await preview.getByRole('button',{name:'Посчитать заново',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('invStatusTitle')?.textContent==='Расхождений нет');
    assert.deepEqual(decisions,[{decision:'recount'}]);
    assert.deepEqual(errors,[]);
    console.log('PASS inventory owner: explicit sellers, quality, actual counts and recount action');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
