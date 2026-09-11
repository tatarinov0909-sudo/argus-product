// Offline interface test with synthetic data. No request reaches the live API.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width:2048,height:1100}});const errors=[],posts=[];let resolved=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://argus.test/**',route=>{
   const file=path.join(root,new URL(route.request().url()).pathname);
   return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});
  });
  await page.route('https://api.argus-ai.online/**',route=>{
   const url=new URL(route.request().url());
   assert.ok(url.pathname.startsWith('/api/marketplaces/reconciliation'));
   if(route.request().method()==='POST'){
    posts.push(route.request().postDataJSON());resolved=true;return route.fulfill({json:{resolved:true}});
   }
   if(url.pathname.endsWith('/reconciliation'))return route.fulfill({json:{rows:resolved?[]:[{id:'test-id',number:'WB-TEST',company:'Тестовый продавец — длинное название компании для проверки отображения',mp_close_reason:'fulfilled',picked_qty:'2'}],next:null}});
   return route.fulfill({json:{id:'test-id',number:'WB-TEST',company:'Тестовый продавец',reason:'fulfilled',version:'test-version',action:'confirm_departed',canResolve:true,lines:[{name:'Тестовый товар с длинным названием для проверки таблицы',sku:'TEST-SKU',cell:'1.1.1',qty:2}]}});
  });
  await page.addInitScript(()=>localStorage.setItem('argus_token','synthetic-only-test-token'));
  await page.goto('http://argus.test/marketplace-reconciliation.html');
  await page.getByRole('button',{name:'Проверить',exact:true}).click();
  if(process.env.ARGUS_TEST_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.ARGUS_TEST_SCREENSHOT_DIR,'wb-reconciliation-desktop.png'),fullPage:true});
  assert.equal(await page.locator('#departedAt').inputValue(),'');
  assert.equal(await page.locator('#confirmButton').isDisabled(),true);
  await page.locator('#confirmed').check();
  await page.locator('#confirmButton').click();
  assert.equal(posts.length,0,'empty actual departure date must not submit');
  await page.locator('#departedAt').fill('2026-09-11T10:30');
  await page.locator('#confirmButton').click();
  await page.getByText('Подтверждение сохранено. Остатки и журнал обновлены.').waitFor();
  assert.equal(posts.length,1);assert.equal(posts[0].confirmed,true);assert.ok(posts[0].departedAt.endsWith('Z'));
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile page must not overflow horizontally');
  assert.deepEqual(errors,[]);
  console.log('PASS reconciliation UI: owner confirmation, explicit date, single submit, mobile width, no browser errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
