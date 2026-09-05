  const API_BASE = 'https://api.argus-ai.online';
  const TOKEN = localStorage.getItem('argus_token');
  const ROLE = localStorage.getItem('argus_role');
  if(!TOKEN || ROLE !== 'owner'){
    window.location.href = 'login.html';
    throw new Error('not authenticated');
  }

  function decodeJwtPayload(token){
    try{
      const payload = token.split('.')[1];
      // atob отдаёт байты, а не текст: каждый символ строки — один байт.
      // Кириллица в UTF-8 многобайтная, поэтому без явного декодирования
      // "Владимир" превращается в "Ð'Ð»Ð°Ð´Ð¸Ð¼Ð¸Ñ€".
      const bin = atob(payload.replace(/-/g,'+').replace(/_/g,'/'));
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch(e){ return {}; }
  }

  async function apiFetch(path, options = {}){
    const res = await fetch(API_BASE + path, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if(res.status === 401){
      localStorage.removeItem('argus_token');
      localStorage.removeItem('argus_role');
      window.location.href = 'login.html';
      throw new Error('сессия истекла');
    }
    const data = await res.json().catch(() => null);
    if(!res.ok) throw new Error((data && data.error) || 'Ошибка запроса');
    return data;
  }

  function logout(){
    localStorage.removeItem('argus_token');
    localStorage.removeItem('argus_role');
    window.location.href = 'login.html';
  }

  const authPayload = decodeJwtPayload(TOKEN);

  let warehouseName = '';

  async function loadWarehouseInfo(){
    try{
      const wh = await apiFetch('/api/warehouses/me');
      warehouseName = wh.name;
      document.getElementById('whSelectLabel').textContent = wh.name + (wh.city ? ' · ' + wh.city : '');
      renderWhStatusLine();
    } catch(e){ /* nothing to show if this fails, sidebar keeps its placeholder */ }
    const name = authPayload.ownerName || 'Владелец';
    document.getElementById('accountName').textContent = name;
    document.getElementById('accountAvatar').textContent = name.trim()[0].toUpperCase();
  }

  function toggleContextPanel(){
    const panel = document.getElementById('contextPanel');
    const btn = document.getElementById('contextToggleBtn');
    const handle = document.querySelector('.resize-handle[data-resize="context"]');
    const hiding = !panel.classList.contains('hidden');
    panel.classList.toggle('hidden', hiding);
    if(handle) handle.classList.toggle('hidden', hiding);
    btn.classList.toggle('active', hiding);
  }

  function initResizeHandles(){
    document.querySelectorAll('.resize-handle').forEach(handle=>{
      if(handle.dataset.bound) return;
      handle.dataset.bound = 'true';
      const targetName = handle.dataset.resize;
      const direction = handle.dataset.direction;
      const min = parseInt(handle.dataset.min) || 180, max = parseInt(handle.dataset.max) || 640;
      let startX, startWidth, panel;

      handle.addEventListener('mousedown', function(e){
        panel = document.getElementById(targetName) || document.querySelector('.' + targetName);
        if(!panel) return;
        startX = e.clientX;
        startWidth = panel.getBoundingClientRect().width;
        handle.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      function onMove(e){
        const dx = e.clientX - startX;
        let newWidth = direction === 'left' ? startWidth - dx : startWidth + dx;
        newWidth = Math.max(min, Math.min(max, newWidth));
        panel.style.width = newWidth + 'px';
      }
      function onUp(){
        handle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
    });
  }
  initResizeHandles();

  function switchView(view){
    document.getElementById('view-chat').classList.toggle('active', view==='chat');
    document.getElementById('view-journal').classList.toggle('active', view==='journal');
    document.getElementById('view-warehouse').classList.toggle('active', view==='warehouse');
    document.getElementById('view-staff').classList.toggle('active', view==='staff');
    document.getElementById('view-1c').classList.toggle('active', view==='1c');
    document.getElementById('view-mp').classList.toggle('active', view==='mp');
    document.getElementById('view-inv').classList.toggle('active', view==='inv');
    document.getElementById('nav-chat').classList.toggle('active', view==='chat');
    document.getElementById('nav-journal').classList.toggle('active', view==='journal');
    document.getElementById('nav-warehouse').classList.toggle('active', view==='warehouse');
    document.getElementById('nav-staff').classList.toggle('active', view==='staff');
    document.getElementById('nav-1c').classList.toggle('active', view==='1c');
    document.getElementById('nav-mp').classList.toggle('active', view==='mp');
    document.getElementById('nav-inv').classList.toggle('active', view==='inv');
    if(view==='journal'){
      journalUnread = 0;
      document.getElementById('navBadge').classList.remove('show');
      // Открыли журнал — сразу свежий, а не то, что было 25 секунд назад.
      loadJournal(false);
    }
    // Переписку тянем при первом открытии чата, а не при загрузке кабинета:
    // человек может весь день просидеть на складе и ни разу сюда не зайти.
    // Но «открытие» — это и старт кабинета тоже: чат открыт по умолчанию,
    // и раньше на нём никто switchView не вызывал, потому что активность
    // стояла классом в разметке. Экран выглядел открытым, а обработчик
    // открытия не срабатывал — история появлялась только после ухода
    // на другую вкладку и обратно. Поэтому старт теперь идёт через эту же
    // функцию (см. блок инициализации), а не через классы в HTML.
    if(view==='mp'){ loadMarketplaces(); }
    if(view==='inv'){ loadInventory(); }
    if(view==='chat'){
      loadChatHistory();
      const badge = document.getElementById('chatBadge');
      if(badge) badge.classList.remove('show');
    }
  }

  let whToastTimer = null;
  function showWhToast(text){
    const el = document.getElementById('whToast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(whToastTimer);
    whToastTimer = setTimeout(()=>el.classList.remove('show'), 2800);
  }

  /* ===================== Сотрудники ===================== */

  let staffMembers = [];

  async function loadStaff(){
    try{
      staffMembers = await apiFetch('/api/staff');
    } catch(e){
      showWhToast('Не удалось загрузить сотрудников: ' + e.message);
      staffMembers = [];
    }
    renderStaffTable();
  }

  function renderStaffTable(){
    const wrap = document.getElementById('staffRows');
    if(staffMembers.length === 0){
      wrap.innerHTML = '<div class="staff-empty">Сотрудников пока нет — добавьте первого выше.</div>';
      return;
    }
    wrap.innerHTML = staffMembers.map((s) => {
      const issued = new Date(s.issued_at).toLocaleDateString('ru-RU');
      return `
        <div class="staff-row ${s.active ? '' : 'revoked'}">
          <div class="staff-name">${s.name}</div>
          <div class="staff-key">${s.key_code}</div>
          <div class="staff-date">${issued}</div>
          <div><span class="staff-status ${s.active ? 'active' : 'revoked'}">${s.active ? 'активен' : 'отозван'}</span></div>
          <div class="staff-action ${s.active ? 'revoke' : 'restore'}" onclick="toggleStaffKey('${s.id}')">${s.active ? 'Отозвать' : 'Восстановить'}</div>
        </div>
      `;
    }).join('');
  }

  async function addStaffMember(){
    const input = document.getElementById('staffNameInput');
    const name = input.value.trim();
    if(!name){ showWhToast('Введите имя сотрудника.'); return; }
    try{
      const key = await apiFetch('/api/staff', {method:'POST', body:{name}});
      input.value = '';
      await loadStaff();
      showWhToast('Ключ ' + key.key_code + ' выдан сотруднику «' + name + '».');
    } catch(e){
      showWhToast('Не удалось выдать ключ: ' + e.message);
    }
  }

  async function toggleStaffKey(id){
    try{
      await apiFetch('/api/staff/' + id + '/toggle', {method:'PATCH'});
      await loadStaff();
    } catch(e){
      showWhToast('Не удалось изменить статус ключа: ' + e.message);
    }
  }

  /* ===================== Продавцы / компании ===================== */

  let companies = [];

  function companyNameById(id){
    const c = companies.find(c => c.id === id);
    return c ? c.name : 'Без компании';
  }

  async function loadCompanies(){
    try{
      companies = await apiFetch('/api/sellers/companies');
    } catch(e){
      showWhToast('Не удалось загрузить продавцов: ' + e.message);
      companies = [];
    }
    renderCompaniesList();
    renderInvoiceCompanySelect();
    renderMpCompanySelect();
  }

  function renderCompaniesList(){
    const wrap = document.getElementById('companiesList');
    if(companies.length === 0){
      wrap.innerHTML = '<div class="staff-empty">Компаний пока нет — добавьте первую выше.</div>';
      return;
    }
    wrap.innerHTML = companies.map(c => `
      <div class="staff-row" style="grid-template-columns:1.4fr 1fr auto;">
        <div class="staff-name">${c.name}</div>
        <div class="staff-key">${c.keys.length === 0 ? '—' : c.keys.map(k => `${k.keyCode}${k.active ? '' : ' (отозван)'}`).join(', ')}</div>
        <div class="staff-action" onclick="issueSellerKey('${c.id}')">+ Ключ</div>
      </div>
      ${c.keys.map(k => `
        <div class="staff-row" style="grid-template-columns:1.4fr 1fr auto; opacity:0.85;">
          <div class="staff-date" style="grid-column:1/3;">Ключ ${k.keyCode}, выдан ${new Date(k.issuedAt).toLocaleDateString('ru-RU')}</div>
          <div class="staff-action ${k.active ? 'revoke' : 'restore'}" onclick="toggleSellerKey('${k.id}')">${k.active ? 'Отозвать' : 'Восстановить'}</div>
        </div>
      `).join('')}
    `).join('');
  }

  function renderInvoiceCompanySelect(){
    const select = document.getElementById('invoiceCompanySelect');
    if(companies.length === 0){
      select.innerHTML = '<option value="">Сначала добавьте компанию</option>';
      return;
    }
    select.innerHTML = companies.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  async function addCompany(){
    const input = document.getElementById('companyNameInput');
    const name = input.value.trim();
    if(!name){ showWhToast('Введите название компании.'); return; }
    try{
      await apiFetch('/api/sellers/companies', {method:'POST', body:{name}});
      input.value = '';
      await loadCompanies();
      showWhToast('Компания «' + name + '» добавлена.');
    } catch(e){
      showWhToast('Не удалось добавить компанию: ' + e.message);
    }
  }

  async function issueSellerKey(companyId){
    try{
      const key = await apiFetch('/api/sellers/companies/' + companyId + '/keys', {method:'POST'});
      await loadCompanies();
      showWhToast('Ключ ' + key.key_code + ' выдан.');
    } catch(e){
      showWhToast('Не удалось выдать ключ: ' + e.message);
    }
  }

  async function toggleSellerKey(keyId){
    try{
      await apiFetch('/api/sellers/keys/' + keyId + '/toggle', {method:'PATCH'});
      await loadCompanies();
    } catch(e){
      showWhToast('Не удалось изменить статус ключа: ' + e.message);
    }
  }

  /* ===================== Накладные ===================== */

  function addInvoiceItemRow(){
    const wrap = document.getElementById('invoiceItemsInputs');
    const row = document.createElement('div');
    row.className = 'invoice-item-row';
    row.style.cssText = 'display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;';
    row.innerHTML = `
      <input type="text" class="inv-item-name" placeholder="Название товара" style="flex:2; min-width:140px; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px 10px; color:var(--text); font-family:var(--sans); font-size:13px;">
      <input type="text" class="inv-item-sku" placeholder="SKU" style="flex:1; min-width:90px; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px 10px; color:var(--text); font-family:var(--mono); font-size:13px;">
      <input type="number" class="inv-item-qty" placeholder="Кол-во" min="1" style="width:90px; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px 10px; color:var(--text); font-family:var(--mono); font-size:13px;">
      <button type="button" onclick="this.parentElement.remove()" style="background:none; border:none; color:var(--muted); cursor:pointer; font-size:14px;">✕</button>
    `;
    wrap.appendChild(row);
  }

  async function submitInvoice(){
    const companyId = document.getElementById('invoiceCompanySelect').value;
    const number = document.getElementById('invoiceNumberInput').value.trim();
    const rows = Array.from(document.querySelectorAll('#invoiceItemsInputs .invoice-item-row'));
    const items = rows.map(r => ({
      name: r.querySelector('.inv-item-name').value.trim(),
      sku: r.querySelector('.inv-item-sku').value.trim(),
      declaredQty: Number(r.querySelector('.inv-item-qty').value),
    })).filter(it => it.name && it.sku && it.declaredQty > 0);

    if(!companyId){ showWhToast('Выберите компанию.'); return; }
    if(!number){ showWhToast('Введите номер накладной.'); return; }
    if(items.length === 0){ showWhToast('Добавьте хотя бы одну позицию.'); return; }

    try{
      await apiFetch('/api/invoices', {method:'POST', body:{companyId, number, items}});
      document.getElementById('invoiceNumberInput').value = '';
      document.getElementById('invoiceItemsInputs').innerHTML = '';
      addInvoiceItemRow();
      await loadInvoicesList();
      showWhToast('Накладная ' + number + ' создана.');
    } catch(e){
      showWhToast('Не удалось создать накладную: ' + e.message);
    }
  }

  let lastInvoices = [];

  async function loadInvoicesList(){
    let invoices = [];
    try{
      invoices = await apiFetch('/api/invoices');
      lastInvoices = invoices;
    } catch(e){
      document.getElementById('invoicesList').innerHTML = '<div class="staff-empty">Не удалось загрузить накладные: ' + e.message + '</div>';
      return;
    }
    const wrap = document.getElementById('invoicesList');
    if(invoices.length === 0){
      wrap.innerHTML = '<div class="staff-empty">Накладных пока нет.</div>';
      return;
    }
    const statusLabel = {open:'не начата', in_progress:'в процессе', completed:'завершена'};
    wrap.innerHTML = invoices.map(inv => `
      <div class="staff-row" data-invoice-id="${inv.id}" style="grid-template-columns:1fr 1.2fr 1fr auto;">
        <div class="staff-key">${inv.number}</div>
        <div class="staff-name">${inv.company_name}</div>
        <div><span class="staff-status ${inv.status === 'completed' ? 'active' : ''}">${statusLabel[inv.status] || inv.status}</span></div>
        <div class="staff-action" data-history-invoice="${inv.id}" data-history-label="${escapeHTML(inv.number)}">История</div>
      </div>
    `).join('');
  }

  /* ===================== Подключение 1С ===================== */

  function copyActivationCode(){
    const code = document.getElementById('ocActivationCode').textContent;
    navigator.clipboard?.writeText(code);
    showWhToast('Код скопирован');
  }

  function formatQty(n){
    return typeof n === 'number' ? n.toLocaleString('ru-RU') : '—';
  }

  // "Последняя связь" — единственный честный признак живой синхронизации:
  // модуль в 1С отмечается на сервере при каждом запуске, и тихая смерть
  // расписания видна только по тому, что эта отметка перестала обновляться.
  function formatLastSeen(iso){
    if(!iso) return null;
    const then = new Date(iso);
    const mins = Math.round((Date.now() - then.getTime()) / 60000);
    if(mins < 1) return 'только что';
    if(mins < 60) return mins + ' ' + pluralRu(mins, 'минуту', 'минуты', 'минут') + ' назад';
    const hours = Math.round(mins / 60);
    if(hours < 24) return hours + ' ' + pluralRu(hours, 'час', 'часа', 'часов') + ' назад';
    return then.toLocaleString('ru-RU');
  }

  async function load1CStatus(manual){
    try{
      const s = await apiFetch('/api/sync/status');
      const lastSeen = formatLastSeen(s.lastSeenAt);

      if(!lastSeen){
        // Ключ мог быть уже выпущен, но модуль в 1С ещё ни разу не запускался —
        // для владельца это то же самое, что "не подключено".
        document.getElementById('ocConnected').style.display = 'none';
        document.getElementById('ocDisconnected').style.display = 'block';
        document.getElementById('ocStatusDot').classList.remove('connected');
        document.getElementById('ocStatusTitle').textContent = 'Не подключено';
        document.getElementById('ocStatusSub').textContent = 'Модуль в 1С ещё ни разу не выходил на связь';
        if(manual) showWhToast('1С пока не подключена');
        return;
      }

      document.getElementById('ocDisconnected').style.display = 'none';
      document.getElementById('ocConnected').style.display = 'block';
      document.getElementById('ocStatusDot').classList.add('connected');
      document.getElementById('ocStatusTitle').textContent = 'Подключено';
      document.getElementById('ocStatusSub').textContent = 'Номенклатура и накладные приходят из 1С';

      document.getElementById('ocNumProducts').textContent = formatQty(s.synced_products);
      document.getElementById('ocNumInvoices').textContent = formatQty(s.synced_invoices);
      document.getElementById('ocNumPending').textContent = formatQty(s.pendingEvents);
      document.getElementById('ocLastSeen').textContent = 'Последняя связь с 1С: ' + lastSeen;

      if(manual) showWhToast('Данные обновлены');
    } catch(e){
      if(manual) showWhToast('Не удалось получить статус: ' + e.message);
    }
  }

  // Настоящий ключ интеграции вместо выдуманного кода: тот же, что вводится
  // в модуле 1С. Если ключа ещё нет — владелец выпускает его здесь же.
  async function load1CKey(){
    const el = document.getElementById('ocActivationCode');
    if(!el) return;
    try{
      const keys = await apiFetch('/api/sync/keys');
      const active = keys.find(k => k.active);
      el.textContent = active ? active.key_code : 'Ключ ещё не выпущен';
    } catch(e){
      el.textContent = 'Не удалось загрузить ключ';
    }
  }

  /* ===================== Конструктор склада =====================

     Схема и есть редактор. Раньше склад набирался списком строк «Ряд 1, Ряд 2»
     под схемой, а схема была картинкой рядом — человек смотрел на неё, а
     управление лежало в другом месте. Из-за этого он не находил ни проходов,
     ни переименования: и то и другое жило в списке.

     Теперь всё на самой схеме: шов между рядами ставит проход, пунктирный
     ряд-призрак справа добавляет ряд, клик по букве над рядом переименовывает,
     клик по самому ряду открывает его размеры. */

  let ctorEditingExisting = false;
  let ctorRows = [];    // [{racks, tiers, label, aisleAfter}]
  let ctorZones = [];   // [{label}]
  let ctorSel = null;   // индекс выбранного ряда

  // topY и botY равны нарочно: сверху над рядом только его имя (34px),
  // снизу подпись в две строки (35px), и если оставить запас разным, ряды
  // повисают выше середины — снизу зияет полоса пустоты.
  const CTOR = {rowW: 58, rowH: 300, seam: 40, aisle: 104, topY: 56, botY: 56,
                zoneW: 46, zoneGap: 12, padX: 18};

  function openConstructor(){
    ctorEditingExisting = false;
    // Конструктор на вкладке один, и окно настроек физически забирает его к
    // себе (см. openWhSettings). Если после этого открыть его отсюда, он
    // останется внутри закрытого окна: онбординг спрячется, конструктор
    // «покажется» размером 0×0, и на вкладке не останется ничего — полностью
    // серый экран. Именно так и происходило после удаления схемы. Поэтому
    // сначала возвращаем его на место.
    const ctor = document.getElementById('whConstructor');
    const home = document.getElementById('view-warehouse');
    if(ctor.parentElement !== home) home.insertBefore(ctor, document.getElementById('whMapWrap'));

    // Склада ещё нет: пересобирать нечего и объединений ячеек не существует,
    // так что предупреждение о потере здесь только пугает.
    document.querySelector('.wh-ctor-warning').hidden = true;
    document.getElementById('whOnboarding').style.display = 'none';
    ctor.classList.remove('in-modal');
    ctor.classList.add('active');

    // Два ряда и ни одной зоны — самый маленький склад, который уже похож на
    // склад. С одного ряда не видно, что между рядами бывает проход.
    ctorRows = [newCtorRow(), newCtorRow()];
    ctorZones = [];
    ctorSel = null;
    renderCtor();
  }

  function newCtorRow(){
    return {racks: 8, tiers: 5, label: null, aisleAfter: false};
  }

  function cancelConstructor(){
    document.getElementById('whConstructor').classList.remove('active');
    if(ctorEditingExisting){
      closeWhSettings();
    } else {
      document.getElementById('whOnboarding').style.display = 'flex';
    }
  }

  /* ---------- правки схемы ---------- */

  function ctorAddRow(){
    ctorRows.push(newCtorRow());
    ctorSel = ctorRows.length - 1;
    renderCtor();
  }

  function ctorRemoveRow(i){
    if(ctorRows.length <= 1){ showWhToast('Хотя бы один ряд нужен.'); return; }
    ctorRows.splice(i, 1);
    if(ctorSel === i) ctorSel = null;
    else if(ctorSel > i) ctorSel -= 1;
    renderCtor();
  }

  // Проход после последнего ряда — это край склада, а не проезд, поэтому шов
  // за ним не рисуется вовсе и сюда попасть нельзя.
  function ctorToggleAisle(i){
    ctorRows[i].aisleAfter = !ctorRows[i].aisleAfter;
    renderCtor();
  }

  function ctorSelectRow(i){
    ctorSel = (ctorSel === i) ? null : i;
    renderCtor();
  }

  function ctorAddZone(){
    ctorZones.push({label: null});
    renderCtor();
  }

  function ctorRemoveZone(i){
    ctorZones.splice(i, 1);
    renderCtor();
  }

  const CTOR_MAX = {racks: 200, tiers: 30};

  /* Число набирают с клавиатуры, а не только стрелками — 40 стеллажей иначе
     это сорок нажатий.

     Поэтому во время набора перерисовывается только чертёж, но не сама панель:
     полная перерисовка заменяла поле ввода новым элементом, фокус слетал после
     первой же цифры, и набрать «15» было невозможно — доходило только «1». */
  function ctorSetSize(field, value){
    if(ctorSel === null) return;
    const n = parseInt(value, 10);
    // Пустое поле или мусор — человек ещё печатает, состояние не трогаем и
    // содержимое поля не переписываем: иначе курсор прыгает под руками.
    if(!Number.isFinite(n) || n < 1) return;
    ctorRows[ctorSel][field] = Math.min(CTOR_MAX[field], n);
    ctorRefreshSchema();
  }

  // Человек ушёл из поля — тут уже можно и подровнять значение, и перерисовать
  // панель целиком.
  function ctorCommitSize(field, input){
    if(ctorSel === null) return;
    const n = Math.max(1, Math.min(CTOR_MAX[field], parseInt(input.value, 10) || 1));
    ctorRows[ctorSel][field] = n;
    renderCtor();
  }

  // Обновляет чертёж и итог, не трогая поля ввода. Позицию прокрутки
  // сохраняем: на складе в шестьдесят рядов её сброс на каждую цифру означал
  // бы, что правишь ряд, которого не видно.
  function ctorRefreshSchema(){
    const canvas = document.getElementById('whCtorCanvas');
    const scroll = canvas && canvas.querySelector('.ctor-canvas-scroll');
    if(!scroll) return;
    const left = scroll.scrollLeft;
    scroll.outerHTML = ctorSvg();
    const fresh = canvas.querySelector('.ctor-canvas-scroll');
    if(fresh) fresh.scrollLeft = left;
    const total = canvas.querySelector('.ctor-side-total');
    if(total && ctorSel !== null){
      const row = ctorRows[ctorSel];
      total.textContent = (row.racks * row.tiers).toLocaleString('ru-RU');
    }
    ctorBalanceScrollbar();
  }

  // Ряды на складе обычно одинаковые, а набивать их по одному — это то, чем
  // старый список и был плох.
  function ctorApplyToAll(){
    if(ctorSel === null) return;
    const {racks, tiers} = ctorRows[ctorSel];
    ctorRows.forEach(r => { r.racks = racks; r.tiers = tiers; });
    renderCtor();
    showWhToast('Размеры применены ко всем рядам.');
  }

  /* ---------- переименование прямо на схеме ---------- */

  function ctorRename(kind, i){
    const host = document.getElementById(kind === 'row' ? 'ctorRowName' + i : 'ctorZoneName' + i);
    if(!host) return;
    const list = kind === 'row' ? ctorRows : ctorZones;
    const input = document.createElement('input');
    input.className = 'wh-rename-input ctor-rename';
    input.value = list[i].label || '';
    input.maxLength = NAME_MAX;
    input.placeholder = kind === 'row' ? String(i + 1) : 'З' + (i + 1);
    input.title = `Не длиннее ${NAME_MAX} символов. Пусто — вернуть номер.`;

    const finish = (save) => {
      input.removeEventListener('blur', onBlur);
      if(save){
        const value = input.value.trim();
        const taken = list.some((item, j) => j !== i && item.label && item.label.toLowerCase() === value.toLowerCase());
        if(taken){
          showWhToast(`Имя «${value}» уже занято — адреса стали бы неоднозначными`);
        } else {
          list[i].label = value || null;
        }
      }
      renderCtor();
    };
    const onBlur = () => finish(true);
    input.addEventListener('keydown', e => {
      if(e.key === 'Enter'){ e.preventDefault(); input.blur(); }
      if(e.key === 'Escape'){ e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', onBlur);
    host.innerHTML = '';
    host.appendChild(input);
    input.focus();
    input.select();
  }

  /* ---------- перетаскивание ряда ---------- */

  let ctorDrag = null;

  function ctorRowPointerDown(e, i){
    // Только левой кнопкой и только с самого ряда: подпись над ним открывает
    // переименование, и перетаскивание там мешало бы попасть по букве.
    if(e.button !== 0) return;
    ctorDrag = {from: i, startX: e.clientX, moved: false};
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function ctorRowPointerMove(e){
    if(!ctorDrag) return;
    if(Math.abs(e.clientX - ctorDrag.startX) < 6) return;
    ctorDrag.moved = true;
    const svg = document.getElementById('ctorSvg');
    if(!svg) return;
    // Куда попал курсор по горизонтали — тот ряд и уступает место.
    const rects = Array.from(svg.querySelectorAll('.ctor-row-rect'));
    const over = rects.findIndex(r => {
      const b = r.getBoundingClientRect();
      return e.clientX >= b.left && e.clientX <= b.right;
    });
    if(over >= 0 && over !== ctorDrag.from){
      const [moved] = ctorRows.splice(ctorDrag.from, 1);
      ctorRows.splice(over, 0, moved);
      if(ctorSel === ctorDrag.from) ctorSel = over;
      ctorDrag.from = over;
      renderCtor();
    }
  }

  function ctorRowPointerUp(e, i){
    const wasDrag = ctorDrag && ctorDrag.moved;
    ctorDrag = null;
    // Клик и перетаскивание начинаются одинаково; выбираем ряд только если
    // мышь никуда не уехала, иначе каждый перенос ещё и открывал бы панель.
    if(!wasDrag) ctorSelectRow(i);
  }

  /* ---------- отрисовка ---------- */

  function renderCtor(){
    const canvas = document.getElementById('whCtorCanvas');
    if(!canvas) return;
    canvas.innerHTML = ctorSvg() + ctorInspector();
    ctorBalanceScrollbar();
  }

  // Полоса прокрутки живёт внутри окошка и съедает высоту только снизу —
  // из-за неё ряды повисали выше середины. Отступ сверху доводим ровно до её
  // высоты: она то есть, то нет, и угадывать это числом в CSS нельзя.
  function ctorBalanceScrollbar(){
    const scroll = document.querySelector('.ctor-canvas-scroll');
    if(!scroll) return;
    const bar = scroll.offsetHeight - scroll.clientHeight;
    scroll.style.paddingTop = (10 + bar) + 'px';
  }

  function ctorSvg(){
    const C = CTOR;
    // Зоны выкладываем в колонки по высоте ряда. Их бывает до шестидесяти, и
    // одной колонкой они уходили ниже самого чертежа и обрезались.
    const perCol = Math.max(1, Math.floor((C.rowH + C.zoneGap) / (C.zoneW + C.zoneGap)));
    const zoneSlots = ctorZones.length + 1;   // +1 — облако «добавить зону»
    const zoneCols = Math.ceil(zoneSlots / perCol);
    const zoneColW = C.zoneW + 22;
    const startX = C.padX + zoneCols * zoneColW + 20;
    const zoneXY = (i) => ({
      x: C.padX + Math.floor(i / perCol) * zoneColW,
      y: C.topY + (i % perCol) * (C.zoneW + C.zoneGap),
    });

    // Раскладка по горизонтали: ряд, потом шов — узкий или шириной прохода.
    const xs = [];
    let x = startX;
    ctorRows.forEach((row, i) => {
      xs.push(x);
      const last = i === ctorRows.length - 1;
      x += C.rowW + (last ? 0 : (row.aisleAfter ? C.aisle : C.seam));
    });
    const ghostX = x + C.seam + 8;
    const totalW = ghostX + C.rowW + C.padX;
    const totalH = C.topY + C.rowH + C.botY;
    const midY = C.topY + C.rowH / 2;

    let out = '';

    // ---- зоны сортировки слева ----
    ctorZones.forEach((z, i) => {
      const {x: zx, y: zy} = zoneXY(i);
      const name = z.label || ('З' + (i + 1));
      out += `<g class="ctor-zone">
        <rect class="ctor-zone-rect" x="${zx}" y="${zy}" width="${C.zoneW}" height="${C.zoneW}" rx="4"/>
        <foreignObject x="${zx}" y="${zy + 12}" width="${C.zoneW}" height="24">
          <div xmlns="http://www.w3.org/1999/xhtml" class="ctor-name" id="ctorZoneName${i}"
               onclick="ctorRename('zone', ${i})" title="Нажмите, чтобы переименовать зону">${escapeHTML(String(name))}</div>
        </foreignObject>
        <g class="ctor-zone-del" onclick="ctorRemoveZone(${i})">
          <circle cx="${zx + C.zoneW}" cy="${zy}" r="8"/>
          <path d="M${zx + C.zoneW - 4} ${zy}h8"/>
        </g>
      </g>`;
    });
    const gz = zoneXY(ctorZones.length);
    out += `<g class="ctor-ghost-zone" onclick="ctorAddZone()">
      <rect x="${gz.x}" y="${gz.y}" width="${C.zoneW}" height="${C.zoneW}" rx="4"/>
      <path d="M${gz.x + C.zoneW/2 - 7} ${gz.y + C.zoneW/2}h14M${gz.x + C.zoneW/2} ${gz.y + C.zoneW/2 - 7}v14"/>
      <title>Добавить зону сортировки</title>
    </g>`;

    // ---- ряды и швы ----
    ctorRows.forEach((row, i) => {
      const rx = xs[i];
      const name = row.label || (i + 1);
      const selected = ctorSel === i;
      out += `<g class="ctor-row${selected ? ' selected' : ''}">
        <rect class="ctor-row-rect" x="${rx}" y="${C.topY}" width="${C.rowW}" height="${C.rowH}" rx="5"
              onpointerdown="ctorRowPointerDown(event, ${i})"
              onpointermove="ctorRowPointerMove(event)"
              onpointerup="ctorRowPointerUp(event, ${i})"/>
        <foreignObject x="${rx - 14}" y="${C.topY - 34}" width="${C.rowW + 28}" height="30">
          <div xmlns="http://www.w3.org/1999/xhtml" class="ctor-name" id="ctorRowName${i}"
               onclick="ctorRename('row', ${i})" title="Нажмите, чтобы переименовать ряд">${escapeHTML(String(name))}</div>
        </foreignObject>
      </g>`;

      if(i === ctorRows.length - 1) return;
      const seamW = row.aisleAfter ? C.aisle : C.seam;
      const cx = rx + C.rowW + seamW / 2;
      if(row.aisleAfter){
        out += `<g class="ctor-seam on" onclick="ctorToggleAisle(${i})">
          <rect class="ctor-seam-hit" x="${rx + C.rowW}" y="${C.topY}" width="${seamW}" height="${C.rowH}"/>
          <path class="ctor-seam-line" d="M${cx} ${C.topY + 4}v${C.rowH - 8}"/>
          <circle class="ctor-seam-dot" cx="${cx}" cy="${midY}" r="14"/>
          <path class="ctor-seam-sign" d="M${cx - 7} ${midY}h14"/>
          <text class="ctor-seam-cap" x="${cx}" y="${C.topY + C.rowH + 18}">проход</text>
          <title>Нажмите, чтобы убрать проход</title>
        </g>`;
      } else {
        out += `<g class="ctor-seam" onclick="ctorToggleAisle(${i})">
          <rect class="ctor-seam-hit" x="${rx + C.rowW}" y="${C.topY}" width="${seamW}" height="${C.rowH}"/>
          <path class="ctor-seam-line" d="M${cx} ${C.topY + 4}v${C.rowH - 8}"/>
          <circle class="ctor-seam-dot" cx="${cx}" cy="${midY}" r="13"/>
          <path class="ctor-seam-sign" d="M${cx - 7} ${midY}h14M${cx} ${midY - 7}v14"/>
          <text class="ctor-seam-cap" x="${cx}" y="${C.topY + C.rowH + 18}">добавить</text>
          <text class="ctor-seam-cap" x="${cx}" y="${C.topY + C.rowH + 31}">проход</text>
          <title>Нажмите, чтобы поставить проход</title>
        </g>`;
      }
    });

    // ---- ряд-призрак ----
    const gcx = ghostX + C.rowW / 2;
    out += `<g class="ctor-ghost-row" onclick="ctorAddRow()">
      <rect x="${ghostX}" y="${C.topY}" width="${C.rowW}" height="${C.rowH}" rx="5"/>
      <circle class="ctor-ghost-dot" cx="${gcx}" cy="${midY}" r="16"/>
      <path class="ctor-ghost-sign" d="M${gcx - 8} ${midY}h16M${gcx} ${midY - 8}v16"/>
      <text class="ctor-seam-cap" x="${gcx}" y="${C.topY + C.rowH + 18}">добавить</text>
      <text class="ctor-seam-cap" x="${gcx}" y="${C.topY + C.rowH + 31}">ряд</text>
      <title>Добавить ряд</title>
    </g>`;

    return `<div class="ctor-canvas-scroll"><svg id="ctorSvg" width="${totalW}" height="${totalH}"
      viewBox="0 0 ${totalW} ${totalH}">${out}</svg></div>`;
  }

  function ctorInspector(){
    const total = ctorRows.reduce((sum, r) => sum + r.racks * r.tiers, 0);
    const aisles = ctorRows.filter(r => r.aisleAfter).length;
    if(ctorSel === null){
      return `<div class="ctor-side">
        <div class="ctor-side-label">Склад целиком</div>
        <div class="ctor-side-total">${total.toLocaleString('ru-RU')}</div>
        <div class="ctor-side-note">мест хранения</div>
        <div class="ctor-side-facts">
          <div><span>Рядов</span><span>${ctorRows.length}</span></div>
          <div><span>Проходов</span><span>${aisles}</span></div>
          <div><span>Зон сортировки</span><span>${ctorZones.length}</span></div>
        </div>
        <div class="ctor-side-hint">Нажмите на ряд, чтобы задать стеллажи и ярусы.</div>
      </div>`;
    }
    const row = ctorRows[ctorSel];
    return `<div class="ctor-side">
      <div class="ctor-side-label">Ряд ${escapeHTML(String(row.label || (ctorSel + 1)))}</div>
      <label class="ctor-side-field">Стеллажей в ряду
        <span class="wh-stepper">
          <button type="button" class="minus" onclick="stepWhValue(this,-1)" aria-label="Меньше"></button>
          <input type="number" min="1" max="200" value="${row.racks}" inputmode="numeric"
                 oninput="ctorSetSize('racks', this.value)" onchange="ctorCommitSize('racks', this)"
                 onblur="ctorCommitSize('racks', this)" onfocus="this.select()">
          <button type="button" class="plus" onclick="stepWhValue(this,1)" aria-label="Больше"></button>
        </span>
      </label>
      <label class="ctor-side-field">Ярусов на стеллаже
        <span class="wh-stepper">
          <button type="button" class="minus" onclick="stepWhValue(this,-1)" aria-label="Меньше"></button>
          <input type="number" min="1" max="30" value="${row.tiers}" inputmode="numeric"
                 oninput="ctorSetSize('tiers', this.value)" onchange="ctorCommitSize('tiers', this)"
                 onblur="ctorCommitSize('tiers', this)" onfocus="this.select()">
          <button type="button" class="plus" onclick="stepWhValue(this,1)" aria-label="Больше"></button>
        </span>
      </label>
      <div class="ctor-side-total">${(row.racks * row.tiers).toLocaleString('ru-RU')}</div>
      <div class="ctor-side-note">мест в этом ряду</div>
      <button class="ctor-side-btn" type="button" onclick="ctorApplyToAll()">Как у всех рядов</button>
      <button class="ctor-side-btn danger" type="button" onclick="ctorRemoveRow(${ctorSel})">Удалить ряд</button>
    </div>`;
  }

  function stepWhValue(btn, delta){
    const input = btn.parentElement.querySelector('input');
    const min = parseInt(input.min) || 0;
    const max = parseInt(input.max) || 999;
    input.value = Math.max(min, Math.min(max, (parseInt(input.value) || 0) + delta));
    input.dispatchEvent(new Event('input', {bubbles: true}));
  }

  function buildFloorplanSVGCustom(rowOrder, aisleAfter, zoneOrder){
    const rowW = 36, rowH = 230, gapNoAisle = 12, gapAisle = 96, topY = 44;
    const zoneW = 30, zoneGap = 8;
    const zoneOffsetX = 16;
    const maxPerCol = Math.max(1, Math.floor((rowH + zoneGap) / (zoneW + zoneGap)));
    const zoneCols = zoneOrder.length > 0 ? Math.ceil(zoneOrder.length / maxPerCol) : 0;
    const zoneColWidth = zoneW + 10;
    const startX = zoneOrder.length > 0 ? (zoneOffsetX + zoneCols * zoneColWidth + 16) : 36;
    const xs = [];
    let x = startX;
    for(let i = 0; i < rowOrder.length; i++){
      xs.push(x);
      const hasAisle = aisleAfter[i];
      x += rowW + (hasAisle ? gapAisle : gapNoAisle);
    }
    const totalW = xs[xs.length - 1] + rowW + 36;
    const totalH = topY + rowH + 26;
    let zones = '';
    for(let i = 0; i < zoneOrder.length; i++){
      const col = Math.floor(i / maxPerCol);
      const rowInCol = i % maxPerCol;
      const zx = zoneOffsetX + col * zoneColWidth;
      const zy = topY + rowInCol * (zoneW + zoneGap);
      const zn = zoneOrder[i];
      zones += `<g onclick="selectZone('${zn.id}')"><rect class="wh-zone-rect" x="${zx}" y="${zy}" width="${zoneW}" height="${zoneW}" rx="4"/><text class="wh-zone-label" x="${zx + zoneW/2}" y="${zy + zoneW/2 + 3}">${zn.label}</text></g>`;
    }
    let rects = '', aisles = '';
    for(let i = 0; i < rowOrder.length; i++){
      const n = rowOrder[i];
      // Заполненность ряда прямо на схеме: столбик подрастает снизу вверх, как
      // наполняется стеллаж, и красится той же шкалой, что и ячейки — зелёный
      // внизу, оранжевый под потолок. Схема — первое, что видит владелец, и
      // она должна отвечать на главный вопрос «где ещё есть место» тем же
      // языком, что и сетка ряда.
      //
      // Считаем среднюю заполненность мест, а не долю занятых. Ряд из
      // девяноста шести ячеек, в каждой по пять штук, «занят» на сто процентов
      // и при этом почти пуст — по такой мерке владелец решил бы, что везти
      // товар некуда.
      const blocks = cellBlocks[n] || [];
      const taken = blocks.filter(b => b.state === 'occupied').length;
      const fullness = blocks.length
        ? blocks.reduce((sum, b) => sum + (b.state === 'occupied' ? Number(b.fill) || 0 : 0), 0) / blocks.length
        : 0;
      const pct = fullness / 100;
      const fillH = Math.round(rowH * pct);
      const paint = cellPaint(fullness);
      const meter = fillH > 0
        ? `<rect class="wh-row-rect-fill" x="${xs[i]}" y="${topY + rowH - fillH}" width="${rowW}" height="${fillH}" rx="4" style="fill:${paint.edge};"/>`
        : '';
      const titleText = blocks.length
        ? `Ряд ${rowLabel(n)}: заполнен на ${Math.round(fullness)}%, занято мест ${taken} из ${blocks.length}`
        : `Ряд ${rowLabel(n)}`;
      rects += `<g onclick="focusRow(${n})"><title>${titleText}</title><rect class="wh-row-rect" id="row-rect-${n}" x="${xs[i]}" y="${topY}" width="${rowW}" height="${rowH}" rx="4"/>${meter}<text class="wh-row-num" x="${xs[i] + rowW/2}" y="${topY - 10}">${escapeHTML(String(rowLabel(n)))}</text></g>`;
      if(aisleAfter[i] && i < rowOrder.length - 1){
        const cx = xs[i] + rowW + gapAisle/2;
        const cy = topY + rowH/2;
        aisles += `<text class="wh-aisle-label" x="${cx}" y="${cy}" transform="rotate(-90 ${cx} ${cy})" text-anchor="middle">ПРОХОД</text>`;
      }
    }
    return `<svg width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" style="max-width:100%;">${zones}${rects}${aisles}</svg>`;
  }

  let cellBlocks = {};   // cellBlocks[rowNum] = [{r0,r1,t0,t1,state,fill,blockId,stock}, ...] — из /api/cells/rows
  let rowMeta = {};      // rowMeta[rowNum] = {rackCount, tierCount}
  let blockById = {};    // blockId -> {block, rowNum} — чтобы по клику найти ячейку целиком

  function populateCellStateFromApi(apiRows){
    cellBlocks = {};
    rowMeta = {};
    blockById = {};
    apiRows.forEach(row => {
      rowMeta[row.row_num] = {rackCount: row.rack_count, tierCount: row.tier_count, label: row.label || null, aisleAfter: row.aisle_after === true};
      cellBlocks[row.row_num] = row.blocks.map(b => {
        const block = {
          r0: b.rack_start, r1: b.rack_end, t0: b.tier_start, t1: b.tier_end,
          state: b.state, fill: b.fill_pct, blockId: b.id, stock: b.stock || [],
        };
        blockById[b.id] = {block, rowNum: row.row_num};
        return block;
      });
    });
  }

  function hslToRgb(h, s, l){
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
  }
  const lerp = (a, b, t) => a + (b - a) * t;

  // Цвет ячейки по заполненности.
  //
  // Внутри ячейки идёт переход: слева бледно, справа насыщенно — и чем полнее
  // ячейка, тем ярче её правый край. Пустая почти прозрачная, полная звонкая.
  //
  // Оттенок держится зелёным до 70%, дальше быстро уходит в оранжевый. Это не
  // произвол: между зелёным и оранжевым по кругу цветов всегда лежит жёлтый, и
  // единственный способ не получить грязный жёлто-оливковый на половине карты —
  // проскочить его узкой полосой у самого верха шкалы. Прежняя формула мешала
  // бирюзовый с терракотовым напрямую по RGB и давала ровно посередине серое.
  function cellPaint(pct){
    const t = Math.min(100, Math.max(0, pct)) / 100;
    const hue = t < 0.7 ? lerp(140, 128, t / 0.7) : lerp(128, 26, (t - 0.7) / 0.3);
    const [er, eg, eb] = hslToRgb(hue, lerp(32, 80, t), lerp(60, 52, t));
    const [sr, sg, sb] = hslToRgb(hue, lerp(26, 46, t), lerp(64, 60, t));
    const endA = lerp(0.18, 0.62, t), startA = lerp(0.06, 0.16, t);
    return {
      start: `rgba(${sr},${sg},${sb},${startA})`,
      end:   `rgba(${er},${eg},${eb},${endA})`,
      edge:  `rgba(${er},${eg},${eb},${Math.min(0.9, endA + 0.3)})`,
    };
  }

  // Шкала заполненности включена. Процент приходит с сервера в fill_pct и
  // считается от УСЛОВНОЙ вместимости ячейки в 500 штук — габаритов у товара
  // нет ни у одной позиции, измерить настоящую вместимость нечем.
  //
  // Это соглашение, а не измерение, и путать одно с другим нельзя: как только
  // в 1С появятся размеры и вес, процент надо считать от них, а 500 убрать.
  // До тех пор цвет честно показывает «сколько штук относительно 500», и это
  // ровно то, что видно в карточке ячейки рядом.
  //
  // Вернуть один ровный тон вместо шкалы — поставить true.
  const FULLNESS_IS_BINARY = false;
  const OCCUPIED_TONE_PCT = 42;

  // Инлайновые переменные для ячейки — сам градиент собирается в CSS.
  function cellPaintVars(pct){
    const tone = FULLNESS_IS_BINARY ? OCCUPIED_TONE_PCT : pct;
    const p = cellPaint(tone);
    return ` --fill:${FULLNESS_IS_BINARY ? 100 : pct}%; --c-start:${p.start}; --c-end:${p.end}; --edge:${p.edge};`;
  }

  // Класс, который переключает ячейку между «полоса заполнения» и «просто
  // занята». Полоса слева направо читается как процент — и пока настоящего
  // процента нет, она врёт: зелёный цвет говорит «место есть», а полоса во всю
  // ширину — «забита». Поэтому в бинарном режиме заливка ровная, без
  // направления, и никакой доли не обещает.
  const fillModeClass = FULLNESS_IS_BINARY ? ' fill-unknown' : '';

  // Имя ряда, если владелец его задал, иначе номер. Оно же становится первой
  // частью адреса ячейки, поэтому берётся здесь, в одном месте: адрес должен
  // читаться одинаково и на карте, и в поиске, и в подсказке при приёмке.
  function rowLabel(rowNum){
    const meta = rowMeta[rowNum];
    return (meta && meta.label) || rowNum;
  }

  function cellAddr(rowNum, rackNum, tier){
    return rowLabel(rowNum) + '.' + rackNum + '.' + tier;
  }

  function blockAddr(rowNum, block){
    const rackPart = block.r0 === block.r1 ? block.r0 : (block.r0 + '–' + block.r1);
    const tierPart = block.t0 === block.t1 ? block.t0 : (block.t0 + '–' + block.t1);
    return rowLabel(rowNum) + '.' + rackPart + '.' + tierPart;
  }

  function pluralRu(n, one, few, many){
    const mod100 = Math.abs(n) % 100;
    const mod10 = mod100 % 10;
    if(mod100 > 10 && mod100 < 20) return many;
    if(mod10 > 1 && mod10 < 5) return few;
    if(mod10 === 1) return one;
    return many;
  }

  // Сводная статистика по складу — площадь считается в физических местах (стеллаж × ярус),
  // а не в блоках, поэтому объединение ячеек не искажает проценты заполнения.
  function warehouseStats(){
    const rows = Object.keys(rowMeta).map(Number).sort((a,b) => a - b);
    let rackTotal = 0, cellTotal = 0, occupiedUnits = 0;
    const perRow = rows.map(rowNum => {
      const meta = rowMeta[rowNum];
      const total = meta.rackCount * meta.tierCount;
      let occ = 0;
      (cellBlocks[rowNum] || []).forEach(b => {
        if(b.state === 'occupied') occ += (b.r1 - b.r0 + 1) * (b.t1 - b.t0 + 1);
      });
      rackTotal += meta.rackCount;
      cellTotal += total;
      occupiedUnits += occ;
      return {rowNum, total, occ, free: total - occ, pct: total ? Math.round(occ / total * 100) : 0};
    });
    const pct = cellTotal ? Math.round(occupiedUnits / cellTotal * 100) : 0;
    return {rows, rackTotal, cellTotal, occupiedUnits, pct, perRow};
  }

  function renderWhStatusLine(){
    const el = document.getElementById('whStatusLine');
    if(!el) return;
    const s = warehouseStats();
    el.textContent = [
      warehouseName || 'Склад',
      `${s.rows.length} ${pluralRu(s.rows.length, 'ряд', 'ряда', 'рядов')}`,
      `${s.rackTotal} ${pluralRu(s.rackTotal, 'стеллаж', 'стеллажа', 'стеллажей')}`,
      `${s.cellTotal} ${pluralRu(s.cellTotal, 'ячейка', 'ячейки', 'ячеек')}`,
      `занято ${s.pct}%`,
    ].join(' · ');
  }

  function renderRackRowHtml(rowNum){
    const meta = rowMeta[rowNum];
    const rackCount = meta.rackCount, tierCount = meta.tierCount;
    let cellsHtml = '';
    let occ = 0, tot = 0, fillSum = 0;

    cellBlocks[rowNum].forEach(b => {
      tot++;
      if(b.state === 'occupied'){ occ++; fillSum += Number(b.fill) || 0; }
      const addr = blockAddr(rowNum, b);
      const mergedClass = (b.r0 !== b.r1 || b.t0 !== b.t1) ? ' merged' : '';
      const gridRowStart = tierCount - b.t1 + 1;
      const gridRowSpan = b.t1 - b.t0 + 1;
      const style = b.state === 'occupied'
        ? ` style="grid-column:${b.r0} / span ${b.r1 - b.r0 + 1}; grid-row:${gridRowStart} / span ${gridRowSpan};${cellPaintVars(b.fill)}"`
        : ` style="grid-column:${b.r0} / span ${b.r1 - b.r0 + 1}; grid-row:${gridRowStart} / span ${gridRowSpan};"`;
      // Раньше здесь в data-атрибуты клался только stock[0] — при клике по
      // объединённой ячейке с тремя артикулами было видно один. Теперь на
      // ячейке лежит её id, а содержимое берётся целиком из blockById.
      cellsHtml += `<div class="wh-cell in-grid ${b.state}${mergedClass}${b.state === 'occupied' ? fillModeClass : ''}" data-row="${rowNum}" data-id="${b.r0}" data-tier="${b.t0}" data-addr="${addr}" data-state="${b.state}" data-block-id="${b.blockId}"${style} onclick="selectCell(this)" title="${addr}"></div>`;
    });

    let labelsHtml = '';
    for(let r = 1; r <= rackCount; r++){
      labelsHtml += `<div class="wh-rack-label" data-rack="${r}" style="grid-column:${r}; grid-row:${tierCount + 1};">${escapeHTML(String(rowLabel(rowNum)))}.${r}</div>`;
    }

    const pct = tot ? Math.round(occ / tot * 100) : 0;
    // Полоса растёт и красится по средней заполненности, а цифры рядом считают
    // места. Это разные вещи: ряд, где заняты все ячейки, но в каждой по пять
    // штук, забит на 100% мест и почти пуст по товару. Цвет везде — на схеме,
    // в этой полосе и в самих ячейках — означает одно и то же.
    const fullness = tot ? Math.round(fillSum / tot) : 0;
    const rowPaint = cellPaint(fullness);
    const editing = editingRowNum === rowNum;

    // Правка ячеек живёт здесь же, в панели ряда, а не в отдельном окне
    // настроек: ряд человек уже выбрал кликом по схеме, спрашивать второй раз
    // «какой ряд правим» незачем. Карандаш переключает эту же панель между
    // просмотром и правкой — уходить с неё никуда не нужно.
    const body = editing
      ? rowEditorHtml(rowNum)
      : `<div class="wh-rack-grid" style="grid-template-columns:repeat(${rackCount}, 64px); grid-template-rows:repeat(${tierCount}, 32px) auto;">${cellsHtml}${labelsHtml}</div>`;

    return `<div class="wh-row-group${editing ? ' editing' : ''}" id="fp-row-${rowNum}">
      <button class="wh-panel-back" onclick="showWhSummary()">← Назад к сводке</button>
      <div class="wh-row-group-head">
        <button class="wh-row-group-title wh-renamable" type="button" onclick="startRename('row', ${rowNum})"
                title="Нажмите, чтобы переименовать ряд">Ряд ${escapeHTML(String(rowLabel(rowNum)))}</button>
        <span class="wh-row-group-meter" title="Заполнен на ${fullness}%"><span class="wh-row-group-meter-fill" style="width:${fullness}%; background:${rowPaint.edge};"></span></span>
        <span class="wh-row-group-stats">заполнен на ${fullness}% · занято мест ${occ} из ${tot}</span>
        <button class="wh-row-edit-btn${editing ? ' active' : ''}" type="button"
                onclick="toggleRowEdit(${rowNum})"
                title="${editing ? 'Закончить правку ячеек' : 'Править ячейки этого ряда'}">
          ${editing ? 'Готово' : `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>Править ячейки`}
        </button>
      </div>
      ${body}
    </div>`;
  }

  function refreshRackRowDOM(rowNum){
    const el = document.getElementById('fp-row-' + rowNum);
    if(!el) return;

    // Ряд перерисовывается целиком, а выбранная ячейка после этого — уже
    // другой элемент DOM. Оставить открытую карточку значило бы показывать
    // содержимое ячейки, которой на экране больше нет.
    if(el.querySelector('.wh-cell.selected')) closeWhDetailPanel();

    const wasVisible = el.classList.contains('visible');
    el.outerHTML = renderRackRowHtml(rowNum);
    const newEl = document.getElementById('fp-row-' + rowNum);
    if(newEl) newEl.classList.toggle('visible', wasVisible);
    bindRowEditor(rowNum);
  }

  let editingRowNum = null;   // ряд, который сейчас правят; null — никакой

  function toggleRowEdit(rowNum){
    const leaving = editingRowNum === rowNum;
    const previous = editingRowNum;
    editingRowNum = leaving ? null : rowNum;
    // Правится всегда только один ряд: если был открыт другой, он возвращается
    // в обычный вид сам, без отдельного действия.
    if(previous !== null && previous !== rowNum) refreshRackRowDOM(previous);
    refreshRackRowDOM(rowNum);
  }

  // Сетку перерисовывает outerHTML, поэтому обработчик вешается заново после
  // каждой перерисовки — на новый элемент, так что дубликатов не копится.
  function bindRowEditor(rowNum){
    const grid = document.querySelector(`#fp-row-${rowNum} .wh-full-grid`);
    if(grid) grid.addEventListener('pointerdown', onRowGridPointerDown);
  }

  // Редактор ряда: ячейки лежат в обычной сетке стеллаж × ярус, а поверх них —
  // прозрачный слой "горячих точек" по одной на каждое место. Тянем мышкой по
  // этому слою — получаем прямоугольник, отпускаем — объединяем одним запросом.
  //
  // Прошлый вариант рисовал кнопки "+" в узких промежутках между ячейками, и
  // они появлялись только между блоками ровно одинакового размера: объединил
  // две ячейки по вертикали — и сбоку "+" пропадал, потому что сосед другой
  // высоты. Выглядело как "то работает, то нет", хотя правило было логичным.
  function rowEditorHtml(rowNum){
    const meta = rowMeta[rowNum];
    const blocks = cellBlocks[rowNum];
    if(!meta || !blocks) return '';
    const {rackCount, tierCount} = meta;

    // Размер ячейки подбирается под ширину ряда: фиксированные 88px означали,
    // что ряд из 40 стеллажей занимает больше 4000px и вылезает за окно.
    const cellW = rackCount > 24 ? 34 : rackCount > 14 ? 52 : 78;
    const cellH = rackCount > 24 ? 30 : rackCount > 14 ? 38 : 46;
    const gridRowOf = t => tierCount - t + 1;   // ярус 1 — внизу

    const cellsHtml = blocks.map(block => {
      const wide = block.r1 - block.r0 + 1, tall = block.t1 - block.t0 + 1;
      const isMerged = wide > 1 || tall > 1;
      const addr = blockAddr(rowNum, block);
      const fillVars = block.state === 'occupied' ? cellPaintVars(block.fill) : '';
      return `<div class="wh-big-cell ${block.state}${isMerged ? ' merged' : ''}${block.state === 'occupied' ? fillModeClass : ''}"
        style="grid-column:${block.r0} / span ${wide}; grid-row:${gridRowOf(block.t1)} / span ${tall};${fillVars}"
        title="${addr}">
        <span class="wh-big-cell-label">${addr}</span>
        ${isMerged ? `<span class="wh-big-cell-size">${wide}×${tall}</span>
          <button class="wh-big-cell-split" type="button" title="Расцепить обратно на ${wide * tall} ${pluralRu(wide * tall, 'место', 'места', 'мест')}"
            onclick="splitBlockById('${block.blockId}')">✕</button>` : ''}
      </div>`;
    }).join('');

    // Место считается «под объединённой», если попадает внутрь такого блока —
    // там нечего объединять, и подсказка про перетаскивание только мешала бы.
    const underMerged = (r, t) => blocks.some(b => (
      (b.r1 > b.r0 || b.t1 > b.t0) && r >= b.r0 && r <= b.r1 && t >= b.t0 && t <= b.t1
    ));

    let hotsHtml = '';
    for(let r = 1; r <= rackCount; r++){
      for(let t = 1; t <= tierCount; t++){
        // Точка ставится в правом нижнем углу места — это стык четырёх соседей.
        // У последнего стеллажа и у нижнего яруса такого стыка нет.
        const noDot = (r === rackCount || t === 1) ? ' no-dot' : '';
        const cls = 'wh-hot' + (underMerged(r, t) ? ' over-merged' : '') + noDot;
        hotsHtml += `<div class="${cls}" data-rack="${r}" data-tier="${t}" style="grid-column:${r}; grid-row:${gridRowOf(t)};"></div>`;
      }
    }

    return `
      <div class="wh-editor-hint">Проведите мышкой по нескольким ячейкам, чтобы объединить их в одну. Расцепить обратно — крестиком в углу объединённой ячейки.</div>
      <div class="wh-editor-focus">
        <div class="wh-full-grid"
             style="grid-template-columns:repeat(${rackCount}, ${cellW}px); grid-template-rows:repeat(${tierCount}, ${cellH}px);">
          ${cellsHtml}
          <div class="wh-sel" hidden></div>
          ${hotsHtml}
        </div>
      </div>`;
  }

  let mergeDrag = null;

  function hotAt(x, y){
    const el = document.elementFromPoint(x, y);
    return el && el.classList && el.classList.contains('wh-hot') ? el : null;
  }

  function onRowGridPointerDown(e){
    const hot = hotAt(e.clientX, e.clientY);
    if(!hot) return;              // крестик "расцепить" сюда не попадает
    e.preventDefault();
    const rack = Number(hot.dataset.rack), tier = Number(hot.dataset.tier);
    // Сетка запоминается вместе с рядом: панелей с ячейками на странице
    // столько же, сколько рядов, и искать рамку выделения по id больше нельзя.
    mergeDrag = {
      rackA: rack, tierA: tier, rackB: rack, tierB: tier,
      grid: e.currentTarget, rowNum: editingRowNum,
    };
    drawMergeSelection();
    window.addEventListener('pointermove', onRowGridPointerMove);
    window.addEventListener('pointerup', onRowGridPointerUp, {once: true});
  }

  function onRowGridPointerMove(e){
    if(!mergeDrag) return;
    const hot = hotAt(e.clientX, e.clientY);
    if(!hot) return;              // палец ушёл за сетку — держим прошлый прямоугольник
    mergeDrag.rackB = Number(hot.dataset.rack);
    mergeDrag.tierB = Number(hot.dataset.tier);
    drawMergeSelection();
  }

  function drawMergeSelection(){
    if(!mergeDrag) return;
    const sel = mergeDrag.grid.querySelector('.wh-sel');
    const meta = rowMeta[mergeDrag.rowNum];
    if(!sel || !meta) return;
    const r0 = Math.min(mergeDrag.rackA, mergeDrag.rackB), r1 = Math.max(mergeDrag.rackA, mergeDrag.rackB);
    const t0 = Math.min(mergeDrag.tierA, mergeDrag.tierB), t1 = Math.max(mergeDrag.tierA, mergeDrag.tierB);
    sel.hidden = false;
    sel.style.gridColumn = `${r0} / span ${r1 - r0 + 1}`;
    sel.style.gridRow = `${meta.tierCount - t1 + 1} / span ${t1 - t0 + 1}`;
    // Показываем, что получится, ещё до отпускания — тогда механика объясняет
    // себя сама с первого раза.
    sel.textContent = `${r1 - r0 + 1}×${t1 - t0 + 1}`;
  }

  async function onRowGridPointerUp(){
    window.removeEventListener('pointermove', onRowGridPointerMove);
    const sel = mergeDrag;
    mergeDrag = null;
    if(!sel) return;
    const selEl = sel.grid.querySelector('.wh-sel');
    if(selEl) selEl.hidden = true;

    const rackStart = Math.min(sel.rackA, sel.rackB), rackEnd = Math.max(sel.rackA, sel.rackB);
    const tierStart = Math.min(sel.tierA, sel.tierB), tierEnd = Math.max(sel.tierA, sel.tierB);
    // Одиночный клик — это не объединение, а просто клик. Молча выходим.
    if(rackStart === rackEnd && tierStart === tierEnd) return;

    const rowNum = sel.rowNum;
    try{
      await apiFetch('/api/cells/blocks/merge-rect', {
        method: 'POST',
        body: {rowNum, rackStart, rackEnd, tierStart, tierEnd},
      });
      populateCellStateFromApi(await apiFetch('/api/cells/rows'));
      refreshRackRowDOM(rowNum);
    } catch(e){
      showWhToast(e.message);
    }
  }

  /* ===================== Свои имена рядов и зон =====================
     Имя ряда становится первой частью адреса ячейки: `1.3.4` → `А.3.4`. Этот
     адрес работник читает вслух и вводит в поиск, поэтому длина ограничена
     четырьмя символами — столько же влезает под полосу ряда на схеме. Сервер
     проверяет то же самое и не даст занять чужое имя. */

  const NAME_MAX = 4;

  function startRename(kind, key){
    const btn = document.querySelector(kind === 'row'
      ? `#fp-row-${key} .wh-row-group-title`
      : '#whZoneDetail .wh-detail-id');
    if(!btn || btn.dataset.renaming) return;
    btn.dataset.renaming = '1';

    const current = kind === 'row' ? (rowMeta[key] && rowMeta[key].label) : (zoneMeta[key] && zoneMeta[key].label);
    const input = document.createElement('input');
    input.className = 'wh-rename-input';
    input.value = current || '';
    input.maxLength = NAME_MAX;
    input.placeholder = kind === 'row' ? String(key) : 'З' + (zoneMeta[key] ? zoneMeta[key].zoneNum : '');
    input.title = `Не длиннее ${NAME_MAX} символов. Пусто — вернуть номер.`;

    const finish = async (save) => {
      input.removeEventListener('blur', onBlur);
      if(save){
        try{
          if(kind === 'row'){
            const row = await apiFetch(`/api/cells/rows/${key}/name`, {method:'PATCH', body:{label: input.value}});
            rowMeta[key].label = row.label || null;
          } else {
            const zone = await apiFetch(`/api/dropzones/${key}/name`, {method:'PATCH', body:{label: input.value}});
            zoneMeta[key] = {zoneNum: zone.zone_num, label: zone.label || null};
            zoneLabels[key] = zoneLabel(key);
          }
        } catch(e){
          showWhToast(e.message);
        }
      }
      // Перерисовываем целиком: имя входит в адрес каждой ячейки ряда, а на
      // схеме — в подпись над полосой, так что точечной правкой не обойтись.
      await renderWarehouseMap();
      if(kind === 'row') showWhPanel('fp-row-' + key);
    };
    const onBlur = () => finish(true);

    input.addEventListener('keydown', e => {
      if(e.key === 'Enter'){ e.preventDefault(); input.blur(); }
      if(e.key === 'Escape'){ e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', onBlur);

    btn.replaceWith(input);
    input.focus();
    input.select();
  }

  // Удаление всей схемы. Спрашиваем ДО запроса, а не после, и называем цифру:
  // сколько товара числится в ячейках и зонах — это и есть то, что потеряется
  // вместе со схемой. Данные уже загружены, отдельный запрос ради подсчёта не
  // нужен. Сервер всё равно проверяет это сам и без ?confirm=true откажет —
  // здесь предупреждение для человека, там защита от случайного запроса.
  async function deleteWarehouseLayout(){
    let positions = 0, units = 0;
    Object.values(cellBlocks).forEach(blocks => blocks.forEach(b => {
      (b.stock || []).forEach(s => { positions += 1; units += Number(s.qty || 0); });
    }));
    Object.values(dropzoneData).forEach(items => items.forEach(it => {
      positions += 1;
      units += parseInt(it.qty, 10) || 0;
    }));

    let question = 'Удалить схему склада?\n\nРяды, ячейки и зоны сортировки будут удалены, склад придётся настроить заново.';
    if(positions > 0){
      question += `\n\nВНИМАНИЕ: в ячейках и зонах числится товар — ${positions} ${pluralRu(positions, 'позиция', 'позиции', 'позиций')}, ${units.toLocaleString('ru-RU')} шт. Эти записи будут стёрты, хотя товар останется лежать на складе.`;
    }
    if(!confirm(question)) return;

    try{
      await apiFetch('/api/cells/rows?confirm=true', {method:'DELETE'});
    } catch(e){
      showWhToast('Не удалось удалить схему: ' + e.message);
      return;
    }

    closeWhSettings();
    cellBlocks = {}; rowMeta = {}; blockById = {}; dropzoneData = {}; zoneLabels = {}; zoneMeta = {};
    editingRowNum = null;
    clearWhSearch();
    document.getElementById('whMapWrap').style.display = 'none';
    document.getElementById('whMapWrap').innerHTML = '';
    document.getElementById('whOnboarding').style.display = 'flex';
    showWhToast('Схема удалена — настройте склад заново.');
  }

  async function splitBlockById(blockId){
    // Ряд берём у самой ячейки, а не из editingRowNum: так расцепление
    // остаётся правильным, даже если правку успели переключить на другой ряд.
    const entry = blockById[blockId];
    const rowNum = entry ? entry.rowNum : editingRowNum;
    try{
      await apiFetch('/api/cells/blocks/' + blockId + '/split', {method:'POST'});
      populateCellStateFromApi(await apiFetch('/api/cells/rows'));
      refreshRackRowDOM(rowNum);
    } catch(e){
      showWhToast(e.message);
    }
  }

  /* ===================== Зоны сортировки ===================== */

  let dropzoneData = {};
  let zoneLabels = {};   // id -> то, что показываем
  let zoneMeta = {};     // id -> {zoneNum, label} — своё имя отдельно от номера

  // Имя зоны, если задано, иначе «З» и номер. Раньше сервер сам подставлял
  // «Зона 1», и на схеме это обрезалось до «З1» — из-за чего буква З рядом с
  // цифрой читалась как тройка. Теперь имя либо своё, либо его нет.
  function zoneLabel(zoneId){
    const z = zoneMeta[zoneId];
    if(!z) return zoneId;
    return z.label || ('З' + z.zoneNum);
  }

  function populateDropzonesFromApi(apiZones){
    dropzoneData = {};
    zoneLabels = {};
    zoneMeta = {};
    apiZones.forEach(zone => {
      dropzoneData[zone.id] = zone.items.map(it => ({
        client: companyNameById(it.companyId), sku: it.sku, qty: it.qty + ' шт', direction: it.direction,
      }));
      zoneMeta[zone.id] = {zoneNum: zone.zone_num, label: zone.label || null};
      zoneLabels[zone.id] = zoneLabel(zone.id);
    });
  }

  async function renderWarehouseMap(){
    const [apiRows, apiZones] = await Promise.all([
      apiFetch('/api/cells/rows'),
      apiFetch('/api/dropzones'),
    ]);
    populateCellStateFromApi(apiRows);
    populateDropzonesFromApi(apiZones);

    const rowOrder = apiRows.map(r => r.row_num);
    const aisleAfter = apiRows.map(r => r.aisle_after === true);
    const zoneOrder = apiZones.map(z => ({id: z.id, label: zoneLabel(z.id)}));
    const svg = buildFloorplanSVGCustom(rowOrder, aisleAfter, zoneOrder);
    const rowsHtml = apiRows.map(r => renderRackRowHtml(r.row_num)).join('');

    document.getElementById('whMapWrap').innerHTML = `
      <div class="wh-map-shell">
      <div class="wh-map">
        <div class="wh-map-head">
          <div class="wh-status-line" id="whStatusLine"></div>
          <div class="wh-search">
            <input type="search" id="whSearchInput" autocomplete="off" spellcheck="false"
                   placeholder="Найти товар — артикул или название"
                   oninput="onWhSearchInput()" onkeydown="onWhSearchKey(event)">
            <div class="wh-search-drop" id="whSearchDrop" hidden></div>
          </div>
          <button class="wh-configure-btn" type="button" onclick="exportWarehouse()">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Выгрузить остатки
          </button>
          <button class="wh-configure-btn" type="button" onclick="openWhSettings()">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            Настроить склад
          </button>
        </div>
        <div class="wh-floorplan">
          <div class="wh-floorplan-head">
            <div class="wh-floorplan-title">Схема склада — ряды и проходы</div>
          </div>
          <div id="fpSvgWrap">${svg}</div>
        </div>
        <div class="wh-search-banner" id="whSearchBanner" hidden></div>
        <div class="wh-legend">
          <div class="wh-legend-item"><span class="wh-legend-swatch empty"></span>Свободна</div>
          <div class="wh-legend-item"><span class="wh-legend-swatch occupied"></span>Занята</div>
          <div class="wh-legend-item"><span class="wh-legend-swatch merged"></span>Объединена</div>
        </div>
        <div id="whContent">
          <div class="wh-row-group visible" id="whSummary"></div>
          ${rowsHtml}
          <div class="wh-row-group" id="whZoneDetail"></div>
        </div>
        </div>
        <aside class="wh-side" id="whCellDetail" aria-live="polite"></aside>
      </div>
    `;
    document.getElementById('whConstructor').classList.remove('active', 'in-modal');
    document.getElementById('whMapWrap').style.display = 'flex';
    fpRowOrder = null;
    renderWhStatusLine();
    renderWhSummary();
    // Карта перерисована целиком — если какой-то ряд был в правке, вернуть ему
    // обработчик перетаскивания.
    if(editingRowNum !== null) bindRowEditor(editingRowNum);
    if(whHighlight) applyWhHighlight(whHighlight); // пережить перерисовку карты
  }

  /* ===================== Поиск товара по карте =====================
     Ищем через уже готового Кладовщика (/api/agents/kladovshchik/find): он
     умеет искать и по артикулу, и по названию, и сразу возвращает, в каких
     ячейках товар лежит. Карта только подсвечивает — своей логики поиска
     здесь нет намеренно, иначе она разошлась бы с тем, что отвечает агент
     в чате на тот же вопрос. */

  let whSearchTimer = null;
  let whSearchResults = [];
  let whHighlight = null;   // {sku, name, totalQty, locations} — активная подсветка

  function onWhSearchInput(){
    clearTimeout(whSearchTimer);
    const q = (document.getElementById('whSearchInput').value || '').trim();
    if(q.length < 2){ hideWhSearchDrop(); return; }
    // Пауза перед запросом: без неё каждый набранный символ — отдельный поход
    // на сервер, а справочник в 11 тысяч позиций ищется не мгновенно.
    whSearchTimer = setTimeout(() => runWhSearch(q), 250);
  }

  function onWhSearchKey(e){
    if(e.key === 'Escape'){ clearWhSearch(); e.target.blur(); }
  }

  async function runWhSearch(q){
    const drop = document.getElementById('whSearchDrop');
    if(!drop) return;
    try{
      const data = await apiFetch('/api/agents/kladovshchik/find?q=' + encodeURIComponent(q));
      whSearchResults = (data && data.results) || [];
    } catch(e){
      whSearchResults = [];
      drop.hidden = false;
      drop.innerHTML = `<div class="wh-search-empty">Не удалось найти: ${escapeHTML(e.message)}</div>`;
      return;
    }
    renderWhSearchDrop();
  }

  function renderWhSearchDrop(){
    const drop = document.getElementById('whSearchDrop');
    if(!drop) return;
    drop.hidden = false;
    if(whSearchResults.length === 0){
      drop.innerHTML = '<div class="wh-search-empty">Ничего не нашлось</div>';
      return;
    }
    drop.innerHTML = whSearchResults.map((p, i) => {
      const where = p.locations.length
        ? `${p.totalQty.toLocaleString('ru-RU')} шт · ${p.locations.length} ${pluralRu(p.locations.length, 'ячейка', 'ячейки', 'ячеек')}`
        : 'нет на складе';
      return `
        <div class="wh-search-item${p.locations.length ? '' : ' absent'}" onclick="pickWhSearchResult(${i})">
          <span class="wh-search-item-sku">${escapeHTML(p.sku)}</span>
          <span class="wh-search-item-name">${escapeHTML(p.name || '')}</span>
          <span class="wh-search-item-where">${where}</span>
        </div>`;
    }).join('');
  }

  function hideWhSearchDrop(){
    const drop = document.getElementById('whSearchDrop');
    if(drop){ drop.hidden = true; drop.innerHTML = ''; }
  }

  function pickWhSearchResult(index){
    const product = whSearchResults[index];
    if(!product) return;
    hideWhSearchDrop();
    const input = document.getElementById('whSearchInput');
    if(input) input.value = product.sku;
    applyWhHighlight(product);
  }

  // Ячейка на карте и "локация" от Кладовщика — это одно и то же место,
  // но приходят они разными путями, поэтому сопоставляем по геометрии.
  function blockMatchesLocation(block, loc){
    return block.r0 === loc.rackFrom && block.r1 === loc.rackTo
        && block.t0 === loc.tierFrom && block.t1 === loc.tierTo;
  }

  function applyWhHighlight(product){
    whHighlight = product;
    const content = document.getElementById('whContent');
    if(!content) return;

    const hitIds = new Set();
    product.locations.forEach(loc => {
      (cellBlocks[loc.row] || []).forEach(b => {
        if(blockMatchesLocation(b, loc)) hitIds.add(b.blockId);
      });
    });

    content.classList.add('searching');
    content.querySelectorAll('.wh-cell').forEach(cell => {
      cell.classList.toggle('search-hit', hitIds.has(cell.dataset.blockId));
    });

    // Ряды на схеме склада — это прямоугольники с id="row-rect-N".
    const rowsWithHits = new Set(product.locations.map(l => Number(l.row)));
    document.querySelectorAll('#fpSvgWrap .wh-row-rect').forEach(el => el.classList.remove('fp-search-hit'));
    rowsWithHits.forEach(n => {
      const rect = document.getElementById('row-rect-' + n);
      if(rect) rect.classList.add('fp-search-hit');
    });

    renderWhSearchBanner(product, hitIds.size);
  }

  function renderWhSearchBanner(product, hitCount){
    const banner = document.getElementById('whSearchBanner');
    if(!banner) return;
    banner.hidden = false;

    if(product.locations.length === 0){
      banner.innerHTML = `
        <div class="wh-search-banner-main">
          <b>${escapeHTML(product.sku)}</b> ${escapeHTML(product.name || '')} — на складе нет
        </div>
        <button class="wh-search-banner-close" onclick="clearWhSearch()">Сбросить ✕</button>`;
      return;
    }

    // Если адрес не подсветился, значит карта и остатки разошлись — честнее
    // сказать об этом, чем показать адрес, которого на схеме нет.
    const stale = hitCount < product.locations.length;
    const addrs = product.locations.map(l => {
      const rack = l.rackFrom === l.rackTo ? l.rackFrom : `${l.rackFrom}–${l.rackTo}`;
      const tier = l.tierFrom === l.tierTo ? l.tierFrom : `${l.tierFrom}–${l.tierTo}`;
      return `<span class="wh-search-addr" onclick="scrollToWhRow(${l.row})">${l.row}.${rack}.${tier}<i>${l.qty.toLocaleString('ru-RU')} шт</i></span>`;
    }).join('');

    banner.innerHTML = `
      <div class="wh-search-banner-main">
        <b>${escapeHTML(product.sku)}</b> ${escapeHTML(product.name || '')}
        — ${product.totalQty.toLocaleString('ru-RU')} шт в ${product.locations.length} ${pluralRu(product.locations.length, 'ячейке', 'ячейках', 'ячейках')}
      </div>
      <div class="wh-search-banner-addrs">${addrs}</div>
      ${stale ? '<div class="wh-search-banner-warn">Часть адресов не найдена на схеме — обновите страницу</div>' : ''}
      <button class="wh-search-banner-close" onclick="clearWhSearch()">Сбросить ✕</button>`;
  }

  function scrollToWhRow(rowNum){
    const el = document.getElementById('fp-row-' + rowNum);
    if(!el) return;
    el.classList.add('visible');
    el.scrollIntoView({behavior: 'smooth', block: 'center'});
  }

  function clearWhSearch(){
    whHighlight = null;
    whSearchResults = [];
    clearTimeout(whSearchTimer);
    const input = document.getElementById('whSearchInput');
    if(input) input.value = '';
    hideWhSearchDrop();
    const content = document.getElementById('whContent');
    if(content){
      content.classList.remove('searching');
      content.querySelectorAll('.wh-cell.search-hit').forEach(c => c.classList.remove('search-hit'));
    }
    document.querySelectorAll('#fpSvgWrap .wh-row-rect').forEach(el => el.classList.remove('fp-search-hit'));
    const banner = document.getElementById('whSearchBanner');
    if(banner){ banner.hidden = true; banner.innerHTML = ''; }
  }

  async function buildWarehouseFromConstructor(){
    if(ctorRows.length === 0){ showWhToast('Добавьте хотя бы один ряд.'); return; }
    const configs = ctorRows.map(r => ({
      rackCount: r.racks, tierCount: r.tiers, aisleAfter: r.aisleAfter, label: r.label,
    }));
    // Склад пересобирается заново — ряда, который правили, может уже не быть.
    editingRowNum = null;
    try{
      await apiFetch('/api/cells/rows', {method:'POST', body:{configs}});
      await apiFetch('/api/dropzones', {method:'POST', body:{
        count: ctorZones.length, labels: ctorZones.map(z => z.label),
      }});
      await renderWarehouseMap();
      closeWhSettings();
      showWhToast('Схема построена.');
    } catch(e){
      showWhToast('Не удалось построить карту: ' + e.message);
    }
  }

  // Здесь была кнопка "Загрузить документ": она игнорировала выбранный файл,
  // строила захардкоженный склад из шести рядов и сообщала, что разобрала его
  // из вашего файла. Удалена, а не оставлена "до лучших времён" — молча
  // создать неправильный склад хуже, чем не иметь кнопки вовсе. Разбор
  // реального документа Оркестратором — отдельная задача.

  // Схема наверху — постоянная навигация: показывает ровно одну панель под собой —
  // сводку по складу, детали выбранного ряда или детали выбранной зоны сортировки.
  function showWhPanel(id){
    document.querySelectorAll('#whContent > .wh-row-group').forEach(g => g.classList.toggle('visible', g.id === id));
  }

  function showWhSummary(){
    showWhPanel('whSummary');
    document.querySelectorAll('.wh-row-rect').forEach(r=>r.classList.remove('selected-row'));
    renderWhSummary();
  }

  function renderWhSummary(){
    const panel = document.getElementById('whSummary');
    if(!panel) return;
    const s = warehouseStats();
    const top = [...s.perRow].sort((a,b) => b.pct - a.pct).slice(0,3);
    const freeRow = [...s.perRow].sort((a,b) => b.free - a.free)[0];
    const pending = journalEntries.filter(e => e.status === 'pending');

    const topHtml = top.length
      ? top.map(r => `
          <div class="wh-summary-row-item">
            <span>Ряд ${escapeHTML(String(rowLabel(r.rowNum)))}</span>
            <span class="wh-summary-row-bar"><span style="width:${r.pct}%"></span></span>
            <span class="wh-summary-row-pct">${r.pct}%</span>
          </div>
        `).join('')
      : '<div class="wh-summary-attn-empty">Пока нет данных.</div>';

    const freeHtml = freeRow
      ? `<div class="wh-summary-row-item"><span>Ряд ${escapeHTML(String(rowLabel(freeRow.rowNum)))}</span><span class="wh-summary-row-pct">свободно ${freeRow.free} из ${freeRow.total}</span></div>`
      : '<div class="wh-summary-attn-empty">Пока нет данных.</div>';

    const attnHtml = pending.length
      ? pending.slice(0,3).map(e => `<div class="wh-summary-attn-item" onclick="switchView('journal')">${escapeHTML(e.action_text)}</div>`).join('')
      : '<div class="wh-summary-attn-empty">Расхождений нет — всё сходится.</div>';

    panel.innerHTML = `
      <div class="wh-summary-stats">
        <div class="wh-summary-stat"><div class="num">${s.cellTotal}</div><div class="lbl">всего мест</div></div>
        <div class="wh-summary-stat"><div class="num">${s.occupiedUnits}</div><div class="lbl">занято</div></div>
        <div class="wh-summary-stat"><div class="num">${s.cellTotal - s.occupiedUnits}</div><div class="lbl">свободно</div></div>
        <div class="wh-summary-stat"><div class="num">${s.pct}%</div><div class="lbl">заполнение</div></div>
      </div>
      <div class="wh-summary-cols">
        <div class="wh-summary-col">
          <div class="wh-summary-col-title">Самые заполненные ряды</div>
          ${topHtml}
        </div>
        <div class="wh-summary-col">
          <div class="wh-summary-col-title">Больше всего свободного места</div>
          ${freeHtml}
        </div>
      </div>
      <div class="wh-summary-attn-block">
        <div class="wh-summary-col-title">Требует внимания</div>
        ${attnHtml}
      </div>
    `;
  }

  function focusRow(n){
    showWhPanel('fp-row-' + n);
    document.querySelectorAll('.wh-row-rect').forEach(r=>r.classList.remove('selected-row'));
    const rect = document.getElementById('row-rect-' + n);
    if(rect) rect.classList.add('selected-row');

    const el = document.getElementById('fp-row-' + n);
    if(!el) return;
    setTimeout(()=>{
      el.scrollIntoView({behavior:'smooth', block:'center'});
    }, 20);
  }

  function selectZone(id){
    showWhPanel('whZoneDetail');
    document.querySelectorAll('.wh-row-rect').forEach(r=>r.classList.remove('selected-row'));

    const items = dropzoneData[id] || [];
    const detail = document.getElementById('whZoneDetail');
    const zoneName = zoneLabels[id] || id;
    const backBtn = `<button class="wh-panel-back" onclick="showWhSummary()">← Назад к сводке</button>`;

    if(items.length === 0){
      detail.innerHTML = `
        ${backBtn}
        <button class="wh-detail-id wh-renamable" type="button" onclick="startRename('zone', '${id}')" title="Нажмите, чтобы переименовать зону">${escapeHTML(String(zoneName))}</button>
        <div class="wh-detail-status empty">пусто</div>
        <div class="wh-detail-empty">Сейчас в этой зоне ничего нет.</div>
      `;
      return;
    }

    const rows = items.map(it => `
      <div class="wh-zone-item">
        <div class="wh-zone-item-top">
          <span class="wh-zone-item-client">${it.client}</span>
          <span class="wh-zone-item-meta">${it.sku}</span>
        </div>
        <div class="wh-zone-item-meta">${it.qty}</div>
        <span class="wh-zone-status ${it.direction}">${it.direction === 'in' ? 'ожидает размещения' : 'ожидает отгрузки'}</span>
      </div>
    `).join('');

    detail.innerHTML = `
      ${backBtn}
      <button class="wh-detail-id wh-renamable" type="button" onclick="startRename('zone', '${id}')" title="Нажмите, чтобы переименовать зону">${escapeHTML(String(zoneName))}</button>
      <div class="wh-detail-status occupied">${items.length} ${items.length === 1 ? 'позиция' : 'позиции'}</div>
      ${rows}
    `;
  }

  function selectCell(el){
    document.querySelectorAll('.wh-cell.selected').forEach(c=>c.classList.remove('selected'));
    el.classList.add('selected');
    const state = el.dataset.state;
    const displayAddr = el.dataset.addr || el.dataset.id;

    // Подсветить выбранную ячейку на схеме ряда: под сеткой подписаны номера
    // стеллажей, и без этого приходилось считать колонки глазами, чтобы понять,
    // к какому стеллажу относится выбранная ячейка. Объединённая занимает
    // несколько стеллажей — подсвечиваются все.
    const entryForLabels = blockById[el.dataset.blockId];
    const panel = el.closest('.wh-row-group');
    if(panel){
      panel.querySelectorAll('.wh-rack-label.active').forEach(l => l.classList.remove('active'));
      if(entryForLabels){
        const b = entryForLabels.block;
        for(let r = b.r0; r <= b.r1; r++){
          const label = panel.querySelector(`.wh-rack-label[data-rack="${r}"]`);
          if(label) label.classList.add('active');
        }
      }
    }

    const statusLabel = {
      occupied: 'занята',
      empty: 'свободна'
    }[state] || state;

    const entry = blockById[el.dataset.blockId];
    const stock = (entry && entry.block.stock) || [];

    let rows;
    if(stock.length === 0){
      rows = '<div class="wh-detail-note">Ячейка пуста</div>';
    } else {
      const totalQty = stock.reduce((sum, it) => sum + Number(it.qty || 0), 0);
      rows = `
        <div class="wh-detail-row">
          <span>Всего</span>
          <span>${totalQty.toLocaleString('ru-RU')} шт · ${stock.length} ${pluralRu(stock.length, 'артикул', 'артикула', 'артикулов')}</span>
        </div>
        <div class="wh-detail-stock">
          ${stock.map(it => `
            <div class="wh-detail-stock-item">
              <span class="wh-detail-stock-sku" title="${escapeHTML(it.sku)}">${escapeHTML(it.sku)}</span>
              <span class="wh-detail-stock-qty">${Number(it.qty || 0).toLocaleString('ru-RU')} шт</span>
              <span class="wh-detail-stock-client" title="${escapeHTML(companyNameById(it.companyId) || '')}">${escapeHTML(companyNameById(it.companyId) || '—')}</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Карточка живёт сбоку и не двигается с места. Раньше она вставлялась
    // внутрь панели ряда, и ряд рывком уезжал вниз на её высоту — читать было
    // невозможно, потому что то, на что ты смотрел, уходило из-под глаз.
    const detail = document.getElementById('whCellDetail');
    detail.innerHTML = `
      <div class="wh-side-head">
        <div class="wh-side-label">Ячейка</div>
        <button class="panel-close-btn" onclick="closeWhDetailPanel()" aria-label="Закрыть">✕</button>
      </div>
      <div class="wh-side-body">
        <div class="wh-detail-id">${displayAddr}</div>
        <div class="wh-detail-status ${state}">${statusLabel}</div>
        ${rows}
        <button class="wh-onboarding-btn" style="margin-top:14px; width:100%;" type="button"
                data-history-cell="${el.dataset.blockId}" data-history-label="${displayAddr}">Что здесь происходило</button>
        ${stock.length ? `<button class="wh-onboarding-btn" style="margin-top:8px; width:100%;" type="button" onclick="exportCell('${el.dataset.blockId}')">Выгрузить в Excel</button>` : ''}
      </div>
    `;
    keepStill(el, () => detail.classList.add('open'));
  }

  /* Открытие панели сужает карту, а от этого шапка ряда переносится на две
     строки — и всё, что ниже, уезжает вниз вместе с выбранной ячейкой. Ячейка
     тут единственное, на что человек смотрит: она обязана остаться под курсором.

     Правим не причину, а следствие: замеряем ячейку до и после и сдвигаем
     прокрутку на разницу. Причин перевёрстки может быть сколько угодно —
     перенос заголовка, другая ширина сетки, длинное имя ряда, — и ловить их
     по одной значит чинить это заново после каждой правки вёрстки. */
  function keepStill(el, change){
    const scroller = document.querySelector('.wh-map');
    if(!el || !scroller){ change(); return; }
    const before = el.getBoundingClientRect().top;
    change();
    // getBoundingClientRect после change() заставляет пересчитать вёрстку,
    // поэтому разница уже настоящая, а не прошлого кадра.
    const after = el.getBoundingClientRect().top;
    scroller.scrollTop += after - before;
  }

  function closeWhDetailPanel(){
    const selected = document.querySelector('.wh-cell.selected');
    document.querySelectorAll('.wh-cell.selected').forEach(c=>c.classList.remove('selected'));
    document.querySelectorAll('.wh-rack-label.active').forEach(l => l.classList.remove('active'));
    const detail = document.getElementById('whCellDetail');
    // Карта расширяется обратно — вёрстка едет в другую сторону, и ячейку надо
    // удержать так же, как при открытии.
    if(detail) keepStill(selected, () => detail.classList.remove('open'));
  }

  /* ===================== Модальное окно "Настроить склад" ===================== */

  function openWhSettings(){
    ctorEditingExisting = true;
    document.querySelector('.wh-ctor-warning').hidden = false;
    const ctor = document.getElementById('whConstructor');
    ctor.classList.add('active', 'in-modal');
    document.getElementById('whTabSizeSlot').appendChild(ctor);

    // Схема в окне — та же самая, просто заполненная тем, что уже стоит.
    const rows = Object.keys(rowMeta).map(Number).sort((a,b) => a - b);
    ctorRows = rows.map(n => ({
      racks: rowMeta[n].rackCount, tiers: rowMeta[n].tierCount,
      label: rowMeta[n].label, aisleAfter: !!rowMeta[n].aisleAfter,
    }));
    ctorZones = Object.keys(zoneMeta)
      .sort((a, b) => zoneMeta[a].zoneNum - zoneMeta[b].zoneNum)
      .map(id => ({label: zoneMeta[id].label}));
    ctorSel = null;
    renderCtor();

    // Ячейки правятся не здесь, а в панели самого ряда — по карандашу. В этом
    // окне остались только редкие вещи: размеры всего склада, проходы и
    // удаление схемы.
    document.getElementById('whModal').classList.add('open');
  }

  function closeWhSettings(){
    document.getElementById('whModal').classList.remove('open');
  }

  /* ===================== Журнал действий ===================== */

  function toggleCal(){
    document.getElementById('dnPopover').classList.toggle('open');
  }
  function pickDay(dayKey, e){
    if(e) e.stopPropagation();
    journalDayFilter = dayKey;
    document.getElementById('dnPopover').classList.remove('open');
    renderJournalCalendar();
    applyFilters();
  }
  function toggleAccountMenu(){
    document.getElementById('accountMenu').classList.toggle('open');
    document.getElementById('accountCard').classList.toggle('open');
  }
  document.addEventListener('click', function(e){
    const wrap = document.querySelector('.sidebar-footer');
    if(wrap && !wrap.contains(e.target)){
      document.getElementById('accountMenu').classList.remove('open');
      document.getElementById('accountCard').classList.remove('open');
    }
  });

  document.addEventListener('click', function(e){
    const wrap = document.querySelector('.cal-wrap');
    if(wrap && !wrap.contains(e.target)) document.getElementById('dnPopover').classList.remove('open');
  });

  let journalEntries = [];
  let activeFilter = 'all';
  let attentionOnly = false;

  const AGENT_LABEL = {'Кладовщик':'warehouse', 'Аналитик':'analyst', 'Оркестратор':'orchestrator'};

  // Журнал грузился один раз при входе в кабинет — работник принимал товар,
  // а владелец видел это только после перезагрузки страницы. Для журнала,
  // смысл которого «что происходит на складе», это было почти бесполезно.
  // Обратный ход: журнал, суженный до одной ячейки или одной накладной.
  // Фильтруем на сервере, а не в кабинете: в ленте последние 200 записей, и
  // история ячейки за прошлый месяц в них просто не попадёт.
  let journalScope = null;   // {kind:'cell'|'invoice', id, label}

  let journalSeenIds = new Set();
  let journalPollTimer = null;
  let journalUnread = 0;

  async function loadJournal(initial){
    let fresh;
    const query = journalScope
      ? '?' + (journalScope.kind === 'cell' ? 'cellBlockId=' : 'invoiceId=') + journalScope.id
      : '';
    try{
      fresh = await apiFetch('/api/journal' + query);
    } catch(e){
      if(initial){
        journalEntries = [];
        renderContextPanel();
        showWhToast('Не удалось загрузить журнал: ' + e.message);
        renderJournalEntries();
        applyFilters();
        renderWhSummary();
      }
      return; // молчаливый опрос не должен ругаться на каждую потерю связи
    }

    // Что появилось с прошлого раза. На первой загрузке новым не считаем
    // ничего: иначе вход в кабинет подсвечивал бы всю ленту.
    const newIds = initial ? [] : fresh.map(e => e.id).filter(id => !journalSeenIds.has(id));
    journalSeenIds = new Set(fresh.map(e => e.id));
    journalEntries = fresh;

    renderContextPanel();
    renderJournalEntries(newIds);
    applyFilters();
    renderWhSummary();

    if(newIds.length > 0 && !document.getElementById('view-journal').classList.contains('active')){
      journalUnread += newIds.length;
      const badge = document.getElementById('navBadge');
      badge.textContent = journalUnread > 99 ? '99+' : journalUnread;
      badge.classList.add('show');
    }
  }

  function startJournalPolling(){
    if(journalPollTimer) return;
    // Двадцать пять секунд: журнал должен успевать за сменой, но не устраивать
    // сервер каждую секунду ради страницы, на которую могут не смотреть.
    journalPollTimer = setInterval(function(){
      if(document.hidden) return;
      loadJournal(false);
    }, 25000);
  }

  function formatEntryTime(iso){
    const d = new Date(iso);
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }

  const STATUS_LABEL = {auto:'применено автоматически', pending:'требует внимания', confirmed:'подтверждено вами', rolled_back:'откат выполнен'};

  function journalDayKey(iso){
    const d = new Date(iso);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
  }

  const MONTHS_RU = ['января','февраля','марта','апреля','мая','июня',
    'июля','августа','сентября','октября','ноября','декабря'];

  function journalDayLabel(key){
    const [y, m, d] = key.split('-').map(Number);
    const today = new Date();
    const isToday = today.getFullYear() === y && today.getMonth() + 1 === m && today.getDate() === d;
    const yest = new Date(Date.now() - 86400000);
    const isYest = yest.getFullYear() === y && yest.getMonth() + 1 === m && yest.getDate() === d;
    const base = d + ' ' + MONTHS_RU[m - 1];
    if(isToday) return 'Сегодня, ' + base;
    if(isYest) return 'Вчера, ' + base;
    return base + ' ' + y;
  }

  function renderJournalEntries(newIds){
    const list = document.getElementById('jList');
    if(journalEntries.length === 0){
      list.innerHTML = journalScope
        ? '<div class="j-scope"><span class="j-scope-kind">'
          + (journalScope.kind === 'cell' ? 'История ячейки' : 'История накладной')
          + '</span><b>' + escapeHTML(journalScope.label) + '</b>'
          + '<span class="j-scope-close" data-journal-scope-clear>Показать весь журнал ✕</span></div>'
          + '<div class="staff-empty">Записей по '
          + (journalScope.kind === 'cell' ? 'этой ячейке' : 'этой накладной') + ' пока нет.</div>'
        : '';
      renderJournalCalendar();
      return;
    }
    const fresh = new Set(newIds || []);

    // Пока журнал сужен, об этом должно быть написано крупно: иначе пустая
    // лента читается как «на складе ничего не происходило».
    const scopeBar = journalScope
      ? '<div class="j-scope"><span class="j-scope-kind">'
        + (journalScope.kind === 'cell' ? 'История ячейки' : 'История накладной')
        + '</span><b>' + escapeHTML(journalScope.label) + '</b>'
        + '<span class="j-scope-close" data-journal-scope-clear>Показать весь журнал ✕</span></div>'
      : '';

    // Приколотое сверху: то, что ждёт решения. Раньше оно лежало вперемешку с
    // рутиной, и «есть ли у меня работа» приходилось выяснивать глазами.
    const pending = journalEntries.filter(e => e.status === 'pending');
    const head = pending.length === 0 ? '' :
      '<div class="j-pinned"><div class="j-pinned-head">'
      + pending.length + ' ' + pluralRu(pending.length, 'запись ждёт', 'записи ждут', 'записей ждут')
      + ' вашего решения</div></div>';

    // Дни — потому что двести строк подряд читать нельзя.
    let html = scopeBar + head;
    let lastDay = null;
    groupJournalDay(journalEntries).forEach(function(node){
      if(node.day !== lastDay){
        html += '<div class="j-day-sep" data-day-sep="' + node.day + '">'
          + escapeHTML(journalDayLabel(node.day)) + '</div>';
        lastDay = node.day;
      }
      if(node.kind === 'entry'){
        html += journalEntryHtml(node.entry, fresh.has(node.entry.id), node.day);
        return;
      }
      html += journalGroupHtml(node, fresh);
    });
    list.innerHTML = html;
    renderJournalCalendar();
  }

  // Одна приёмка на двенадцать позиций — это двенадцать одинаковых строк
  // подряд. Читать их незачем: важно, что приёмка была и чем закончилась.
  // Поэтому рутина по одному документу сворачивается в строку с раскрытием.
  //
  // Что НЕ сворачивается никогда: то, что ждёт решения. Прятать под плюсик
  // единственное, ради чего владелец сюда зашёл, — значит сломать журнал.
  const GROUP_MIN = 3;

  function groupJournalDay(entries){
    const out = [];
    const buckets = new Map();
    entries.forEach(function(e){
      const day = journalDayKey(e.created_at);
      const groupable = e.status !== 'pending' && e.invoice_id;
      const key = groupable ? day + '|' + e.invoice_id : null;
      if(!key){ out.push({ kind: 'entry', day: day, entry: e }); return; }
      if(!buckets.has(key)){
        const node = { kind: 'group', day: day, id: key.replace(/[^a-zA-Z0-9]/g, ''),
          invoiceNumber: e.invoice_number, agent: e.agent, entries: [] };
        buckets.set(key, node);
        out.push(node);
      }
      buckets.get(key).entries.push(e);
    });
    // Группа из одной-двух записей ничего не экономит, только прячет.
    return out.map(function(node){
      if(node.kind === 'group' && node.entries.length < GROUP_MIN){
        return node.entries.map(function(e){
          return { kind: 'entry', day: node.day, entry: e };
        });
      }
      return node;
    }).flat();
  }

  function journalGroupHtml(node, fresh){
    const hasNew = node.entries.some(function(e){ return fresh.has(e.id); });
    const times = node.entries.map(function(e){ return formatEntryTime(e.created_at); });
    const span = times.length > 1
      ? times[times.length - 1] + ' – ' + times[0]
      : times[0];
    return '<div class="j-group' + (hasNew ? ' j-new' : '') + '" data-group="' + node.id + '">'
      + '<div class="j-group-head" data-toggle-group="' + node.id + '">'
      +   '<svg class="j-group-chev" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">'
      +     '<path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      +   '<span class="j-group-title">' + escapeHTML(node.agent || 'Кладовщик')
      +     ' · ' + escapeHTML(node.invoiceNumber || '') + '</span>'
      +   '<span class="j-group-count">' + node.entries.length + ' '
      +     pluralRu(node.entries.length, 'запись', 'записи', 'записей') + '</span>'
      +   '<span class="j-group-time">' + escapeHTML(span) + '</span>'
      + '</div>'
      + '<div class="j-group-body">'
      +   node.entries.map(function(e){
            return journalEntryHtml(e, fresh.has(e.id), node.day);
          }).join('')
      + '</div>'
      + '</div>';
  }

  function toggleJournalGroup(id){
    const box = document.querySelector('.j-group[data-group="' + id + '"]');
    if(box) box.classList.toggle('open');
  }

  document.addEventListener('click', function(e){
    const head = e.target.closest && e.target.closest('[data-toggle-group]');
    if(head) toggleJournalGroup(head.dataset.toggleGroup);
  });

  function journalEntryHtml(entry, isNew, dayKey){
    return (function(){
      const agentClass = AGENT_LABEL[entry.agent] || 'warehouse';
      const canResolve = entry.status === 'pending';
      return `
        <div class="j-entry ${agentClass}${isNew ? ' j-new' : ''}" data-client="" data-risk="${entry.status === 'pending' ? 'high' : 'low'}" data-order="0" data-day="${dayKey}" data-entry-id="${entry.id}">
          <input type="checkbox" class="j-check" onclick="event.stopPropagation(); updateBulk()" ${canResolve ? '' : 'style=\"visibility:hidden;\"'}>
          <div class="j-avatar">
            <svg width="20" height="20" viewBox="0 0 22 22"><use href="#icon-warehouse-agent"/></svg>
          </div>
          <div class="j-body">
            <div class="j-top">
              <span class="j-agent ${agentClass}">${entry.agent}</span>
              <span class="j-time">${formatEntryTime(entry.created_at)}</span>
            </div>
            <div class="j-text">${entry.action_text}</div>
            ${journalLinksHtml(entry)}
            <div class="j-meta">
              <span class="j-status ${entry.status === 'auto' ? 'auto' : entry.status === 'confirmed' ? 'applied' : entry.status === 'rolled_back' ? 'pending' : 'pending'}">${STATUS_LABEL[entry.status] || entry.status}</span>
              ${canResolve ? `<span class="staff-action" style="display:inline-block; margin-left:8px;" onclick="resolveJournalEntry('${entry.id}', 'confirm')">Подтвердить</span><span class="staff-action revoke" style="display:inline-block; margin-left:8px;" onclick="resolveJournalEntry('${entry.id}', 'rollback')">Откатить</span>` : ''}
            </div>
          </div>
        </div>
      `;
    })();
  }


  // Календарь был макетом: дни августа зашиты в разметку, а нажатие на день
  // только закрывало окошко. Строим его из настоящих дат записей.
  let journalDayFilter = null;

  function renderJournalCalendar(){
    const box = document.getElementById('dnPopover');
    if(!box) return;
    const days = {};
    journalEntries.forEach(function(e){
      const k = journalDayKey(e.created_at);
      days[k] = (days[k] || 0) + 1;
    });
    const keys = Object.keys(days).sort().reverse().slice(0, 30);
    if(keys.length === 0){
      box.innerHTML = '<div class="dn-cal-head"><span>Записей нет</span></div>';
      return;
    }
    box.innerHTML = '<div class="dn-cal-head"><span>Дни с записями</span>'
      + (journalDayFilter
        ? '<button type="button" class="dn-reset" onclick="pickDay(null, event)">Все дни</button>'
        : '')
      + '</div>'
      + '<div class="dn-list">'
      + keys.map(function(k){
        return '<button type="button" class="dn-day-row' + (journalDayFilter === k ? ' selected' : '')
          + '" onclick="pickDay(\'' + k + '\', event)">'
          + '<span>' + escapeHTML(journalDayLabel(k)) + '</span>'
          + '<span class="dn-day-count">' + days[k] + '</span></button>';
      }).join('')
      + '</div>';
  }

  // Запись журнала обязана вести туда, о чём говорит. Раньше адрес ячейки
  // существовал только внутри фразы: прочитать можно, пойти нельзя.
  //
  // Обработчик один на весь список, а не onclick в каждой строке: записей
  // двести, и двести замыканий ради двух видов перехода — лишнее.
  const ICON_CELL = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">'
    + '<rect x="2.5" y="2.5" width="11" height="11" rx="1.6" stroke="currentColor" stroke-width="1.5"/>'
    + '<path d="M2.5 8h11M8 2.5v11" stroke="currentColor" stroke-width="1.2"/></svg>';
  const ICON_DOC = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">'
    + '<path d="M4 2.5h5.5L12.5 6v7.5H4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'
    + '<path d="M6 8.5h4.5M6 11h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

  function journalLinksHtml(entry){
    const parts = [];
    if(entry.cell_label){
      parts.push('<span class="j-link" data-go-cell="' + entry.cell_block_id
        + '" title="Показать на карте склада">' + ICON_CELL
        + escapeHTML(entry.cell_label) + '</span>');
    }
    if(entry.invoice_number){
      parts.push('<span class="j-link" data-go-invoice="' + entry.invoice_id
        + '" title="Показать накладную">' + ICON_DOC
        + escapeHTML(entry.invoice_number) + '</span>');
    }
    return parts.length ? '<div class="j-links">' + parts.join('') + '</div>' : '';
  }

  document.addEventListener('click', function(e){
    const cell = e.target.closest && e.target.closest('[data-go-cell]');
    if(cell){ e.stopPropagation(); goToJournalCell(cell.dataset.goCell); return; }
    const inv = e.target.closest && e.target.closest('[data-go-invoice]');
    if(inv){ e.stopPropagation(); goToJournalInvoice(inv.dataset.goInvoice); }
  });

  async function showJournalFor(kind, id, label){
    journalScope = { kind: kind, id: id, label: label };
    // Фильтры ленты сбрасываем: они относились к общему журналу, и молча
    // унести их в историю ячейки — способ показать пустой экран без причины.
    journalDayFilter = null;
    const search = document.getElementById('jSearch');
    if(search) search.value = '';
    switchView('journal');
    await loadJournal(true);
  }

  async function clearJournalScope(){
    journalScope = null;
    await loadJournal(true);
  }

  document.addEventListener('click', function(e){
    if(e.target.closest && e.target.closest('[data-journal-scope-clear]')) clearJournalScope();
    const hist = e.target.closest && e.target.closest('[data-history-cell]');
    if(hist){
      e.stopPropagation();
      showJournalFor('cell', hist.dataset.historyCell, hist.dataset.historyLabel || 'ячейка');
      return;
    }
    const histInv = e.target.closest && e.target.closest('[data-history-invoice]');
    if(histInv){
      e.stopPropagation();
      showJournalFor('invoice', histInv.dataset.historyInvoice,
        histInv.dataset.historyLabel || 'накладная');
    }
  });

  async function goToJournalCell(blockId){
    switchView('warehouse');
    // Карта могла ещё ни разу не рисоваться: ждём её, а не гадаем задержкой.
    for(let i = 0; i < 40; i += 1){
      const el = document.querySelector('.wh-cell[data-block-id="' + blockId + '"]');
      if(el){
        const entry = blockById[blockId];
        if(entry) focusRow(entry.rowNum);
        selectCell(el);
        el.scrollIntoView({behavior:'smooth', block:'center'});
        return;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    showWhToast('Ячейка не найдена на схеме — возможно, её перестроили.');
  }

  function goToJournalInvoice(invoiceId){
    switchView('staff');
    setTimeout(function(){
      const row = document.querySelector('[data-invoice-id="' + invoiceId + '"]');
      if(!row){ showWhToast('Накладная не найдена в списке.'); return; }
      row.scrollIntoView({behavior:'smooth', block:'center'});
      row.classList.add('j-flash');
      setTimeout(function(){ row.classList.remove('j-flash'); }, 2400);
    }, 120);
  }

  function renderContextPanel(){
    const host = document.getElementById('ctxPending');
    if(!host) return;
    const pending = journalEntries.filter(e => e.status === 'pending');
    if(pending.length === 0){
      host.innerHTML = '<div class="ctx-card"><div class="ctx-empty">'
        + 'Ничего не ждёт решения. Здесь появятся расхождения, которые агенты нашли, '
        + 'но не стали проводить в 1С без вашего слова.</div></div>';
      return;
    }
    host.innerHTML = pending.map(e => `
      <div class="ctx-card">
        <div class="ctx-entry-head">
          <span class="ctx-entry-agent">${escapeHTML(String(e.agent || 'Агент'))}</span>
          <span class="ctx-entry-time">${formatEntryTime(e.created_at)}</span>
        </div>
        <div class="ctx-entry-text">${escapeHTML(String(e.action_text || ''))}</div>
        <div class="ctx-actions">
          <div class="ctx-btn confirm" onclick="resolveJournalEntry('${e.id}', 'confirm')">Подтвердить</div>
          <div class="ctx-btn reject" onclick="resolveJournalEntry('${e.id}', 'rollback')">Откатить</div>
        </div>
        <div class="ctx-note">До подтверждения запись в 1С не изменится. Решение попадёт в журнал вместе с вашим именем.</div>
      </div>
    `).join('');
  }

  async function resolveJournalEntry(id, resolution){
    if(resolution === 'confirm' && !confirm('Подтвердить эту запись? Правка будет проведена в 1С.')) return;
    if(resolution === 'rollback' && !confirm('Откатить эту запись? Действие будет проведено обратной компенсирующей проводкой в 1С.')) return;
    try{
      await apiFetch('/api/journal/' + id + '/resolve', {method:'POST', body:{resolution}});
      await loadJournal();
    } catch(e){
      showWhToast('Не удалось выполнить действие: ' + e.message);
    }
  }

  function toggleChip(key, el){
    activeFilter = key;
    document.querySelectorAll('.jf-chip').forEach(c=>{
      c.classList.toggle('active', c.dataset.filter === key);
    });
    applyFilters();
  }
  function toggleAttention(){
    attentionOnly = !attentionOnly;
    document.getElementById('attentionToggle').classList.toggle('active', attentionOnly);
    applyFilters();
  }
  function applyFilters(){
    const search = document.getElementById('jSearch').value.trim().toLowerCase();
    // Пока фильтр включён, группы раскрыты: спрятать найденное под плюсик —
    // худшее, что может сделать поиск.
    const filtering = Boolean(search) || Boolean(journalDayFilter)
      || activeFilter !== 'all' || attentionOnly;
    document.querySelectorAll('.j-group').forEach(function(g){
      g.classList.toggle('open', filtering);
    });
    const agentKeys = ['orchestrator','warehouse','analyst'].includes(activeFilter) ? [activeFilter] : [];
    const needPending = attentionOnly;
    let visibleCount = 0;
    let auto = 0, confirmed = 0, pending = 0;
    document.querySelectorAll('.j-entry').forEach(entry=>{
      let show = true;
      if(show && agentKeys.length>0){ show = agentKeys.some(k=>entry.classList.contains(k)); }
      if(show && needPending){ show = !!entry.querySelector('.j-status.pending'); }
      if(show && search){
        const searchable = [
          entry.querySelector('.j-text')?.textContent || '',
          entry.querySelector('.j-agent')?.textContent || ''
        ].join(' ').toLowerCase();
        show = searchable.includes(search);
      }
      if(show && journalDayFilter){ show = entry.dataset.day === journalDayFilter; }
      entry.style.display = show ? 'flex' : 'none';
      if(show){
        visibleCount++;
        const st = entry.querySelector('.j-status');
        if(st){
          if(st.classList.contains('auto')) auto++;
          else if(st.classList.contains('applied')) confirmed++;
          else if(st.classList.contains('pending')) pending++;
        }
      }
    });
    // Когда журнал сужен до ячейки или накладной и записей нет, лента уже
    // объясняет это своими словами. Второе сообщение рядом только спорит с
    // первым: «записей нет» и «по фильтрам не найдено» — про разное.
    const jEmpty = document.getElementById('jEmpty');
    const explainedAlready = journalScope && journalEntries.length === 0;
    jEmpty.classList.toggle('show', visibleCount === 0 && !explainedAlready);
    jEmpty.textContent = 'По выбранным фильтрам записей не найдено.';
    // Подпись описывает то, что видно СЕЙЧАС: с включённым фильтром «19 записей»
    // над списком из трёх — вранье, а журналу верить надо.
    const scope = journalDayFilter ? journalDayLabel(journalDayFilter) : 'Все дни';
    const tail = pending > 0
      ? ' · ' + pending + ' ' + pluralRu(pending, 'ждёт', 'ждут', 'ждут') + ' решения'
      : '';
    document.getElementById('dnSub').textContent = scope + ' · ' + visibleCount + ' '
      + pluralRu(visibleCount, 'запись', 'записи', 'записей') + tail;
    document.getElementById('statAuto').textContent = auto;
    document.getElementById('statConfirmed').textContent = confirmed;
    document.getElementById('statPending').textContent = pending;
    document.getElementById('statTotal').textContent = visibleCount;
    hideEmptyGroups();
    hideEmptyDaySeparators();
  }

  let sortMode = 'time';

  // Разделитель дня без единой видимой записи под ним — мусор на экране.
  // Заголовок группы без единой видимой записи внутри — такой же мусор,
  // как и пустой разделитель дня.
  function hideEmptyGroups(){
    document.querySelectorAll('.j-group').forEach(function(g){
      const any = [...g.querySelectorAll('.j-entry')]
        .some(function(el){ return el.style.display !== 'none'; });
      g.style.display = any ? '' : 'none';
    });
  }

  function hideEmptyDaySeparators(){
    document.querySelectorAll('[data-day-sep]').forEach(function(sep){
      const key = sep.dataset.daySep;
      const any = [...document.querySelectorAll('.j-entry[data-day="' + key + '"]')]
        .some(function(el){ return el.style.display !== 'none'; });
      sep.style.display = any ? '' : 'none';
    });
  }

  function toggleSort(){
    document.getElementById('jSortMenu').classList.toggle('open');
    document.getElementById('jSortBtn').classList.toggle('open');
  }
  function pickSort(value, label){
    sortMode = value;
    document.getElementById('jSortLabel').textContent = label;
    document.querySelectorAll('.j-sort-item').forEach(el=>{
      el.classList.toggle('active', el.dataset.value === value);
    });
    document.getElementById('jSortMenu').classList.remove('open');
    document.getElementById('jSortBtn').classList.remove('open');
    sortEntries();
  }
  document.addEventListener('click', function(e){
    const wrap = document.querySelector('.sort-wrap');
    if(wrap && !wrap.contains(e.target)){
      document.getElementById('jSortMenu').classList.remove('open');
      document.getElementById('jSortBtn').classList.remove('open');
    }
  });

  function sortEntries(){
    const mode = sortMode;
    const list = document.getElementById('jList');
    const entries = Array.from(list.querySelectorAll('.j-entry'));
    entries.sort((a,b)=>{
      if(mode==='risk'){
        const order = {high:0, low:1, none:2};
        return (order[a.dataset.risk] ?? 3) - (order[b.dataset.risk] ?? 3);
      }
      return 0; // client sort dropped — real entries no longer carry a client field client-side
    });
    entries.forEach(e=>list.appendChild(e));
  }

  function togglePin(el){
    const wasPinned = el.classList.contains('pinned');
    document.querySelectorAll('.connected-agent.pinned').forEach(n=>n.classList.remove('pinned'));
    if(!wasPinned) el.classList.add('pinned');
  }
  document.addEventListener('click', function(e){
    if(!e.target.closest('.connected-agent')){
      document.querySelectorAll('.connected-agent.pinned').forEach(n=>n.classList.remove('pinned'));
    }
  });

  function updateBulk(){
    const checked = document.querySelectorAll('.j-check:checked');
    document.getElementById('bulkCount').textContent = 'Выбрано: ' + checked.length;
    document.getElementById('jBulkbar').classList.toggle('show', checked.length>0);
  }
  async function confirmSelected(){
    const checked = document.querySelectorAll('.j-check:checked');
    if(checked.length === 0) return;
    if(!confirm('Подтвердить ' + checked.length + ' запис' + (checked.length===1?'ь':'и') + '? Правки будут проведены в 1С.')) return;
    const ids = Array.from(checked).map(cb => cb.closest('.j-entry').dataset.entryId);
    try{
      for(const id of ids){
        await apiFetch('/api/journal/' + id + '/resolve', {method:'POST', body:{resolution:'confirm'}});
      }
      await loadJournal();
      updateBulk();
    } catch(e){
      showWhToast('Не удалось подтвердить: ' + e.message);
    }
  }

  function exportCSV(){
    const rows = [['Время','Агент','Действие','Статус']];
    document.querySelectorAll('.j-entry').forEach(e=>{
      if(e.style.display === 'none') return;
      const time = e.querySelector('.j-time')?.textContent || '';
      const agent = e.querySelector('.j-agent')?.textContent || '';
      const text = (e.querySelector('.j-text')?.textContent || '').trim();
      const status = e.querySelector('.j-status')?.textContent || '';
      rows.push([time, agent, text, status]);
    });
    const csv = rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
    const blob = new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'argus_journal.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ===================== Чат (пока декоративный — агенты ещё не подключены) ===================== */

  let attachedFiles = [];

  function autoGrow(){
    const t = document.getElementById('chatInput');
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 120) + 'px';
  }

  function handleFiles(fileList){
    Array.from(fileList).forEach(file=>attachedFiles.push(file));
    renderAttachPreview();
  }

  function renderAttachPreview(){
    const wrap = document.getElementById('attachPreview');
    wrap.innerHTML = '';
    attachedFiles.forEach((file, idx)=>{
      const chip = document.createElement('div');
      chip.className = 'attach-chip';
      if(file.type.startsWith('image/')){
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        chip.appendChild(img);
      }
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = file.name;
      chip.appendChild(name);
      const rm = document.createElement('span');
      rm.className = 'rm';
      rm.textContent = '✕';
      rm.onclick = function(){ attachedFiles.splice(idx,1); renderAttachPreview(); };
      chip.appendChild(rm);
      wrap.appendChild(chip);
    });
  }

  function openLightbox(src){
    document.getElementById('lightboxImg').src = src;
    document.getElementById('lightbox').classList.add('open');
  }
  function closeLightbox(){
    document.getElementById('lightbox').classList.remove('open');
  }
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape') closeLightbox();
  });

  function nowTime(){
    const d = new Date();
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }

  function escapeHTML(str){
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Чат разговаривает с Оркестратором по-настоящему: вопрос уходит на
  // /api/agents/orchestrator/ask, тот зовёт Кладовщика, Кладовщик ищет товар
  // в ячейках, ответ возвращается сюда. Раньше эта функция просто дорисовывала
  // ваше сообщение в переписку и ничего не отправляла — выглядело как чат,
  // работало как блокнот.
  function askOrchestrator(question){
    const textarea = document.getElementById('chatInput');
    textarea.value = question;
    sendMessage();
  }

  // Ответ агента приходит текстом. Разметку из него не делаем: перевод строки
  // — это перевод строки, всё остальное экранируется. Модель не должна уметь
  // вставить в кабинет свой HTML.
  function agentMessageHtml(name, cls, avatar, bodyHtml, time){
    return '<div class="avatar agent ' + cls + '">' + avatar + '</div>'
      + '<div class="bubble ' + cls + '">'
      + '<div class="agent-head"><span class="agent-name' + (cls === 'warehouse' ? ' warehouse' : '') + '">'
      + escapeHTML(name) + '</span><span class="msg-time">' + (time || nowTime()) + '</span></div>'
      + bodyHtml + '</div>';
  }

  async function sendMessage(){
    const textarea = document.getElementById('chatInput');
    const text = textarea.value.trim();
    if(!text && attachedFiles.length===0) return;

    const chatBody = document.querySelector('.chat-body');
    const empty = document.getElementById('chatEmpty');
    if(empty) empty.remove();
    const msg = document.createElement('div');
    msg.className = 'msg user';
    let attachHTML = '';
    if(attachedFiles.length){
      attachHTML = '<div class="msg-attachments">' + attachedFiles.map(function(f){
        if(f.type.startsWith('image/')){
          const url = URL.createObjectURL(f);
          return '<img class="att-thumb" src="' + url + '" onclick="event.stopPropagation(); openLightbox(\'' + url + '\')">';
        }
        return '<div class="att-file">📄 ' + escapeHTML(f.name) + '</div>';
      }).join('') + '</div>';
    }
    msg.innerHTML = '<div class="avatar user">В</div><div><div class="bubble">' + (text ? escapeHTML(text) : '') + attachHTML + '</div><div class="msg-time-user">' + nowTime() + '</div></div>';
    chatBody.appendChild(msg);
    chatBody.scrollTop = chatBody.scrollHeight;
    if(chatBody.querySelector('#chatEmpty')) chatBody.querySelector('#chatEmpty').remove();

    textarea.value = '';
    autoGrow();
    const hadFiles = attachedFiles.length > 0;
    attachedFiles = [];
    renderAttachPreview();

    if(!text){
      // Файлы Оркестратор пока не разбирает. Молча проглотить вложение и
      // ничего не ответить — хуже, чем сказать прямо.
      if(hadFiles) addAgentReply('Файлы я пока не читаю — напишите вопрос словами.');
      return;
    }

    const thinking = document.createElement('div');
    thinking.className = 'msg';
    thinking.innerHTML = agentMessageHtml('Оркестратор', 'orchestrator', 'ОР',
      '<span class="msg-thinking"><i></i><i></i><i></i></span>');
    chatBody.appendChild(thinking);
    chatBody.scrollTop = chatBody.scrollHeight;

    try{
      const res = await apiFetch('/api/agents/orchestrator/ask', {method:'POST', body:{question: text}});
      thinking.remove();
      // Сначала показываем, кому Оркестратор передал задачу, потом ответ
      // самого агента. Это не лишний вызов модели: решение о передаче принято
      // внутри того же обращения, раньше мы его просто выбрасывали.
      (res.steps || []).forEach(step => addRoutingStep(step));
      const agent = (res.steps || []).length === 1 ? res.steps[0].agent : 'Оркестратор';
      addAgentReply(res.answer || 'Ответ пустой — попробуйте переспросить.', agent);
    } catch(e){
      thinking.remove();
      addAgentReply('Не получилось ответить: ' + e.message, 'Оркестратор');
    }
  }

  // Кто есть кто в чате: как подписан, какие две буквы в кружке и каким
  // цветом. Появится Аналитик — строка сюда, и ничего больше.
  const AGENT_LOOK = {
    'Оркестратор': {cls: 'orchestrator', avatar: 'ОР'},
    'Кладовщик':   {cls: 'warehouse',    avatar: 'КЛ'},
  };

  // Восстановление переписки при открытии вкладки. Раньше чат каждый раз
  // начинался с чистого экрана, даже если разговор был минуту назад.
  let chatLoaded = false;

  // Сколько Кладовщик сказал сам, пока владелец сюда не заходил. Считается при
  // открытии кабинета: смысл проактивности в том, чтобы человек узнал о
  // проблеме, НЕ открывая чат.
  async function refreshAlertBadge(){
    const badge = document.getElementById("chatBadge");
    if(!badge) return;
    let unread = 0;
    try{
      const data = await apiFetch("/api/alerts");
      unread = (data.alerts || []).filter(function(a){ return !a.seen_at; }).length;
    } catch(e){ return; }
    badge.textContent = unread > 0 ? String(unread) : "";
    badge.classList.toggle("show", unread > 0);
  }
  async function loadChatHistory(){
    if(chatLoaded) return;
    chatLoaded = true;
    let messages;
    try{
      messages = await apiFetch('/api/agents/chat');
    } catch(e){
      // Не удалось — оставляем пустой экран с подсказками. Ругаться на
      // человека за то, что не подгрузилась история, незачем: чат работает.
      return;
    }
    // Тревоги живут отдельно от переписки, и намеренно: последние сообщения
    // чата уходят в модель как история разговора, а сообщения, которые никто
    // не писал, отравили бы контекст и съели бюджет живых вопросов.
    let alerts = [];
    try{
      const data = await apiFetch('/api/alerts');
      alerts = (data.alerts || []).map(function(a){
        return { kind: 'alert', id: a.id, text: a.text, created_at: a.created_at, seen: !!a.seen_at };
      });
    } catch(e){ /* без тревог чат работает как работал */ }

    const stream = (messages || []).map(function(m){
      return Object.assign({ kind: 'chat' }, m);
    }).concat(alerts);
    stream.sort(function(a, b){ return new Date(a.created_at) - new Date(b.created_at); });

    if(stream.length === 0) return;
    const empty = document.getElementById('chatEmpty');
    if(empty) empty.remove();
    stream.forEach(function(m){
      if(m.kind === 'alert'){
        addAlert(m);
      } else if(m.role === 'user'){
        addUserMessage(m.text, formatChatTime(m.created_at));
      } else {
        (m.steps || []).forEach(function(step){ addRoutingStep(step, formatChatTime(m.created_at)); });
        addAgentReply(m.text, m.agent, formatChatTime(m.created_at));
      }
    });
  }

  // Кладовщик заговорил сам, без вопроса. Человеку важно понять это с первого
  // взгляда: выше нет реплики, на которую он отвечает.
  function addAlert(alert){
    const chatBody = document.querySelector('.chat-body');
    if(!chatBody) return;
    const look = AGENT_LOOK['Кладовщик'];
    const body = '<div class="msg-alert">'
      + '<span class="msg-alert-mark">Заметил сам</span>'
      + '<div class="msg-alert-text">' + escapeHTML(alert.text).replace(/\n/g, '<br>') + '</div>'
      + '</div>';
    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.innerHTML = agentMessageHtml('Кладовщик', look.cls, look.avatar, body,
      formatChatTime(alert.created_at));
    chatBody.appendChild(msg);
    chatBody.scrollTop = chatBody.scrollHeight;
    // Отметка «прочитано» ничего не скрывает: если причина не ушла, тревога
    // останется. Это пометка для владельца, а не способ от неё избавиться.
    if(!alert.seen){
      apiFetch('/api/alerts/' + alert.id + '/seen', { method: 'POST' }).catch(function(){});
    }
  }

  function formatChatTime(iso){
    const d = new Date(iso);
    return isNaN(d) ? nowTime() : String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }

  function addUserMessage(text, time){
    const chatBody = document.querySelector('.chat-body');
    const msg = document.createElement('div');
    msg.className = 'msg user';
    msg.innerHTML = '<div class="avatar user">В</div><div><div class="bubble">'
      + escapeHTML(String(text)) + '</div><div class="msg-time-user">' + (time || nowTime()) + '</div></div>';
    chatBody.appendChild(msg);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function addRoutingStep(step, time){
    const look = AGENT_LOOK[step.agent] || AGENT_LOOK['Кладовщик'];
    const found = step.found === null || step.found === undefined
      ? ''
      : ` <span class="msg-routing-found">— нашёл ${step.found} ${pluralRu(step.found, 'позицию', 'позиции', 'позиций')}</span>`;
    // Что именно делал агент, формулирует сервер (step.task): «найти «X»»,
    // «проверить состояние склада», «посмотреть накладную «Y»». Старые записи
    // в истории поля task не имеют — для них остаётся прежняя фраза с query.
    const task = step.task
      ? escapeHTML(String(step.task))
      : 'найти «' + escapeHTML(String(step.query)) + '»';
    const body = 'Передаю задачу — <b>' + escapeHTML(step.agent) + '</b>: ' + task + found;
    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.innerHTML = agentMessageHtml('Оркестратор', 'orchestrator', 'ОР',
      '<span class="msg-routing">' + body + '</span>', time);
    const chatBody = document.querySelector('.chat-body');
    chatBody.appendChild(msg);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function addAgentReply(answer, agentName, time){
    const name = agentName || 'Оркестратор';
    const look = AGENT_LOOK[name] || AGENT_LOOK['Оркестратор'];
    const chatBody = document.querySelector('.chat-body');
    const msg = document.createElement('div');
    msg.className = 'msg';
    const body = escapeHTML(String(answer)).split('\n').join('<br>');
    msg.innerHTML = agentMessageHtml(name, look.cls, look.avatar, body, time);
    chatBody.appendChild(msg);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function setupMic(){
    const micBtn = document.getElementById('micBtn');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SpeechRecognition){
      micBtn.title = 'Голосовой ввод не поддерживается в этом браузере';
      micBtn.style.opacity = 0.4;
      micBtn.style.cursor = 'default';
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.continuous = true;
    recognition.interimResults = true;

    let listening = false;
    let baseText = '';

    recognition.onresult = function(e){
      let interim = '';
      let final = '';
      for(let i=e.resultIndex; i<e.results.length; i++){
        const transcript = e.results[i][0].transcript;
        if(e.results[i].isFinal) final += transcript;
        else interim += transcript;
      }
      const textarea = document.getElementById('chatInput');
      textarea.value = (baseText + ' ' + final + ' ' + interim).trim();
      if(final) baseText = (baseText + ' ' + final).trim();
      autoGrow();
    };
    recognition.onend = function(){
      listening = false;
      micBtn.classList.remove('recording');
    };
    recognition.onerror = function(){
      listening = false;
      micBtn.classList.remove('recording');
    };

    micBtn.addEventListener('click', function(){
      if(listening){
        recognition.stop();
      } else {
        baseText = document.getElementById('chatInput').value;
        recognition.start();
        listening = true;
        micBtn.classList.add('recording');
      }
    });
  }

  function initChat(){
    const textarea = document.getElementById('chatInput');
    textarea.addEventListener('input', autoGrow);
    textarea.addEventListener('keydown', function(e){
      if(e.key==='Enter' && !e.shiftKey){
        e.preventDefault();
        sendMessage();
      }
    });
    document.getElementById('attachBtn').addEventListener('click', function(){
      document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', function(e){
      handleFiles(e.target.files);
      e.target.value = '';
    });
    document.getElementById('sendBtn').addEventListener('click', sendMessage);

    const chatBody = document.querySelector('.chat-body');
    chatBody.addEventListener('dragover', function(e){ e.preventDefault(); chatBody.classList.add('dragover'); });
    chatBody.addEventListener('dragleave', function(){ chatBody.classList.remove('dragover'); });
    chatBody.addEventListener('drop', function(e){
      e.preventDefault();
      chatBody.classList.remove('dragover');
      handleFiles(e.dataTransfer.files);
    });

    setupMic();
  }
  initChat();

  /* ===================== Площадки ===================== */

  // Здесь владелец подключает ключ продавца и видит, живая ли связь. Всё,
  // что делает Аргус на площадке, — читает сборочные задания. Ни одной
  // кнопки, которая что-то там меняет, на этом экране нет и быть не должно:
  // в кабинете продавца мы не трогаем ничего.

  let marketplaces = [];

  const MP_TITLES = { wb: 'Wildberries' };
  const mpTitle = (code) => MP_TITLES[code] || code;

  function renderMpCompanySelect(){
    const select = document.getElementById('mpCompanySelect');
    if(!select) return;
    if(companies.length === 0){
      select.innerHTML = '<option value="">Сначала добавьте продавца</option>';
      return;
    }
    select.innerHTML = companies.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
  }

  async function loadMarketplaces(){
    try{
      marketplaces = await apiFetch('/api/marketplaces');
    } catch(e){
      marketplaces = [];
      showWhToast('Не удалось загрузить площадки: ' + e.message);
    }
    renderMarketplaces();
  }

  function renderMarketplaces(){
    const dot = document.getElementById('mpStatusDot');
    const title = document.getElementById('mpStatusTitle');
    const sub = document.getElementById('mpStatusSub');
    const list = document.getElementById('mpList');
    if(!list) return;

    if(marketplaces.length === 0){
      dot.classList.remove('connected');
      title.textContent = 'Ни одна площадка не подключена';
      sub.textContent = 'Заказы с маркетплейсов пока не приходят — Аргус видит только накладные из 1С';
      list.innerHTML = '';
      return;
    }

    // Живой считается связь, которая была недавно. Само подключение ни о чём
    // не говорит: ключ мог протухнуть, и снаружи это выглядит как затишье.
    const alive = marketplaces.filter(m => m.lastUsedAt
      && (Date.now() - new Date(m.lastUsedAt).getTime()) < 60 * 60 * 1000).length;
    dot.classList.toggle('connected', alive > 0);
    title.textContent = alive > 0 ? 'Заказы приходят' : 'Подключено, но связи давно не было';
    sub.textContent = marketplaces.length + ' '
      + pluralRu(marketplaces.length, 'подключение', 'подключения', 'подключений')
      + ' · Аргус опрашивает площадки сам, раз в пять минут';

    list.innerHTML = marketplaces.map(m => {
      const seen = formatLastSeen(m.lastUsedAt);
      const when = seen ? 'Последняя связь: ' + seen : 'Связи ещё не было';
      const mode = m.writeEnabled
        ? 'Запись на площадку РАЗРЕШЕНА'
        : 'Только чтение — на площадке ничего не меняется';
      return '<div class="staff-row" style="grid-template-columns:1.3fr 1fr 1.2fr auto; align-items:center;">'
        + '<div class="staff-name">' + escapeHTML(m.company) + '</div>'
        + '<div class="staff-key">' + escapeHTML(mpTitle(m.marketplace)) + '</div>'
        + '<div class="staff-date">' + when + '</div>'
        + '<div class="staff-action" onclick="syncMarketplace(\'' + m.companyId + '\')">Забрать заказы</div>'
        + '</div>'
        + '<div class="staff-row" style="grid-template-columns:1.3fr 1fr 1.2fr auto; opacity:0.85;">'
        + '<div class="staff-date" style="grid-column:1/3;">' + mode + '</div>'
        + '<div class="staff-action" onclick="checkMarketplace(\'' + m.companyId + '\')">Проверить связь</div>'
        + '<div class="staff-action revoke" onclick="disconnectMarketplace(\'' + m.companyId + '\', \'' + m.marketplace + '\')">Отключить</div>'
        + '</div>';
    }).join('');
  }

  function showMpResult(html){
    const box = document.getElementById('mpSyncResult');
    if(!box) return;
    box.innerHTML = html ? '<div class="oc-note" style="margin-top:14px;">' + html + '</div>' : '';
  }

  async function connectMarketplace(){
    const companyId = document.getElementById('mpCompanySelect').value;
    const marketplace = document.getElementById('mpMarketSelect').value;
    const input = document.getElementById('mpTokenInput');
    const token = input.value.trim();
    if(!companyId){ showWhToast('Выберите продавца.'); return; }
    if(!token){ showWhToast('Вставьте ключ API продавца.'); return; }
    try{
      const res = await apiFetch('/api/marketplaces/credentials', {
        method: 'POST', body: { companyId, marketplace, token },
      });
      // Ключ из поля убираем сразу: он больше не нужен, а лежать открытым на
      // экране ему незачем.
      input.value = '';
      await loadMarketplaces();
      const who = res.seller ? res.seller.name : mpTitle(marketplace);
      showWhToast('Подключено: ' + who);
      showMpResult('Ключ принят площадкой. Продавец: <b>' + escapeHTML(who)
        + '</b>. Ключ сохранён зашифрованным — показать его обратно нельзя.');
    } catch(e){
      showWhToast('Не подключилось: ' + e.message);
    }
  }

  async function checkMarketplace(companyId){
    try{
      const res = await apiFetch('/api/marketplaces/' + companyId + '/wb/check');
      const whs = (res.warehouses || []).map(w => escapeHTML(w.name)).join(', ') || 'складов не заведено';
      showMpResult('Связь есть. Продавец: <b>' + escapeHTML(res.seller.name) + '</b>, ИНН '
        + escapeHTML(res.seller.inn || '—') + '. Склады на площадке: ' + whs + '.');
      await loadMarketplaces();
    } catch(e){
      showMpResult('Связи нет: ' + escapeHTML(e.message));
    }
  }

  async function syncMarketplace(companyId){
    showMpResult('Спрашиваю площадку…');
    try{
      const r = await apiFetch('/api/marketplaces/sync', { method: 'POST', body: { companyId } });
      let text = 'Заданий у площадки: <b>' + r.seen + '</b>. Новых заказов заведено: <b>'
        + r.created + '</b>, уже были: ' + r.existed + '.';
      if(r.unmapped && r.unmapped.length){
        // Несопоставленное показываем всегда и поимённо: такой заказ склад
        // физически не соберёт, и узнать об этом надо здесь, а не у полки.
        const arts = [...new Set(r.unmapped.map(u => u.article).filter(Boolean))];
        text += '<br><br>Не удалось узнать товар у ' + r.unmapped.length + ' '
          + pluralRu(r.unmapped.length, 'задания', 'заданий', 'заданий')
          + '. Артикул' + (arts.length > 1 ? 'ы' : '') + ': ' + escapeHTML(arts.join(', '))
          + '. Такой заказ виден в накладных, но собрать его нечем, пока артикул не появится в таблице сопоставления.';
      }
      showMpResult(text);
      await loadMarketplaces();
      loadInvoicesList();
    } catch(e){
      showMpResult('Не получилось забрать заказы: ' + escapeHTML(e.message));
    }
  }

  async function disconnectMarketplace(companyId, marketplace){
    if(!confirm('Отключить площадку? Заказы перестанут приходить. Уже заведённые накладные останутся.')) return;
    try{
      await apiFetch('/api/marketplaces/' + companyId + '/' + marketplace, { method: 'DELETE' });
      await loadMarketplaces();
      showMpResult('');
      showWhToast('Площадка отключена.');
    } catch(e){
      showWhToast('Не удалось отключить: ' + e.message);
    }
  }

  /* ===================== Инвентаризация ===================== */

  // Пересчёт назначает владелец — работник его не начинает. Здесь три вещи:
  // как часто считать, что уйдёт в работу прямо сейчас, и что ждёт решения.
  //
  // Решение — единственное место во всей инвентаризации, где остаток вообще
  // меняется. Поэтому расхождение показывается построчно: что числилось, что
  // насчитали и на сколько это расходится.

  let invSettings = null;
  let invWaiting = [];

  async function loadInventory(){
    try{
      invSettings = await apiFetch('/api/inventory/settings');
    } catch(e){ invSettings = null; }
    try{
      invWaiting = await apiFetch('/api/inventory/tasks?status=waiting_owner');
    } catch(e){ invWaiting = []; }
    renderInventory();
  }

  function renderInventory(){
    const s = invSettings;
    if(s){
      const set = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
      set('invRecountDays', s.recountAfterDays);
      set('invCellsPerRun', s.cellsPerRun);
      set('invMinDays', s.minDaysBetweenRuns);
    }
    renderInvWaiting();
  }

  function renderInvWaiting(){
    const box = document.getElementById('invWaitingList');
    if(!box) return;
    const dot = document.getElementById('invStatusDot');
    const title = document.getElementById('invStatusTitle');
    const sub = document.getElementById('invStatusSub');

    if(invWaiting.length === 0){
      if(dot) dot.classList.add('connected');
      if(title) title.textContent = 'Расхождений нет';
      if(sub) sub.textContent = 'Всё, что посчитали, сошлось с тем, что в базе';
      box.innerHTML = '';
      return;
    }
    if(dot) dot.classList.remove('connected');
    if(title) title.textContent = invWaiting.length + ' '
      + pluralRu(invWaiting.length, 'ячейка ждёт', 'ячейки ждут', 'ячеек ждут') + ' вашего решения';
    if(sub) sub.textContent = 'До решения остаток не изменён ни на штуку';

    box.innerHTML = invWaiting.map(function(t){
      const rows = invDiffRows(t).map(function(d){
        return '<div class="inv-diff-row">'
          + '<div><b>' + escapeHTML(d.name || d.sku) + '</b>'
          + '<span class="inv-diff-sku">' + escapeHTML(d.sku) + '</span></div>'
          + '<div class="inv-diff-nums">числилось ' + d.expectedQty
          + ' · насчитали ' + d.countedQty
          + ' <span class="' + (d.diff > 0 ? 'up' : 'down') + '">'
          + (d.diff > 0 ? '+' : '') + d.diff + '</span></div>'
          + '</div>';
      }).join('');
      const note = t.note
        ? '<div class="inv-note">' + escapeHTML(t.note) + '</div>'
        : '';
      return '<div class="inv-card">'
        + '<div class="inv-card-head">'
        +   '<div><b>Ячейка ' + escapeHTML(t.label) + '</b>'
        +   '<span class="inv-card-reason">' + escapeHTML(t.reason) + '</span></div>'
        +   '<div class="inv-card-when">' + (t.countedAt
              ? new Date(t.countedAt).toLocaleString('ru-RU') : '') + '</div>'
        + '</div>'
        + (rows || '<div class="inv-diff-row"><div>Количества сошлись</div></div>')
        + note
        + '<div class="inv-card-actions">'
        +   '<button class="inv-btn danger" onclick="resolveInv(\'' + t.id + '\', \'reject\')">Отклонить</button>'
        +   '<button class="inv-btn" onclick="resolveInv(\'' + t.id + '\', \'apply\')">Принять пересчёт</button>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  // Разница считается здесь же, из снимка и посчитанного: сервер отдаёт обе
  // стороны, и показывать их без сравнения значит заставлять владельца
  // сличать два списка глазами.
  function invDiffRows(t){
    const key = (l) => l.sku + '|' + (l.companyId || '') + '|' + (l.quality || 'good');
    const was = new Map((t.expected || []).map((l) => [key(l), l]));
    const now = new Map((t.counted || []).map((l) => [key(l), l]));
    const out = [];
    was.forEach(function(l, k){
      const c = now.has(k) ? Number(now.get(k).qty) : 0;
      if(Number(l.qty) !== c){
        out.push({ sku: l.sku, name: l.name, expectedQty: Number(l.qty), countedQty: c,
          diff: c - Number(l.qty) });
      }
    });
    now.forEach(function(l, k){
      if(was.has(k)) return;
      out.push({ sku: l.sku, name: l.name, expectedQty: 0, countedQty: Number(l.qty),
        diff: Number(l.qty) });
    });
    return out;
  }

  async function saveInvSettings(){
    const num = (id) => Number(document.getElementById(id).value);
    try{
      invSettings = await apiFetch('/api/inventory/settings', {
        method: 'PATCH',
        body: {
          recountAfterDays: num('invRecountDays'),
          cellsPerRun: num('invCellsPerRun'),
          minDaysBetweenRuns: num('invMinDays'),
        },
      });
      showWhToast('Настройки пересчёта сохранены.');
      renderInventory();
    } catch(e){
      showWhToast(e.message);
    }
  }

  async function previewInv(){
    const box = document.getElementById('invPreview');
    box.innerHTML = '<div class="oc-note">Считаю…</div>';
    try{
      const r = await apiFetch('/api/inventory/preview');
      if(!r.cells.length){
        box.innerHTML = '<div class="oc-note">Считать нечего: все ячейки проверяли недавно.</div>';
        return;
      }
      box.innerHTML = '<div class="oc-note">В работу уйдёт ' + r.cells.length + ' '
        + pluralRu(r.cells.length, 'ячейка', 'ячейки', 'ячеек') + ':<br>'
        + r.cells.map(function(c){
          return '<b>' + escapeHTML(c.label) + '</b> — ' + escapeHTML(c.reason);
        }).join('<br>') + '</div>';
    } catch(e){
      box.innerHTML = '<div class="oc-note">' + escapeHTML(e.message) + '</div>';
    }
  }

  async function startInvRun(){
    try{
      const r = await apiFetch('/api/inventory/runs', { method: 'POST', body: {} });
      showWhToast('Назначено ' + r.cells.length + ' '
        + pluralRu(r.cells.length, 'ячейка', 'ячейки', 'ячеек') + ' — работник увидит их у себя.');
      document.getElementById('invPreview').innerHTML = '';
      loadInventory();
    } catch(e){
      // Тут почти всегда осмысленный отказ: рано, или прошлое не досчитано.
      showWhToast(e.message);
    }
  }

  async function resolveInv(taskId, decision){
    if(decision === 'apply'
      && !confirm('Принять пересчёт? Остаток в ячейке станет таким, каким его увидел работник.')) return;
    try{
      await apiFetch('/api/inventory/tasks/' + taskId + '/resolve', {
        method: 'POST', body: { decision },
      });
      showWhToast(decision === 'apply' ? 'Остаток исправлен.' : 'Пересчёт отклонён.');
      loadInventory();
    } catch(e){
      showWhToast(e.message);
    }
  }

  /* ===================== Выгрузка в Excel =====================
     Каждый список, который владелец видит на экране, должен уметь стать
     файлом: показать поставщику, отправить бухгалтеру, свести у себя. Файл
     собирается из того, что уже загружено, — второго похода на сервер нет. */

  function saveXlsx(fileName, sheetName, rows, widths){
    if(typeof XLSX === 'undefined'){
      showWhToast('Выгрузка ещё грузится, повторите через секунду.');
      return;
    }
    if(!rows.length){ showWhToast('Выгружать нечего — список пуст.'); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    if(widths) ws['!cols'] = widths.map(w => ({wch: w}));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const stamp = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
    XLSX.writeFile(wb, fileName + ' ' + stamp + '.xlsx');
  }

  // Весь склад: одна строка на «товар в ячейке». Именно в таком виде остатки
  // сверяют с чужой системой — по адресу, а не по итогу.
  function exportWarehouse(){
    const rows = [];
    Object.keys(cellBlocks).forEach(function(rowNum){
      cellBlocks[rowNum].forEach(function(b){
        const addr = cellAddrLabel(rowNum, b);
        if(!b.stock || b.stock.length === 0){
          rows.push({ 'Ячейка': addr, 'Артикул': '', 'Продавец': '', 'Количество': 0,
            'Состояние ячейки': 'пусто' });
          return;
        }
        b.stock.forEach(function(it){
          rows.push({
            'Ячейка': addr,
            'Артикул': it.sku,
            'Продавец': companyNameById(it.companyId) || '',
            'Количество': Number(it.qty || 0),
            'Состояние ячейки': 'занята',
          });
        });
      });
    });
    saveXlsx('Остатки склада', 'Остатки', rows, [14, 18, 24, 13, 17]);
  }

  function cellAddrLabel(rowNum, b){
    const rack = b.r0 === b.r1 ? b.r0 : b.r0 + '–' + b.r1;
    const tier = b.t0 === b.t1 ? b.t0 : b.t0 + '–' + b.t1;
    return rowNum + '.' + rack + '.' + tier;
  }

  function exportCell(blockId){
    const entry = blockById[blockId];
    if(!entry){ showWhToast('Ячейка не найдена.'); return; }
    const addr = cellAddrLabel(entry.rowNum, entry.block);
    const rows = (entry.block.stock || []).map(function(it){
      return {
        'Ячейка': addr,
        'Артикул': it.sku,
        'Продавец': companyNameById(it.companyId) || '',
        'Количество': Number(it.qty || 0),
      };
    });
    if(rows.length === 0){ showWhToast('Ячейка ' + addr + ' пуста — выгружать нечего.'); return; }
    saveXlsx('Ячейка ' + addr, 'Ячейка', rows, [14, 18, 24, 13]);
  }

  function exportInvoices(){
    const statusLabel = {open:'не начата', in_progress:'в процессе', completed:'завершена',
      ready:'собрана', shipped:'отгружена'};
    const dirLabel = {in:'приёмка', out:'отгрузка', return:'возврат'};
    const rows = lastInvoices.map(function(inv){
      return {
        'Номер': inv.number,
        'Продавец': inv.company_name,
        'Направление': dirLabel[inv.direction] || inv.direction || '',
        'Статус': statusLabel[inv.status] || inv.status,
        'Источник': inv.source === 'wb' ? 'Wildberries' : '1С',
        'Создана': inv.created_at ? new Date(inv.created_at).toLocaleString('ru-RU') : '',
      };
    });
    saveXlsx('Накладные', 'Накладные', rows, [18, 24, 13, 13, 13, 18]);
  }

  /* ===================== Инициализация ===================== */

  // Стартовая вкладка открывается тем же путём, что и любая другая, а не
  // классом "active" в разметке: иначе всё, что должно случаться при открытии
  // вкладки, на первой из них молча не случается.
  switchView('chat');

  addInvoiceItemRow();
  loadWarehouseInfo();
  loadStaff();
  loadCompanies().then(loadInvoicesList);
  loadJournal(true).then(startJournalPolling);
  refreshAlertBadge();
  load1CKey();
  load1CStatus();
  loadMarketplaces();
  loadInventory();

  apiFetch('/api/cells/rows').then(rows => {
    if(rows.length > 0){
      document.getElementById('whOnboarding').style.display = 'none';
      renderWarehouseMap();
    }
  }).catch(() => {});
