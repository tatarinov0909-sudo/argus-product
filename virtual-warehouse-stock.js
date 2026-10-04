/* Добавление товаров в виртуальный склад. Остатки и решение о переносе подтверждает сервер. */
(function(){
  'use strict';
  const PAGE_SIZE = 50, MAX_FILE = 10 * 1024 * 1024, MAX_FILE_ROWS = 10000, MAX_ITEMS = 200;
  const mounted = new WeakMap();
  const pending = new Map();
  const STORAGE_PREFIX = 'argus_vw_transfer_pending_v1:';
  let activeScope = null;
  const normalizeScope = value => {
    if(!value || !['owner','manager'].includes(value.role))return null;
    const principalId=value.role==='owner'?value.ownerId:value.staffKeyId;
    return typeof principalId==='string'&&principalId&&typeof value.warehouseId==='string'&&value.warehouseId
      ? {role:value.role,principalId,warehouseId:value.warehouseId}:null;
  };
  const sameScope = (a,b) => !!a&&!!b&&a.role===b.role&&a.principalId===b.principalId&&a.warehouseId===b.warehouseId;
  function currentScope(){
    const token=localStorage.getItem('argus_token');if(!token)return null;
    try{
      const bytes=Uint8Array.from(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
      return normalizeScope(JSON.parse(new TextDecoder().decode(bytes)));
    }catch(_){return null;}
  }
  function persist(key,record){
    pending.set(key,record);
    try{localStorage.setItem(STORAGE_PREFIX+key,JSON.stringify({version:1,scope:record.scope,payload:record.payload}));record.durable=true;}
    catch(_){record.durable=false;}
  }
  function forget(key){pending.delete(key);try{localStorage.removeItem(STORAGE_PREFIX+key);return true;}catch(_){return false;}}
  function recover(key,scope,companyId,toVw){
    const memory=pending.get(key);if(memory)return memory;
    const raw=localStorage.getItem(STORAGE_PREFIX+key);if(!raw)return null;
    const invalid=()=>{const error=new Error('Сохранённая операция повреждена. Не создавайте новый перенос: сначала проверьте предыдущий результат.');error.recoveryInvalid=true;return error;};
    let saved;try{saved=JSON.parse(raw);}catch(_){throw invalid();}const body=saved?.payload;
    if(saved?.version!==1||!sameScope(saved.scope,scope)||body?.companyId!==companyId||body.toVw!==toVw
      ||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)
      ||!Array.isArray(body.items)||!body.items.length||body.items.length>MAX_ITEMS
      ||body.items.some(row=>!row||typeof row.sku!=='string'||!row.sku||!Number.isSafeInteger(row.qty)||row.qty<=0||row.qty>2147483647
        ||row.fromVw!==null&&(typeof row.fromVw!=='string'||! /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.fromVw)))
      ||new Set(body.items.map(row=>row.sku)).size!==body.items.length)throw invalid();
    const record={scope,payload:body,durable:true,selected:body.items.map(row=>({...row,name:row.sku,qty:String(row.qty)})),sources:[],free:[]};
    pending.set(key,record);return record;
  }
  window.addEventListener('beforeunload',event=>{
    let scope;try{scope=currentScope()||activeScope;}catch(_){scope=activeScope;}
    if([...pending.values()].some(record=>!record.durable&&sameScope(record.scope,scope))){event.preventDefault();event.returnValue='';}
  });
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => value == null ? '—' : Number(value).toLocaleString('ru-RU');
  const integer = value => { const s=String(value).trim().replace(/[ \u00a0\u202f]/g,'');const n=Number(s);return /^\d+$/.test(s)&&Number.isSafeInteger(n)&&n>0?n:null; };
  const keyOf = (sku, source) => JSON.stringify([source || null, sku]);
  const button = (action, title, extra = '') => '<button type="button" class="vws-button" data-action="' + action + '" ' + extra + '>' + title + '</button>';
  const choice = (label, current, options, action) => '<details class="vws-choice"><summary><span>' + esc(label) + '</span><b>' + esc(current) + '</b></summary><div class="vws-choice-menu">'
    + options.map(o => button(action, esc(o.label), 'data-value="' + esc(o.value) + '"')).join('') + '</div></details>';
  function open(context){
    const host = context.host;
    if(!host || typeof host.addEventListener !== 'function' || typeof context.request !== 'function' || !context.companyId || !context.warehouse?.id) throw new Error('Не указан клиент или виртуальный склад.');
    mounted.get(host)?.destroy();
    const events = new AbortController();
    const suppliedScope=normalizeScope(context.sessionScope);
    let authScope,storageUnavailable=false;
    try{const current=currentScope();authScope=suppliedScope?sameScope(suppliedScope,current)?suppliedScope:null:current;}
    catch(_){authScope=suppliedScope;storageUnavailable=true;}
    activeScope=authScope;
    const sessionKey = JSON.stringify([authScope?.role,authScope?.principalId,authScope?.warehouseId,context.companyId,context.warehouse.id]);
    const state = { rows:[], sources:[], source:null, selected:new Map(), drafts:new Map(), search:'', page:0, mode:'pick', loading:true,
      message:'', error:'', workbook:null, sheet:'', header:0, mapping:{sku:'',barcode:'',qty:''}, imported:[], importPage:0,
      reviewPage:0, busy:false, closed:false, run:0, fileRun:0, free:new Map(), requestId:null, payload:null, locked:false, paint:null,
      cursors:[null],nextCursor:null,previewReady:false,validationErrors:new Map(),searchTimer:null,importVerified:false,focusVersion:0,storageWarning:'' };
    const el = selector => host.querySelector(selector);
    const sourceName = source => source == null ? 'Остальной товар' : state.sources.find(s => s.id === source)?.name || 'Склад источника';
    const freeOf = (sku, source) => state.free.has(keyOf(sku, source)) ? state.free.get(keyOf(sku, source)) : null;
    const selectedRows = () => [...state.selected.values()];
    const total = () => selectedRows().reduce((n, row) => n + (integer(row.qty) || 0), 0);
    const rowError = row => {
      const qty = integer(row.qty), free = freeOf(row.sku, row.fromVw);
      if(state.validationErrors.has(keyOf(row.sku,row.fromVw)))return state.validationErrors.get(keyOf(row.sku,row.fromVw));
      if(!qty) return 'Укажите целое количество больше нуля.';
      if(free == null) return 'Доступное для переноса количество ещё не подтверждено сервером.';
      return qty > free ? 'Можно перенести не больше ' + fmt(free) + ' шт.' : '';
    };
    const invalidate = () => { if(!state.locked){ state.requestId = null; state.payload = null; state.previewReady=false;state.validationErrors.clear(); } state.message = ''; state.error = '';notice(); };
    function close(notify = false){
      state.closed = true; state.run++;state.fileRun++;clearTimeout(state.searchTimer);events.abort(); mounted.delete(host); host.innerHTML = ''; host.hidden = true;
      if(notify) context.onClose?.();
    }
    const controller = {close,destroy:close,reload:load}; mounted.set(host, controller); host.hidden = false;
    function shell(){
      host.innerHTML = '<div class="vws-panel"><div class="vws-heading"><div><p class="vws-eyebrow">' + esc(context.companyName || 'Клиент') + '</p><h2>Добавить товары в «' + esc(context.warehouse.name) + '»</h2>'
        + '<p class="vws-sub">Выберите товары и количество, затем проверьте список.</p></div>'
        + button('close','← К списку складов') + '</div><div class="vws-notice" data-role="notice" role="status" hidden></div>'
        + '<div data-role="content"></div></div>';
    }
    function notice(){
      const box = el('[data-role=notice]'); if(!box) return;
      box.hidden = !state.error && !state.message && !state.storageWarning;
      box.textContent = [state.error || state.message,state.storageWarning].filter(Boolean).join(' ');
      box.classList.toggle('vws-error',!!state.error||!!state.storageWarning); box.setAttribute('role',state.error||state.storageWarning?'alert':'status');
    }
    async function load(){
      if(state.locked){render();return;}
      const run = ++state.run; state.loading = true; state.error = ''; render();
      try{
        const warehouses = await context.request('/api/vwarehouses?companyId=' + encodeURIComponent(context.companyId));
        if(state.closed || run !== state.run) return;
        if(!Array.isArray(warehouses.warehouses))throw new Error('Не удалось прочитать список складов клиента.');
        state.sources = warehouses.warehouses.filter(w => w.id !== context.warehouse.id);
        if(state.source && !state.sources.some(w => w.id === state.source)) state.source = null;
        await loadCandidates();return;
      } catch(error){ if(state.closed || run !== state.run) return; state.error = error.message || 'Не удалось загрузить товары.'; }
      state.loading = false; render();
    }
    async function loadCandidates(reset=false){
      if(reset){state.page=0;state.cursors=[null];state.nextCursor=null;}
      const run=++state.run,source=state.source,search=state.search;
      const searchInput=el('[data-action=search]'),restoreSearch=searchInput===document.activeElement,caret=searchInput?.selectionStart,focusVersion=state.focusVersion;
      state.loading=true;state.error='';render();
      const query=new URLSearchParams({companyId:context.companyId,toVw:context.warehouse.id,limit:String(PAGE_SIZE)});
      if(source)query.set('fromVw',source);if(search)query.set('q',search);if(state.cursors[state.page])query.set('cursor',state.cursors[state.page]);
      try{
        const data=await context.request('/api/vwarehouses/transfer-candidates?'+query);
        if(state.closed||run!==state.run)return;
        if(!Array.isArray(data.items))throw new Error('Сервер вернул список товаров в неизвестном формате.');
        const seen=new Set();state.rows=data.items.map(row=>{
          const sku=String(row.sku??'');if(!sku||seen.has(sku)||!Number.isSafeInteger(row.free)||row.free<0)throw new Error('Не удалось подтвердить доступное количество товаров.');
          seen.add(sku);state.free.set(keyOf(sku,source),row.free);
          return {...row,sku,name:String(row.name||sku),barcode:String(row.barcode||'')};
        });state.nextCursor=data.nextCursor||null;
      }catch(error){if(state.closed||run!==state.run)return;state.rows=[];state.nextCursor=null;state.error=error.message||'Не удалось загрузить товары.';}
      state.loading=false;render();
      if(restoreSearch&&state.focusVersion===focusVersion&&state.mode==='pick'){const input=el('[data-action=search]');input?.focus();if(input&&caret!=null)input.setSelectionRange(caret,caret);}
    }
    function pager(count, page, action){
      const pages = Math.max(1,Math.ceil(count/PAGE_SIZE));
      return '<div class="vws-pager">' + button(action,'← Назад','data-page="' + (page-1) + '"' + (page<=0?' disabled':''))
        + '<span>Страница ' + (page+1) + ' из ' + pages + ' · ' + fmt(count) + ' строк</span>' + button(action,'Далее →','data-page="' + (page+1) + '"' + (page+1>=pages?' disabled':'')) + '</div>';
    }
    function selectionSummary(){
      return '<div class="vws-selection"><div><b data-role="selected-total">Выбрано ' + fmt(state.selected.size) + ' позиций · ' + fmt(total()) + ' шт.</b>'
        + '<p class="vws-sub">До 200 позиций за один раз. Количество можно изменить; выбор сохраняется между страницами и при поиске.</p></div><div class="vws-actions">'
        + button('clear','Снять выбор',(!state.selected.size||state.locked?' disabled':'')) + button('review','Проверить список','data-role="review"' + (!state.selected.size?' disabled':'')) + '</div></div>';
    }
    function pickHtml(){
      const rows=state.rows;
      const options = [{value:'',label:'Остальной товар'},...state.sources.map(w=>({value:w.id,label:w.name}))];
      return '<div class="vws-toolbar">' + choice('Откуда добавить товар',sourceName(state.source),options,'source')
        + '<label class="vws-search"><span>Найти товар</span><input type="search" data-action="search" aria-label="Найти товар" placeholder="Название, артикул или штрихкод" value="' + esc(state.search) + '"></label>'
        + '<div class="vws-actions">' + button('import','Загрузить Excel') + button('template','Скачать шаблон') + '</div></div>'
        + selectionSummary()+'<p class="vws-sub vws-instruction">Отмечайте строки галочками или проводите левой кнопкой мыши по товарам.</p>'
        + (rows.length ? '<div class="vws-table-wrap"><table class="vws-table"><colgroup><col class="vws-check-col"><col class="vws-product-col"><col span="3" class="vws-number-col"><col class="vws-qty-col"></colgroup><thead><tr><th><input type="checkbox" data-action="page-select" aria-label="Выбрать товары на этой странице"></th><th>Товар</th><th>В ячейках источника</th><th>Можно перенести</th><th>Уже в этом складе</th><th>Добавить, шт.</th></tr></thead><tbody>'
          + rows.map(row => {
            const k = keyOf(row.sku,state.source), picked = state.selected.get(k), free = row.free, qty = picked?.qty ?? state.drafts.get(k) ?? String(free || '');
            return '<tr class="vws-row' + (picked?' vws-selected':'') + '" data-key="' + esc(k) + '" data-sku="' + esc(row.sku) + '"><td data-label="Выбрать"><input type="checkbox" data-action="row-select" aria-label="Выбрать ' + esc(row.name) + '"' + (picked?' checked':'') + (free<=0&&!picked?' disabled':'') + '></td>'
              + '<td data-label="Товар"><b>' + esc(row.name) + '</b><div class="vws-identifiers"><span>Артикул: ' + esc(row.sku) + '</span>' + (row.barcode?'<span>Штрихкод: '+esc(row.barcode)+'</span>':'') + '</div></td>'
              + '<td class="vws-num" data-label="В ячейках источника">' + fmt(row.inCells) + '</td><td class="vws-num" data-label="Можно перенести">' + fmt(free) + '</td><td class="vws-num" data-label="Уже в этом складе">' + fmt(row.inDestination) + '</td>'
              + '<td data-label="Добавить, шт."><input class="vws-quantity" type="text" inputmode="numeric" data-action="qty" data-key="' + esc(k) + '" aria-label="Количество ' + esc(row.name) + '" value="' + esc(qty) + '"' + (free<=0?' disabled':'') + '></td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="vws-empty"><b>'+ (state.search?'Товар не найден':'На этой странице товаров нет') + '</b><p>Измените поиск или источник товара. Новый каталог клиента загружается в разделе «Склад и товары».</p></div>')
        + '<div class="vws-pager">'+button('page','← Назад','data-page="'+(state.page-1)+'"'+(state.page<=0?' disabled':''))+'<span>Страница '+(state.page+1)+' · '+rows.length+' строк</span>'+button('page','Далее →','data-page="'+(state.page+1)+'"'+(!state.nextCursor?' disabled':''))+'</div>';
    }
    function importHtml(){
      let html = '<div class="vws-import-head"><div><h3>Загрузка из Excel</h3><p class="vws-sub">Файл остаётся в браузере. Нужны артикул или штрихкод и целое количество. Каждый столбец выбирается явно.</p></div><div class="vws-actions">'
        + button('pick','← Выбор товаров') + button('file','Выбрать файл') + button('template','Скачать шаблон') + '</div></div><input type="file" data-role="file" accept=".xlsx,.xls,.csv" hidden>';
      if(!state.workbook) return html + '<div class="vws-empty">Выберите .xlsx, .xls или .csv до 10 МБ. Формулы в используемых столбцах не принимаются.</div>';
      const sheet = state.workbook.Sheets[state.sheet], range = window.XLSX.utils.decode_range(sheet['!ref']);
      const columns = [];
      for(let c=range.s.c;c<=range.e.c;c++) columns.push({value:String(c),label:window.XLSX.utils.encode_col(c)+' — '+(cellLabel(sheet,state.header,c)||'Без заголовка')});
      const optional = [{value:'',label:'Не использовать'},...columns];
      const heads=[];for(let r=range.s.r;r<=Math.min(range.e.r,range.s.r+19);r++) heads.push({value:String(r),label:'Строка '+(r+1)+' — '+columns.slice(0,4).map((_,i)=>cellLabel(sheet,r,range.s.c+i)).filter(Boolean).join(' · ')});
      html += '<div class="vws-import-mapping">' + choice('Лист',state.sheet,state.workbook.SheetNames.map(n=>({value:n,label:n})),'sheet')
        + choice('Строка заголовков','Строка '+(state.header+1),heads,'header')
        + choice('Артикул',columns.find(c=>c.value===state.mapping.sku)?.label||'Не использовать',optional,'map-sku')
        + choice('Штрихкод',columns.find(c=>c.value===state.mapping.barcode)?.label||'Не использовать',optional,'map-barcode')
        + choice('Количество',columns.find(c=>c.value===state.mapping.qty)?.label||'Выберите столбец',optional,'map-qty') + '</div>'
        + '<p class="vws-sub">Источник для всех строк файла: <b>' + esc(sourceName(state.source)) + '</b>. Коды длиннее 15 значащих цифр укажите в Excel текстом. Ведущие нули коротких числовых кодов сохраняются по формату ячейки.</p>'
        + '<div class="vws-actions">' + button('parse',state.imported.length?'Проверить ещё раз':'Проверить строки файла') + '</div>';
      if(!state.imported.length) return html;
      const active = state.imported.filter(row=>!row.excluded), problems=active.filter(row=>row.error).length, rows=state.imported.slice(state.importPage*PAGE_SIZE,(state.importPage+1)*PAGE_SIZE);
      html += '<div class="vws-import-summary" data-role="import-summary">' + importSummary(active,problems) + '</div><div class="vws-table-wrap"><table class="vws-table vws-import-table"><thead><tr><th>Строка</th><th>Товар и код из файла</th><th>Количество</th><th>Проверка</th><th>Действие</th></tr></thead><tbody>'
        + rows.map(row=>'<tr class="'+(row.excluded?'vws-excluded':'')+'" data-line="'+row.line+'"><td class="vws-num" data-label="Строка">'+row.line+'</td><td data-label="Товар"><b>'+esc(row.product?.name||row.sku||row.barcode||'Код не указан')+'</b><div class="vws-identifiers">'+esc([row.sku?'Артикул: '+row.sku:'',row.barcode?'Штрихкод: '+row.barcode:''].filter(Boolean).join(' · '))+'</div></td><td data-label="Количество"><input type="text" inputmode="numeric" class="vws-quantity" data-action="import-qty" data-line="'+row.line+'" aria-label="Количество в строке '+row.line+'" value="'+esc(row.qty)+'"'+(row.excluded?' disabled':'')+'></td><td data-label="Проверка" class="vws-import-status" data-status-line="'+row.line+'">'+esc(importRowStatus(row))+'</td><td data-label="Действие">'+button('exclude',row.excluded?'Вернуть':'Исключить','data-line="'+row.line+'"')+'</td></tr>').join('')
        + '</tbody></table></div>'+pager(state.imported.length,state.importPage,'import-page')+'<div class="vws-actions">'+button('apply-import','Добавить проверенные строки в выбор','data-role="apply-import"'+(!active.length||problems||!state.importVerified?' disabled':''))+'</div>';
      return html;
    }
    const importRowStatus=row=>row.excluded?'Исключена':row.error||(state.importVerified?'Можно добавить':'Нужна проверка на сервере');
    const importSummary = (rows, errors) => '<b>'+fmt(rows.length)+' строк · '+fmt(rows.reduce((n,row)=>n+(integer(row.qty)||0),0))+' шт.</b><span>'+ (errors?'Нужно исправить или исключить: '+fmt(errors)+' строк.':state.importVerified?'Все строки проверены. Товар ещё не перенесён.':'Нажмите «Проверить ещё раз», чтобы подтвердить количество и коды.') +'</span>';
    function reviewHtml(){
      const all=selectedRows(), errors=all.filter(row=>rowError(row));
      state.reviewPage=Math.min(state.reviewPage,Math.max(0,Math.ceil(all.length/PAGE_SIZE)-1));
      return '<div class="vws-review-head"><div><h3>Проверьте добавление</h3><p class="vws-sub">В «'+esc(context.warehouse.name)+'»: '+fmt(all.length)+' позиций · '+fmt(total())+' шт.</p></div>'
        + button('pick','← Изменить выбор',(state.locked?' disabled':'')) + '</div><div class="vws-table-wrap"><table class="vws-table vws-review-table"><thead><tr><th>Товар</th><th>Откуда</th><th>Можно перенести</th><th>Добавить, шт.</th><th>Проверка</th></tr></thead><tbody>'
        + all.slice(state.reviewPage*PAGE_SIZE,(state.reviewPage+1)*PAGE_SIZE).map(row=>'<tr><td data-label="Товар"><b>'+esc(row.name)+'</b><div class="vws-identifiers">Артикул: '+esc(row.sku)+'</div></td><td data-label="Откуда">'+esc(sourceName(row.fromVw))+'</td><td class="vws-num" data-label="Можно перенести">'+fmt(freeOf(row.sku,row.fromVw))+'</td><td class="vws-num" data-label="Добавить, шт.">'+esc(row.qty)+'</td><td data-label="Проверка">'+esc(rowError(row)||({done:'Учёт изменится',to_move:'Будет создано задание кладовщику',waiting_seller:'Потребуется согласие клиента'}[row.expectedStatus]||'Количество проверено'))+'</td></tr>').join('')
        + '</tbody></table></div>'+pager(all.length,state.reviewPage,'review-page')
        + '<p class="vws-sub">'+(context.warehouse.keepSeparate?'Отдельное хранение может потребовать задания кладовщику. До выполнения задания количество не считается перенесённым.':'Меняется распределение по виртуальным складам. Физическое перемещение и согласие клиента Аргус определит по правилам склада.')+'</p>'
        + '<div class="vws-actions">'+button('confirm',state.busy?'Проверяем…':state.locked?'Повторить отправку':'Подтвердить добавление','data-role="confirm"'+(!all.length||!state.locked&&(errors.length||!state.previewReady)||state.busy?' disabled':''))+ '</div>';
    }
    function render(){
      if(state.closed) return; if(!el('[data-role=content]')) shell();
      el('.vws-heading [data-action=close]').disabled=state.busy;
      el('[data-role=content]').innerHTML=state.loading?'<div class="vws-empty" role="status">Загружаем товары и проверяем доступное количество…</div>':state.mode==='blocked'?'<div class="vws-empty vws-recovery-blocked">Сначала проверьте результат сохранённой операции. Новый перенос пока недоступен.</div>':state.mode!=='pick'||state.rows.length||!state.error?(state.mode==='import'?importHtml():state.mode==='review'?reviewHtml():pickHtml()):'<div class="vws-empty">'+button('reload','Повторить загрузку')+selectionSummary()+'</div>';
      if(state.busy)host.querySelectorAll('[data-action]').forEach(control=>{control.disabled=true;});
      notice(); updateSelection();
    }
    function updateSelection(){
      host.querySelectorAll('.vws-row').forEach(row=>{const picked=state.selected.has(row.dataset.key);row.classList.toggle('vws-selected',picked);row.querySelector('[data-action=row-select]').checked=picked;});
      const count=el('[data-role=selected-total]');if(count)count.textContent='Выбрано '+fmt(state.selected.size)+' позиций · '+fmt(total())+' шт.';
      const review=el('[data-role=review]');if(review)review.disabled=!state.selected.size;
      const clear=el('[data-action=clear]');if(clear)clear.disabled=!state.selected.size||state.locked;
      const boxes=[...host.querySelectorAll('[data-action=row-select]:not(:disabled)')], master=el('[data-action=page-select]');
      if(master){const n=boxes.filter(box=>box.checked).length;master.checked=!!boxes.length&&n===boxes.length;master.indeterminate=n>0&&n<boxes.length;master.disabled=!boxes.length;}
    }
    function select(sku,on){
      if(state.locked||state.busy)return;const row=state.rows.find(row=>row.sku===sku),k=keyOf(sku,state.source);if(!row||on&&row.free<=0||on&&state.selected.has(k))return;
      if(on){if(state.selected.size>=MAX_ITEMS&&!state.selected.has(k)){state.error='За один раз можно выбрать не больше '+MAX_ITEMS+' товаров.';notice();return;}
        state.selected.set(k,{sku:row.sku,name:row.name,barcode:row.barcode,fromVw:state.source,qty:state.drafts.get(k)??String(row.free)});
      }else state.selected.delete(k);invalidate();updateSelection();
    }
    function cellText(sheet,r,c,code){
      const cell=sheet[window.XLSX.utils.encode_cell({r,c})];if(!cell)return'';
      if(cell.f)throw new Error('Строка '+(r+1)+': формулу замените обычным значением.');
      if(cell.t==='d'||cell.v instanceof Date||cell.t==='n'&&cell.z&&window.XLSX.SSF?.is_date(cell.z))throw new Error('Строка '+(r+1)+': Excel превратил код в дату. Укажите код текстом.');
      if(code&&cell.t==='n'){
        if(!Number.isSafeInteger(cell.v)||String(Math.abs(cell.v)).length>15)throw new Error('Строка '+(r+1)+': код длиннее 15 цифр или потерял точность. Укажите его текстом.');
        const shown=String(cell.w??window.XLSX.utils.format_cell(cell)).trim();return /^\d+$/.test(shown)?shown:String(cell.v);
      }
      return String(cell.v==null?'':cell.v).trim();
    }
    function cellLabel(sheet,r,c){
      const cell=sheet[window.XLSX.utils.encode_cell({r,c})];if(!cell)return'';if(cell.f)return'(формула)';
      return String(cell.w??cell.v??'').trim();
    }
    async function readFile(file){
      if(!file)return;if(!window.XLSX){state.error='Excel ещё загружается. Повторите выбор файла.';notice();return;}
      if(file.size>MAX_FILE||! /\.(xlsx|xls|csv)$/i.test(file.name)){state.error='Выберите .xlsx, .xls или .csv до 10 МБ.';notice();return;}
      const run=++state.fileRun;
      try{
        const buffer=await file.arrayBuffer();if(state.closed||run!==state.fileRun)return;let book;
        if(/\.csv$/i.test(file.name)){let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch(_){text=new TextDecoder('windows-1251').decode(buffer);}book=window.XLSX.read(text.replace(/^\uFEFF/,''),{type:'string',raw:true});}
        else book=window.XLSX.read(new Uint8Array(buffer),{type:'array',cellDates:true,cellNF:true});
        const valid=book.SheetNames.filter(name=>book.Sheets[name]?.['!ref']);if(!valid.length)throw new Error('В файле нет листа с данными.');
        book.SheetNames=valid;setSheet(valid[0],book);state.workbook=book;state.error='';render();
      }catch(error){state.error=error.message||'Не удалось прочитать файл.';notice();}
    }
    function setSheet(name,book=state.workbook){
      const sheet=book.Sheets[name],range=window.XLSX.utils.decode_range(sheet['!ref']);
      if(range.e.r-range.s.r+1>MAX_FILE_ROWS||range.e.c-range.s.c+1>100)throw new Error('В листе больше 10 000 строк или 100 столбцов. Разделите файл.');
      state.sheet=name;state.header=range.s.r;state.mapping={sku:'',barcode:'',qty:''};state.imported=[];state.importPage=0;state.importVerified=false;
    }
    function parseFile(){
      const m=state.mapping;if((m.sku===''&&m.barcode==='')||m.qty===''){state.error='Выберите столбец количества и хотя бы один столбец: артикул или штрихкод.';notice();return;}
      const used=[m.sku,m.barcode,m.qty].filter(v=>v!=='');if(new Set(used).size!==used.length){state.error='Артикул, штрихкод и количество должны быть в разных столбцах.';notice();return;}
      const sheet=state.workbook.Sheets[state.sheet],range=window.XLSX.utils.decode_range(sheet['!ref']),rows=[];
      for(let r=state.header+1;r<=range.e.r;r++){
        const row={line:r+1,sku:'',barcode:'',qty:'',fromVw:state.source,excluded:false,parseError:''};
        try{row.sku=m.sku===''?'':cellText(sheet,r,Number(m.sku),true);row.barcode=m.barcode===''?'':cellText(sheet,r,Number(m.barcode),true);row.qty=cellText(sheet,r,Number(m.qty),false);}catch(error){row.parseError=error.message;}
        if(row.sku||row.barcode||row.qty||row.parseError)rows.push(row);
      }
      if(!rows.length){state.error='Под выбранным заголовком нет строк с товаром и количеством.';notice();return;}
      state.imported=rows;state.importPage=0;state.importVerified=false;validateImport();state.error='';render();checkImport();
    }
    function validateImport(){
      const seen=new Map();
      state.imported.forEach(row=>{
        row.error=row.parseError||row.serverError||'';
        if(row.error||row.excluded)return;
        if(!integer(row.qty))row.error='Укажите целое количество больше нуля.';
        else if(!row.sku&&!row.barcode)row.error='Не указан артикул или штрихкод.';
        if(row.product){const k=keyOf(row.product.sku,row.fromVw);if(state.selected.has(k))row.error='Этот товар уже выбран. Исключите строку файла или уберите товар из выбора.';if(!seen.has(k))seen.set(k,[]);seen.get(k).push(row);}
      });
      seen.forEach(rows=>{if(rows.length>1)rows.forEach(row=>row.error='Товар повторяется в строках '+rows.map(x=>x.line).join(', ')+'. Оставьте одну строку.');});
      const active=state.imported.filter(row=>!row.excluded),errors=active.filter(row=>row.error).length,summary=el('[data-role=import-summary]');
      if(summary)summary.innerHTML=importSummary(active,errors);
      host.querySelectorAll('[data-status-line]').forEach(cell=>{const row=state.imported.find(r=>r.line===Number(cell.dataset.statusLine));cell.textContent=importRowStatus(row);cell.classList.toggle('vws-error',!!row.error&&!row.excluded);});
      const apply=el('[data-role=apply-import]');if(apply)apply.disabled=!active.length||!!errors||!state.importVerified;
    }
    async function checkImport(){
      const active=state.imported.filter(row=>!row.excluded);state.importVerified=false;
      if(active.length>MAX_ITEMS){state.error='В файле выбрано '+active.length+' строк. Одна операция — не больше 200: исключите лишние строки или разделите файл.';notice();return;}
      active.forEach(row=>{row.serverError='';row.product=null;});validateImport();
      const checked=active.filter(row=>!row.error);if(!checked.length){render();return;}
      state.busy=true;state.error='';state.message='Проверяем строки файла по остаткам клиента…';render();
      try{
        const data=await context.request('/api/vwarehouses/transfers/preview',{method:'POST',body:{companyId:context.companyId,toVw:context.warehouse.id,items:checked.map(row=>({...(row.sku?{sku:row.sku}:{}),...(row.barcode?{barcode:row.barcode}:{}),qty:integer(row.qty),fromVw:row.fromVw}))}});
        if(state.closed)return;
        if(!Array.isArray(data.items)||!Array.isArray(data.errors))throw new Error('Сервер не подтвердил проверку файла.');
        data.items.forEach(item=>{const row=checked[Number(item.row)-1];if(!row)return;row.product={sku:String(item.sku),name:item.name,barcode:item.barcode};if(Number.isSafeInteger(item.free))state.free.set(keyOf(String(item.sku),row.fromVw),item.free);});
        data.errors.forEach(error=>{const row=checked[Number(error.row)-1];if(row)row.serverError=error.message||'Строка не прошла проверку.';});
        state.importVerified=data.canCommit===true;validateImport();
      }catch(error){if(state.closed)return;state.error=error.message||'Не удалось проверить файл.';}
      state.busy=false;state.message='';if(!state.closed)render();
    }
    function template(){
      if(!window.XLSX){state.error='Excel ещё загружается. Повторите через секунду.';notice();return;}
      const sheet=window.XLSX.utils.aoa_to_sheet([['Артикул','Штрихкод','Количество']]);
      sheet['!cols']=[{wch:24},{wch:24},{wch:16}];
      for(let r=1;r<=100;r++){sheet[window.XLSX.utils.encode_cell({r,c:0})]={t:'s',v:'',z:'@'};sheet[window.XLSX.utils.encode_cell({r,c:1})]={t:'s',v:'',z:'@'};}
      sheet['!ref']='A1:C101';const book=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(book,sheet,'Товары');window.XLSX.writeFile(book,'Товары виртуального склада.xlsx');
    }
    async function review(){
      if(state.locked){state.mode='review';render();return;}
      state.mode='review';state.reviewPage=0;state.error='';state.message='';state.busy=true;state.previewReady=false;state.validationErrors.clear();render();
      const selected=selectedRows();
      try{
        if(selected.some(row=>!integer(row.qty)))throw new Error('Исправьте количество в выбранных строках: нужно целое число больше нуля.');
        const data=await context.request('/api/vwarehouses/transfers/preview',{method:'POST',body:{companyId:context.companyId,toVw:context.warehouse.id,items:selected.map(row=>({sku:row.sku,qty:integer(row.qty),fromVw:row.fromVw}))}});
        if(state.closed)return;if(!Array.isArray(data.items)||!Array.isArray(data.errors))throw new Error('Сервер не подтвердил проверку количества.');
        data.items.forEach(item=>{const row=selected[Number(item.row)-1];if(row&&Number.isSafeInteger(item.free)){state.free.set(keyOf(row.sku,row.fromVw),item.free);row.expectedStatus=item.expectedStatus;}});
        data.errors.forEach(error=>{const row=selected[Number(error.row)-1];if(row)state.validationErrors.set(keyOf(row.sku,row.fromVw),error.message||'Товар не прошёл проверку.');});state.previewReady=data.canCommit===true;
        if(!data.canCommit)state.error='Часть строк не прошла проверку. Исправьте выбор и проверьте ещё раз.';
      }catch(error){if(state.closed)return;state.error=error.message||'Не удалось проверить количество.';}
      state.busy=false;if(!state.closed)render();
    }
    async function confirm(){
      if(state.busy||!state.selected.size||!state.locked&&(!state.previewReady||selectedRows().some(row=>rowError(row))))return;
      let identity;try{identity=currentScope();}catch(_){identity=suppliedScope;storageUnavailable=true;}
      if(!sameScope(authScope,identity)){state.error='Вход в кабинет изменился. Вернитесь в кабинет нужного пользователя перед отправкой операции.';notice();return;}
      const wasRetry=state.locked&&!!state.payload;
      if(!state.payload){
        state.requestId=window.crypto.randomUUID();state.payload={companyId:context.companyId,toVw:context.warehouse.id,items:selectedRows().map(row=>({sku:row.sku,qty:integer(row.qty),fromVw:row.fromVw})),requestId:state.requestId};
      }
      const record={scope:authScope,payload:state.payload,selected:selectedRows().map(row=>({...row})),sources:state.sources.map(row=>({...row})),free:[...state.free.entries()]};
      persist(sessionKey,record);
      state.storageWarning=record.durable?'':'Браузер не смог сохранить номер операции. Пока результат не подтверждён, не обновляйте и не закрывайте вкладку: восстановить безопасный повтор после закрытия не получится.';
      state.busy=true;state.locked=true;state.error='';render();
      try{
        const response=await context.request('/api/vwarehouses/transfers/batch',{method:'POST',body:state.payload});
        if(response?.requestId!==state.payload.requestId||!Array.isArray(response.items)||response.items.length!==state.payload.items.length
          ||new Set(response.items.map(item=>keyOf(item.sku,item.fromVw))).size!==state.payload.items.length
          ||response.items.some(item=>!['done','to_move','waiting_seller'].includes(item.status)||!state.payload.items.some(row=>row.sku===item.sku&&row.qty===Number(item.qty)&&(row.fromVw||null)===(item.fromVw||null))))throw new Error('Сервер вернул неполный результат операции.');
        const cleared=forget(sessionKey);if(state.closed)return;state.storageWarning=cleared?'':'Результат получен, но браузер не смог удалить запись операции. При восстановлении будет проверена та же операция.';state.mode='result';state.busy=false;renderResult(response);
        try{Promise.resolve(context.onChanged?.(response)).catch(()=>{});}catch(_){}
      }catch(error){
        const rejected=error.status>=400&&error.status<500&&error.status!==408&&error.data?.code!=='request_changed'&&!(wasRetry&&[401,403].includes(error.status));
        if(rejected){const cleared=forget(sessionKey);state.storageWarning=cleared?'':'Браузер не смог удалить запись отклонённой операции. Повторная проверка использует её прежний номер.';}if(state.closed)return;state.busy=false;
        if(rejected){state.locked=false;state.payload=null;state.requestId=null;state.previewReady=false;
          (error.data?.errors||[]).forEach(item=>{const row=selectedRows()[Number(item.row)-1];if(row){state.validationErrors.set(keyOf(row.sku,row.fromVw),item.message||'Доступность товара изменилась. Проверьте выбор ещё раз.');if(Number.isSafeInteger(item.free))state.free.set(keyOf(row.sku,row.fromVw),item.free);}});}
        state.error=(error.message||'Ответ не получен.')+(rejected?' Исправьте список и повторите.':' Номер операции сохранён. Повторная отправка проверит ту же операцию.');render();
      }
    }
    function renderResult(response){
      const items=response.items,known={done:'Учёт изменён',to_move:'Созданы задания на перемещение',waiting_seller:'Ожидает согласия клиента'};
      el('.vws-heading [data-action=close]').disabled=false;
      el('[data-role=content]').innerHTML='<div class="vws-result"><h3>Результат добавления</h3><p class="vws-sub">Если требуется согласие клиента или работа кладовщика, добавление ещё не завершено.</p>'
        +'<div class="vws-table-wrap"><table class="vws-table vws-result-table"><thead><tr><th>Товар</th><th>Количество</th><th>Состояние</th></tr></thead><tbody>'+items.map(item=>'<tr><td data-label="Товар">'+esc(item.name||selectedRows().find(row=>row.sku===item.sku)?.name||item.sku)+'</td><td class="vws-num" data-label="Количество">'+fmt(item.qty)+'</td><td data-label="Состояние">'+esc(known[item.status])+'</td></tr>').join('')+'</tbody></table></div>'
        +'<div class="vws-actions">'+button('close','← К списку складов')+'</div></div>';notice();
    }
    function click(event){
      const control=event.target.closest('[data-action]');if(!control||!host.contains(control)||control.disabled)return;
      const action=control.dataset.action;if(['qty','search','row-select','page-select','import-qty'].includes(action))return;
      if(state.busy||state.locked&&!['confirm','close','review-page'].includes(action))return;
      try{
        if(action==='close')close(true);else if(action==='reload')load();else if(action==='template')template();else if(action==='review')review();else if(action==='confirm')confirm();
        else if(action==='file')el('[data-role=file]').click();
        else if(action==='source'){state.source=control.dataset.value||null;state.imported=[];invalidate();loadCandidates(true);}
        else if(action==='pick'||action==='import'){state.mode=action;state.error='';if(action==='pick')loadCandidates();else render();}
        else if(action==='page'){const next=Number(control.dataset.page);if(next>state.page)state.cursors[next]=state.nextCursor;state.page=next;loadCandidates();}
        else if(action==='import-page'||action==='review-page'){state[action==='import-page'?'importPage':'reviewPage']=Number(control.dataset.page);render();}
        else if(action==='clear'){state.selected.clear();invalidate();updateSelection();}
        else if(action==='sheet'){setSheet(control.dataset.value);state.error='';render();}
        else if(action==='header'){state.header=Number(control.dataset.value);state.imported=[];render();}
        else if(action.startsWith('map-')){state.mapping[action.slice(4)]=control.dataset.value;state.imported=[];render();}
        else if(action==='parse'){if(state.imported.length)checkImport();else parseFile();}
        else if(action==='exclude'){const row=state.imported.find(row=>row.line===Number(control.dataset.line));row.excluded=!row.excluded;state.importVerified=false;validateImport();render();}
        else if(action==='apply-import'){
          validateImport();const active=state.imported.filter(row=>!row.excluded);if(!state.importVerified||active.some(row=>row.error))return;
          const keys=new Set([...state.selected.keys(),...active.map(row=>keyOf(row.product.sku,row.fromVw))]);if(keys.size>MAX_ITEMS)throw new Error('За один раз можно добавить не больше '+MAX_ITEMS+' товаров.');
          active.forEach(row=>state.selected.set(keyOf(row.product.sku,row.fromVw),{sku:row.product.sku,name:row.product.name,barcode:row.product.barcode,qty:row.qty,fromVw:row.fromVw}));invalidate();state.mode='pick';state.message='Строки добавлены в выбор. Проверьте список перед отправкой.';render();
        }
      }catch(error){state.error=error.message;notice();}
    }
    function input(event){
      const control=event.target,action=control.dataset.action;if(state.busy||state.locked)return;
      if(action==='search'){
        state.search=control.value;clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>loadCandidates(true),250);
      }else if(action==='qty'){
        state.drafts.set(control.dataset.key,control.value);const row=state.selected.get(control.dataset.key);if(row)row.qty=control.value;invalidate();updateSelection();
      }else if(action==='import-qty'){const row=state.imported.find(row=>row.line===Number(control.dataset.line));row.qty=control.value;row.serverError='';state.importVerified=false;validateImport();}
    }
    function change(event){
      const control=event.target;if(state.busy||state.locked)return;
      if(control.dataset.role==='file'){const file=control.files?.[0];control.value='';readFile(file);}
      else if(control.dataset.action==='row-select')select(control.closest('.vws-row').dataset.sku,control.checked);
      else if(control.dataset.action==='page-select'){const on=control.checked;host.querySelectorAll('.vws-row').forEach(row=>select(row.dataset.sku,on));}
    }
    host.addEventListener('click',click,{signal:events.signal});host.addEventListener('input',input,{signal:events.signal});host.addEventListener('change',change,{signal:events.signal});
    host.addEventListener('pointerdown',event=>{
      if(event.button!==0||event.pointerType!=='mouse'||state.busy||state.locked||event.target.closest('button,a,summary,[data-action=qty]'))return;
      const row=event.target.closest('.vws-row');if(!row||row.querySelector('[data-action=row-select]').disabled)return;
      event.preventDefault();state.paint={on:!state.selected.has(row.dataset.key),start:event.target};select(row.dataset.sku,state.paint.on);
    },{signal:events.signal});
    document.addEventListener('pointermove',event=>{if(!state.paint)return;const row=document.elementFromPoint(event.clientX,event.clientY)?.closest('.vws-row');if(row&&host.contains(row)&&!document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-action=qty]'))select(row.dataset.sku,state.paint.on);},{signal:events.signal});
    let suppressClick=false;
    document.addEventListener('pointerup',()=>{if(!state.paint)return;state.paint=null;suppressClick=true;setTimeout(()=>suppressClick=false,0);},{signal:events.signal});
    host.addEventListener('click',event=>{if(suppressClick&&event.target.closest('[data-action=row-select]')){event.preventDefault();event.stopImmediatePropagation();queueMicrotask(updateSelection);}},{capture:true,signal:events.signal});
    document.addEventListener('keydown',event=>{if(event.key!=='Escape'||!host.contains(event.target))return;const details=event.target.closest('details[open]');if(details){event.preventDefault();details.open=false;details.querySelector('summary').focus();}},{signal:events.signal});
    document.addEventListener('pointerdown',event=>{if(event.target.dataset?.action!=='search')state.focusVersion++;},{signal:events.signal});
    document.addEventListener('focusin',event=>{if(event.target.dataset?.action!=='search')state.focusVersion++;},{signal:events.signal});
    document.addEventListener('click',event=>host.querySelectorAll('details[open]').forEach(details=>{if(!details.contains(event.target))details.open=false;}),{signal:events.signal});
    let saved,recoveryBlocked=false;
    try{if(authScope)saved=recover(sessionKey,authScope,context.companyId,context.warehouse.id);}
    catch(error){state.storageWarning=error.message;recoveryBlocked=!!error.recoveryInvalid;storageUnavailable=true;}
    if(storageUnavailable&&!state.storageWarning)state.storageWarning='Браузер не даёт сохранить операцию между открытиями вкладки. Если ответ не получен, оставайтесь в этой вкладке и повторите отправку.';
    if(saved){state.payload=saved.payload;state.requestId=saved.payload.requestId;state.selected=new Map(saved.selected.map(row=>[keyOf(row.sku,row.fromVw),row]));state.sources=saved.sources;state.free=new Map(saved.free);state.mode='review';state.locked=true;state.loading=false;state.message='Предыдущая отправка не получила подтверждение. Повторите её с сохранённым номером операции — второй перенос не создаётся.';shell();render();}
    else if(recoveryBlocked){state.mode='blocked';state.locked=true;state.loading=false;shell();render();}
    else{shell();load();}return controller;
  }
  window.ArgusVwStock={open};
})();
