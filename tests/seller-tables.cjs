const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
// auth.js берёт только живой вход своей роли — похожий на настоящий.
const TOKEN='test.'+Buffer.from(JSON.stringify({role:'seller',sellerKeyId:'test-key',warehouseId:'test-warehouse'})).toString('base64url')+'.test';
// Свой выпадающий список кабинета: открыть и выбрать пункт.
const pick=async(page,key,value)=>{await page.locator(`.dd[data-dd="${key}"] .dd-btn`).click();await page.locator(`.dd[data-dd="${key}"] .dd-option[data-value="${value}"]`).click();};
const common={totalKnown:true,barcode:'000001',updatedAt:'2026-09-10T10:00:00Z'};
const stock=[
 {...common,sku:'MR-001',name:'Мармелад фруктовый «Лесные ягоды», 250 г',total:1200,inAssembly:0,available:1200},
 {...common,sku:'BL-002',name:'Бульон костный говяжий, 500 мл',total:180,inAssembly:0,available:180},
 {...common,sku:'CH-003',name:'Шоколад молочный с фундуком, 90 г',total:750,inAssembly:0,available:750},
 {...common,sku:'BT-004',name:'Батончик протеиновый, кокос',total:560,inAssembly:0,available:560},
 {...common,sku:'TE-005',name:'Чай зелёный листовой, 100 г',total:320,inAssembly:0,available:320},
 {...common,sku:'CF-006',name:'Кофе в зёрнах, средняя обжарка, 1 кг',total:96,inAssembly:0,available:96},
];
const orders={rows:stock.slice(0,4).map((r,i)=>({id:'o'+i,number:'WB-566748414'+i,mp_rid:'shipment-'+i,name:r.name,sku:r.sku,qty:[340,210,120,80][i],created_at:'2026-09-10T08:00:00Z',status:['open','open','in_progress','ready'][i]})),hasMore:false};
const docs={rows:[{id:'d1',number:'ПРХ-0041',direction:'in',status:'completed',source:'1c',created_at:'2026-09-09T10:00:00Z',item_count:2,declared_qty:300,accepted_qty:280}],hasMore:false};
// Карточка прихода: что склад принял и что записал (GET /api/inbound/:id).
const card={id:'d1',number:'ПРХ-0041',status:'completed',createdAt:'2026-09-09T10:00:00Z',lastAt:'2026-09-09T12:00:00Z',declared:300,accepted:280,unplaced:0,
 discrepancy:-20,verdict:null,editable:false,boxes:null,pallets:null,carrier:null,vehicle:null,comment:null,plannedDate:null,plannedFrom:null,plannedTo:null,weightKg:null,
 lines:[{sku:'MR-001',name:stock[0].name,declared:100,accepted:100},{sku:'BL-002',name:stock[1].name,declared:200,accepted:180}],comments:[],documents:[]};
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1050},acceptDownloads:true});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));let unknown=false,expired=false;
  await page.route('http://argus.test/**',async route=>{const p=new URL(route.request().url()).pathname;const f=path.join(root,p);await route.fulfill({body:fs.readFileSync(f),contentType:p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css':p.endsWith('.js')?'text/javascript':'font/woff2'});});
  await page.route('https://api.argus-ai.online/**',async route=>{
   const u=new URL(route.request().url());let data;
   if(expired)return route.fulfill({status:401,json:{error:'Сессия завершена'}});
   if(u.pathname.endsWith('/profile'))data={id:'test',name:'Слим Тим',warehouseId:'wh'};
   else if(u.pathname.endsWith('/catalog'))data={products:stock.map((r,i)=>({sku:r.sku,category:'Без категории',cards:[{nmId:String(100000000+i),vendorCode:'SELLER-'+i,photoUrl:i===0?'https://basket-01.wbbasket.ru/test.png':i===1?'https://basket-01.wbbasket.ru/broken.png':i===2?'https://evil.test/tracker.png':null}]}))};
   else if(u.pathname.endsWith('/stock')){
    const rows=unknown?stock.map(r=>({...r,totalKnown:false,total:null,available:null})):stock;
    data={rows,summary:{productCount:6,total:unknown?null:3106,ordered:0,inAssembly:0,inTransit:0,available:unknown?null:3106,updatedAt:'2026-09-10T10:00:00Z'}};
   }
   else if(u.pathname.endsWith('/orders'))data=orders;
   else if(u.pathname.endsWith('/documents'))data=docs;
   else if(u.pathname.endsWith('/history'))data={events:[{kind:'returned',qty:4,quality:'defective',note:'Раздавлена упаковка',document:'ВЗВ-010',at:'2026-09-10T10:00:00Z'},{kind:'received',qty:180,document:'ПРХ-0041',at:'2026-09-09T10:00:00Z'}]};
   else if(u.pathname.startsWith('/api/inbound/'))data=card;
   else if(u.pathname.includes('/invoices/'))data={...docs.rows[0],items:[{name:stock[0].name,sku:'MR-001',declared_qty:100,accepted_qty:100},{name:stock[1].name,sku:'BL-002',declared_qty:200,accepted_qty:180}]};
   else return route.fulfill({status:404,json:{error:'Нет в тестовых данных'}});   // дополнения кабинета (склады WB, брак…)
   await route.fulfill({json:data});
  });
  await page.addInitScript(token=>{localStorage.setItem('argus_auth_seller',token);sessionStorage.setItem('argus_tab_role','seller');localStorage.setItem('argus_wh_name','Восход');},TOKEN);

  await page.route('https://basket-01.wbbasket.ru/**',r=>r.request().url().endsWith('broken.png')?r.fulfill({status:404,body:''}):r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')}));
  let unsafeRequests=0;page.on('request',r=>{if(r.url().includes('evil.test'))unsafeRequests++;});
  await page.goto('http://argus.test/client_access.html');await page.locator('table.grid tbody tr').first().waitFor();
  assert.equal(await page.locator('details.data-group, .grouping-control').count(),0);
  assert.equal(await page.locator('#logoutButton').isVisible(),false);
  const account=await page.locator('#accountButton').boundingBox(),warehouse=await page.locator('#warehouseName').boundingBox();assert.ok(account.y>warehouse.y);
  await page.locator('#accountButton').click();await page.locator('#accountMenu').waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#logoutButton').isVisible(),false);
  await page.locator('#accountButton').click();await page.locator('#accountSettings').click();await pick(page,'pref-rows','50');await pick(page,'pref-text','large');await page.locator('#settingsForm button[type="submit"]').click();
  await page.reload();await page.locator('table.grid').waitFor();assert.ok(await page.locator('body').evaluate(e=>e.classList.contains('larger-table-text')));
  await page.locator('#accountButton').click();await page.locator('#accountSettings').click();assert.equal(await page.locator('.dd[data-dd="pref-rows"] .dd-value').textContent(),'50');await pick(page,'pref-rows','30');await pick(page,'pref-text','normal');await page.locator('#settingsForm button[type="submit"]').click();
  assert.equal(await page.locator('table.grid tbody tr').count(),6);
  // Плитки сверху: числа сходятся с таблицей (всего, в сборке, доступно к продаже).
  const stat=async label=>(await page.locator('.stat',{has:page.locator('.stat-label',{hasText:label})}).locator('.stat-value').first().textContent()).replace(/\D/g,'');
  assert.equal(await stat('Всего товара'),'3106');assert.equal(await stat('В сборке'),'0');assert.equal(await stat('Доступно к продаже'),'3106');
  await page.locator('tr[data-product="MR-001"] img').evaluate(async img=>{if(!img.complete)await new Promise(r=>{img.onload=r;img.onerror=r;});});
  assert.ok(await page.locator('tr[data-product="MR-001"] img').evaluate(img=>img.naturalWidth>0));
  await page.waitForFunction(()=>!document.querySelector('tr[data-product="BL-002"] img'));
  assert.equal(await page.locator('tr[data-product="CH-003"] img').count(),0);assert.equal(unsafeRequests,0);
  await page.locator('input[data-search]').fill('100000001');assert.equal(await page.locator('table.grid tbody tr').count(),1);
  const dl=page.waitForEvent('download');await page.locator('[data-excel]').click();const file=await(await dl).path();
  const sheet=await page.evaluate(bytes=>{const w=XLSX.read(new Uint8Array(bytes),{type:'array'});return XLSX.utils.sheet_to_json(w.Sheets[w.SheetNames[0]],{range:3});},[...fs.readFileSync(file)]);   // шапка таблицы — четвёртая строка, выше название и фильтр
  assert.equal(sheet.length,2);assert.equal(sheet[1]['№'],'Итого');   // строка товара и «Итого»
  assert.equal(sheet[0]['Всего, шт.'],180);assert.equal(sheet[0]['В сборке, шт.'],0);assert.equal(sheet[0]['Доступно к продаже, шт.'],180);assert.equal(sheet[0]['Штрихкод'],'000001');
  await page.locator('[data-open-product="BL-002"]').click();await page.getByText('Раздавлена упаковка',{exact:true}).waitFor();await page.keyboard.press('Escape');
  const nav=name=>page.locator(`[data-nav-list] a[href="#${name}"]:visible`).first().click();
  const rows=()=>page.locator('table.grid tbody tr').count();
  await nav('orders');await page.locator('table.grid tbody tr').first().waitFor();assert.equal(await rows(),4);
  await page.locator('input[data-search]').fill('100000001');assert.equal(await rows(),1);await page.locator('input[data-search]').fill('');
  // Заказов больше, чем строк за раз: «Показать ещё» дочитывает (раньше были страницы).
  for(let i=0;i<45;i++)orders.rows.push({...orders.rows[0],id:'extra'+i,number:'WB-EXTRA-'+i});
  await page.locator('#refreshButton').click();await page.waitForFunction(()=>document.querySelectorAll('table.grid tbody tr').length===30);
  await page.locator('[data-more]').click();assert.equal(await rows(),49);assert.equal(await page.locator('[data-more]').count(),0);
  // Карточка заказа: позиции и ничего служебного.
  await page.locator('[data-order-row="o0"]').click();await page.locator('.receipt-item').first().waitFor();assert.ok(!(await page.locator('#drawer').textContent()).includes('Код склада'));await page.keyboard.press('Escape');
  // Приход: карточка с позициями.
  await nav('documents');await page.locator('[data-doc-row="d1"]').click();await page.locator('#drawerBody').getByText(stock[1].name).first().waitFor();assert.ok(!(await page.locator('#drawer').textContent()).includes('Код склада'));await page.keyboard.press('Escape');
  await nav('products');await page.locator('table.grid tbody tr').first().waitFor();
  await page.locator('input[data-search]').fill('');await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#mobileAccount').click();assert.equal(await page.locator('#logoutButton').isVisible(),true);await page.keyboard.press('Escape');
  // Учёта нет — вместо чисел прочерк, а не ноль и не выдуманная подпись.
  unknown=true;await page.locator('#refreshButton').click();await page.waitForFunction(()=>[...document.querySelectorAll('.stat-value')].filter(e=>e.textContent.trim()==='—').length>=2);assert.equal(await stat('Всего товара'),'');assert.equal(await stat('Доступно к продаже'),'');assert.equal(await page.getByText('Количество уточняется',{exact:true}).count(),0);
  expired=true;await page.locator('#refreshButton').click();await page.locator('#loginScreen').waitFor();
  assert.deepEqual(errors,[]);console.log('PASS flat tables, real/absent/broken/unsafe images, unit totals, WB search, barcode Excel, pagination, drawers, mobile overflow, expired auth');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
