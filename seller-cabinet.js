'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const escapeMap = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
  const h = v => String(v ?? '').replace(/[&<>"']/g, c => escapeMap[c]);
  const n = v => Number(v || 0).toLocaleString('ru-RU');
  const when = v => v ? new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
  const paths = {
    box:'M12 3 3 8v9l9 5 9-5V8l-9-5Zm0 9v10M3 8l9 4 9-4M7.5 5.5l9 5V15',
    orders:'M8 4h12v17H4V4h4m0-2h8v4H8V2Zm0 9h8m-8 5h6',
    document:'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h6',
    warehouse:'M3 21V9l9-6 9 6v12H3Zm5 0V11h8v10M8 15h8m-8 3h8',
    logout:'M9 4H4v16h5m5-12 4 4-4 4m-6-4h10',
    refresh:'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2',
    download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    transfer:'M3 7h16m-4-4 4 4-4 4M21 17H5m4-4-4 4 4 4',
    close:'m6 6 12 12M6 18 18 6',search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
    info:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 7v6m0-9v.1',
    check:'m5 12 4 4L19 6',left:'m14 5-7 7 7 7',right:'m10 5 7 7-7 7',
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.box}"/></svg>`;
  document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
  const state = {token:localStorage.getItem('argus_token'),owner:localStorage.getItem('argus_role')==='owner',companyId:null,profile:null,
    view:'products',stock:null,orders:null,documents:null,fetchedAt:{},search:'',filter:'all',page:1,orderSearch:'',orderFilter:'all',docSearch:'',docFilter:'all',viewRun:0,drawerRun:0,exportRows:[]};
  const statusNames = {open:'Принят складом',in_progress:'Собирается',ready:'Собран, ждёт машину',shipped:'Отгружен'};
  const statusClass = {open:'waiting',in_progress:'working',ready:'ready',shipped:''};
  const badge = (text,style='') => `<span class="badge ${style}">${h(text)}</span>`;
  const quantity = value => value == null ? '<span class="unknown-number">Уточняется</span>' : n(value);
  const loading = '<div class="loading-inline" role="status"><span class="spinner"></span>Загружаем данные…</div>';
  function empty(title,description,kind='box') { return `<div class="empty">${icon(kind)}<h2>${h(title)}</h2><p>${h(description)}</p></div>`; }
  let toastTimer;
  function toast(message){ $('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6000); }
  function logout(){for(const k of ['argus_token','argus_role','argus_company_name','argus_seller_name'])localStorage.removeItem(k);location.href='client_access.html';}
  async function api(path,options={}){
    if(state.owner && state.companyId && path.startsWith('/api/sellers/')) path+=(path.includes('?')?'&':'?')+'companyId='+encodeURIComponent(state.companyId);
    const response = await fetch('https://api.argus-ai.online'+path,{method:options.method||'GET',headers:{'Content-Type':'application/json',...(state.token?{Authorization:'Bearer '+state.token}:{})},body:options.body?JSON.stringify(options.body):undefined,cache:'no-store'});
    const data=await response.json().catch(()=>null);
    if(response.status===401 && !path.includes('/auth/')) {state.viewRun++;state.drawerRun++;state.token=null;localStorage.removeItem('argus_token');localStorage.removeItem('argus_role');$('drawer').close();$('exportDialog').close();$('app').hidden=true;$('loginScreen').hidden=false;$('loginError').textContent='Сессия завершилась. Войдите ещё раз.';}
    if(!response.ok) throw new Error(data?.error || 'Не удалось получить данные. Попробуйте ещё раз.');
    return data;
  }
  async function boot(){
    if(!state.token){$('loginScreen').hidden=false;return;}
    $('loginScreen').hidden=true;$('app').hidden=false;$('view').innerHTML=loading;
    try{
      if(state.owner){
        const invoices=await api('/api/invoices');const companies=new Map();
        invoices.forEach(i=>{if(!companies.has(i.company_id))companies.set(i.company_id,{id:i.company_id,name:i.company_name,count:0});companies.get(i.company_id).count++;});
        const choices=[...companies.values()].sort((a,b)=>b.count-a.count);
        if(!choices.length){$('view').innerHTML=empty('Нет компаний для просмотра','Компании с документами появятся здесь после загрузки данных.');return;}
        const selected=choices.find(c=>c.id===new URLSearchParams(location.search).get('companyId'))||choices[0];state.companyId=selected.id;
        $('companySelect').replaceChildren(...choices.map(c=>new Option(c.name,c.id,false,c.id===selected.id)));
        $('ownerPreview').hidden=false;
        $('companySelect').onchange=()=>{const url=new URL(location.href);url.searchParams.set('companyId',$('companySelect').value);location.href=url.href;};
      }
      state.profile=await api('/api/sellers/profile');
      $('companyName').textContent=$('topCompany').textContent=state.profile.name;
      $('companyAvatar').textContent=state.profile.name.trim().slice(0,2).toUpperCase();
      $('warehouseName').textContent=localStorage.getItem('argus_wh_name')||'Ваш склад';
      document.title=state.profile.name+' · Аргус';
      await navigate();
    }catch(e){if(state.token)$('view').innerHTML=empty('Не удалось открыть кабинет',e.message);}
  }
  $('loginForm').addEventListener('submit',async e=>{
    e.preventDefault();$('loginError').textContent='';$('loginSubmit').disabled=true;
    try{
      const data=await api('/api/auth/seller/login',{method:'POST',body:{name:$('loginName').value.trim(),keyCode:$('loginKey').value.trim()}});
      localStorage.setItem('argus_token',data.token);localStorage.setItem('argus_role','seller');localStorage.setItem('argus_company_name',data.companyName||'');localStorage.setItem('argus_wh_name',data.warehouseName||'');
      location.href='client_access.html#products';
    }catch(error){$('loginError').textContent=error.message;$('loginSubmit').disabled=false;}
  });
  $('logoutButton').onclick=$('mobileLogout').onclick=logout;
  const pageInfo={products:['Всё о вашем товаре','Товары','Остатки и сборка в штуках.'],orders:['От заказа до отгрузки','Заказы','Следите за тем, как склад готовит ваши заказы.'],documents:['От поставки до приёмки','Поставки и документы','Накладные, результаты приёмки и возвраты.']};
  async function navigate(refresh=false){
    if(!state.profile||!state.token)return;
    const name=location.hash.slice(1);state.view=pageInfo[name]?name:'products';const run=++state.viewRun;
    const [eyebrow,title,subtitle]=pageInfo[state.view];$('pageEyebrow').textContent=eyebrow;$('pageTitle').textContent=$('breadcrumb').textContent=title;$('pageSubtitle').textContent=subtitle;
    document.querySelectorAll('[data-nav]').forEach(a=>{if(a.dataset.nav===state.view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    $('excelButton').disabled=true;$('view').setAttribute('aria-busy','true');$('refreshButton').disabled=true;
    $('view').innerHTML='<div class="skeleton skeleton-metrics"></div>'+Array.from({length:4},()=>'<div class="skeleton skeleton-row"></div>').join('');
    try{
      const key=state.view==='products'?'stock':state.view;
      if(refresh || !state[key]){state[key]=await api('/api/sellers/'+key);state.fetchedAt[key]=new Date();}
      if(run!==state.viewRun)return;
      if(state.view==='products')renderProducts();else if(state.view==='orders')renderOrders();else renderDocuments();
      $('updateTime').textContent='Получено '+state.fetchedAt[key].toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
    }catch(e){if(run===state.viewRun && state.token){$('view').innerHTML=empty('Данные не загрузились',e.message)+ '<button class="button" id="retryLoad">Повторить</button>';$('retryLoad').onclick=()=>navigate(true);}}
    finally{if(run===state.viewRun){$('view').setAttribute('aria-busy','false');$('refreshButton').disabled=false;}}
  }
  window.addEventListener('hashchange',()=>navigate());$('refreshButton').onclick=()=>navigate(true);
  function metric(label,value,note,kind,extra=''){return `<div class="metric ${extra}"><div class="metric-label">${icon(kind)}${label}</div><div class="metric-value ${value==null?'unknown':''}">${value==null?'Уточняется':n(value)+'<span class="unit">шт.</span>'}</div><p class="metric-note">${note}</p></div>`;}
  function notice(title,description,warn=false){return `<div class="notice ${warn?'warning':''}">${icon('info')}<div><strong>${h(title)}</strong><p>${h(description)}</p></div></div>`;}
  function searchBox(id,value,placeholder){return `<label class="search">${icon('search')}<input type="search" id="${id}" value="${h(value)}" aria-label="${h(placeholder)}" placeholder="${h(placeholder)}"></label>`;}
  function chips(options,current,attribute){return `<div class="chips">${options.map(([key,label])=>`<button class="chip" ${attribute}="${key}" aria-pressed="${key===current}">${label}</button>`).join('')}</div>`;}
  function renderProducts(){
    const rows=state.stock;const unknown=rows.filter(r=>!r.stockKnown);const sum=k=>rows.reduce((a,r)=>a+Number(r[k]||0),0);const short=rows.filter(r=>r.stockKnown&&r.short>0);
    const knownNote=unknown.length?`Подтверждено ${n(sum('onHand'))} шт.; ${n(unknown.length)} артикулов уточняются`:'Весь годный товар, включая собранное';
    const compared=rows.filter(r=>r.stockKnown&&r.qtyIn1c!=null);const mismatch=compared.filter(r=>r.qtyIn1c!==r.onHand);
    $('view').innerHTML=`<section aria-label="Общее количество товара" class="metrics">
      ${metric('На складе',unknown.length?null:sum('onHand'),knownNote,'warehouse')}
      ${metric('В сборке',sum('ordered'),'Выделено под ещё не отгруженные заказы','orders')}
      ${metric('Доступно к продаже',unknown.length?null:sum('available'),unknown.length?'Рассчитаем после подтверждения остатков':'Сумма доступного по каждому товару','box','available')}</section>
      ${unknown.length?notice('Остатки ещё не подтверждены',`Склад ещё не передал подтверждённые количества по ${n(unknown.length)} артикулам. Заказы показаны; неизвестный остаток не считается нулём.`):''}
      ${short.length?notice('Есть нехватка для сборки',`Товаров с нехваткой: ${n(short.length)}. Всего не хватает ${n(sum('short'))} шт. Откройте товар, чтобы посмотреть подробности.`,true):''}
      ${mismatch.length?`<p class="reconcile">Сверка с 1С: товаров с расхождением — ${n(mismatch.length)}; разница — ${n(mismatch.reduce((s,r)=>s+Math.abs(r.qtyIn1c-r.onHand),0))} шт. Подробности — в карточке товара.</p>`:''}
      <section class="table-panel" aria-label="Товары"><div class="table-toolbar">${searchBox('productSearch',state.search,'Товар, артикул или штрихкод')}${chips([['all','Все товары'],['assembly','В сборке'],['attention','Требуют внимания']],state.filter,'data-product-filter')}</div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>Товар</th><th class="num">На складе, шт.</th><th class="num">В сборке, шт.</th><th class="num">Доступно, шт.</th><th class="num">Не в продаже</th><th class="num">Ячеек</th></tr></thead><tbody id="productsBody"></tbody></table></div><div id="productFooter" class="table-footer"></div></section>`;
    $('productSearch').oninput=e=>{state.search=e.target.value;state.page=1;renderProductRows();};
    document.querySelectorAll('[data-product-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.productFilter;state.page=1;renderProducts();});
    renderProductRows();
  }
  function filteredProducts(){const q=state.search.trim().toLocaleLowerCase('ru-RU');return state.stock.filter(r=>(!q||[r.name,r.sku,r.barcode].some(v=>String(v||'').toLocaleLowerCase('ru-RU').includes(q)))&&(state.filter!=='assembly'||r.ordered>0)&&(state.filter!=='attention'||!r.stockKnown||r.short>0||r.notForSale>0));}
  function renderProductRows(){
    const rows=filteredProducts(),pages=Math.max(1,Math.ceil(rows.length/50));state.page=Math.min(state.page,pages);
    $('productsBody').innerHTML=rows.slice((state.page-1)*50,state.page*50).map(r=>`<tr data-product="${h(r.sku)}"><td class="product-cell"><button class="product-link" data-open-product="${h(r.sku)}">${h(r.name)}</button><span class="product-meta">${h(r.sku)}</span></td><td class="num">${quantity(r.onHand)}</td><td class="num">${n(r.ordered)}</td><td class="num available-number">${quantity(r.available)}${r.short>0?`<span class="row-note negative">Не хватает ${n(r.short)} шт.</span>`:''}</td><td class="num">${r.stockKnown?(r.notForSale>0?badge(n(r.notForSale)+' шт.','issue'):'—'):'—'}</td><td class="num muted">${r.stockKnown?n(r.cells):'—'}</td></tr>`).join('')||`<tr><td colspan="6">${empty('Товары не найдены',state.stock.length?'Измените поиск или выберите «Все товары».':'Товары появятся после подключения данных склада.')}</td></tr>`;
    $('productsBody').querySelectorAll('[data-open-product]').forEach(b=>b.onclick=()=>openProduct(b.dataset.openProduct));
    $('productsBody').querySelectorAll('[data-product]').forEach(tr=>tr.onclick=e=>{if(!e.target.closest('button'))openProduct(tr.dataset.product);});
    $('productFooter').innerHTML=`<span>${n(rows.length)} артикулов${state.search||state.filter!=='all'?' по фильтру':''} · Excel выгружает весь результат фильтра</span><div class="pagination"><button class="icon-button" id="previousPage" aria-label="Предыдущая страница" ${state.page<=1?'disabled':''}>${icon('left')}</button><span>${state.page} / ${pages}</span><button class="icon-button" id="nextPage" aria-label="Следующая страница" ${state.page>=pages?'disabled':''}>${icon('right')}</button></div>`;
    $('previousPage').onclick=()=>{state.page--;renderProductRows();};$('nextPage').onclick=()=>{state.page++;renderProductRows();};
    state.exportRows=rows.map(r=>({'Товар':r.name,'Артикул':r.sku,'На складе, шт.':r.onHand??'Уточняется','В сборке, шт.':r.ordered,'Доступно к продаже, шт.':r.available??'Уточняется','Не в продаже, шт.':r.stockKnown?r.notForSale:'Уточняется','Ячеек':r.stockKnown?r.cells:'Уточняется'}));$('excelButton').disabled=!rows.length;
  }
  function waitTime(row){if(row.status==='shipped')return '—';const hours=Math.max(0,Math.floor((Date.now()-new Date(row.created_at).getTime())/3600000));return hours<1?'Менее часа':hours<24?n(hours)+' ч':n(Math.floor(hours/24))+' д '+hours%24+' ч';}
  function renderOrders(){
    $('view').innerHTML=`<div class="table-toolbar">${searchBox('orderSearch',state.orderSearch,'Номер заказа, товар или артикул')}${chips([['all','Все'],['active','В работе'],['shipped','Отгружены']],state.orderFilter,'data-order-filter')}</div><p class="reconcile" style="margin:14px 0 0">Ожидание — с момента загрузки заказа в Аргус. Статус — по данным склада.</p>${state.orders.hasMore?notice('Показана часть заказов','В списке первые 1 000 позиций. Выгрузка содержит показанные данные.',true):''}<div id="orderGroups"></div>`;
    $('orderSearch').oninput=e=>{state.orderSearch=e.target.value;renderOrderRows();};document.querySelectorAll('[data-order-filter]').forEach(b=>b.onclick=()=>{state.orderFilter=b.dataset.orderFilter;renderOrders();});renderOrderRows();
  }
  function renderOrderRows(){
    const q=state.orderSearch.trim().toLocaleLowerCase('ru-RU');const rows=state.orders.rows.filter(r=>(!q||[r.number,r.name,r.sku,r.mp_rid].some(v=>String(v||'').toLocaleLowerCase('ru-RU').includes(q)))&&(state.orderFilter!=='active'||r.status!=='shipped')&&(state.orderFilter!=='shipped'||r.status==='shipped'));
    const statuses=[...new Set([...Object.keys(statusNames),...rows.map(r=>r.status)])];
    $('orderGroups').innerHTML=statuses.map(status=>{const group=rows.filter(r=>r.status===status);if(!group.length)return '';return `<section><div class="section-heading"><h2>${h(statusNames[status]||status)}</h2><span>${n(new Set(group.map(r=>r.id)).size)} заказов · ${n(group.reduce((s,r)=>s+Number(r.qty),0))} шт.</span>${status!=='shipped'?badge('Ещё не отгружено'):''}</div><div class="table-panel table-scroll"><table class="data-table"><thead><tr><th>Заказ / отправление</th><th>Товар</th><th class="num">Шт.</th><th>Загружен в Аргус</th><th>Ожидание</th><th>Статус</th></tr></thead><tbody>${group.map(r=>`<tr><td class="order-id"><button class="product-link" data-order-id="${h(r.id)}">${h(r.number)}</button>${r.mp_rid?`<small title="${h(r.mp_rid)}">${h(r.mp_rid)}</small>`:''}</td><td class="order-product">${h(r.name)}<span class="product-meta">${h(r.sku)}</span></td><td class="num">${n(r.qty)}</td><td class="small muted">${h(when(r.created_at))}</td><td class="small">${h(waitTime(r))}</td><td>${badge(statusNames[r.status]||r.status,statusClass[r.status])}</td></tr>`).join('')}</tbody></table></div></section>`;}).join('')||empty('Заказы не найдены',q?'Попробуйте другой номер или артикул.':'Новые заказы появятся после загрузки с маркетплейса.','orders');
    $('orderGroups').querySelectorAll('[data-order-id]').forEach(b=>b.onclick=()=>openDocument(b.dataset.orderId,true));
    const active=new Set(state.orders.rows.filter(r=>r.status!=='shipped').map(r=>r.id)).size;$('orderBadge').textContent=n(active);$('orderBadge').hidden=!active;
    state.exportRows=rows.map(r=>({'Заказ':r.number,'Отправление':r.mp_rid||'','Товар':r.name,'Артикул':r.sku,'Кол-во, шт.':Number(r.qty),'Загружен в Аргус':when(r.created_at),'Ожидание':waitTime(r),'Статус':statusNames[r.status]||r.status}));$('excelButton').disabled=!rows.length;
  }
  const documentStatus=r=>r.status==='open'?'Ожидает приёмки':r.status==='in_progress'?'Принимается':r.status==='completed'?'Приёмка завершена':r.status;
  function renderDocuments(){
    $('view').innerHTML=`<section class="table-panel"><div class="table-toolbar">${searchBox('documentSearch',state.docSearch,'Номер документа')}${chips([['all','Все'],['in','Поступления'],['return','Возвраты']],state.docFilter,'data-doc-filter')}</div><div class="table-scroll"><table class="data-table"><thead><tr><th>Документ</th><th>Тип</th><th>Загружен в Аргус</th><th class="num">Заявлено, шт.</th><th>Статус</th></tr></thead><tbody id="documentsBody"></tbody></table></div><div class="table-footer">Накладная становится актом приёмки после фиксации результатов складом.${state.documents.hasMore?' Показаны первые 1 000 документов.':''}</div></section>`;
    $('documentSearch').oninput=e=>{state.docSearch=e.target.value;renderDocumentRows();};document.querySelectorAll('[data-doc-filter]').forEach(b=>b.onclick=()=>{state.docFilter=b.dataset.docFilter;renderDocuments();});renderDocumentRows();
  }
  function renderDocumentRows(){
    const q=state.docSearch.trim().toLocaleLowerCase('ru-RU');const rows=state.documents.rows.filter(r=>r.number.toLocaleLowerCase('ru-RU').includes(q)&&(state.docFilter==='all'||r.direction===state.docFilter));
    $('documentsBody').innerHTML=rows.map(r=>`<tr><td><button class="product-link" data-document="${h(r.id)}">${h(r.number)}</button><span class="product-meta">${r.source==='1c'?'Из 1С':'Документ склада'} · ${n(r.item_count)} позиций</span></td><td>${r.direction==='return'?'Возврат':'Поступление'}</td><td class="small muted">${h(when(r.created_at))}</td><td class="num">${n(r.declared_qty)}</td><td>${badge(documentStatus(r),r.status==='completed'?'ready':r.status==='open'?'waiting':'working')}</td></tr>`).join('')||`<tr><td colspan="5">${empty('Документов пока нет','Здесь появятся ваши накладные и результаты приёмки после передачи данных складом.','document')}</td></tr>`;
    $('documentsBody').querySelectorAll('[data-document]').forEach(b=>b.onclick=()=>openDocument(b.dataset.document));
    state.exportRows=rows.map(r=>({'Документ':r.number,'Источник':r.source==='1c'?'1С':'Склад','Тип':r.direction==='return'?'Возврат':'Поступление','Загружен в Аргус':when(r.created_at),'Заявлено, шт.':Number(r.declared_qty),'Статус':documentStatus(r)}));$('excelButton').disabled=!rows.length;
  }
  function openDrawer(title,eyebrow){state.drawerRun++;$('drawerTitle').textContent=title;$('drawerEyebrow').textContent=eyebrow;$('drawerBody').innerHTML=loading;if(!$('drawer').open)$('drawer').showModal();return state.drawerRun;}
  $('closeDrawer').onclick=()=>$('drawer').close();$('drawer').addEventListener('close',()=>state.drawerRun++);
  $('drawer').addEventListener('click',e=>{if(e.target===$('drawer')&&e.clientX<$('drawer').getBoundingClientRect().left)$('drawer').close();});
  function mini(label,value){return `<div><span>${label}</span><strong class="${value==null?'text':''}">${value==null?'Уточняется':n(value)+' шт.'}</strong></div>`;}
  async function openProduct(sku){
    const r=state.stock.find(x=>x.sku===sku);if(!r)return;const run=openDrawer(r.name,'Карточка товара');
    $('drawerBody').innerHTML=`<div class="drawer-meta"><span>Артикул <b class="mono">${h(r.sku)}</b></span><span>Штрихкод <b class="mono">${h(r.barcode||'не указан')}</b></span></div><div class="mini-metrics">${mini('На складе',r.onHand)}${mini('В сборке',r.ordered)}${mini('Доступно к продаже',r.available)}</div>
      ${!r.stockKnown?notice('Остаток уточняется','Количество по этому товару ещё не подтверждено складом.'):''}
      ${r.short>0?notice('Не хватает '+n(r.short)+' шт.','Количество в сборке превышает подтверждённый остаток.',true):''}
      <button class="button" id="productOrders">Посмотреть заказы с товаром</button>
      ${r.notForSale>0?`<section class="detail-section"><h3>Не в продаже · ${n(r.notForSale)} шт.</h3><div class="detail-list"><div><span>Брак</span><b>${n(r.defective)} шт.</b></div><div><span>Повреждена упаковка</span><b>${n(r.packagingDefect)} шт.</b></div></div></section>`:''}
      <section class="detail-section"><h3>Движение товара</h3><div id="productHistory">${loading}</div></section>
      <details><summary>Сверка с учётом 1С</summary><p>${r.qtyIn1c==null?'Данные 1С для этого товара ещё не переданы.':`По учёту 1С: ${n(r.qtyIn1c)} шт. Получено ${h(when(r.stockAt))}. Учёт 1С не заменяет подтверждение количества в ячейках.`}</p></details>`;
    $('productOrders').onclick=()=>{state.orderSearch=r.sku;state.orderFilter='all';$('drawer').close();location.hash='orders';};
    try{const data=await api('/api/sellers/history?sku='+encodeURIComponent(sku));if(run!==state.drawerRun)return;
      const labels={received:'Принято на склад',picked:'Собрано для заказа',returned:'Возврат',add:'Добавлено',remove:'Списано',move:'Перемещение',adjust:'Корректировка',set:'Пересчёт'};
      const quality={good:'Годное',defective:'Брак',packaging_defect:'Повреждена упаковка'};
      $('productHistory').innerHTML=data.events.length?`<ol class="timeline">${data.events.map(e=>`<li><div class="timeline-line"><strong>${h(labels[e.kind]||'Операция склада')}</strong><span class="quantity">${['received','returned'].includes(e.kind)?'+':''}${n(e.qty)} шт.</span></div><time>${h(when(e.at))}</time>${e.document?`<p>${h(e.document)}</p>`:''}${e.quality?`<p>${h(quality[e.quality]||e.quality)}</p>`:''}${e.note?`<p>${h(e.note)}</p>`:''}</li>`).join('')}</ol>${data.hasMore?'<p class="small muted">Показаны последние 200 операций.</p>':''}`:'<p class="export-description">Склад ещё не зафиксировал операции по этому товару. Заказы можно посмотреть выше.</p>';
    }catch(e){if(run===state.drawerRun)$('productHistory').textContent=e.message;}
  }
  async function openDocument(id,order=false){
    const list=order?state.orders.rows:state.documents.rows;const selected=list.find(r=>r.id===id);if(!selected)return;const run=openDrawer(selected.number,order?'Заказ':selected.direction==='return'?'Возврат':'Поставка и приёмка');
    try{const data=await api('/api/invoices/'+encodeURIComponent(id));if(run!==state.drawerRun)return;
      const items=data.items.map(r=>({...r,finalized:data.direction==='return'?data.status==='completed':data.direction==='out'?r.closed:r.accepted_qty!=null,accepted:data.direction==='return'?(r.buckets?.length||data.status==='completed'?Number(r.returned_qty):null):data.direction==='out'?Number(r.picked_qty):r.accepted_qty==null?null:Number(r.accepted_qty)}));
      const total=items.reduce((s,r)=>s+Number(r.declared_qty),0),complete=items.every(r=>r.finalized),accepted=items.reduce((s,r)=>s+Number(r.accepted||0),0);
      items.sort((a,b)=>Number(b.finalized&&b.accepted!==Number(b.declared_qty))-Number(a.finalized&&a.accepted!==Number(a.declared_qty)));
      $('drawerBody').innerHTML=`<div class="drawer-meta"><span>Загружено ${h(when(data.created_at))}</span>${badge(order?statusNames[data.status]||data.status:documentStatus(data),statusClass[data.status])}</div>
        <div class="mini-metrics">${mini('Заявлено',total)}${mini(order?'Собрано':'Принято',items.some(r=>r.accepted!==null)?accepted:null)}${mini('Расхождение',complete?accepted-total:null)}</div>
        ${!complete?'<p class="export-description">Обработка ещё не завершена. Показано уже обработанное количество; расхождение появится после завершения.</p>':''}
        <section class="detail-section"><h3>Позиции документа · ${items.length}</h3><div class="receipt-lines">${items.map(r=>{const declared=Number(r.declared_qty),different=r.finalized&&r.accepted!==declared,scale=Math.max(1,declared,r.accepted||0);return `<article class="receipt-item ${different?'issue':''}"><h3>${h(r.name)}</h3><span class="product-meta">${h(r.sku)}</span>${different?`<span class="row-note negative">Расхождение: ${n(r.accepted-declared)} шт.</span>`:''}<div class="receipt-bars"><div class="receipt-bar"><span>Заявлено</span><div class="track"><i style="width:${Math.max(0,declared/scale*100)}%"></i></div><span class="num">${n(declared)}</span></div><div class="receipt-bar"><span>${order?'Собрано':'Принято'}</span><div class="track accepted"><i style="width:${Math.max(0,(r.accepted||0)/scale*100)}%"></i></div><span class="num">${r.accepted==null?'—':n(r.accepted)}</span></div></div>${(r.buckets||[]).map(b=>`<p class="row-note">${h(({good:'Годное',defective:'Брак',packaging_defect:'Повреждена упаковка'})[b.qualityBucket]||b.qualityBucket)}: ${n(b.qty)} шт. ${h(b.defectNote||'')}</p>`).join('')}</article>`;}).join('')}</div></section>
        <button class="button" id="exportDocument" style="margin-top:24px">${icon('download')}Выгрузить этот документ</button>`;
      $('exportDocument').onclick=()=>saveExcel(items.map(r=>({'Товар':r.name,'Артикул':r.sku,'Заявлено, шт.':Number(r.declared_qty),[order?'Собрано, шт.':'Принято, шт.']:r.accepted??'Не завершено','Расхождение, шт.':!r.finalized?'Не завершено':r.accepted-Number(r.declared_qty)})),'Документ');
    }catch(e){if(run===state.drawerRun)$('drawerBody').innerHTML=empty('Не удалось открыть документ',e.message);}
  }
  function saveExcel(rows,name){
    if(!rows.length)return;if(typeof XLSX==='undefined'){toast('Не удалось загрузить модуль Excel. Обновите страницу и повторите.');return;}
    const book=XLSX.utils.book_new(),sheet=XLSX.utils.json_to_sheet(rows);sheet['!cols']=Object.keys(rows[0]).map((_,i)=>({wch:i===0?45:24}));XLSX.utils.book_append_sheet(book,sheet,name.slice(0,31));XLSX.writeFile(book,'Аргус — '+name+'.xlsx');
  }
  $('excelButton').onclick=()=>saveExcel(state.exportRows,pageInfo[state.view][1]);
  $('closeExport').onclick=()=>$('exportDialog').close();let exportRun=0;
  $('exportDialog').addEventListener('close',()=>exportRun++);
  $('oneCButton').onclick=async()=>{
    const run=++exportRun;$('exportBody').innerHTML=loading;$('exportDialog').showModal();
    try{const result=await api('/api/sellers/export/1c');if(run!==exportRun)return;
      const has=c=>result.issues.some(i=>i.code===c),check=(label,bad)=>`<li>${icon(bad?'info':'check')}<span class="${bad?'bad':''}">${label}</span></li>`;
      $('exportBody').innerHTML=`<p class="export-description">Передадим все товары вашей компании одним файлом: штрихкоды, количество на складе, в сборке и доступное к продаже. Количества не складываются с предыдущей выгрузкой.</p>
      <ul class="export-checks">${check('Количество товаров: '+n(result.productCount),!result.productCount)}${check('Подтверждённые остатки',has('unknown_stock')||has('invalid_quantity'))}${check('Штрихкоды заполнены и однозначны',has('missing_barcode')||has('duplicate_barcode')||has('invalid_barcode'))}</ul>
      ${result.ready?notice('Данные готовы к передаче','Файл содержит абсолютные количества. Товары, которых нет в файле, загрузчик должен оставить без изменений.'):notice('Сначала нужно уточнить данные',`Проблемы обнаружены у ${n(result.problemProducts)} товаров. Передайте список складу для проверки.`,true)}
      ${result.issues.length?`<ul class="export-issues">${result.issues.slice(0,12).map(i=>`<li><strong>${h(i.sku||'Выгрузка')}</strong> — ${h(i.message)}</li>`).join('')}${result.issues.length>12?'<li>Остальные замечания — в списке для склада.</li>':''}</ul>`:''}
      <p class="export-description"><strong>Для загрузки в 1С нужен совместимый загрузчик.</strong> Это файл обмена Аргуса, а не готовый документ любой версии 1С. Обработка для вашей конфигурации должна отдельно сопоставить товары и назначение количеств. Автоматическая загрузка в 1С пока не подключена.</p>
      <div class="export-actions"><button class="button primary" id="downloadSnapshot" ${result.ready?'':'disabled'}>${icon('download')}Скачать файл обмена</button>${result.issues.length?'<button class="button" id="downloadIssues">Список замечаний для склада</button>':''}</div><p class="export-footnote">Формат Аргуса v1 · штрихкоды сохраняются текстом · «Доступно к продаже» передаётся отдельно от физического остатка.</p>`;
      if($('downloadIssues'))$('downloadIssues').onclick=()=>saveExcel(result.issues.map(i=>({'Артикул':i.sku||'','Товар':i.name||'','Что проверить':i.message})),'Проверка выгрузки');
      $('downloadSnapshot').onclick=async()=>{const button=$('downloadSnapshot');button.disabled=true;try{const data=await api('/api/sellers/export/1c?download=1');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='argus-inventory-v1-'+data.generatedAt.slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('Файл обмена сохранён');}catch(e){toast(e.message);}finally{button.disabled=false;}};
    }catch(e){if(run===exportRun)$('exportBody').innerHTML=empty('Проверка не завершена',e.message);}
  };
  boot();
})();
