// Public assets may be read, but ALL API requests use synthetic responses.
// No stock writes, keys or client data are used outside this browser fixture.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.ARGUS_PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = process.env.ARGUS_PUBLIC_SITE || 'https://vw-stock.invalid';
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TARGET = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';
const catalog = Array.from({length:120}, (_, i) => ({sku:String(i+1).padStart(5,'0'),
  name:'Тестовый товар ' + (i+1), barcode:i<2?'001234':String(i+1).padStart(13,'0'),
  inCells:12,toPick:3,promised:2,free:7,inDestination:2}));
catalog.push({sku:'1234567890123456',name:'Текстовый длинный код',barcode:'1234567890123456',inCells:12,toPick:3,promised:2,free:7,inDestination:0});
const preview = (body, store) => {
  const seen = new Set(), errors = [];
  const items = body.items.map((row, i) => {
    const matches = row.sku ? catalog.filter(p=>p.sku === row.sku) : catalog.filter(p=>p.barcode === row.barcode);
    const p = matches.length === 1 ? matches[0] : null;
    const error = message => errors.push({row:i+1,code:'fixture_validation',message});
    if(!p) error(matches.length > 1 ? 'Штрихкод принадлежит нескольким товарам' : 'Товар не найден');
    if(p && row.sku && row.barcode && row.barcode !== p.barcode) error('Коды указывают на разные товары');
    if(p && seen.has(p.sku)) error('Товар указан несколько раз');
    if(p) seen.add(p.sku);
    const free = store.free ?? p?.free ?? 0;
    if(!Number.isSafeInteger(Number(row.qty)) || Number(row.qty)<=0) error('Укажите целое положительное количество');
    if(Number(row.qty)>free) error('Можно перенести только ' + free + ' шт.');
    return {...row,...p,qty:Number(row.qty),free,row:i+1,expectedStatus:store.status};
  });
  return {companyId:body.companyId,toVw:body.toVw,canCommit:!errors.length,items,errors};
};
(async()=>{
  const browser = await chromium.launch({headless:true,channel:process.env.ARGUS_BROWSER_CHANNEL || 'msedge'});
  const errors = [];
  let xlsxAsset;
  const enter = async page => {
    await page.waitForFunction(()=>document.querySelector('#productFormCompany')?.options.length===2);
    await page.locator('#nav-products').click();await page.locator('#tab-warehouse').click();
    if(!await page.locator('#warehouseVwWorkspace').evaluate(el=>el.open))await page.locator('#warehouseVwWorkspace>summary').click();
    await page.evaluate(id=>setWarehouseVwCompany(id),COMPANY);
    await page.locator('[data-vw-stock="'+TARGET+'"]').waitFor();
    await page.locator('[data-vw-stock="'+TARGET+'"]').click();
    await page.locator('#warehouseVwStockPane .vws-row,#warehouseVwStockPane [data-action=confirm],#warehouseVwStockPane .vws-recovery-blocked').first().waitFor();
  };
  const prepare = async (width = 1440, options = {}) => {
    const page = options.browserContext ? await options.browserContext.newPage() : await browser.newPage({viewport:{width,height:900}});
    if(options.browserContext)await page.setViewportSize({width,height:900});
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(25000);
    const store = options.store || {calls:[],applied:0,receipts:new Map(),loseReply:false,status:'done',hold:false,release:null};
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(token=>{localStorage.setItem('argus_auth_owner',token);sessionStorage.setItem('argus_tab_role','owner');},
      'test.'+Buffer.from(JSON.stringify({role:'owner',warehouseId:options.warehouseId || 'fixture',ownerId:options.principalId || 'fixture'})).toString('base64url')+'.test');
    await page.route('**/*',async route=>{
      const req = route.request(), u = new URL(req.url()), p = u.pathname;
      if(u.origin === ORIGIN){
        if(process.env.ARGUS_PUBLIC_SITE) return route.continue();
        const local = path.resolve(ROOT,'.'+decodeURIComponent(p));
        return local.startsWith(ROOT+path.sep) && fs.existsSync(local) ? route.fulfill({path:local}) : route.fulfill({status:404,body:''});
      }
      if(u.hostname === 'cdnjs.cloudflare.com' && p === '/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'){
        if(!xlsxAsset)xlsxAsset=route.fetch().then(async response=>({status:response.status(),headers:response.headers(),body:await response.body()}));
        return route.fulfill(await xlsxAsset);
      }
      if(u.origin !== 'https://api.argus-ai.online') return route.abort();
      const body = req.postDataJSON(); store.calls.push({path:p,method:req.method(),body,query:Object.fromEntries(u.searchParams)});
      let data = [];
      if(p === '/api/leads/manage/access') return route.fulfill({status:403,json:{error:'fixture'}});
      if(p === '/api/warehouses/me') data={name:'Тестовый склад',timezone:'Europe/Moscow',stock_source:'argus',setup_at:'2001-01-01'};
      if(p === '/api/warehouses/me/readiness') data={steps:[]};
      if(p === '/api/sellers/companies') data=[{id:COMPANY,name:'Тестовый клиент А',keys:[]},{id:OTHER,name:'Тестовый клиент Б',keys:[]}];
      if(p === '/api/sellers/stock-summary') data={sellers:[]};
      if(p === '/api/alerts/today') data={ship:{},receive:{},decide:{},exchange:{sync:[]}};
      if(p === '/api/alerts') data={alerts:[]};
      if(p === '/api/inventory/advice' || p === '/api/inventory/settings') data={reasons:[]};
      if(p === '/api/sync/status') data={};
      if(p === '/api/cells/rows') data=[{id:'row',row_num:1,rack_count:1,tier_count:1,blocks:[{id:'block',rack_start:1,rack_end:1,tier_start:1,tier_end:1,state:'empty',stock:[]}]}];
      if(p === '/api/vwarehouses') data={warehouses:[{id:TARGET,name:'Новое направление',marketplace:'wb',keepSeparate:false},{id:SOURCE,name:'Другой источник',marketplace:'other',keepSeparate:false}],rights:{decide:true},wbChoices:[]};
      if(p === '/api/vwarehouses/transfer-candidates'){
        if(store.hold){store.hold=false;await new Promise(resolve=>{store.release=resolve;});}
        const q = u.searchParams.get('q') || '', start = Number(u.searchParams.get('cursor') || 0), limit=Number(u.searchParams.get('limit') || 50);
        const found = catalog.filter(r=>[r.sku,r.name,r.barcode].some(v=>v.includes(q)));
        data={companyId:u.searchParams.get('companyId'),toVw:TARGET,fromVw:u.searchParams.get('fromVw') || null,
          items:found.slice(start,start+limit).map(r=>({...r,free:store.free ?? r.free})),nextCursor:start+limit<found.length?String(start+limit):null};
      }
      if(p === '/api/vwarehouses/transfers/preview') data=preview(body,store);
      if(p === '/api/vwarehouses/transfers/batch'){
        if(store.denied)return route.fulfill({status:403,json:{error:'Недостаточно прав для проверки операции'}});
        if(store.reject){store.reject=false;return route.fulfill({status:409,json:{error:'Товары не перенесены: остаток изменился',errors:[{row:1,sku:body.items[0].sku,free:2}]}});}
        if(!store.receipts.has(body.requestId)){
          store.applied++;store.receipts.set(body.requestId,{requestId:body.requestId,replayed:false,items:body.items.map((r,i)=>({...r,status:store.status,name:catalog.find(p=>p.sku===r.sku)?.name,id:'transfer-'+i}))});
        }
        data={...store.receipts.get(body.requestId),replayed:store.applied>0};
        if(store.malformed){store.malformed=false;return route.fulfill({json:{requestId:body.requestId}});}
        if(store.loseReply){store.loseReply=false;return route.abort('failed');}
      }
      return route.fulfill({json:data});
    });
    await page.goto(ORIGIN+'/cabinet_main.html');
    await page.locator('#view-home.active').waitFor();
    await enter(page);
    return {page,store};
  };
  const action = (page, name) => {
    const control = page.locator('#warehouseVwStockPane [data-action="'+name+'"]');
    return name === 'close' ? control.first() : control;
  };
  const screenshot = async (page,name) => {
    if(!process.env.ARGUS_SCREENSHOT_DIR) return;
    fs.mkdirSync(process.env.ARGUS_SCREENSHOT_DIR,{recursive:true});
    await page.screenshot({animations:'disabled',path:path.join(process.env.ARGUS_SCREENSHOT_DIR,name+'.png')});
  };
  const recoveryRecords = page => page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('argus_vw_transfer_pending_v1:')).map(key=>JSON.parse(localStorage.getItem(key))));
  try{
    const {page,store}=await prepare();
    assert.equal(await page.locator('#view-warehouse').getAttribute('hidden'),null);
    assert.equal(await page.locator('#whMapWrap').isVisible(),false);
    assert.equal(await action(page,'qty').first().inputValue(),'7','quantity defaults to transferable free, not all stock');
    const rows=page.locator('.vws-row');
    const start=await rows.nth(0).locator('td').nth(1).boundingBox(),end=await rows.nth(2).locator('td').nth(1).boundingBox();
    await page.mouse.move(start.x+20,start.y+20);await page.mouse.down();
    await page.mouse.move(end.x+20,end.y+20,{steps:12});await page.mouse.up();
    assert.equal(await page.locator('.vws-row input[type=checkbox]:checked').count(),3,'mouse paint selects several rows');
    await action(page,'qty').first().fill('2');
    assert.equal(await page.locator('.vws-row input[type=checkbox]:checked').count(),3,'editing quantity preserves selection');
    await action(page,'page').last().click();await page.locator('.vws-row[data-sku="00051"]').waitFor();
    await page.locator('.vws-row[data-sku="00051"] [data-action=row-select]').check();
    await action(page,'review').click();await action(page,'confirm').waitFor();
    assert.equal(store.calls.filter(c=>c.path.endsWith('/batch')).length,0,'review does not mutate');
    assert.ok((await page.locator('.vws-review-head').innerText()).includes('4'));
    await action(page,'confirm').click();await page.locator('.vws-result').waitFor();
    assert.equal(store.calls.filter(c=>c.path.endsWith('/batch')).length,1,'one batch replaces per-product dialogs');
    const sent=store.calls.find(c=>c.path.endsWith('/batch')).body;
    assert.equal(sent.items.length,4);assert.equal(sent.items.find(r=>r.sku==='00001').qty,2);assert.equal(sent.companyId,COMPANY);assert.equal(sent.toVw,TARGET);
    await screenshot(page,'bulk-result-1440');await action(page,'close').click();
    assert.equal(await page.locator('#warehouseVwStockPane').isVisible(),false);
    assert.equal(await page.locator('#warehouseVwWorkspace').isVisible(),true);
    await page.close();

    // A completed request with a lost response must retry the identical request.
    const retry=await prepare();retry.store.loseReply=true;
    await action(retry.page,'row-select').first().check();await action(retry.page,'review').click();await action(retry.page,'confirm').click();
    await retry.page.waitForFunction(()=>document.querySelector('[data-action=confirm]')?.textContent.includes('Повторить'));
    const original=retry.store.calls.find(c=>c.path.endsWith('/batch')).body;
    const stored=await recoveryRecords(retry.page);
    assert.equal(stored.length,1);assert.deepEqual(stored[0].payload,original);
    assert.deepEqual(Object.keys(stored[0]).sort(),['payload','scope','version']);
    assert.deepEqual(Object.keys(stored[0].payload.items[0]).sort(),['fromVw','qty','sku'],'recovery has no names, barcodes or tokens');
    await retry.page.reload();await enter(retry.page);
    assert.equal(await action(retry.page,'pick').isDisabled(),true,'F5 restores the exact locked operation');
    retry.store.denied=true;await action(retry.page,'confirm').click();
    await retry.page.waitForFunction(()=>document.querySelector('[data-role=notice]').textContent.includes('Недостаточно прав'));
    assert.equal((await recoveryRecords(retry.page)).length,1,'403 on retry cannot prove that the earlier request was rolled back');
    retry.store.denied=false;
    await action(retry.page,'confirm').waitFor();await action(retry.page,'confirm').click();await retry.page.locator('.vws-result').waitFor();
    const requests=retry.store.calls.filter(c=>c.path.endsWith('/batch'));
    assert.equal(requests.length,3);requests.slice(1).forEach(request=>assert.deepEqual(request.body,original));assert.equal(retry.store.applied,1);
    assert.equal((await recoveryRecords(retry.page)).length,0,'confirmed completion clears recovery');
    await retry.page.close();

    // Closing a tab preserves unknown results, but another principal cannot resume them.
    const tabContext=await browser.newContext();
    const tab=await prepare(1440,{browserContext:tabContext});tab.store.malformed=true;
    await action(tab.page,'row-select').first().check();await action(tab.page,'review').click();await action(tab.page,'confirm').click();
    await tab.page.waitForFunction(()=>document.querySelector('[data-action=confirm]')?.textContent.includes('Повторить'));
    const tabPayload=tab.store.calls.find(c=>c.path.endsWith('/batch')).body;await tab.page.close();
    const foreign=await prepare(1440,{browserContext:tabContext,store:tab.store,principalId:'different-owner'});
    assert.equal(await action(foreign.page,'confirm').count(),0,'another principal sees a fresh selection, never a foreign recovery');
    assert.equal(tab.store.calls.filter(c=>c.path.endsWith('/batch')).length,1,'opening under another principal cannot submit the saved packet');
    await foreign.page.close();
    const otherWarehouse=await prepare(1440,{browserContext:tabContext,store:tab.store,warehouseId:'different-physical-warehouse'});
    assert.equal(await action(otherWarehouse.page,'confirm').count(),0,'physical warehouse is also part of recovery scope');await otherWarehouse.page.close();
    const reopened=await prepare(1440,{browserContext:tabContext,store:tab.store});
    assert.equal(await action(reopened.page,'pick').isDisabled(),true);
    await action(reopened.page,'confirm').click();await reopened.page.locator('.vws-result').waitFor();
    assert.deepEqual(tab.store.calls.filter(c=>c.path.endsWith('/batch')).at(-1).body,tabPayload);assert.equal(tab.store.applied,1);
    await reopened.page.close();await tabContext.close();

    const corrupt=await prepare();corrupt.store.loseReply=true;
    await action(corrupt.page,'row-select').first().check();await action(corrupt.page,'review').click();await action(corrupt.page,'confirm').click();
    await corrupt.page.waitForFunction(()=>document.querySelector('[data-action=confirm]')?.textContent.includes('Повторить'));
    const corruptKey=await corrupt.page.evaluate(()=>Object.keys(localStorage).find(key=>key.startsWith('argus_vw_transfer_pending_v1:')));
    const corruptedRecord=await corrupt.page.evaluate(key=>{const saved=JSON.parse(localStorage.getItem(key));saved.payload.items.push({...saved.payload.items[0]});const raw=JSON.stringify(saved);localStorage.setItem(key,raw);return raw;},corruptKey);
    await corrupt.page.reload();await enter(corrupt.page);
    assert.equal(await corrupt.page.locator('.vws-recovery-blocked').count(),1);
    assert.equal(await action(corrupt.page,'confirm').count(),0,'corrupt pending cannot fail open into a new operation');
    assert.equal(await action(corrupt.page,'row-select').count(),0);
    assert.equal(await corrupt.page.evaluate(key=>localStorage.getItem(key),corruptKey),corruptedRecord,'corrupt recovery is not deleted or replaced');
    const invalidRowRecord=JSON.parse(corruptedRecord);invalidRowRecord.payload.items=[null];
    const invalidSourceRecord=JSON.parse(corruptedRecord);invalidSourceRecord.payload.items=[{...invalidSourceRecord.payload.items[0],fromVw:'not-a-uuid'}];
    for(const raw of ['null',JSON.stringify(invalidRowRecord),JSON.stringify(invalidSourceRecord)]){
      await corrupt.page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key:corruptKey,raw});
      await action(corrupt.page,'close').click();await corrupt.page.locator('[data-vw-stock="'+TARGET+'"]').click();await corrupt.page.locator('.vws-recovery-blocked').waitFor();
      assert.equal(await action(corrupt.page,'confirm').count(),0);assert.equal(await action(corrupt.page,'row-select').count(),0);
      assert.equal(await corrupt.page.evaluate(key=>localStorage.getItem(key),corruptKey),raw);
    }
    assert.equal(corrupt.store.calls.filter(c=>c.path.endsWith('/batch')).length,1);await corrupt.page.close();

    const noStorage=await prepare();
    await noStorage.page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('argus_vw_transfer_pending_v1:'))throw new DOMException('Synthetic storage failure','QuotaExceededError');return original.call(this,key,value);};});
    const unloadBlocked=page=>page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});
    assert.equal(await unloadBlocked(noStorage.page),false,'beforeunload does not warn without an unknown request');
    noStorage.store.loseReply=true;
    await action(noStorage.page,'row-select').first().check();await action(noStorage.page,'review').click();await action(noStorage.page,'confirm').click();
    await noStorage.page.waitForFunction(()=>document.querySelector('[data-action=confirm]')?.textContent.includes('Повторить'));
    assert.ok((await noStorage.page.locator('[data-role=notice]').innerText()).includes('не обновляйте и не закрывайте'));
    assert.equal(await unloadBlocked(noStorage.page),true,'unknown request without durable storage warns before leaving');
    await action(noStorage.page,'confirm').click();await noStorage.page.locator('.vws-result').waitFor();
    assert.equal(await unloadBlocked(noStorage.page),false,'known completion removes the unload warning');assert.equal(noStorage.store.applied,1);await noStorage.page.close();

    const searchCase=await prepare();
    await action(searchCase.page,'row-select').first().check();
    await action(searchCase.page,'search').fill('00009');
    await searchCase.page.locator('.vws-row[data-sku="00009"]').waitFor();
    assert.ok(await action(searchCase.page,'search').evaluate(el=>el===document.activeElement),'search keeps focus after server response');
    await action(searchCase.page,'search').fill('');
    await searchCase.page.waitForFunction(()=>document.querySelectorAll('.vws-row').length===50);
    assert.equal(await searchCase.page.locator('.vws-row[data-sku="00001"] input[type=checkbox]').isChecked(),true,'search preserves selected rows');
    searchCase.store.reject=true;
    await action(searchCase.page,'review').click();await action(searchCase.page,'confirm').click();
    await searchCase.page.waitForFunction(()=>document.querySelector('[data-role=notice]').textContent.includes('остаток изменился'));
    assert.equal(searchCase.store.applied,0,'a rejected batch changes nothing');
    assert.equal((await recoveryRecords(searchCase.page)).length,0,'definitive 409 clears the rejected packet');
    await action(searchCase.page,'pick').click();await action(searchCase.page,'qty').first().fill('2');
    await action(searchCase.page,'review').click();await action(searchCase.page,'confirm').click();
    await searchCase.page.locator('.vws-result').waitFor();
    assert.equal(searchCase.store.applied,1,'a definitive rejection allows correction');
    await searchCase.page.close();

    const stale=await prepare();stale.store.hold=true;
    await action(stale.page,'search').fill('00012');
    await stale.page.waitForTimeout(400);assert.equal(typeof stale.store.release,'function');
    await stale.page.locator('#nav-journal').click();stale.store.release();
    await stale.page.waitForTimeout(80);
    assert.equal(await stale.page.locator('#warehouseVwStockPane').isVisible(),false,'leaving closes old workspace');
    assert.equal(await stale.page.locator('.vws-row').count(),0,'late response cannot rebuild the closed workspace');
    await stale.page.locator('#nav-products').click();await stale.page.locator('#tab-warehouse').click();
    await stale.page.locator('[data-vw-stock="'+TARGET+'"]').click();await stale.page.locator('.vws-row').first().waitFor();
    await stale.page.evaluate(id=>setWarehouseVwCompany(id),OTHER);
    assert.equal(await stale.page.locator('#warehouseVwStockPane').isVisible(),false,'switching client closes its previous workspace');
    await stale.page.close();

    for(const status of ['waiting_seller','to_move']){
      const current=await prepare();current.store.status=status;
      await action(current.page,'row-select').first().check();await action(current.page,'review').click();await action(current.page,'confirm').click();
      await current.page.locator('.vws-result').waitFor();
      assert.ok((await current.page.locator('.vws-result').innerText()).includes(status==='waiting_seller'?'Ожидает согласия':'Созданы задания'));
      await current.page.close();
    }

    // True XLSX import, with string leading zeros and duplicate barcodes.
    const fileCase=await prepare();
    await fileCase.page.waitForFunction(()=>!!window.XLSX);
    await action(fileCase.page,'import').click();
    const bytes=await fileCase.page.evaluate(()=>{
      const book=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Артикул Аргуса','Штрихкод','Количество'],
        ['00001','001234',2],['00001','',1],['','001234',1],['unknown','',1],['00003','',8]]),'Товары');
      return Array.from(new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'})));
    });
    await fileCase.page.locator('#warehouseVwStockPane input[type=file]').setInputFiles({name:'synthetic-stock.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)});
    await fileCase.page.locator('.vws-import-mapping').waitFor();
    for(const [name,index] of [['sku','0'],['barcode','1'],['qty','2']]){
      const option=action(fileCase.page,'map-'+name).filter({hasText:new RegExp('^'+['A','B','C'][Number(index)]+' —')});
      if(!(await option.isVisible())) await fileCase.page.locator('.vws-import-mapping details').nth(2+['sku','barcode','qty'].indexOf(name)).locator('summary').click();
      await option.click();
    }
    await action(fileCase.page,'parse').click();await fileCase.page.locator('.vws-import-summary').waitFor();
    assert.equal(await action(fileCase.page,'apply-import').isDisabled(),true,'duplicate, unknown, ambiguous and excessive rows block import');
    assert.equal(fileCase.store.calls.filter(c=>c.path.endsWith('/batch')).length,0,'import preview does not transfer');
    await screenshot(fileCase.page,'excel-errors-1440');
    for(const line of [3,4,5,6]) await fileCase.page.locator('[data-action=exclude][data-line="'+line+'"]').click();
    await action(fileCase.page,'parse').click();
    await fileCase.page.waitForFunction(()=>!document.querySelector('[data-action=apply-import]').disabled);
    await action(fileCase.page,'apply-import').click();await action(fileCase.page,'review').click();await action(fileCase.page,'confirm').click();
    await fileCase.page.locator('.vws-result').waitFor();
    const imported=fileCase.store.calls.find(c=>c.path.endsWith('/batch')).body;
    assert.equal(imported.items.length,1);assert.equal(imported.items[0].sku,'00001');assert.equal(imported.items[0].qty,2);
    await fileCase.page.close();

    const precision=await prepare();await precision.page.waitForFunction(()=>!!window.XLSX);await action(precision.page,'import').click();
    const upload=async (name,bytes)=>precision.page.locator('#warehouseVwStockPane input[type=file]').setInputFiles({name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)});
    for(const columns of [101,100]){
      const wideBytes=await precision.page.evaluate(count=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([Array.from({length:count},(_,i)=>'Столбец '+i),['00001',1]]),'Товары');return Array.from(new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'})));},columns);
      await upload('synthetic-'+columns+'-columns.xlsx',wideBytes);
      if(columns===101){await precision.page.waitForFunction(()=>document.querySelector('[data-role=notice]').textContent.includes('100 столбцов'));assert.equal(await precision.page.locator('.vws-import-mapping').count(),0,'101 columns exceed the bound');}
      else await precision.page.locator('.vws-import-mapping').waitFor();
    }
    const precisionBytes=await precision.page.evaluate(()=>{
      const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['Артикул','Штрихкод','Количество'],[1234567890123456,'',2],['1234567890123456','',2],['00003',1234567890123456,1],[1,'',2]]);
      sheet.A5.z='00000';XLSX.utils.book_append_sheet(book,sheet,'Товары');return Array.from(new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'})));
    });
    await upload('synthetic-code-precision.xlsx',precisionBytes);await precision.page.locator('.vws-import-mapping').waitFor();
    for(const [name,index] of [['sku','0'],['barcode','1'],['qty','2']]){await precision.page.locator('.vws-import-mapping details').nth(2+['sku','barcode','qty'].indexOf(name)).locator('summary').click();await action(precision.page,'map-'+name).filter({hasText:new RegExp('^'+['A','B','C'][Number(index)]+' —')}).click();}
    await action(precision.page,'parse').click();await precision.page.locator('.vws-import-summary').waitFor();
    for(const line of [2,4])assert.ok((await precision.page.locator('[data-status-line="'+line+'"]').innerText()).includes('15 цифр'),'16-digit numeric identifiers must be text');
    assert.ok((await precision.page.locator('tr[data-line="3"]').innerText()).includes('1234567890123456'),'16-digit text remains exact');
    assert.ok((await precision.page.locator('tr[data-line="5"]').innerText()).includes('00001'),'short formatted numeric code keeps leading zeros');
    assert.equal(await action(precision.page,'apply-import').isDisabled(),true);
    assert.equal(precision.store.calls.filter(c=>c.path.endsWith('/batch')).length,0);
    for(const line of [2,4])await precision.page.locator('[data-action=exclude][data-line="'+line+'"]').click();
    await action(precision.page,'parse').click();await precision.page.waitForFunction(()=>!document.querySelector('[data-action=apply-import]').disabled);
    await action(precision.page,'apply-import').click();await action(precision.page,'review').click();await action(precision.page,'confirm').click();await precision.page.locator('.vws-result').waitFor();
    assert.deepEqual(precision.store.calls.find(c=>c.path.endsWith('/batch')).body.items.map(row=>row.sku).sort(),['00001','1234567890123456']);await precision.page.close();

    for(const width of [375,1440,2048,2560]){
      const responsive=await prepare(width);
      await screenshot(responsive.page,'bulk-select-'+width);
      assert.ok(await responsive.page.locator('#view-warehouse').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'bulk workspace fits '+width);
      const box=await responsive.page.locator('#view-warehouse').boundingBox();
      await responsive.page.mouse.move(box.x+3,box.y+200);await responsive.page.mouse.wheel(0,500);
      await responsive.page.waitForFunction(()=>document.querySelector('#view-warehouse').scrollTop>100);
      await action(responsive.page,'row-select').first().check();await action(responsive.page,'review').click();
      await action(responsive.page,'confirm').waitFor();await screenshot(responsive.page,'bulk-review-'+width);
      await responsive.page.close();
    }
    assert.deepEqual(errors,[]);
    console.log('PASS direct VW bulk selection/drag/quantities/paging/search; reviewed batch; durable F5/tab recovery and principal/warehouse isolation; corrupt recovery blocked; storage/unload fallback; lost-response/403 retry and definitive rejection; stale guards; truthful statuses; XLSX validation, 15-digit precision and 100-column bound; four viewports/wheel.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
