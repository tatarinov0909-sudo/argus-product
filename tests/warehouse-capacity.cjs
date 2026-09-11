// Offline test-only layout: gaps and merged addresses must not invent capacity.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const rows=[{id:'row',row_num:1,rack_count:100,tier_count:7,blocks:[
  {id:'occupied',warehouse_row_id:'row',rack_start:1,rack_end:2,tier_start:1,tier_end:2,state:'occupied',fill_pct:100,stock:[{companyId:'a',sku:'test',qty:1,quality:'good'}]},
  {id:'empty',warehouse_row_id:'row',rack_start:10,rack_end:10,tier_start:1,tier_end:1,state:'empty',fill_pct:0,stock:[]},
]},{id:'emptyrow',row_num:2,rack_count:100,tier_count:7,blocks:[]}];
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const page=await browser.newPage({viewport:{width:2048,height:1120}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.origin==='http://argus.test'){
        const file=path.join(root,u.pathname);
        return route.fulfill({body:fs.readFileSync(file),contentType:u.pathname.endsWith('.html')?'text/html; charset=utf-8':u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':'image/svg+xml'});
      }
      if(u.origin!=='https://api.argus-ai.online')return route.abort();
      let data=[];
      if(u.pathname==='/api/cells/rows')data=rows;
      if(u.pathname==='/api/warehouses/me')data={name:'Проверка карты',warehouse_code:'test'};
      if(u.pathname==='/api/sync/status')data={};
      if(u.pathname==='/api/leads/manage/access')return route.fulfill({status:403,json:{error:'test'}});
      if(u.pathname==='/api/inventory/advice')return route.fulfill({status:503,json:{error:'test'}});
      return route.fulfill({json:data});
    });
    await page.addInitScript(()=>{localStorage.setItem('argus_token','offline-test');localStorage.setItem('argus_role','owner');});
    await page.goto('http://argus.test/cabinet_main.html');
    await page.locator('#nav-warehouse').click();
    await page.getByText('вместимость не задана',{exact:true}).waitFor();
    const numbers=await page.locator('.wh-summary-stat .num').allTextContents();
    assert.deepEqual(numbers,['2','1','1','—']); // 2 real addresses, not 1400 slots.
    assert.ok(!(await page.locator('#whMapWrap').textContent()).includes('%'));
    assert.ok((await page.locator('#whStatusLine').textContent()).includes('1 ряд'));
    await page.locator('#row-rect-1').click();
    await page.locator('#fp-row-1.visible').waitFor();
    assert.ok((await page.locator('#fp-row-1 .wh-row-group-stats').textContent()).includes('1 из 2'));
    const cell=page.locator('.wh-cell[data-block-id="occupied"]');
    assert.ok((await cell.getAttribute('class')).includes('fill-unknown'));
    assert.equal(await cell.evaluate(e=>getComputedStyle(e).backgroundImage),'none');
    assert.equal(await page.locator('.wh-row-group-meter,.wh-row-rect-fill').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS map: actual addresses and quantities, uniform occupied state, no false capacity percentage');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
