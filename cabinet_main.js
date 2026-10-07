  const API_BASE = 'https://api.argus-ai.online';
  // Вход — свой у каждой роли (auth.js): вход продавца или грузчика в
  // соседней вкладке больше не выбивает отсюда.
  const AUTH = window.ArgusAuth ? ArgusAuth.get(['owner', 'manager']) : null;
  let TOKEN = AUTH ? AUTH.token : null;
  const ROLE = AUTH ? AUTH.role : null;
  // Кабинет один на владельца и менеджера — по просьбе владельца: у него
  // должны быть те же удобства, а у менеджера урезанные. Урезание делаем
  // здесь ЛИШЬ визуально: то, чего ему нельзя, сервер всё равно не отдаст.
  // Прятать в интерфейсе и не проверять на сервере — вот это было бы дырой.
  const IS_MANAGER = ROLE === 'manager';
  if(!AUTH){
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

  // Продлённый вход берём, только если он того же человека: чужой (из кэша
  // браузера или от другой вкладки) подменил бы вход (27.09.2026).
  function sameUser(a, b){
    const x = decodeJwtPayload(a || ''), y = decodeJwtPayload(b || '');
    const id = (p) => p.staffKeyId || p.sellerKeyId || p.ownerId || '';
    return !!x.role && x.role === y.role && id(x) === id(y) && x.warehouseId === y.warehouseId;
  }

  async function apiFetch(path, options = {}){
    const res = await fetch(API_BASE + path, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    // Сервер продлевает вход, пока человек работает: свежий токен приходит
    // в заголовке — берём его, и выкидывать каждые 45 минут перестаёт.
    const renewed = res.headers.get('X-Argus-Token');
    if(renewed && sameUser(renewed, TOKEN)){
      ArgusAuth.renew(ROLE, TOKEN, renewed);
      TOKEN = renewed;
    }
    if(res.status === 401){
      // Стираем только свой вход: кабинеты других ролей в этом браузере живут дальше.
      ArgusAuth.clear(ROLE, TOKEN);
      window.location.href = 'login.html';
      const error = new Error('сессия истекла');
      error.status = 401;
      throw error;
    }
    const data = await res.json().catch(() => null);
    if(!res.ok){
      const error = new Error((data && data.error) || 'Ошибка запроса');
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function logout(){
    ArgusAuth.clear(ROLE, TOKEN);
    window.location.href = 'login.html';
  }

  const authPayload = decodeJwtPayload(TOKEN);
  if (!IS_MANAGER) fetch(API_BASE + '/api/leads/manage/access', {
    headers: { Authorization: 'Bearer ' + TOKEN }, cache: 'no-store'
  }).then(r => { if (r.ok) document.getElementById('leadAdminLink').style.display = 'block'; }).catch(() => {});

  let warehouseName = '';
  let whSettings = null;   // ответы анкеты склада (GET /api/warehouses/me)

  async function loadWarehouseInfo(){
    try{
      const wh = await apiFetch('/api/warehouses/me');
      whSettings = wh;
      warehouseName = wh.name;
      // Анкета не заполнена — отметка у «Настройки склада».
      const setBadge = document.getElementById('settingsBadge');
      if(setBadge) setBadge.classList.toggle('show', !IS_MANAGER && !wh.setup_at);
      document.getElementById('whSelectLabel').textContent = wh.name + (wh.city ? ' · ' + wh.city : '');
      // Код склада на экране «Сотрудники» до сих пор был из макета — 7734,
      // склада с таким кодом не существует. Владелец читал его как настоящий,
      // и по нему нельзя было понять даже, в каком складе он сейчас сидит.
      const codeChip = document.getElementById('whCodeChip');
      if(codeChip) codeChip.textContent = wh.warehouse_code || '—';
      renderWhStatusLine();
    } catch(e){ /* nothing to show if this fails, sidebar keeps its placeholder */ }
    // Менеджер входит по ключу со своим именем; «Владелец» у него было неправдой.
    const name = authPayload.ownerName || authPayload.name || 'Владелец';
    document.getElementById('accountName').textContent = name;
    document.getElementById('accountRole').textContent = IS_MANAGER ? 'Менеджер склада' : 'Владелец склада';
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

  // Сохраняем старые ID экранов: по ним работают загрузчики, фильтры и ссылки.
  const INNER_PANES = {};
  const GROUP_NAV = { stock: 'products', inbound: 'receipts', configuration: 'settings' };
  const VIEW_KEYS = ['home', 'chat', 'journal', 'orders', 'supplies', 'receipts', 'products', 'warehouse', 'mp', 'staff', '1c', 'inv', 'acts', 'billing', 'settings'];
  function canOpenView(view){
    if(!VIEW_KEYS.includes(view)) return false;
    if(!IS_MANAGER) return true;
    const grants = authPayload.grants || [];
    if(view === 'chat' || view === 'settings') return false;
    if(view === 'warehouse' || view === 'inv') return grants.includes('warehouse');
    if(view === 'mp') return grants.includes('clients') || grants.includes('marketplaces');
    const grant = { staff: 'staff', '1c': 'integration', billing: 'billing' }[view];
    return !grant || grants.includes(grant);
  }
  function navForView(view){
    const group = INNER_PANES[view];
    return GROUP_NAV[group ? group[0] : view] || view;
  }
  function mergePanes(hostId, definitions){
    const panes = definitions.filter(p => canOpenView(p.id) && document.getElementById('view-' + p.id));
    if(!panes.length) return;
    const host = document.createElement('div');
    host.id = 'view-' + hostId;
    host.className = 'view nav-group';
    const first = document.getElementById('view-' + panes[0].id);
    first.parentElement.insertBefore(host, first);
    const wrap = document.createElement('div');
    wrap.className = 'pane-wrap';
    const tabs = document.createElement('div');
    tabs.className = 'pane-tabs nav-pane-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', document.getElementById('nav-' + GROUP_NAV[hostId])?.textContent.trim() || 'Раздел');
    wrap.appendChild(tabs);
    panes.forEach((pane, i) => {
      const body = document.getElementById('view-' + pane.id);
      body.classList.remove('view', 'active');
      body.classList.add('pane-body');
      body.hidden = i !== 0;
      body.setAttribute('role', 'tabpanel');
      body.setAttribute('aria-labelledby', 'tab-' + pane.id);
      INNER_PANES[pane.id] = [hostId, i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'tab-' + pane.id;
      btn.className = 'pane-tab' + (i === 0 ? ' active' : '');
      btn.textContent = pane.title;
      btn.dataset.view = pane.id;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', body.id);
      btn.setAttribute('aria-selected', String(i === 0));
      btn.onclick = () => switchView(pane.id);
      btn.onkeydown = (event) => {
        if(!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...tabs.children];
        const at = buttons.indexOf(btn);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (at + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].click(); buttons[next].focus();
      };
      tabs.appendChild(btn);
      wrap.appendChild(body);
    });
    host.appendChild(wrap);
    host.dataset.panes = panes.length;
    host.dataset.currentView = panes[0].id;
  }

  function showPane(hostId, index){
    const host = document.getElementById('view-' + hostId);
    if(!host || !host.dataset.panes) return;
    const tab = host.querySelectorAll(':scope > .pane-wrap > .pane-tabs > .pane-tab')[index];
    if(tab) switchView(tab.dataset.view);
  }
  window.showPane = showPane;

  // Вкладки, по которым человек прошёл: кнопка «назад» браузера возвращает
  // на прошлую, а не уводит из кабинета на вход (см. back.js).
  const viewTrail = [];
  let currentView = null;
  let warehouseVwStockSession = null;

  function switchView(view, fromBack){
    if(GROUP_NAV[view]){
      view = document.getElementById('view-' + view)?.dataset.currentView;
    }
    if(!canOpenView(view)) return;
    if(view !== 'warehouse' && warehouseVwStockSession) closeWarehouseVwStock(false);
    if(!fromBack && currentView && currentView !== view){
      viewTrail.push(currentView);
      if(viewTrail.length > 50) viewTrail.shift();
    }
    currentView = view;
    // Показываем группу и её выбранный экран, сохраняя исходный маршрут.
    const inner = INNER_PANES[view];
    const hostId = inner ? inner[0] : view;
    document.querySelectorAll('.main > .view').forEach(el => el.classList.toggle('active', el.id === 'view-' + hostId));
    document.querySelectorAll('.nav-group .pane-body').forEach(body => body.classList.remove('active'));
    if(inner){
      const host = document.getElementById('view-' + hostId);
      host.dataset.currentView = view;
      host.querySelectorAll(':scope > .pane-wrap > .pane-body').forEach((body, i) => {
        body.hidden = i !== inner[1]; body.classList.toggle('active', i === inner[1]);
      });
      host.querySelectorAll(':scope > .pane-wrap > .pane-tabs > .pane-tab').forEach((tab, i) => {
        tab.classList.toggle('active', i === inner[1]);
        tab.setAttribute('aria-selected', String(i === inner[1]));
        tab.tabIndex = i === inner[1] ? 0 : -1;
      });
    }
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
      const active = el.id === 'nav-' + navForView(view);
      el.classList.toggle('active', active);
      if(active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    // Приход: свежий список (грузчик мог принять) и панель товаров — на
    // компьютере форма видна сразу, без «+ Приход».
    if(view === 'receipts'){ loadInvoicesList(); openReceiptPicker(); }
    if(view==='journal'){
      journalUnread = 0;
      document.getElementById('navBadge').classList.remove('show');
      // Открыли журнал — сразу свежий, а не то, что было 25 секунд назад.
      loadJournal(false);
    }
    if(view==='home'){ loadHome(); }
    if(view==='mp'){ loadMarketplaces(); }
    if(view==='settings'){ loadSettings(); loadReadiness(); }
    if(view==='1c'){ load1CKey(); load1CStatus(); }
    if(view==='inv'){ loadInventory(); }
    if(view==='orders'){ loadMpOrders(); }
    if(view==='supplies'){ loadSupplies(); }
    if(view==='acts'){ loadActs(); }
    if(view==='billing'){ loadBilling(); }
    if(view==='products'){ openProductsView(); }
    if(view==='chat'){
      loadChatHistory();
      const badge = document.getElementById('chatBadge');
      if(badge) badge.classList.remove('show');
    }
  }

  // Автообновление (владелец 06.10.2026): раз в минуту — экраны-списки, пока
  // вкладка открыта, нет окна поверх и человек ничего не вводит. Журнал
  // обновляется сам, формы (настройки, сотрудники, расчёты) не трогаем.
  setInterval(() => {
    if(document.visibilityState !== 'visible') return;
    const a = document.activeElement;
    if(a && a.matches && a.matches('input, textarea, select, [contenteditable="true"]')) return;
    if(document.querySelector('.ask-overlay, [id$="Modal"].open, #lightbox.open, dialog[open]')) return;
    const y = window.scrollY;
    let again = null;
    if(currentView === 'home') again = loadHome();
    else if(currentView === 'supplies' && document.getElementById('directSupply').hidden) again = loadSupplies();
    else if(currentView === 'orders') again = loadMpOrders();
    else if(currentView === 'receipts') again = loadInvoicesList();
    else if(currentView === 'mp') again = loadMarketplaces();
    else if(currentView === 'acts') again = loadActs();
    else if(currentView === 'products' && !warehouseVwStockSession
      && document.getElementById('productForm')?.hidden !== false) again = productsFor ? loadProducts() : loadSellerStock();
    if(again) Promise.resolve(again).then(() => window.scrollTo(0, y)).catch(() => {});
  }, 60000);

  argusBackButton({
    buttons: '.wh-panel-back, .pr-back',
    fallback: function(){
      const prev = viewTrail.pop();
      if(!prev) return false;
      switchView(prev, true);
      return true;
    },
  });

  // Логотип «Аргус» ведёт туда, куда человек выбрал в меню профиля;
  // по умолчанию — на главную. Прежний выбор сохраняется в
  // этом браузере: это удобство человека, а не настройка склада.
  const LOGO_TARGETS = ['home', 'chat', 'journal', 'orders', 'supplies', 'receipts', 'products', 'mp', 'billing', 'staff', 'settings'];
  // По роли: владелец и менеджер за одним компьютером выбирают каждый своё.
  const LOGO_KEY = 'argus_logo_target_' + ROLE;
  const navName = (v) => {
    const el = document.getElementById('nav-' + navForView(v));
    return el ? (el.querySelector('.nav-name')?.textContent || el.firstChild.nextSibling.textContent).trim() : v;
  };
  function logoTarget(){
    let v = null;
    try{ v = localStorage.getItem(LOGO_KEY); } catch(e){}
    if(v && canOpenView(v) && document.getElementById('nav-' + navForView(v))) return v;
    return 'home';
  }
  function goLogo(){ switchView(logoTarget()); }
  function renderLogoTargets(){
    const now = logoTarget();
    document.getElementById('logoTargetName').textContent = navName(now);
    document.getElementById('logoLink').title = 'Перейти: ' + navName(now);
    document.getElementById('logoTargetList').innerHTML = LOGO_TARGETS
      .filter(v => document.getElementById('nav-' + navForView(v)) && (canOpenView(v) || v === 'settings' && canOpenView('1c')))
      .map(v => v === 'settings' && !canOpenView(v) ? '1c' : v)
      .map(v => '<div class="account-menu-item' + (v === now ? ' on' : '') + '" onclick="setLogoTarget(\'' + v + '\')">'
        + escapeHTML(navName(v)) + '</div>').join('');
  }
  function toggleLogoTargets(){
    renderLogoTargets();
    document.getElementById('logoTargetList').classList.toggle('open');
  }
  function setLogoTarget(v){
    try{ localStorage.setItem(LOGO_KEY, v); } catch(e){}
    renderLogoTargets();
    document.getElementById('logoTargetList').classList.remove('open');
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

  // Причину неудачи пишем ТУДА, ГДЕ должны быть данные, а не во всплывашку:
  // она гаснет через три секунды, и человек остаётся с пустым экраном без
  // единого объяснения — ровно так «сотрудников не видно» и выглядело.
  let staffError = '';
  // Права менеджера — те же ключи, что на сервере (GRANTS в middleware/auth),
  // подписаны словами владельца. Заказы, поставки и журнал открыты менеджеру
  // всегда: это и есть его работа, права — про остальное.
  const GRANT_LABELS = {
    warehouse: ['Склад', 'карта ячеек, зоны, пересчёт'],
    clients: ['Продавцы', 'заводить продавцов и выдавать им ключи'],
    staff: ['Работники', 'выдавать ключи работникам'],
    marketplaces: ['Площадки', 'подключать WB, разрешать менять статусы'],
    integration: ['1С', 'подключать обмен'],
    billing: ['Тариф и деньги', ''],
    shortages: ['Нет товара', 'получать отметки грузчиков «нет товара» со сборки'],
  };
  const grantTitle = (g) => (GRANT_LABELS[g] ? GRANT_LABELS[g][0] : g);

  function grantsChecklist(prefix, selected){
    const on = new Set(selected || []);
    return Object.keys(GRANT_LABELS).map(g => `
      <label class="staff-grant">
        <input type="checkbox" data-grant="${g}" data-for="${escapeHTML(prefix)}" ${on.has(g) ? 'checked' : ''}>
        <span>${escapeHTML(GRANT_LABELS[g][0])}${GRANT_LABELS[g][1] ? `<i>${escapeHTML(GRANT_LABELS[g][1])}</i>` : ''}</span>
      </label>`).join('');
  }
  // Права, через которые менеджер получает чужие данные или ключи входа:
  // включая такое право, руководитель видит крупное предупреждение
  // (владелец 04.10.2026).
  const GRANT_RISK = {
    clients: 'Менеджер сможет заводить продавцов и выдавать им ключи входа. По ключу продавца открывается его кабинет: остатки, заказы, документы.',
    staff: 'Менеджер сможет выдавать и отзывать ключи работников склада — то есть впускать людей на склад в Аргусе.',
    marketplaces: 'Менеджер сможет подключать ключи WB продавцов и разрешать Аргусу менять статусы их заказов на WB.',
    integration: 'Менеджер сможет выдавать ключи обмена с 1С. По такому ключу читаются товары и документы склада.',
    billing: 'Менеджер увидит тарифы и расчёты с продавцами.',
  };
  document.addEventListener('change', async (e) => {
    const box = e.target;
    if(!box.matches || !box.matches('input[data-grant]') || !box.checked || !GRANT_RISK[box.dataset.grant]) return;
    const ok = await askConfirm('Внимание! Вы даёте доступ к разделу «' + grantTitle(box.dataset.grant) + '»\n\n'
      + GRANT_RISK[box.dataset.grant] + '\n\nЭто может привести к утечке данных. Давайте такое право только тому, кому доверяете.');
    if(!ok) box.checked = false;
  });

  function grantsChecked(prefix){
    return [...document.querySelectorAll(`input[data-grant][data-for="${prefix}"]:checked`)].map(i => i.dataset.grant);
  }


  async function loadStaff(){
    staffError = '';
    try{
      staffMembers = await apiFetch('/api/staff');
      if(!Array.isArray(staffMembers)){
        staffError = 'Сервер вернул не список, а ' + typeof staffMembers;
        staffMembers = [];
      }
    } catch(e){
      staffError = e.message;
      staffMembers = [];
    }
    const newGrants = document.getElementById('staffGrantsList');
    if(newGrants && !newGrants.children.length) newGrants.innerHTML = grantsChecklist('new', []);
    renderStaffTable();
  }

  // Отозванные ключи не лежат вперемешку с рабочими (владелец 27.09.2026):
  // в каждом разделе они свёрнуты под строкой «Показать отозванные (N)».
  // Раскрыто или нет — помним, пока открыт кабинет.
  const revokedOpen = { worker: false, manager: false };
  function toggleRevokedStaff(role){
    revokedOpen[role] = !revokedOpen[role];
    renderStaffTable();
  }
  window.toggleRevokedStaff = toggleRevokedStaff;
  const revokedToggleHtml = (count, open, onclick) => count
    ? `<button type="button" class="staff-revoked-toggle${open ? ' open' : ''}" onclick="${onclick}" aria-expanded="${open}">
        <span class="staff-toggle-arrow">▸</span>${open ? 'Скрыть отозванные' : 'Показать отозванные'} (${count})</button>`
    : '';

  // Одна таблица на оба раздела: колонки и действия у них общие, разнится
  // только, кого показываем и что предлагаем сделать.
  function staffTableHtml(rows, role){
    const head = '<div class="staff-row head"><div>Имя</div><div>Ключ</div>'
      + '<div>Выдан</div><div>Статус</div><div></div></div>';
    const active = rows.filter(s => s.active);
    const revoked = rows.filter(s => !s.active);
    const rowHtml = (s) => {
      const issued = new Date(s.issued_at).toLocaleDateString('ru-RU');
      const manager = role === 'manager';
      const rights = (s.permissions || []).map(grantTitle);
      const rightsText = manager
        ? (rights.length ? 'Открыто: ' + rights.join(', ') : 'Только заказы, поставки и журнал')
        : '';
      // Права и роль меняют у рабочего ключа; отозванный можно только вернуть.
      const canEdit = manager && !IS_MANAGER && s.active;
      // Роль ключа меняется без перевыдачи: код у человека остаётся прежним.
      const canPromote = !manager && !IS_MANAGER && s.active;
      return `
        <div class="staff-row ${s.active ? '' : 'revoked'}">
          <div class="staff-name">${escapeHTML(s.name)}
            ${rightsText ? `<div class="staff-rights">${escapeHTML(rightsText)}</div>` : ''}</div>
          <div class="staff-key">${s.active ? keyCopyHtml(s.key_code) : escapeHTML(s.key_code)}</div>
          <div class="staff-date">${issued}</div>
          <div class="staff-state"><span class="staff-status ${s.active ? 'active' : 'revoked'}">${s.active ? 'активен' : 'отозван'}</span></div>
          <div class="staff-actions">
            ${canPromote ? `<button type="button" class="staff-btn" onclick="makeManager('${escapeHTML(s.id)}')">Сделать менеджером</button>` : ''}
            ${canEdit ? `<button type="button" class="staff-btn" onclick="editStaffGrants('${escapeHTML(s.id)}')">Права</button>` : ''}
            <button type="button" class="staff-btn ${s.active ? 'revoke' : 'restore'}" onclick="toggleStaffKey('${escapeHTML(s.id)}')">${s.active ? 'Отозвать' : 'Восстановить'}</button>
          </div>
        </div>
        ${canEdit ? `<div class="staff-row staff-edit" id="staffEdit-${escapeHTML(s.id)}" hidden>
          <div class="staff-grants-title">Права менеджера «${escapeHTML(s.name)}». Вступят в силу при следующем входе.</div>
          <div class="staff-grants-list">${grantsChecklist(s.id, s.permissions || [])}</div>
          <div class="staff-edit-actions">
            <button class="wh-onboarding-btn primary" type="button" onclick="saveStaffGrants('${escapeHTML(s.id)}')">Сохранить права</button>
            <span class="staff-action" onclick="editStaffGrants('${escapeHTML(s.id)}')">Свернуть</span>
          </div>
        </div>` : ''}
      `;
    };
    return (active.length ? head + active.map(rowHtml).join('')
      : '<div class="staff-empty">Рабочих ключей нет — выдайте ключ выше или восстановите отозванный.</div>')
      + revokedToggleHtml(revoked.length, revokedOpen[role], `toggleRevokedStaff('${role}')`)
      + (revokedOpen[role] ? revoked.map(rowHtml).join('') : '');
  }

  function renderStaffTable(){
    const managerColumn = document.querySelector('.staff-managers');
    if(managerColumn) managerColumn.hidden = IS_MANAGER;
    document.querySelector('.staff-columns')?.classList.toggle('staff-workers-only', IS_MANAGER);
    // Менеджеры и кладовщики — разные разделы. Менеджеру список менеджеров
    // сервер не отдаёт вовсе (их ключи — дело владельца), поэтому раздел у
    // него просто пустой, и это честно написано.
    const managerWrap = document.getElementById('managerRows');
    if(managerWrap){
      const managers = staffMembers.filter((s) => s.kind === 'manager');
      const label = document.getElementById('managersToggleLabel');
      if(label){
        label.innerHTML = staffError
          ? 'Менеджеры <span class="staff-toggle-count">— не загрузились</span>'
          : 'Менеджеры <span class="staff-toggle-count">' + staffCountText(managers) + '</span>';
      }
      managerWrap.innerHTML = staffError
        ? '<div class="staff-empty">Не удалось загрузить: ' + escapeHTML(staffError) + '</div>'
        : IS_MANAGER
          ? '<div class="staff-empty">Ключи менеджеров видит только руководитель склада.</div>'
          : managers.length === 0
            ? '<div class="staff-empty">Менеджеров пока нет — выдайте ключ выше.</div>'
            : staffTableHtml(managers, 'manager');
    }

    const wrap = document.getElementById('staffRows');
    if(!wrap){
      // Раньше здесь молча падало исключение: ни строк, ни пустого состояния,
      // ни ошибки — просто пустое место под заголовком.
      showWhToast('Некуда вывести сотрудников: страница загрузилась не полностью. Обновите через Ctrl+Shift+R.');
      return;
    }
    // Счётчик в заголовке — главное здесь. Он берётся из тех же данных, что
    // и строки, поэтому отвечает на вопрос «они вообще приехали?» даже когда
    // список свёрнут и ни одной строки на экране нет.
    const workers = staffMembers.filter((s) => s.kind !== 'manager');
    const label = document.getElementById('staffToggleLabel');
    if(label){
      label.innerHTML = staffError
        ? 'Кладовщики <span class="staff-toggle-count">— не загрузились</span>'
        : 'Кладовщики <span class="staff-toggle-count">' + staffCountText(workers) + '</span>';
    }

    if(staffError){
      wrap.innerHTML = '<div class="staff-empty">Не удалось загрузить кладовщиков: '
        + escapeHTML(staffError) + '</div>';
      return;
    }
    if(workers.length === 0){
      wrap.innerHTML = '<div class="staff-empty">Кладовщиков пока нет — выдайте ключ выше.</div>';
      return;
    }
    // Развернуть сам, если человек только что выдал ключ: иначе он нажимает
    // «сгенерировать» и не видит результата — ровно на это и была жалоба.
    wrap.innerHTML = staffTableHtml(workers, 'worker');
  }

  // Сколько рабочих ключей, и отдельно — сколько отозвано: отозванные в
  // общий счёт не входят, как не входят и в сам список.
  function staffCountText(rows){
    const active = rows.filter(s => s.active).length;
    const revoked = rows.length - active;
    return 'Активных: ' + active + (revoked ? ' · Отозвано: ' + revoked : '');
  }

  // Один сворачиватель на оба списка: работников и продавцов. Второй такой же
  // функцией они бы разъехались в поведении при первой же правке.
  function toggleList(rowsId, btnId, open){
    const rows = document.getElementById(rowsId);
    const btn = document.getElementById(btnId);
    if(!rows || !btn) return;
    const show = (open === undefined) ? rows.hidden : !!open;
    rows.hidden = !show;
    btn.classList.toggle('open', show);
  }
  function toggleStaffList(open){ toggleList('staffRows', 'staffToggle', open); }
  function toggleManagersList(open){ toggleList('managerRows', 'managersToggle', open); }
  window.toggleManagersList = toggleManagersList;
  function toggleCompaniesList(open){ toggleList('companiesList', 'companiesToggle', open); }
  window.toggleStaffList = toggleStaffList;
  window.toggleCompaniesList = toggleCompaniesList;

  function toggleStaffForm(kind, open){
    const manager = kind === 'manager';
    if(manager && IS_MANAGER) return;
    const prefix = manager ? 'staffManagerForm' : 'staffWorkerForm';
    const form = document.getElementById(prefix);
    const button = document.getElementById(prefix + 'Button');
    if(!form || !button) return;
    const show = open === undefined ? form.hidden : !!open;
    form.hidden = !show;
    button.setAttribute('aria-expanded', String(show));
    button.textContent = show ? 'Закрыть форму' : '+ Выдать ключ';
    if(show) document.getElementById(manager ? 'managerNameInput' : 'staffNameInput').focus();
  }
  window.toggleStaffForm = toggleStaffForm;

  // Кладовщик и менеджер заводятся в своих разделах: одна форма с выбором
  // роли трижды подвела — владелец выбирал «Менеджер», а ключ уходил работнику.
  async function addStaffMember(){
    const input = document.getElementById('staffNameInput');
    const name = input.value.trim();
    if(!name){ showWhToast('Введите имя кладовщика.'); return; }
    try{
      const key = await apiFetch('/api/staff', {method:'POST', body:{name, kind:'worker'}});
      input.value = '';
      await loadStaff();
      toggleStaffList(true);
      toggleStaffForm('worker', false);
      showWhToast('Ключ ' + key.key_code + ' выдан кладовщику «' + name + '». '
        + 'Вход по нему откроет приёмку и сборку.');
    } catch(e){
      showWhToast('Не удалось выдать ключ: ' + e.message);
    }
  }

  async function addManager(){
    const input = document.getElementById('managerNameInput');
    const name = input.value.trim();
    if(!name){ showWhToast('Введите имя менеджера.'); return; }
    try{
      const key = await apiFetch('/api/staff', {
        method:'POST', body:{name, kind:'manager', permissions: grantsChecked('new')},
      });
      input.value = '';
      document.querySelectorAll('input[data-grant][data-for="new"]').forEach(i => { i.checked = false; });
      await loadStaff();
      toggleManagersList(true);
      toggleStaffForm('manager', false);
      showWhToast('Ключ ' + key.key_code + ' выдан менеджеру «' + name + '». '
        + 'Вход по нему откроет кабинет с заказами.');
    } catch(e){
      showWhToast('Не удалось выдать ключ: ' + e.message);
    }
  }
  window.addManager = addManager;

  // Ключ выдали работнику, а человек оказался менеджером — так бывает.
  // Отзывать и выдавать новый незачем: код остаётся у человека, меняется роль.
  // Имя — из загруженного списка, а не из кода кнопки: имя, вставленное в
  // onclick, выполнялось как код в кабинете руководителя (проверка 05.10).
  async function makeManager(id){
    const name = ((staffMembers || []).find(s => s.id === id) || {}).name || '';
    if(!await askConfirm('Сделать «' + name + '» менеджером?\n\nКлюч останется прежним, '
      + 'кабинет с заказами откроется при следующем входе. Права можно отметить сразу после.')) return;
    try{
      await apiFetch('/api/staff/' + id + '/kind', {method:'PATCH', body:{kind:'manager', permissions: []}});
      await loadStaff();
      toggleManagersList(true);
      const box = document.getElementById('staffEdit-' + id);
      if(box) box.hidden = false;   // сразу показываем, что можно открыть
      showWhToast('Теперь это менеджер. Отметьте, что ему открыть, и сохраните права.');
    } catch(e){
      showWhToast('Не удалось поменять роль: ' + e.message);
    }
  }
  window.makeManager = makeManager;

  function editStaffGrants(id){
    const box = document.getElementById('staffEdit-' + id);
    if(box) box.hidden = !box.hidden;
  }
  window.editStaffGrants = editStaffGrants;

  async function saveStaffGrants(id){
    try{
      await apiFetch('/api/staff/' + id + '/permissions', {method:'PATCH', body:{permissions: grantsChecked(id)}});
      await loadStaff();
      toggleStaffList(true);
      showWhToast('Права сохранены. Менеджер увидит их при следующем входе.');
    } catch(e){
      showWhToast('Не удалось сохранить права: ' + e.message);
    }
  }
  window.saveStaffGrants = saveStaffGrants;

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
  let oneCMappingCompanyId = null;
  let oneCSearchTimer = null;
  let oneCSearchRequest = 0;

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
    renderMpCards();
    if(document.getElementById('wbWhModal')?.classList.contains('open')) renderSellerPanel();
    renderInvoiceCompanySelect();
    renderMpCompanySelect();
    renderProductsCompanySelects();
    const loadModal = document.getElementById('stockLoadModal');
    if(loadModal && loadModal.classList.contains('open')) renderStockLoad();
  }

  function renderCompaniesList(){
    const wrap = document.getElementById('companiesList');
    if(!wrap) return;
    const label = document.getElementById('companiesToggleLabel');
    if(label){
      // Не «сколько компаний», а сколько из них реально могут войти: продавец
      // с отозванным ключом в кабинет не попадёт, и это стоит видеть не
      // разворачивая список.
      const withKey = companies.filter(c => c.keys.some(k => k.active)).length;
      label.innerHTML = 'Компании <span class="staff-toggle-count">· ' + companies.length
        + (companies.length && withKey < companies.length
            ? ', с доступом ' + withKey : '') + '</span>';
    }
    if(companies.length === 0){
      wrap.innerHTML = '<div class="staff-empty">Компаний пока нет — добавьте первую выше.</div>';
      return;
    }
    wrap.innerHTML = companies.map(c => {
      const oneCName = c.one_c_counterparty_name || '';
      const active = c.keys.filter(k => k.active);
      const revoked = c.keys.filter(k => !k.active);
      const open = sellerRevokedOpen.has(c.id);
      const keyRow = (k) => `
        <div class="staff-row company-row company-key${k.active ? '' : ' revoked'}">
          <div class="staff-date company-key-text">Ключ <span class="staff-key">${k.active ? keyCopyHtml(k.keyCode) : escapeHTML(k.keyCode)}</span>, выдан ${new Date(k.issuedAt).toLocaleDateString('ru-RU')}${k.active ? '' : ' · отозван'}</div>
          <div class="staff-actions"><button type="button" class="staff-btn ${k.active ? 'revoke' : 'restore'}" onclick="toggleSellerKey('${k.id}')">${k.active ? 'Отозвать' : 'Восстановить'}</button></div>
        </div>`;
      return `
      <div class="staff-row company-row">
        <div class="staff-name">${escapeHTML(c.name)}</div>
        <div class="staff-key">${active.length === 0 ? '<span class="staff-date">нет рабочего ключа</span>' : active.map(k => keyCopyHtml(k.keyCode)).join(' ')}</div>
        <button type="button" class="company-1c-link ${c.one_c_external_id ? 'linked' : ''}" onclick="openOneCMapping('${c.id}')">
          <span class="company-1c-dot" aria-hidden="true"></span>
          <span class="company-1c-name">${oneCName ? '1С: ' + escapeHTML(oneCName) : 'Связать с контрагентом 1С'}</span>
        </button>
        <div class="staff-actions"><button type="button" class="staff-btn" onclick="issueSellerKey('${c.id}')">+ Ключ</button></div>
      </div>
      ${active.map(keyRow).join('')}
      ${revokedToggleHtml(revoked.length, open, `toggleRevokedSellerKeys('${c.id}')`)}
      ${open ? revoked.map(keyRow).join('') : ''}
    `;
    }).join('');
  }
  // Отозванные ключи продавца — так же свёрнуты, как у сотрудников.
  const sellerRevokedOpen = new Set();
  function toggleRevokedSellerKeys(companyId){
    if(sellerRevokedOpen.has(companyId)) sellerRevokedOpen.delete(companyId); else sellerRevokedOpen.add(companyId);
    renderCompaniesList();
  }
  window.toggleRevokedSellerKeys = toggleRevokedSellerKeys;

  function renderOneCMappingCurrent(){
    const host = document.getElementById('oneCMapCurrent');
    const company = companies.find(c => c.id === oneCMappingCompanyId);
    if(!host || !company) return;
    document.getElementById('oneCMapTitle').textContent = '1С и «' + company.name + '»';
    host.innerHTML = company.one_c_external_id ? `
      <div class="one-c-map-current">
        <div><span>Сейчас связано</span><strong>${escapeHTML(company.one_c_counterparty_name || 'Контрагент 1С')}</strong></div>
        <button type="button" class="one-c-map-unlink" onclick="unlinkOneCCompany()">Отвязать</button>
      </div>` : '';
  }

  async function searchOneCCounterparties(){
    const companyId = oneCMappingCompanyId;
    if(!companyId) return;
    const host = document.getElementById('oneCMapResults');
    const q = document.getElementById('oneCMapSearch').value.trim();
    const requestId = ++oneCSearchRequest;
    host.innerHTML = '<div class="one-c-map-empty">Ищем в последней выгрузке 1С…</div>';
    try{
      const data = await apiFetch('/api/sellers/1c-counterparties?q=' + encodeURIComponent(q) + '&limit=30');
      if(requestId !== oneCSearchRequest || companyId !== oneCMappingCompanyId) return;
      const rows = data.rows || [];
      if(rows.length === 0){
        host.innerHTML = '<div class="one-c-map-empty">Ничего не найдено. Если список пуст целиком, запустите обновлённый модуль 1С один раз.</div>';
        return;
      }
      host.innerHTML = rows.map(row => {
        const own = row.mapped_company_id === companyId;
        const occupied = row.mapped_company_id && !own;
        const state = own ? 'Связано с этой компанией'
          : occupied ? 'Уже связано: ' + row.mapped_company_name : 'Выбрать';
        return `<button type="button" class="one-c-map-result" data-external-id="${escapeHTML(row.external_id)}" ${occupied ? 'disabled' : ''}>
          <span class="one-c-map-result-name">${escapeHTML(row.name)}</span>
          <span class="one-c-map-result-state">${escapeHTML(state)}</span>
        </button>`;
      }).join('');
      host.querySelectorAll('.one-c-map-result:not(:disabled)').forEach(btn => {
        btn.addEventListener('click', () => mapOneCCompany(btn.dataset.externalId));
      });
    } catch(e){
      if(requestId === oneCSearchRequest){
        host.innerHTML = '<div class="one-c-map-empty">Не удалось загрузить контрагентов: ' + escapeHTML(e.message) + '</div>';
      }
    }
  }

  function openOneCMapping(companyId){
    oneCMappingCompanyId = companyId;
    const modal = document.getElementById('oneCMapModal');
    const input = document.getElementById('oneCMapSearch');
    const company = companies.find(c => c.id === companyId);
    renderOneCMappingCurrent();
    // Название компании — полезная первая подсказка, но пользователь может
    // сразу заменить его любым фрагментом имени из справочника 1С.
    input.value = company ? company.name : '';
    input.oninput = () => {
      clearTimeout(oneCSearchTimer);
      oneCSearchTimer = setTimeout(searchOneCCounterparties, 220);
    };
    modal.classList.add('open');
    searchOneCCounterparties();
    setTimeout(() => input.focus(), 0);
  }
  window.openOneCMapping = openOneCMapping;

  function closeOneCMapping(){
    clearTimeout(oneCSearchTimer);
    oneCMappingCompanyId = null;
    oneCSearchRequest += 1;
    document.getElementById('oneCMapModal').classList.remove('open');
  }
  window.closeOneCMapping = closeOneCMapping;

  async function mapOneCCompany(externalId){
    if(!oneCMappingCompanyId) return;
    try{
      await apiFetch('/api/sellers/companies/' + oneCMappingCompanyId + '/1c-counterparty', {
        method:'PUT', body:{externalId},
      });
      await loadCompanies();
      toggleCompaniesList(true);
      closeOneCMapping();
      showWhToast('Компания связана с 1С. Данные распределятся при следующей синхронизации.');
    } catch(e){
      showWhToast('Не удалось связать компанию: ' + e.message);
    }
  }

  async function unlinkOneCCompany(){
    if(!oneCMappingCompanyId) return;
    try{
      await apiFetch('/api/sellers/companies/' + oneCMappingCompanyId + '/1c-counterparty', {
        method:'PUT', body:{externalId:null},
      });
      await loadCompanies();
      toggleCompaniesList(true);
      closeOneCMapping();
      showWhToast('Связь с контрагентом 1С удалена.');
    } catch(e){
      showWhToast('Не удалось удалить связь: ' + e.message);
    }
  }
  window.unlinkOneCCompany = unlinkOneCCompany;

  window.addEventListener('keydown', (event) => {
    if(event.key === 'Escape' && oneCMappingCompanyId) closeOneCMapping();
  });

  function renderInvoiceCompanySelect(){
    const select = document.getElementById('invoiceCompanySelect');
    const keep = select.value;
    if(companies.length === 0){
      select.innerHTML = '<option value="">Сначала добавьте продавца</option>';
      return;
    }
    select.innerHTML = companies.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
    if(keep && companies.some(c => c.id === keep)) select.value = keep;
    if(currentView === 'receipts') openReceiptPicker();
  }

  async function addCompany(){
    const input = document.getElementById('companyNameInput');
    const name = input.value.trim();
    if(!name){ showWhToast('Введите название продавца.'); return; }
    try{
      const created = await apiFetch('/api/sellers/companies', {method:'POST', body:{name}});
      input.value = '';
      await loadCompanies();
      showWhToast('Продавец «' + name + '» добавлен. Выдайте ему ключ и подключите WB.');
      if(created && created.id) openSellerPanel(created.id);
    } catch(e){
      showWhToast('Не удалось добавить компанию: ' + e.message);
    }
  }

  async function issueSellerKey(companyId){
    try{
      const key = await apiFetch('/api/sellers/companies/' + companyId + '/keys', {method:'POST'});
      await loadCompanies();
      toggleCompaniesList(true);
      showWhToast('Ключ ' + key.key_code + ' выдан. Передайте его продавцу — по нему он войдёт в свой кабинет.');
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

  /* ===================== Приход товара ===================== */

  // Товары прихода — панелью выбора, как у виртуального склада (владелец
  // 06.10.2026): поиск, галочки, протягивание мышью, Excel. Товар выбирают
  // из каталога продавца, а не вписывают: артикул с опечаткой ложился бы
  // в ячейку и никогда не подбирался под заказ.
  let receiptPicker = null, receiptPickerFor = null;
  function openReceiptPicker(){
    const companyId = document.getElementById('invoiceCompanySelect').value;
    if(receiptPicker && receiptPickerFor === companyId) return;
    receiptPicker?.close();
    receiptPicker = null; receiptPickerFor = companyId;
    if(!companyId) return;
    receiptPicker = window.ArgusProductPicker.open({
      host: document.getElementById('receiptPicker'), request: apiFetch, companyId, flat: true,
      maxItems: 1000, templateName: 'Товары прихода', submitLabel: 'Создать приход',
      loadRows: async () => (await apiFetch('/api/sellers/stock?view=seller&companyId=' + encodeURIComponent(companyId))).rows,
      columns: [{ title: 'Всего на складе', value: r => r.total }],
      onSubmit: items => submitReceipt(companyId, items),
    });
  }
  function receiptCompanyChanged(){ openReceiptPicker(); }
  window.receiptCompanyChanged = receiptCompanyChanged;

  // Номер по умолчанию: ПР-ДДММГГ-N, следующий свободный за сегодня. Свой номер
  // (из документов поставщика) можно вписать поверх.
  function suggestReceiptNumber(){
    const field = document.getElementById('invoiceNumberInput');
    if(!field || field.value.trim()) return;
    const d = new Date();
    const prefix = 'ПР-' + String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0')
      + String(d.getFullYear()).slice(2) + '-';
    let n = 1;
    const taken = new Set((lastInvoices || []).concat(lastOutbound || []).map(inv => inv.number));
    while(taken.has(prefix + n)) n += 1;
    field.value = prefix + n;
  }

  // Отгрузка вручную ушла в «Поставки» → «Новая поставка» (владелец
  // 06.10.2026): одна дорога для товара, уезжающего не на WB.
  async function submitReceipt(companyId, items){
    const field = document.getElementById('invoiceNumberInput');
    const number = field.value.trim();
    if(!number){ field.focus(); throw new Error('Впишите номер прихода.'); }
    await apiFetch('/api/invoices', { method: 'POST', body: { companyId, number, direction: 'in',
      items: items.map(i => ({ name: i.name, sku: i.sku, declaredQty: i.qty })) } });
    const units = items.reduce((s, i) => s + i.qty, 0);
    field.value = '';
    receiptPicker?.close(); receiptPicker = null; receiptPickerFor = null;
    toggleReceiptForm(false);
    openReceiptPicker();   // на компьютере форма на виду — сразу чистая панель для следующего
    await loadInvoicesList();
    showWhToast('Приход ' + number + ' создан: ' + units + ' шт. Грузчик увидит его в «Приёмке».');
  }
  function toggleReceiptForm(open){
    const form = document.getElementById('receiptForm');
    const on = form.classList.toggle('open', open);
    document.getElementById('receiptNewBtn').textContent = on ? 'Скрыть форму' : '+ Приход';
    if(on){ openReceiptPicker(); form.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }
  window.toggleReceiptForm = toggleReceiptForm;

  /* ---------- Поставка физлицу из товаров продавца (владелец 06.10.2026) ----------
     «Поставки» → «Новая поставка» → продавец → панель выбора его товаров →
     «Куда / кому». Поставка на WB по-прежнему составляется из заказов. */
  let directSupplyPicker = null;
  function openDirectSupply(){
    const select = document.getElementById('directSupplyCompany');
    const keep = select.value;
    select.innerHTML = companies.length
      ? companies.map(c => '<option value="' + escapeHTML(c.id) + '">' + escapeHTML(c.name) + '</option>').join('')
      : '<option value="">Сначала добавьте продавца</option>';
    if(keep && companies.some(c => c.id === keep)) select.value = keep;
    document.getElementById('directSupply').hidden = false;
    document.getElementById('suppliesList').hidden = true;
    // Номер операции окна: повтор запроса (двойное нажатие, обрыв связи,
    // второй человек с тем же окном) не создаст вторую поставку.
    // randomUUID есть только на https; без него — тот же вид номера из getRandomValues.
    if(!directSupplyRequest) directSupplyRequest = crypto.randomUUID ? crypto.randomUUID()
      : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
    if(!directSupplyPicker || directSupplyPicker.companyId !== select.value) openDirectSupplyPicker();
    document.getElementById('directSupply').scrollIntoView({ block: 'start' });
  }
  let directSupplyRequest = null;
  function closeDirectSupply(){
    directSupplyPicker?.close(); directSupplyPicker = null;
    directSupplyRequest = null;
    document.getElementById('directSupply').hidden = true;
    document.getElementById('suppliesList').hidden = false;
  }
  function openDirectSupplyPicker(){
    const companyId = document.getElementById('directSupplyCompany').value;
    directSupplyPicker?.close(); directSupplyPicker = null;
    if(!companyId) return;
    directSupplyPicker = window.ArgusProductPicker.open({
      host: document.getElementById('directSupplyPicker'), request: apiFetch, companyId,
      maxItems: 500, templateName: 'Товары поставки', submitLabel: 'Создать поставку',
      loadRows: async () => (await apiFetch('/api/sellers/stock?view=seller&companyId=' + encodeURIComponent(companyId))).rows,
      columns: [{ title: 'Всего', value: r => r.total }, { title: 'Доступно', value: r => r.available }],
      limit: r => r.available, defaultQty: () => '1',
      onSubmit: items => submitDirectSupply(companyId, items),
    });
    directSupplyPicker.companyId = companyId;
  }
  async function submitDirectSupply(companyId, items){
    const where = document.getElementById('directSupplyWhere');
    const destination = where.value.trim();
    if(!destination){ where.focus(); throw new Error('Впишите, куда и кому едет поставка.'); }
    // Больше доступного по учёту — можно (учёт бывает неточным), но сначала спросить.
    const over = items.filter(i => i.limit != null && i.qty > i.limit);
    if(over.length && !await askConfirm('Больше, чем доступно по учёту: '
      + over.slice(0, 5).map(i => '«' + i.name + '» — ' + i.qty + ' из ' + i.limit).join(', ')
      + (over.length > 5 ? ' и ещё ' + (over.length - 5) : '') + '.\n\nСоздать поставку всё равно? Если товара на полке не окажется, грузчик отметит нехватку.')) return;
    const date = document.getElementById('directSupplyDate');
    const created = await apiFetch('/api/supplies/direct', { method: 'POST', body: { companyId, destination,
      shipDate: date.value || null, items: items.map(i => ({ sku: i.sku, qty: i.qty })), requestId: directSupplyRequest } });
    const units = items.reduce((s, i) => s + i.qty, 0);
    where.value = ''; date.value = '';
    closeDirectSupply();
    await loadSupplies();
    showWhToast('Поставка ' + created.number + ' создана: ' + units + ' шт. — ' + destination + '. Грузчик увидит её в «Сборке поставок».');
  }
  Object.assign(window, { openDirectSupply, closeDirectSupply, openDirectSupplyPicker });

  let lastInvoices = [];
  let lastOutbound = [];

  // Только приходы: заказы площадок и возвраты живут на своих экранах, а
  // здесь их тысячи — список прихода в них тонул.
  async function loadInvoicesList(){
    const wrap = document.getElementById('invoicesList');
    if(!wrap) return;
    try{
      [lastInvoices, lastOutbound] = await Promise.all([
        apiFetch('/api/invoices?direction=in'),
        apiFetch('/api/invoices?direction=out&source=1c').catch(() => []),
      ]);
    } catch(e){
      wrap.innerHTML = '<div class="staff-empty">Не удалось загрузить приходы: ' + escapeHTML(e.message) + '</div>';
      return;
    }
    suggestReceiptNumber();
    renderReceiptsList();
    renderOutboundList();
  }

  // Отгрузки не через маркетплейс — вручную и из 1С: в работе и уехавшие
  // за две недели. Закрывает грузчик: «Отгрузили — машина уехала».
  const OUT_STATE = { open: ['ждёт сборки', 'wait'], in_progress: ['собирается', 'busy'],
    ready: ['собрана, ждёт машину', 'arrived'], shipped: ['уехала', 'active'] };
  function renderOutboundList(){
    const wrap = document.getElementById('outboundList');
    if(!wrap) return;
    const fresh = Date.now() - 14 * 864e5;
    const rows = (lastOutbound || []).filter(i => i.source === '1c' && !i.supply_id
      && (i.status !== 'shipped' || new Date(i.shipped_at || i.created_at).getTime() > fresh));
    wrap.hidden = !rows.length;
    wrap.innerHTML = rows.length
      ? '<div class="rc-list-head"><div class="staff-title" style="font-size:17px; margin:0;">Отгрузки вручную и из 1С</div>'
        + '<span class="ord-meta">в работе и уехавшие за 2 недели</span></div>'
        + '<div class="staff-table rc-table"><div class="staff-row head rc-row-list"><div>Отгрузка</div><div>Продавец</div><div>Откуда и когда</div><div>Статус</div><div></div></div>'
        + rows.map(inv => {
          const [text, badge] = OUT_STATE[inv.status] || [inv.status, 'wait'];
          return '<div class="staff-row rc-row-list">'
            + '<div class="rc-cell-num"><span class="staff-key">' + escapeHTML(inv.number) + '</span></div>'
            + '<div class="staff-name">' + escapeHTML(inv.company_name) + '</div>'
            + '<div class="rc-cell-src"><div>' + (inv.external_id ? 'из 1С' : 'вручную') + ' · ' + escapeHTML(fmtDay(inv.created_at)) + '</div></div>'
            + '<div class="rc-cell-state"><span class="staff-status ' + badge + '">' + escapeHTML(text) + '</span></div>'
            + '<div class="rc-acts"><span class="staff-action" data-history-invoice="' + escapeHTML(inv.id) + '" data-history-label="' + escapeHTML(inv.number) + '">История</span></div>'
            + '</div>';
        }).join('') + '</div>'
      : '';
  }

  /* Список приходов (владелец 27.09.2026): поиск по номеру, продавцу,
     перевозчику, машине и номеру документа поставщика; фильтры — продавец,
     статус, откуда, период; порядок — как у грузчика: машина приехала,
     привезут сегодня, остальные привозы продавцов, из 1С и вручную, затем
     принятые; внутри — новые выше. Список не тонет в старых приходах:
     по 30 строк и «Показать ещё». Заказы поставщику из 1С — не привоз:
     они видны только под «Откуда: из 1С». */
  const RC_PAGE = 30;
  const rcUi = { q: '', seller: '', status: 'all', origin: 'all', period: 'all', shown: RC_PAGE, open: null };
  const RC_STATUS = [['all', 'Все'], ['waiting', 'Ждёт машину'], ['arrived', 'Приехала'], ['receiving', 'Принимается'],
    ['done', 'Принят'], ['diff', 'Есть расхождение'], ['disputed', 'Продавец не согласен']];
  const RC_ORIGIN = [['all', 'Все'], ['seller', 'От продавца'], ['1c', 'Из 1С'], ['manual', 'Вручную']];
  const RC_PERIOD = [['all', 'Всё время'], ['1', 'Сегодня'], ['7', '7 дней'], ['30', '30 дней'], ['90', '90 дней']];
  const rcDayKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const rcPlannedDay = (i) => i.source_document_type === 'seller_inbound' && i.source_document_date
    ? String(i.source_document_date).slice(0, 10) : '';
  // Из 1С — то, что пришло обменом (у него номер в 1С); заведённое в кабинете — вручную.
  const rcOrigin = (i) => i.source_document_type === 'seller_inbound' ? 'seller' : i.external_id ? '1c' : 'manual';
  const rcLive = (i) => i.work && i.work.assembly && (i.work.assembly.status === 'active' || i.work.assembly.status === 'paused')
    ? i.work.assembly : null;
  function rcState(i){
    if(i.status === 'completed') return 'done';
    if(i.status === 'in_progress' || rcLive(i)) return 'receiving';
    if(i.arrived_at) return 'arrived';
    return 'waiting';
  }
  function rcRank(i){
    const st = rcState(i);
    if(st === 'done') return 9;
    if(st === 'arrived' || st === 'receiving') return 0;
    if(rcPlannedDay(i) === rcDayKey(new Date())) return 1;
    return rcOrigin(i) === 'seller' ? 2 : 3;
  }
  const rcTime = (v) => (v ? new Date(v).getTime() || 0 : 0);
  function rcCompare(a, b){
    const ra = rcRank(a), rb = rcRank(b);
    if(ra !== rb) return ra - rb;
    if(ra === 0){
      const ka = a.arrived_at || (rcLive(a) && rcLive(a).startedAt) || a.created_at;
      const kb = b.arrived_at || (rcLive(b) && rcLive(b).startedAt) || b.created_at;
      return rcTime(kb) - rcTime(ka);
    }
    if(ra === 1){
      const fa = String(a.planned_from || a.planned_to || '99:99'), fb = String(b.planned_from || b.planned_to || '99:99');
      if(fa !== fb) return fa < fb ? -1 : 1;
    }
    return rcTime(b.created_at) - rcTime(a.created_at);
  }
  const rcFold = (t) => String(t || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  function rcMatches(i){
    // Заказ поставщику — только под «Откуда: из 1С».
    if(i.source_document_type === 'supplier_order' && rcUi.origin !== '1c') return false;
    if(rcUi.seller && i.company_id !== rcUi.seller) return false;
    if(rcUi.origin !== 'all' && rcOrigin(i) !== rcUi.origin) return false;
    const st = rcState(i);
    if(rcUi.status === 'diff' ? !(st === 'done' && i.has_discrepancy)
      : rcUi.status === 'disputed' ? i.seller_verdict !== 'disputed'
      : rcUi.status !== 'all' && st !== rcUi.status) return false;
    if(rcUi.period !== 'all'){
      const days = Number(rcUi.period);
      const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (days - 1));
      if(rcTime(i.created_at) < from.getTime()) return false;
    }
    const q = rcFold(rcUi.q);
    if(!q) return true;
    const hay = rcFold([i.number, i.company_name, i.carrier, i.vehicle, i.supplier_docs].filter(Boolean).join(' '));
    return q.split(' ').every(w => hay.includes(w));
  }
  function rcFiltered(){ return (lastInvoices || []).filter(rcMatches).sort(rcCompare); }

  // Выпадающий список фильтра — своё меню, а не выпадающий список браузера.
  function rcDropdown(name, label, options){
    const cur = options.find(o => o[0] === rcUi[name]) || options[0];
    return '<span class="rc-dd' + (rcUi.open === name ? ' open' : '') + '">'
      + '<button type="button" class="ord-chip rc-dd-btn' + (cur[0] !== options[0][0] ? ' set' : '') + '" data-rc-dd="' + name + '"'
      +   ' aria-haspopup="true" aria-expanded="' + (rcUi.open === name) + '">' + escapeHTML(label) + ': <b>' + escapeHTML(cur[1]) + '</b> ▾</button>'
      + '<span class="rc-dd-menu"' + (rcUi.open === name ? '' : ' hidden') + ' role="menu">'
      +   options.map(o => '<button type="button" role="menuitemradio" aria-checked="' + (o[0] === cur[0]) + '" class="rc-dd-item'
          + (o[0] === cur[0] ? ' on' : '') + '" data-rc-set="' + name + '" data-value="' + escapeHTML(o[0]) + '">' + escapeHTML(o[1]) + '</button>').join('')
      + '</span></span>';
  }

  function receiptPlaces(boxes, pallets){
    return [boxes ? boxes + ' ' + pluralRu(boxes, 'короб', 'короба', 'коробов') : '',
      pallets ? pallets + ' ' + pluralRu(pallets, 'паллета', 'паллеты', 'паллет') : ''].filter(Boolean).join(', ');
  }
  function receiptSlot(from, to){
    const f = from ? String(from).slice(0, 5) : ''; const t = to ? String(to).slice(0, 5) : '';
    return f && t ? f + '–' + t : f ? 'с ' + f : t ? 'до ' + t : '';
  }
  function receiptWhen(date, from, to){
    const d = date ? String(date).slice(0, 10).split('-').reverse().slice(0, 2).join('.') : '';
    const slot = receiptSlot(from, to);
    return d + (slot ? ', время выгрузки ' + slot : '');
  }
  function receiptState(inv){
    if(inv.status === 'completed') return 'принят';
    if(inv.status === 'in_progress' || rcLive(inv)) return 'принимается';
    if(inv.arrived_at) return 'машина приехала';
    return inv.source_document_type === 'seller_inbound' ? 'ждёт машину' : 'не начат';
  }
  const rcShortWhen = (d) => (d ? new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

  function renderReceiptsList(){
    const wrap = document.getElementById('invoicesList');
    if(!wrap) return;
    const all = (lastInvoices || []).filter(i => i.source_document_type !== 'supplier_order');
    const waiting = all.filter(inv => inv.status !== 'completed').length;
    document.getElementById('receiptsSummary').textContent = all.length
      ? 'всего ' + all.length + ' · ждут приёмки ' + waiting : '';
    const sellers = [...new Map((lastInvoices || []).map(i => [i.company_id, i.company_name])).entries()]
      .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'ru'));
    const rows = rcFiltered();
    const page = rows.slice(0, rcUi.shown);
    const filtered = rcUi.q || rcUi.seller || rcUi.status !== 'all' || rcUi.origin !== 'all' || rcUi.period !== 'all';
    const keep = document.activeElement && document.activeElement.id === 'rcSearch' ? document.activeElement.selectionStart : null;
    const toolbar = '<div class="rc-toolbar">'
      + '<input type="search" class="ord-search rc-search" id="rcSearch" placeholder="Номер, продавец, перевозчик, машина, документ поставщика"'
      +   ' value="' + escapeHTML(rcUi.q) + '" aria-label="Поиск прихода" autocomplete="off">'
      + rcDropdown('seller', 'Продавец', [['', 'Все']].concat(sellers.map(([id, name]) => [id, name])))
      + rcDropdown('status', 'Статус', RC_STATUS)
      + rcDropdown('origin', 'Откуда', RC_ORIGIN)
      + rcDropdown('period', 'Период', RC_PERIOD)
      + (filtered ? '<button type="button" class="rc-reset" data-rc-reset="1">Сбросить</button>' : '')
      + '</div>';
    const head = '<div class="staff-row head rc-row-list"><div>Приход</div><div>Продавец</div><div>Откуда и когда</div><div>Статус</div><div></div></div>';
    const body = page.map(inv => {
      const origin = rcOrigin(inv);
      const src = origin === 'seller'
        ? 'от продавца' + (inv.source_document_date ? ' · привезут ' + escapeHTML(receiptWhen(inv.source_document_date, inv.planned_from, inv.planned_to)) : '')
        : (inv.source_document_type === 'supplier_order' ? 'заказ поставщику, из 1С' : origin === '1c' ? 'из 1С' : 'вручную')
          + ' · ' + escapeHTML(fmtDay(inv.created_at));
      const more = [receiptPlaces(inv.boxes, inv.pallets), [inv.carrier, inv.vehicle ? 'машина ' + inv.vehicle : ''].filter(Boolean).join(', '),
        inv.supplier_docs ? 'документ: ' + inv.supplier_docs : ''].filter(Boolean).join(' · ');
      const flags = [
        inv.comment_count ? 'переписка: ' + inv.comment_count : '',
        inv.seller_verdict === 'disputed' ? '<span class="rc-flag-bad">продавец не согласен с актом</span>' : '',
      ].filter(Boolean).join(' · ');
      const st = rcState(inv);
      const live = rcLive(inv);
      const work = inv.work && inv.work.assembly;
      const workText = live
        ? (live.status === 'paused' ? 'на паузе · ' : '') + escapeHTML(live.workerName) + ' · ' + inv.work.taken + ' из ' + inv.work.total
        : st === 'arrived' ? 'приехала ' + escapeHTML(rcShortWhen(inv.arrived_at))
        : work && work.status === 'abandoned' ? 'свободен · ' + inv.work.taken + ' из ' + inv.work.total : '';
      const badge = st === 'done' ? (inv.has_discrepancy ? 'bad' : 'active') : st === 'arrived' ? 'arrived' : st === 'receiving' ? 'busy' : 'wait';
      return '<div class="staff-row rc-row-list' + (st === 'arrived' ? ' rc-arrived' : '') + '" data-invoice-id="' + escapeHTML(inv.id) + '">'
        + '<div class="rc-cell-num"><span class="staff-key">' + escapeHTML(inv.number) + '</span>' + (flags ? '<div class="rc-src">' + flags + '</div>' : '') + '</div>'
        + '<div class="staff-name">' + escapeHTML(inv.company_name) + '</div>'
        + '<div class="rc-cell-src"><div>' + src + '</div>' + (more ? '<div class="rc-src">' + escapeHTML(more) + '</div>' : '') + '</div>'
        + '<div class="rc-cell-state"><span class="staff-status ' + badge + '">' + escapeHTML(receiptState(inv))
        +   (st === 'done' && inv.has_discrepancy ? ' · расхождение' : '') + '</span>'
        +   (workText ? '<div class="rc-src">' + workText + '</div>' : '') + '</div>'
        + '<div class="rc-acts"><span class="staff-action" data-receipt-open="' + escapeHTML(inv.id) + '">Открыть</span>'
        +   '<span class="staff-action" data-history-invoice="' + escapeHTML(inv.id) + '" data-history-label="' + escapeHTML(inv.number) + '">История</span></div>'
        + '</div>';
    }).join('');
    wrap.innerHTML = toolbar
      + (page.length
        ? '<div class="staff-table rc-table">' + head + body + '</div>'
          + '<div class="rc-foot"><span class="ord-meta">Показано ' + page.length + ' из ' + rows.length + '</span>'
          + (rows.length > page.length ? '<button type="button" class="wh-onboarding-btn" data-rc-more="1">Показать ещё '
            + Math.min(RC_PAGE, rows.length - page.length) + '</button>' : '') + '</div>'
        : '<div class="staff-empty">' + (filtered ? 'Под этот поиск и фильтры приходов нет.' : 'Приходов пока нет.') + '</div>');
    const box = document.getElementById('rcSearch');
    box.oninput = () => { rcUi.q = box.value; rcUi.shown = RC_PAGE; renderReceiptsList(); };
    if(keep != null){ box.focus(); box.setSelectionRange(keep, keep); }
  }

  // Меню фильтров, «Показать ещё», «Сбросить» — одним обработчиком.
  document.addEventListener('click', function(e){
    const t = e.target.closest ? e.target : null;
    if(!t) return;
    const dd = t.closest('[data-rc-dd]');
    if(dd){ rcUi.open = rcUi.open === dd.dataset.rcDd ? null : dd.dataset.rcDd; renderReceiptsList(); return; }
    const set = t.closest('[data-rc-set]');
    if(set){ rcUi[set.dataset.rcSet] = set.dataset.value; rcUi.open = null; rcUi.shown = RC_PAGE; renderReceiptsList(); return; }
    if(t.closest('[data-rc-more]')){ rcUi.shown += RC_PAGE; renderReceiptsList(); return; }
    if(t.closest('[data-rc-reset]')){
      Object.assign(rcUi, { q: '', seller: '', status: 'all', origin: 'all', period: 'all', shown: RC_PAGE, open: null });
      renderReceiptsList(); return;
    }
    if(rcUi.open && !t.closest('.rc-dd')){ rcUi.open = null; renderReceiptsList(); }
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && rcUi.open){ rcUi.open = null; renderReceiptsList(); }
  });

  /* ===================== Карточка прихода =====================
     Привоз продавца (владелец 26.09.2026): когда и сколько мест, отметка
     «машина приехала», документы поставщика, переписка с продавцом и его
     ответ на акт расхождений. Данные — /api/inbound/:id. */
  const rcWhen = (d) => (d ? new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

  let receiptOpenId = null;
  async function openReceipt(id){
    receiptOpenId = id;
    document.getElementById('receiptModal').classList.add('open');
    document.getElementById('receiptTitle').textContent = 'Приход';
    document.getElementById('receiptBody').innerHTML = '<div class="staff-empty">Загружаем…</div>';
    await renderReceipt();
  }
  window.openReceipt = openReceipt;
  function closeReceipt(){
    document.getElementById('receiptModal').classList.remove('open');
    receiptOpenId = null;
    loadInvoicesList();
  }
  window.closeReceipt = closeReceipt;

  async function renderReceipt(){
    const id = receiptOpenId;
    const box = document.getElementById('receiptBody');
    let c;
    try{ c = await apiFetch('/api/inbound/' + encodeURIComponent(id)); }
    catch(e){ if(id === receiptOpenId) box.innerHTML = '<div class="staff-empty">Не удалось открыть: ' + escapeHTML(e.message) + '</div>'; return; }
    // Склады продавца: у строки прихода виден её склад, до приёмки строки его
    // можно поменять (виртуальные склады, 02.10.2026).
    let vws = null;
    try{ vws = (await vwOf(c.companyId)).warehouses; } catch(_){}
    if(id !== receiptOpenId) return;
    const keep = box.scrollTop;
    document.getElementById('receiptTitle').textContent = 'Приход ' + c.number + ' · ' + c.companyName;
    // Кто принимает и где остановился — из списка приходов (ход приёмки).
    const row = (lastInvoices || []).find(i => i.id === c.id);
    const work = row && row.work && row.work.assembly ? row.work : null;
    const workText = work ? ({ active: 'идёт', paused: 'на паузе', abandoned: 'брошена — продолжит любой грузчик', finished: 'закончена' }[work.assembly.status] || '')
      + ' · ' + work.assembly.workerName + ' · принято ' + work.taken + ' из ' + work.total + ' ' + pluralRu(work.total, 'позиции', 'позиций', 'позиций')
      + (work.lastComment ? ' · «' + work.lastComment.text + '»' : '') : '';
    const facts = [
      ['Статус', receiptState(Object.assign({ status: c.status, arrived_at: c.arrivedAt, source_document_type: c.sellerInbound ? 'seller_inbound' : '' }, row ? { work: row.work } : {}))],
      workText ? ['Приёмка', workText] : null,
      c.plannedDate ? ['Привезут', receiptWhen(c.plannedDate)] : null,
      // «Время выгрузки» — время у ворот склада (владелец 27.09.2026; раньше
      // называлось «окно выгрузки»).
      c.plannedDate && receiptSlot(c.plannedFrom, c.plannedTo) ? ['Время выгрузки', receiptSlot(c.plannedFrom, c.plannedTo)] : null,
      receiptPlaces(c.boxes, c.pallets) ? ['Мест заявлено', receiptPlaces(c.boxes, c.pallets)] : null,
      c.weightKg != null ? ['Вес', c.weightKg.toLocaleString('ru-RU') + ' кг'] : null,
      c.carrier || c.vehicle ? ['Кто везёт', [c.carrier, c.vehicle ? 'машина ' + c.vehicle : ''].filter(Boolean).join(', ')] : null,
      c.comment ? ['Комментарий продавца', c.comment] : null,
      ['Заявлено', c.declared.toLocaleString('ru-RU') + ' шт.'],
      c.accepted != null ? ['Принято', c.accepted.toLocaleString('ru-RU') + ' шт.' + (c.unplaced ? ' (без ячейки: ' + c.unplaced.toLocaleString('ru-RU') + ')' : '')] : null,
    ].filter(Boolean);
    let arrival = '';
    if(c.arrivedAt){
      arrival = '<div class="rc-card-note">Машина приехала ' + escapeHTML(rcWhen(c.arrivedAt))
        + (receiptPlaces(c.arrivedBoxes, c.arrivedPallets) ? ' · мест: ' + escapeHTML(receiptPlaces(c.arrivedBoxes, c.arrivedPallets)) : '') + '</div>';
    } else if(c.status !== 'completed'){
      arrival = '<div class="rc-arrive"><b>Машина приехала?</b> Пересчитайте места при выгрузке.'
        + '<div class="rc-arrive-row"><label>Коробов <input id="arrBoxes" inputmode="numeric" maxlength="6" value="' + escapeHTML(c.boxes ?? '') + '"></label>'
        + '<label>Паллет <input id="arrPallets" inputmode="numeric" maxlength="6" value="' + escapeHTML(c.pallets ?? '') + '"></label>'
        + '<button type="button" class="wh-onboarding-btn primary" onclick="markReceiptArrived()">Отметить приезд</button></div></div>';
    }
    const diffLines = c.lines.filter(l => l.accepted != null && l.accepted !== l.declared);
    let verdict = '';
    if(c.status === 'completed' && c.discrepancy){
      verdict = '<div class="rc-card-note ' + (c.verdict && c.verdict.value === 'agreed' ? '' : 'bad') + '">Расхождение '
        + (c.discrepancy > 0 ? '+' : '−') + Math.abs(c.discrepancy).toLocaleString('ru-RU') + ' шт. — '
        + (c.verdict ? (c.verdict.value === 'agreed' ? 'продавец согласен с актом' : 'продавец НЕ согласен с актом')
            + (c.verdict.note ? ': «' + escapeHTML(c.verdict.note) + '»' : '') + ' (' + escapeHTML(rcWhen(c.verdict.at)) + ')'
          : 'продавец ещё не ответил на акт')
        + '</div>'
        + (diffLines.length ? '<div class="rc-diff">' + diffLines.map(l => escapeHTML(l.name) + ': заявлено ' + l.declared + ', принято ' + l.accepted).join('<br>') + '</div>' : '');
    }
    const docs = c.documents.length
      ? c.documents.map(d => '<div class="rc-doc"><div><b>' + escapeHTML([d.kind, d.number ? '№ ' + d.number : '', d.date ? 'от ' + d.date : ''].filter(Boolean).join(' ')) + '</b>'
          + '<div class="rc-src">' + escapeHTML([d.supplier, d.addedBy === 'seller' ? 'добавил продавец' : 'добавил склад', d.fileName || 'без файла'].filter(Boolean).join(' · ')) + '</div></div>'
          + '<div class="rc-acts">' + (d.fileName ? '<span class="staff-action" onclick="openReceiptFile(\'' + d.id + '\')">Открыть файл</span>' : '')
          + '<span class="staff-action" onclick="removeReceiptDoc(\'' + d.id + '\')">Убрать</span></div></div>').join('')
      : '<div class="rc-src">Продавец не приложил документов поставщика.</div>';
    const talk = (c.comments.length
      ? c.comments.map(m => '<div class="rc-msg ' + (m.authorRole === 'seller' ? '' : 'mine') + '"><div class="rc-src"><b>' + escapeHTML(m.authorName || '') + '</b> · '
          + escapeHTML(rcWhen(m.createdAt)) + (m.productName ? ' · о товаре «' + escapeHTML(m.productName) + '»' : '') + '</div>' + escapeHTML(m.body) + '</div>').join('')
      : '<div class="rc-src">Переписки пока нет.</div>')
      + '<div class="rc-reply"><select id="rcAbout"><option value="">Весь приход</option>'
      + c.lines.map(l => '<option value="' + escapeHTML(l.sku) + '">' + escapeHTML(l.name) + '</option>').join('') + '</select>'
      + '<textarea id="rcBody" rows="3" maxlength="1000" placeholder="Ответ продавцу — он увидит его в своём кабинете"></textarea>'
      + '<button type="button" class="wh-onboarding-btn primary" onclick="sendReceiptComment()">Отправить продавцу</button></div>';
    box.innerHTML = '<dl class="rc-facts">' + facts.map(f => '<dt>' + escapeHTML(f[0]) + '</dt><dd>' + escapeHTML(f[1]) + '</dd>').join('') + '</dl>'
      + arrival + verdict
      + receiptVwHtml(c, vws)
      + itemNotesHtml(c.notes, 'rc')
      + '<div class="rc-section">Документы поставщика</div>' + docs
      + '<div class="rc-section">Переписка с продавцом</div>' + talk
      + '<div class="rc-bottom"><span class="staff-action" onclick="window.open(\'act_print.html?kind=receipt&id=' + encodeURIComponent(c.id) + '\', \'_blank\')">Акт приёмки' + (c.discrepancy ? ' и расхождений' : '') + '</span>'
      + '<span class="staff-action" data-history-invoice="' + escapeHTML(c.id) + '" data-history-label="' + escapeHTML(c.number) + '" onclick="closeReceipt()">История в журнале</span></div>';
    box.scrollTop = keep;
  }

  // Строки прихода по складам продавца. Строку ещё не принимали — склад
  // меняется; принятую — уже нет (товар в ячейках числится за складом).
  function receiptVwHtml(c, vws){
    if(!vws || !vws.length) return '';
    const name = (vw) => vw ? ((vws.find(w => w.id === vw) || {}).name || 'убранный склад') : 'Остальной товар';
    const open = c.status !== 'completed';
    return '<div class="rc-section">Склады продавца</div>'
      + c.lines.map(l => '<div class="rc-vw-line"><span>' + escapeHTML(l.name || l.sku) + '<span class="rc-src"> · ' + nfmt(l.declared) + ' шт.</span></span>'
        + (open && l.accepted == null
          ? '<select class="mp-field" aria-label="Склад строки" onchange="setReceiptLineVw(\'' + l.id + '\', this.value, this)">'
            + vws.concat([{ id: null, name: 'Остальной товар' }]).map(w => '<option value="' + (w.id || 'main') + '"' + ((w.id || null) === (l.vw || null) ? ' selected' : '') + '>'
              + escapeHTML(w.name) + '</option>').join('') + '</select>'
          : '<b>' + escapeHTML(name(l.vw)) + '</b>')
        + '</div>').join('');
  }
  async function setReceiptLineVw(itemId, value, el){
    el.disabled = true;
    try{
      await apiFetch('/api/vwarehouses/items', { method: 'POST', body: { itemIds: [itemId], vw: value === 'main' ? null : value } });
      showWhToast('Склад строки поменян — продавцу пришло уведомление.');
    } catch(e){ showWhToast(e.message); }
    renderReceipt();
  }
  window.setReceiptLineVw = setReceiptLineVw;

  // Записки грузчиков о товаре (третье задание 27.09.2026) — в карточке
  // прихода и поставки: ждущие — с «Принял к сведению», отмеченные — кем и
  // когда. То же нажатие, что в журнале.
  function itemNotesHtml(notes, where){
    if(!notes || !notes.length) return '';
    const waiting = notes.filter(n => !n.answered).length;
    return '<div class="rc-section">Грузчики пишут о товаре' + (waiting ? ' · ждёт ответа: ' + waiting : '') + '</div>'
      + notes.map(n => '<div class="rc-wnote' + (n.answered ? ' done' : '') + '">'
        + '<div class="rc-src"><b>' + escapeHTML(n.workerName || 'Грузчик') + '</b> · ' + escapeHTML(rcWhen(n.at))
        + ' · о товаре «' + escapeHTML(n.productName || n.sku || '') + '»</div>'
        + '<div class="rc-wnote-text">' + escapeHTML(n.text) + '</div>'
        + (n.answered
          ? '<div class="rc-src">Принял к сведению ' + escapeHTML(n.answered.by) + ', ' + escapeHTML(rcWhen(n.answered.at)) + '</div>'
          : '<span class="staff-action" onclick="ackItemNote(\'' + escapeHTML(n.entryId) + '\', \'' + where + '\')">Принял к сведению</span>')
        + '</div>').join('');
  }

  async function ackItemNote(entryId, where){
    try{
      await apiFetch('/api/journal/' + entryId + '/resolve', { method: 'POST', body: { resolution: 'ack' } });
      showWhToast('Отмечено: принято к сведению');
      if(where === 'rc') renderReceipt();
      else if(where) {
        try{ supplyInside[where] = await apiFetch('/api/supplies/' + where); } catch(_){}
        renderSupplies();
      }
      if(document.getElementById('view-journal')?.classList.contains('active')) loadJournal();
    } catch(e){ showWhToast('Не отмечено: ' + e.message); }
  }
  window.ackItemNote = ackItemNote;

  async function markReceiptArrived(){
    try{
      await apiFetch('/api/inbound/' + encodeURIComponent(receiptOpenId) + '/arrived', { method: 'POST',
        body: { boxes: document.getElementById('arrBoxes').value.trim() || null, pallets: document.getElementById('arrPallets').value.trim() || null } });
      showWhToast('Приезд машины отмечен');
      renderReceipt();
    } catch(e){ showWhToast('Не отмечено: ' + e.message); }
  }
  window.markReceiptArrived = markReceiptArrived;

  async function sendReceiptComment(){
    const body = document.getElementById('rcBody').value.trim();
    if(!body){ showWhToast('Напишите ответ продавцу.'); return; }
    try{
      await apiFetch('/api/inbound/' + encodeURIComponent(receiptOpenId) + '/comments', { method: 'POST',
        body: { body, sku: document.getElementById('rcAbout').value || null } });
      renderReceipt();
    } catch(e){ showWhToast('Не отправлено: ' + e.message); }
  }
  window.sendReceiptComment = sendReceiptComment;

  // Файл документа — с входом, поэтому не ссылкой: забираем и открываем.
  // Окно открываем сразу по нажатию, иначе браузер сочтёт его всплывающим.
  async function openReceiptFile(docId){
    const w = window.open('', '_blank');
    try{
      const res = await fetch(API_BASE + '/api/inbound/' + encodeURIComponent(receiptOpenId) + '/documents/' + encodeURIComponent(docId) + '/file',
        { headers: { Authorization: 'Bearer ' + TOKEN }, cache: 'no-store' });
      if(!res.ok) throw new Error(((await res.json().catch(() => null)) || {}).error || 'Файл не открылся');
      const url = URL.createObjectURL(await res.blob());
      if(w) w.location.href = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch(e){ if(w) w.close(); showWhToast(e.message); }
  }
  window.openReceiptFile = openReceiptFile;

  async function removeReceiptDoc(docId){
    try{
      await apiFetch('/api/inbound/' + encodeURIComponent(receiptOpenId) + '/documents/' + encodeURIComponent(docId), { method: 'DELETE' });
      renderReceipt();
    } catch(e){ showWhToast('Не убран: ' + e.message); }
  }
  window.removeReceiptDoc = removeReceiptDoc;

  /* ===================== Остатки продавцов ===================== */

  // Владелец 02.10.2026: сначала сводка по всем продавцам — те же числа, что
  // продавец видит у себя (всего, заказано, в сборке, в пути, доступно, брак),
  // и сколько лежит в ячейках; нажал на продавца — его товары с теми же
  // числами плюс то, что видит только склад: ячейки и что не разложено.
  // Считает сервер одним правилом с кабинетом продавца и чатом Кладовщика.
  let sellerStock = null;     // { sellers: [...] } из /api/sellers/stock-summary
  let productRows = [];
  let productsFor = '';       // открытый продавец; пусто — сводка
  let productsFilter = 'all';
  // Виртуальные склады продавца (02.10.2026): какой склад смотрим и что ждёт
  // переноса.
  let productsVw = 'all';      // 'all' | 'main' | id склада
  let productTransfers = [];
  let productDecisions = [];   // спорные ситуации, которые ждут продавца
  let productVws = [];
  let productsLoadRun = 0;
  let productsSummaryScroll = 0;

  const nfmt = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('ru-RU'));

  // Один выбор продавца для товаров и складов, без повторного запроса списка.
  function stockCompanyChoiceHtml(selected, action, allLabel){
    const company = companies.find(c => c.id === selected);
    const option = (id, name) => '<button type="button" aria-pressed="' + (selected === id) + '" onclick="'
      + action + '(' + escapeHTML(JSON.stringify(id)) + ')">' + escapeHTML(name) + '</button>';
    return '<details class="stock-choice"><summary><span class="stock-choice-label">Продавец</span><b>'
      + escapeHTML(company ? company.name : allLabel) + '</b></summary><div class="stock-choice-menu">'
      + '<input type="search" class="mp-field" placeholder="Найти продавца" aria-label="Найти продавца" oninput="filterStockChoices(this)">'
      + option('', allLabel) + companies.map(c => option(c.id, c.name)).join('')
      + '<div class="stock-hint" hidden>Продавец не найден.</div></div></details>';
  }
  function filterStockChoices(input){
    const menu = input.parentElement;
    const q = input.value.trim().toLocaleLowerCase('ru');
    let shown = 0;
    menu.querySelectorAll('button').forEach(button => {
      button.hidden = !button.textContent.toLocaleLowerCase('ru').includes(q);
      if(!button.hidden) shown++;
    });
    menu.querySelector('.stock-hint').hidden = shown > 0;
  }
  function selectProductsCompany(id){
    if(id && !companies.some(c => c.id === id)) return;
    if(id) openSellerProducts(id); else showSellerStock();
  }
  function renderProductsCompanyPicker(){
    const host = document.getElementById('productsCompanyPicker');
    if(host){
      host.innerHTML = stockCompanyChoiceHtml(productsFor, 'selectProductsCompany', 'Все продавцы');
      const toolbar = document.querySelector('#productsLevel2 > .pr-bar');
      const summary = document.getElementById('productsLevel1');
      if(productsFor && toolbar) toolbar.insertBefore(host, document.getElementById('productsSellerName'));
      else if(summary) summary.before(host);
    }
    document.getElementById('productsWarehouseSettings').hidden = !canOpenView('warehouse');
  }
  function openProductsWarehouses(){
    if(!canOpenView('warehouse') || !productsFor) return;
    switchView('warehouse');
    document.getElementById('warehouseVwWorkspace').open = true;
    setWarehouseVwCompany(productsFor);
  }
  Object.assign(window, { filterStockChoices, selectProductsCompany, openProductsWarehouses });

  // Каталог общий для продавца, фото не добавляет запрос по каждой строке.
  function loadProductPhotos(companyId){
    loadOrderPhotoCatalog(companyId);
  }
  function productPhotoHtml(companyId, sku){
    const cards = ordersPhotoCatalog.get(companyId)?.products.get(sku)?.cards || [];
    return orderPhotoHtml(cards.find(card => card.photoUrl)?.photoUrl);
  }
  function labelStockTable(host){
    const labels = [...host.querySelectorAll('thead th')].map(th => th.textContent.trim());
    host.querySelectorAll('tbody tr').forEach(row => {
      [...row.children].forEach((cell, index) => { cell.dataset.label = labels[index] || ''; });
    });
  }

  function renderProductsCompanySelects(){
    const opts = companies.map(c => '<option value="' + escapeHTML(c.id) + '">' + escapeHTML(c.name) + '</option>').join('');
    const el = document.getElementById('productFormCompany');
    if(el){
      const keep = el.value;
      el.innerHTML = companies.length ? opts : '<option value="">Сначала добавьте продавца</option>';
      if(keep && companies.some(c => c.id === keep)) el.value = keep;
    }
    renderProductsCompanyPicker();
    renderWarehouseVwPicker();
    if(document.getElementById('view-products')?.classList.contains('active')) openProductsView();
  }

  // Вход в раздел: открыт продавец — его товары, иначе сводка.
  function openProductsView(){
    if(productsFor) return loadProducts();
    return loadSellerStock();
  }

  async function loadSellerStock(){
    productsFor = '';
    const run = ++productsLoadRun;
    renderProductsCompanyPicker();
    document.getElementById('productsLevel1').hidden = false;
    document.getElementById('productsLevel2').hidden = true;
    const box = document.getElementById('sellersList');
    if(!sellerStock) box.innerHTML = '<div class="stock-empty" role="status">Загружаем остатки клиентов…</div>';
    try{
      const summary = await apiFetch('/api/sellers/stock-summary');
      if(productsFor || run !== productsLoadRun) return;
      sellerStock = summary;
    } catch(e){
      if(productsFor || run !== productsLoadRun) return;
      box.innerHTML = '<div class="stock-empty" role="alert"><b>Остатки не загрузились</b><span>' + escapeHTML(e.message)
        + '</span><button type="button" class="wh-onboarding-btn" onclick="loadSellerStock()">Повторить загрузку</button></div>';
      return;
    }
    if(!productsFor) renderSellerStock();
  }
  window.loadSellerStock = loadSellerStock;

  function sellerStockRows(){
    const q = String(document.getElementById('sellersSearch').value || '').trim().toLowerCase();
    return (sellerStock ? sellerStock.sellers : []).filter(s => !q || s.name.toLowerCase().includes(q));
  }

  function renderSellerStock(){
    const box = document.getElementById('sellersList');
    const all = sellerStock ? sellerStock.sellers : [];
    const rows = sellerStockRows();
    document.getElementById('sellersMeta').textContent = all.length
      ? all.length + ' ' + pluralRu(all.length, 'продавец', 'продавца', 'продавцов') : '';
    if(all.length === 0){ box.innerHTML = '<div class="stock-empty"><b>Клиентов пока нет</b><span>Добавьте первого клиента в разделе «Клиенты». Здесь появятся его остатки и товары.</span></div>'; return; }
    if(rows.length === 0){ box.innerHTML = '<div class="stock-empty"><b>Клиент не найден</b><span>Попробуйте другое название или очистите поиск.</span></div>'; return; }
    const sum = (f) => rows.reduce((t, s) => t + Number(s[f] || 0), 0);
    const known = (f) => (rows.some(s => s[f] !== null) ? sum(f) : null);
    const updated = (s) => (s.updatedAt ? (sellerStock.source === 'argus' ? 'пересчёт ' : '1С: ')
      + new Date(s.updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
    box.innerHTML = '<div class="pr-scroll"><table class="pr-table pr-sellers"><colgroup><col class="stock-company-col"><col span="9" class="stock-summary-number-col"></colgroup><thead><tr><th>Клиент</th>'
      + '<th class="num">Всего</th><th class="num">Заказано</th><th class="num">В сборке</th><th class="num">В пути</th><th class="num" title="Сортировочный центр WB принял за последние 3 дня">Принято WB</th>'
      + '<th class="num">Доступно</th><th class="num">Брак</th><th class="num">Не хватает</th><th class="num">В ячейках</th></tr></thead><tbody>'
      + rows.map(s => '<tr class="pr-click" tabindex="0" onclick="openSellerProducts(\'' + escapeHTML(s.companyId) + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click()}">'
        + '<td><span class="pr-name">' + escapeHTML(s.name) + '</span><div class="sub">'
        + escapeHTML([nfmt(s.productCount) + ' ' + pluralRu(s.productCount, 'товар', 'товара', 'товаров'), updated(s)].filter(Boolean).join(' · '))
        + (s.unknownCount ? '<br>без числа учёта: ' + nfmt(s.unknownCount) : '') + '</div>'
        + (s.wbOver ? '<div class="stock-product-notes"><span>На WB больше, чем свободно: ' + nfmt(s.wbOver) + ' ' + pluralRu(s.wbOver, 'товар', 'товара', 'товаров') + '</span></div>' : '')
        + '<span class="stock-row-action" aria-hidden="true">Открыть товары →</span></td>'
        + '<td class="num">' + nfmt(s.total) + '</td>'
        + '<td class="num">' + nfmt(s.ordered) + '</td>'
        + '<td class="num">' + nfmt(s.inAssembly) + '</td>'
        + '<td class="num">' + nfmt(s.inTransit) + '</td>'
        + '<td class="num">' + nfmt(s.acceptedByWb || 0) + '</td>'
        + '<td class="num strong">' + nfmt(s.available) + '</td>'
        + '<td class="num' + (s.defect ? ' warn' : '') + '">' + nfmt(s.defect) + '</td>'
        + '<td class="num' + (s.shortageCount ? ' warn' : '') + '">' + (s.shortageCount ? nfmt(s.shortageCount) + ' ' + pluralRu(s.shortageCount, 'товар', 'товара', 'товаров') : '—') + '</td>'
        + '<td class="num">' + nfmt(s.inCells) + '</td>'
        + '</tr>').join('')
      + (rows.length > 1 ? '<tr class="pr-total"><td>Итого</td><td class="num">' + nfmt(known('total')) + '</td><td class="num">' + nfmt(sum('ordered'))
        + '</td><td class="num">' + nfmt(sum('inAssembly')) + '</td><td class="num">' + nfmt(sum('inTransit')) + '</td><td class="num">' + nfmt(sum('acceptedByWb')) + '</td><td class="num">' + nfmt(known('available'))
        + '</td><td class="num">' + nfmt(sum('defect')) + '</td><td class="num">' + (sum('shortageCount') ? nfmt(sum('shortageCount')) : '—') + '</td><td class="num">' + nfmt(sum('inCells')) + '</td></tr>' : '')
      + '</tbody></table></div>';
    labelStockTable(box);
  }
  window.renderSellerStock = renderSellerStock;

  function exportSellerStock(){
    saveXlsx('Остатки продавцов', 'Продавцы', sellerStockRows().map(s => ({
      'Продавец': s.name, 'Товаров': s.productCount, 'Всего': s.total, 'Заказано': s.ordered,
      'В сборке': s.inAssembly, 'В пути': s.inTransit, 'Принято WB': s.acceptedByWb || 0, 'Доступно': s.available, 'Брак': s.defect,
      'Товаров, где заказов больше остатка': s.shortageCount, 'В ячейках': s.inCells,
      'Товаров без числа учёта': s.unknownCount,
    })), [28, 9, 11, 11, 10, 9, 11, 11, 8, 18, 11, 14]);
  }
  window.exportSellerStock = exportSellerStock;

  function openSellerProducts(companyId){
    const scroller = document.querySelector('#view-products > .stock-workspace');
    if(!productsFor) productsSummaryScroll = scroller?.scrollTop || 0;
    productsFor = companyId;
    productsFilter = 'all';
    productsVw = 'all';
    document.getElementById('productsSearch').value = '';
    loadProducts();
  }
  window.openSellerProducts = openSellerProducts;

  function showSellerStock(){
    productsFor = '';
    loadSellerStock().then(() => {
      if(!productsFor){
        const scroller = document.querySelector('#view-products > .stock-workspace');
        if(scroller) scroller.scrollTop = productsSummaryScroll;
      }
    });
  }
  window.showSellerStock = showSellerStock;

  async function loadProducts(){
    const companyId = productsFor;
    if(!companyId) return loadSellerStock();
    const run = ++productsLoadRun;
    renderProductsCompanyPicker();
    document.getElementById('productsLevel1').hidden = true;
    document.getElementById('productsLevel2').hidden = false;
    const company = companies.find(c => c.id === companyId);
    document.getElementById('productsSellerName').textContent = company ? company.name : '';
    document.getElementById('productsSellerCabinet').href = 'client_access.html?companyId=' + encodeURIComponent(companyId) + '#products';
    const box = document.getElementById('productsList');
    const scroller = document.querySelector('#view-products > .stock-workspace');
    const sameCompany = box.dataset.companyId === companyId;
    const scrollTop = sameCompany ? scroller?.scrollTop || 0 : 0;
    if(!sameCompany) box.innerHTML = '<div class="stock-empty" role="status">Загружаем товары клиента…</div>';
    box.dataset.companyId = companyId;
    let rows;
    try{
      rows = await apiFetch('/api/sellers/stock?companyId=' + encodeURIComponent(companyId));
    } catch(e){
      if(productsFor === companyId && run === productsLoadRun) box.innerHTML = '<div class="stock-empty" role="alert"><b>Товары не загрузились</b><span>' + escapeHTML(e.message)
        + '</span><button type="button" class="wh-onboarding-btn" onclick="loadProducts()">Повторить загрузку</button></div>';
      return;
    }
    if(productsFor !== companyId || run !== productsLoadRun) return;   // пока ждали, сменили продавца или обновили
    productRows = rows.filter(r => r.listed);
    // Склады продавца и переносы, ждущие решения, — только если склады есть.
    productTransfers = []; productVws = []; productDecisions = [];
    if(productRows.some(r => r.byWarehouse)){
      try{
        const vws = (await vwOf(companyId, true)).warehouses;
        const [transfers, decisions] = await Promise.all([
          apiFetch('/api/vwarehouses/transfers?open=1&companyId=' + encodeURIComponent(companyId)),
          apiFetch('/api/vwarehouses/decisions?open=1&companyId=' + encodeURIComponent(companyId))]);
        if(productsFor !== companyId || run !== productsLoadRun) return;
        productVws = vws; productTransfers = transfers; productDecisions = decisions;
      } catch(e){ showWhToast('Склады продавца не загрузились: ' + e.message); }
      if(productsFor !== companyId || run !== productsLoadRun) return;
    }
    loadProductPhotos(companyId);
    renderProducts();
    if(scroller) scroller.scrollTop = scrollTop;
  }
  window.loadProducts = loadProducts;

  // Число товара на выбранном складе: null — «все склады».
  const vwKey = (id) => (id === null ? 'main' : id);
  const prVw = (r) => (productsVw === 'all' || !r.byWarehouse ? null
    : r.byWarehouse.find(w => vwKey(w.id) === productsVw) || { onHand: 0, inAssembly: 0, available: 0, defect: 0 });
  function setProductsVw(v){
    if(v !== 'all' && v !== 'main' && !productVws.some(w => w.id === v)) return;
    productsVw = v; renderProducts();
  }
  window.setProductsVw = setProductsVw;

  // Перенос между складами продавца: учёт, физически ничего не двигается.
  // pre: { companyId, to, qty, note, after } — из карточки поставки, когда
  // складу поставки не хватает товара (владелец 02.10.2026).
  async function openTransfer(sku, pre = {}){
    const companyId = pre.companyId || productsFor;
    let r = companyId === productsFor ? productRows.find(x => x.sku === sku) : null;
    if(!r){
      try{ r = (await apiFetch('/api/sellers/stock?companyId=' + encodeURIComponent(companyId))).find(x => x.sku === sku); }
      catch(e){ showWhToast('Остатки продавца не загрузились: ' + e.message); return; }
    }
    if(!r || !r.byWarehouse){ showWhToast('У этого продавца нет складов, переносить некуда.'); return; }
    const opts = (sel) => r.byWarehouse.map(w => '<option value="' + vwKey(w.id) + '"' + (sel === vwKey(w.id) ? ' selected' : '') + '>'
      + escapeHTML(w.name) + ' — ' + nfmt(w.onHand) + ' шт.</option>').join('');
    const richest = (skip) => r.byWarehouse.filter(w => vwKey(w.id) !== skip).sort((a, b) => (b.onHand || 0) - (a.onHand || 0))[0] || r.byWarehouse[0];
    const from = pre.to ? vwKey(richest(pre.to).id)
      : productsVw !== 'all' ? productsVw : vwKey((r.byWarehouse.find(w => w.onHand > 0) || r.byWarehouse[0]).id);
    const to = pre.to || vwKey((r.byWarehouse.find(w => vwKey(w.id) !== from) || r.byWarehouse[0]).id);
    const overlay = document.createElement('div');
    overlay.className = 'ask-overlay';
    overlay.innerHTML = '<div class="ask-box" role="dialog" aria-modal="true" data-form>'
      + '<div class="ask-title">Перенести между складами</div>'
      + '<div class="ask-text">' + escapeHTML(r.name || r.sku) + '. Остатки складов поменяются, продавцу придёт уведомление. Если один из складов хранится отдельно, грузчику придёт задание переложить товар.</div>'
      + '<div class="tr-grid"><label>Откуда<select class="mp-field" id="trFrom">' + opts(from) + '</select></label>'
      + '<label>Куда<select class="mp-field" id="trTo">' + opts(to) + '</select></label>'
      + '<label>Сколько штук<input class="mp-field" id="trQty" type="number" min="1" inputmode="numeric" value="' + escapeHTML(pre.qty || '') + '"></label>'
      + '<label>Комментарий — не обязательно<input class="mp-field" id="trNote" maxlength="300" placeholder="Например: под поставку на Озон" value="' + escapeHTML(pre.note || '') + '"></label></div>'
      + '<div class="ask-actions"><button type="button" class="wh-onboarding-btn ask-cancel">Отмена</button>'
      + '<button type="button" class="wh-onboarding-btn primary ask-ok">Перенести</button></div></div>';
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if(e.target === overlay) close(); });
    overlay.querySelector('.ask-cancel').onclick = close;
    overlay.querySelector('.ask-ok').onclick = async () => {
      const f = overlay.querySelector('#trFrom').value, t = overlay.querySelector('#trTo').value;
      const qty = Number(overlay.querySelector('#trQty').value);
      if(f === t){ showWhToast('Склад «откуда» и «куда» — один и тот же.'); return; }
      if(!Number.isInteger(qty) || qty < 1){ showWhToast('Сколько штук переносим?'); return; }
      const btn = overlay.querySelector('.ask-ok'); btn.disabled = true;
      try{
        const res = await apiFetch('/api/vwarehouses/transfers', { method: 'POST', body: {
          companyId, sku, qty, fromVw: f === 'main' ? null : f, toVw: t === 'main' ? null : t,
          note: overlay.querySelector('#trNote').value.trim() || undefined } });
        close();
        showWhToast(res.status === 'waiting_seller'
          ? 'Продавец запретил складу решать такое без него — просьба отправлена ему, перенос сделается после «Согласен».'
          : res.status === 'to_move'
          ? 'Грузчику создано задание переложить: ' + res.fromName + ' → ' + res.toName + ', ' + nfmt(res.qty) + ' шт. Остатки складов поменяются по мере перекладки.'
          : 'Перенесено: ' + res.fromName + ' → ' + res.toName + ', ' + nfmt(res.qty) + ' шт. Продавцу пришло уведомление «обратите внимание».');
        if(pre.after) pre.after(); else loadProducts();
      } catch(e){ showWhToast(e.message); btn.disabled = false; }
    };
    document.body.appendChild(overlay);
    overlay.querySelector('#trQty').focus();
  }
  window.openTransfer = openTransfer;

  // Заявка продавца на перенос: выполнить или отказать с причиной.
  async function decideTransfer(id, approve){
    const t = productTransfers.find(x => x.id === id); if(!t) return;
    let reason;
    if(!approve){
      reason = await askText('Отказать в переносе ' + t.number + '?', 'Причина — продавец её увидит', 'Например: на складе Озон под этот товар нет места');
      if(reason === null) return;
    } else if(!await askConfirm('Выполнить перенос ' + t.number + '?\n\n«' + (t.name || t.sku) + '», ' + t.qty + ' шт.: «' + t.fromName + '» → «' + t.toName + '».')) return;
    try{
      const res = await apiFetch('/api/vwarehouses/transfers/' + id + '/decide', { method: 'POST', body: { approve, reason: reason || undefined } });
      showWhToast(!approve ? 'Отказано — продавцу пришло уведомление.'
        : res && res.status === 'to_move' ? 'Грузчику создано задание переложить — продавцу пришло уведомление.'
        : 'Перенос выполнен — продавцу пришло уведомление.');
      loadProducts();
      if(typeof loadJournal === 'function') loadJournal(true);
    } catch(e){ showWhToast(e.message); }
  }
  window.decideTransfer = decideTransfer;

  // Вопрос с полем ввода: строка — ответ, null — отмена.
  function askText(title, label, placeholder){
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'ask-overlay';
      overlay.innerHTML = '<div class="ask-box" role="dialog" aria-modal="true"><div class="ask-title"></div>'
        + '<label class="tr-grid"><span class="ask-text"></span><input class="mp-field" maxlength="300"></label>'
        + '<div class="ask-actions"><button type="button" class="wh-onboarding-btn ask-cancel">Отмена</button>'
        + '<button type="button" class="wh-onboarding-btn primary ask-ok">Отправить</button></div></div>';
      overlay.querySelector('.ask-title').textContent = title;
      overlay.querySelector('.ask-text').textContent = label;
      const input = overlay.querySelector('input'); input.placeholder = placeholder || '';
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.addEventListener('click', (e) => { if(e.target === overlay) done(null); });
      overlay.querySelector('.ask-cancel').onclick = () => done(null);
      overlay.querySelector('.ask-ok').onclick = () => done(input.value.trim());
      input.addEventListener('keydown', (e) => { if(e.key === 'Enter') done(input.value.trim()); if(e.key === 'Escape') done(null); });
      document.body.appendChild(overlay);
      input.focus();
    });
  }

  // Где лежит — по карте склада, если она загружена (у менеджера без права
  // «склад» её нет: тогда только число ячеек).
  function productCells(companyId, sku){
    const out = [];
    // Выбран склад продавца — только его товар (виртуальный склад, 02.10.2026).
    const vw = productsVw === 'all' ? undefined : productsVw === 'main' ? null : productsVw;
    Object.keys(cellBlocks || {}).forEach(rowNum => {
      (cellBlocks[rowNum] || []).forEach(b => {
        const q = (b.stock || []).filter(it => it.companyId === companyId && it.sku === sku
            && (vw === undefined || (it.vw || null) === vw))
          .reduce((s, it) => s + Number(it.qty || 0), 0);
        if(q > 0) out.push({ label: blockAddr(rowNum, b), qty: q });
      });
    });
    return out;
  }

  // Что видит только склад: сколько в ячейках (годное и брак) и сколько по
  // учёту не разложено — числится, а в ячейках Аргуса его нет.
  const prDefect = (r) => prVw(r)?.defect ?? (Number(r.defective || 0) + Number(r.packagingDefect || 0));
  const prInCells = (r) => Number(r.qty || 0) + Number(r.notForSale || 0);
  const prNotPlaced = (r) => (r.totalKnown ? Math.max(0, Number(r.total) - prInCells(r) - Number(r.staged || 0)) : 0);
  const PR_FILTERS = [
    ['all', 'Все', () => true],
    ['short', 'Заказов больше, чем товара', (r) => r.shortage],
    ['defect', 'Есть брак', (r) => prDefect(r) > 0],
    ['notPlaced', 'Не разложено по ячейкам', (r) => prNotPlaced(r) > 0],
    ['wbOver', 'На WB больше, чем свободно', (r) => r.wbOver > 0],
  ];
  // Где снять лишнее на WB: на складе WB, где выставлено больше всего
  // (владелец 06.10.2026). Файл «Остатки для WB» ставит одно число на склад —
  // при нескольких складах WB он только прибавит.
  function wbAdvice(r){
    const t = r.wbTop;
    return 'На WB больше, чем свободно, на ' + nfmt(r.wbOver) + ' шт. '
      + (t && t.amount >= r.wbOver ? 'Снимите на WB: «' + t.name + '» ' + nfmt(t.amount) + ' → ' + nfmt(t.amount - r.wbOver)
        : 'Уменьшите количество на складах WB.');
  }

  function productsShown(){
    const q = String(document.getElementById('productsSearch').value || '').trim().toLowerCase();
    const test = (PR_FILTERS.find(f => f[0] === productsFilter) || PR_FILTERS[0])[2];
    // Выбран склад продавца — только товар, который на нём есть.
    const onVw = (r) => { const w = prVw(r); return !w || w.onHand || w.inAssembly || w.defect; };
    return productRows.filter(r => test(r) && onVw(r) && (!q || [r.name, r.sku, r.barcode].some(v => String(v || '').toLowerCase().includes(q))))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  }

  function setProductsFilter(key){ productsFilter = key; renderProducts(); }
  window.setProductsFilter = setProductsFilter;

  function renderProducts(){
    const box = document.getElementById('productsList');
    const companyId = productsFor;
    document.getElementById('productsFilters').innerHTML = PR_FILTERS
      .filter(([key, , test]) => key !== 'wbOver' || productsFilter === key || productRows.some(test)).map(([key, label, test]) => {
      const n = key === 'all' ? productRows.length : productRows.filter(test).length;
      return '<button type="button" class="jf-chip' + (productsFilter === key ? ' active' : '') + '" aria-pressed="' + (productsFilter === key) + '" onclick="setProductsFilter(\'' + key + '\')">'
        + escapeHTML(label) + (key === 'all' ? '' : ' · ' + nfmt(n)) + '</button>';
    }).join('');
    const rows = productsShown();
    const hasVw = productRows.some(r => r.byWarehouse);
    // Склады продавца: выбор склада и заявки на перенос, ждущие решения.
    const vwBox = document.getElementById('productsVwBar');
    const vwChoices = [{ id: 'all', name: 'Основной — весь товар продавца' }, ...productVws, { id: 'main', name: 'Остальной товар' }];
    const selectedVw = vwChoices.find(w => w.id === productsVw) || vwChoices[0];
    vwBox.innerHTML = !hasVw ? '' : '<details class="stock-choice"><summary><span class="stock-choice-label">Склад продавца</span><b>'
      + escapeHTML(selectedVw.name) + '</b></summary><div class="stock-choice-menu">'
      + vwChoices.map(w => '<button type="button" aria-pressed="' + (productsVw === w.id) + '" onclick="setProductsVw('
        + escapeHTML(JSON.stringify(w.id)) + ')">' + escapeHTML(w.name) + '</button>').join('')
      + '</div></details>'
      + (productsVw !== 'all' ? '<span class="stock-hint">По складу: остаток, сборка, доступно и брак. Заказы WB до поставки и «Не разложено по ячейкам» — по всему товару продавца.</span>' : '');
    document.getElementById('productsTransfers').innerHTML = productTransfers.length
      ? '<div class="rc-card pr-transfers"><div class="staff-title" style="font-size:15px;">Переносы ждут решения · ' + productTransfers.length + '</div>'
        + productTransfers.map(t => '<div class="sp-key"><span><b>' + escapeHTML(t.number) + '</b> «' + escapeHTML(t.name || t.sku) + '», ' + nfmt(t.qty) + ' шт.: '
          + escapeHTML(t.fromName) + ' → ' + escapeHTML(t.toName)
          + '<span class="mp-card-sub">' + (t.status === 'requested' ? 'просит продавец'
            : t.status === 'to_move' ? 'грузчик перекладывает — остатки меняются по мере перекладки'
            : 'ждёт согласия продавца — он запретил складу решать такое без него')
          + (t.note ? ' · ' + escapeHTML(t.note) : '') + '</span></span>'
          + (t.status === 'requested' ? '<span class="mp-card-acts" style="margin:0;"><span class="mp-act" onclick="decideTransfer(\'' + t.id + '\', true)">Выполнить</span>'
            + '<span class="mp-act warn" onclick="decideTransfer(\'' + t.id + '\', false)">Отказать</span></span>' : '')
          + '</div>').join('') + '</div>'
      : '';
    // Спорные ситуации ждут продавца — склад их видит, решить не может.
    if(productDecisions.length) document.getElementById('productsTransfers').innerHTML +=
      '<div class="rc-card pr-transfers"><div class="staff-title" style="font-size:15px;">Ждёт решения продавца · ' + productDecisions.length + '</div>'
      + productDecisions.map(d => '<div class="sp-key"><span>' + escapeHTML(d.title)
        + '<span class="mp-card-sub">пока записано по правилу: ' + escapeHTML(d.parts.map(x => x.name + ' — ' + x.value).join(', '))
        + ' · продавец запретил складу решать такое без него</span></span></div>').join('') + '</div>';
    document.getElementById('productsMeta').textContent = productRows.length
      ? nfmt(productRows.length) + ' ' + pluralRu(productRows.length, 'товар', 'товара', 'товаров') : '';
    if(productRows.length === 0){ box.innerHTML = '<div class="stock-empty"><b>У клиента пока нет товаров</b><span>Добавьте первый товар кнопкой «+ Добавить товар».</span></div>'; return; }
    if(rows.length === 0){ box.innerHTML = '<div class="stock-empty"><b>Товары не найдены</b><span>Измените поиск или выберите другой фильтр.</span></div>'; return; }
    const wbOverCount = productRows.filter(r => r.wbOver > 0).length;
    box.innerHTML = (wbOverCount && productsFilter !== 'wbOver'
      ? '<div class="pr-wb-alert" role="status"><span><b>' + nfmt(wbOverCount) + ' ' + pluralRu(wbOverCount, 'товар', 'товара', 'товаров')
        + ':</b> на WB выставлено больше, чем свободно на складе — WB может продать то, чего нет. Где снять — под названием товара.</span>'
        + '<button type="button" class="home-link" onclick="setProductsFilter(\'wbOver\')">Показать только их</button></div>' : '')
      + '<div class="pr-scroll"><table class="pr-table pr-products"><colgroup><col class="stock-product-col"><col span="9" class="stock-product-number-col"><col class="stock-location-col"></colgroup><thead><tr><th>Товар</th>'
      + '<th class="num">Всего</th><th class="num">Заказано</th><th class="num">В сборке</th><th class="num">В пути</th><th class="num" title="Сортировочный центр WB принял за последние 3 дня">Принято WB</th>'
      + '<th class="num">Доступно</th><th class="num">На WB</th><th class="num">Брак</th><th class="num">В ячейках</th><th>Где лежит</th></tr></thead><tbody>'
      + rows.map(r => {
        const cells = productCells(companyId, r.sku);
        const where = cells.length
          ? cells.slice(0, 3).map(c => escapeHTML(c.label) + ' — ' + nfmt(c.qty)).join('<br>')
            + (cells.length > 3 ? '<div class="sub">и ещё ' + (cells.length - 3) + '</div>' : '')
          : Number(r.cells) > 0 ? 'в ' + r.cells + ' ' + pluralRu(Number(r.cells), 'ячейке', 'ячейках', 'ячейках')
          : '<span class="sub">не в ячейках</span>';
        const notPlaced = prNotPlaced(r);
        // «В пути» — сколько вычтено из «Доступно» (transitCounted): уехавшее,
        // которое 1С уже списала, во «Всего» не входит — не вычитать дважды (07.10, Н6).
        const short = r.shortage ? Number(r.orderedNotInSupply || 0) + Number(r.inAssembly || 0) + Number(r.transitCounted ?? r.inTransit ?? 0) - Number(r.total || 0) : 0;
        const w = prVw(r);
        // Раскладка по складам — под названием, только ненулевые склады.
        const split = hasVw && !w && r.byWarehouse
          ? r.byWarehouse.filter(x => x.onHand).map(x => escapeHTML(x.name) + ' ' + nfmt(x.onHand)).join(' · ') : '';
        const name = '<td><div class="stock-product">' + productPhotoHtml(companyId, r.sku) + '<div class="stock-product-copy"><div class="stock-product-name">' + escapeHTML(r.name || '—') + '</div><div class="sub stock-product-identifiers">'
          + (r.sku ? '<span>Артикул: ' + escapeHTML(r.sku) + '</span>' : '') + (r.barcode ? '<span>Штрихкод: ' + escapeHTML(r.barcode) + '</span>' : '') + '</div>'
          + (split ? '<div class="sub pr-split">' + split + '</div>' : '')
          + (!w && (short > 0 || notPlaced || r.wbOver > 0) ? '<div class="stock-product-notes">'
            + (short > 0 ? '<span>Не хватает: ' + nfmt(short) + ' шт.</span>' : '')
            + (r.wbOver > 0 ? '<span>' + escapeHTML(wbAdvice(r)) + '</span>' : '')
            + (notPlaced ? '<span>Не разложено по ячейкам: ' + nfmt(notPlaced) + ' шт.</span>' : '') + '</div>' : '')
          + (hasVw && r.byWarehouse && r.byWarehouse.some(x => x.onHand > 0) ? '<button type="button" class="stock-move" onclick="openTransfer('
            + escapeHTML(JSON.stringify(r.sku)) + ')">Перенести</button>' : '') + '</div></div></td>';
        if(w){
          return '<tr>' + name
            + '<td class="num">' + nfmt(w.onHand) + '</td>'
            + '<td class="num sub">—</td>'
            + '<td class="num">' + nfmt(w.inAssembly) + '</td>'
            + '<td class="num sub">—</td>'
            + '<td class="num sub">—</td>'
            + '<td class="num strong">' + nfmt(w.available) + '</td>'
            + '<td class="num sub">—</td>'
            + '<td class="num' + (w.defect ? ' warn' : '') + '">' + nfmt(w.defect) + '</td>'
            + '<td class="num sub">—</td>'
            + '<td class="cells">' + where + '</td>'
            + '</tr>';
        }
        return '<tr>' + name
          + '<td class="num">' + (r.totalKnown ? nfmt(r.total) : '<span class="sub" title="Из учёта числа ещё не пришло">—</span>') + '</td>'
          + '<td class="num">' + nfmt(r.orderedNotInSupply) + '</td>'
          + '<td class="num">' + nfmt(r.inAssembly) + '</td>'
          + '<td class="num">' + nfmt(r.inTransit) + '</td>'
          + '<td class="num">' + nfmt(r.acceptedByWb || 0) + '</td>'
          + '<td class="num strong">' + nfmt(r.sellerAvailable) + '</td>'
          + '<td class="num' + (r.wbOver > 0 ? ' warn' : '') + '">' + (r.wbListed == null ? '<span class="sub">—</span>' : nfmt(r.wbListed)) + '</td>'
          + '<td class="num' + (prDefect(r) ? ' warn' : '') + '">' + nfmt(prDefect(r)) + '</td>'
          + '<td class="num">' + nfmt(prInCells(r)) + '</td>'
          + '<td class="cells">' + where + '</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div>';
    labelStockTable(box);
  }
  window.renderProducts = renderProducts;

  function exportProducts(){
    const company = companies.find(c => c.id === productsFor);
    // Выбран склад продавца — числа по нему, как на экране; «Все склады» —
    // общие числа и раскладка по складам.
    const vwLabel = productsVw === 'all' ? '' : productsVw === 'main' ? 'Остальной товар'
      : ((productVws.find(w => w.id === productsVw) || {}).name || 'склад');
    const hasVw = productRows.some(r => r.byWarehouse);
    saveXlsx('Остатки ' + (company ? company.name : 'продавца') + (vwLabel ? ' — ' + vwLabel : ''), 'Товары', productsShown().map(r => {
      const w = prVw(r);
      const where = productCells(productsFor, r.sku).map(c => c.label + ' — ' + c.qty).join(', ');
      if(w) return { 'Товар': r.name, 'Артикул': r.sku, 'Штрихкод': r.barcode || '', 'Склад': vwLabel, 'На складе': w.onHand,
        'В сборке': w.inAssembly, 'Доступно': w.available, 'Брак': w.defect, 'Где лежит': where };
      return {
        'Товар': r.name, 'Артикул': r.sku, 'Штрихкод': r.barcode || '', 'Всего': r.totalKnown ? r.total : null,
        'Заказано': r.orderedNotInSupply, 'В сборке': r.inAssembly, 'В пути': r.inTransit, 'Принято WB': r.acceptedByWb || 0, 'Доступно': r.sellerAvailable,
        'На WB': r.wbListed ?? null,
        'Брак': prDefect(r), 'В ячейках': prInCells(r), 'Не разложено': prNotPlaced(r),
        ...(hasVw ? { 'По складам': (r.byWarehouse || []).filter(x => x.onHand).map(x => x.name + ' ' + x.onHand).join(', ') } : {}),
        'Где лежит': where,
      };
    }), vwLabel ? [40, 16, 16, 16, 11, 10, 10, 8, 30] : [40, 16, 16, 9, 10, 10, 9, 11, 10, 9, 8, 11, 12].concat(hasVw ? [28] : [], [30]));
  }
  window.exportProducts = exportProducts;

  function toggleProductForm(open){
    const form = document.getElementById('productForm');
    form.hidden = !open;
    if(open){
      const sel = document.getElementById('productFormCompany');
      if(productsFor) sel.value = productsFor;
      document.getElementById('productFormSku').focus();
    }
  }
  window.toggleProductForm = toggleProductForm;

  let productSaving = false;

  async function saveProduct(){
    if(productSaving) return;
    const companyId = document.getElementById('productFormCompany').value;
    const sku = document.getElementById('productFormSku').value.trim();
    const name = document.getElementById('productFormName').value.trim();
    const barcode = document.getElementById('productFormBarcode').value.trim();
    if(!companyId){ showWhToast('Выберите продавца.'); return; }
    if(!sku){ showWhToast('Впишите артикул.'); document.getElementById('productFormSku').focus(); return; }
    if(!name){ showWhToast('Впишите название.'); document.getElementById('productFormName').focus(); return; }
    productSaving = true;
    const btn = document.getElementById('productFormSave');
    btn.disabled = true;
    try{
      await apiFetch('/api/products', { method: 'POST', body: { companyId, sku, name, barcode: barcode || undefined } });
      ['productFormSku', 'productFormName', 'productFormBarcode'].forEach(id => { document.getElementById(id).value = ''; });
      toggleProductForm(false);
      // Новый товар сразу доступен в приходе: панель перечитает каталог, выбор останется.
      if(receiptPickerFor === companyId) receiptPicker?.reload();
      sellerStock = null;
      openSellerProducts(companyId);
      showWhToast('Товар «' + name + '» заведён. Его можно выбирать в приходе.');
    } catch(e){
      showWhToast('Товар не заведён: ' + e.message);
    }
    productSaving = false;
    btn.disabled = false;
  }
  window.saveProduct = saveProduct;

  /* ===================== Подключение 1С ===================== */

  function copyActivationCode(){
    const code = document.getElementById('ocActivationCode').textContent;
    navigator.clipboard?.writeText(code);
    showWhToast('Код скопирован');
  }

  function formatQty(n){
    return typeof n === 'number' ? n.toLocaleString('ru-RU') : '—';
  }

  // Time of contact is useful, but does not prove that a full exchange finished.
  function formatLastSeen(iso){
    if(!iso) return null;
    const then = new Date(iso);
    const mins = Math.round((Date.now() - then.getTime()) / 60000);
    if(mins < 1) return 'только что';
    if(mins < 60) return mins + ' ' + pluralRu(mins, 'минуту', 'минуты', 'минут') + ' назад';
    const hours = Math.round(mins / 60);
    if(hours < 24) return hours + ' ' + pluralRu(hours, 'час', 'часа', 'часов') + ' назад';
    const days = Math.round(hours / 24);
    if(days <= 30) return days + ' ' + pluralRu(days, 'день', 'дня', 'дней') + ' назад';
    return then.toLocaleDateString('ru-RU');
  }

  // Дата без часов: «с 8 сент.» отвечает на вопрос «давно ли лежит», а
  // «3 часа назад» — нет, если речь про третий день.
  function fmtDay(iso){
    if(!iso) return '';
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  // Полоса выполнения с настоящими процентами.
  //
  // Знаменатель — число шагов, которые мы правда собираемся сделать; процент
  // двигается на закрытом шаге, а не на начатом. Полоса, ползущая по таймеру,
  // врёт о времени и приучает не верить экрану: лучше честные рывки, чем
  // ровная ложь. Поэтому здесь нельзя показать 1%, 2%, 3% на трёх шагах —
  // будет 0, 33, 67, 100, и это правда.
  function whProgress(hostId, total, firstLabel){
    const host = document.getElementById(hostId);
    if(!host) return { step(){}, fail(){}, finish(){} };
    let done = 0;
    host.innerHTML = '<div class="wh-prog">'
      + '<div class="wh-prog-top"><div class="wh-prog-label"></div><div class="wh-prog-pct">0%</div></div>'
      + '<div class="wh-prog-track"><i class="wh-prog-fill"></i></div>'
      + '<div class="wh-prog-steps"></div></div>';
    const box = host.querySelector('.wh-prog');
    const label = box.querySelector('.wh-prog-label');
    const pct = box.querySelector('.wh-prog-pct');
    const fill = box.querySelector('.wh-prog-fill');
    const steps = box.querySelector('.wh-prog-steps');
    function paint(text){
      const share = total > 0 ? Math.round(done / total * 100) : 0;
      if(text) label.textContent = text;
      pct.textContent = share + '%';
      fill.style.width = share + '%';
      // «Сделано N из M», а не «шаг N»: рядом стоит процент, и эти два числа
      // обязаны говорить одно и то же. «Шаг 3 из 3» при 67% выглядит как
      // ошибка счёта, даже когда оба верны по-своему.
      steps.textContent = 'сделано ' + done + ' из ' + total;
    }
    paint(firstLabel || 'Начинаем…');
    return {
      step(text){ done = Math.min(total, done + 1); paint(text); },
      // Упало — полоса всё равно доходит до конца: шаги-то сделаны, просто
      // часть работы не удалась. Красный цвет и текст говорят об этом яснее,
      // чем полоса, застывшая на 67% без объяснения.
      fail(text){ box.classList.add('failed'); done = total; paint(text); },
      finish(text){
        done = total; paint(text || 'Готово');
        // Полоса не убирается мгновенно: человек должен успеть увидеть,
        // что дошло до конца, а не заметить исчезновение краем глаза.
        setTimeout(() => { if(host.firstChild === box) host.innerHTML = ''; }, 2200);
      },
    };
  }

  // Сбой, о котором иначе никто не узнал бы.
  //
  // Экран «Заказы с МП» неделю показывал «Загружаем…»: запрос проходил, а
  // отрисовка падала на функции, которой не существовало. Падение случилось
  // после try/catch загрузчика, поэтому обещание просто отклонялось в
  // тишине — ни ошибки на экране, ни строчки в консоли для владельца.
  // Один обработчик на весь кабинет: любой такой сбой теперь виден.
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e && e.reason && e.reason.message ? e.reason.message : 'неизвестная ошибка';
    if(msg === 'сессия истекла') return;
    showWhToast('Сбой в кабинете: ' + msg);
  });

  function render1CStockCalculation(stock){
    const host = document.getElementById('ocStockCalculationBody');
    if(!host) return;
    const calculation = stock?.stock_calculation;
    if(stock?.stock_calculation_status === 'invalid'){
      host.textContent = 'Сведения об условиях расчёта отклонены: модуль передал некорректный формат. Результат приёма самих остатков показан отдельно в таблице выше.';
      return;
    }
    if(stock?.stock_calculation_status !== 'accepted' || !calculation || typeof calculation !== 'object'){
      host.textContent = stock
        ? 'Модуль ещё не передал условия расчёта остатков. Это не означает, что передача остатков завершилась ошибкой; её результат показан в таблице выше.'
        : 'Условия расчёта появятся, когда модуль передаст их вместе с остатками.';
      return;
    }
    // 1С передаёт местное время без часового пояса. Date здесь сдвинул бы его
    // по часовому поясу браузера и превратил неподтверждённое время в точное.
    const localTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)
      ? value.slice(8,10)+'.'+value.slice(5,7)+'.'+value.slice(0,4)+' '+value.slice(11)
      : 'Не передано';
    const sourceText = value => typeof value === 'string' && value ? value : 'Не передано';
    const count = value => Number.isSafeInteger(value) && value > 0 ? formatQty(value) : 'Не передано';
    const fields = [
      ['Начало расчёта', localTime(calculation.calculatedStartedAt)],
      ['Конец расчёта', localTime(calculation.calculatedFinishedAt)],
      ['Регистр 1С', sourceText(calculation.registerName)],
      ['Период остатков', calculation.balanceMode === 'current_totals' ? 'Текущие итоги регистра' : 'Не передан'],
      ['Склады', calculation.warehouseScope === 'all_in_register' ? 'Все склады выбранного регистра, без отбора отдельного склада' : 'Условие не передано'],
      ['Отбор товаров', 'Начало кода: '+sourceText(calculation.productCodePrefix)+'; '
        +(calculation.excludeDeleted === true ? 'помеченные на удаление исключены' : 'отбор по удалению не передан')+'; '
        +(calculation.excludeGroups === true ? 'группы исключены' : 'отбор групп не передан')],
      ['Количество', sourceText(calculation.quantityField)+'; '
        +(calculation.quantityUnit === 'register_unit' ? 'в единицах регистра' : 'единица не передана')+'; '
        +(calculation.quantityConversion === 'none' ? 'без пересчёта единиц' : 'сведения о пересчёте не переданы')],
      ['Объём по данным модуля', count(calculation.totalRecords)+' записей; порция '+count(calculation.batchIndex)+' из '+count(calculation.batchCount)],
      ['Идентификатор расчёта', sourceText(calculation.snapshotId)],
    ];
    host.innerHTML = '<p class="oc-calculation-note">Время указано по часам 1С; часовой пояс не передан.</p>'
      +'<dl>'+fields.map(([label,value])=>'<dt>'+escapeHTML(label)+'</dt><dd>'+escapeHTML(value)+'</dd>').join('')+'</dl>'
      +'<p class="oc-calculation-note">Это условия, сообщённые модулем для последней порции остатков. Число записей и номер порции не подтверждают, что весь обмен получен полностью.</p>';
  }

  function render1CBatches(stages){
    const latest = new Map();
    for(const row of stages || []){
      const old = latest.get(row.stage);
      if(!old || new Date(row.received_at) > new Date(old.received_at)) latest.set(row.stage,row);
    }
    const labels = {counterparties:'Контрагенты',companies:'Компании',products:'Номенклатура',invoices:'Документы',stock:'Учётные остатки',cells:'Адреса хранения','cell-catalog':'Справочник ячеек'};
    const resultLabels = {created:'Создано',adopted:'Связано',updated:'Обновлено',updated_unparsed:'Ячейки без разбора адреса',skipped_unmapped_company:'Ждут связи с продавцом',skipped_in_progress:'Сохранены складские операции',ownership_conflict:'Конфликт владельца',error:'Ошибки',warnings:'Предупреждения'};
    const rows = [...latest.values()].sort((a,b)=>(Object.keys(labels).indexOf(a.stage)+1||99)-(Object.keys(labels).indexOf(b.stage)+1||99));
    const formatDate = value => value ? new Date(value).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Нет сведений';
    document.getElementById('ocPushBatches').innerHTML = rows.length
      ? `<table class="oc-batches-table"><thead><tr><th>Данные</th><th>Последняя порция</th><th class="oc-batch-num">Строк</th><th>Результат этой порции</th></tr></thead><tbody>${rows.map(row=>{
        const mode = row.run_mode === 'automatic' ? 'Автоматический запуск' : row.run_mode === 'manual' ? 'Ручной запуск' : 'Режим запуска не передан';
        const results = Object.entries(row.summary || {}).filter(([,v])=>Number.isFinite(Number(v))&&Number(v)>0).map(([key,value])=>`<span${['error','ownership_conflict','warnings','updated_unparsed','skipped_unmapped_company'].includes(key)?' class="oc-batch-attention"':''}>${escapeHTML(resultLabels[key]||'Другой результат')}: ${formatQty(value)}</span>`).join('');
        return `<tr data-sync-stage="${escapeHTML(row.stage)}"><td data-label="Данные">${escapeHTML(labels[row.stage]||'Другие данные')}</td><td data-label="Последняя порция">${escapeHTML(formatDate(row.received_at))}<small>${escapeHTML(mode)}</small><small>${row.module_version?'Модуль '+escapeHTML(row.module_version):'Версия модуля не передана'}</small></td><td data-label="Строк" class="oc-batch-num">${formatQty(row.record_count)}</td><td data-label="Результат этой порции" class="oc-batch-results">${results||'Результат не передан'}</td></tr>`;
      }).join('')}</tbody></table>`
      : '<p class="oc-batches-empty">Подробности обмена появятся после следующей отправки из 1С. Версия модуля и режим запуска передаются начиная с модуля #12.</p>';
    const stock = latest.get('stock');
    document.getElementById('ocStockBatch').textContent = stock ? formatDate(stock.received_at) : 'Нет сведений';
    document.getElementById('ocStockBatchSub').textContent = stock ? formatQty(stock.record_count)+' строк в последней порции' : 'Ожидаем новую отправку остатков';
    render1CStockCalculation(stock);
    return rows;
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
      document.getElementById('ocStatusDot').classList.remove('connected');
      document.getElementById('ocStatusTitle').textContent = 'Обмен с 1С';
      document.getElementById('ocStatusSub').textContent = 'Последняя связь: '+lastSeen+'. Получение данных показано отдельно по каждому этапу.';

      document.getElementById('ocNumProducts').textContent = formatQty(s.synced_products);
      document.getElementById('ocNumInvoices').textContent = formatQty(s.synced_invoices);
      render1CBatches(s.pushStages);
      document.getElementById('ocNumUnassigned').textContent = formatQty(s.unassigned_products);
      document.getElementById('ocUnassignedSub').textContent = Number(s.unmapped_counterparties || 0) > 0
        ? formatQty(s.unmapped_counterparties) + ' контрагентов ещё не связаны'
        : Number(s.unassigned_products || 0) > 0
          ? 'товаров требуют распределения'
          : 'все распределены по продавцам';
      document.getElementById('ocLastSeen').textContent = 'Аргус только получает данные из 1С. Обратная запись в 1С не подключена.';

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
    const issue = document.getElementById('ocIssueKey');
    const copy = document.getElementById('ocCodeCopy');
    // Учёт только в Аргусе (анкета склада) — 1С не нужна, но экран остаётся.
    const noOneC = document.getElementById('ocNoOneC');
    if(noOneC) noOneC.style.display = whSettings && whSettings.stock_source === 'argus' ? '' : 'none';
    try{
      const keys = await apiFetch('/api/sync/keys');
      const active = keys.find(k => k.active);
      el.textContent = active ? active.key_code : 'Ключ ещё не выпущен';
      if(issue) issue.style.display = active ? 'none' : '';
      if(copy) copy.style.display = active ? '' : 'none';
    } catch(e){
      el.textContent = 'Не удалось загрузить ключ';
    }
  }
  // Ключ 1С владелец выпускает сам — раньше это делал разработчик на сервере.
  async function issue1CKey(){
    const btn = document.getElementById('ocIssueKey');
    if(btn) btn.disabled = true;
    try{
      await apiFetch('/api/sync/keys', { method: 'POST', body: { label: 'Модуль 1С' } });
      showWhToast('Ключ для 1С выпущен. Передайте его администратору 1С.');
      await load1CKey();
    } catch(e){ showWhToast('Не удалось выпустить ключ: ' + e.message); }
    finally { if(btn) btn.disabled = false; }
  }
  window.issue1CKey = issue1CKey;

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
    // Дом — там, где карта: вкладки «Карта склада / Инвентаризация» переносят
    // содержимое раздела во вложенный блок (проверка 03.10.2026: вставка в сам
    // раздел падала, и у нового склада конструктор не открывался).
    const map = document.getElementById('whMapWrap');
    const home = map.parentElement;
    if(ctor.parentElement !== home) home.insertBefore(ctor, map);

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
    return `<div class="ctor-side" data-form>
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
      // Known occupied addresses do not measure volume or remaining capacity.
      const blocks = cellBlocks[n] || [];
      const taken = blocks.filter(b => b.state === 'occupied').length;
      const titleText = `Ряд ${rowLabel(n)}: занято ячеек ${taken} из ${blocks.length}. Вместимость не задана.`;
      rects += `<g onclick="focusRow(${n})"><title>${titleText}</title><rect class="wh-row-rect" id="row-rect-${n}" x="${xs[i]}" y="${topY}" width="${rowW}" height="${rowH}" rx="4"/><text class="wh-row-num" x="${xs[i] + rowW/2}" y="${topY - 10}">${escapeHTML(String(rowLabel(n)))}</text></g>`;
      if(aisleAfter[i] && i < rowOrder.length - 1){
        const cx = xs[i] + rowW + gapAisle/2;
        const cy = topY + rowH/2;
        aisles += `<text class="wh-aisle-label" x="${cx}" y="${cy}" transform="rotate(-90 ${cx} ${cy})" text-anchor="middle">ПРОХОД</text>`;
      }
    }
    return `<svg width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" style="max-width:100%;">${zones}${rects}${aisles}</svg>`;
  }

  let cellBlocks = {};   // cellBlocks[rowNum] = [{r0,r1,t0,t1,state,blockId,stock}, ...] — из /api/cells/rows
  let rowMeta = {};      // rowMeta[rowNum] = {rackCount, tierCount}
  let blockById = {};    // blockId -> {block, rowNum} — чтобы по клику найти ячейку целиком

  function populateCellStateFromApi(apiRows){
    cellBlocks = {};
    rowMeta = {};
    blockById = {};
    apiRows.forEach(row => {
      rowMeta[row.row_num] = {rackCount: row.rack_count, tierCount: row.tier_count, label: row.label || null, aisleAfter: row.aisle_after === true,
        cellSize: [row.cell_width_cm, row.cell_depth_cm, row.cell_height_cm].map(v => v == null ? null : Number(v))};
      cellBlocks[row.row_num] = row.blocks.map(b => {
        const block = {
          r0: b.rack_start, r1: b.rack_end, t0: b.tier_start, t1: b.tier_end,
          state: b.state, blockId: b.id, stock: b.stock || [], fill: b.fill || null,
          label: b.label || null, stock1c: b.stock_1c || [], defectZone: b.defect_zone === true,
        };
        blockById[b.id] = {block, rowNum: row.row_num};
        return block;
      });
    });
  }

  // Заполнение ячейки — приблизительно, по объёму: размер ячейки ряда ×
  // габариты товара (сервер, argus-api/src/cells/fill.js; владелец
  // 28.09.2026). Процента нет — штриховка «лежит, сколько места — неизвестно».
  function cellFillPaint(fill){
    if(!fill || fill.pct == null) return { cls: ' fill-unknown', style: '' };
    const tone = fill.pct > 100 ? 'over' : fill.pct > 75 ? 'high' : fill.pct >= 40 ? 'mid' : 'low';
    return { cls: ' fill-' + tone, style: '--p:' + Math.min(100, fill.pct) + '%;' };
  }
  function cellFillText(fill){
    if(!fill) return '';
    if(fill.pct != null){
      return 'Заполнено ≈ ' + fill.pct + '%' + (fill.freeLiters > 0 ? ' · свободно ≈ ' + fill.freeLiters.toLocaleString('ru-RU') + ' л'
        : fill.pct > 100 ? ' — больше, чем вмещает по размерам' : '');
    }
    return fill.reason === 'no_cell_size'
      ? 'Заполнение неизвестно: не задан размер ячеек ряда (карандаш «Править ячейки»)'
      : 'Заполнение неизвестно: у «' + (fill.product || 'товара') + '» нет габаритов';
  }
  // Имя ряда, если владелец его задал, иначе номер. Оно же становится первой
  // частью адреса ячейки, поэтому берётся здесь, в одном месте: адрес должен
  // читаться одинаково и на карте, и в поиске, и в подсказке при приёмке.
  function rowLabel(rowNum){
    const meta = rowMeta[rowNum];
    return (meta && meta.label) || rowNum;
  }

  // Адрес ячейки — «ряд.стеллаж.ярус» (решение владельца 27.09.2026): «1.7.3» —
  // ряд 1, стеллаж 7, ярус 3; под схемой ряда стеллажи и подписаны «1.7».
  // Сервер пишет так же (argus-api/src/cells/label.js). Имя ячейки из 1С
  // («01-01-001») не показываем — с картой оно не совпадает.
  function blockAddr(rowNum, block){
    if(Number(rowNum) === 0) return 'Склад';   // общее место без ячеек (06.10.2026)
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

  // Count existing addresses, not every slot in the enclosing rectangle:
  // imported layouts can have gaps, and a merged address remains one cell.
  function warehouseStats(){
    // Ряд 0 — общее место «Склад», не ряд схемы (06.10.2026).
    const rows = Object.keys(rowMeta).map(Number).filter(n => n !== 0 && (cellBlocks[n] || []).length).sort((a,b) => a-b);
    let rackTotal=0,cellTotal=0,occupiedUnits=0;
    const perRow=rows.map(rowNum=>{
      const blocks=cellBlocks[rowNum],total=blocks.length;
      const occ=blocks.filter(b=>b.state==='occupied').length;
      const racks=new Set();blocks.forEach(b=>{for(let r=b.r0;r<=b.r1;r++)racks.add(r);});
      rackTotal+=racks.size;cellTotal+=total;occupiedUnits+=occ;
      return {rowNum,total,occ,free:total-occ};
    });
    return {rows,rackTotal,cellTotal,occupiedUnits,perRow};
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
      `занято ${s.occupiedUnits} ячеек`,
    ].join(' · ');
  }

  // Показывать ли пустые стеллажи. У живого склада ряд — это сто с лишним
  // стеллажей в семь ярусов, а занято в нём двадцать ячеек: рисовать всё
  // подряд значит выдать простыню на семьсот клеток с горизонтальной
  // прокруткой, в которой глазами ничего не найти.
  let whShowEmpty = {};
  function toggleRowEmpty(rowNum){
    whShowEmpty[rowNum] = !whShowEmpty[rowNum];
    renderWarehouseMap();
  }
  window.toggleRowEmpty = toggleRowEmpty;

  function renderRackRowHtml(rowNum){
    const meta = rowMeta[rowNum];
    const rackCount = meta.rackCount, tierCount = meta.tierCount;
    let occ = 0, tot = 0;

    cellBlocks[rowNum].forEach(b => {
      tot++;
      if(b.state === 'occupied') occ++;
    });

    // Какие стеллажи вообще показывать. Свёрнуто — только те, где что-то
    // лежит; развёрнуто — те, где ЕСТЬ ячейки. Даже в развёрнутом виде
    // не рисуем пустые колонки сетки: в справочнике ячейки идут с пропусками,
    // и колонка без единой полки — это место, которого на складе нет.
    const occupiedRacks = new Set();
    const existingRacks = new Set();
    cellBlocks[rowNum].forEach(b => {
      for(let r = b.r0; r <= b.r1; r++){
        existingRacks.add(r);
        if(b.state === 'occupied') occupiedRacks.add(r);
      }
    });
    const collapsed = !whShowEmpty[rowNum] && occupiedRacks.size > 0;
    const visible = [...(collapsed ? occupiedRacks : existingRacks)].sort((a, b) => a - b);
    // Стеллаж -> его колонка на экране. Пропуски схлопываются, но не молча:
    // между несоседними стеллажами рисуется разрыв, иначе человек решит, что
    // склад устроен вплотную, и промахнётся мимо полки.
    // Разрыв — СВОЯ узкая колонка, а не элемент поверх соседней ячейки.
    // Первая версия клала его в ту же колонку, что и следующий стеллаж, и он
    // просто уходил под неё: свёрнутый ряд выглядел сплошным, а подписи
    // прыгали через номер без всякого объяснения.
    const colOf = new Map();
    // Первая колонка — номера ярусов, счётом снизу вверх: 1, 2, 3. Вторая
    // полка снизу и есть вторая, как бы её ни назвали в 1С. Номер «10» у
    // одного из ярусов — след того, что его доставили позже, когда привезли
    // балки; к устройству склада это отношения не имеет. Настоящее имя не
    // теряется — оно на самой ячейке («07-10-022»), и работник сверяет
    // наклейку, а не ярус.
    const colWidths = ['34px'];
    let col = 1, prev = null;
    const gaps = [];
    visible.forEach(r => {
      if(prev !== null && r !== prev + 1){
        col += 1; colWidths.push('18px');
        gaps.push({ col, from: prev + 1, to: r - 1 });
      }
      col += 1; colWidths.push('64px');
      colOf.set(r, col);
      prev = r;
    });
    const shownCols = col;
    const gridCols = colWidths.join(' ');

    // Дырка между полками — это не пустота, это высокий отсек. Если на этом
    // стеллаже второй полки нет, а третья есть, значит балку между ними
    // не ставили: первая ячейка просто выше. Поэтому ячейка растёт вверх,
    // пока над ней нет полки.
    //
    // Но только до САМОЙ ВЕРХНЕЙ полки этого стеллажа: выше неё воздух,
    // а не ячейка. Тянуть до потолка значило бы нарисовать место, куда
    // ничего не положишь.
    const has = new Set();
    const topTier = new Map();
    cellBlocks[rowNum].forEach(b => {
      for(let r = b.r0; r <= b.r1; r++){
        for(let t = b.t0; t <= b.t1; t++) has.add(r + ':' + t);
        topTier.set(r, Math.max(topTier.get(r) || 0, b.t1));
      }
    });
    function growUp(b){
      let top = b.t1;
      // Потолок роста — самая верхняя полка среди стеллажей этой ячейки.
      let limit = Infinity;
      for(let r = b.r0; r <= b.r1; r++) limit = Math.min(limit, topTier.get(r) || 0);
      while(top + 1 <= limit){
        let free = true;
        for(let r = b.r0; r <= b.r1; r++){
          if(has.has(r + ':' + (top + 1))){ free = false; break; }
        }
        if(!free) break;
        top += 1;
      }
      return top;
    }

    let cellsHtml = '';
    cellBlocks[rowNum].forEach(b => {
      if(!colOf.has(b.r0)) return;
      const addr = blockAddr(rowNum, b);
      const tTop = growUp(b);
      const tall = tTop > b.t1;
      const mergedClass = (b.r0 !== b.r1 || b.t0 !== b.t1) ? ' merged' : '';
      const gridRowStart = tierCount - tTop + 1;
      const gridRowSpan = tTop - b.t0 + 1;
      const c0 = colOf.get(b.r0), c1 = colOf.get(b.r1) || c0;
      const paint = b.state === 'occupied' ? cellFillPaint(b.fill) : { cls: '', style: '' };
      const style = ` style="grid-column:${c0} / span ${c1 - c0 + 1}; grid-row:${gridRowStart} / span ${gridRowSpan};${paint.style}"`;
      // Балок рисуем ровно столько, сколько ярусов ячейка проглотила: одна
      // граница — одна недостающая балка. Повторяющийся фон этого не умел
      // и дорисовывал лишнюю линию у верхнего края, где полка как раз есть.
      //
      // Позиция в процентах, а не в пикселях: высота ячейки зависит от
      // промежутков в сетке, и считать её в коде значит однажды разъехаться
      // с вёрсткой.
      const missing = tTop - b.t1;
      let beams = '';
      for(let k = 1; k <= missing; k++){
        beams += `<i class="wh-beam" style="bottom:${(k / gridRowSpan * 100).toFixed(3)}%"></i>`;
      }
      const hint = (tall
        ? addr + ' — высокий отсек: ' + missing + ' ' + pluralRu(missing, 'балки', 'балок', 'балок') + ' не хватает'
        : addr) + (b.state === 'occupied' ? ' · ' + cellFillText(b.fill) : '') + (b.defectZone ? ' · ячейка брака' : '');
      cellsHtml += `<div class="wh-cell in-grid ${b.state}${mergedClass}${tall ? ' tall' : ''}${paint.cls}" data-row="${rowNum}" data-id="${b.r0}" data-tier="${b.t0}" data-addr="${escapeHTML(addr)}" data-state="${b.state}" data-block-id="${b.blockId}"${style} onclick="selectCell(this)" title="${escapeHTML(hint)}">${beams}${b.defectZone ? '<b class="wh-defect-mark" aria-hidden="true">Б</b>' : ''}</div>`;
    });

    let labelsHtml = '';
    for(let t = 1; t <= tierCount; t++){
      labelsHtml += `<div class="wh-tier-label" style="grid-column:1; grid-row:${tierCount - t + 1};">${t}</div>`;
    }
    visible.forEach(r => {
      const c = colOf.get(r);
      labelsHtml += `<div class="wh-rack-label" data-rack="${r}" style="grid-column:${c}; grid-row:${tierCount + 1};">${escapeHTML(String(rowLabel(rowNum)))}.${r}</div>`;
    });
    gaps.forEach(g => {
      const many = g.to > g.from;
      const what = many ? `стеллажи ${g.from}–${g.to}` : `стеллаж ${g.from}`;
      labelsHtml += `<div class="wh-rack-gap" style="grid-column:${g.col}; grid-row:1 / span ${tierCount};"`
        + ` title="Здесь пусто: ${what}. Нажмите «Показать весь ряд», чтобы увидеть."></div>`;
    });

    const statsText = !tot ? 'ячеек нет' : `занято ячеек ${occ} из ${tot}`;
    const statsTitle = 'Вместимость ячеек не задана. Количество товара доступно в карточке ячейки.';
    const editing = editingRowNum === rowNum;

    // Правка ячеек живёт здесь же, в панели ряда, а не в отдельном окне
    // настроек: ряд человек уже выбрал кликом по схеме, спрашивать второй раз
    // «какой ряд правим» незачем. Карандаш переключает эту же панель между
    // просмотром и правкой — уходить с неё никуда не нужно.
    const body = editing
      ? rowEditorHtml(rowNum)
      : `<div class="wh-rack-grid" style="grid-template-columns:${gridCols}; grid-template-rows:repeat(${tierCount}, 32px) auto;">${cellsHtml}${labelsHtml}</div>`
        + (occupiedRacks.size === 0 ? '' : `<button class="wh-collapse-btn" type="button" onclick="toggleRowEmpty(${rowNum})">${collapsed
            ? 'Показать весь ряд — ' + existingRacks.size + ' ' + pluralRu(existingRacks.size, 'стеллаж', 'стеллажа', 'стеллажей')
            : 'Свернуть до занятых — ' + occupiedRacks.size + ' из ' + existingRacks.size}</button>`);

    return `<div class="wh-row-group${editing ? ' editing' : ''}" id="fp-row-${rowNum}">
      ${whPanelActionsHtml()}
      <div class="wh-row-group-head">
        <button class="wh-row-group-title wh-renamable" type="button" onclick="startRename('row', ${rowNum})"
                title="Нажмите, чтобы переименовать ряд">Ряд ${escapeHTML(String(rowLabel(rowNum)))}</button>
        <span class="wh-row-group-stats" title="${statsTitle}">${statsText}</span>
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

  // Размер ячейки ряда: все три пусто — «не задан».
  async function saveCellSize(e, rowNum){
    e.preventDefault();
    const f = e.target;
    const vals = [f.w.value, f.d.value, f.h.value].map(v => v.trim());
    const body = vals.every(v => v === '')
      ? { widthCm: null, depthCm: null, heightCm: null }
      : { widthCm: vals[0], depthCm: vals[1], heightCm: vals[2] };
    try{
      await apiFetch('/api/cells/rows/' + rowNum + '/cell-size', { method: 'PATCH', body });
      populateCellStateFromApi(await apiFetch('/api/cells/rows'));
      refreshRackRowDOM(rowNum);
      showWhToast(body.widthCm === null ? 'Размер ячеек ряда снят' : 'Размер ячеек сохранён — заполнение посчитано');
    } catch(err){ showWhToast('Не сохранилось: ' + err.message); }
  }
  window.saveCellSize = saveCellSize;

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
      const paint = block.state === 'occupied' ? cellFillPaint(block.fill) : { cls: '', style: '' };
      return `<div class="wh-big-cell ${block.state}${isMerged ? ' merged' : ''}${paint.cls}"
        style="grid-column:${block.r0} / span ${wide}; grid-row:${gridRowOf(block.t1)} / span ${tall};${paint.style}"
        title="${escapeHTML(addr)}">
        <span class="wh-big-cell-label">${escapeHTML(addr)}</span>
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

    const size = meta.cellSize || [];
    const num = (v) => v == null ? '' : String(v).replace('.', ',');
    return `
      <form class="wh-cellsize" onsubmit="saveCellSize(event, ${rowNum})">
        <div class="wh-cellsize-title">Размер одной ячейки ряда, см
          <span>Место стеллажа: ширина, глубина и высота яруса. По ним и габаритам товаров считается, насколько заполнена ячейка;
            объединённая — сумма своих мест.</span></div>
        <label>Ширина<input name="w" inputmode="decimal" value="${num(size[0])}" aria-label="Ширина ячейки, см"></label>
        <label>Глубина<input name="d" inputmode="decimal" value="${num(size[1])}" aria-label="Глубина ячейки, см"></label>
        <label>Высота<input name="h" inputmode="decimal" value="${num(size[2])}" aria-label="Высота ячейки, см"></label>
        <button type="submit">Сохранить размер</button>
      </form>
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
    if(!await askConfirm(question)) return;

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

    // Общее место «Склад» (адресное хранение выключено, 06.10.2026) — не ряд
    // схемы: на карте его не рисуем, а говорим строкой над схемой.
    const general = apiRows.find(r => r.general);
    const drawRows = apiRows.filter(r => !r.general);
    const rowOrder = drawRows.map(r => r.row_num);
    const aisleAfter = drawRows.map(r => r.aisle_after === true);
    const zoneOrder = apiZones.map(z => ({id: z.id, label: zoneLabel(z.id)}));
    const svg = buildFloorplanSVGCustom(rowOrder, aisleAfter, zoneOrder);
    const rowsHtml = drawRows.map(r => renderRackRowHtml(r.row_num)).join('');
    const generalStock = general ? general.blocks.flatMap(b => b.stock || []) : [];
    const generalUnits = generalStock.reduce((n, s) => n + Number(s.qty || 0), 0);
    const generalSkus = new Set(generalStock.filter(s => Number(s.qty) !== 0).map(s => s.companyId + '|' + s.sku)).size;
    const generalMinus = new Set(generalStock.filter(s => Number(s.qty) < 0).map(s => s.companyId + '|' + s.sku)).size;
    const addressOff = whSettings ? whSettings.address_storage === false : Boolean(general);
    const generalHtml = general && (addressOff || generalSkus)
      ? '<div class="wh-search-banner wh-general-banner" role="status"><b>' + (addressOff ? 'Адресное хранение выключено.' : 'В общем месте «Склад» ещё лежит товар.') + '</b> '
        + 'В общем месте «Склад»: ' + nfmt(generalUnits) + ' шт., ' + nfmt(generalSkus) + ' ' + pluralRu(generalSkus, 'товар', 'товара', 'товаров') + '. '
        + (addressOff ? 'При приёмке и сборке ячейку не выбирают. ' : 'Разложите его по ячейкам. ')
        + (generalMinus ? 'У ' + nfmt(generalMinus) + ' ' + pluralRu(generalMinus, 'товара', 'товаров', 'товаров') + ' собрано сверх учёта — минус, поправьте файлом остатков («Сверить с документом»). ' : '')
        + '<a href="#" onclick="switchView(\'settings\'); return false;">Настройки</a></div>'
      : '';

    document.getElementById('whMapWrap').innerHTML = `
      <div class="wh-map-shell">
      <div class="wh-map">
        <div class="wh-map-head">
          <div class="wh-status-line" id="whStatusLine"></div>
          <div class="wh-search">
            <input type="search" id="whSearchInput" autocomplete="off" spellcheck="false"
                   placeholder="Артикул, название или штрихкод"
                   oninput="onWhSearchInput()" onkeydown="onWhSearchKey(event)">
            <div class="wh-search-drop" id="whSearchDrop" hidden></div>
          </div>
          ${IS_MANAGER ? '' : `<button class="wh-configure-btn ghost" type="button" onclick="openAlign()">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 5h10M3 11h10M6 2l-3 3 3 3M10 8l3 3-3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Сверить с документом
          </button>`}
          ${IS_MANAGER ? '' : `<button class="wh-configure-btn ghost" type="button" onclick="openStockLoad()">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 11V3m0 0L5 6m3-3l3 3M3 13h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Загрузить остатки
          </button>`}
          <button class="wh-configure-btn ghost" type="button" onclick="exportWarehouse()">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Выгрузить остатки
          </button>
          <button class="wh-configure-btn" type="button" onclick="openWhSettings()">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            Настроить склад
          </button>
        </div>
        ${generalHtml}
        <div class="wh-floorplan">
          <div class="wh-floorplan-head">
            <div class="wh-floorplan-title">Схема склада — ряды и проходы</div>
          </div>
          <div id="fpSvgWrap">${svg}</div>
        </div>
        <div class="wh-search-banner" id="whSearchBanner" hidden></div>
        <div class="wh-legend">
          <div class="wh-legend-item"><i class="wh-cell empty"></i>Свободна</div>
          <div class="wh-legend-item"><i class="wh-cell occupied fill-low" style="--p:30%"></i>до 40%</div>
          <div class="wh-legend-item"><i class="wh-cell occupied fill-mid" style="--p:60%"></i>до 75%</div>
          <div class="wh-legend-item"><i class="wh-cell occupied fill-high" style="--p:90%"></i>почти полная</div>
          <div class="wh-legend-item"><i class="wh-cell occupied fill-unknown"></i>сколько места — неизвестно</div>
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
     умеет искать по артикулу, названию и штрихкоду и сразу возвращает, в каких
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
      // Адрес «ряд.стеллаж.ярус» (1.7.3) — это ячейка, а не товар.
      whSearchCell = (data && data.cell) || null;
    } catch(e){
      whSearchResults = [];
      whSearchCell = null;
      drop.hidden = false;
      drop.innerHTML = `<div class="wh-search-empty">Не удалось найти: ${escapeHTML(e.message)}</div>`;
      return;
    }
    renderWhSearchDrop();
  }

  let whSearchCell = null;
  function renderWhSearchDrop(){
    const drop = document.getElementById('whSearchDrop');
    if(!drop) return;
    drop.hidden = false;
    const c = whSearchCell;
    const cellItem = !c ? ''
      : c.exists
        ? `<div class="wh-search-item" onclick="pickWhSearchCell()">
            <span class="wh-search-item-sku">Ячейка ${escapeHTML(c.cell)}</span>
            <span class="wh-search-item-name">${c.empty ? 'пустая' : c.items.length + ' ' + pluralRu(c.items.length, 'товар', 'товара', 'товаров')}</span>
            <span class="wh-search-item-where">${c.empty ? '' : Number(c.totalUnits).toLocaleString('ru-RU') + ' шт'}</span>
          </div>`
        : `<div class="wh-search-empty">Ячейки ${escapeHTML(c.cell)} на складе нет. Адрес — ряд.стеллаж.ярус, например 1.7.3</div>`;
    if(whSearchResults.length === 0 && !cellItem){
      drop.innerHTML = '<div class="wh-search-empty">Ничего не нашлось</div>';
      return;
    }
    drop.innerHTML = cellItem + whSearchResults.map((p, i) => {
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

  function pickWhSearchCell(){
    const c = whSearchCell;
    if(!c || !c.cellBlockId) return;
    hideWhSearchDrop();
    openCellById(c.cellBlockId);
  }
  window.pickWhSearchCell = pickWhSearchCell;

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
      const name = blockAddr(l.row, { r0: l.rackFrom, r1: l.rackTo, t0: l.tierFrom, t1: l.tierTo });
      return `<span class="wh-search-addr" onclick="scrollToWhRow(${l.row})">${escapeHTML(name)}<i>${l.qty.toLocaleString('ru-RU')} шт</i></span>`;
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
    whSearchCell = null;
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
    closeWhDetailPanel();
    showWhPanel('whSummary');
    document.querySelectorAll('.wh-row-rect').forEach(r=>r.classList.remove('selected-row'));
    renderWhSummary();
  }
  function whPanelActionsHtml(){
    return '<div class="stock-map-actions"><button class="wh-panel-back" type="button" onclick="showWhSummary()">← Назад к сводке</button>'
      + whPanelCloseHtml() + '</div>';
  }
  function whPanelCloseHtml(){
    return '<button class="stock-map-close" type="button" onclick="closeWhPanels()" aria-label="Убрать все панели карты" title="Закрыть панели">'
      + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>';
  }
  function closeWhPanels(){
    closeWhDetailPanel();
    clearWhSearch();
    document.querySelectorAll('#whContent > .wh-row-group').forEach(panel => panel.classList.remove('visible'));
    document.querySelectorAll('.wh-row-rect').forEach(row => row.classList.remove('selected-row'));
  }
  window.closeWhPanels = closeWhPanels;

  // Ждёт решения — запись pending, на которую ещё не ответили. Решение не
  // меняет исходную запись (журнал только дописывается), поэтому без
  // answered уже принятое висело «требует внимания» вечно.
  function isWaiting(e){ return e.status === 'pending' && !e.answered; }
  function isUrgentWaiting(e){ return Boolean(e.urgent) && isWaiting(e); }
  // Записка грузчика о товаре (третье задание 27.09.2026): решать там нечего —
  // её отмечают «Принял к сведению».
  // «Принял к сведению» — записка грузчика о товаре и предупреждение «зона
  // склада продавца заполнена» (02.10.2026).
  function isNote(e){ return e.entity_type === 'item_note' || e.entity_type === 'vw_zone'; }
  // Текст срочной отметки уже начинается с «ОЧЕНЬ ВАЖНО:» — рядом с красной
  // меткой эти слова дублировались бы.
  function urgentText(text){
    const t = String(text || '').replace(/^ОЧЕНЬ ВАЖНО:\s*/, '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // Своё окно подтверждения вместо браузерного «Подтвердите действие на
  // argus-ai.online»: то выглядит как чужое предупреждение, пугает и ничего
  // не выделяет. Первый абзац вопроса — заголовок, остальное — пояснение.
  // Enter — «Да», Escape и клик мимо — «Отмена».
  const DANGER_WORDS = /^(Удалить|Разобрать|Отключить|Отменить|Отклонить|Убрать|Внимание)/;
  function askConfirm(message){
    return new Promise(function(resolve){
      const parts = String(message || '').split('\n\n');
      const title = parts.shift();
      const overlay = document.createElement('div');
      overlay.className = 'ask-overlay';
      overlay.innerHTML = '<div class="ask-box' + (DANGER_WORDS.test(title) ? ' danger' : '') + '" role="dialog" aria-modal="true">'
        + '<div class="ask-title"></div><div class="ask-text"></div>'
        + '<div class="ask-actions"><button type="button" class="wh-onboarding-btn ask-cancel">Отмена</button>'
        + '<button type="button" class="wh-onboarding-btn primary ask-ok">Да</button></div></div>';
      overlay.querySelector('.ask-title').textContent = title;
      overlay.querySelector('.ask-text').textContent = parts.join('\n\n');
      function done(answer){
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(answer);
      }
      function onKey(e){
        if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); done(false); }
        else if(e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); done(true); }
      }
      overlay.addEventListener('click', function(e){ if(e.target === overlay) done(false); });
      overlay.querySelector('.ask-cancel').onclick = function(){ done(false); };
      overlay.querySelector('.ask-ok').onclick = function(){ done(true); };
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      overlay.querySelector('.ask-ok').focus();
    });
  }

  function renderWhSummary(){
    const panel = document.getElementById('whSummary');
    if(!panel) return;
    const s = warehouseStats();
    const top = [...s.perRow].sort((a,b) => b.occ - a.occ).slice(0,3);
    const freeRow = [...s.perRow].sort((a,b) => b.free - a.free)[0];
    const pending = journalEntries.filter(isWaiting);

    const topHtml = top.length
      ? top.map(r => `
          <div class="wh-summary-row-item">
            <span>Ряд ${escapeHTML(String(rowLabel(r.rowNum)))}</span>
            <span class="wh-summary-row-pct">занято ${r.occ} из ${r.total}</span>
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
      ${whPanelCloseHtml()}
      <div class="wh-summary-stats">
        <div class="wh-summary-stat"><div class="num">${s.cellTotal}</div><div class="lbl">всего мест</div></div>
        <div class="wh-summary-stat"><div class="num">${s.occupiedUnits}</div><div class="lbl">занято</div></div>
        <div class="wh-summary-stat"><div class="num">${s.cellTotal - s.occupiedUnits}</div><div class="lbl">свободно</div></div>
        <div class="wh-summary-stat"><div class="num">—</div><div class="lbl">вместимость не задана</div></div>
      </div>
      <div class="wh-summary-cols">
        <div class="wh-summary-col">
          <div class="wh-summary-col-title">Больше всего занятых ячеек</div>
          ${topHtml}
        </div>
        <div class="wh-summary-col">
          <div class="wh-summary-col-title">Больше всего незанятых ячеек</div>
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
    const current = document.getElementById('fp-row-' + n);
    if(current && current.classList.contains('visible')){ showWhSummary(); return; }
    closeWhDetailPanel();
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
    closeWhDetailPanel();
    showWhPanel('whZoneDetail');
    document.querySelectorAll('.wh-row-rect').forEach(r=>r.classList.remove('selected-row'));

    const items = dropzoneData[id] || [];
    const detail = document.getElementById('whZoneDetail');
    const zoneName = zoneLabels[id] || id;
    const backBtn = whPanelActionsHtml();

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
          <span class="wh-zone-item-client">${escapeHTML(String(it.client || ''))}</span>
          <span class="wh-zone-item-meta">${escapeHTML(String(it.sku || ''))}</span>
        </div>
        <div class="wh-zone-item-meta">${escapeHTML(String(it.qty))}</div>
        <span class="wh-zone-status ${it.direction}">${it.direction === 'in' ? 'ожидает размещения' : 'ожидает отгрузки'}</span>
      </div>
    `).join('');

    detail.innerHTML = `
      ${backBtn}
      <button class="wh-detail-id wh-renamable" type="button" onclick="startRename('zone', '${id}')" title="Нажмите, чтобы переименовать зону">${escapeHTML(String(zoneName))}</button>
      <div class="wh-detail-status occupied">${items.length} ${pluralRu(items.length, 'позиция', 'позиции', 'позиций')}</div>
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
    const stock1c = (entry && entry.block.stock1c) || [];

    // Что говорит про эту полку учёт владельца. Отдельным блоком и с прямой
    // оговоркой про количество: регистр отвечает «этот товар лежит здесь»,
    // но не «сколько». Дописать сюда число было бы выдумкой, а на выдуманных
    // числах этот склад уже жил полгода.
    // Список из 1С — своя вёрстка, а не чужая сетка «артикул · количество ·
    // клиент»: количества здесь нет вовсе, и втискивание в три колонки резало
    // и артикул, и название многоточием, хотя место было.
    const from1c = stock1c.length === 0 ? '' : `
      <div class="wh-1c">
        <div class="wh-1c-head">
          <span>По данным 1С</span>
          <span class="wh-1c-count">${stock1c.length} ${pluralRu(stock1c.length, 'артикул', 'артикула', 'артикулов')}</span>
        </div>
        <div class="wh-1c-list">
          ${stock1c.map(it => `
            <div class="wh-1c-item">
              <div class="wh-1c-sku">${escapeHTML(it.sku)}</div>
              <div class="wh-1c-name">${escapeHTML(it.name || 'название не выгружено')}</div>
            </div>
          `).join('')}
        </div>
        <div class="wh-1c-foot">Сколько здесь штук — учёт склада не хранит.
          Появится после первой приёмки через Аргус.</div>
      </div>`;

    // Что лежит — полностью (владелец 27.09.2026): товар, продавец, артикул,
    // штрихкод, артикул WB, количество, годное или брак, когда положили.
    // Карта держит в памяти только артикул и количество по всем ячейкам;
    // подробности приходят по нажатию — одной ячейкой.
    let rows;
    if(stock.length === 0){
      rows = (stock1c.length === 0
        ? '<div class="wh-detail-note">Ячейка пуста</div>'
        : '') + from1c;
    } else {
      const totalQty = stock.reduce((sum, it) => sum + Number(it.qty || 0), 0);
      const fill = blockById[el.dataset.blockId] && blockById[el.dataset.blockId].block.fill;
      const paint = cellFillPaint(fill);
      rows = `
        <div class="wh-detail-row">
          <span>Всего</span>
          <span>${totalQty.toLocaleString('ru-RU')} шт</span>
        </div>
        <div class="wh-fill-line${fill && fill.pct != null ? '' : ' muted'}"><i class="wh-cell occupied${paint.cls}" style="${paint.style}"></i>${escapeHTML(cellFillText(fill))}</div>
        <div class="wh-cell-items" id="whCellItems" data-block="${escapeHTML(el.dataset.blockId)}">
          <div class="wh-detail-note">Загружаю, что лежит…</div>
        </div>
      ` + from1c;
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
        <div class="wh-detail-id">${escapeHTML(displayAddr)}</div>
        <div class="wh-detail-status ${state}">${statusLabel}</div>
        ${rows}
        <button class="wh-onboarding-btn" style="margin-top:14px; width:100%;" type="button"
                data-history-cell="${escapeHTML(el.dataset.blockId)}" data-history-label="${escapeHTML(displayAddr)}">Что здесь происходило</button>
        ${stock.length ? `<button class="wh-onboarding-btn" style="margin-top:8px; width:100%;" type="button" onclick="exportCell('${el.dataset.blockId}')">Выгрузить в Excel</button>` : ''}
        ${entry ? `<button class="wh-onboarding-btn" style="margin-top:8px; width:100%;" type="button" onclick="toggleDefectZone('${el.dataset.blockId}')">${entry.block.defectZone ? 'Снять отметку «ячейка брака»' : 'Сделать ячейкой брака'}</button>
        <div class="wh-detail-note" style="margin-top:6px;">${entry.block.defectZone ? 'Ячейка брака: сюда Аргус первой предложит грузчику класть брак продавцов.' : 'Ячейку брака Аргус предложит грузчику первой, когда тот отмечает брак.'}</div>` : ''}
      </div>
    `;
    keepStill(el, () => detail.classList.add('open'));
    if(stock.length) loadCellItems(el.dataset.blockId);
  }

  // Ячейка брака (владелец 02.10.2026): её Аргус первой предлагает грузчику,
  // когда тот отмечает брак, — после ячеек, где уже лежит брак этого продавца.
  async function toggleDefectZone(blockId){
    const entry = blockById[blockId];
    if(!entry) return;
    const on = !entry.block.defectZone;
    try{ await apiFetch('/api/defects/zones/' + encodeURIComponent(blockId), { method: 'PATCH', body: { on } }); }
    catch(e){ showWhToast('Не получилось: ' + e.message); return; }
    entry.block.defectZone = on;
    const el = document.querySelector('.wh-cell[data-block-id="' + blockId + '"]');
    if(el){
      el.querySelector('.wh-defect-mark')?.remove();
      if(on) el.insertAdjacentHTML('beforeend', '<b class="wh-defect-mark" aria-hidden="true">Б</b>');
      selectCell(el);
    }
    showWhToast(on ? 'Ячейка ' + (el ? el.dataset.addr : '') + ' — ячейка брака' : 'Отметка «ячейка брака» снята');
  }
  window.toggleDefectZone = toggleDefectZone;

  const CELL_QUALITY_CLASS = { good: '', defective: ' bad', packaging_defect: ' bad' };
  async function loadCellItems(blockId){
    let d;
    try{ d = await apiFetch('/api/cells/blocks/' + encodeURIComponent(blockId) + '/contents'); }
    catch(e){
      const box = document.getElementById('whCellItems');
      if(box && box.dataset.block === blockId) box.innerHTML = '<div class="wh-detail-note">Не удалось загрузить: ' + escapeHTML(e.message) + '</div>';
      return;
    }
    const box = document.getElementById('whCellItems');
    if(!box || box.dataset.block !== blockId) return;   // уже выбрали другую ячейку
    const when = (v) => v ? new Date(v).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    const placed = (it) => {
      const last = when(it.placedAt), first = when(it.firstPlacedAt);
      return first === last ? last : last + ' (первый раз — ' + first + ')';
    };
    const line = (k, v) => '<dt>' + k + '</dt><dd>' + escapeHTML(v || '—') + '</dd>';
    box.innerHTML = d.items.length ? d.items.map(it => '<div class="wh-cell-item">'
      + '<div class="wh-cell-item-top"><span class="wh-cell-item-name">' + escapeHTML(it.name) + '</span>'
      +   '<span class="wh-cell-item-qty' + (CELL_QUALITY_CLASS[it.quality] || '') + '">' + it.qty.toLocaleString('ru-RU') + ' шт</span></div>'
      + '<dl class="wh-cell-item-grid">'
      +   line('Продавец', it.seller) + line('Артикул', it.sku) + line('Штрихкод', it.barcode)
      +   line('Артикул WB', it.wbArticle) + line('Состояние', it.qualityName) + line('Положили', placed(it))
      + '</dl></div>').join('')
      : '<div class="wh-detail-note">Ячейка пуста</div>';
  }

  // Перейти к ячейке по id и открыть её карточку: из поиска по адресу.
  function openCellById(blockId){
    const entry = blockById[blockId];
    if(!entry){ showWhToast('Этой ячейки нет на карте — обновите страницу.'); return; }
    const find = () => document.querySelector('#fp-row-' + entry.rowNum + ' .wh-cell[data-block-id="' + blockId + '"]');
    // Свёрнутый ряд показывает только занятые стеллажи: пустую ячейку ищем в развёрнутом.
    if(!find() && !whShowEmpty[entry.rowNum]){ whShowEmpty[entry.rowNum] = true; renderWarehouseMap(); }
    focusRow(entry.rowNum);
    const el = find();
    if(el) selectCell(el);
  }
  window.openCellById = openCellById;

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
    journalScope = null;
    journalHistoryPages = 1;
    journalPendingPages = 1;
    document.getElementById('dnPopover').classList.remove('open');
    renderJournalCalendar();
    loadJournal(true);
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
  let attentionOnly = false;

  // Категории журнала (задание 28.09.2026, п. 3). Какая у записи категория,
  // решает сервер (поле category в GET /api/journal); здесь — только вид:
  // значок, цвет, подпись. Порядок — как у владельца.
  const ICO = function(d){
    return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"'
      + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  };
  const JOURNAL_CATS = [
    ['inbound',  'Приходы',                '#6FB3E0', ICO('<path d="M8 2v7M5 6l3 3 3-3"/><path d="M2.5 10.5v3h11v-3"/>')],
    ['labor',    'Сборка',                 '#5FAFA6', ICO('<circle cx="5" cy="12.6" r="1.4"/><path d="M1.8 2.5h2l2.1 8.3h7.3"/><rect x="7.2" y="4" width="5.3" height="4.6" rx=".8"/>')],
    ['supplies', 'Поставки',               '#F08FA8', ICO('<path d="M1.5 4.5h8v6h-8z"/><path d="M9.5 6.5h3l2 2v2h-5"/><circle cx="4.5" cy="12" r="1.3"/><circle cx="11.5" cy="12" r="1.3"/>')],
    ['orders',   'Заказы с маркетплейсов', '#E0A458', ICO('<path d="M3 5.5h10l-.8 8H3.8z"/><path d="M6 5.5V4a2 2 0 0 1 4 0v1.5"/>')],
    ['wb',       'Обмен с WB',             '#C77DDB', ICO('<path d="M2.5 5.5h10M10 3l2.5 2.5L10 8"/><path d="M13.5 10.5h-10M6 8l-2.5 2.5L6 13"/>')],
    ['onec',     'Обмен с 1С',             '#E3C75A', ICO('<ellipse cx="8" cy="4" rx="5" ry="1.8"/><path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4"/><path d="M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8"/>')],
    ['docs',     'Акты и документы',       '#B9B2A5', ICO('<path d="M4 2.5h5.5L12.5 6v7.5H4z"/><path d="M6 8.5h4.5M6 11h3"/>')],
    ['cells',    'Склад и ячейки',         '#D98E6E', ICO('<rect x="2.5" y="2.5" width="11" height="11" rx="1.6"/><path d="M2.5 8h11M8 2.5v11"/>')],
    ['defects',  'Брак',                   '#E07A6A', ICO('<path d="M8 2 1.8 13h12.4z"/><path d="M8 6.5v3M8 11.4v.1"/>')],
    ['staff',    'Сотрудники',             '#86C08A', ICO('<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"/>')],
    ['agent',    'Кладовщик',              '#9AA7FF', '<svg width="16" height="16" viewBox="0 0 22 22" aria-hidden="true"><use href="#icon-warehouse-agent"/></svg>'],
  ].map(function(c){ return { key: c[0], label: c[1], color: c[2], icon: c[3] }; });
  const JOURNAL_CAT = Object.fromEntries(JOURNAL_CATS.map(function(c){ return [c.key, c]; }));
  // Запись со старого сервера без категории — под «Кладовщиком», как и всё
  // прочее, что ни под что не подошло.
  function journalCat(entry){ return JOURNAL_CAT[entry && entry.category] || JOURNAL_CAT.agent; }
  function journalCatTag(cat){
    return '<span class="j-cat" style="--cat:' + cat.color + '">' + cat.icon + '<span>' + escapeHTML(cat.label) + '</span></span>';
  }

  // Фильтр по категориям — можно несколько сразу; выбор запоминается в этом
  // браузере. Пусто — показывать всё.
  const JOURNAL_CATS_KEY = 'argus_journal_cats';
  let journalCats = new Set();
  try{
    const saved = JSON.parse(localStorage.getItem(JOURNAL_CATS_KEY) || '[]');
    if(Array.isArray(saved)) journalCats = new Set(saved.filter(function(k){ return JOURNAL_CAT[k]; }));
  } catch(e){ /* нет хранилища — фильтр просто не запомнится */ }

  // Какие строки человек раскрыл сам. Журнал перечитывается каждые 25 секунд
  // и перерисовывается целиком — раскрытое должно пережить перерисовку и
  // оставаться раскрытым, пока его не свернут (задание 28.09.2026).
  const journalOpen = new Set();
  let journalOpenWorkOnce = false;

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
  let journalHistoryPages = 1, journalPendingPages = 1;
  let journalNextCursor = null, journalPendingCursor = null;
  let journalLoadRun = 0;
  let journalMoreLoading = false;

  function journalQuery(cursor, pendingCursor){
    const q = new URLSearchParams({date: journalDayFilter || whDay(new Date()), limit:'100'});
    if(cursor) q.set('cursor', cursor);
    if(pendingCursor) q.set('pendingCursor', pendingCursor);
    return '?' + q;
  }
  function renderJournalMore(){
    const host = document.getElementById('journalMore');
    if(!host) return;
    host.innerHTML = journalScope ? ''
      : (journalNextCursor ? '<button type="button" class="workspace-button" onclick="loadMoreJournal(false)"' + (journalMoreLoading ? ' disabled' : '') + '>Ещё записи за этот день</button>' : '')
      + (journalPendingCursor ? '<button type="button" class="workspace-button" onclick="loadMoreJournal(true)"' + (journalMoreLoading ? ' disabled' : '') + '>Ещё ожидающие решения</button>' : '');
  }
  async function loadMoreJournal(pending){
    if(journalMoreLoading || journalScope) return;
    const cursor = pending ? journalPendingCursor : journalNextCursor;
    if(!cursor) return;
    journalMoreLoading = true;
    const run = journalLoadRun;
    renderJournalMore();
    try{
      const page = await apiFetch('/api/journal' + journalQuery(pending ? null : cursor, pending ? cursor : null));
      if(run !== journalLoadRun) return;
      const extra = pending ? page.pending : page.entries;
      const known = new Set(journalEntries.map(e => e.id));
      journalEntries.push(...extra.filter(e => !known.has(e.id)));
      if(pending){ journalPendingCursor = page.pendingNextCursor; journalPendingPages++; }
      else{ journalNextCursor = page.nextCursor; journalHistoryPages++; }
      refreshJournalList();
    } catch(e){ showWhToast('Не удалось загрузить продолжение: ' + e.message); }
    finally{ journalMoreLoading = false; renderJournalMore(); }
  }
  window.loadMoreJournal = loadMoreJournal;

  async function loadJournal(initial){
    const run = ++journalLoadRun;
    let fresh;
    const query = journalScope
      ? '?' + (journalScope.kind === 'cell' ? 'cellBlockId=' : 'invoiceId=') + journalScope.id
      : journalQuery();
    try{
      fresh = await apiFetch('/api/journal' + query);
      if(run !== journalLoadRun) return;
      if(!Array.isArray(fresh)){
        const history = fresh.entries.slice(), pending = fresh.pending.slice();
        let next = fresh.nextCursor, pendingNext = fresh.pendingNextCursor;
        // Перечитываем только страницы, которые человек уже открыл. Так
        // решения других сотрудников и раскрытые строки остаются актуальны.
        for(let p=1;p<journalHistoryPages && next;p++){
          const page = await apiFetch('/api/journal' + journalQuery(next));
          if(run !== journalLoadRun) return;
          history.push(...page.entries); next = page.nextCursor;
        }
        for(let p=1;p<journalPendingPages && pendingNext;p++){
          const page = await apiFetch('/api/journal' + journalQuery(null, pendingNext));
          if(run !== journalLoadRun) return;
          pending.push(...page.pending); pendingNext = page.pendingNextCursor;
        }
        journalNextCursor = next; journalPendingCursor = pendingNext;
        fresh = [...pending, ...history];
      } else { journalNextCursor = journalPendingCursor = null; }
    } catch(e){
      if(initial){
        journalEntries = [];
        renderContextPanel();
        showWhToast('Не удалось загрузить журнал: ' + e.message);
        refreshJournalList();
        renderWhSummary();
      }
      return; // молчаливый опрос не должен ругаться на каждую потерю связи
    }

    // Что появилось с прошлого раза. На первой загрузке новым не считаем
    // ничего: иначе вход в кабинет подсвечивал бы всю ленту.
    const newIds = initial ? [] : fresh.map(e => e.id).filter(id => !journalSeenIds.has(id));
    journalSeenIds = new Set(fresh.map(e => e.id));
    journalEntries = fresh;
    renderJournalMore();

    renderContextPanel();
    refreshJournalList(newIds);
    renderWhSummary();

    // Новая отметка «нет товара» — сразу на экран, где бы владелец ни был:
    // по ней стоит поставка, ждать, пока откроют журнал, нельзя.
    const hotNew = fresh.filter(function(e){ return newIds.includes(e.id) && isUrgentWaiting(e); });
    if(hotNew.length) showWhToast(hotNew[0].action_text);

    if(newIds.length > 0 && !document.getElementById('view-journal').classList.contains('active')){
      // Сборка поставки — одно событие, а не сорок: значок считает работы,
      // иначе за одну поставку он набегает на сотню и перестаёт что-то значить.
      const newEvents = new Set(fresh.filter(function(e){ return newIds.includes(e.id); })
        .map(function(e){ return e.work_key || e.invoice_supply_id || e.id; })).size;
      journalUnread += newEvents;
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

  // День и время записи — по поясу склада (настройки склада), а не по часам
  // компьютера: «Сегодня» у склада в Новосибирске начинается раньше
  // (проверка 01.10.2026).
  let whFmt = null, whFmtZone = null;
  function whParts(d){
    const zone = (whSettings && whSettings.timezone) || 'Europe/Moscow';
    if(zone !== whFmtZone){
      const opts = (z) => ({ timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      try { whFmt = new Intl.DateTimeFormat('en-CA', opts(zone)); }
      catch(e){ whFmt = new Intl.DateTimeFormat('en-CA', opts('Europe/Moscow')); }
      whFmtZone = zone;
    }
    const p = {};
    whFmt.formatToParts(d).forEach(function(x){ p[x.type] = x.value; });
    return p;
  }
  const whDay = (d) => { const p = whParts(d); return p.year + '-' + p.month + '-' + p.day; };

  function formatEntryTime(iso){
    const p = whParts(new Date(iso));
    return p.hour + ':' + p.minute;
  }

  const STATUS_LABEL = {auto:'закрыто автоматически', pending:'требует внимания', answered:'решено', confirmed:'принято вами', rolled_back:'отклонено вами'};

  function journalDayKey(iso){
    return whDay(new Date(iso));
  }

  const MONTHS_RU = ['января','февраля','марта','апреля','мая','июня',
    'июля','августа','сентября','октября','ноября','декабря'];

  function journalDayLabel(key){
    const [y, m, d] = key.split('-').map(Number);
    const isToday = key === whDay(new Date());
    const isYest = key === whDay(new Date(Date.now() - 86400000));
    const base = d + ' ' + MONTHS_RU[m - 1];
    if(isToday) return 'Сегодня, ' + base;
    if(isYest) return 'Вчера, ' + base;
    return base + ' ' + y;
  }

  // Что человек уже сделал на экране: отмеченные записи. Журнал
  // перечитывается каждые 25 секунд, и без этого отметки для массового
  // подтверждения слетали прямо во время работы. Раскрытые строки — в
  // journalOpen, их ставит applyFilters.
  function journalScreenState(){
    return {
      checked: [...document.querySelectorAll('.j-check:checked')]
        .map(function(cb){ const e = cb.closest('.j-entry'); return e && e.dataset.entryId; })
        .filter(Boolean),
    };
  }

  function restoreJournalScreenState(state){
    if(!state) return;
    state.checked.forEach(function(id){
      const entry = document.querySelector('.j-entry[data-entry-id="' + CSS.escape(id) + '"] .j-check');
      if(entry) entry.checked = true;
    });
    updateBulk();
  }

  // Перерисовка ленты без прыжка: запоминаем строку, которая сейчас вверху
  // экрана, и после перерисовки возвращаем её на то же место. Новые записи
  // сверху тогда не сдвигают то, что человек читает; кто смотрит самый верх
  // ленты — видит новые записи.
  function journalScroller(){
    const list = document.getElementById('jList');
    return list && list.closest('.journal');
  }
  function journalAnchor(){
    const box = journalScroller();
    if(!box || box.scrollTop <= 0) return null;
    const top = box.getBoundingClientRect().top;
    const rows = box.querySelectorAll('#jList .j-entry, #jList .j-group-head');
    for(const el of rows){
      const r = el.getBoundingClientRect();
      if(!r.height || r.bottom <= top) continue;
      const head = el.classList.contains('j-group-head');
      return { box: box, group: head ? el.parentElement.dataset.group : null,
        entry: head ? null : el.dataset.entryId, offset: r.top - top };
    }
    return null;
  }
  function restoreJournalAnchor(a){
    if(!a) return;
    const el = a.group
      ? document.querySelector('#jList .j-group[data-group="' + CSS.escape(a.group) + '"] > .j-group-head')
      : document.querySelector('#jList .j-entry[data-entry-id="' + CSS.escape(a.entry) + '"]');
    if(!el || !el.getBoundingClientRect().height) return;
    a.box.scrollTop += el.getBoundingClientRect().top - a.box.getBoundingClientRect().top - a.offset;
  }
  function refreshJournalList(newIds){
    const anchor = journalAnchor();
    renderJournalEntries(newIds);
    applyFilters();
    restoreJournalAnchor(anchor);
  }

  function renderJournalEntries(newIds){
    const list = document.getElementById('jList');
    const screen = journalScreenState();
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
    const pending = journalEntries.filter(isWaiting);
    const urgent = journalEntries.filter(isUrgentWaiting);
    const head = pending.length === 0 ? '' :
      '<div class="j-pinned"><div class="j-pinned-head">'
      + pending.length + ' ' + pluralRu(pending.length, 'запись ждёт', 'записи ждут', 'записей ждут')
      + ' вашего решения'
      + (urgent.length ? ', из них ' + urgent.length + ' — очень важно' : '') + '</div>'
      // Срочные — прямо здесь, целиком: «нет товара» не должно ждать, пока
      // его найдут в ленте за день.
      + (urgent.length ? '<div class="j-pinned-list">'
        + urgent.map(function(e){ return journalEntryHtml(e, fresh.has(e.id), journalDayKey(e.created_at)); }).join('')
        + '</div>' : '')
      + '</div>';
    const urgentIds = new Set(urgent.map(function(e){ return e.id; }));
    const feed = journalEntries.filter(function(e){ return !urgentIds.has(e.id); });

    // «По уровню риска» — плоский список: сначала то, что ждёт решения.
    // Дни в этом режиме не разделяем: ожидающие записи приходят из разных
    // дней, и разделители дублировались бы через строку.
    if(sortMode === 'risk'){
      const byRisk = feed.slice().sort(function(a, b){
        return (isWaiting(a) ? 0 : 1) - (isWaiting(b) ? 0 : 1);
      });
      list.innerHTML = scopeBar + head
        // День берём тем же помощником, что и в обычном режиме: срез строки
        // даёт день по Гринвичу, и ночные записи попадали в соседний день —
        // календарь и фильтр по дню переставали совпадать со списком.
        + byRisk.map(function(e){ return journalEntryHtml(e, fresh.has(e.id), journalDayKey(e.created_at)); }).join('');
      restoreJournalScreenState(screen);
      renderJournalCalendar();
      return;
    }

    // Дни — потому что двести строк подряд читать нельзя. Работа грузчика
    // (приёмка прихода, сборка поставки) — одной строкой под днём последнего
    // шага; срочные отметки внутри неё тоже есть, но в ленте — только сверху.
    let html = scopeBar + head;
    let lastDay = null;
    groupJournalDay(journalEntries, urgentIds).forEach(function(node){
      if(node.day !== lastDay){
        html += '<div class="j-day-sep" data-day-sep="' + node.day + '">'
          + escapeHTML(journalDayLabel(node.day)) + '</div>';
        lastDay = node.day;
      }
      if(node.kind === 'entry'){
        html += journalEntryHtml(node.entry, fresh.has(node.entry.id), node.day);
        return;
      }
      if(node.kind === 'work'){
        html += journalWorkHtml(node, fresh, urgentIds);
        // Что ждёт решения — ещё и отдельной заметной строкой под работой.
        node.entries.filter(function(e){ return isWaiting(e) && !urgentIds.has(e.id); }).forEach(function(e){
          html += '<div class="j-under">' + journalEntryHtml(e, fresh.has(e.id), node.day) + '</div>';
        });
        return;
      }
      html += journalGroupHtml(node, fresh);
    });
    list.innerHTML = html;
    // История одного прихода — работа раскрыта сразу: за ней сюда и пришли.
    // Один раз, при входе: дальше человек сворачивает её сам.
    if(journalOpenWorkOnce){
      journalOpenWorkOnce = false;
      list.querySelectorAll('.j-work').forEach(function(g){ journalOpen.add(g.dataset.group); });
    }
    restoreJournalScreenState(screen);
    renderJournalCalendar();
  }

  // Одна приёмка на двенадцать позиций — это двенадцать одинаковых строк
  // подряд. Читать их незачем: важно, что приёмка была и чем закончилась.
  // Поэтому рутина по одному документу сворачивается в строку с раскрытием.
  //
  // Что НЕ сворачивается никогда: то, что ждёт решения. Прятать под плюсик
  // единственное, ради чего владелец сюда зашёл, — значит сломать журнал.
  const GROUP_MIN = 3;

  function groupJournalDay(entries, urgentIds){
    const out = [];
    const buckets = new Map();
    const works = new Map();
    entries.forEach(function(e){
      const day = journalDayKey(e.created_at);
      // Работа грузчика по приходу или поставке — одна строка на всё время
      // работы, а не на день и не на человека (третье задание 27.09.2026).
      // Ключ и состояние работы даёт сервер (work_key, work). Лента идёт от
      // новых к старым, поэтому строка встаёт на место последнего шага.
      if(e.work_key){
        let node = works.get(e.work_key);
        if(!node){
          node = { kind: 'work', day: day, id: 'w' + e.work_key.replace(/[^a-zA-Z0-9]/g, ''),
            work: e.work, key: e.work_key, entries: [] };
          works.set(e.work_key, node);
          out.push(node);
        }
        node.entries.push(e);
        return;
      }
      // Срочное вне работы — только в приколотом сверху.
      if(urgentIds && urgentIds.has(e.id)) return;
      // Пауза грузчика — отдельной строкой: её и должны заметить.
      const groupable = !isWaiting(e) && e.invoice_id && e.entity_type !== 'worker_pause';
      // В поставке у каждого заказа свой товар, и по документу такая сборка
      // не собирается: сорок заказов — сорок групп по одной строке. Владельцу
      // нужна одна запись «собирается поставка» с полосой готовности.
      // Работа одного человека над одним документом — одна строка: «Иван
      // собирает поставку ПС-…», «Иван принимает УТОХ…». Два грузчика на
      // одной поставке — две строки: видно, кто сколько сделал.
      const who = e.actor_type === 'worker' ? (e.actor_id || '') : '';
      const key = groupable
        ? (e.invoice_supply_id ? day + '|s|' + e.invoice_supply_id : day + '|' + e.invoice_id) + '|' + who
        : null;
      if(!key){ out.push({ kind: 'entry', day: day, entry: e }); return; }
      if(!buckets.has(key)){
        const node = { kind: 'group', day: day, id: key.replace(/[^a-zA-Z0-9]/g, ''),
          invoiceNumber: e.invoice_number, supplyNumber: e.invoice_supply_number || null,
          supplyDone: e.supply_items_done, supplyTotal: e.supply_items_total,
          direction: e.invoice_direction, worker: who ? (e.actor_name || 'Грузчик') : null,
          agent: e.agent, entries: [] };
        buckets.set(key, node);
        out.push(node);
      }
      buckets.get(key).entries.push(e);
    });
    // Группа из одной-двух записей ничего не экономит, только прячет.
    return out.map(function(node){
      // Работу грузчика и сборку поставки сворачиваем всегда, даже когда
      // сделан первый товар: это одна работа, и начальнику склада не нужна
      // строка на каждую штуку.
      if(node.kind === 'group' && !node.supplyNumber && !node.worker && node.entries.length < GROUP_MIN){
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
    const total = Number(node.supplyTotal || 0);
    const done = Math.min(Number(node.supplyDone || 0), total);
    const finished = total > 0 && done >= total;
    const who = escapeHTML(node.worker || node.agent || 'Кладовщик');
    const title = node.supplyNumber
      ? who + (finished ? ' собрал поставку ' : ' собирает поставку ') + escapeHTML(node.supplyNumber)
      : node.worker && node.direction === 'in'
        ? who + ' принимает ' + escapeHTML(node.invoiceNumber || '')
        : node.worker && node.direction === 'return'
          ? who + ' разбирает возврат ' + escapeHTML(node.invoiceNumber || '')
          : who + ' · ' + escapeHTML(node.invoiceNumber || '');
    // Сколько длилась работа — от первой записи до последней.
    const first = new Date(node.entries[node.entries.length - 1].created_at);
    const last = new Date(node.entries[0].created_at);
    const minutes = Math.round((last - first) / 60000);
    const took = node.entries.length > 1 ? ' · ' + (minutes < 1 ? 'меньше минуты' : minutes + ' мин') : '';
    // Позиции — только строки товара: «начал приёмку», «закончил», «забрал
    // себе» лежат в той же группе, но позициями не являются.
    const positions = node.entries.filter(function(e){ return e.entity_type === 'invoice_item'; }).length;
    const count = node.supplyNumber && total > 0
      ? 'собрано ' + done + ' из ' + total
      : node.worker && positions
        ? positions + ' ' + pluralRu(positions, 'позиция', 'позиции', 'позиций')
        : node.entries.length + ' ' + pluralRu(node.entries.length, 'запись', 'записи', 'записей');
    // Полоса — чтобы ход сборки читался с одного взгляда, без арифметики.
    const bar = node.supplyNumber && total > 0
      ? '<span class="j-group-bar"><i style="width:' + Math.round(done / total * 100) + '%"></i></span>'
      : '';
    const cat = journalCat(node.entries[0]);
    return '<div class="j-group' + (hasNew ? ' j-new' : '') + '" style="--cat:' + cat.color + '" data-group="' + node.id + '">'
      + '<div class="j-group-head' + (node.supplyNumber ? ' j-supply' : '') + '" data-toggle-group="' + node.id + '">'
      +   '<svg class="j-group-chev" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">'
      +     '<path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      +   journalCatTag(cat)
      +   '<span class="j-group-title">' + title + '</span>'
      +   '<span class="j-group-count">' + count + '</span>'
      +   '<span class="j-group-time">' + escapeHTML(span + took) + '</span>'
      +   bar
      + '</div>'
      + '<div class="j-group-body">'
      +   node.entries.map(function(e){
            return journalEntryHtml(e, fresh.has(e.id), node.day);
          }).join('')
      + '</div>'
      + '</div>';
  }

  // Строка работы: кто, что делает с каким документом и как идёт — «Джоник
  // принимает ПР-270926-1 · принято 5 из 8» → «Джоник принял ПР-270926-1 ·
  // 8 из 8, расхождений нет»; строка состояния — этап и полоса. Внутри —
  // от последнего к первому: конец, позиции, паузы и выходы, начал.
  function journalWorkHtml(node, fresh, urgentIds){
    const w = node.work;
    const entries = node.entries;
    const hasNew = entries.some(function(e){ return fresh.has(e.id); });
    // Кто работал — по заходам на сервере, а у старых работ — по записям.
    const names = (w && w.workers && w.workers.length ? w.workers : [])
      .concat(entries.slice().reverse().filter(function(e){ return e.actor_type === 'worker' && e.actor_name; })
        .map(function(e){ return e.actor_name; }))
      .filter(function(n, i, all){ return all.indexOf(n) === i; });
    const session = w && w.session;
    const live = session && (session.status === 'active' || session.status === 'paused');
    const current = live ? session.workerName : (names[names.length - 1] || 'Грузчик');
    const allNames = names.length ? (names.length > 1 ? names.slice(0, -1).join(', ') + ' и ' + names[names.length - 1] : names[0]) : 'Грузчик';
    const many = names.length > 1;
    const number = escapeHTML(w ? w.number : (entries[0].invoice_number || ''));
    const recv = w && w.kind === 'receiving';
    const asm = w && w.kind === 'assembly';
    const done = Boolean(w && w.done);
    const total = w ? Number(w.total || 0) : 0;
    const taken = w ? Math.min(Number(w.taken || 0), total || Number(w.taken || 0)) : 0;
    let title, count;
    if(recv){
      title = done ? escapeHTML(allNames) + (many ? ' приняли ' : ' принял ') + number
        : escapeHTML(current) + ' принимает ' + number;
      count = done
        ? taken + ' из ' + total + ', ' + (w.diffs ? 'расхождений: ' + w.diffs : 'расхождений нет')
        : 'принято ' + taken + ' из ' + total;
    } else if(asm){
      title = done ? escapeHTML(allNames) + (many ? ' собрали ' : ' собрал ') + number
        : escapeHTML(current) + ' собирает ' + number;
      count = 'взято ' + taken + ' из ' + total + (done ? ' шт.' : '');
    } else {
      const dir = entries[0].invoice_direction;
      title = escapeHTML(current) + (dir === 'return' ? ' разбирает возврат ' : dir === 'out' ? ' собирает заказ ' : ' · ') + number;
      const positions = entries.filter(function(e){ return e.entity_type === 'invoice_item'; }).length;
      count = positions ? positions + ' ' + pluralRu(positions, 'позиция', 'позиции', 'позиций') : entries.length + ' ' + pluralRu(entries.length, 'запись', 'записи', 'записей');
    }
    // Этап работы.
    let stage = '', stageKind = '';
    if(done){
      stageKind = 'done';
      stage = recv ? 'Принят' : (w.status === 'shipped' ? 'Собрана, уехала' : 'Собрана');
    } else if(session && session.status === 'active'){
      stageKind = 'active'; stage = recv ? 'Идёт приёмка' : 'Идёт сборка';
    } else if(session && session.status === 'paused'){
      stageKind = 'paused'; stage = 'На паузе' + (session.pauseReason ? ': ' + session.pauseReason : '');
    } else if(session && session.status === 'abandoned'){
      stageKind = 'abandoned'; stage = 'Брошена — продолжит любой грузчик';
    } else if(w){
      stage = recv ? 'Ещё не принят' : 'Ещё не собрана';
    }
    const waiting = entries.filter(isWaiting).length;
    const times = entries.map(function(e){ return formatEntryTime(e.created_at); });
    const firstAt = new Date(entries[entries.length - 1].created_at);
    const lastAt = new Date(entries[0].created_at);
    const sameDay = journalDayKey(firstAt) === journalDayKey(lastAt);
    const span = entries.length > 1
      ? (sameDay ? times[times.length - 1] : firstAt.getDate() + ' ' + MONTHS_RU[firstAt.getMonth()] + ' ' + times[times.length - 1]) + ' – ' + times[0]
      : times[0];
    const bar = total > 0 ? '<span class="j-group-bar"><i style="width:' + Math.round(taken / total * 100) + '%"></i></span>' : '';
    // Внутри — последнее действие сверху, ниже — всё раньше, до начала работы
    // (владелец 06.10.2026). Ждущее решения — одной строкой-ссылкой: сама
    // запись с кнопками стоит в ленте под работой.
    const body = entries.map(function(e){
      if(isWaiting(e)){
        return '<div class="j-step"><span class="j-step-time">' + formatEntryTime(e.created_at) + '</span>'
          + '<span>' + escapeHTML(e.urgent ? urgentText(e.action_text) : e.action_text) + '</span>'
          + '<span class="j-step-note">' + (urgentIds && urgentIds.has(e.id) ? '— ждёт решения, вверху журнала' : '— ждёт решения, строкой ниже') + '</span></div>';
      }
      return journalEntryHtml(e, fresh.has(e.id), node.day);
    }).join('');
    const cat = journalCat(entries[0]);
    return '<div class="j-group j-work' + (done ? ' is-done' : '') + (hasNew ? ' j-new' : '') + '" style="--cat:' + cat.color + '" data-group="' + node.id + '">'
      + '<div class="j-group-head" data-toggle-group="' + node.id + '">'
      +   '<svg class="j-group-chev" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">'
      +     '<path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      +   journalCatTag(cat)
      +   '<span class="j-group-title">' + title + '</span>'
      +   '<span class="j-group-count">' + escapeHTML(count) + '</span>'
      +   '<span class="j-group-time">' + escapeHTML(span) + '</span>'
      +   '<span class="j-work-status">'
      +     (stage ? '<span class="j-stage ' + stageKind + '">' + escapeHTML(stage) + '</span>' : '')
      +     (waiting ? '<span class="j-work-wait">ждёт решения: ' + waiting + '</span>' : '')
      +     (w && w.session && w.session.status === 'finished' && !done ? '<span>заход закончен</span>' : '')
      +   '</span>'
      +   bar
      + '</div>'
      + '<div class="j-group-body">' + body + '</div>'
      + '</div>';
  }

  function toggleJournalGroup(id){
    const box = document.querySelector('.j-group[data-group="' + CSS.escape(id) + '"]');
    if(!box) return;
    const open = box.classList.toggle('open');
    if(open) journalOpen.add(id); else journalOpen.delete(id);
  }

  document.addEventListener('click', function(e){
    const head = e.target.closest && e.target.closest('[data-toggle-group]');
    if(head) toggleJournalGroup(head.dataset.toggleGroup);
  });

  function journalEntryHtml(entry, isNew, dayKey){
    return (function(){
      const cat = journalCat(entry);
      const canResolve = isWaiting(entry);
      const hot = isUrgentWaiting(entry);
      const isWb = entry.agent === 'Обмен с WB';
      // Отвеченная запись остаётся pending (журнал не переписывается), но
      // подписывать её «требует внимания» — неправда.
      const statusKey = entry.status === 'pending' && entry.answered ? 'answered' : entry.status;
      return `
        <div class="j-entry${hot ? ' j-urgent' : ''}${isNew ? ' j-new' : ''}" style="--cat:${cat.color}" data-cat="${cat.key}" data-client="" data-risk="${canResolve ? 'high' : 'low'}" data-order="0" data-day="${dayKey}" data-entry-id="${escapeHTML(entry.id)}"${isNote(entry) ? ' data-note="1"' : ''}>
          <input type="checkbox" class="j-check" onclick="event.stopPropagation(); updateBulk()" ${canResolve && !hot ? '' : 'style=\"visibility:hidden;\"'}>
          <div class="j-avatar">${cat.icon}</div>
          <div class="j-body">
            <div class="j-top">
              <span class="j-agent">${escapeHTML(cat.label)}</span>
              <span class="j-time">${formatEntryTime(entry.created_at)}</span>
            </div>
            <div class="j-text">${hot ? '<span class="j-urgent-tag">ОЧЕНЬ ВАЖНО</span>' + escapeHTML(urgentText(entry.action_text)) : escapeHTML(entry.action_text)}</div>
            ${journalLinksHtml(entry)}
            <div class="j-meta">
              <span class="j-status ${statusKey === 'auto' || statusKey === 'answered' ? 'auto' : statusKey === 'confirmed' ? 'applied' : 'pending'}">${escapeHTML(STATUS_LABEL[statusKey] || statusKey)}</span>
              ${canResolve ? (isWb
                ? '<a class="staff-action restore" style="display:inline-block; margin-left:8px;" href="marketplace-reconciliation.html">Открыть сверку WB</a>'
                : hot ? urgentActionsHtml(entry, 'journal')
                : isNote(entry) ? `<span class="staff-action" style="display:inline-block; margin-left:8px;" onclick="resolveJournalEntry('${escapeHTML(entry.id)}', 'ack')">Принял к сведению</span>`
                : `<span class="staff-action" style="display:inline-block; margin-left:8px;" onclick="resolveJournalEntry('${escapeHTML(entry.id)}', 'confirm')">Принять</span><span class="staff-action revoke" style="display:inline-block; margin-left:8px;" onclick="resolveJournalEntry('${escapeHTML(entry.id)}', 'rollback')">Отклонить</span>`)
                : ''}
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
    box.innerHTML = '<div class="dn-cal-head"><span>Выбрать день</span>'
      + '<button type="button" class="dn-reset" onclick="pickDay(null, event)">Сегодня</button></div>'
      + '<label class="rc-field" style="padding:12px;"><span>Любая дата в истории склада</span><input type="date" class="mp-field" aria-label="Дата журнала" max="' + whDay(new Date()) + '" value="' + (journalDayFilter || whDay(new Date())) + '" onchange="if(this.value)pickDay(this.value,event)"></label>'
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
      parts.push('<span class="j-link" data-go-cell="' + escapeHTML(entry.cell_block_id)
        + '" title="Показать на карте склада">' + ICON_CELL
        + escapeHTML(entry.cell_label) + '</span>');
    }
    if(entry.invoice_number){
      parts.push('<span class="j-link" data-go-invoice="' + escapeHTML(entry.invoice_id)
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
    journalHistoryPages = journalPendingPages = 1;
    journalOpenWorkOnce = kind === 'invoice';
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
    journalHistoryPages = journalPendingPages = 1;
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
    const rcOpen = e.target.closest && e.target.closest('[data-receipt-open]');
    if(rcOpen){ e.stopPropagation(); openReceipt(rcOpen.dataset.receiptOpen); return; }
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
    const pending = journalEntries.filter(isWaiting)
      .sort(function(a, b){ return (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0); });
    if(pending.length === 0){
      host.innerHTML = '<div class="ctx-card"><div class="ctx-empty">'
        + 'Ничего не ждёт решения. Здесь появятся найденные агентами расхождения, '
        + 'которые требуют проверки владельца склада.</div></div>';
      return;
    }
    host.innerHTML = pending.map(e => {
      const isWb = e.agent === 'Обмен с WB';
      return `
      <div class="ctx-card">
        <div class="ctx-entry-head">
          <span class="ctx-entry-agent" style="color:${journalCat(e).color}">${escapeHTML(journalCat(e).label)}</span>
          <span class="ctx-entry-time">${formatEntryTime(e.created_at)}</span>
        </div>
        <div class="ctx-entry-text">${e.urgent ? '<span class="j-urgent-tag">ОЧЕНЬ ВАЖНО</span>' + escapeHTML(urgentText(e.action_text)) : escapeHTML(String(e.action_text || ''))}</div>
        <div class="ctx-actions">
          ${isWb
            ? '<a class="ctx-btn confirm" href="marketplace-reconciliation.html">Открыть сверку WB</a>'
            : e.urgent ? urgentActionsHtml(e, 'ctx')
            : isNote(e) ? `<div class="ctx-btn confirm" onclick="resolveJournalEntry('${e.id}', 'ack')">Принял к сведению</div>`
            : `<div class="ctx-btn confirm" onclick="resolveJournalEntry('${e.id}', 'confirm')">Принять</div>
               <div class="ctx-btn reject" onclick="resolveJournalEntry('${e.id}', 'rollback')">Отклонить</div>`}
        </div>
        <div class="ctx-note">${isWb
          ? 'Проверьте записанный отбор и фактическое движение товара в сверке. Данные 1С автоматически не изменяются.'
          : e.urgent && e.invoice_supply_id
            ? 'Убранный заказ вернётся в очередь, поставка уедет без него. Данные 1С не изменяются.'
          : e.entity_type === 'vw_transfer'
            ? 'Просьба продавца. О решении ему придёт уведомление. Данные 1С не изменяются.'
          : isNote(e)
            ? (e.entity_type === 'vw_zone' ? 'Зона склада продавца заполнена. Расширьте зону в окне продавца — иначе товар положат рядом.'
              : 'Грузчик написал о товаре.') + ' Отметка «Принял к сведению» сохранится в журнале с вашим именем.'
            : 'Решение сохранится в журнале вместе с вашим именем. Данные 1С не изменяются.'}</div>
      </div>
    `;}).join('');
  }

  // Отметку «нет товара» решают делом, а не «Принять»: «принято» ничего не
  // сдвигало — поставка стояла дальше. Заказ в поставке — убрать его оттуда;
  // товар нашёлся — закрыть отметку, и грузчик соберёт позицию как обычно.
  function urgentActionsHtml(e, kind){
    const act = (primary, onclick, label) => kind === 'ctx'
      ? '<div class="ctx-btn ' + (primary ? 'confirm' : 'reject') + '" onclick="' + onclick + '">' + label + '</div>'
      : '<span class="staff-action" style="display:inline-block; margin-left:8px;" onclick="' + onclick + '">' + label + '</span>';
    const id = escapeHTML(e.id);
    // Заявка продавца на перенос между его складами (проверка 03.10.2026).
    if(e.entity_type === 'vw_transfer'){
      return act(true, "resolveTransferEntry('" + id + "', true)", 'Выполнить')
        + act(false, "resolveTransferEntry('" + id + "', false)", 'Отказать');
    }
    const order = escapeHTML(String(e.invoice_number || '').replace(/['\\]/g, ''));
    return (e.invoice_supply_id
        ? act(true, "removeSupplyOrder('" + escapeHTML(e.invoice_id) + "', '" + order + "')", 'Убрать заказ из поставки')
        : act(true, "resolveUrgent('" + id + "', 'confirm')", 'Понятно'))
      + act(false, "resolveUrgent('" + id + "', 'rollback')", 'Товар нашёлся');
  }

  async function resolveUrgent(id, resolution){
    const entry = journalEntries.find(x => x.id === id);
    const found = resolution === 'rollback';
    if(!await askConfirm(found
      ? 'Товар нашёлся?\n\nОтметка закроется, и грузчик соберёт позицию как обычно.'
      : 'Отметить, что вы в курсе?\n\nЗаказ остаётся в работе: грузчику позиция снова откроется для сборки.')) return;
    const text = entry ? urgentText(entry.action_text) : '';
    try{
      await apiFetch('/api/journal/' + id + '/resolve', {method:'POST', body:{
        resolution, note: (found ? 'товар нашёлся, собирать как обычно — ' : 'в курсе — ') + text,
      }});
      await loadJournal();
    } catch(e){
      showWhToast('Не удалось выполнить действие: ' + e.message);
    }
  }
  window.resolveUrgent = resolveUrgent;

  async function resolveTransferEntry(id, approve){
    const entry = journalEntries.find(x => x.id === id);
    const text = entry ? urgentText(entry.action_text) : '';
    let reason;
    if(!approve){
      reason = await askText('Отказать в переносе?', 'Причина — продавец её увидит', 'Например: на складе Озон под этот товар нет места');
      if(reason === null) return;
    } else if(!await askConfirm('Выполнить перенос?\n\n' + text)) return;
    try{
      await apiFetch('/api/journal/' + id + '/resolve', {method:'POST', body:{
        resolution: approve ? 'confirm' : 'rollback', note: reason || undefined,
      }});
      showWhToast(approve ? 'Готово — продавцу пришло уведомление.' : 'Отказано — продавцу пришло уведомление.');
      await loadJournal();
    } catch(e){
      showWhToast('Не удалось выполнить действие: ' + e.message);
    }
  }
  window.resolveTransferEntry = resolveTransferEntry;

  async function resolveJournalEntry(id, resolution){
    // 'ack' — «Принял к сведению» записку грузчика: одно нажатие, без вопроса.
    if(resolution === 'confirm' && !await askConfirm('Принять рекомендацию и сохранить решение в журнале?')) return;
    if(resolution === 'rollback' && !await askConfirm('Отклонить рекомендацию и сохранить решение в журнале?')) return;
    try{
      await apiFetch('/api/journal/' + id + '/resolve', {method:'POST', body:{resolution}});
      await loadJournal();
    } catch(e){
      showWhToast('Не удалось выполнить действие: ' + e.message);
    }
  }

  // Чипы категорий: «Все» снимает выбор, остальные включаются и
  // выключаются по одному — можно «Сотрудники» + «Обмен с 1С» + «Сборка».
  function renderJournalChips(){
    const box = document.getElementById('jCats');
    if(!box) return;
    box.innerHTML = '<button class="jf-chip' + (journalCats.size ? '' : ' active') + '" type="button" data-cat-chip=""'
      + ' aria-pressed="' + (journalCats.size ? 'false' : 'true') + '">Все</button>'
      + JOURNAL_CATS.map(function(c){
        const on = journalCats.has(c.key);
        return '<button class="jf-chip jf-cat' + (on ? ' active' : '') + '" type="button" data-cat-chip="' + c.key + '"'
          + ' aria-pressed="' + on + '" style="--cat:' + c.color + '">' + c.icon + '<span>' + escapeHTML(c.label) + '</span></button>';
      }).join('');
  }
  function toggleChip(key){
    if(!key) journalCats.clear();
    else if(journalCats.has(key)) journalCats.delete(key);
    else journalCats.add(key);
    try{ localStorage.setItem(JOURNAL_CATS_KEY, JSON.stringify([...journalCats])); } catch(e){ /* не запомнится */ }
    renderJournalChips();
    applyFilters();
  }
  document.addEventListener('click', function(e){
    const chip = e.target.closest && e.target.closest('[data-cat-chip]');
    if(chip) toggleChip(chip.dataset.catChip);
  });
  renderJournalChips();
  function toggleAttention(){
    attentionOnly = !attentionOnly;
    document.getElementById('attentionToggle').classList.toggle('active', attentionOnly);
    applyFilters();
  }
  function applyFilters(){
    const search = document.getElementById('jSearch').value.trim().toLowerCase();
    // Пока ищут, группы раскрыты: спрятать найденное под плюсик — худшее,
    // что может сделать поиск. Фильтр по категории ничего не раскрывает:
    // строка работы и так целиком одной категории. Остальное — как раскрыл
    // человек (journalOpen), и перерисовка раз в 25 секунд этого не трогает.
    const filtering = Boolean(search) || attentionOnly;
    document.querySelectorAll('.j-group').forEach(function(g){
      g.classList.toggle('open', filtering || journalOpen.has(g.dataset.group));
    });
    const needPending = attentionOnly;
    let visibleCount = 0;
    let auto = 0, confirmed = 0, pending = 0;
    document.querySelectorAll('.j-entry').forEach(entry=>{
      let show = true;
      // «Ждёт решения» — только то, что ещё можно решить (data-risk="high").
      // По цвету метки считать нельзя: «отклонено вами» тоже красное, и
      // решённая запись висела в счётчике «ждёт решения».
      const waiting = entry.dataset.risk === 'high';
      // Ждущее решения видно при любом фильтре категорий.
      if(show && journalCats.size && !waiting){ show = journalCats.has(entry.dataset.cat); }
      if(show && needPending){ show = waiting; }
      if(show && search){
        const searchable = [
          entry.querySelector('.j-text')?.textContent || '',
          entry.querySelector('.j-agent')?.textContent || ''
        ].join(' ').toLowerCase();
        show = searchable.includes(search);
      }
      if(show && journalDayFilter && !waiting){ show = entry.dataset.day === journalDayFilter; }
      entry.style.display = show ? 'flex' : 'none';
      if(show){
        visibleCount++;
        const st = entry.querySelector('.j-status');
        if(waiting) pending++;
        else if(st){
          if(st.classList.contains('auto')) auto++;
          else if(st.classList.contains('applied')) confirmed++;
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
    const scope = journalScope ? 'История' : journalDayLabel(journalDayFilter || whDay(new Date()));
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
      let any = [...g.querySelectorAll('.j-entry')]
        .some(function(el){ return el.style.display !== 'none'; });
      // Строка работы видна и тогда, когда видна её ждущая запись под ней:
      // без заголовка «Дима принял ПР-…» расхождение висело бы без работы.
      for(let next = g.nextElementSibling; !any && next && next.classList.contains('j-under'); next = next.nextElementSibling){
        const entry = next.querySelector('.j-entry');
        any = Boolean(entry && entry.style.display !== 'none');
      }
      g.style.display = any ? '' : 'none';
    });
    // Обёртка ждущей записи — вместе с самой записью.
    document.querySelectorAll('.j-under').forEach(function(u){
      const entry = u.querySelector('.j-entry');
      u.style.display = entry && entry.style.display === 'none' ? 'none' : '';
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

  // Порядок задаётся данными и перерисовкой, а не перестановкой готовых узлов:
  // раньше записи выдёргивались из групп и из-под разделителей дней, и список
  // разваливался — заголовки дней висели над пустотой, а свёрнутые группы
  // внезапно раскрывались.
  function sortEntries(){
    refreshJournalList();
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
    // Аргус в 1С не пишет (1С склада только читается) — и обещать этого нельзя.
    if(!await askConfirm('Подтвердить ' + checked.length + ' запис' + (checked.length===1?'ь':'и') + '?\n\n'
      + 'Решение запишется в журнал. В 1С ничего не отправляется.')) return;
    const picked = Array.from(checked).map(cb => cb.closest('.j-entry'));
    try{
      for(const el of picked){
        // Записки грузчика о товаре — «Принял к сведению», остальное — «Принять».
        await apiFetch('/api/journal/' + el.dataset.entryId + '/resolve', {method:'POST', body:{resolution: el.dataset.note ? 'ack' : 'confirm'}});
      }
      await loadJournal();
      updateBulk();
    } catch(e){
      showWhToast('Не удалось подтвердить: ' + e.message);
    }
  }

  function exportCSV(){
    const rows = [['Время','Категория','Действие','Статус']];
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

  // Экранирование для разметки.
  //
  // Раньше здесь был приём с textContent: положить строку в узел и забрать
  // innerHTML. Он превращает < > & в сущности — и НЕ трогает кавычки, потому
  // что в тексте они безопасны. В атрибуте они не безопасны: кавычка закрывает
  // атрибут, и дальше в теге можно дописать свой обработчик события. А имена
  // ячеек, ряды и адреса подставляются как раз в атрибуты.
  //
  // Поэтому подмена явная и одинаковая для текста и атрибутов: одну функцию
  // легче не забыть, чем две, и «эту строку я вставляю в атрибут» — не то,
  // о чём стоит помнить в каждом месте.
  const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHTML(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
  }
  // Значение для строки в одинарных кавычках внутри onclick="…": сначала
  // экранируем для JavaScript, потом для HTML — браузер раскодирует атрибут
  // до запуска кода, одного escapeHTML мало (проверка 05.10).
  function jsArg(value){
    return escapeHTML(JSON.stringify(String(value == null ? '' : value)).slice(1, -1).replace(/'/g, "\\'"));
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
  // Главная использует готовую серверную сводку владельца. У менеджера другой
  // доступ: только очередь заказов и переходы к разрешённым разделам.
  let homeRun = 0;
  const HOME_LINKS = [['orders', 'Заказы'], ['supplies', 'Поставки'], ['inbound', 'Приходы и акты'],
    ['stock', 'Склад и товары'], ['mp', 'Клиенты'], ['billing', 'Расчёты'], ['staff', 'Сотрудники'],
    ['configuration', 'Настройки'], ['journal', 'Журнал действий'], ['chat', 'Чат']];
  function renderHomeActions(){
    document.getElementById('homeActions').innerHTML = HOME_LINKS
      .filter(([view]) => document.getElementById('nav-' + (GROUP_NAV[view] || view)))
      .map(([view, title]) => '<button type="button" class="home-link" onclick="switchView(\'' + view + '\')">' + title + '</button>').join('');
  }
  function renderHomeRows(rows){
    const row = (r) => '<tr><td><b>' + escapeHTML(r.title) + '</b></td>'
      + '<td class="home-num' + (r.warn ? ' home-warn' : '') + '" data-label="Количество">' + escapeHTML(String(r.value)) + '</td>'
      + '<td class="home-detail">' + escapeHTML(r.detail) + '</td>'
      + '<td><button type="button" class="home-link" onclick="switchView(\'' + r.view + '\')">' + escapeHTML(r.action || 'Открыть') + '</button></td></tr>';
    const visible = rows.filter(r => canOpenView(r.view));
    const group = (key, title, items) => items.length ? '<section class="home-work-group" data-home-group="' + key + '"><h2 class="home-group-heading">'
      + title + '</h2><table class="home-table"><thead><tr><th>Работа</th><th class="home-num">Количество</th><th>Состояние</th><th>Перейти</th></tr></thead><tbody>'
      + items.map(row).join('') + '</tbody></table></section>' : '';
    const attention = visible.filter(r => r.category === 'attention');
    document.getElementById('todayStrip').innerHTML = group('attention', attention.some(r => r.warn) ? 'Требуют внимания' : 'Решения и обмен', attention)
      + group('work', 'Текущая работа', visible.filter(r => r.category !== 'attention'));
  }
  async function loadHome(){
    const run = ++homeRun;
    const status = document.getElementById('homeUpdated');
    renderHomeActions();
    status.textContent = 'Обновляем сводку…';
    try{
      if(!IS_MANAGER){
        await loadToday(run);
      } else {
        const partners = await apiFetch('/api/supplies/pending');
        if(run !== homeRun) return;
        const orders = partners.reduce((sum, p) => sum + Number(p.orders || 0), 0);
        const units = partners.reduce((sum, p) => sum + Number(p.units || 0), 0);
        renderHomeRows([
          { title: 'Заказы без поставки', value: nfmt(orders), detail: nfmt(units) + ' шт. товара ждут распределения по поставкам', view: 'orders', action: 'Выбрать заказы' },
          { title: 'Поставки', value: '—', detail: 'Сборка, документы и отгрузка', view: 'supplies', action: 'Открыть поставки' },
          { title: 'Приходы и переписка', value: '—', detail: 'Привозы клиентов, комментарии и документы', view: 'receipts', action: 'Открыть приходы' },
          { title: 'Журнал действий', value: '—', detail: 'Работа сотрудников и решения по событиям', view: 'journal', action: 'Открыть журнал' },
        ]);
      }
      if(run !== homeRun) return;
      const zone = whSettings?.timezone || 'Europe/Moscow';
      status.textContent = 'Сводка получена ' + new Date().toLocaleString('ru-RU', { timeZone: zone });
    } catch(e){
      if(run !== homeRun) return;
      document.getElementById('todayStrip').innerHTML = '';
      status.textContent = 'Сводка не загрузилась. Нажмите «Обновить сводку» или откройте нужный раздел ниже.';
    }
  }
  window.loadHome = loadHome;
  // Полоса чисел, как у продавца (владелец 06.10.2026): товар всех продавцов
  // склада — всего, заказано, в сборке, в пути, принято WB, доступно.
  async function loadHomeStock(run = homeRun){
    const host = document.getElementById('homeStockStrip');
    if(!host) return;
    let data;
    try{ data = await apiFetch('/api/sellers/stock-summary'); } catch(e){ return; }
    if(run !== homeRun) return;
    const sellers = data.sellers || [];
    if(!sellers.length){ host.hidden = true; return; }
    const sum = (k) => sellers.reduce((n, s) => n + Number(s[k] || 0), 0);
    const known = (k) => sellers.some(s => s[k] != null) ? sum(k) : null;
    const tiles = [
      ['Всего товара', known('total'), 'у ' + nfmt(sellers.length) + ' ' + pluralRu(sellers.length, 'продавца', 'продавцов', 'продавцов')],
      ['Заказано', sum('ordered'), 'куплено на WB, ещё не в поставке'],
      ['В сборке', sum('inAssembly'), 'в поставке, склад собирает'],
      ['В пути', sum('inTransit'), 'уехало на WB, ещё не принято'],
      ['Принято WB', sum('acceptedByWb'), 'сортировочный центр принял, за 3 дня'],
      // Как у продавца: «в пути» — сколько вычтено, нехватка — ноль (07.10, замечание 6).
      ['Доступно к продаже', known('available'), 'всего − заказано − в сборке − в пути'
        + (sum('inTransit') > sum('transitDeducted') && sellers.some(s => s.transitDeducted != null) ? ' (в пути — ещё не списанное 1С: ' + nfmt(sum('transitDeducted')) + ')' : '')
        + (sum('shortageCount') ? '; где заказов больше товара — 0' : ''), 'main'],
    ];
    host.innerHTML = tiles.map(([label, value, note, cls]) => '<div class="home-stat' + (cls ? ' ' + cls : '') + '">'
      + '<div class="home-stat-label">' + escapeHTML(label) + '</div>'
      + '<div class="home-stat-value">' + (value == null ? '—' : nfmt(value) + '<small>шт.</small>') + '</div>'
      + '<div class="home-stat-note">' + escapeHTML(note) + '</div></div>').join('');
    host.hidden = false;
  }

  async function loadToday(run = homeRun){
    loadHomeStock(run);
    const box = document.getElementById('todayStrip');
    if(!box) return;
    const t = await apiFetch('/api/alerts/today');
    if(run !== homeRun) return;
    const n = (x, one, few, many) => x > 0 ? nfmt(x) + ' ' + pluralRu(x, one, few, many) : '';
    const detail = (subs) => subs.filter(Boolean).join(' · ') || 'Сейчас нет';
    const s = t.ship, r = t.receive, d = t.decide, x = t.exchange;
    const ship = s.supplies + s.ready + s.onec;
    const rec = r.arrivals + r.returns;
    const dec = d.discrepancies + d.sellerRequests + d.recounts;
    const exch = x.sync.length + (x.wbUnmapped > 0 ? 1 : 0);
    const wbOver = x.wbOver || [];
    const wbOverItems = wbOver.reduce((sum, o) => sum + o.count, 0);
    renderHomeRows([
      { title: 'Отгрузки', value: nfmt(ship), detail: detail([n(s.supplies, 'поставка в сборке', 'поставки в сборке', 'поставок в сборке'),
        n(s.ready, 'готова к отгрузке', 'готовы к отгрузке', 'готовы к отгрузке'), n(s.onec, 'отгрузка из 1С', 'отгрузки из 1С', 'отгрузок из 1С')]), view: 'supplies', action: 'Открыть поставки' },
      { title: 'Приёмка', value: nfmt(rec), detail: detail([r.arrived ? n(r.arrived, 'машина приехала', 'машины приехали', 'машин приехали')
        : n(r.arrivals, 'привоз ожидается', 'привоза ожидаются', 'привозов ожидаются'), n(r.returns, 'возврат разобрать', 'возврата разобрать', 'возвратов разобрать')]), view: 'receipts', action: 'Открыть приходы' },
      { category: 'attention', title: 'Ждут решения', value: nfmt(dec), warn: dec > 0, detail: detail([n(d.discrepancies, 'вопрос в журнале', 'вопроса в журнале', 'вопросов в журнале'),
        n(d.sellerRequests, 'заявка клиента на перенос', 'заявки клиентов на перенос', 'заявок клиентов на перенос'), n(d.recounts, 'пересчёт', 'пересчёта', 'пересчётов')]),
        view: d.discrepancies ? 'journal' : d.recounts ? 'inv' : d.sellerRequests ? 'products' : 'journal', action: 'Посмотреть решения' },
      { category: 'attention', title: 'Проблемы обмена', value: nfmt(exch), warn: exch > 0, detail: detail([x.sync.length ? '1С: ' + n(x.sync.length, 'неполадка', 'неполадки', 'неполадок') : '',
        x.wbUnmapped ? n(x.wbUnmapped, 'заказ WB не сопоставлен', 'заказа WB не сопоставлены', 'заказов WB не сопоставлены') : '', exch ? '' : 'Неполадок не видно']),
        view: x.sync.length ? '1c' : 'mp', action: 'Проверить обмен' },
      // На WB выставлено больше, чем свободно (владелец 06.10.2026).
      { category: 'attention', title: 'На WB больше, чем свободно', value: nfmt(wbOverItems), warn: wbOverItems > 0,
        detail: wbOver.length ? wbOver.map(o => o.name + ': ' + n(o.count, 'товар', 'товара', 'товаров')).join(' · ') : 'Расхождений нет',
        view: 'products', action: 'Посмотреть товары' },
      { title: 'Переписка с клиентами', value: '—', detail: 'Комментарии и документы по каждому приходу', view: 'receipts', action: 'Открыть приходы' },
    ]);
  }
  window.loadToday = loadToday;

  // Запуск склада (рецензия 04.10, рекомендация 6): шаги по фактическому
  // состоянию, заканчиваются первой настоящей операцией. Всё сделано — блока нет.
  const READY_STEPS = {
    survey: ['Заполните анкету склада', 'Как ведёте учёт остатков, часовой пояс, кто составляет поставки WB.', 'settings'],
    seller: ['Заведите продавца', 'Склад хранит товар продавцов — начните с одного.', 'mp'],
    catalog: ['Загрузите товары продавца', 'Каталог файлом или по одному: без него приход не собрать.', 'products'],
    stock_1c: ['Подключите 1С', 'Остатки и накладные придут из неё — вы выбрали учёт в 1С.', '1c'],
    stock_argus: ['Загрузите начальные остатки', 'Если товар уже лежит на складе. Пустой склад наполнится приходами.', 'warehouse'],
    cells: ['Разметьте ячейки', 'Если храните товар по адресам — тогда работник кладёт в ячейку, а Аргус помнит где.', 'warehouse'],
    worker: ['Заведите работника', 'Он получит ключ и будет принимать и собирать с телефона.', 'staff'],
    seller_key: ['Выдайте продавцу ключ', 'Он увидит свои товары, приходы и брак в своём кабинете.', 'mp'],
    first_operation: ['Проведите первый приход', 'С одним товаром: заведите приход, работник примет, продавец увидит у себя. После этого склад работает.', 'receipts'],
  };
  async function loadReadiness(){
    const box = document.getElementById('readyCard');
    if(!box || IS_MANAGER) return;
    let r;
    try{ r = await apiFetch('/api/warehouses/me/readiness'); }
    catch(e){
      box.hidden = false;
      box.innerHTML = '<div class="ready-title">Запуск склада</div><div class="ready-sub">Не удалось проверить шаги запуска.</div>'
        + '<button type="button" class="ready-step" onclick="loadReadiness()"><b>Повторить проверку</b></button>';
      return;
    }
    const must = r.steps.filter(s => !s.optional);
    const left = r.steps.filter(s => !s.done);
    if(must.every(s => s.done)){ box.hidden = true; return; }
    const firstNeeded = left.find(s => !s.optional);
    box.innerHTML = '<div class="ready-title">Запуск склада: сделано ' + must.filter(s => s.done).length + ' из ' + must.length + '</div>'
      + '<div class="ready-sub">Шаги отмечаются сами, когда дело сделано. Нажмите на шаг — откроется нужный раздел.</div>'
      + left.map(s => { const t = READY_STEPS[s.key] || [s.key, '', 'chat'];
        return '<button type="button" class="ready-step' + (s === firstNeeded ? ' next' : '') + '" onclick="switchView(\'' + t[2] + '\')">'
          + '<i>' + (s === firstNeeded ? '→' : '○') + '</i><div><b>' + escapeHTML(t[0]) + (s.optional ? ' <span class="opt">· по желанию</span>' : '') + '</b>'
          + '<span>' + escapeHTML(t[1]) + '</span></div></button>'; }).join('');
    box.hidden = false;
  }
  window.loadReadiness = loadReadiness;

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

  // Экран собирается из трёх источников: клиенты, их ключи площадок и то,
  // сколько заказов у каждого накопилось. Без третьего экран отвечает на
  // вопрос «подключено ли», а владельцу каждый день нужен другой — «у кого
  // сколько лежит».
  async function loadMarketplaces(){
    const [mps, pend] = await Promise.all([
      apiFetch('/api/marketplaces').catch((e) => {
        showWhToast('Не удалось загрузить площадки: ' + e.message);
        return [];
      }),
      apiFetch('/api/supplies/pending').catch(() => []),
    ]);
    marketplaces = mps || [];
    mpPending = pend || [];
    if(companies.length === 0) await loadCompanies();
    renderMarketplaces();
    loadUnresolved();
    loadWbOffices();
  }

  /* ============ Настройки склада — анкета ============
     Как работает склад, решает его владелец ответами здесь. Аргус под них
     подстраивается; под конкретный склад код не переделывают. */
  const TIMEZONES = [
    ['Europe/Kaliningrad', 'Калининград, UTC+2'], ['Europe/Moscow', 'Москва, UTC+3'], ['Europe/Samara', 'Самара, UTC+4'],
    ['Asia/Yekaterinburg', 'Екатеринбург, UTC+5'], ['Asia/Omsk', 'Омск, UTC+6'], ['Asia/Novosibirsk', 'Новосибирск, UTC+7'],
    ['Asia/Krasnoyarsk', 'Красноярск, UTC+7'], ['Asia/Irkutsk', 'Иркутск, UTC+8'], ['Asia/Yakutsk', 'Якутск, UTC+9'],
    ['Asia/Vladivostok', 'Владивосток, UTC+10'], ['Asia/Magadan', 'Магадан, UTC+11'], ['Asia/Kamchatka', 'Камчатка, UTC+12'],
    ['Europe/Minsk', 'Минск, UTC+3'], ['Asia/Almaty', 'Алматы, UTC+5'], ['Asia/Tashkent', 'Ташкент, UTC+5'],
  ];
  function renderSettingsTimezone(current){
    const input = document.getElementById('setTz'), menu = document.getElementById('setTzMenu'), label = document.getElementById('setTzLabel');
    if(!input || !menu || !label) return;
    input.value = current;
    const zones = TIMEZONES.some(z => z[0] === current) ? TIMEZONES : [[current, current], ...TIMEZONES];
    label.textContent = zones.find(z => z[0] === current)[1];
    menu.innerHTML = zones.map(([value, title]) => '<button type="button" data-timezone="' + escapeHTML(value)
      + '" aria-pressed="' + (value === current) + '" onclick="selectSettingsTimezone(' + escapeHTML(JSON.stringify(value)) + ')">'
      + escapeHTML(title) + '</button>').join('');
  }
  function selectSettingsTimezone(value){
    if(!TIMEZONES.some(z => z[0] === value) && value !== whSettings?.timezone) return;
    document.getElementById('setTz').value = value;
    document.getElementById('setTzLabel').textContent = TIMEZONES.find(z => z[0] === value)?.[1] || value;
    const choice = document.getElementById('setTzChoice');
    choice.querySelectorAll('[data-timezone]').forEach(button => button.setAttribute('aria-pressed', button.dataset.timezone === value));
    choice.open = false; choice.querySelector('summary').focus();
  }
  window.selectSettingsTimezone = selectSettingsTimezone;
  document.addEventListener('keydown', event => {
    const choice = event.target.closest?.('#setTzChoice[open]');
    if(choice && event.key === 'Escape'){ event.preventDefault(); choice.open = false; choice.querySelector('summary').focus(); }
  });
  document.addEventListener('click', event => {
    if(event.target.closest?.('#setTzChoice')) return;
    const choice = document.getElementById('setTzChoice');
    if(choice) choice.open = false;
  });
  async function loadSettings(){
    try{ whSettings = await apiFetch('/api/warehouses/me'); }
    catch(e){ showWhToast('Настройки не загрузились: ' + e.message); return; }
    const s = whSettings;
    document.getElementById('setName').value = s.name || '';
    document.getElementById('setCity').value = s.city || '';
    document.getElementById('setLegal').value = s.legal_name || '';
    document.querySelectorAll('input[name="setStock"]').forEach(r => { r.checked = r.value === s.stock_source; });
    document.querySelectorAll('input[name="setSupplies"]').forEach(r => { r.checked = r.value === s.wb_supplies_by; });
    renderSettingsTimezone(s.timezone || 'Europe/Moscow');
    document.getElementById('setWbNames').value = (s.wb_names || []).join(', ');
    document.getElementById('setWbSupplyLabel').value = s.wb_supply_label || '';
    document.getElementById('setVwReminders').checked = s.vw_reminders !== false;
    document.getElementById('setAddressStorage').checked = s.address_storage !== false;
    document.getElementById('setResult').textContent = s.setup_at ? '' : 'Ответьте на вопросы и нажмите «Сохранить».';
  }
  async function saveSettings(){
    const pick = (n) => (document.querySelector('input[name="' + n + '"]:checked') || {}).value;
    const body = {
      name: document.getElementById('setName').value.trim(),
      city: document.getElementById('setCity').value.trim(),
      legalName: document.getElementById('setLegal').value.trim(),
      timezone: document.getElementById('setTz').value,
      wbNames: document.getElementById('setWbNames').value.split(',').map(x => x.trim()).filter(Boolean),
      wbSupplyLabel: document.getElementById('setWbSupplyLabel').value.trim(),
      vwReminders: document.getElementById('setVwReminders').checked,
    };
    const stock = pick('setStock'), supplies = pick('setSupplies');
    if(stock) body.stockSource = stock;
    if(supplies) body.wbSuppliesBy = supplies;
    if(!body.name){ showWhToast('Название склада не может быть пустым.'); return; }
    if(!stock || !supplies){ showWhToast('Ответьте на оба вопроса: про учёт остатков и про поставки WB.'); return; }
    // Смена учёта меняет «Всего товара» у всех продавцов — показываем, насколько.
    if(whSettings && whSettings.stock_source && stock !== whSettings.stock_source){
      let totals = null;
      try{ totals = await apiFetch('/api/warehouses/me/stock-sources'); } catch(e){ totals = null; }
      const n = (v) => Number(v || 0).toLocaleString('ru-RU');
      const ok = await askConfirm((stock === 'argus' ? 'Считать остатки по ячейкам Аргуса, а не по 1С?' : 'Считать остатки по 1С, а не по ячейкам Аргуса?')
        + '\n\n' + (totals ? 'Сейчас товара продавцов: по 1С — ' + n(totals.onec) + ' шт., по Аргусу — ' + n(Number(totals.cells || 0) + Number(totals.staged || 0)) + ' шт.'
          + (totals.staged ? ' (в ячейках ' + n(totals.cells) + ' и собрано к отгрузке ' + n(totals.staged) + ')' : '') + '. '
          + 'У продавцов «Всего товара» станет ' + (stock === 'argus' ? 'числом из ячеек' : 'числом из 1С') + '. ' : '')
        + (stock === 'argus' ? 'Если товар ещё не разложен по ячейкам в Аргусе, у продавцов будет меньше, чем есть на самом деле.'
          : 'Числа появятся после первого обмена с 1С.'));
      if(!ok) return;
    }
    // Адресное хранение (06.10.2026): выключение переносит весь товар в «Склад».
    const addressOn = document.getElementById('setAddressStorage').checked;
    if(whSettings && (whSettings.address_storage !== false) !== addressOn){
      const ok = await askConfirm(addressOn
        ? 'Включить адресное хранение?\n\nТовар снова будут класть в ячейки и брать из ячеек. То, что лежит в общем месте «Склад», останется там, пока его не разложат по ячейкам.'
        : 'Выключить адресное хранение?\n\nВесь товар склада перенесётся в одно общее место «Склад», ячейки станут пустыми. При приёмке и сборке ячейку выбирать не будут. Схему склада потом можно перестроить — товар в «Складе» не помешает.');
      if(!ok) return;
      body.addressStorage = addressOn;
    }
    body.setupDone = true;
    try{
      whSettings = await apiFetch('/api/warehouses/me', { method: 'PATCH', body });
      if(body.addressStorage !== undefined && typeof renderWarehouseMap === 'function') renderWarehouseMap().catch(() => {});
      document.getElementById('setResult').textContent = 'Сохранено.';
      document.getElementById('settingsBadge').classList.remove('show');
      loadWarehouseInfo();
      showWhToast('Настройки склада сохранены.');
    } catch(e){ showWhToast('Не сохранилось: ' + e.message); }
  }
  window.saveSettings = saveSettings;
  async function changePassword(){
    const oldEl = document.getElementById('pwdOld'), newEl = document.getElementById('pwdNew');
    if(newEl.value.length < 8){ showWhToast('Новый пароль — не меньше 8 символов.'); return; }
    try{
      await apiFetch('/api/auth/owner/password', { method: 'POST', body: { currentPassword: oldEl.value, newPassword: newEl.value } });
      oldEl.value = ''; newEl.value = '';
      showWhToast('Пароль изменён.');
    } catch(e){ showWhToast('Не получилось: ' + e.message); }
  }
  window.changePassword = changePassword;

  /* ============ Окно продавца: WB и склады на WB ============
     Владелец 01.10.2026: нажал на продавца — видишь всё про его WB в одном
     месте: ключ, действия и ВСЕ его склады на WB с галочками «товар для
     этого склада лежит у нас». Заказы Аргус берёт только с отмеченных
     складов; неотмеченные не удаляются и вернутся, если поставить галочку. */
  let wbOffices = { offices: [], sellers: [], ffName: '' };   // сводка по продавцам для карточек
  async function loadWbOffices(){
    try{ wbOffices = await apiFetch('/api/marketplaces/wb/offices'); }
    catch(e){ wbOffices = { offices: [], sellers: [], ffName: '' }; }
    renderMpCards();
  }
  function wbMoved(r){
    return (r && r.hidden ? ' Из работы убрано заказов: ' + r.hidden + '.' : '')
      + (r && r.restored ? ' Вернулось в работу заказов: ' + r.restored + '.' : '');
  }
  const canManageKeys = () => !IS_MANAGER || (authPayload.grants || []).includes('marketplaces');

  let sp = { companyId: null, data: null, error: '', origin: 'seller' };
  let warehouseVwCompanyId = '';
  let warehouseVwCreateRequested = false;
  const spOpen = () => document.getElementById('wbWhModal').classList.contains('open');
  async function openSellerPanel(companyId){
    closeWarehouseVwStock(false);
    warehouseVwCreateRequested = false;
    document.getElementById('warehouseVwWorkspace').open = false;
    document.getElementById('warehouseVwBody').innerHTML = '';
    sp = { companyId, data: null, error: '', vw: null, vwForm: null, origin: 'seller' };
    const c = companies.find(x => x.id === companyId);
    document.getElementById('wbWhTitle').textContent = c ? c.name : 'Продавец';
    document.getElementById('wbWhModal').classList.add('open');
    renderSellerPanel();
    loadSellerVw();
    await loadSellerPanelData();
  }
  window.openSellerPanel = openSellerPanel;

  // В «Клиентах» остаётся карточка продавца, а управление его складами
  // доступно рядом с ячейками. Один контекст формы не дублирует id полей.
  function renderWarehouseVwPicker(){
    const host = document.getElementById('warehouseVwPicker');
    const editing = sp.origin === 'warehouse' && !!sp.vwForm;
    if(host){
      host.hidden = editing;
      host.innerHTML = editing ? '' : stockCompanyChoiceHtml(warehouseVwCompanyId, 'setWarehouseVwCompany', 'Выберите клиента');
    }
    const create = document.getElementById('warehouseVwCreate');
    if(create){ create.hidden = editing; create.disabled = !companies.length; }
  }
  function renderWarehouseVw(){
    renderWarehouseVwPicker();
    const body = document.getElementById('warehouseVwBody');
    if(!body) return;
    body.innerHTML = sp.origin === 'warehouse' && sp.companyId
      ? vwSectionHtml() : '<div class="stock-hint">' + (warehouseVwCreateRequested
        ? 'Выберите клиента — затем укажите название и назначение виртуального склада.'
        : 'Выберите клиента, чтобы увидеть и настроить его виртуальные склады.') + '</div>';
  }
  function setWarehouseVwCompany(companyId){
    if(!canOpenView('warehouse') || companyId && !companies.some(c => c.id === companyId)) return;
    if(warehouseVwStockSession && warehouseVwStockSession.companyId !== companyId) closeWarehouseVwStock(false);
    warehouseVwCompanyId = companyId;
    if(sp.origin === 'warehouse' && sp.companyId === companyId){
      renderWarehouseVwPicker();
      if(!document.getElementById('warehouseVwBody').childElementCount) renderWarehouseVw();
      return;
    }
    closeWbWarehouses();
    document.getElementById('wbWhBody').innerHTML = '';
    sp = { companyId, data: null, error: '', vw: null, vwForm: null, origin: 'warehouse' };
    renderWarehouseVw();
    if(companyId) loadSellerVw();
  }
  function startWarehouseVwCreate(companyId){
    if(!canOpenView('warehouse')) return;
    closeWarehouseVwStock(false);
    if(!companies.length){ showWhToast('Сначала добавьте клиента в разделе «Клиенты».'); return; }
    const selected = [companyId, warehouseVwCompanyId, productsFor, companies.length === 1 ? companies[0].id : '']
      .find(id => id && companies.some(c => c.id === id)) || '';
    warehouseVwCreateRequested = true;
    switchView('warehouse');
    document.getElementById('warehouseVwWorkspace').open = true;
    setWarehouseVwCompany(selected);
    if(sp.origin === 'warehouse' && sp.companyId && sp.vw && !sp.vw.error){
      warehouseVwCreateRequested = false;
      openVwForm();
    }
    if(!selected){ renderWarehouseVw(); document.querySelector('#warehouseVwPicker summary')?.focus(); }
  }
  function onWarehouseVwToggle(){
    if(!document.getElementById('warehouseVwWorkspace').open) return;
    renderWarehouseVwPicker();
    setWarehouseVwCompany(warehouseVwCompanyId);
  }
  Object.assign(window, { setWarehouseVwCompany, onWarehouseVwToggle, startWarehouseVwCreate });

  function closeWarehouseVwStock(restore = true){
    const session = warehouseVwStockSession;
    if(!session) return;
    warehouseVwStockSession = null;
    session.controller?.close(false);
    const host = document.getElementById('warehouseVwStockPane');
    host.hidden = true;
    host.replaceChildren();
    const view = document.getElementById('view-warehouse');
    view.classList.remove('vw-stock-open');
    if(restore && sp === session.context){
      view.scrollTop = session.scrollTop;
      [...document.querySelectorAll('[data-vw-stock]')].find(el => el.dataset.vwStock === session.warehouseId)?.focus({preventScroll:true});
    }
  }
  function openVwStock(warehouseId){
    if(!canOpenView('warehouse') || sp.origin !== 'warehouse' || !sp.companyId || sp.vw?.error) return;
    const warehouse = sp.vw?.warehouses.find(w => w.id === warehouseId);
    if(!warehouse || !window.ArgusVwStock) return;
    closeWarehouseVwStock(false);
    const context = sp, view = document.getElementById('view-warehouse');
    const host = document.getElementById('warehouseVwStockPane');
    const session = {context,companyId:context.companyId,warehouseId,scrollTop:view.scrollTop,controller:null};
    warehouseVwStockSession = session;
    host.hidden = false;
    view.classList.add('vw-stock-open');
    view.scrollTop = 0;
    session.controller = window.ArgusVwStock.open({host,companyId:context.companyId,
      sessionScope:{role:authPayload.role,warehouseId:authPayload.warehouseId,
        ...(IS_MANAGER?{staffKeyId:authPayload.staffKeyId}:{ownerId:authPayload.ownerId})},
      companyName:companies.find(c => c.id === context.companyId)?.name || '',warehouse,request:apiFetch,
      onClose:() => {if(warehouseVwStockSession === session) closeWarehouseVwStock();},
      onChanged:async () => {
        delete vwCache[context.companyId];
        if(sp !== context) return;
        const refreshed = await Promise.allSettled([loadSellerVw(),renderWarehouseMap(),productsFor === context.companyId ? loadProducts() : Promise.resolve()]);
        if(sp === context && refreshed.some(r => r.status === 'rejected')) showWhToast('Операция обработана, но обновить все данные не удалось. Откройте склад ещё раз.');
      },
    });
  }
  window.openVwStock = openVwStock;

  /* ---------- Склады продавца (виртуальные склады, владелец 02.10.2026) ----------
     Часть товара продавца под своё назначение: площадка, юрлицо, «иное».
     Заводит склад; продавец их видит и выбирает в привозе. «Основной» — весь
     товар продавца (владелец 03.10.2026), «Остальной товар» — всё,
     что не разнесено по заведённым складам. */
  const VW_MP = { wb: 'WB', ozon: 'Озон', yandex: 'Яндекс Маркет', other: 'иное' };
  const vwCache = {};   // companyId → { warehouses, wbChoices, at }
  async function vwOf(companyId, fresh = false){
    const c = vwCache[companyId];
    if(c && !fresh && Date.now() - c.at < 30000) return c;
    const d = await apiFetch('/api/vwarehouses?companyId=' + encodeURIComponent(companyId));
    vwCache[companyId] = { warehouses: d.warehouses, wbChoices: d.wbChoices, rights: d.rights, at: Date.now() };
    return vwCache[companyId];
  }
  window.vwOf = vwOf;
  async function loadSellerVw(){
    const context = sp, id = context.companyId;
    if(!id) return;
    try{
      const d = await vwOf(id, true);
      let tasks = [];
      if(d.warehouses.length){ try{ tasks = (await apiFetch('/api/vwarehouses/move-tasks')).filter(t => t.companyId === id); } catch(_){} }
      if(sp === context){
        sp.vw = d; sp.vwTasks = tasks;
        if(sp.origin === 'warehouse' && warehouseVwCreateRequested){ warehouseVwCreateRequested = false; openVwForm(); }
        else renderSellerPanel();
      }
    }
    catch(e){ if(sp === context){ sp.vw = { error: e.message }; renderSellerPanel(); } }
  }
  function vwSectionHtml(){
    const v = sp.vw;
    const creating = sp.vwForm && !sp.vwForm.id;
    let html = '<div class="sp-sec"><div class="sp-head"><b>' + (creating ? 'Новый виртуальный склад' : 'Виртуальные склады клиента') + '</b>'
      + (sp.origin !== 'warehouse' && v && !v.error && !sp.vwForm ? '<button class="wh-onboarding-btn" type="button" onclick="openVwForm()">Создать виртуальный склад</button>' : '') + '</div>'
      + '<div class="mp-card-sub stock-vw-intro">' + (creating
        ? 'Укажите название и назначение. Отдельное хранение можно включить при необходимости.'
        : 'Разделите товар по площадкам, юрлицам или другим направлениям. По умолчанию меняется только учёт, товар остаётся в тех же ячейках.') + '</div>';
    if(!v) return html + '<div class="mp-card-sub">Загружаю…</div></div>';
    if(v.error) return html + '<div class="mp-card-sub wbo-warn">Не загрузилось: ' + escapeHTML(v.error) + '</div>'
      + '<button type="button" class="wh-onboarding-btn" onclick="loadSellerVw()">Повторить загрузку</button></div>';
    if(creating) return html + vwFormHtml() + '</div>';
    html += '<div class="sp-key"><span><b>Основной</b> <span class="mp-card-sub">весь товар продавца, без брака</span></span></div>';
    for(const w of v.warehouses){
      if(sp.vwForm && sp.vwForm.id === w.id){ html += vwFormHtml(); continue; }
      const tags = [VW_MP[w.marketplace]];
      if(w.keepSeparate) tags.push(w.defectSeparate ? 'хранится отдельно, брак тоже' : 'хранится отдельно');
      if(w.zone && w.zone.cells) tags.push('зона: ' + w.zone.text + ' (пустых ' + w.zone.empty + ' из ' + w.zone.cells + ')');
      html += '<div class="sp-key"><span><b>' + escapeHTML(w.name) + '</b> <span class="mp-card-sub">' + escapeHTML(tags.join(' · ')) + '</span>'
        + (w.zone && w.zone.cells && !w.zone.empty ? '<span class="mp-card-sub wbo-warn">в зоне нет пустых ячеек — новый товар положат рядом</span>' : '') + '</span>'
        + '<span class="mp-card-acts" style="margin:0;">'
        + (sp.origin === 'warehouse' ? '<button type="button" class="mp-act" data-vw-stock="' + escapeHTML(w.id) + '" onclick="openVwStock(\'' + w.id + '\')">Добавить товары</button>' : '')
        + '<button type="button" class="mp-act" onclick="openVwForm(\'' + w.id + '\')">Изменить</button>'
        + '<button type="button" class="mp-act warn" onclick="archiveVw(\'' + w.id + '\')">Убрать</button></span></div>';
    }
    if(sp.vwForm && !sp.vwForm.id) html += vwFormHtml();
    html += '<div class="sp-key"><span><b>Остальной товар</b> <span class="mp-card-sub">не отнесён ни к одному складу · любая площадка</span></span></div>';
    // Задания грузчику «переложить» по складам этого продавца.
    const tasks = (sp.vwTasks || []);
    if(tasks.length){
      html += '<div class="mp-card-sub" style="margin-top:8px;"><b>Задания грузчику «переложить» · ' + tasks.length + '</b></div>'
        + tasks.map(t => '<div class="sp-key"><span>«' + escapeHTML(t.name || t.sku) + '», осталось ' + nfmt(t.left) + ' из ' + nfmt(t.qty) + ' шт. из ячейки ' + escapeHTML(t.fromLabel)
          + '<span class="mp-card-sub">' + (t.kind === 'transfer' ? 'перенос ' + escapeHTML(t.transfer || '') + ': «' + escapeHTML(t.fromName) + '» → «' + escapeHTML(t.toName) + '»'
            : 'разделить: товар склада «' + escapeHTML(t.toName) + '» лежит вместе с другим') + '</span></span>'
          + '<span class="mp-card-acts" style="margin:0;"><span class="mp-act warn" onclick="cancelVwTask(\'' + t.id + '\')">Снять</span></span></div>').join('');
    }
    return html + '</div>';
  }
  function vwFormHtml(){
    const f = sp.vwForm;
    const company = companies.find(c => c.id === sp.companyId);
    return '<div class="sp-vw-form" data-form>'
      + '<div class="stock-vw-form-context"><span>Клиент</span><b>' + escapeHTML(company?.name || '') + '</b></div>'
      + '<label class="sp-vw-field">Название виртуального склада<input class="mp-field" id="vwName" maxlength="100" placeholder="Например: WB, Опт или название юрлица" value="' + escapeHTML(f.name || '') + '"></label>'
      + '<input type="hidden" id="vwMp" value="' + escapeHTML(f.marketplace) + '"><details class="stock-choice" id="vwMarketplaceChoice">'
      + '<summary><span class="stock-choice-label">Назначение</span><b>' + escapeHTML(VW_MP[f.marketplace]) + '</b></summary><div class="stock-choice-menu">'
      + Object.entries(VW_MP).map(([k, t]) => '<button type="button" aria-pressed="' + (f.marketplace === k) + '" onclick="setVwMarketplace(\'' + k + '\')">' + (k === 'other' ? 'Иное — вне площадок' : t) + '</button>').join('')
      + '</div></details>'
      + '<div class="mp-card-sub">Для юрлица, опта или другого направления выберите «Иное — вне площадок».</div>'
      + '<label class="sp-check"><input type="checkbox" id="vwSep"' + (f.keepSeparate ? ' checked' : '') + ' onchange="document.getElementById(\'vwSepMore\').hidden = !this.checked">'
      + '<span>Хранить отдельно<small>Товар этого склада не лежит в одной ячейке с товаром других складов продавца. Грузчику подсказываются отдельные ячейки.</small></span></label>'
      + '<div id="vwSepMore"' + (f.keepSeparate ? '' : ' hidden') + '>'
      +   '<label class="sp-check"><input type="checkbox" id="vwSepDefect"' + (f.defectSeparate ? ' checked' : '') + '><span>И брак тоже отдельно<small>Иначе брак этого склада лежит в общих ячейках брака.</small></span></label>'
      +   '<label class="sp-vw-field">Зона — не обязательно<input class="mp-field" id="vwZone" maxlength="2000" placeholder="Например: ряд 3 или ячейки 4.1.2, 4.1.3" value="' + escapeHTML(f.zoneText || '') + '"></label>'
      +   '<div class="mp-card-sub">Зона — закреплённые ячейки: ничего другого туда не кладут. Заполнится — товар положат рядом, а вам придёт предупреждение.</div>'
      + '</div>'
      + '<div id="vwFormError" class="stock-form-error" role="alert" hidden></div>'
      + '<div class="rc-actions"><span class="grow"></span><button type="button" class="wh-onboarding-btn" onclick="closeVwForm()">Отмена</button>'
      + '<button type="button" class="wh-onboarding-btn primary" id="vwSave" onclick="saveVw()">' + (f.id ? 'Сохранить' : 'Создать виртуальный склад') + '</button></div></div>';
  }
  function openVwForm(id){
    if(!sp.vw || sp.vw.error) return;
    const w = id ? (sp.vw.warehouses || []).find(x => x.id === id) : null;
    sp.vwForm = w ? { id: w.id, name: w.name, marketplace: w.marketplace, keepSeparate: w.keepSeparate, defectSeparate: w.defectSeparate,
        zoneText: w.zone ? w.zone.text : '', was: w }
      : { id: null, name: '', marketplace: 'wb', keepSeparate: false, defectSeparate: false, zoneText: '' };
    renderSellerPanel();
    const el = document.getElementById('vwName'); if(el) el.focus();
  }
  function closeVwForm(){
    warehouseVwCreateRequested = false;
    sp.vwForm = null; renderSellerPanel();
    if(sp.origin === 'warehouse') document.getElementById('warehouseVwCreate')?.focus();
  }
  function setVwMarketplace(value){
    if(!VW_MP[value]) return;
    document.getElementById('vwMp').value = value;
    const choice = document.getElementById('vwMarketplaceChoice');
    choice.querySelector('summary b').textContent = VW_MP[value];
    choice.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', button.getAttribute('onclick').includes("'" + value + "'")));
    choice.open = false;
  }
  window.setVwMarketplace = setVwMarketplace;
  // «ряд 3, 4.1.2» → { rows: [3], cells: ['4.1.2'] }.
  function parseZone(text){
    const rows = [], cells = [];
    String(text || '').split(/[,;]+/).map(x => x.trim()).filter(Boolean).forEach(x => {
      const m = x.match(/^(?:ряд\s*)?(\d+)$/i);
      if(m) rows.push(Number(m[1])); else cells.push(x);
    });
    return { rows, cells };
  }
  // Три ответа: задания, только новое, отмена (null).
  function askSeparate(name, n){
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'ask-overlay';
      overlay.innerHTML = '<div class="ask-box" role="dialog" aria-modal="true"><div class="ask-title"></div><div class="ask-text"></div>'
        + '<div class="ask-actions" style="flex-wrap:wrap;"><button type="button" class="wh-onboarding-btn ask-cancel">Отмена</button>'
        + '<button type="button" class="wh-onboarding-btn ask-new">Только новый товар</button>'
        + '<button type="button" class="wh-onboarding-btn primary ask-tasks">Создать задания</button></div></div>';
      overlay.querySelector('.ask-title').textContent = 'Товар склада «' + name + '» уже лежит вместе с другим';
      overlay.querySelector('.ask-text').textContent = 'В ' + n + ' ' + pluralRu(n, 'ячейке', 'ячейках', 'ячейках')
        + ' товар этого склада лежит вместе с товаром других складов продавца. Создать грузчику задания переложить его отдельно — или разделять только новый товар, а уже лежащее оставить как есть?';
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.addEventListener('click', (e) => { if(e.target === overlay) done(null); });
      overlay.querySelector('.ask-cancel').onclick = () => done(null);
      overlay.querySelector('.ask-new').onclick = () => done('new');
      overlay.querySelector('.ask-tasks').onclick = () => done('tasks');
      document.body.appendChild(overlay);
    });
  }
  async function saveVw(){
    const context = sp, companyId = context.companyId;
    const f = context.vwForm; if(!f) return;
    const name = document.getElementById('vwName').value.trim();
    const marketplace = document.getElementById('vwMp').value;
    const keepSeparate = document.getElementById('vwSep').checked;
    const defectSeparate = keepSeparate && document.getElementById('vwSepDefect').checked;
    const zoneText = keepSeparate ? document.getElementById('vwZone').value.trim() : '';
    const error = document.getElementById('vwFormError');
    if(error){ error.hidden = true; error.textContent = ''; }
    if(!name){
      if(error){ error.hidden = false; error.textContent = 'Укажите название виртуального склада.'; }
      document.getElementById('vwName').focus(); return;
    }
    const body = { companyId, name, marketplace, keepSeparate, defectSeparate };
    const was = f.was || {};
    if(zoneText !== (was.zone ? was.zone.text : '')) body.zone = parseZone(zoneText);
    const btn = document.getElementById('vwSave'); btn.disabled = true;
    try{
      if(f.id){
        // Включают «хранить отдельно», а товар уже лежит вместе — спросить.
        const turnedOn = (keepSeparate && !was.keepSeparate) || (defectSeparate && !was.defectSeparate);
        if(turnedOn){
          const m = await apiFetch('/api/vwarehouses/' + f.id + '/mixed?companyId=' + encodeURIComponent(companyId) + (defectSeparate ? '&defect=1' : ''));
          if(sp !== context) return;
          if(m.cells){
            const answer = await askSeparate(name, m.cells);
            if(sp !== context) return;
            if(!answer){ btn.disabled = false; return; }
            body.separateExisting = answer;
          }
        }
        const r = await apiFetch('/api/vwarehouses/' + f.id, { method: 'PATCH', body });
        delete vwCache[companyId];
        if(sp !== context) return;
        sp.vwForm = null;
        showWhToast('Склад сохранён.' + (r.tasks ? ' Грузчику созданы задания «переложить»: ' + r.tasks + '.' : '')
          + (r.zone && r.zone.foreign ? ' В зоне лежит чужой товар в ' + r.zone.foreign + ' яч. — его надо убрать.' : ''));
      } else {
        if(body.zone === undefined && zoneText) body.zone = parseZone(zoneText);
        await apiFetch('/api/vwarehouses', { method: 'POST', body });
        delete vwCache[companyId];
        if(sp !== context) return;
        sp.vwForm = null;
        showWhToast('Склад «' + name + '» заведён — продавцу пришло уведомление.');
      }
      await loadSellerVw();
    } catch(e){ if(sp === context){
      if(error){ error.hidden = false; error.textContent = 'Не удалось сохранить склад: ' + e.message; }
      showWhToast('Не получилось: ' + e.message); btn.disabled = false;
    } }
  }
  async function archiveVw(id){
    const context = sp, companyId = context.companyId;
    const w = (context.vw.warehouses || []).find(x => x.id === id); if(!w) return;
    if(!await askConfirm('Убрать склад «' + w.name + '»?\n\nТовар никуда не перекладывают: он остаётся на тех же полках и просто числится в «Остальном товаре». '
      + 'Незаконченные переносы и задания «переложить» по этому складу отменятся. Продавец получит уведомление.')) return;
    if(sp !== context) return;
    try{
      const r = await apiFetch('/api/vwarehouses/' + id + '?companyId=' + encodeURIComponent(companyId), { method: 'DELETE' });
      delete vwCache[companyId];
      if(sp !== context) return;
      showWhToast('Склад «' + w.name + '» убран.' + (r && r.units ? ' Товар (' + nfmt(r.units) + ' шт.) остался на месте и теперь в «Остальном товаре».' : ''));
      await loadSellerVw();
    } catch(e){ showWhToast(e.message); }
  }
  async function cancelVwTask(id){
    const context = sp;
    if(!await askConfirm('Снять задание «переложить»?\n\nНепереложенное останется там, где лежит, и числится за прежним складом.')) return;
    if(sp !== context) return;
    try{
      await apiFetch('/api/vwarehouses/move-tasks/' + id + '/cancel', { method: 'POST', body: {} });
      if(sp !== context) return;
      showWhToast('Задание снято.');
      await loadSellerVw();
    } catch(e){ showWhToast(e.message); }
  }
  window.cancelVwTask = cancelVwTask;
  Object.assign(window, { openVwForm, closeVwForm, saveVw, archiveVw, loadSellerVw });
  async function copySellerKey(code){
    try{ await navigator.clipboard.writeText(code); showWhToast('Ключ ' + code + ' скопирован.'); }
    catch(e){ showWhToast('Ключ: ' + code); }
  }
  window.copySellerKey = copySellerKey;
  // Ключ сотрудника или продавца копируется нажатием (владелец 06.10.2026).
  function keyCopyHtml(code){
    return '<button type="button" class="key-copy" data-key="' + escapeHTML(code) + '" onclick="copySellerKey(this.dataset.key)"'
      + ' title="Скопировать ключ" aria-label="Скопировать ключ ' + escapeHTML(code) + '">' + escapeHTML(code)
      + '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="2" stroke="currentColor" stroke-width="1.5"/>'
      + '<path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" stroke="currentColor" stroke-width="1.5"/></svg></button>';
  }
  function closeWbWarehouses(){ document.getElementById('wbWhModal').classList.remove('open'); }
  window.closeWbWarehouses = closeWbWarehouses;
  async function loadSellerPanelData(){
    const context = sp, id = context.companyId;
    if(!id || !marketplaces.some(m => m.companyId === id && m.marketplace === 'wb')){ sp.data = null; renderSellerPanel(); return; }
    try{ const d = await apiFetch('/api/marketplaces/' + id + '/wb/warehouses'); if(sp === context){ sp.data = d; sp.error = ''; } }
    catch(e){ if(sp === context) sp.error = e.message; }
    if(sp === context) renderSellerPanel();
  }
  function renderSellerPanel(){
    if(sp.origin === 'warehouse'){ renderWarehouseVw(); return; }
    const body = document.getElementById('wbWhBody');
    if(!body || !sp.companyId) return;
    const id = sp.companyId;
    const cred = marketplaces.find(m => m.companyId === id && m.marketplace === 'wb') || null;
    const st = mpState(cred);
    const pend = mpPending.find(x => x.companyId === id) || null;
    const q = (s) => "'" + s + "'";
    const company = companies.find(c => c.id === id);
    let html = '';
    if(company){
      const active = company.keys.filter(k => k.active), revoked = company.keys.filter(k => !k.active);
      const keyRow = (k) => '<div class="sp-key' + (k.active ? '' : ' revoked') + '"><span><code>' + escapeHTML(k.keyCode) + '</code>'
        + '<span class="mp-card-sub">выдан ' + new Date(k.issuedAt).toLocaleDateString('ru-RU') + (k.active ? '' : ' · отозван') + '</span></span>'
        + '<span class="mp-card-acts" style="margin:0;">'
        + (k.active ? '<span class="mp-act" onclick="copySellerKey(' + q(k.keyCode) + ')">Скопировать</span>' : '')
        + '<span class="mp-act' + (k.active ? ' warn' : '') + '" onclick="toggleSellerKey(' + q(k.id) + ')">' + (k.active ? 'Отозвать' : 'Восстановить') + '</span>'
        + '</span></div>';
      html += '<div class="sp-sec"><div class="sp-head"><b>Кабинет продавца</b>'
        + '<button class="wh-onboarding-btn" type="button" onclick="issueSellerKey(' + q(id) + ')">+ Выдать ключ</button></div>'
        + '<div class="sp-key"><span>Остатки, заказы, склад брака — как видит продавец. Решить по браку за продавца можно там же.</span>'
        + '<a class="mp-act" href="client_access.html?companyId=' + encodeURIComponent(id) + '#products">Открыть кабинет продавца</a></div>'
        + '<div class="mp-card-sub" style="margin-bottom:6px;">По ключу продавец входит в свой кабинет и видит только свой товар, заказы и документы.</div>'
        + (active.length ? active.map(keyRow).join('') : '<div class="mp-card-sub wbo-warn">Рабочего ключа нет — продавец не может войти.</div>')
        + (revoked.length ? '<details class="wbo-more"><summary>Отозванные ключи — ' + revoked.length + '</summary>' + revoked.map(keyRow).join('') + '</details>' : '')
        + '<div class="sp-key"><span>1С: ' + (company.one_c_external_id ? '<b>' + escapeHTML(company.one_c_counterparty_name || 'контрагент связан') + '</b>' : 'не связан с контрагентом') + '</span>'
        + '<span class="mp-act" onclick="openOneCMapping(' + q(id) + ')">' + (company.one_c_external_id ? 'Изменить' : 'Связать с 1С') + '</span></div>'
        + '</div>';
      html += vwSectionHtml();
    }
    html += '<div class="sp-sec"><div class="sp-head"><b>Wildberries</b>'
      + (st.chip ? '<span class="mp-chip ' + st.chipCss + '">' + st.chip + '</span>' : '') + '</div>';
    if(!cred){
      html += canManageKeys()
        ? '<div class="mp-card-sub" style="margin-bottom:10px;">Ключ API продавца из его кабинета WB. Сохраняется зашифрованным, обратно не показывается.</div>'
          + '<textarea id="spToken" class="mp-field" rows="3" placeholder="Ключ API продавца — длинная строка вида eyJhbGciOiJFUzI1NiIs…" style="resize:vertical; margin-bottom:10px;"></textarea>'
          + '<button class="wh-onboarding-btn primary" type="button" onclick="connectMarketplace()">Подключить WB</button>'
        : '<div class="mp-card-sub">WB не подключён. Подключить ключ может руководитель склада.</div>';
    } else {
      html += (cred.sellerName ? '<div class="mp-card-sub">Кабинет WB: ' + escapeHTML(cred.sellerName) + (cred.sellerInn ? ', ИНН ' + escapeHTML(cred.sellerInn) : '') + '</div>' : '')
        + '<div class="mp-card-sub">' + escapeHTML(st.word) + ' · ' + (cred.writeEnabled
            ? 'Аргус сам создаёт поставку на WB и меняет статусы заказов'
            : 'Аргус только читает заказы, статусы на WB меняются вручную') + '</div>'
        + (pend && pend.orders ? '<div class="mp-card-sub">Ждут поставки: ' + pend.orders + ' ' + pluralRu(pend.orders, 'заказ', 'заказа', 'заказов') + '</div>' : '')
        + '<div class="mp-card-acts" style="margin-top:10px;">'
        + '<span class="mp-act" onclick="syncMarketplace(' + q(id) + ')">Забрать заказы</span>'
        + '<span class="mp-act" onclick="checkMarketplace(' + q(id) + ')">Проверить связь</span>'
        + (canManageKeys()
            ? '<span class="mp-act" onclick="toggleMpWrite(' + q(id) + ', ' + q('wb') + ', ' + (cred.writeEnabled ? 'false' : 'true') + ')">'
              + (cred.writeEnabled ? 'Запретить менять статусы' : 'Разрешить менять статусы') + '</span>'
              + '<span class="mp-act warn" onclick="disconnectMarketplace(' + q(id) + ', ' + q('wb') + ')">Отключить</span>'
            : '')
        + '</div>';
    }
    html += '<div id="spResult"></div></div>';

    if(cred){
      const d = sp.data;
      const ff = (d && d.ffName) || 'ваш склад';
      html += '<div class="sp-sec"><div class="sp-head"><b>Склады продавца на WB</b>'
        + '<button class="wh-onboarding-btn" type="button" id="spRefresh" onclick="refreshSellerWarehouses()">Обновить из WB</button></div>'
        + '<div class="mp-card-sub" style="margin-bottom:8px;">Отметьте склады, товар для которых лежит у вас. Заказы с неотмеченных складов Аргус в работу не берёт — '
        + 'они не удаляются и вернутся, если поставить галочку. Склады с «' + escapeHTML(ff) + '» в названии Аргус отмечает сам '
        + '(если продавцы называют вас иначе — «Настройки склада» → «Как вас называют продавцы на WB»).</div>';
      if(sp.error) html += '<div class="oc-note">Не загрузилось: ' + escapeHTML(sp.error) + '</div>';
      else if(!d) html += '<div class="mp-card-sub">Загружаю склады продавца…</div>';
      else {
        const ours = d.warehouses.filter(w => w.ours).length;
        const single = d.warehouses.filter(w => !w.gone).length === 1;
        const who = (w) => w.auto
          ? (w.ours ? (w.nameMatches ? 'отмечен Аргусом: в названии «' + ff + '»' : single ? 'отмечен Аргусом: единственный склад продавца' : 'отмечен Аргусом') : 'не отмечен')
          : (w.ours ? 'отметил ' : 'снял ') + w.decidedBy;
        html += '<div class="sp-count' + (ours ? '' : ' wbo-warn') + '">' + (d.warehouses.length
            ? (ours ? 'Вашими отмечены ' + ours + ' из ' + d.warehouses.length : 'Ни один склад не отмечен — заказы этого продавца не забираются')
            : 'У продавца на WB нет складов — нажмите «Обновить из WB», если он их уже завёл') + '</div>'
          + d.warehouses.map(w => '<label class="wbw-row' + (w.ours ? ' on' : '') + '"><input type="checkbox" ' + (w.ours ? 'checked' : '')
            + ' onchange="markWbWarehouse(' + q(w.id) + ', this.checked, this)"><span><b>' + escapeHTML(w.name) + '</b>'
            + (w.gone ? ' <span class="mp-chip stale">удалён на WB</span>' : '')
            + '<span class="mp-card-sub">' + escapeHTML([w.office.city, w.office.address || w.office.name].filter(Boolean).join(', ') || 'пункт приёмки WB не указан') + '</span>'
            + '<span class="mp-card-sub">В работе заказов: ' + w.openOrders + (w.hidden ? ' · не в работе: ' + w.hidden : '') + ' · ' + escapeHTML(who(w)) + '</span>'
            + '</span></label>').join('')
          + '<div class="mp-card-sub" style="margin-top:10px;">'
          + (d.refreshedAt ? 'Список складов получен из WB ' + escapeHTML(formatLastSeen(d.refreshedAt)) + '; Аргус обновляет его сам раз в час. ' : '')
          + (d.error ? 'WB не отдал список: ' + escapeHTML(d.error) + '. ' : '')
          + (d.stocksError ? 'Остатки WB не читаются: ' + escapeHTML(d.stocksError) + '.'
            : d.stocksAt ? 'Остатки WB по вашим складам прочитаны ' + escapeHTML(formatLastSeen(d.stocksAt)) + '.' : '')
          + '</div>';
      }
      html += '</div>';
    }
    body.innerHTML = html;
  }
  async function refreshSellerWarehouses(){
    const id = sp.companyId;
    const btn = document.getElementById('spRefresh');
    if(btn){ btn.disabled = true; btn.textContent = 'Спрашиваю WB…'; }
    try{
      const d = await apiFetch('/api/marketplaces/' + id + '/wb/warehouses/refresh', { method: 'POST' });
      if(sp.companyId === id){ sp.data = d; sp.error = ''; }
      showWhToast('Склады продавца обновлены из WB.');
      loadMarketplaces();
    } catch(e){ showWhToast('Не получилось: ' + e.message); }
    renderSellerPanel();
  }
  window.refreshSellerWarehouses = refreshSellerWarehouses;
  async function markWbWarehouse(id, ours, box){
    const w = sp.data && sp.data.warehouses.find(x => x.id === id);
    if(!ours && w && !await askConfirm('Снять отметку со склада «' + w.name + '»?\n\nЗаказы с него уйдут из работы'
        + (w.openOrders ? ' (сейчас в работе ' + w.openOrders + ')' : '') + ' — не удалятся: отметите снова, вернутся. '
        + 'Заказы, по которым склад уже работает (в поставке, с отбором), останутся.')){ box.checked = true; return; }
    box.disabled = true;
    const companyId = sp.companyId;
    try{
      const r = await apiFetch('/api/marketplaces/' + companyId + '/wb/warehouses/' + encodeURIComponent(id), { method: 'PATCH', body: { ours } });
      showWhToast((ours ? 'Склад отмечен вашим.' : 'Отметка снята.') + wbMoved(r));
      await loadSellerPanelData();
      loadMarketplaces();
    } catch(e){ showWhToast('Не удалось: ' + e.message); box.checked = !ours; box.disabled = false; }
  }
  window.markWbWarehouse = markWbWarehouse;

  let mpPending = [];
  let mpUnresolved = [];

  /* ============ Артикулы, ждущие сопоставления ============

     Заказ приезжает с артикулом продавца. Склад живёт нашими артикулами,
     и пока эти два не связаны, заказ виден, а собрать его нечем: кладовщик
     пойдёт искать на полке код, которого на складе нет.

     Таблица связей существовала с самого начала и заполнялась один раз,
     файлом. Экрана к ней не было — то есть владелец смотрел на «не удалось
     узнать товар у 36 заданий» и не мог сделать ровно ничего. */

  async function loadUnresolved(){
    const box = document.getElementById('mpUnresolved');
    if(!box) return;
    try{ mpUnresolved = await apiFetch('/api/marketplaces/mapping/unresolved'); }
    catch(e){ mpUnresolved = []; }
    if(mpUnresolved.length === 0){ box.innerHTML = ''; return; }
    const orders = mpUnresolved.reduce((s, x) => s + x.orders, 0);
    // Свёрнуто по умолчанию: строка с числом и «Разобрать» (владелец
    // 01.10.2026: на странице «всё не сворачивается»).
    box.innerHTML = '<div class="unm-wrap">'
      + '<div class="unm-head unm-toggle" onclick="toggleUnresolved()"><div class="unm-title">'
      +   orders + ' ' + pluralRu(orders, 'заказ', 'заказа', 'заказов')
      +   ' нельзя собрать · ' + mpUnresolved.length + ' '
      +   pluralRu(mpUnresolved.length, 'артикул', 'артикула', 'артикулов') + ' не сопоставлены</div>'
      +   '<span class="mp-act">' + (unmOpen ? 'Свернуть ▴' : 'Разобрать ▾') + '</span></div>'
      + (unmOpen ? '' : '</div>')
      + (!unmOpen ? '' : '<div class="unm-sub">Площадка присылает артикул продавца, а склад живёт своими.'
      +   ' Пока они не связаны, заказ виден, но собрать его нечем. Свяжите артикул с товаром —'
      +   ' лежащие заказы починятся сразу же.</div>'
      + mpUnresolved.map((u, i) => '<div class="unm-row" id="unm-' + i + '">'
        + '<div class="unm-top">'
        +   '<div><div class="unm-art">' + escapeHTML(u.article || '—') + '</div>'
        +     '<div class="unm-meta">' + escapeHTML(u.companyName)
        +     (u.mpNmId ? ' · карточка ' + escapeHTML(u.mpNmId) : '')
        +     (u.mpBarcode ? ' · ШК ' + escapeHTML(u.mpBarcode) : '') + '</div></div>'
        +   '<div class="unm-meta">' + u.orders + ' '
        +     pluralRu(u.orders, 'заказ', 'заказа', 'заказов')
        +     (u.oldest ? ' · с ' + fmtDay(u.oldest) : '') + '</div>'
        +   '<div class="mp-act" onclick="openUnresolved(' + i + ')">Сопоставить</div>'
        + '</div>'
        + '<div class="unm-box">'
        +   '<input class="unm-input" id="unm-q-' + i + '" placeholder="Найдите наш товар — артикул, название или штрихкод"'
        +     ' oninput="searchOurProduct(' + i + ')" autocomplete="off">'
        +   '<div class="unm-hits" id="unm-hits-' + i + '"></div>'
        + '</div>'
        + '</div>').join('')
      + '</div>');
  }
  let unmOpen = false;
  function toggleUnresolved(){ unmOpen = !unmOpen; loadUnresolved(); }
  window.toggleUnresolved = toggleUnresolved;

  function openUnresolved(i){
    const row = document.getElementById('unm-' + i);
    if(!row) return;
    row.classList.toggle('open');
    if(row.classList.contains('open')){
      const input = document.getElementById('unm-q-' + i);
      // Артикул площадки подставляем в поиск: у многих продавцов наш артикул
      // и артикул площадки различаются приставкой, а не целиком.
      if(input && !input.value) input.value = mpUnresolved[i].article || '';
      if(input){ input.focus(); searchOurProduct(i); }
    }
  }
  window.openUnresolved = openUnresolved;

  // Поиск с задержкой: двенадцать тысяч товаров у одного продавца, и
  // спрашивать сервер на каждую нажатую букву незачем.
  const unmTimers = {};
  const unmHits = {};
  function searchOurProduct(i){
    clearTimeout(unmTimers[i]);
    unmTimers[i] = setTimeout(() => doSearchOurProduct(i), 300);
  }
  window.searchOurProduct = searchOurProduct;

  async function doSearchOurProduct(i){
    const u = mpUnresolved[i];
    const input = document.getElementById('unm-q-' + i);
    const hits = document.getElementById('unm-hits-' + i);
    if(!u || !input || !hits) return;
    const q = input.value.trim();
    if(q.length < 2){ hits.innerHTML = ''; return; }
    let rows;
    try{
      rows = await apiFetch('/api/marketplaces/mapping/products?companyId='
        + encodeURIComponent(u.companyId) + '&q=' + encodeURIComponent(q));
    } catch(e){
      hits.innerHTML = '<div class="unm-meta">Поиск не ответил: ' + escapeHTML(e.message) + '</div>';
      return;
    }
    if(rows.length === 0){
      unmHits[i] = [];
    hits.innerHTML = '<div class="unm-meta">Ничего не нашлось. Если товара нет в 1С,'
        + ' связать заказ не с чем — сначала он должен появиться в номенклатуре.</div>';
      return;
    }
    // Найденное держим в памяти и передаём в обработчик номер строки:
    // артикул из 1С может содержать кавычку, а она в аргументе обработчика
    // ломает разметку — сущности в атрибуте раскрываются до JavaScript.
    unmHits[i] = rows;
    hits.innerHTML = rows.map((r, j) => '<div class="unm-hit" onclick="linkOurProduct('
      + i + ', ' + j + ')"><b>' + escapeHTML(r.sku) + '</b> · '
      + escapeHTML(r.name || '') + (r.barcode ? ' · ШК ' + escapeHTML(r.barcode) : '')
      + '</div>').join('');
  }

  async function linkOurProduct(i, j){
    const u = mpUnresolved[i];
    const hit = (unmHits[i] || [])[j];
    if(!u || !hit) return;
    const sku = hit.sku;
    try{
      const r = await apiFetch('/api/marketplaces/mapping', {
        method: 'POST',
        body: { companyId: u.companyId, marketplace: 'wb', sku,
                mpArticle: u.article || null, mpSku: u.mpNmId || null,
                mpBarcode: u.mpBarcode || null },
      });
      showWhToast('«' + (r.name || sku) + '» связан с артикулом ' + (u.article || '')
        + '. Починено заказов: ' + r.fixedOrders + '.');
      await loadMarketplaces();
      // Очередь заказов тоже меняется: несобираемые стали собираемыми.
      if(typeof loadMpOrders === 'function') loadMpOrders();
    } catch(e){
      showWhToast('Не удалось связать: ' + e.message);
    }
  }
  window.linkOurProduct = linkOurProduct;

  // Связь считается живой по дате последнего ответа площадки, а не по факту
  // подключения: ключ мог протухнуть, и снаружи это выглядит как затишье.
  // Один такой ключ у нас уже умер молча, поэтому «подключено» отдельно от
  // «отвечает».
  function mpState(cred){
    if(!cred) return { css: 'none', chip: '', chipCss: '', word: 'площадка не подключена' };
    const ms = cred.lastUsedAt ? Date.now() - new Date(cred.lastUsedAt).getTime() : null;
    if(ms === null) return { css: '', chip: 'связи не было', chipCss: 'stale', word: 'подключено, связи ещё не было' };
    if(ms < 60 * 60 * 1000) return { css: 'live', chip: 'на связи', chipCss: 'live', word: 'связь ' + formatLastSeen(cred.lastUsedAt) };
    return { css: '', chip: 'молчит', chipCss: 'stale', word: 'последняя связь ' + formatLastSeen(cred.lastUsedAt) };
  }

  function renderMpCards(){
    const list = document.getElementById('mpList');
    if(!list) return;
    if(companies.length === 0){
      list.innerHTML = '<div class="staff-empty">Продавцов пока нет — впишите название выше и нажмите «+ Добавить продавца».</div>';
      return;
    }
    const q = ((document.getElementById('sellerSearch') || {}).value || '').trim().toLowerCase();
    const shownCompanies = companies.filter(c => !q || c.name.toLowerCase().includes(q));
    const cards = shownCompanies.map((c) => {
      const cred = marketplaces.find((m) => m.companyId === c.id) || null;
      const pend = mpPending.find((x) => x.companyId === c.id) || null;
      const st = mpState(cred);
      const orders = pend ? pend.orders : 0;
      const units = pend ? pend.units : 0;
      const hasKey = c.keys.some((k) => k.active);
      const acts = '<span class="mp-act">' + (cred ? 'Открыть: WB и склады →' : 'Подключить WB →') + '</span>';
      const ws = (wbOffices.sellers || []).find((s) => s.companyId === c.id);
      const writeHint = cred && cred.marketplace === 'wb' && !cred.writeEnabled && whSettings && whSettings.wb_supplies_by === 'ff'
        ? '<div class="mp-card-sub wbo-warn">Поставки на WB оформляете вы — включите «Разрешить менять статусы», если продавец согласен.</div>'
        : '';
      const wbLine = cred && cred.marketplace === 'wb'
        ? '<div class="mp-card-sub">' + (!ws ? 'Склады WB ещё не прочитаны.'
            : ws.ours ? 'Склады WB: ваших ' + ws.ours + ' из ' + ws.total
              + (ws.hidden ? ' · заказов других фулфилментов не в работе: ' + ws.hidden : '')
            : '<span class="wbo-warn">Ни один склад WB продавца не отмечен вашим — его заказы не забираются.</span>')
          + '</div>'
        : '';
      return '<div class="mp-card mp-card-click ' + st.css + '" onclick="openSellerPanel(\'' + c.id + '\')" title="Открыть продавца">'
        + '<div class="mp-card-top">'
        +   '<div><div class="mp-card-name">' + escapeHTML(c.name) + '</div>'
        +   '<div class="mp-card-sub">' + (cred ? escapeHTML(mpTitle(cred.marketplace)) + ' · ' : '')
        +     st.word + '</div></div>'
        +   (st.chip ? '<div class="mp-chip ' + st.chipCss + '">' + st.chip + '</div>' : '')
        + '</div>'
        + '<div class="sl-chips">'
        +   '<span class="mp-chip ' + (hasKey ? 'live' : 'stale') + '">' + (hasKey ? 'кабинет выдан' : 'нет ключа в кабинет') + '</span>'
        +   (c.one_c_external_id ? '<span class="mp-chip live">связан с 1С</span>' : '')
        + '</div>'
        + (cred && cred.sellerName
            ? '<div class="mp-card-sub">Кабинет WB: ' + escapeHTML(cred.sellerName) + (cred.sellerInn ? ', ИНН ' + escapeHTML(cred.sellerInn) : '') + '</div>'
            : '')
        // Заказы, которые уже пришли, ждут поставки и без ключа (ключ
        // отключили): шапка их считает — карточка тоже показывает.
        + (cred || orders > 0
            ? '<div class="mp-facts">'
              + '<div class="mp-fact"><b class="' + (orders > 0 ? 'hot' : 'zero') + '">' + orders
              +   '</b><span>' + pluralRu(orders, 'заказ ждёт', 'заказа ждут', 'заказов ждут') + '</span></div>'
              + '<div class="mp-fact"><b class="' + (units > 0 ? '' : 'zero') + '">'
              +   units.toLocaleString('ru-RU') + '</b><span>штук в них</span></div>'
              + (pend && pend.oldest
                  ? '<div class="mp-fact"><b>' + escapeHTML(fmtDay(pend.oldest))
                    + '</b><span>самый старый</span></div>'
                  : '')
              + '</div>'
            : '')
        + (cred ? '' : '<div class="mp-card-sub">WB не подключён — ' + (orders > 0 ? 'новые ' : '') + 'заказы с маркетплейса не приходят.</div>')
        + wbLine + writeHint
        + '<div class="mp-card-acts">' + acts + '</div>'
        + '</div>';
    });
    // Сначала те, у кого лежат заказы, потом подключённые, потом остальные:
    // экран должен открываться на том, чем надо заняться.
    const weight = (c) => {
      const pend = mpPending.find((x) => x.companyId === c.id);
      if(pend && pend.orders > 0) return 0;
      if(marketplaces.some((m) => m.companyId === c.id)) return 1;
      return 2;
    };
    const order = shownCompanies.map((c, i) => ({ i, w: weight(c) }))
      .sort((a, b) => a.w - b.w || a.i - b.i);
    list.innerHTML = cards.length
      ? '<div class="mp-grid">' + order.map((o) => cards[o.i]).join('') + '</div>'
      : '<div class="staff-empty">Под «' + escapeHTML(q) + '» продавцов нет.</div>';
  }

  // Подключить конкретному клиенту: разворачиваем форму и подставляем его,
  // чтобы не искать имя в списке из тридцати.
  function connectMpFor(companyId){ openSellerPanel(companyId); }
  window.connectMpFor = connectMpFor;

  // Разрешение Аргусу менять статусы в кабинете продавца.
  //
  // Это согласие продавца, а не техническая галочка: без него поставку на
  // площадке придётся делать руками, с ним Аргус создаёт её сам и подтверждает
  // заказы. Поэтому спрашиваем прямо и пишем, что именно начнёт происходить.
  async function toggleMpWrite(companyId, marketplace, enable){
    const company = companies.find((c) => c.id === companyId);
    const name = company ? company.name : 'продавца';
    const question = enable
      ? 'Разрешить Аргусу менять статусы заказов «' + name + '» на площадке?\n\n'
        + 'При отправке поставки Аргус создаст поставку на площадке, переведёт заказы'
        + ' в «на сборке» и получит этикетки. При отгрузке — передаст поставку в доставку.\n\n'
        + 'Убедитесь, что продавец на это согласен.'
      : 'Запретить Аргусу менять статусы «' + name + '» на площадке?\n\n'
        + 'Поставки на площадке снова придётся создавать вручную в её кабинете.';
    if(!await askConfirm(question)) return;
    try{
      await apiFetch('/api/marketplaces/' + companyId + '/' + marketplace + '/write',
        { method: 'PATCH', body: { enabled: enable } });
      showWhToast(enable ? 'Аргус будет менять статусы на площадке.' : 'Аргус больше не меняет статусы на площадке.');
      await loadMarketplaces();
      if(spOpen()) renderSellerPanel();
    } catch(e){
      showWhToast('Не удалось изменить: ' + e.message);
    }
  }
  window.toggleMpWrite = toggleMpWrite;

  function renderMarketplaces(){
    const dot = document.getElementById('mpStatusDot');
    const title = document.getElementById('mpStatusTitle');
    const sub = document.getElementById('mpStatusSub');
    if(!document.getElementById('mpList')) return;

    const alive = marketplaces.filter(m => m.lastUsedAt
      && (Date.now() - new Date(m.lastUsedAt).getTime()) < 60 * 60 * 1000).length;
    const writers = marketplaces.filter(m => m.writeEnabled).length;

    if(dot && title && sub && marketplaces.length === 0){
      dot.classList.remove('connected');
      title.textContent = 'Ни одна площадка не подключена';
      sub.textContent = companies.length + ' '
        + pluralRu(companies.length, 'клиент', 'клиента', 'клиентов')
        + ' в складе · заказы с маркетплейсов пока не приходят, Аргус видит только накладные из 1С';
    } else if(dot && title && sub){
      dot.classList.toggle('connected', alive > 0);
      title.textContent = alive > 0 ? 'Площадки подключены' : 'Подключено, но связи давно не было';
      sub.textContent = marketplaces.length + ' из ' + companies.length + ' '
        + pluralRu(companies.length, 'клиента', 'клиентов', 'клиентов') + ' на площадках · '
        + (writers > 0
            ? writers + ' с разрешённой записью'
            : 'только чтение — на площадках ничего не меняется')
        + ' · Аргус опрашивает их сам, раз в пять минут';
    }
    renderMpCards();
  }

  function showMpResult(html){
    const box = document.getElementById(spOpen() ? 'spResult' : 'mpSyncResult');
    if(!box) return;
    box.innerHTML = html ? '<div class="oc-note" style="margin-top:14px;">' + html + '</div>' : '';
  }

  async function connectMarketplace(){
    const companyId = sp.companyId;
    const marketplace = 'wb';
    const input = document.getElementById('spToken');
    const token = input ? input.value.trim() : '';
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
      await loadSellerPanelData();
      showMpResult('Ключ принят WB. Кабинет: <b>' + escapeHTML(who)
        + '</b>. Ниже — склады продавца на WB: отметьте те, товар для которых лежит у вас.');
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
        + r.created + '</b>, уже были: ' + r.existed + '.'
        + (r.foreign ? ' Со складов продавца у других фулфилментов: ' + r.foreign + ' — в работу не взяты.' : '');
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
      if(spOpen()) loadSellerPanelData();
      loadInvoicesList();
    } catch(e){
      showMpResult('Не получилось забрать заказы: ' + escapeHTML(e.message));
    }
  }

  async function disconnectMarketplace(companyId, marketplace){
    if(!await askConfirm('Отключить площадку? Заказы перестанут приходить. Уже заведённые накладные останутся.')) return;
    try{
      await apiFetch('/api/marketplaces/' + companyId + '/' + marketplace, { method: 'DELETE' });
      await loadMarketplaces();
      if(spOpen()) renderSellerPanel();
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
    // Настройки инвентаризации — только владельцу; менеджеру с правом «склад»
    // сервер отвечал 403, и запрос просто шумел в консоли.
    try{
      invSettings = IS_MANAGER ? null : await apiFetch('/api/inventory/settings');
    } catch(e){ invSettings = null; }
    try{
      invWaiting = await apiFetch('/api/inventory/tasks?status=waiting_owner');
    } catch(e){ invWaiting = []; }
    renderInventory();
    loadInvAdvice();
  }

  // Совет «как часто считать».
  //
  // Считает сервер по этому же складу: доля ячеек, где пересчёт нашёл
  // расхождение, доля сборок, не нашедших товар на полке, и сколько ячеек
  // под товаром. Языковая модель здесь ничего бы не добавила — данных ровно
  // три, — зато могла бы выдумать четвёртое. Причины показываются рядом
  // с числами, чтобы владелец мог не согласиться со знанием дела.
  let invAdvice = null;

  async function loadInvAdvice(){
    try{ invAdvice = await apiFetch('/api/inventory/advice'); }
    catch(e){ invAdvice = null; }
    renderInvAdvice();
  }

  function renderInvAdvice(){
    const box = document.getElementById('invAdvice');
    if(!box) return;
    const a = invAdvice;
    if(!a){ box.innerHTML = ''; return; }
    const s = invSettings || {};
    const same = s.recountAfterDays === a.recountAfterDays
      && s.cellsPerRun === a.cellsPerRun
      && s.minDaysBetweenRuns === a.minDaysBetweenRuns;
    box.innerHTML = '<div class="inv-advice">'
      + '<div class="inv-advice-head">'
      +   '<div class="inv-advice-title">Аргус советует</div>'
      +   (same
            ? '<div class="inv-advice-same">Так и настроено</div>'
            : '<button type="button" class="wh-onboarding-btn" onclick="applyInvAdvice()">Применить</button>')
      + '</div>'
      + '<div class="inv-advice-nums">'
      +   '<div class="inv-advice-num"><b>' + a.recountAfterDays + '</b><span>дней между пересчётами ячейки</span></div>'
      +   '<div class="inv-advice-num"><b>' + a.cellsPerRun + '</b><span>ячеек за заход</span></div>'
      +   '<div class="inv-advice-num"><b>' + a.minDaysBetweenRuns + '</b><span>дней пауза</span></div>'
      +   (a.cycleDays > 0
            ? '<div class="inv-advice-num"><b>' + a.cycleDays + '</b><span>дней на весь склад</span></div>'
            : '')
      + '</div>'
      + '<ul>' + a.reasons.map(r => '<li>' + escapeHTML(r) + '</li>').join('') + '</ul>'
      + '</div>';
  }

  async function applyInvAdvice(){
    if(!invAdvice) return;
    const set = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
    set('invRecountDays', invAdvice.recountAfterDays);
    set('invCellsPerRun', invAdvice.cellsPerRun);
    set('invMinDays', invAdvice.minDaysBetweenRuns);
    await saveInvSettings();
  }
  window.applyInvAdvice = applyInvAdvice;

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
          + '<span class="inv-diff-sku">' + escapeHTML(d.sku)
          + ' · ' + escapeHTML(d.companyName || 'Продавец не указан')
          + ' · ' + escapeHTML({ good: 'годный', defective: 'брак', packaging_defect: 'брак упаковки' }[d.quality] || d.quality)
          + '</span></div>'
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
        +   '<button class="inv-btn" onclick="resolveInv(\'' + t.id + '\', \'recount\')">Посчитать заново</button>'
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
        out.push({ sku: l.sku, name: l.name, companyName: l.companyName, quality: l.quality,
          expectedQty: Number(l.qty), countedQty: c,
          diff: c - Number(l.qty) });
      }
    });
    now.forEach(function(l, k){
      if(was.has(k)) return;
      out.push({ sku: l.sku, name: l.name, companyName: l.companyName, quality: l.quality,
        expectedQty: 0, countedQty: Number(l.qty),
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
      // Пауза входит в расчёт нормы за заход, поэтому совет пересчитывается
      // после сохранения: иначе он остался бы советом к прежним настройкам.
      loadInvAdvice();
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
      && !await askConfirm('Принять пересчёт? Остаток в ячейке станет таким, каким его увидел работник.')) return;
    try{
      await apiFetch('/api/inventory/tasks/' + taskId + '/resolve', {
        method: 'POST', body: { decision },
      });
      showWhToast(decision === 'apply' ? 'Остаток исправлен.'
        : decision === 'recount' ? 'Ячейка снова назначена работнику для пересчёта.' : 'Пересчёт отклонён.');
      loadInventory();
    } catch(e){
      showWhToast(e.message);
    }
  }

  /* ===================== Выгрузка в Excel =====================
     Каждый список, который владелец видит на экране, должен уметь стать
     файлом: показать поставщику, отправить бухгалтеру, свести у себя. Файл
     собирается из того, что уже загружено, — второго похода на сервер нет. */

  function saveXlsx(fileName, sheetName, rows, widths, onSheet){
    if(typeof XLSX === 'undefined'){
      showWhToast('Выгрузка ещё грузится, повторите через секунду.');
      return;
    }
    if(!rows.length){ showWhToast('Выгружать нечего — список пуст.'); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    if(widths) ws['!cols'] = widths.map(w => ({wch: w}));
    if(onSheet) onSheet(ws);
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
        const addr = blockAddr(rowNum, b);
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

  /* ===================== Загрузка остатков по ячейкам =====================
     Товар лежит на полках, а в ячейках Аргуса его нет — склад жил в 1С.
     Склад берёт бланк, обходит полки, вписывает посчитанное, владелец
     загружает файл. Сервер проверяет каждую строку и пишет всё или ничего;
     в 1С ничего не уходит. Правила — в argus-api/src/cells/initialStock.js. */

  // busy — что сейчас идёт: 'check' (проверка файла), 'apply' (запись),
  // 'undo' (отмена); пусто — ничего. seq — номер проверки: ответ устаревшей
  // (файл или продавца успели сменить) не должен перетереть свежую.
  // ---------- Акты ----------
  // Приходы — акт приёмки на хранение, поставки — акт отгрузки с хранения.
  // Бумага — отдельной страницей act_print.html, как документы поставки.
  async function loadActs(){
    const box = document.getElementById('actsBody');
    if(!box) return;
    let invoicesAll, suppliesAll;
    try{
      // Только приходы и последние поставки: раньше экран тянул все документы
      // склада (каждый заказ WB — документ), чтобы показать 60 строк.
      [invoicesAll, suppliesAll] = await Promise.all([apiFetch('/api/invoices?direction=in'), apiFetch('/api/supplies?limit=60')]);
    } catch(e){ box.textContent = 'Не удалось загрузить: ' + e.message; return; }
    const receipts = invoicesAll.filter(i => i.direction === 'in')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 60);
    const shipments = suppliesAll.slice(0, 60);
    const stateOf = { open: 'ждёт приёмки', in_progress: 'принимается', completed: 'принят' };
    const row = (kind, id, number, sub) => '<div class="act-row"><div><b>' + escapeHTML(number) + '</b>'
      + '<div class="ord-sub">' + escapeHTML(sub) + '</div></div>'
      + '<span class="mp-act" onclick="window.open(\'act_print.html?kind=' + kind + '&id=' + encodeURIComponent(id) + '\', \'_blank\')">'
      + (kind === 'receipt' ? 'Акт приёмки' : 'Акт отгрузки') + '</span></div>';
    box.innerHTML = '<div class="acts-cols">'
      + '<div class="acts-col' + (receipts.length ? '' : ' act-empty') + '"><h3>Приёмка на хранение</h3>'
      +   (receipts.length ? receipts.map(i => row('receipt', i.id, i.number,
            (i.company_name || '') + ' · ' + (stateOf[i.status] || i.status) + ' · ' + new Date(i.created_at).toLocaleDateString('ru-RU'))).join('')
          : '<div class="ord-meta">Приходов пока нет.</div>')
      + '</div>'
      + '<div class="acts-col' + (shipments.length ? '' : ' act-empty') + '"><h3>Отгрузка с хранения</h3>'
      +   (shipments.length ? shipments.map(s => row('shipment', s.id, s.number,
            (s.company_name || '') + ' · ' + (s.statusName || s.status) + (s.destination ? ' · ' + s.destination : ''))).join('')
          : '<div class="ord-meta">Поставок пока нет.</div>')
      + '</div></div>';
  }
  window.loadActs = loadActs;

  // ---------- Сверка остатков с документом ----------
  // Документ — ведомость 1С по товару продавца (как присылают склад и сам
  // продавец). Сервер разбирает её, привязывает товары к продавцу, заводит
  // артикулы WB и выравнивает ячейки. Сначала — что изменится, потом запись.
  const align = { companyId: '', grid: null, fileName: '', preview: null, busy: '', error: '', placeNew: false };

  function openAlign(){
    document.getElementById('alignModal').classList.add('open');
    if(!align.companyId || !companies.some(c => c.id === align.companyId)){
      align.companyId = companies.length === 1 ? companies[0].id : '';
    }
    align.preview = null;
    align.error = '';
    renderAlign();
    if(align.grid && align.companyId) previewAlign();
  }
  window.openAlign = openAlign;

  function closeAlign(){ document.getElementById('alignModal').classList.remove('open'); }
  window.closeAlign = closeAlign;

  function setAlign(field, value){
    align[field] = value;
    align.preview = null;
    renderAlign();
    if(align.grid && align.companyId) previewAlign();
  }
  window.setAlign = setAlign;

  function onAlignFile(input){
    const file = input.files && input.files[0];
    if(!file) return;
    if(typeof XLSX === 'undefined'){ showWhToast('Модуль Excel ещё загружается — попробуйте через пару секунд'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const wb = readBook(reader.result, file.name, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
        // Отчёт по дням бывает шириной в двести колонок: серверу нужны
        // подписи слева и последние колонки с итогом.
        align.grid = rows.map(r => (r.length > 13 ? r.slice(0, 4).concat(r.slice(-9)) : r));
        align.fileName = file.name;
        align.error = '';
        align.preview = null;
        renderAlign();
        if(align.companyId) previewAlign();
      } catch(e){
        align.error = 'Не удалось прочитать файл: ' + e.message;
        renderAlign();
      }
    };
    reader.readAsArrayBuffer(file);
  }
  window.onAlignFile = onAlignFile;

  async function previewAlign(){
    align.busy = 'preview';
    align.error = '';
    renderAlign();
    try{
      align.preview = await apiFetch('/api/cells/stock-align', { method: 'POST', body: {
        companyId: align.companyId, grid: align.grid, apply: false, placeNew: align.placeNew, source: align.fileName,
      } });
    } catch(e){ align.error = e.message; align.preview = null; }
    align.busy = '';
    renderAlign();
  }

  async function applyAlign(){
    const p = align.preview;
    if(!p || align.busy) return;
    if(!await askConfirm('Выровнять остатки «' + p.summary.company + '» по документу?\n\n'
      + 'Изменится товаров: ' + p.summary.changed + ' (+' + p.summary.added + ' / −' + p.summary.removed + ' шт.). '
      + 'Каждая правка запишется в журнал. В 1С ничего не отправляется.')) return;
    align.busy = 'apply';
    renderAlign();
    try{
      const r = await apiFetch('/api/cells/stock-align', { method: 'POST', body: {
        companyId: align.companyId, grid: align.grid, apply: true, placeNew: align.placeNew, source: align.fileName,
      } });
      showWhToast('Остатки «' + r.summary.company + '» выровнены: изменено ' + r.summary.changed + ' товаров.');
      align.grid = null; align.fileName = ''; align.preview = null;
      closeAlign();
      renderWarehouseMap().catch(() => {});
    } catch(e){ align.error = e.message; }
    align.busy = '';
    renderAlign();
  }
  window.applyAlign = applyAlign;

  function renderAlign(){
    const body = document.getElementById('alignBody');
    const actions = document.getElementById('alignActions');
    if(!body) return;
    const p = align.preview;
    const lines = p ? p.lines.slice().sort((a, b) => (b.sku ? 0 : 1) - (a.sku ? 0 : 1)
      || Math.abs(b.change) - Math.abs(a.change)) : [];
    body.innerHTML = '<div class="ord-meta" style="margin-bottom:10px;">Документ — ведомость 1С «Ведомость по товарам на складах» по товару продавца (xls или xlsx). '
      + 'Аргус привяжет товары из документа к продавцу, заведёт артикулы WB и выровняет ячейки. Сначала покажет, что изменится.</div>'
      + '<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">'
      +   '<select class="mp-field" onchange="setAlign(\'companyId\', this.value)">'
      +     '<option value="">Продавец…</option>'
      +     companies.map(c => '<option value="' + escapeHTML(c.id) + '"' + (c.id === align.companyId ? ' selected' : '') + '>' + escapeHTML(c.name) + '</option>').join('')
      +   '</select>'
      +   '<label class="wh-configure-btn ghost" style="cursor:pointer;">' + (align.fileName ? escapeHTML(align.fileName) : 'Выбрать файл')
      +     '<input type="file" accept=".xls,.xlsx" hidden onchange="onAlignFile(this)"></label>'
      +   '<label class="ord-meta"><input type="checkbox" ' + (align.placeNew ? 'checked' : '')
      +     ' onchange="setAlign(\'placeNew\', this.checked)"> товар без ячейки класть в свободные ячейки (адрес проверить на полке)</label>'
      + '</div>'
      + (align.error ? '<div class="ord-meta ord-warn" style="margin-top:10px;">' + escapeHTML(align.error) + '</div>' : '')
      + (align.busy === 'preview' ? '<div class="ord-meta" style="margin-top:10px;">Сверяю…</div>' : '')
      + (p ? '<div class="align-summary">'
          + '<span>в документе <b>' + p.summary.records + '</b> товаров, <b>' + p.summary.documentTotal.toLocaleString('ru-RU') + '</b> шт.</span>'
          + '<span>в ячейках Аргуса <b>' + p.summary.cellsTotal.toLocaleString('ru-RU') + '</b> шт.</span>'
          + '<span>изменится <b>' + p.summary.changed + '</b> товаров: +' + p.summary.added + ' / −' + p.summary.removed + ' шт.</span>'
          + (p.summary.notFound ? '<span class="ord-warn">не найдено в каталоге: ' + p.summary.notFound + '</span>' : '')
          + '</div>'
          + '<div class="align-scroll"><table class="align-table"><thead><tr><th>Товар</th><th class="num">В документе</th>'
          + '<th class="num">В ячейках</th><th class="num">Разница</th><th>Что будет</th></tr></thead><tbody>'
          + lines.map(l => '<tr><td>' + escapeHTML(l.productName || l.name || '—')
            + '<div class="sub">' + escapeHTML([l.article, l.sku || l.code].filter(Boolean).join(' · '))
            + (l.owner && l.owner !== 'свой' ? ' · ' + escapeHTML(l.owner) : '') + '</div></td>'
            + '<td class="num">' + l.qty + (l.staged ? '<div class="sub">из них собрано ' + l.staged + '</div>' : '') + '</td>'
            + '<td class="num">' + (l.sku ? l.inCells : '—') + '</td>'
            + '<td class="num">' + (l.change > 0 ? '+' : '') + (l.sku ? l.change : '—') + '</td>'
            + '<td>' + escapeHTML(l.note || (l.change === 0 && l.sku ? 'совпадает' : '')) + '</td></tr>').join('')
          + '</tbody></table></div>' : '');
    actions.innerHTML = '<button class="wh-onboarding-btn" type="button" onclick="closeAlign()">Закрыть</button>'
      + '<button class="wh-onboarding-btn primary" type="button" onclick="applyAlign()" '
      + (p && !align.busy ? '' : 'disabled') + '>'
      + (align.busy === 'apply' ? 'Записываю…' : 'Выровнять по документу') + '</button>';
  }

  // defaultVw — склад продавца для строк без столбца «Склад» ('' — «Основной»),
  // vws — склады выбранного продавца (владелец 02.10.2026).
  const stockLoad = { companyId: '', rows: null, blank: 0, fileName: '', preview: null, error: '',
    busy: '', seq: 0, batches: null, defaultVw: '', vws: [] };

  function openStockLoad(){
    document.getElementById('stockLoadModal').classList.add('open');
    let id = stockLoad.companyId;
    if(!id || !companies.some(c => c.id === id)) id = companies.length === 1 ? companies[0].id : '';
    // Проверка с прошлого раза могла устареть — открываем со свежей.
    stockLoad.preview = null;
    setStockLoadCompany(id);   // склады продавца — свежие при каждом открытии
    loadStockBatches();
  }
  window.openStockLoad = openStockLoad;

  // Последние загрузки — чтобы ошибку можно было отменить целиком.
  async function loadStockBatches(){
    try{ stockLoad.batches = await apiFetch('/api/cells/initial-stock/batches'); }
    catch(e){ stockLoad.batches = null; }
    renderStockLoad();
  }

  async function undoStockBatch(batch){
    const b = (stockLoad.batches || []).find(x => x.batch === batch);
    if(!b || stockLoad.busy) return;
    if(!await askConfirm('Отменить загрузку от ' + new Date(b.at).toLocaleString('ru-RU') + ' — «' + b.companyName + '», '
      + b.units + ' шт.?\n\nЭти штуки уйдут из ячеек Аргуса. В 1С ничего не отправляется.')) return;
    stockLoad.busy = 'undo';
    stockLoad.error = '';
    renderStockLoad();
    try{
      const r = await apiFetch('/api/cells/initial-stock/batches/' + encodeURIComponent(batch) + '/undo', { method: 'POST' });
      showWhToast('Загрузка отменена: ' + r.units + ' шт. сняты из ячеек.');
      stockLoad.preview = null;   // проверка файла устарела: ячейки изменились
      renderWarehouseMap().catch(() => {});
    } catch(e){
      // В окне, а не во всплывашке на три секунды: причину надо успеть прочитать.
      stockLoad.error = 'Не отменено: ' + e.message;
    }
    stockLoad.busy = '';
    await loadStockBatches();
    if(stockLoad.rows && stockLoad.companyId) previewStockLoad();
  }
  window.undoStockBatch = undoStockBatch;

  function closeStockLoad(){
    // Пока идёт запись или отмена, окно не закрываем; проверку — можно.
    if(stockLoad.busy === 'apply' || stockLoad.busy === 'undo') return;
    document.getElementById('stockLoadModal').classList.remove('open');
  }
  window.closeStockLoad = closeStockLoad;

  function setStockLoadCompany(id){
    stockLoad.companyId = id;
    stockLoad.preview = null;
    stockLoad.error = '';
    stockLoad.defaultVw = '';
    stockLoad.vws = [];
    if(id) vwOf(id).then(d => { if(stockLoad.companyId === id){ stockLoad.vws = d.warehouses; renderStockLoad(); } }).catch(() => {});
    // Файл уже выбран — проверяем его заново для нового продавца: артикулы
    // и «уже лежит» у каждого продавца свои.
    if(stockLoad.rows && id) previewStockLoad(); else renderStockLoad();
  }
  window.setStockLoadCompany = setStockLoadCompany;
  function setStockLoadVw(id){
    stockLoad.defaultVw = id;
    stockLoad.preview = null;
    if(stockLoad.rows && stockLoad.companyId) previewStockLoad(); else renderStockLoad();
  }
  window.setStockLoadVw = setStockLoadVw;

  // Бланк на весь каталог продавца. Ячейка подставлена там, где её знает 1С;
  // количество пустое — его вписывают у полки. «По 1С» — только для сверки.
  async function downloadStockTemplate(){
    if(!stockLoad.companyId){ showWhToast('Сначала выберите продавца.'); return; }
    let data;
    try{
      data = await apiFetch('/api/cells/initial-stock/template?companyId=' + encodeURIComponent(stockLoad.companyId));
    } catch(e){ showWhToast('Не удалось получить бланк: ' + e.message); return; }
    const rows = [];
    const withVw = stockLoad.vws.length > 0;
    data.products.forEach(p => {
      // «Продавец» — чтобы бланк одного продавца нельзя было загрузить другому:
      // сервер отклонит строки с чужим именем.
      const base = { 'Артикул': p.sku, 'Товар': p.name, 'Штрихкод': p.barcode || '',
        'По 1С (для сверки)': p.stock1c == null ? '' : p.stock1c, 'Количество': '', 'Состояние': '',
        ...(withVw ? { 'Склад': '' } : {}), 'Продавец': data.seller.name };
      (p.cells1c && p.cells1c.length ? p.cells1c : ['']).forEach(cell => rows.push(Object.assign({ 'Ячейка': cell }, base)));
    });
    // Колонка «Ячейка» — текстом, и с запасом пустых строк под дописанное
    // у полки. Иначе Excel превращает набранное «01-03-011» в дату.
    const asText = (ws) => {
      const last = rows.length + 300;
      for(let r = 1; r <= last; r++){
        const ref = XLSX.utils.encode_cell({ r, c: 0 });
        ws[ref] = { t: 's', v: ws[ref] ? String(ws[ref].v) : '', z: '@' };
      }
      const range = XLSX.utils.decode_range(ws['!ref']);
      range.e.r = Math.max(range.e.r, last);
      ws['!ref'] = XLSX.utils.encode_range(range);
    };
    saveXlsx('Бланк остатков — ' + data.seller.name, 'Остатки', rows, [14, 16, 42, 16, 12, 12, 14].concat(withVw ? [16] : [], [22]), asText);
  }
  window.downloadStockTemplate = downloadStockTemplate;

  // Разбор файла. Заголовок ищем в первых строках по словам, а не по месту:
  // колонки переставляют, над таблицей пишут пометки.
  function parseStockFile(wb){
    const ws = wb.Sheets[wb.SheetNames[0]];
    if(!ws || !ws['!ref']) throw new Error('В файле нет листа с данными.');
    const range = XLSX.utils.decode_range(ws['!ref']);
    const at = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];
    const text = (r, c) => {
      const cell = at(r, c);
      if(!cell) return '';
      if(cell.w == null && cell.v instanceof Date) return cell.v.toLocaleDateString('ru-RU');
      return String(cell.w != null ? cell.w : cell.v != null ? cell.v : '').trim();
    };
    // Число берём как есть, а не как оно нарисовано: «1 200» или «1,200»
    // на экране — это 1200, а не полторы штуки.
    const number = (r, c) => {
      const cell = at(r, c);
      return cell && cell.t === 'n' ? String(cell.v) : text(r, c);
    };
    const code = (r, c) => {
      const cell = at(r, c);
      if(cell && cell.t === 'n'){
        const shown = String(cell.w == null ? '' : cell.w).trim();
        return /^\d+$/.test(shown) ? shown : String(cell.v);
      }
      return text(r, c);
    };
    const isDate = (r, c) => {
      const cell = at(r, c);
      return !!cell && (cell.t === 'd'
        || (cell.t === 'n' && !!cell.z && !!(XLSX.SSF && XLSX.SSF.is_date) && XLSX.SSF.is_date(cell.z)));
    };
    const NAMES = {
      cell: ['ячейка', 'адрес', 'адрес ячейки'],
      sku: ['артикул', 'артикул или штрихкод', 'штрихкод или артикул'],
      qty: ['количество', 'кол-во', 'посчитано'],
      quality: ['состояние', 'состояние товара'],
      seller: ['продавец'],
      warehouse: ['склад', 'склад продавца', 'виртуальный склад'],
    };
    let head = -1;
    let cols = {};
    for(let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 9) && head < 0; r++){
      const found = {};
      for(let c = range.s.c; c <= range.e.c; c++){
        const h = text(r, c).toLowerCase();
        Object.keys(NAMES).forEach(k => { if(found[k] == null && NAMES[k].includes(h)) found[k] = c; });
      }
      if(found.sku != null && found.cell != null && found.qty != null){ head = r; cols = found; }
    }
    if(head < 0) throw new Error('Не нашёл колонки «Ячейка», «Артикул» и «Количество». Возьмите за основу бланк.');
    const rows = [];
    let blank = 0;
    for(let r = head + 1; r <= range.e.r; r++){
      const row = {
        line: r + 1,
        cell: text(r, cols.cell),
        sku: code(r, cols.sku),
        qty: number(r, cols.qty),
        quality: cols.quality != null ? text(r, cols.quality) : '',
        seller: cols.seller != null ? text(r, cols.seller) : '',
        warehouse: cols.warehouse != null ? text(r, cols.warehouse) : '',
      };
      if(!row.cell && !row.sku && !row.qty) continue;
      // Не посчитано — строка бланка, до которой не дошли. На сервер её не
      // шлём: бланк большого каталога иначе упирался бы в предел строк.
      if(row.qty === ''){ blank += 1; continue; }
      if(row.cell && isDate(r, cols.cell)) row.cellIsDate = true;
      rows.push(row);
    }
    if(!rows.length) throw new Error(blank ? 'Ни в одной строке не вписано количество.' : 'Под заголовком нет ни одной строки.');
    return { rows, blank };
  }

  async function readStockWorkbook(file){
    // cellDates — чтобы адрес, который Excel успел превратить в дату, пришёл
    // датой и был пойман, а не уехал на сервер числом 40574.
    return readBook(await file.arrayBuffer(), file.name, { type: 'array', cellDates: true, cellNF: true });
  }

  function readBook(buf, name, options){
    if(/\.(csv|txt)$/i.test(name)){
      // CSV — только как текст: разбор по умолчанию сам превращает «01-03-011»
      // и даже «1.3.11» в даты, а «1,5» — в 15, и сервер уже не видит, что
      // было в файле (проверка 25.09.2026). Русский Excel
      // сохраняет CSV в Windows-1251, поэтому пробуем и её.
      let text;
      try{ text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
      catch(e){ text = new TextDecoder('windows-1251').decode(buf); }
      return XLSX.read(text.replace(/^\uFEFF/, ''), { type: 'string', raw: true });
    }
    return XLSX.read(new Uint8Array(buf), options);
  }

  async function onStockLoadFile(input){
    const file = input.files && input.files[0];
    input.value = '';   // тот же файл после правки выбирают снова
    if(!file) return;
    if(typeof XLSX === 'undefined'){ showWhToast('Excel ещё грузится, повторите через секунду.'); return; }
    stockLoad.fileName = file.name;
    stockLoad.preview = null;
    try{
      const parsed = parseStockFile(await readStockWorkbook(file));
      stockLoad.rows = parsed.rows;
      stockLoad.blank = parsed.blank;
      stockLoad.error = '';
    } catch(e){
      stockLoad.rows = null;
      stockLoad.error = 'Файл не прочитан: ' + e.message;
      renderStockLoad();
      return;
    }
    if(stockLoad.companyId) previewStockLoad(); else renderStockLoad();
  }
  window.onStockLoadFile = onStockLoadFile;

  async function previewStockLoad(){
    const seq = ++stockLoad.seq;
    stockLoad.busy = 'check';
    renderStockLoad();
    let preview = null;
    let error = '';
    try{
      preview = await apiFetch('/api/cells/initial-stock', { method: 'POST',
        body: { companyId: stockLoad.companyId, rows: stockLoad.rows, defaultVw: stockLoad.defaultVw || null } });
    } catch(e){
      error = 'Проверка не прошла: ' + e.message;
    }
    if(seq !== stockLoad.seq) return;   // пока ждали, выбрали другой файл или продавца
    stockLoad.preview = preview;
    stockLoad.error = error;
    stockLoad.busy = '';
    renderStockLoad();
  }

  async function applyStockLoad(){
    const p = stockLoad.preview;
    if(!p || p.summary.errors > 0 || p.summary.ok === 0 || stockLoad.busy) return;
    const s = p.summary;
    if(!await askConfirm('Загрузить в ячейки «' + p.seller.name + '» ' + s.units + ' шт. — '
      + s.products + ' ' + pluralRu(s.products, 'товар', 'товара', 'товаров') + ' в '
      + s.cells + ' ' + pluralRu(s.cells, 'ячейку', 'ячейки', 'ячеек') + '?\n\n'
      + 'Ошиблись — загрузку можно отменить целиком, пока её товар не отбирали, не перемещали и не пересчитывали.')) return;
    stockLoad.busy = 'apply';
    stockLoad.seq += 1;   // ответ проверки, если она ещё в пути, уже не нужен
    renderStockLoad();
    let r;
    try{
      r = await apiFetch('/api/cells/initial-stock', { method: 'POST',
        body: { companyId: stockLoad.companyId, rows: stockLoad.rows, apply: true, defaultVw: stockLoad.defaultVw || null,
          expect: { ok: s.ok, units: s.units } } });
    } catch(e){
      // Ответ не дошёл — неизвестно, записалось ли. Перепроверяем: повтор
      // безопасен, записанные строки покажутся как «уже загружено».
      stockLoad.busy = '';
      stockLoad.error = 'Связь прервалась (' + e.message + ') — неизвестно, записалось ли. Проверил файл заново: '
        + 'если строки стоят как «уже загружено», загрузка прошла.';
      loadStockBatches();
      renderWarehouseMap().catch(() => {});
      previewStockLoad();
      return;
    }
    stockLoad.busy = '';
    if(!r.applied){
      stockLoad.preview = r;
      stockLoad.error = r.stale
        ? 'Пока вы смотрели проверку, цифры изменились. Ничего не загружено — посмотрите новую проверку и подтвердите снова.'
        : r.summary.errors > 0
          ? 'Пока вы смотрели проверку, на складе что-то изменилось. Ничего не загружено — посмотрите строки с ошибками.'
          : 'Всё из файла уже загружено — возможно, прошлой попыткой. Смотрите «Последние загрузки».';
      loadStockBatches();
      renderStockLoad();
      return;
    }
    stockLoad.rows = null;
    stockLoad.fileName = '';
    stockLoad.preview = null;
    stockLoad.error = '';
    document.getElementById('stockLoadModal').classList.remove('open');
    showWhToast('Загружено: ' + r.summary.units + ' шт. в ' + r.summary.cells + ' '
      + pluralRu(r.summary.cells, 'ячейку', 'ячейки', 'ячеек') + '.');
    // Карта сама не обновится — без этого владелец увидит пустые ячейки
    // и нажмёт ещё раз.
    renderWarehouseMap().catch(() => {});
  }
  window.applyStockLoad = applyStockLoad;

  const SL_QUALITY = { good: 'годный', defective: 'брак', packaging_defect: 'брак упаковки' };
  const SL_SHOW = 500;

  function renderStockLoad(){
    const body = document.getElementById('stockLoadBody');
    const acts = document.getElementById('stockLoadActions');
    if(!body || !acts) return;
    const p = stockLoad.preview;
    const s = p && p.summary;
    const options = '<option value="">Выберите продавца</option>'
      + companies.map(c => '<option value="' + escapeHTML(c.id) + '"' + (c.id === stockLoad.companyId ? ' selected' : '')
        + '>' + escapeHTML(c.name) + '</option>').join('');

    let result = '';
    if(stockLoad.busy === 'check' && !p){
      result = '<div class="oc-note">Проверяю файл…</div>';
    } else if(p){
      const rank = (l) => (l.error ? 2 : l.already ? 0 : 1);
      const lines = p.lines.slice().sort((a, b) => rank(b) - rank(a) || a.line - b.line);
      const blank = s.skipped + stockLoad.blank;
      const shown = lines.slice(0, SL_SHOW);
      result = '<div class="sl-sum">'
        + '<span class="sl-chip ok">Загрузится: <b>' + s.ok + '</b> ' + pluralRu(s.ok, 'строка', 'строки', 'строк')
        +   ' · <b>' + s.units + '</b> шт. · ' + s.products + ' ' + pluralRu(s.products, 'товар', 'товара', 'товаров')
        +   ' в ' + s.cells + ' ' + pluralRu(s.cells, 'ячейке', 'ячейках', 'ячейках') + '</span>'
        + (s.errors ? '<span class="sl-chip bad">Ошибок: <b>' + s.errors + '</b> — исправьте файл и выберите его снова</span>' : '')
        + (s.already ? '<span class="sl-chip">Уже загружено раньше: <b>' + s.already + '</b> — пропущены</span>' : '')
        + (blank ? '<span class="sl-chip">Не заполнено: <b>' + blank + '</b> — пропущены</span>' : '')
        + '</div>'
        + (s.vs1c.length
            ? '<details class="sl-fold"><summary>С учётом 1С не сходится: ' + s.vs1c.length + ' '
              + pluralRu(s.vs1c.length, 'товар', 'товара', 'товаров') + ' — это не ошибка, только для сверки</summary>'
              + '<table class="sl-table"><thead><tr><th>Товар</th><th class="num">Уже в ячейках</th>'
              + '<th class="num">Загружаете</th><th class="num">По 1С</th></tr></thead><tbody>'
              + s.vs1c.map(v => '<tr><td>' + escapeHTML(v.name) + '<div class="sub mono">' + escapeHTML(v.sku) + '</div></td>'
                + '<td class="num">' + (v.inCells || '—') + '</td>'
                + '<td class="num">' + v.loaded + '</td><td class="num">' + v.stock1c + '</td></tr>').join('')
              + '</tbody></table></details>'
            : '')
        + (s.notInFile
            ? '<div class="oc-note" style="margin-bottom:12px;">По 1С есть остаток ещё у ' + s.notInFile + ' '
              + pluralRu(s.notInFile, 'товара', 'товаров', 'товаров') + ', которых нет в файле. Их можно загрузить следующим файлом.</div>'
            : '')
        + '<table class="sl-table"><thead><tr><th>Строка</th><th>Ячейка</th><th>Товар</th>'
        + '<th class="num">Кол-во</th><th>Состояние</th>' + (stockLoad.vws.length ? '<th>Склад</th>' : '') + '<th>Проверка</th></tr></thead><tbody>'
        + shown.map(l => '<tr' + (l.error ? ' class="bad"' : l.already ? ' class="done"' : '') + '>'
          + '<td class="num">' + l.line + '</td>'
          // Вписанное и найденное — рядом, когда они различаются: подмену
          // адреса на сотнях строк иначе не заметить.
          + '<td class="mono">' + (l.cellLabel && l.cell && l.cell !== l.cellLabel
              ? escapeHTML(l.cell) + ' → ' + escapeHTML(l.cellLabel)
              : escapeHTML(l.cellLabel || l.cell || '—')) + '</td>'
          + '<td>' + (l.name ? escapeHTML(l.name) + '<div class="sub mono">' + escapeHTML(l.sku) + '</div>'
              : '<span class="mono">' + escapeHTML(l.sku || '—') + '</span>') + '</td>'
          + '<td class="num">' + (l.qty == null ? '—' : l.qty) + '</td>'
          + '<td>' + escapeHTML(SL_QUALITY[l.quality] || '') + '</td>'
          + (stockLoad.vws.length ? '<td>' + escapeHTML(l.vwName || '') + '</td>' : '')
          + '<td>' + (l.error ? '<span class="err">' + escapeHTML(l.error) + '</span>'
              : l.already ? 'уже загружено ' + escapeHTML(l.already)
              : '<span class="okay">загрузится</span>') + '</td>'
          + '</tr>').join('')
        + '</tbody></table>'
        + (lines.length > SL_SHOW ? '<div class="oc-note" style="margin-top:10px;">Показаны первые ' + SL_SHOW + ' строк из '
          + lines.length + ' — сначала строки с ошибками.</div>' : '');
    }

    body.innerHTML = '<div class="oc-note">Для товара, который уже лежит на полках, а в ячейках Аргуса его нет. '
      + 'Скачайте бланк, впишите у полки посчитанное количество (ячейку — с таблички), загрузите файл: '
      + 'Аргус проверит каждую строку и покажет, что загрузится. Одна ошибка — и не загрузится ничего. '
      + 'Тот же файл можно загружать снова, дописывая: уже загруженные строки пропускаются. '
      + 'Ошиблись — загрузку можно отменить, пока её товар не отбирали, не перемещали и не пересчитывали. '
      + 'В 1С ничего не отправляется.</div>'
      + '<div class="sl-field"><label for="stockLoadCompany">Продавец</label>'
      + '<select class="mp-field" id="stockLoadCompany" onchange="setStockLoadCompany(this.value)"'
      + (stockLoad.busy ? ' disabled' : '') + '>' + options + '</select></div>'
      // Склады продавца: куда идут строки без столбца «Склад».
      + (stockLoad.vws.length ? '<div class="sl-field"><label for="stockLoadVw">Склад продавца по умолчанию</label>'
        + '<select class="mp-field" id="stockLoadVw" onchange="setStockLoadVw(this.value)"' + (stockLoad.busy ? ' disabled' : '') + '>'
        + '<option value="">Остальной товар</option>'
        + stockLoad.vws.map(w => '<option value="' + escapeHTML(w.id) + '"' + (w.id === stockLoad.defaultVw ? ' selected' : '') + '>' + escapeHTML(w.name) + '</option>').join('')
        + '</select><div class="ord-meta">Для строк без столбца «Склад». В файле можно указать склад у каждой строки — столбец «Склад».</div></div>' : '')
      + '<div class="sl-row">'
      +   '<button class="wh-onboarding-btn" type="button" onclick="downloadStockTemplate()"'
      +     (stockLoad.companyId ? '' : ' disabled') + '>Скачать бланк</button>'
      +   '<label class="wh-onboarding-btn sl-file">' + (stockLoad.fileName ? 'Выбрать другой файл' : 'Выбрать файл')
      +     '<input type="file" accept=".xlsx,.xls,.csv" onchange="onStockLoadFile(this)"' + (stockLoad.busy ? ' disabled' : '') + '></label>'
      +   (stockLoad.fileName ? '<span class="ord-meta">' + escapeHTML(stockLoad.fileName) + '</span>' : '')
      + '</div>'
      + (stockLoad.rows && !stockLoad.companyId ? '<div class="oc-note">Выберите продавца — и файл проверится.</div>' : '')
      + (stockLoad.error ? '<div class="oc-note" style="color:var(--terracotta);">' + escapeHTML(stockLoad.error) + '</div>' : '')
      + result;

    const batches = stockLoad.batches || [];
    if(batches.length){
      body.innerHTML += '<div class="sl-batches"><h4>Последние загрузки</h4>'
        + '<table class="sl-table"><thead><tr><th>Когда</th><th>Продавец</th><th class="num">Штук</th>'
        + '<th class="num">Ячеек</th><th></th></tr></thead><tbody>'
        + batches.map(b => '<tr' + (b.undone ? ' class="done"' : '') + '>'
          + '<td>' + escapeHTML(new Date(b.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) + '</td>'
          + '<td>' + escapeHTML(b.companyName || '—') + '</td>'
          + '<td class="num">' + b.units + '</td><td class="num">' + b.cells + '</td>'
          + '<td>' + (b.undone ? 'отменена'
              : b.canUndo ? '<button class="sl-undo" type="button" onclick="undoStockBatch(\'' + escapeHTML(b.batch) + '\')"'
                + (stockLoad.busy ? ' disabled' : '') + '>Отменить</button>'
              : '<span class="sub">' + ({
                  touched: 'её товар уже отбирали, перемещали или пересчитывали — не отменить',
                  counting: 'назначен пересчёт — сначала закройте задание',
                  legacy: 'загружена до появления отмены — не отменить',
                }[b.blocked] || 'не отменить') + '</span>') + '</td>'
          + '</tr>').join('')
        + '</tbody></table></div>';
    }

    const canApply = !!(s && s.errors === 0 && s.ok > 0 && !stockLoad.busy);
    acts.innerHTML = '<button class="wh-onboarding-btn" type="button" onclick="closeStockLoad()"'
      + (stockLoad.busy === 'apply' || stockLoad.busy === 'undo' ? ' disabled' : '') + '>Закрыть</button>'
      + '<button class="wh-onboarding-btn primary" type="button" onclick="applyStockLoad()"' + (canApply ? '' : ' disabled') + '>'
      + (stockLoad.busy === 'apply' ? 'Загружаю…' : stockLoad.busy === 'undo' ? 'Отменяю загрузку…'
        : stockLoad.busy === 'check' ? 'Проверяю файл…' : s && s.errors ? 'Сначала исправьте ошибки'
        : s && s.ok ? 'Загрузить ' + s.units + ' шт.' : s && s.already ? 'Всё уже загружено' : 'Загрузить') + '</button>';
  }

  function exportCell(blockId){
    const entry = blockById[blockId];
    if(!entry){ showWhToast('Ячейка не найдена.'); return; }
    const addr = blockAddr(entry.rowNum, entry.block);
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

  // В Excel — то, что сейчас в списке: с поиском и фильтрами.
  function exportInvoices(){
    const originLabel = { seller: 'от продавца', '1c': 'из 1С', manual: 'вручную' };
    const rows = rcFiltered().map(function(inv){
      return {
        'Номер': inv.number,
        'Продавец': inv.company_name,
        'Откуда': inv.source_document_type === 'supplier_order' ? 'заказ поставщику, из 1С' : originLabel[rcOrigin(inv)],
        'Привезут': rcPlannedDay(inv) ? rcPlannedDay(inv).split('-').reverse().join('.') : '',
        'Время выгрузки': rcPlannedDay(inv) ? receiptSlot(inv.planned_from, inv.planned_to) : '',
        'Машина приехала': inv.arrived_at ? new Date(inv.arrived_at).toLocaleString('ru-RU') : '',
        'Статус': receiptState(inv) + (inv.has_discrepancy ? ', расхождение' : ''),
        'Кто везёт': [inv.carrier, inv.vehicle].filter(Boolean).join(', '),
        'Документы поставщика': inv.supplier_docs || '',
        'Заведён': inv.created_at ? new Date(inv.created_at).toLocaleString('ru-RU') : '',
      };
    });
    saveXlsx('Приходы', 'Приходы', rows, [18, 24, 18, 12, 14, 18, 22, 24, 26, 18]);
  }


  /* ===================== Расчёты с продавцами ===================== */

  function loadBilling(){ return ArgusBilling.load(); }
  window.loadBilling = loadBilling;

  /* ===================== Заказы с маркетплейсов ===================== */

  // Экран менеджера. Порядок намеренно такой: сперва продавцы с числом
  // накопившегося, и только по клику — сами заказы. Список из двухсот заказов
  // подряд не отвечает на вопрос «чем заняться», а список продавцов отвечает.
  let ordersPartners = [];
  let ordersPicked = null;
  let ordersRows = [];
  // Чей экран заказов открыт сейчас: ответы приходят с задержкой, и поздний
  // ответ по прошлому продавцу не должен перерисовать чужой экран.
  let ordersCompanyId = null;
  const ordersPhotoCatalog = new Map();
  const orderMarketplaceBadge = (value) => {
    const source = String(value || '').toLowerCase();
    const label = { wb: 'WB', ozon: 'Ozon', '1c': '1С' }[source];
    return source ? '<span class="workspace-marketplace ' + (source === '1c' ? 'onec' : source === 'wb' || source === 'ozon' ? source : '')
      + '">' + escapeHTML(label || source.toUpperCase()) + '</span>' : '';
  };
  function orderPhotoHtml(url){
    let safe = null;
    try{
      const u = new URL(url);
      if(u.protocol === 'https:' && !u.username && !u.password
        && ['wbbasket.ru', 'wbstatic.net', 'wildberries.ru'].some(d => u.hostname === d || u.hostname.endsWith('.' + d))) safe = u.href;
    } catch(_){}
    return '<span class="order-product-photo" role="img" aria-label="' + (safe ? 'Фото товара' : 'Фото нет') + '">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M3 3h18v18H3zM3 16l6-6 5 5 3-3 4 4M15 7h.01"/></svg>'
      + (safe ? '<img src="' + escapeHTML(safe) + '" alt="" width="44" height="44" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">' : '') + '</span>';
  }
  function orderCatalogPhoto(companyId, order){
    const products = ordersPhotoCatalog.get(companyId)?.products;
    const cards = products?.get(order.sku)?.cards || [];
    const card = order.nmId ? cards.find(c => String(c.nmId) === String(order.nmId)) : cards.find(c => c.photoUrl);
    return orderPhotoHtml(card?.photoUrl);
  }
  function loadOrderPhotoCatalog(companyId){
    const cached = ordersPhotoCatalog.get(companyId);
    if(cached && Date.now() - cached.at < 120000) return;
    const cache = { at: Date.now(), products: cached?.products || new Map() };
    ordersPhotoCatalog.set(companyId, cache);
    apiFetch('/api/sellers/catalog?companyId=' + encodeURIComponent(companyId)).then(data => {
      cache.products = new Map((data.products || []).map(p => [p.sku, p]));
      if(ordersCompanyId === companyId && ordersPicked === companyId) renderPartnerOrders(companyId);
      if(productsFor === companyId) renderProducts();
    }).catch(() => {});
  }

  async function loadMpOrders(){
    const host = document.getElementById('ordersContent');
    if(!host) return;
    // Заказы могли уйти в поставку — поиск по остальным перечитаем заново.
    ordersAll = { companyId: null, rows: null, loading: false };
    try{
      ordersPartners = await apiFetch('/api/supplies/pending');
      const total = ordersPartners.reduce((s, p) => s + p.orders, 0);
      const badge = document.getElementById('ordersBadge');
      if(badge){
        badge.textContent = total > 0 ? String(total) : '';
        badge.classList.toggle('show', total > 0);
      }
      if(ordersPicked && !ordersPartners.some(p => p.companyId === ordersPicked)) ordersPicked = null;
      renderMpOrders();
      if(ordersPicked) loadPartnerOrders(ordersPicked);
      loadSupplies();
    } catch(e){
      // Отрисовка внутри того же try, что и запрос. Раньше она была снаружи,
      // и её падение оставляло экран на «Загружаем…» навсегда: запрос-то
      // прошёл. Сообщение общее нарочно — владельцу всё равно, на чём
      // именно мы споткнулись, ему важно, что это не он виноват.
      host.innerHTML = '<div class="staff-empty">Не удалось показать заказы: '
        + escapeHTML(e.message) + '</div>';
    }
  }
  window.loadMpOrders = loadMpOrders;

  function renderMpOrders(){
    const host = document.getElementById('ordersContent');
    if(!host) return;
    if(ordersPartners.length === 0){
      host.innerHTML = '<div class="staff-empty">Заказов без поставки нет — всё разобрано.</div>';
      return;
    }
    const partners = ordersPartners.map(p => `
      <div class="ord-partner${p.companyId === ordersPicked ? ' active' : ''}"
           onclick="pickOrdersPartner('${p.companyId}')">
        <div class="ord-count">${p.orders}</div>
        <div>
          <div class="ord-name">${escapeHTML(p.companyName)} ${orderMarketplaceBadge(p.marketplace)}</div>
          <div class="ord-meta">${p.units.toLocaleString('ru-RU')} шт${p.oldest ? ' · самый ранний — ' + fmtDay(p.oldest) + ', ' + formatLastSeen(p.oldest) : ''}${
            p.incomplete > 0
              ? ` · <span class="ord-warn">${p.incomplete} не собрать</span>`
              : ''
          }${p.wbConfirmed > 0 ? ` · ещё ${p.wbConfirmed} подтверждены в кабинете WB` : ''}</div>
        </div>
        <div class="ord-meta">${p.companyId === ordersPicked ? 'открыт' : 'открыть →'}</div>
      </div>
    `).join('');

    host.innerHTML = partners
      + '<div id="ordersDetail"></div>';
  }

  function pickOrdersPartner(companyId){
    ordersPicked = ordersPicked === companyId ? null : companyId;
    renderMpOrders();
    if(ordersPicked) loadPartnerOrders(ordersPicked);
  }
  window.pickOrdersPartner = pickOrdersPartner;

  async function loadPartnerOrders(companyId){
    const box = document.getElementById('ordersDetail');
    if(!box) return;
    box.innerHTML = '<div class="staff-empty">Загружаем заказы…</div>';
    ordersCompanyId = companyId;
    let rows;
    try{
      rows = await apiFetch('/api/supplies/pending/' + companyId);
    } catch(e){
      if(ordersCompanyId !== companyId) return;
      box.innerHTML = '<div class="staff-empty">Не удалось загрузить: ' + escapeHTML(e.message) + '</div>';
      return;
    }
    if(ordersCompanyId !== companyId) return;   // уже открыли другого продавца
    ordersRows = rows;
    // Тот же продавец (вернулись с другой вкладки, список обновился) —
    // отмеченное остаётся отмеченным, если заказ ещё можно взять; другой
    // продавец — с чистого листа (владелец 30.09.2026: галочки сбрасывались).
    ordersSelected = ordersSelectedFor === companyId
      ? new Set([...ordersSelected].filter(id => rows.some(o => o.id === id && o.ready)))
      : new Set();
    if(ordersSelectedFor !== companyId){ ordersWbWh = new Set(); ordersWhOpen = false; ordersVw = ''; }
    ordersSelectedFor = companyId;
    loadOrderPhotoCatalog(companyId);
    renderPartnerOrders(companyId);
  }

  // Выбранные для поставки заказы. По умолчанию не выбрано ничего: поставку
  // составляет менеджер, заказ за заказом, а не одна кнопка «забрать всё».
  let ordersSelected = new Set();
  let ordersSelectedFor = null;   // чей список отмечен
  // Поиск и порядок в списке заказов продавца. Заказов бывает полторы сотни,
  // и собирают их не подряд, а по товару: сперва то, что лежит рядом.
  let ordersSearch = '';
  let ordersSort = 'product';
  // Точка доставки будущей поставки: живёт, пока менеджер отмечает заказы,
  // и не сбрасывается от перерисовки списка при поиске или сортировке.
  let ordersPlace = '';
  window.setOrdersPlace = (value) => { ordersPlace = value; };
  // Поставка на WB: пункт приёма из списка WB и плановая дата. Без них WB не
  // примет поставку в доставку. Пункт — любой из тех, что WB показывает
  // продавцу (решение владельца 25.09.2026): их десятки тысяч, поэтому выбор —
  // поиском по городу и адресу, сервер отвечает совпадениями.
  const ordersPoints = {};  // companyId -> найденные пункты | 'loading' | 'error'
  let ordersPointId = '';
  let ordersPoint = null;
  let ordersPointText = '';
  let ordersShipDate = '';
  // Склад продавца, с которого собирать поставку (виртуальные склады,
  // 02.10.2026): '' — не выбран, 'main' — «Основной», иначе id склада.
  let ordersVw = '';
  window.setOrdersVw = (companyId, value) => { ordersVw = value; renderPartnerOrders(companyId); };
  // Из каких складов можно собрать: на WB — «Основной» и склады WB, иначе любой.
  function supplyVwChoices(companyId, isWb){
    const c = vwCache[companyId];
    if(!c){ vwOf(companyId).then(() => renderPartnerOrders(companyId)).catch(() => {}); return null; }
    const list = isWb ? c.wbChoices : c.warehouses.concat([{ id: null, name: 'Остальной товар' }]);
    // «Весь товар продавца» — с любого его склада (владелец 06.10.2026).
    return list.length > 1 ? [{ id: 'all', name: 'Весь товар продавца' }].concat(list) : list;
  }
  let pointsSearchTimer = null;
  const pointLabel = (p) => (p.officeType === 'sc' ? 'Сортировочный центр WB — ' : '')
    + String(p.address || p.name || p.id).trim() + ' · №' + p.id;
  function fillPointsList(companyId, list){
    list.forEach(p => { p.label = pointLabel(p); });
    ordersPoints[companyId] = list;
    let dl = document.getElementById('wbPoints-' + companyId);
    if(!dl){ dl = document.createElement('datalist'); dl.id = 'wbPoints-' + companyId; document.body.appendChild(dl); }
    dl.innerHTML = list.map(p => `<option value="${escapeHTML(p.label)}">`).join('');
  }
  window.setOrdersPointText = (companyId, value) => {
    ordersPointText = value;
    const list = Array.isArray(ordersPoints[companyId]) ? ordersPoints[companyId] : [];
    const hit = list.find(p => p.label === value);
    if(hit){
      if(String(hit.id) === ordersPointId) return;
      ordersPointId = String(hit.id);
      ordersPoint = hit;
      renderPartnerOrders(companyId);
      const el = document.getElementById('ordPointText');
      if(el){ el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      return;
    }
    const hadPoint = Boolean(ordersPointId);
    ordersPointId = '';
    ordersPoint = null;
    if(hadPoint){
      renderPartnerOrders(companyId);
      const el = document.getElementById('ordPointText');
      if(el){ el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }
    // Ищем на сервере, когда человек перестал печатать.
    clearTimeout(pointsSearchTimer);
    pointsSearchTimer = setTimeout(() => {
      const q = value.trim();
      if(q.length < 2) return;
      apiFetch('/api/supplies/shipping-points/' + encodeURIComponent(companyId) + '?q=' + encodeURIComponent(q))
        .then(r => { if(ordersPointText === value) fillPointsList(companyId, r.points || []); })
        .catch(() => {});
    }, 300);
  };
  window.setOrdersShipDate = (companyId, value) => { ordersShipDate = value; renderPartnerOrders(companyId); };
  // «Сегодня» — по поясу склада (настройки склада), не по часам компьютера.
  const moscowToday = () => {
    try { return new Date().toLocaleDateString('sv-SE', { timeZone: (whSettings && whSettings.timezone) || 'Europe/Moscow' }); }
    catch(e){ return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }); }
  };
  function loadShippingPoints(companyId){
    if(ordersPoints[companyId]) return;
    ordersPoints[companyId] = 'loading';
    // Сперва — сортировочные центры; остальное ищется по вводу.
    apiFetch('/api/supplies/shipping-points/' + encodeURIComponent(companyId))
      .then(r => {
        const list = r && Array.isArray(r.points) ? r.points : [];
        if(list.length === 0){ ordersPoints[companyId] = 'error'; return; }
        fillPointsList(companyId, list);
      })
      .catch(() => { ordersPoints[companyId] = 'error'; })
      .then(() => {
        // Ответ мог прийти, когда менеджер уже открыл другого продавца:
        // перерисовывать его экран данными прошлого нельзя.
        if(ordersCompanyId === companyId) renderPartnerOrders(companyId);
      });
  }

  function sortOrders(rows){
    const by = {
      product: (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru')
        || String(a.number).localeCompare(String(b.number), 'ru'),
      number: (a, b) => String(a.number).localeCompare(String(b.number), 'ru'),
      date: (a, b) => new Date(b.orderedAt || b.createdAt || 0) - new Date(a.orderedAt || a.createdAt || 0),
    };
    return [...rows].sort(by[ordersSort] || by.product);
  }

  // Нехватка по учёту Аргуса — цветом строки (владелец 27.09.2026): красный —
  // годного товара в ячейках нет совсем, жёлтый — есть, но меньше, чем нужно
  // этим заказам вместе с поставками, которые уже собираются. Считает сервер
  // (stockLevel) — тем же правилом, что «не хватит товара» у поставки.
  const orderShortLevel = (o) => (o.stockLevel === 'none' || o.stockLevel === 'short') ? o.stockLevel : null;
  let ordersShortOnly = false;
  function setOrdersShortOnly(companyId, on){
    ordersShortOnly = Boolean(on);
    renderPartnerOrders(companyId);
  }
  window.setOrdersShortOnly = setOrdersShortOnly;
  // Видна ли строка: поиск и «Только с нехваткой». Галка «выбрать все» стоит
  // над видимым списком и обязана означать ровно его.
  const orderVisible = (o) => matchesOrderSearch(o) && (!ordersShortOnly || Boolean(orderShortLevel(o)))
    && (!ordersWbWh.size || ordersWbWh.has(String(o.wbWarehouseId || 'none')));
  // Склад продавца на WB: поставка WB берёт заказы только одного склада.
  let ordersWbWh = new Set();
  let ordersWhOpen = false;
  window.setOrdersWhOpen = (open) => { ordersWhOpen = open; };
  function setOrdersWbWh(companyId, value){
    if(value === 'all') ordersWbWh.clear();
    else if(ordersWbWh.has(value)) ordersWbWh.delete(value);
    else ordersWbWh.add(value);
    ordersWhOpen = true;
    renderPartnerOrders(companyId);
    const input = [...document.querySelectorAll('.order-warehouse-filter input')].find(el => el.value === value);
    if(input) input.focus({ preventScroll: true });
  }
  window.setOrdersWbWh = setOrdersWbWh;
  document.addEventListener('keydown', (event) => {
    const filter = event.target.closest?.('.order-warehouse-filter[open]');
    if(filter && event.key === 'Escape'){
      event.preventDefault(); filter.open = false; ordersWhOpen = false; filter.querySelector('summary').focus();
    }
  });
  document.addEventListener('click', (event) => {
    if(event.target.closest?.('.order-warehouse-filter')) return;
    const filter = document.querySelector('.order-warehouse-filter[open]');
    if(filter){ filter.open = false; ordersWhOpen = false; }
  });
  function orderWarehouseFilter(companyId, whNames){
    const options = [...whNames].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'ru'));
    if(ordersRows.some(o => !o.wbWarehouseId)) options.push(['none', 'Склад WB не известен']);
    if(!options.length && !ordersWbWh.size) return '';
    const label = ordersWbWh.size ? 'Выбрано складов: ' + ordersWbWh.size : 'Все склады WB';
    return '<details class="order-warehouse-filter" ' + (ordersWhOpen ? 'open ' : '') + 'ontoggle="setOrdersWhOpen(this.open)">'
      + '<summary>' + label + '</summary><div class="order-warehouse-menu" aria-label="Склады для просмотра заказов">'
      + '<label><input type="checkbox" value="all" ' + (!ordersWbWh.size ? 'checked ' : '')
      + 'onchange="setOrdersWbWh(\'' + companyId + '\', this.value)">Все склады WB</label>'
      + options.map(([id, name]) => '<label><input type="checkbox" value="' + escapeHTML(id) + '" '
        + (ordersWbWh.has(String(id)) ? 'checked ' : '') + 'onchange="setOrdersWbWh(\'' + companyId + '\', this.value)">'
        + escapeHTML(name || 'Склад WB ' + id) + '</label>').join('')
      + '<p>Отбор меняет только список заказов.</p></div></details>';
  }

  // Необязательные столбцы — человек включает сам; выбор помним в этом
  // браузере отдельно на склад и роль: владелец и менеджер за одним
  // компьютером выбирают каждый своё.
  const ORDER_COLUMNS = { stock: 'На складе, шт.' };
  const ORDER_COLS_KEY = 'argus_orders_cols_' + (authPayload.warehouseId || '') + '_' + ROLE;
  function orderColumns(){
    let saved = null;
    try{ saved = JSON.parse(localStorage.getItem(ORDER_COLS_KEY) || 'null'); } catch(e){ saved = null; }
    return new Set((Array.isArray(saved) ? saved : []).filter(c => ORDER_COLUMNS[c]));
  }
  function toggleOrderColumn(companyId, col){
    const cols = orderColumns();
    if(cols.has(col)) cols.delete(col); else cols.add(col);
    try{ localStorage.setItem(ORDER_COLS_KEY, JSON.stringify([...cols])); } catch(e){}
    ordersColsOpen = true;
    renderPartnerOrders(companyId);
  }
  window.toggleOrderColumn = toggleOrderColumn;
  let ordersColsOpen = false;
  function toggleOrderColsMenu(companyId){
    ordersColsOpen = !ordersColsOpen;
    renderPartnerOrders(companyId);
  }
  window.toggleOrderColsMenu = toggleOrderColsMenu;
  document.addEventListener('click', function(e){
    if(!ordersColsOpen || (e.target.closest && e.target.closest('.ord-cols'))) return;
    ordersColsOpen = false;
    const menu = document.querySelector('.ord-cols-menu');
    if(menu) menu.hidden = true;
    const btn = document.querySelector('.ord-cols-btn');
    if(btn) btn.setAttribute('aria-expanded', 'false');
  });

  function matchesOrderSearch(o){
    const q = ordersSearch.trim().toLowerCase();
    if(!q) return true;
    // nmId — «Артикул WB» в кабинете продавца: по нему продавец и ищет.
    return [o.number, o.name, o.sku, o.article, o.nmId, o.barcode, o.rid, (o.offices || []).join(' ')]
      .some(v => String(v || '').toLowerCase().includes(q));
  }

  // Здесь — только заказы, которые ждут поставки. Заказ, который уже в
  // поставке, уехал или отменён, поиск раньше не находил вовсе, хотя продавец
  // видит его у себя (владелец 26.09.2026). Ищем и по всем заказам продавца.
  let ordersAll = { companyId: null, rows: null, loading: false };
  function loadAllOrders(companyId){
    if(ordersAll.companyId === companyId && (ordersAll.rows || ordersAll.loading)) return;
    ordersAll = { companyId, rows: null, loading: true };
    apiFetch('/api/sellers/orders?companyId=' + encodeURIComponent(companyId))
      .then(r => { if(ordersAll.companyId === companyId){ ordersAll.rows = r.rows || []; ordersAll.loading = false; renderPartnerOrders(companyId); } })
      .catch(() => { if(ordersAll.companyId === companyId) ordersAll.loading = false; });
  }
  function otherOrderState(r){
    if(r.status === 'shipped') return 'отгружен' + (r.supply_number ? ' · ' + r.supply_number : '');
    if(r.mp_closed_at) return r.mp_close_reason === 'canceled' ? 'отменён на WB' : 'завершён на WB';
    if(r.supply_number) return 'в поставке ' + r.supply_number;
    return 'в работе';
  }
  function otherOrdersHtml(companyId){
    const q = ordersSearch.trim().toLowerCase();
    if(q.length < 3) return '';
    loadAllOrders(companyId);
    if(!ordersAll.rows) return ordersAll.loading ? '<div class="ord-meta" style="margin-top:18px;">Ищу среди остальных заказов продавца…</div>' : '';
    const pending = new Set(ordersRows.map(o => o.id));
    const hits = ordersAll.rows.filter(r => !pending.has(r.id) && (!ordersWbWh.size || ordersWbWh.has(String(r.mp_warehouse_id || 'none')))
      && [r.number, r.name, r.sku, r.mp_article, r.mp_nm_id,
      r.mp_barcode, r.mp_rid, r.supply_number].some(v => String(v || '').toLowerCase().includes(q)));
    if(!hits.length) return '';
    return `<div class="ord-meta" style="margin:24px 0 10px;"><b>Среди остальных заказов продавца — ${new Set(hits.map(r => r.id)).size}.</b>
        Они уже в поставке, уехали или закрыты на WB.</div>
      <div class="ord-scroll"><table class="ord-table"><thead><tr><th>Заказ</th><th>Товар</th><th>Артикул WB</th>
        <th>Штрихкод</th><th>Где сейчас</th><th class="num">Кол-во</th></tr></thead><tbody>${hits.slice(0, 200).map(r => `<tr>
        <td class="ord-mono ord-no">${escapeHTML(r.number)}</td>
        <td>${escapeHTML(r.name || '—')}<div class="ord-mono">${escapeHTML(r.sku || '')}</div></td>
        <td class="ord-mono">${escapeHTML(r.mp_nm_id || '—')}${r.mp_article ? `<div class="ord-sub">${escapeHTML(r.mp_article)}</div>` : ''}</td>
        <td class="ord-mono">${escapeHTML(r.mp_barcode || '—')}</td>
        <td>${escapeHTML(otherOrderState(r))}</td>
        <td class="num">${Number(r.qty)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // Когда заказ оформлен: время у площадки, а если его нет (заказ из 1С
  // или ещё не дозаполнен обменом) — когда он пришёл в Аргус, с пометкой.
  function orderWhen(o){
    const at = o.orderedAt || o.createdAt;
    if(!at) return '—';
    return escapeHTML(new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))
      + '<div class="ord-sub">' + escapeHTML(formatLastSeen(at)) + (o.orderedAt ? '' : ' · в Аргусе') + '</div>';
  }

  function renderPartnerOrders(companyId){
    const box = document.getElementById('ordersDetail');
    if(!box) return;
    const partner = ordersPartners.find(p => p.companyId === companyId);
    const shown = ordersRows.filter(orderVisible);
    const cols = orderColumns();
    const withStock = cols.has('stock');
    // Сколько заказов с нехваткой — по всему списку продавца, без поиска:
    // цифра на кнопке фильтра не должна прыгать от набранной буквы.
    const shortCount = new Set(ordersRows.filter(o => orderShortLevel(o)).map(o => o.id)).size;
    const fresh = sortOrders(shown.filter(o => !o.wbConfirmed));
    const confirmed = sortOrders(shown.filter(o => o.wbConfirmed));
    const ready = fresh.filter(o => o.ready);
    // Строка списка — это позиция заказа. Раньше «не сопоставить N» и
    // «уже подтверждены N» считали строки и противоречили карточке продавца
    // прямо над таблицей, где стоит число заказов.
    const uniq = (rows) => new Set(rows.map(o => o.id)).size;
    const stuck = uniq(fresh) - uniq(ready);
    const n = ordersSelected.size;
    const allOn = ready.length > 0 && ready.every(o => ordersSelected.has(o.id));
    const isWb = partner && partner.marketplace === 'wb';
    if(isWb) loadShippingPoints(companyId);
    const points = isWb && Array.isArray(ordersPoints[companyId]) ? ordersPoints[companyId] : null;
    const needShipping = !!points && (!ordersPointId || !ordersShipDate);
    const vwChoices = supplyVwChoices(companyId, isWb) || [];
    if(ordersVw && !vwChoices.some(c => (c.id || 'main') === ordersVw)) ordersVw = '';
    const needVw = vwChoices.length > 1 && !ordersVw;
    // WB не примет в одну поставку заказы разных складов продавца.
    const whNames = new Map(ordersRows.filter(o => o.wbWarehouseId).map(o => [o.wbWarehouseId, o.wbWarehouse]));
    const pickedWh = [...new Set(ordersRows.filter(o => ordersSelected.has(o.id) && o.wbWarehouseId).map(o => o.wbWarehouseId))];
    const mixedWh = pickedWh.length > 1;
    // Годный остаток в ячейках Аргуса. Жёлтой строке — сколько нужно: «1» и
    // «нужно 3» читаются как «1 из 3».
    const stockCell = (o) => {
      if(o.stockQty == null) return '<td class="num"><span class="ord-sub">—</span></td>';
      const need = Number(o.stockNeed || 0), reserved = Number(o.stockReserved || 0);
      return '<td class="num ord-stock">' + o.stockQty
        + (orderShortLevel(o)
          ? '<div class="ord-sub">нужно ' + need + (reserved ? ' + ' + reserved + ' в поставках' : '') + '</div>'
          : '')
        + '</td>';
    };
    // Заказ из 1С собирают с того склада продавца, который выбрал менеджер
    // (владелец 02.10.2026); по умолчанию «Основной».
    const allVw = vwCache[companyId] && vwCache[companyId].warehouses.length
      ? vwCache[companyId].warehouses.concat([{ id: null, name: 'Остальной товар' }]) : [];
    const lineVw = (o) => (o.marketplace === '1c' && o.itemId && allVw.length
      ? `<div class="ord-sub">склад: <select class="ord-vw-line" aria-label="Склад продавца" onchange="setOrderLineVw('${companyId}', '${o.itemId}', this.value, this)">`
        + allVw.map(w => `<option value="${w.id || ''}"${(w.id || null) === (o.vw || null) ? ' selected' : ''}>${escapeHTML(w.name)}</option>`).join('')
        + '</select></div>' : '');
    const row = (o, selectable) => `
      <tr class="${selectable ? '' : 'not-ready'}${orderShortLevel(o) ? ' st-' + orderShortLevel(o) : ''}">
        <td>${selectable
          ? `<input type="checkbox" ${ordersSelected.has(o.id) ? 'checked' : ''} onchange="toggleOrderPick('${companyId}', '${o.id}')" aria-label="Выбрать заказ">`
          : ''}</td>
        <td class="ord-mono ord-no">${escapeHTML(o.number)} ${orderMarketplaceBadge(o.marketplace)}${o.rid
          ? `<div class="ord-sub" title="${escapeHTML(o.rid)}">${escapeHTML(String(o.rid).slice(0, 14))}…</div>` : ''}</td>
        <td class="ord-when">${orderWhen(o)}</td>
        <td><div class="order-product-name">${orderCatalogPhoto(companyId, o)}<div>${escapeHTML(o.name || '—')}<div class="ord-mono">${escapeHTML(o.sku || 'не сопоставлен')}</div>${lineVw(o)}</div></div></td>
        <td class="ord-mono">${escapeHTML(o.article || '—')}${o.nmId ? `<div class="ord-sub">WB ${escapeHTML(o.nmId)}</div>` : ''}</td>
        <td class="ord-mono">${escapeHTML(o.barcode || '—')}</td>
        <td>${(o.offices || []).length ? escapeHTML(o.offices.join(', ')) : '<span class="ord-sub">—</span>'}${o.wbWarehouse
          ? `<div class="ord-sub">склад WB: ${escapeHTML(o.wbWarehouse)}</div>` : ''}</td>
        <td class="num">${o.qty === null ? '—' : o.qty}${o.salePriceKopecks != null
          ? `<div class="ord-sub">${(o.salePriceKopecks / 100).toLocaleString('ru-RU')} ₽</div>` : ''}</td>
        ${withStock ? stockCell(o) : ''}
      </tr>`;
    const head = (withToggle) => `<thead><tr>
        <th>${withToggle ? `<input type="checkbox" ${allOn ? 'checked' : ''} ${ready.length ? '' : 'disabled'}
          onchange="toggleAllOrders('${companyId}')" aria-label="Выбрать все готовые">` : ''}</th>
        <th>Заказ</th><th>Оформлен</th><th>Товар</th><th>Артикул МП</th><th>Штрихкод</th>
        <th>Куда</th><th class="num">Кол-во</th>${withStock ? '<th class="num">На складе, шт.</th>' : ''}
      </tr></thead>`;
    const emptyRow = (text) => `<tr><td colspan="${withStock ? 9 : 8}" class="ord-empty">${text}</td></tr>`;

    box.innerHTML = `
      <div class="ord-actions" data-form>
        <!-- Куда уедет поставка. По этой точке её потом отбирают в списке
             поставок и по ней грузчик раскладывает собранное по машинам.
             Для WB — пункт приёма из списка WB и дата: их требует WB. -->
        ${points ? `
        <input class="ord-place ord-point" id="ordPointText"
               list="wbPoints-${companyId}" value="${escapeHTML(ordersPointText)}"
               placeholder="Пункт WB: город или адрес — любой из кабинета WB" aria-label="Пункт отгрузки WB"
               oninput="setOrdersPointText('${companyId}', this.value)">
        <input class="ord-place ord-date" id="ordShipDate" type="date" min="${moscowToday()}"
               value="${escapeHTML(ordersShipDate)}" onchange="setOrdersShipDate('${companyId}', this.value)"
               aria-label="Дата отгрузки" title="Дата отгрузки">`
        : `
        <input class="ord-place" id="ordPlace" list="ordPlaceList" maxlength="120"
               placeholder="${isWb && ordersPoints[companyId] === 'loading' ? 'Загружаю пункты WB…' : 'Куда везём: склад WB или город'}"
               value="${escapeHTML(ordersPlace)}" oninput="setOrdersPlace(this.value)">
        <datalist id="ordPlaceList">${[...new Set((supplyRows || []).map(s => s.destination).filter(Boolean))]
          .map(d => `<option value="${escapeHTML(d)}">`).join('')}</datalist>`}
        ${vwChoices.length > 1 ? `
        <select class="ord-place ord-vw" aria-label="Склад продавца, с которого собирать" onchange="setOrdersVw('${companyId}', this.value)">
          <option value=""${ordersVw ? '' : ' selected'} disabled>С какого склада продавца собирать</option>
          ${vwChoices.map(c => `<option value="${c.id || 'main'}"${ordersVw === (c.id || 'main') ? ' selected' : ''}>${c.id === 'all' ? escapeHTML(c.name) : 'Склад «' + escapeHTML(c.name) + '»'}</option>`).join('')}
        </select>` : ''}
        <button class="wh-onboarding-btn${n > 0 && !needShipping && !mixedWh && !needVw ? ' primary' : ''}" type="button"
                onclick="makeSupply('${companyId}')" ${n === 0 || needShipping || mixedWh || needVw ? 'disabled' : ''}>
          ${n === 0 ? 'Выберите заказы для поставки'
            : mixedWh ? 'Выберите заказы одного склада WB'
            : needShipping ? 'Выберите пункт WB и дату отгрузки'
            : needVw ? 'Выберите склад продавца'
            : `Составить поставку — ${n} ${pluralRu(n, 'заказ', 'заказа', 'заказов')}`}
        </button>
        ${isWb && ordersPoints[companyId] === 'error' ? `<span class="ord-meta ord-warn">Список пунктов WB не загрузился —
          поставку можно составить, но передать её в доставку на WB без пункта не выйдет</span>` : ''}
        ${(() => {
          // Сколько из выбранного, по учёту, собрать не из чего — видно до
          // того, как поставка ушла на склад, а не у пустой ячейки.
          const short = new Set(ordersRows.filter(o => o.stockShort && ordersSelected.has(o.id)).map(o => o.id)).size;
          return short ? `<span class="ord-meta ord-warn">${short} ${pluralRu(short, 'заказ', 'заказа', 'заказов')}
            из выбранных — товара на полках не хватит</span>` : '';
        })()}
        ${mixedWh ? `<span class="ord-meta ord-warn">Выбраны заказы ${pickedWh.length} складов WB
          (${pickedWh.map(id => '«' + escapeHTML(whNames.get(id) || id) + '»').join(', ')}) — WB принимает в поставку заказы только одного склада.
          Отберите их фильтром «Склад WB».</span>` : ''}
        ${stuck > 0 ? `<span class="ord-meta ord-warn">${stuck} ${
          pluralRu(stuck, 'заказ', 'заказа', 'заказов')} не сопоставить с номенклатурой — свяжите артикул: «Клиенты» → «нельзя собрать», и они починятся</span>` : ''}
        <span class="ord-tools">
          <input class="ord-search" type="search" placeholder="Товар, артикул WB, штрихкод или номер заказа"
                 value="${escapeHTML(ordersSearch)}" oninput="setOrdersSearch('${companyId}', this.value)">
          ${orderWarehouseFilter(companyId, whNames)}
          <select class="ord-sort" onchange="setOrdersSort('${companyId}', this.value)">
            <option value="product"${ordersSort === 'product' ? ' selected' : ''}>По товару</option>
            <option value="number"${ordersSort === 'number' ? ' selected' : ''}>По номеру заказа</option>
            <option value="date"${ordersSort === 'date' ? ' selected' : ''}>По дате</option>
          </select>
          <button type="button" class="ord-chip${ordersShortOnly ? ' on' : ''}" aria-pressed="${ordersShortOnly}"
                  onclick="setOrdersShortOnly('${companyId}', ${!ordersShortOnly})" ${shortCount || ordersShortOnly ? '' : 'disabled'}>
            Только с нехваткой · ${shortCount}</button>
          <span class="ord-cols">
            <button type="button" class="ord-chip ord-cols-btn" aria-haspopup="true" aria-expanded="${ordersColsOpen}"
                    onclick="toggleOrderColsMenu('${companyId}')">Столбцы ▾</button>
            <span class="ord-cols-menu" ${ordersColsOpen ? '' : 'hidden'}>
              ${Object.keys(ORDER_COLUMNS).map(c => `<label class="ord-cols-item">
                <input type="checkbox" ${cols.has(c) ? 'checked' : ''} onchange="toggleOrderColumn('${companyId}', '${c}')">
                ${escapeHTML(ORDER_COLUMNS[c])}</label>`).join('')}
            </span>
          </span>
        </span>
      </div>
      <div class="ord-legend">
        <span><i class="ord-sw st-none"></i>товара на складе нет совсем</span>
        <span><i class="ord-sw st-short"></i>есть, но меньше, чем нужно этим заказам (вместе с поставками, которые уже собираются)</span>
        <span class="ord-sub">по годному остатку в ячейках Аргуса</span>
      </div>
      <div class="ord-scroll">
        <table class="ord-table ord-cards">${head(true)}<tbody>${fresh.map(o => row(o, o.ready)).join('')
          || emptyRow(ordersShortOnly ? 'Заказов с нехваткой нет.' : 'Под поиск ничего не подходит.')}</tbody></table>
      </div>
      ${confirmed.length ? `
        <div class="ord-meta" style="margin:24px 0 10px;">
          <b>Уже подтверждены в кабинете WB — ${uniq(confirmed)}.</b> Их собирают по поставке WB,
          которую сделали без Аргуса; в поставку Аргуса они не попадут, чтобы не собрать заказ дважды.
        </div>
        <div class="ord-scroll">
          <table class="ord-table ord-cards">${head(false)}<tbody>${confirmed.map(o => row(o, false)).join('')}</tbody></table>
        </div>` : ''}
      ${otherOrdersHtml(companyId)}
      <div class="ord-meta" style="margin-top:14px;">
        Продавец: ${escapeHTML(partner ? partner.companyName : '')}. Поставка уходит на склад, грузчики
        собирают её по листу. Пока для продавца не разрешено «Менять статусы» в окне клиента («Клиенты» → клиент), поставку и статусы в кабинете WB делают вручную — после того как поставка составлена здесь.
      </div>
    `;
  }

  function setOrdersSearch(companyId, value){
    // Каретку возвращаем туда, где её поставил человек: её гнало в конец
    // строки, и исправить букву в середине запроса было невозможно.
    const before = document.querySelector('.ord-search');
    const at = before && before.selectionStart != null ? before.selectionStart : value.length;
    ordersSearch = value;
    renderPartnerOrders(companyId);
    const box = document.querySelector('.ord-search');
    if(box){ box.focus(); const pos = Math.min(at, box.value.length); box.setSelectionRange(pos, pos); }
  }
  window.setOrdersSearch = setOrdersSearch;

  function setOrdersSort(companyId, value){
    ordersSort = value;
    renderPartnerOrders(companyId);
  }
  window.setOrdersSort = setOrdersSort;

  function toggleOrderPick(companyId, id){
    if(ordersSelected.has(id)) ordersSelected.delete(id); else ordersSelected.add(id);
    // Список перерисовывается целиком, поэтому прокрутку возвращаем на место:
    // иначе после каждой галки таблица прыгала в начало, и до восьмидесятого
    // заказа приходилось доезжать заново.
    const before = [...document.querySelectorAll('.ord-scroll')].map(el => el.scrollTop);
    renderPartnerOrders(companyId);
    document.querySelectorAll('.ord-scroll').forEach((el, i) => {
      if(before[i] != null) el.scrollTop = before[i];
    });
  }
  window.toggleOrderPick = toggleOrderPick;

  function toggleAllOrders(companyId){
    // Только видимые: галка стоит над отфильтрованным списком и обязана
    // означать ровно его. Отметки на скрытых заказах не трогаем — их ставил
    // человек. Раньше бралась вся сотня заказов, включая спрятанные поиском.
    const ready = ordersRows.filter(o => o.ready && !o.wbConfirmed && orderVisible(o));
    const allOn = ready.length > 0 && ready.every(o => ordersSelected.has(o.id));
    const next = new Set(ordersSelected);
    ready.forEach(o => { if(allOn) next.delete(o.id); else next.add(o.id); });
    ordersSelected = next;
    renderPartnerOrders(companyId);
  }
  window.toggleAllOrders = toggleAllOrders;

  // Собранные поставки.
  //
  // Нужны на этом же экране по одной причине: собрать поставку не туда —
  // обычное дело, и человек должен видеть, что он собрал, рядом с тем, из
  // чего собирал. Пока поставка «собирается», её можно разобрать; после
  // отбора товар уже снят с полок, и разбирать её в базе значило бы
  // соврать про склад.
  let supplyRows = [];

  // Фильтр списка поставок: по клиенту, по точке доставки и по состоянию.
  // Поставок за неделю набирается столько, что глазами уже не находишь.
  let supplyFilter = { company: '', destination: '', status: '' };

  // Отмеченные поставки: их документы печатаются одним заходом. За день
  // поставок бывает несколько, и открывать их по одной ради печати — та же
  // работа, умноженная на число поставок.
  let supplyPicked = new Set();
  // Какие поставки раскрыты «что внутри» и что в них лежит. Прошлый ответ
  // держим, чтобы панель не мигала пустотой, пока едет новый.
  let supplyOpen = new Set();
  const supplyInside = {};

  function setSupplyFilter(field, value){
    supplyFilter[field] = value;
    renderSupplies();
  }
  window.setSupplyFilter = setSupplyFilter;

  function toggleSupplyPick(id){
    if(supplyPicked.has(id)) supplyPicked.delete(id); else supplyPicked.add(id);
    renderSupplies();
  }
  window.toggleSupplyPick = toggleSupplyPick;

  // «Выбрать все» — ровно то, что видно под отбором: галка стоит над
  // отфильтрованным списком и обязана означать его, а не всю базу поставок.
  function toggleAllSupplies(ids){
    const allOn = ids.length > 0 && ids.every(id => supplyPicked.has(id));
    ids.forEach(id => { if(allOn) supplyPicked.delete(id); else supplyPicked.add(id); });
    renderSupplies();
  }
  window.toggleAllSupplies = toggleAllSupplies;

  // Документы сразу по нескольким поставкам: одна страница, одна печать.
  function printPickedSupplies(ids){
    if(ids.length === 0) return;
    window.open('supply_print.html?' + ids.map(id => 'id=' + encodeURIComponent(id)).join('&'), '_blank');
  }
  window.printPickedSupplies = printPickedSupplies;

  // Что внутри поставки: товары, сколько чего и где лежит — под строкой,
  // не уходя на страницу печати.
  async function toggleSupplyInside(id){
    if(supplyOpen.has(id)){ supplyOpen.delete(id); renderSupplies(); return; }
    supplyOpen.add(id);
    renderSupplies();
    // Спрашиваем заново при каждом открытии: пока панель была закрыта,
    // заказы могли собрать. Прошлый ответ до этого момента остаётся на
    // экране — открытая панель не должна мигать пустотой.
    try{ supplyInside[id] = await apiFetch('/api/supplies/' + id); }
    catch(e){ if(!supplyInside[id]) supplyInside[id] = { error: e.message }; }
    renderSupplies();
  }
  window.toggleSupplyInside = toggleSupplyInside;

  // Состав поставки одной таблицей: строки заказов сложены по товару.
  // «Взять» и ячейки берём из листа комплектации — это те же данные, по
  // которым собирают, и расходиться с бумагой экран не должен.
  function insideHtml(id){
    const d = supplyInside[id];
    if(!d) return '<div class="sup-head">Смотрю…</div>';
    if(d.error) return '<div class="sup-head warn">Не удалось посмотреть: ' + escapeHTML(d.error) + '</div>';
    // Отметки грузчика «нет товара» — первым делом: поставка стоит, пока по
    // ним не решили. Решение прямо здесь: убрать заказ из поставки (она
    // уедет без него) — или, если товар нашёлся, закрыть отметку в журнале.
    const canRemove = d.supply && d.supply.status !== 'shipped' && !d.supply.mpSupplyId;
    const alerts = (d.shortages || []).length
      ? '<div class="sup-alert"><b>ОЧЕНЬ ВАЖНО — грузчик отметил «нет товара»</b>'
        + d.shortages.map(x => '<div>' + escapeHTML(urgentText(x.text))
          + (!canRemove ? ''
            : x.orderPicked
              ? '<div class="sup-alert-note">По заказу уже отбирали товар — убрать его из поставки нельзя, только дособрать.</div>'
              : ' <span class="mp-act warn" onclick="removeSupplyOrder(\'' + escapeHTML(x.invoiceId) + '\', \''
                + escapeHTML(String(x.orderNumber || '').replace(/['\\]/g, '')) + '\')">Убрать заказ из поставки</span>')
          + '</div>').join('')
        + '<div class="sup-alert-note">Заказ вернётся в очередь, а поставка уедет без него. Товар нашёлся — нажмите'
        + ' «Товар нашёлся» у отметки в <span class="mp-act" onclick="switchView(\'journal\')">журнале</span>.</div></div>'
      : '';
    const notes = itemNotesHtml(d.notes, id);
    const byProduct = new Map();
    (d.packing || []).forEach(r => {
      const it = byProduct.get(r.sku)
        || { sku: r.sku, name: r.name, article: r.article, photo: r.photo, qty: 0, orders: new Set() };
      if(!it.photo && r.photo) it.photo = r.photo;
      it.qty += Number(r.qty || 0);
      it.orders.add(r.orderNumber);
      byProduct.set(r.sku, it);
    });
    const left = new Map((d.picking || []).map(p => [p.sku, p]));
    const rows = [...byProduct.values()]
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
    if(rows.length === 0) return alerts + notes + '<div class="sup-head">В поставке нет товаров.</div>';
    const orders = new Set((d.packing || []).map(r => r.orderNumber)).size;
    const units = rows.reduce((sum, r) => sum + r.qty, 0);
    const body = rows.map(r => {
      const p = left.get(r.sku);
      const taken = r.qty - (p ? p.qty : 0);
      // Где лежит. Идти больше некуда — товар уже на столе. Некуда идти —
      // товар в ячейки Аргуса не положен: собрать по такому листу нельзя,
      // и сказать об этом надо здесь, а не у стеллажа.
      const where = taken >= r.qty
        ? 'собрано'
        : p && p.cells && p.cells.length
          ? p.cells.map(c => escapeHTML(c.label) + (c.take ? ' — ' + c.take : '')).join('<br>')
          : '<span class="warn">не в ячейках Аргуса</span>';
      // По учёту на полках меньше, чем нужно поставке: этим заказам
      // собираться не из чего. Решают до сборки — убрать их из поставки.
      // Сервер отдаёт, сколько осталось взять (qty) и сколько лежит в ячейках
      // склада поставки (available); поля shortfall в карточке нет — раньше
      // «не хватает» здесь не показывалось никогда.
      const shortBy = p ? Math.max(0, Number(p.qty || 0) - Number(p.available || 0)) : 0;
      const short = taken < r.qty && shortBy > 0
        ? '<div class="warn">не хватает ' + shortBy + ' шт</div>'
          + (d.supply && d.supply.virtualWarehouseName && d.supply.status === 'collecting'
            ? '<span class="mp-act" onclick="takeFromOtherVw(\'' + jsArg(id) + '\', \'' + jsArg(r.sku) + '\', ' + shortBy + ')">Взять с другого склада продавца</span>' : '')
        : '';
      return '<tr>'
        + '<td><div class="order-product-name">' + orderPhotoHtml(r.photo || p?.photo) + '<div>' + escapeHTML(r.name || '—')
        +   '<div class="sku">' + escapeHTML(r.article || r.sku || '') + '</div></div></div></td>'
        + '<td class="num">' + r.orders.size + '</td>'
        + '<td class="num">' + r.qty + (taken > 0 ? '<div class="sku">собрано ' + taken + '</div>' : '') + '</td>'
        + '<td>' + where + short + '</td>'
        + '</tr>';
    }).join('');
    return alerts + notes + '<div class="sup-head">' + orders + ' ' + pluralRu(orders, 'заказ', 'заказа', 'заказов')
      + ' · ' + units + ' ' + pluralRu(units, 'штука', 'штуки', 'штук')
      + ' · ' + rows.length + ' ' + pluralRu(rows.length, 'позиция', 'позиции', 'позиций') + '</div>'
      + '<table><thead><tr><th>Товар</th><th class="num">Заказов</th>'
      + '<th class="num">Штук</th><th>Где лежит</th></tr></thead><tbody>'
      + body + '</tbody></table>';
  }

  // Складу поставки не хватает товара, а на другом складе продавца он есть:
  // перенос учёта (владелец 02.10.2026). Продавец запретил складу решать
  // без него — перенос ждёт его «Согласен».
  function takeFromOtherVw(supplyId, sku, qty){
    const d = supplyInside[supplyId]; if(!d || !d.supply) return;
    openTransfer(sku, { companyId: d.supply.companyId, to: vwKey(d.supply.virtualWarehouseId || null), qty,
      note: 'не хватало для поставки ' + d.supply.number,
      after: async () => { try{ supplyInside[supplyId] = await apiFetch('/api/supplies/' + supplyId); } catch(_){} renderSupplies(); } });
  }
  window.takeFromOtherVw = takeFromOtherVw;

  async function loadSupplies(){
    const box = document.getElementById('suppliesList');
    if(!box) return;
    const newButton = document.getElementById('newSupplyButton');
    if(newButton) newButton.hidden = !canOpenView('orders');
    let rows;
    try{ rows = await apiFetch('/api/supplies'); }
    catch(e){
      supplyRows = [];
      box.innerHTML = '<div class="staff-empty">Не удалось загрузить поставки: '
        + escapeHTML(e.message) + '</div>';
      return;
    }
    supplyRows = rows;
    renderSupplies();
  }

  function renderSupplies(){
    const box = document.getElementById('suppliesList');
    if(!box) return;
    const all = supplyRows || [];
    // Значок у пункта меню — отметки «нет товара», по которым поставка стоит.
    const missing = all.reduce((s, x) => s + (Number(x.missing) || 0), 0);
    const badge = document.getElementById('suppliesBadge');
    if(badge){
      badge.textContent = missing > 0 ? String(missing) : '';
      badge.classList.toggle('show', missing > 0);
    }
    if(all.length === 0){
      box.innerHTML = '<div class="staff-empty">Поставок пока нет.</div>';
      return;
    }
    const uniq = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    const rows = all.filter(s =>
      (!supplyFilter.company || s.company_name === supplyFilter.company)
      && (!supplyFilter.destination || (s.destination || '') === supplyFilter.destination)
      && (!supplyFilter.status || s.status === supplyFilter.status));
    // Отметки живут по id: отбор и перерисовка их не сбрасывают, но «выбрать
    // все» и печать работают только по тому, что сейчас на экране.
    const ids = rows.map(s => s.id);
    const picked = ids.filter(id => supplyPicked.has(id));
    const allPicked = ids.length > 0 && picked.length === ids.length;
    const idsArg = JSON.stringify(ids).replace(/"/g, '&quot;');
    const option = (value, current, label) =>
      '<option value="' + escapeHTML(value) + '"' + (value === current ? ' selected' : '') + '>'
      + escapeHTML(label) + '</option>';
    const filters = '<div class="sup-filters">'
      + '<select onchange="setSupplyFilter(\'company\', this.value)">'
      +   option('', supplyFilter.company, 'Все клиенты')
      +   uniq(all.map(s => s.company_name)).map(v => option(v, supplyFilter.company, v)).join('')
      + '</select>'
      + '<select onchange="setSupplyFilter(\'destination\', this.value)">'
      +   option('', supplyFilter.destination, 'Любая точка доставки')
      +   uniq(all.map(s => s.destination)).map(v => option(v, supplyFilter.destination, v)).join('')
      + '</select>'
      + '<select onchange="setSupplyFilter(\'status\', this.value)">'
      +   option('', supplyFilter.status, 'Все состояния')
      +   option('collecting', supplyFilter.status, 'Собираются')
      +   option('ready', supplyFilter.status, 'Собраны')
      +   option('shipped', supplyFilter.status, 'Уехали')
      + '</select>'
      + '<span class="ord-meta">' + rows.length + ' из ' + all.length + '</span>'
      + '<label class="sup-all"><input type="checkbox"' + (allPicked ? ' checked' : '')
      +   (rows.length ? '' : ' disabled')
      +   ' onchange="toggleAllSupplies(' + idsArg + ')"> Выбрать все</label>'
      + (picked.length
          ? '<button class="wh-onboarding-btn primary" type="button"'
            + ' onclick="printPickedSupplies(' + JSON.stringify(picked).replace(/"/g, '&quot;') + ')">'
            + 'Документы — ' + picked.length + ' '
            + pluralRu(picked.length, 'поставка', 'поставки', 'поставок') + '</button>'
          : '')
      + '</div>';
    if(rows.length === 0){
      box.innerHTML = filters + '<div class="staff-empty">По этому отбору поставок нет.</div>';
      return;
    }
    box.innerHTML = filters + rows.map(s => {
      const when = s.shipped_at || s.ready_at || s.created_at;
      return '<div class="sup-row">'
        + '<div class="sup-num">'
        +   '<input class="sup-pick" type="checkbox" aria-label="Выбрать поставку"'
        +     (supplyPicked.has(s.id) ? ' checked' : '')
        +     ' onchange="toggleSupplyPick(\'' + s.id + '\')">'
        +   escapeHTML(s.number) + ' ' + orderMarketplaceBadge(s.marketplace || (s.mp_supply_id ? 'wb' : '')) + '</div>'
        + '<div><div class="sup-company">' + escapeHTML(s.company_name)
        +   (s.vw_name ? ' <span class="sup-meta">· склад «' + escapeHTML(s.vw_name) + '»</span>' : '') + '</div>'
        +   '<div class="sup-meta">' + s.orders + ' '
        +   pluralRu(s.orders, 'заказ', 'заказа', 'заказов')
        +   (s.status === 'collecting' && s.orders > 0 ? ' · собрано ' + s.picked + ' из ' + s.orders : '')
        +   (s.mp_supply_id
              ? ' · WB ' + escapeHTML(s.mp_supply_id)
                + (s.mp_delivered_at ? ', в доставке' : ', на сборке')
              : '')
        +   (when ? ' · ' + fmtDay(when) : '')
        +   (s.ship_date && s.status !== 'shipped' ? ' · отгрузка ' + fmtDay(s.ship_date) : '')
        +   (s.destination ? ' · ' + escapeHTML(s.destination) : '') + '</div>'
        // Кто составил и когда — видно сразу, без журнала.
        +   (s.created_at ? '<div class="sup-by">составлена ' + escapeHTML(new Date(s.created_at).toLocaleString('ru-RU',
              { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))
              + (s.created_by ? ' · составил ' + escapeHTML(s.created_by) : '') + '</div>' : '')
        +   supplyAssemblyHtml(s)
        + '</div>'
        + '<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">'
        +   (s.missing > 0 ? '<span class="sup-missing" title="Грузчик отметил на сборке — смотрите «Что внутри» и журнал">Нет товара: ' + s.missing + '</span>' : '')
        // Ещё до сборки: по учёту Аргуса товара на полках не хватит.
        +   (s.stockShort > 0 && !(s.missing > 0) ? '<span class="sup-missing sup-short" title="По учёту Аргуса на полках не хватает товара для этих заказов">Не хватит товара: ' + s.stockShort + '</span>' : '')
        +   '<div class="sup-state ' + s.status + '">' + escapeHTML(supplyStateText(s)) + '</div>'
        + '</div>'
        + '<div class="sup-acts">'
        +   '<span class="mp-act" onclick="toggleSupplyInside(\'' + s.id + '\')">'
        +     (supplyOpen.has(s.id) ? 'Свернуть' : 'Что внутри') + '</span>'
        +   '<span class="mp-act" onclick="printSupply(\'' + s.id + '\')">Документы</span>'
        // Сначала передать в доставку WB — получить QR поставки и грузить
        // машину; «Уехала» — только после (владелец 05–06.10.2026). Запись
        // на WB выключена — передают в кабинете WB, «Уехала» сразу.
        +   (s.status === 'ready' && s.mp_supply_id && !s.mp_delivered_at && s.mp_write
              ? '<span class="mp-act go" onclick="handoverWb(\'' + s.id + '\')">Передать в доставку WB</span>'
              : '')
        +   (s.status === 'ready' && !(s.mp_supply_id && !s.mp_delivered_at && s.mp_write)
              ? '<span class="mp-act go" onclick="shipSupply(\'' + s.id + '\')">Уехала</span>'
              : '')
        +   (s.status === 'collecting' && s.picked === 0
              ? '<span class="mp-act warn" onclick="disbandSupply(\'' + s.id + '\')">Разобрать</span>'
              : '')
        // Поставка уехала, а на WB не передалась: без этой кнопки повторить
        // было нечем — «Уехала» второй раз не нажимается.
        +   (s.status === 'shipped' && s.mp_supply_id && !s.mp_delivered_at
              ? '<span class="mp-act warn" onclick="retryWbDeliver(\'' + s.id + '\')">Повторить передачу на WB</span>'
              : '')
        + '</div>'
        + '</div>'
        + (supplyOpen.has(s.id)
            ? '<div class="sup-inside">' + insideHtml(s.id) + '</div>'
            : '');
    }).join('');
  }
  window.loadSupplies = loadSupplies;
  window.renderSupplies = renderSupplies;

  // Ход сборки у поставки — строкой, как её видят грузчики (27.09.2026):
  // «На паузе · Дима · взято 3 из 7 · «коробы у ворот 3»». Руководитель и
  // менеджер только смотрят: начать или бросить сборку может лишь грузчик.
  function supplyAssemblyHtml(s){
    const st = s.assembly;
    if(!st || !st.assembly || s.status === 'shipped') return '';
    const a = st.assembly;
    const taken = 'взято ' + st.taken + ' из ' + st.total + ' шт.';
    const byPaper = a.mode === 'paper' ? ' по листу' : '';
    const head = a.status === 'active' ? 'Собирает ' + escapeHTML(a.workerName) + byPaper
      : a.status === 'paused' ? 'На паузе · ' + escapeHTML(a.workerName)
      : a.status === 'abandoned' ? 'Свободна — ' + escapeHTML(a.workerName) + ' отказался'
      : (s.status === 'collecting' ? 'Сборку закончил ' : 'Собрал ') + escapeHTML(a.workerName) + byPaper;
    const note = st.lastComment
      ? ' · «' + escapeHTML(st.lastComment.text) + '»'
        + (st.lastComment.by && st.lastComment.by !== a.workerName ? ' — ' + escapeHTML(st.lastComment.by) : '')
      : '';
    return '<div class="sup-asm ' + escapeHTML(a.status) + '">' + head + ' · ' + taken + note + '</div>';
  }

  // Лист комплектации и упаковочный — отдельной страницей.
  //
  // Новая вкладка, а не окно поверх кабинета: печатается лист бумаги, и всё
  // остальное на нём лишнее. Заодно страницу можно оставить открытой на
  // складском компьютере и печатать оттуда, не заходя в кабинет каждый раз.
  function printSupply(id){
    window.open('supply_print.html?id=' + encodeURIComponent(id), '_blank');
  }
  window.printSupply = printSupply;

  // Ответ на «нет товара»: убрать заказ из поставки. Заказ возвращается
  // в очередь, поставка едет без него и сама становится «собранной», если
  // остальное собрано. Это решение, а не справка, — поэтому спрашиваем.
  async function removeSupplyOrder(invoiceId, orderNumber){
    if(!await askConfirm('Убрать заказ «' + orderNumber + '» из поставки?\n\nЗаказ вернётся в очередь — его можно будет'
      + ' поставить в следующую поставку, когда товар найдётся. Поставка уедет без него.')) return;
    try{
      const r = await apiFetch('/api/supplies/orders/' + encodeURIComponent(invoiceId) + '/remove', { method: 'POST' });
      showWhToast('Заказ ' + r.orderNumber + ' убран из поставки ' + r.supplyNumber + ' и вернулся в очередь.'
        + (r.supplyStatus === 'ready' ? ' Поставка собрана — можно отгружать.' : ''));
      if(supplyOpen.has(r.supplyId)){
        try{ supplyInside[r.supplyId] = await apiFetch('/api/supplies/' + r.supplyId); } catch(_){}
      }
      await loadMpOrders();
      await loadJournal();
    } catch(e){
      showWhToast('Не удалось убрать заказ: ' + e.message);
    }
  }
  window.removeSupplyOrder = removeSupplyOrder;

  async function disbandSupply(id){
    const s = (supplyRows || []).find(x => x.id === id);
    const number = s ? s.number : '';
    if(!await askConfirm('Разобрать поставку «' + number + '»?\n\nЗаказы вернутся в очередь,'
      + ' и поставки с этим номером больше не будет.')) return;
    try{
      const r = await apiFetch('/api/supplies/' + id, { method: 'DELETE' });
      showWhToast('Поставка ' + r.number + ' разобрана: ' + r.returned + ' '
        + pluralRu(r.returned, 'заказ', 'заказа', 'заказов') + ' вернулись в очередь.');
      await loadMpOrders();
    } catch(e){
      showWhToast('Не удалось разобрать: ' + e.message);
    }
  }
  window.disbandSupply = disbandSupply;

  // Состояние поставки словами, с шагами WB: передана в доставку (QR готов)
  // → уехала → принята WB, когда WB принял все посылки (владелец 05.10.2026).
  function supplyStateText(s){
    if(s.status === 'shipped' && s.mp_supply_id && s.orders > 0){
      if(s.accepted >= s.orders) return 'принята WB';
      if(s.accepted > 0) return 'уехала · принято WB ' + s.accepted + ' из ' + s.orders;
      return 'уехала, в пути';
    }
    if(s.status === 'ready' && s.mp_delivered_at) return 'передана в доставку · QR готов';
    return s.statusName || s.status;
  }

  // Передать поставку в доставку на WB до отъезда: WB закрывает поставку и
  // выдаёт её QR — его печатают и кладут в машину, потом «Уехала».
  async function handoverWb(id){
    const s = (supplyRows || []).find(x => x.id === id);
    if(!s || !await askConfirm('Передать поставку «' + s.number + '» в доставку на WB?\n\n'
      + 'WB закроет поставку и выдаст её QR — напечатайте его в «Документы» и положите в машину. '
      + 'После этого заказы этой поставки на WB уже не поменять.')) return;
    try{
      const r = await apiFetch('/api/supplies/' + id + '/marketplace/deliver', { method: 'POST' });
      showWhToast(r.delivered ? 'Поставка передана в доставку. QR поставки — в «Документы».'
        : r.alreadyDelivered ? 'Она уже передана в доставку.'
        : r.skipped === 'write_disabled' ? 'Статусы WB для этого продавца менять не разрешено — передайте поставку в кабинете WB.'
        : 'WB не принял: ' + (r.error || 'без ответа'));
      await loadSupplies();
    } catch(e){
      showWhToast('Не удалось передать: ' + e.message);
    }
  }
  window.handoverWb = handoverWb;

  // Машина ушла — поставка и все её заказы становятся отгруженными. Назад
  // этого не отменить, поэтому спрашиваем.
  async function shipSupply(id){
    const s = (supplyRows || []).find(x => x.id === id);
    if(!s || !await askConfirm('Поставка «' + s.number + '» погружена и уехала?\n\n'
      + s.orders + ' ' + pluralRu(s.orders, 'заказ', 'заказа', 'заказов')
      + (Number(s.orders) % 10 === 1 && Number(s.orders) % 100 !== 11 ? ' станет отгруженным' : ' станут отгруженными')
      + '. Отменить это нельзя.')) return;
    try{
      const r = await apiFetch('/api/supplies/' + id + '/ship', { method: 'POST' });
      const mp = r.marketplace || {};
      // Без этого всплывашка говорила только «уехала», а на WB поставка так и
      // висела «на сборке»: менеджер был уверен, что дело закрыто.
      const wb = mp.delivered ? ' На WB передана в доставку.'
        : mp.alreadyDelivered ? ''
        : mp.error ? ' На WB передать не удалось: ' + mp.error
        : mp.skipped === 'write_disabled'
          ? ' На WB ничего не менялось: для этого продавца не разрешено «Менять статусы» — передайте поставку в кабинете WB руками.'
        // Поставка не на WB (физлицу) — про WB молчим (06.10.2026).
        : mp.skipped === 'no_mp_supply' && (s.marketplace === 'wb' || s.mp_supply_id)
          ? ' На WB поставки нет — передайте её в кабинете WB руками.'
        : '';
      showWhToast('Поставка ' + r.number + ' уехала.' + wb);
      await loadMpOrders();
    } catch(e){
      showWhToast('Не удалось отметить: ' + e.message);
    }
  }
  window.shipSupply = shipSupply;

  // Повтор передачи в доставку на WB. Журнал советует «повторите из Аргуса» —
  // теперь это действительно можно сделать.
  async function retryWbDeliver(id){
    try{
      const r = await apiFetch('/api/supplies/' + id + '/marketplace/deliver', { method: 'POST' });
      showWhToast(r.delivered ? 'Поставка передана в доставку на WB.'
        : r.alreadyDelivered ? 'Она уже передана в доставку.'
        : r.skipped === 'write_disabled' ? 'Статусы WB для этого продавца менять не разрешено.'
        : 'WB снова не принял: ' + (r.error || 'без ответа'));
      await loadSupplies();
    } catch(e){
      showWhToast('Не удалось повторить: ' + e.message);
    }
  }
  window.retryWbDeliver = retryWbDeliver;

  // Забрать заказы со всех подключённых площадок.
  //
  // Раньше за этим приходилось идти на другой экран и нажимать «Забрать
  // заказы» отдельно у каждого клиента. Шагов здесь ровно столько, сколько
  // подключений плюс один на пересчёт накопившегося, — отсюда и настоящий
  // процент. Одна упавшая площадка не останавливает остальные: заказы
  // остальных клиентов не должны зависеть от чужого просроченного ключа.
  async function pullMarketplaces(hostId, after){
    let mps;
    try{
      mps = await apiFetch('/api/marketplaces');
    } catch(e){
      showWhToast('Не удалось узнать список площадок: ' + e.message);
      return;
    }
    if(mps.length === 0){
      showWhToast('Ни одна площадка не подключена — забирать нечего.');
      return;
    }
    const p = whProgress(hostId, mps.length + 1, 'Спрашиваю площадки…');
    let seen = 0, created = 0, unmapped = 0;
    const broken = [];
    for(const m of mps){
      try{
        const r = await apiFetch('/api/marketplaces/sync', {
          method: 'POST', body: { companyId: m.companyId },
        });
        seen += r.seen || 0;
        created += r.created || 0;
        unmapped += (r.unmapped || []).length;
        p.step(m.company + ' — заданий ' + (r.seen || 0) + ', новых ' + (r.created || 0));
      } catch(e){
        broken.push(m.company);
        p.step(m.company + ' — не ответила');
      }
    }
    try{ await after(); } catch(e){ /* ниже всё равно скажем результат */ }
    let text = 'Заданий у площадок ' + seen + ', новых заказов ' + created;
    if(unmapped > 0) text += ', не сопоставлено ' + unmapped;
    if(broken.length > 0){
      p.fail(text + '. Не ответили: ' + broken.join(', '));
      showWhToast('Не ответили: ' + broken.join(', '));
    } else {
      p.finish(text);
    }
  }

  function pullOrdersFromMp(){ return pullMarketplaces('ordersProgress', loadMpOrders); }
  window.pullOrdersFromMp = pullOrdersFromMp;
  function pullAllMarketplaces(){ return pullMarketplaces('mpProgress', loadMarketplaces); }
  window.pullAllMarketplaces = pullAllMarketplaces;

  // Поставка из выбранных заказов.
  //
  // Только из того, что менеджер отметил сам: одна кнопка «всё на сборку»
  // однажды отправила на склад девяносто три заказа разом, и шесть из них
  // уже собирали по поставке WB.
  // Пока запрос летит, кнопка заблокирована: второе нажатие уходило вторым
  // POST с теми же заказами и делало вторую поставку.
  let supplyInFlight = false;

  async function makeSupply(companyId){
    if(supplyInFlight){ showWhToast('Поставка уже составляется — подождите.'); return; }
    // Одна строка списка — это позиция заказа, а не заказ: у заказа из двух
    // товаров id повторялся дважды, и сервер отвечал «Часть заказов не найдена».
    const ready = [...new Set(ordersRows.filter(o => o.ready && ordersSelected.has(o.id)).map(o => o.id))];
    if(ready.length === 0){ showWhToast('Отметьте заказы, которые войдут в поставку.'); return; }
    const partner = ordersPartners.find(p => p.companyId === companyId);
    const points = Array.isArray(ordersPoints[companyId]) ? ordersPoints[companyId] : null;
    const point = ordersPoint && String(ordersPoint.id) === ordersPointId ? ordersPoint : null;
    if(points && (!point || !ordersShipDate)){ showWhToast('Выберите пункт WB и дату отгрузки.'); return; }
    const place = (point ? point.label : ordersPlace.trim()).slice(0, 120);
    const dayText = ordersShipDate
      ? new Date(ordersShipDate + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '';
    const vwChoices = supplyVwChoices(companyId, partner && partner.marketplace === 'wb') || [];
    const vwPick = vwChoices.length > 1 ? vwChoices.find(c => (c.id || 'main') === ordersVw) : null;
    if(vwChoices.length > 1 && !vwPick){ showWhToast('Выберите, с какого склада продавца собирать поставку.'); return; }
    if(!await askConfirm(`Составить поставку: ${ready.length} ${pluralRu(ready.length, 'заказ', 'заказа', 'заказов')}`
      + ` продавца «${partner ? partner.companyName : ''}»` + (place ? ` — ${place}` : '') + (dayText ? `, отгрузка ${dayText}` : '')
      + (vwPick ? (vwPick.id === 'all' ? ', из всего товара продавца' : `, со склада «${vwPick.name}»`) : '')
      + `?\n\nОна уйдёт на склад, грузчики начнут сборку` + (vwPick ? (vwPick.id === 'all' ? ' — с любого склада продавца.' : ' — только из товара этого склада.') : '.'))) return;
    supplyInFlight = true;
    const button = document.querySelector('.ord-actions button');
    if(button){ button.disabled = true; button.textContent = 'Составляем поставку…'; }
    try{
      const supply = await apiFetch('/api/supplies', {
        method: 'POST',
        body: {
          invoiceIds: ready, marketplace: partner ? partner.marketplace : null, destination: place || null,
          shippingPointId: point ? point.id : null, shipDate: ordersShipDate || null,
          ...(vwPick ? { virtualWarehouseId: vwPick.id } : {}),
        },
      });
      ordersVw = '';
      ordersPlace = '';
      ordersPointId = '';
      ordersPoint = null;
      ordersPointText = '';
      ordersShipDate = '';
      const mp = supply.marketplace;
      let extra = '';
      if(mp && mp.mpSupplyId){
        extra = ' На WB создана поставка ' + mp.mpSupplyId + ': '
          + mp.confirmed.length + ' на сборке'
          + (mp.rejected && mp.rejected.length ? ', не принято ' + mp.rejected.length : '') + '.'
          // Про непринятые параметры отгрузки говорим сразу: без них WB не
          // возьмёт поставку в доставку, а узнать об этом у ворот — поздно.
          + (mp.shippingError ? ' Параметры отгрузки WB не принял: ' + mp.shippingError
            + '. Поправьте пункт и дату в кабинете WB.' : '');
      } else if(mp && mp.error){
        extra = ' WB не ответил: ' + mp.error + ' Состав поставки в Аргусе не менялся.';
      } else if(mp && mp.skipped === 'write_disabled'){
        extra = ' Статусы на WB не меняются — разрешите это в окне клиента («Клиенты» → клиент).';
      }
      showWhToast('Поставка ' + supply.number + ' передана на склад: ' + supply.orders
        + ' ' + pluralRu(supply.orders, 'заказ', 'заказа', 'заказов') + '.' + extra);
      await loadMpOrders();
    } catch(e){
      // Отказ сервера показываем целиком: в нём назван номер заказа,
      // из-за которого поставка не собралась, и это единственная подсказка,
      // что делать дальше.
      showWhToast('Не удалось собрать поставку: ' + e.message);
    } finally {
      supplyInFlight = false;
      renderPartnerOrders(companyId);
    }
  }
  window.makeSupply = makeSupply;

  async function setOrderLineVw(companyId, itemId, value, el){
    el.disabled = true;
    try{
      await apiFetch('/api/vwarehouses/items', { method: 'POST', body: { itemIds: [itemId], vw: value || null } });
      showWhToast('Склад строки заказа поменян — продавцу пришло уведомление «обратите внимание».');
    } catch(e){ showWhToast(e.message); }
    loadPartnerOrders(companyId);
  }
  window.setOrderLineVw = setOrderLineVw;

  /* ===================== Инициализация ===================== */

  // Стартовая вкладка открывается тем же путём, что и любая другая, а не
  // классом "active" в разметке: иначе всё, что должно случаться при открытии
  // вкладки, на первой из них молча не случается.
  // Разделы и внутренние вкладки доступны только по выданным правам.
  // Склад и ячейки менеджеру открывает владелец правом «склад» — решение
  // владельца от 17.09.2026. Сервер это же и проверяет (allowWarehouseView),
  // здесь пункты просто не показываем, чтобы кабинет не стучал в закрытую
  // дверь и не сыпал отказами.
  const CAN_WAREHOUSE = !IS_MANAGER || (authPayload.grants || []).includes('warehouse');
  if(IS_MANAGER){
    // Разделы по выданным правам (владелец 04.10.2026): галочка открывает
    // раздел, а не только разрешает действие на сервере.
    const grants = authPayload.grants || [];
    const hidden = ['nav-chat'];
    if(!grants.includes('staff')) hidden.push('nav-staff');
    if(!grants.includes('clients') && !grants.includes('marketplaces')) hidden.push('nav-mp');
    if(!grants.includes('integration')) hidden.push('nav-settings');
    // Расчёты — право «Тариф и деньги».
    if(!(authPayload.grants || []).includes('billing')) hidden.push('nav-billing');
    hidden.forEach(id => {
      const el = document.getElementById(id);
      if(el) el.remove();
    });
    document.querySelectorAll('.nav-item').forEach(el => {
      if(el.textContent.trim() === 'Тариф') el.remove();
    });
  }

  mergePanes('stock', [{ id: 'products', title: 'Товары' }, { id: 'warehouse', title: 'Склады и ячейки' }, { id: 'inv', title: 'Инвентаризация' }]);
  mergePanes('inbound', [{ id: 'receipts', title: 'Приходы' }, { id: 'acts', title: 'Акты' }]);
  mergePanes('configuration', [{ id: 'settings', title: 'Работа склада' }, { id: '1c', title: 'Подключение 1С' }]);
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.addEventListener('keydown', event => {
      if(event.key === 'Enter' || event.key === ' '){ event.preventDefault(); el.click(); }
    });
  });

  // Заголовок раздела без единого пункта (у менеджера «Настройки») — лишний:
  // прячем его вместе с разделителем.
  document.querySelectorAll('.nav-label').forEach(label => {
    let el = label.nextElementSibling;
    let has = false;
    while(el && !el.classList.contains('nav-label') && !el.classList.contains('nav-sep')){
      if(el.classList.contains('nav-item')) has = true;
      el = el.nextElementSibling;
    }
    if(!has){
      const sep = label.previousElementSibling;
      if(sep && sep.classList.contains('nav-sep')) sep.remove();
      label.remove();
    }
  });

  switchView('home');
  renderLogoTargets();

  loadWarehouseInfo();
  loadCompanies().then(loadInvoicesList);
  loadJournal(true).then(startJournalPolling);
  if(CAN_WAREHOUSE) loadInventory();
  if(!IS_MANAGER){
    loadStaff();
    refreshAlertBadge();
    load1CKey();
    load1CStatus();
    loadMarketplaces();
  }

  if(CAN_WAREHOUSE) apiFetch('/api/cells/rows').then(rows => {
    // Общее место «Склад» — тоже повод показать карту: в нём лежит товар.
    if(rows.length > 0){
      document.getElementById('whOnboarding').style.display = 'none';
      renderWarehouseMap();
    }
  }).catch(() => {});
