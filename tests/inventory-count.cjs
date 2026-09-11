// Offline UI checks only. Every API response below is a synthetic test fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.ARGUS_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [], counts = [], searches = [];
    page.on('pageerror', error => errors.push(error.message));
    const products = [
      {sku:'SAME-SKU',name:'Тестовый товар <img src=x onerror=alert(1)>',companyId:'company-a',companyName:'Тестовый продавец А'},
      {sku:'SAME-SKU',name:'Тестовый товар с очень длинным названием для проверки переноса',companyId:'company-b',companyName:'Тестовый продавец Б'},
    ];
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if(url.hostname === 'argus.test') {
        const file = path.join(root,url.pathname);
        return route.fulfill({body:fs.readFileSync(file),contentType:'text/html; charset=utf-8'});
      }
      if(url.hostname !== 'api.argus-ai.online') return route.abort();
      if(url.pathname === '/api/invoices' || url.pathname === '/api/cells/rows') return route.fulfill({json:[]});
      if(url.pathname === '/api/inventory/tasks') return route.fulfill({json:[{id:'test-task',label:'1.1.1',reason:'Тестовый пересчёт'}]});
      if(url.pathname === '/api/inventory/tasks/test-task/open') return route.fulfill({json:{id:'test-task',snapshotId:'a6ab101b-bdd2-4583-b39c-06915c5f4775',label:'1.1.1',reason:'Тестовый пересчёт',expected:products.map((p,i)=>({...p,quality:'good',qty:i?7:4}))}});
      if(url.pathname === '/api/inventory/products') {
        searches.push(url.searchParams.get('q'));
        return route.fulfill({json:products});
      }
      if(url.pathname === '/api/inventory/tasks/test-task/count') {
        counts.push(request.postDataJSON());
        return route.fulfill({json:{matched:false}});
      }
      throw new Error('Unexpected test API request: '+url.pathname);
    });
    await page.addInitScript(()=>{
      localStorage.setItem('argus_token','synthetic-offline-token');
      localStorage.setItem('argus_role','worker');
    });
    await page.goto('http://argus.test/loader.html');
    await page.evaluate(()=>openInventory());
    await page.getByText('посчитать →',{exact:true}).click();
    assert.equal(await page.locator('#invQty-0').inputValue(),'');
    assert.equal(await page.locator('#invQty-1').inputValue(),'');
    assert.equal(await page.locator('#invConfirm').isDisabled(),true);
    assert.equal(await page.locator('.inv-line-company').nth(1).textContent(),'Продавец: Тестовый продавец Б');
    assert.equal(await page.locator('.inv-line img').count(),0,'catalog names are text, never HTML');
    await page.locator('#invQty-0').fill('-2');
    await page.locator('#invQty-1').fill('0');
    assert.equal(await page.locator('#invQty-0').inputValue(),'-2','negative input must not silently become positive');
    assert.equal(await page.locator('#invConfirm').isDisabled(),true);
    await page.locator('#invQty-0').fill('4');
    assert.equal(await page.locator('#invConfirm').isDisabled(),false);
    await page.locator('#invQty-0').fill('');
    assert.equal(await page.locator('#invConfirm').isDisabled(),true,'deleting a count must not retain its previous number');
    await page.locator('#invQty-0').fill('4');
    await page.locator('#invProductSearch').fill('SAME');
    assert.equal(searches.length,0,'typing does not issue unbounded searches');
    await page.getByRole('button',{name:'Найти',exact:true}).click();
    await page.locator('.inv-search-result').nth(0).click();
    assert.equal(await page.locator('#invQuality-2').inputValue(),'');
    assert.equal(await page.locator('#invQty-2').inputValue(),'');
    await page.locator('#invQuality-2').selectOption('good');
    assert.equal(await page.locator('#invQuality-2').inputValue(),'','duplicate company/sku/quality must not become a second count');
    await page.locator('#invQuality-2').selectOption('defective');
    await page.locator('#invQty-2').fill('2');
    await page.getByRole('button',{name:'Убрать добавленную строку'}).click();
    assert.equal(await page.locator('.inv-line').count(),2);
    assert.equal(await page.locator('#invQty-0').inputValue(),'4');
    await page.locator('#invProductSearch').fill('SAME');
    await page.getByRole('button',{name:'Найти',exact:true}).click();
    await page.locator('.inv-search-result').nth(1).click();
    await page.locator('#invQuality-2').selectOption('packaging_defect');
    await page.locator('#invQty-2').fill('3');
    assert.equal(await page.locator('.inv-line-company').nth(2).textContent(),'Продавец: Тестовый продавец Б');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'390px must not scroll sideways');
    if(process.env.ARGUS_TEST_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.ARGUS_TEST_SCREENSHOT_DIR,'inventory-count-mobile.png'),fullPage:true});
    await page.evaluate(()=>Promise.all([confirmInvCount(),confirmInvCount()]));
    assert.equal(counts.length,1,'repeat confirmation is ignored while saving');
    assert.equal(counts[0].snapshotId,'a6ab101b-bdd2-4583-b39c-06915c5f4775');
    assert.deepEqual(counts[0].lines,[
      {sku:'SAME-SKU',companyId:'company-a',quality:'good',qty:4},
      {sku:'SAME-SKU',companyId:'company-b',quality:'good',qty:0},
      {sku:'SAME-SKU',companyId:'company-b',quality:'packaging_defect',qty:3},
    ]);
    assert.equal(counts[0].note,null);
    await page.getByText('посчитать →',{exact:true}).click();
    await page.locator('#invQty-0').fill('0');
    await page.locator('#invQty-1').fill('0');
    await page.getByRole('checkbox').check();
    await page.locator('#invConfirm').click();
    await page.getByText('посчитать →',{exact:true}).waitFor();
    assert.match(counts[1].note,/товар не из списка/);
    assert.deepEqual(errors,[]);
    console.log('PASS inventory count UI: explicit facts, seller identity, quality, search, removal, duplicate prevention, unresolved note, single submit, mobile width');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
