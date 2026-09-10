const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const common={stockKnown:true,notForSale:0,defective:0,packagingDefect:0,qtyIn1c:null,stockAt:null,cells:2,short:0,barcode:'000001',countedAt:'2026-09-10T10:00:00Z'};
const stock=[
 {...common,sku:'MR-001',name:'Мармелад фруктовый «Лесные ягоды», 250 г',onHand:1200,ordered:340,available:860},
 {...common,sku:'BL-002',name:'Бульон костный говяжий, 500 мл',onHand:180,ordered:210,available:0,short:30,notForSale:4,defective:4,qtyIn1c:184},
 {...common,sku:'CH-003',name:'Шоколад молочный с фундуком, 90 г',onHand:750,ordered:120,available:630},
 {...common,sku:'BT-004',name:'Батончик протеиновый, кокос',onHand:560,ordered:80,available:480},
 {...common,sku:'TE-005',name:'Чай зелёный листовой, 100 г',onHand:320,ordered:0,available:320},
 {...common,sku:'CF-006',name:'Кофе в зёрнах, средняя обжарка, 1 кг',onHand:96,ordered:24,available:72},
];
const orders={rows:stock.slice(0,4).map((r,i)=>({id:'o'+i,number:'WB-566748414'+i,mp_rid:'shipment-'+i,name:r.name,sku:r.sku,qty:[340,210,120,80][i],created_at:'2026-09-10T08:00:00Z',status:['open','open','in_progress','ready'][i]})),hasMore:false};
const docs={rows:[{id:'d1',number:'ПРХ-0041',direction:'in',status:'completed',source:'1c',created_at:'2026-09-09T10:00:00Z',item_count:2,declared_qty:300}],hasMore:false};
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1050},acceptDownloads:true});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));let unknown=false,expired=false,ready=false;
  await page.route('http://argus.test/**',async route=>{const p=new URL(route.request().url()).pathname;const f=path.join(root,p);await route.fulfill({body:fs.readFileSync(f),contentType:p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css':p.endsWith('.js')?'text/javascript':'font/woff2'});});
  await page.route('https://api.argus-ai.online/**',async route=>{
   const u=new URL(route.request().url());let data;
   if(expired)return route.fulfill({status:401,json:{error:'Сессия завершена'}});
   if(u.pathname.endsWith('/profile'))data={id:'test',name:'Слим Тим',warehouseId:'wh'};
   else if(u.pathname==='/api/invoices')data=[{id:'d1',company_id:'test',company_name:'Слим Тим'}];
   else if(u.pathname.endsWith('/source-documents'))data={rows:[{...docs.rows[0],company_id:'source',company_name:'Общая компания 1С'}],hasMore:false};
   else if(u.pathname.endsWith('/catalog'))data={products:stock.map((r,i)=>({sku:r.sku,category:'Без категории',cards:[{nmId:String(100000000+i),vendorCode:'SELLER-'+i,photoUrl:i===0?'https://basket-01.wbbasket.ru/test.png':i===1?'https://basket-01.wbbasket.ru/broken.png':i===2?'https://evil.test/tracker.png':null}]}))};
   else if(u.pathname.endsWith('/stock'))data=unknown?stock.map(r=>({...r,stockKnown:false,onHand:null,available:null,short:null})):stock;
   else if(u.pathname.endsWith('/orders'))data=orders;
   else if(u.pathname.endsWith('/documents'))data=docs;
   else if(u.pathname.endsWith('/document-examples'))data={rows:[{...docs.rows[0],id:'example-1',preview:true,source_company_name:'Source warehouse'}]};
   else if(u.pathname.endsWith('/document-examples/example-1'))data={...docs.rows[0],id:'example-1',preview:true,source_company_name:'Source warehouse',items:[{name:'Real source sample',sku:'SOURCE-01',declared_qty:100,accepted_qty:null}]};
   else if(u.pathname.endsWith('/history'))data={events:[{kind:'returned',qty:4,quality:'defective',note:'Раздавлена упаковка',document:'ВЗВ-010',at:'2026-09-10T10:00:00Z'},{kind:'received',qty:180,document:'ПРХ-0041',at:'2026-09-09T10:00:00Z'}]};
   else if(u.pathname.includes('/invoices/'))data={...docs.rows[0],items:[{name:stock[0].name,sku:'MR-001',declared_qty:100,accepted_qty:100},{name:stock[1].name,sku:'BL-002',declared_qty:200,accepted_qty:180}]};
   else if(u.pathname.endsWith('/export/1c'))data=u.searchParams.has('download')?{format:'argus.inventory',schemaVersion:1,generatedAt:'2026-09-10T10:00:00Z'}:{ready,productCount:6,problemProducts:ready?0:1,issues:ready?[]:[{sku:'MR-001',name:stock[0].name,code:'unknown_stock',message:'Остаток не подтверждён'}]};
   else throw Error('Unmocked '+u.pathname);
   await route.fulfill({json:data});
  });
  await page.addInitScript(()=>{localStorage.setItem('argus_token','synthetic-test-only');localStorage.setItem('argus_role','seller');localStorage.setItem('argus_wh_name','Восход');});

  await page.route('https://basket-01.wbbasket.ru/**',r=>r.request().url().endsWith('broken.png')?r.fulfill({status:404,body:''}):r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')}));
  let unsafeRequests=0;page.on('request',r=>{if(r.url().includes('evil.test'))unsafeRequests++;});
  await page.goto('http://argus.test/client_access.html');await page.locator('.inventory-table tbody tr').first().waitFor();
  assert.equal(await page.locator('details.data-group, .grouping-control').count(),0);
  assert.equal(await page.locator('#logoutButton').isVisible(),false);
  const account=await page.locator('#accountButton').boundingBox(),warehouse=await page.locator('.warehouse-name').boundingBox();assert.ok(account.y>warehouse.y);
  await page.locator('#accountButton').click();await page.locator('#accountMenu').waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#logoutButton').isVisible(),false);
  await page.locator('#accountButton').click();await page.locator('#accountSettings').click();await page.locator('#rowsPerPage').selectOption('50');await page.locator('#textSize').selectOption('large');await page.locator('#settingsForm button[type="submit"]').click();
  await page.reload();await page.locator('.inventory-table').waitFor();assert.ok(await page.locator('body').evaluate(e=>e.classList.contains('larger-table-text')));
  await page.locator('#accountButton').click();await page.locator('#accountSettings').click();assert.equal(await page.locator('#rowsPerPage').inputValue(),'50');await page.locator('#rowsPerPage').selectOption('30');await page.locator('#textSize').selectOption('normal');await page.locator('#settingsForm button[type="submit"]').click();
  assert.equal(await page.locator('.inventory-table tbody tr').count(),6);
  const metrics=await page.locator('.metric-value').allTextContents();assert.deepEqual(metrics.map(x=>x.replace(/\D/g,'')),['3106','774','2362']);
  await page.locator('tr[data-product="MR-001"] img').evaluate(async img=>{if(!img.complete)await new Promise(r=>{img.onload=r;img.onerror=r;});});
  assert.ok(await page.locator('tr[data-product="MR-001"] img').evaluate(img=>img.naturalWidth>0));
  await page.waitForFunction(()=>!document.querySelector('tr[data-product="BL-002"] img'));
  assert.equal(await page.locator('tr[data-product="CH-003"] img').count(),0);assert.equal(unsafeRequests,0);
  await page.locator('#productSearch').fill('100000001');assert.equal(await page.locator('.inventory-table tbody tr').count(),1);
  const dl=page.waitForEvent('download');await page.locator('#excelButton').click();const file=await(await dl).path();
  const sheet=await page.evaluate(bytes=>{const w=XLSX.read(new Uint8Array(bytes),{type:'array'});return XLSX.utils.sheet_to_json(w.Sheets[w.SheetNames[0]]);},[...fs.readFileSync(file)]);
  assert.equal(sheet.length,1);assert.equal(sheet[0]['В сборке, шт.'],210);assert.equal(sheet[0]['Штрихкод'],'000001');
  await page.locator('[data-open-product="BL-002"]').click();await page.getByText('Раздавлена упаковка',{exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.locator('[data-nav="orders"]').click();await page.locator('.orders-table tbody tr').first().waitFor();assert.equal(await page.locator('.orders-table tbody tr').count(),4);
  await page.locator('#orderSearch').fill('100000001');assert.equal(await page.locator('.orders-table tbody tr').count(),1);await page.locator('#orderSearch').fill('');
  for(let i=0;i<45;i++)orders.rows.push({...orders.rows[0],id:'extra'+i,number:'WB-EXTRA-'+i});
  await page.locator('#refreshButton').click();await page.waitForFunction(()=>document.querySelectorAll('.orders-table tbody tr').length===30);
  await page.locator('#orderNext').click();assert.equal(await page.locator('.orders-table tbody tr').count(),19);
  await page.locator('#oneCButton').click();await page.locator('#downloadSnapshot').waitFor();assert.equal(await page.locator('#downloadSnapshot').isDisabled(),true);await page.keyboard.press('Escape');
  ready=true;await page.locator('#oneCButton').click();await page.locator('#downloadSnapshot:not(:disabled)').waitFor();const download=page.waitForEvent('download');await page.locator('#downloadSnapshot').click();assert.match((await download).suggestedFilename(),/argus-inventory/);await page.keyboard.press('Escape');
  await page.locator('[data-nav="documents"]').click();await page.locator('[data-document="d1"]').click();await page.locator('.receipt-item').first().waitFor();assert.match(await page.locator('.receipt-item').first().textContent(),/BL-002/);await page.keyboard.press('Escape');
  await page.locator('[data-document="example-1"]').click();await page.getByText('Образец настоящей накладной из 1С',{exact:true}).waitFor();assert.equal(await page.locator('#exportDocument').textContent(),'Скачать образец накладной');
  const exampleDownload=page.waitForEvent('download');await page.locator('#exportDocument').click();assert.match((await exampleDownload).suggestedFilename(),/Образец/);await page.keyboard.press('Escape');
  await page.locator('[data-nav="products"]').click();await page.locator('.inventory-table tbody tr').first().waitFor();
  await page.locator('#productSearch').fill('');await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#mobileAccount').click();assert.equal(await page.locator('#logoutButton').isVisible(),true);await page.keyboard.press('Escape');
  unknown=true;await page.locator('#refreshButton').click();await page.getByText('Остатки ещё не подтверждены',{exact:true}).waitFor();assert.equal(await page.locator('.metric-value.unknown').count(),2);
  expired=true;await page.locator('#oneCButton').click();await page.locator('#loginScreen').waitFor();assert.equal(await page.locator('#exportDialog').isVisible(),false);
  assert.deepEqual(errors,[]);console.log('PASS flat tables, real/absent/broken/unsafe images, unit totals, WB search, barcode Excel, pagination, drawers, export states, mobile overflow, expired auth');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
