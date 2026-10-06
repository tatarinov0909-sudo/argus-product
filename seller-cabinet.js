'use strict';
// Кабинет продавца. Собран заново 26.09.2026 по замечаниям владельца:
// фулфилмент в шапке вместо «Продавец / Товары», пять чисел по центру
// (добавлено «В пути»), свои выпадающие списки вместо браузерных, фильтры по
// вероятности использования, выбор столбцов, «Показать ещё» вместо страниц,
// оформленный Excel только там, где он нужен (товары, возвраты, заказы),
// приходы отдельно от возвратов (возвраты — в «Товарах»), вкладка «Брак».
(() => {
  const $ = (id) => document.getElementById(id);
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const n = (v) => Number(v || 0).toLocaleString('ru-RU');
  const plural = new Intl.PluralRules('ru');
  const counted = (value, one, few, many) => n(value) + ' ' + ({ one, few, many, other: many }[plural.select(Number(value))]);
  const clock = (d) => new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const day = (d) => {
    const x = new Date(d);
    return x.toLocaleDateString('ru-RU', x.getFullYear() === new Date().getFullYear()
      ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const when = (d) => (d ? day(d) + ', ' + clock(d) : '—');
  const dateOnly = (iso) => (iso ? new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso) : null);

  const PATHS = {
    more: 'M5 12h.01M12 12h.01M19 12h.01', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9v-2a7 7 0 0 1 14 0v2',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-2-6h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1 1-3',
    photo: 'M3 3h18v18H3V3Zm0 13 6-6 5 5 3-3 4 4M15 7h.01', box: 'M12 3 3 8v9l9 5 9-5V8l-9-5Zm0 9v10M3 8l9 4 9-4M7.5 5.5l9 5V15',
    orders: 'M8 4h12v17H4V4h4m0-2h8v4H8V2Zm0 9h8m-8 5h6', document: 'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h6',
    truck: 'M2 6h12v10H2zM14 9h4l4 4v3h-8M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    inbox: 'M3 13h5l2 3h4l2-3h5M3 13l3-8h12l3 8v6H3v-6Z', alert: 'M12 3 2 20h20L12 3Zm0 7v4m0 3v.01',
    logout: 'M9 4H4v16h5m5-12 4 4-4 4m-6-4h10', refresh: 'M20 7v5h-5M20 12a8 8 0 1 0-2.34 5.66',
    download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', close: 'm6 6 12 12M6 18 18 6',
    search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6', info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 7v6m0-9v.1',
    wallet: 'M3 7h18v13H3V7Zm0 0 3-4h12l3 4M16 13.5h2', check: 'm5 12 4 4L19 6', chevron: 'm6 9 6 6 6-6', columns: 'M4 4h16v16H4zM10 4v16M16 4v16', left: 'm14 5-7 7 7 7',
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[name] || PATHS.box}"/></svg>`;
  const paintIcons = (root = document) => root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

  const NAV = [['products', 'Товары', 'box'], ['orders', 'Заказы', 'orders'], ['supplies', 'Поставки на WB', 'truck'],
    ['documents', 'Приходы', 'inbox'], ['defects', 'Склад брака', 'alert'], ['billing', 'Расчёты', 'wallet']];
  const PAGES = {
    products: { title: 'Товары', subtitle: 'Сколько вашего товара на складе и сколько можно продавать.', data: 'stock', nav: 'products' },
    returns: { title: 'Товары', subtitle: 'Что вернулось на склад и в каком состоянии.', data: 'documents', nav: 'products' },
    wb: { title: 'Товары', subtitle: 'Все ваши склады на Wildberries — отметьте, товар для каких лежит у этого фулфилмента.', data: 'wb', nav: 'products' },
    orders: { title: 'Заказы', subtitle: 'Как склад готовит ваши заказы с Wildberries.', data: 'orders', nav: 'orders' },
    supplies: { title: 'Поставки на WB', subtitle: 'Склад собирает их из ваших заказов и везёт на Wildberries.', data: 'supplies', nav: 'supplies' },
    documents: { title: 'Приходы', subtitle: 'Товар, который вы привозите на склад на хранение.', data: 'documents', nav: 'documents' },
    defects: { title: 'Склад брака', subtitle: 'Ваш брак лежит отдельно от товара в продаже. Решите, что с ним делать, — склад выполнит.', data: 'defects', nav: 'defects' },
    // Заглушка (владелец 27.09.2026): расчёт за хранение и упаковку появится,
    // когда склад утвердит прайс. Данных у страницы пока нет.
    billing: { title: 'Расчёты', subtitle: 'Сколько стоит работа склада с вашим товаром.', data: null, nav: 'billing' },
  };
  const API_PATH = { stock: '/api/sellers/stock', orders: '/api/sellers/orders', supplies: '/api/sellers/supplies',
    documents: '/api/sellers/documents', defects: '/api/sellers/defects', wb: '/api/sellers/wb-warehouses' };

  const blankUi = () => ({ q: '', shown: 0 });
  const state = {
    token: localStorage.getItem('argus_token'), role: localStorage.getItem('argus_role'),
    owner: ['owner', 'manager'].includes(localStorage.getItem('argus_role')),
    companyId: null, profile: null, catalog: {}, companies: [],
    prefs: { rows: 30, textSize: 'normal' },
    data: {}, summary: null, fetchedAt: {}, view: 'products', viewRun: 0, drawerRun: 0,
    ui: {
      products: { ...blankUi(), stock: 'all', orders: 'all', sort: 'name', extra: new Set(), category: 'all', vw: 'all' },
      returns: { ...blankUi(), status: 'all', quality: 'all', period: 'all' },
      wb: { ...blankUi(), confirm: null },
      orders: { ...blankUi(), status: 'all', period: 'all', supply: 'all', wbwh: new Set(), sort: 'new' },
      supplies: { ...blankUi(), status: 'all', dest: 'all', period: 'all', sort: 'new' },
      documents: { ...blankUi(), status: 'all', diff: 'all', period: 'all', sort: 'new' },
      defects: { ...blankUi(), source: 'all', kind: 'all', period: 'all' },
    },
  };

  let toastTimer;
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000); }
  const loading = '<div class="loading-inline" role="status"><span class="spinner"></span>Загружаем…</div>';
  const empty = (title, text, kind = 'box') => `<div class="empty">${icon(kind)}<h2>${h(title)}</h2><p>${h(text)}</p></div>`;
  const notice = (title, text, warn = false) => `<div class="notice ${warn ? 'warning' : ''}">${icon('info')}<div><strong>${h(title)}</strong><p>${h(text)}</p></div></div>`;
  const badge = (text, style = '') => `<span class="badge ${style}">${h(text)}</span>`;

  // ---------- Сервер ----------
  // Продлённый вход берём, только если он того же человека: чужой (из кэша
  // браузера или от другой вкладки) подменил бы вход (27.09.2026).
  const jwtOf = (t) => { try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))); } catch { return {}; } };
  const sameUser = (a, b) => {
    const x = jwtOf(a || ''); const y = jwtOf(b || ''); const id = (p) => p.staffKeyId || p.sellerKeyId || p.ownerId || '';
    return !!x.role && x.role === y.role && id(x) === id(y) && x.warehouseId === y.warehouseId;
  };
  async function api(path, options = {}) {
    if (state.owner && state.companyId && (path.startsWith('/api/sellers/') || path.startsWith('/api/vwarehouses'))) path += (path.includes('?') ? '&' : '?') + 'companyId=' + encodeURIComponent(state.companyId);
    const response = await fetch('https://api.argus-ai.online' + path, {
      method: options.method || 'GET', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => null);
    const renewed = response.headers.get('X-Argus-Token');
    if (renewed && sameUser(renewed, state.token)) {
      if (sameUser(localStorage.getItem('argus_token'), state.token)) localStorage.setItem('argus_token', renewed);
      state.token = renewed;
    }
    if (response.status === 401 && !path.includes('/auth/')) {
      state.viewRun += 1; state.drawerRun += 1; state.token = null;
      localStorage.removeItem('argus_token'); localStorage.removeItem('argus_role');
      document.querySelectorAll('dialog[open]').forEach((d) => d.close());
      $('app').hidden = true; $('loginScreen').hidden = false; $('loginError').textContent = 'Сессия завершилась. Войдите ещё раз.';
    }
    if (!response.ok) throw new Error(data?.error || 'Не удалось получить данные. Попробуйте ещё раз.');
    return data;
  }

  // ---------- Свой выпадающий список ----------
  // Вместо браузерного <select>: у того двойная рамка, стрелка у края и
  // квадратное поле выбора — владелец назвал это «работой нейросети».
  // options: [{ value, text }] или { group: 'Заголовок' }; для multi value — Set.
  const dropdowns = new Map();
  // neutral — список, который не фильтр (выбор столбцов): без отметки
  // «фильтр включён» и без счётчика.
  function dropdown(key, { label, value, options, multi = false, onPick, showValue = true, neutral = false }) {
    dropdowns.set(key, { onPick, multi });
    const selected = (v) => (multi ? value.has(v) : v === value);
    const choices = options.filter((o) => !o.group);
    const current = multi ? '' : (choices.find((o) => o.value === value)?.text || '');
    const active = !neutral && (multi ? value.size > 0 : choices.length > 0 && value !== choices[0].value);
    return `<div class="dd${multi ? ' dd-multi' : ''}${active ? ' active' : ''}" data-dd="${h(key)}">`
      + `<button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false">`
      + (label ? `<span class="dd-label">${h(label)}</span>` : '')
      + (multi ? (value.size && !neutral ? `<span class="dd-count">${value.size}</span>` : '')
        : showValue ? `<span class="dd-value">${h(current)}</span>` : '')
      + `${icon('chevron', 'dd-chev')}</button>`
      + `<div class="dd-menu" role="listbox"${multi ? ' aria-multiselectable="true"' : ''} hidden>`
      + options.map((o) => (o.group ? `<div class="dd-group">${h(o.group)}</div>`
        : `<button type="button" class="dd-option" role="option" data-value="${h(o.value)}" aria-selected="${selected(o.value)}"><span class="dd-mark">${icon('check')}</span><span>${h(o.text)}</span></button>`)).join('')
      + '</div></div>';
  }
  function closeMenus(except) {
    document.querySelectorAll('.dd.open').forEach((dd) => {
      if (dd === except) return;
      dd.classList.remove('open'); dd.querySelector('.dd-menu').hidden = true;
      dd.querySelector('.dd-btn').setAttribute('aria-expanded', 'false');
    });
  }
  function openMenu(dd, focusValue) {
    closeMenus(dd);
    const menu = dd.querySelector('.dd-menu');
    dd.classList.add('open'); menu.hidden = false; menu.classList.remove('right');
    dd.querySelector('.dd-btn').setAttribute('aria-expanded', 'true');
    if (menu.getBoundingClientRect().right > innerWidth - 8) menu.classList.add('right');
    const target = (focusValue != null && [...menu.querySelectorAll('.dd-option')].find((o) => o.dataset.value === focusValue))
      || menu.querySelector('.dd-option[aria-selected=true]') || menu.querySelector('.dd-option');
    target?.focus({ preventScroll: true });
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.dd-btn');
    if (btn) { const dd = btn.closest('.dd'); if (dd.classList.contains('open')) closeMenus(); else openMenu(dd); return; }
    const opt = e.target.closest('.dd-option');
    if (opt) {
      const dd = opt.closest('.dd'); const key = dd.dataset.dd; const cfg = dropdowns.get(key);
      if (!cfg) return;
      if (cfg.multi) {
        cfg.onPick(opt.dataset.value);
        // Список перерисовался — открываем меню снова на том же пункте.
        const again = document.querySelector(`.dd[data-dd="${CSS.escape(key)}"]`);
        if (again) openMenu(again, opt.dataset.value);
      } else { closeMenus(); cfg.onPick(opt.dataset.value); }
      return;
    }
    if (!e.target.closest('.dd-menu')) closeMenus();
  });
  document.addEventListener('keydown', (e) => {
    const dd = e.target.closest?.('.dd');
    if (!dd) return;
    if (e.key === 'Escape' && dd.classList.contains('open')) { e.preventDefault(); closeMenus(); dd.querySelector('.dd-btn').focus(); return; }
    if (e.key === 'ArrowDown' && !dd.classList.contains('open')) { e.preventDefault(); openMenu(dd); return; }
    if (!dd.classList.contains('open') || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const opts = [...dd.querySelectorAll('.dd-option')]; const at = opts.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? opts.length - 1 : Math.max(0, Math.min(opts.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
    opts[next]?.focus();
  });
  document.addEventListener('focusout', (e) => {
    const dd = e.target.closest?.('.dd');
    if (dd && dd.classList.contains('open') && !dd.contains(e.relatedTarget) && e.relatedTarget) closeMenus();
  });

  // ---------- Настройки и столбцы (в этом браузере) ----------
  const prefKey = (what) => `argus_seller_${what}:${state.profile?.id || 'x'}`;
  function readPref(what, fallback) { try { return JSON.parse(localStorage.getItem(prefKey(what)) || 'null') ?? fallback; } catch { return fallback; } }
  function writePref(what, value) { try { localStorage.setItem(prefKey(what), JSON.stringify(value)); } catch { /* приватное окно */ } }
  function loadPreferences() {
    const p = readPref('preferences', {});
    state.prefs.rows = [15, 30, 50, 100].includes(p.rows) ? p.rows : 30;
    state.prefs.textSize = p.textSize === 'large' ? 'large' : 'normal';
    document.body.classList.toggle('larger-table-text', state.prefs.textSize === 'large');
  }
  // Какие столбцы показывать — человек выбирает сам (владелец 26.09.2026).
  function visibleColumns(view, columns) {
    const hidden = new Set(readPref('hidden_' + view, columns.filter((c) => c.hidden).map((c) => c.key)));
    return columns.filter((c) => c.locked || !hidden.has(c.key));
  }
  function columnChooser(view, columns, rerender) {
    const hidden = new Set(readPref('hidden_' + view, columns.filter((c) => c.hidden).map((c) => c.key)));
    const shown = new Set(columns.filter((c) => !c.locked && !hidden.has(c.key)).map((c) => c.key));
    return dropdown('cols-' + view, {
      label: 'Столбцы', multi: true, neutral: true, value: shown,
      options: columns.filter((c) => !c.locked).map((c) => ({ value: c.key, text: c.title })),
      onPick: (key) => {
        if (hidden.has(key)) hidden.delete(key); else hidden.add(key);
        writePref('hidden_' + view, [...hidden]); rerender();
      },
    });
  }
  // Таблица по описанию столбцов.
  function table(columns, rows, { rowAttrs = () => '' } = {}) {
    return `<div class="table-wrap"><table class="grid"><thead><tr>${columns.map((c) => `<th class="${c.cls || ''}">${h(c.title)}</th>`).join('')}</tr></thead>`
      // data-label — подпись значения, когда на телефоне строка становится карточкой.
      + `<tbody>${rows.map((r) => `<tr ${rowAttrs(r)}>${columns.map((c, i) => `<td class="${c.cls || ''}${c.main || (i === 0 && !c.cls) ? ' main' : ''}" data-label="${h(c.title)}"><div class="cv">${c.cell(r)}</div></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  // «Показать ещё» вместо страниц (владелец 26.09.2026).
  function moreFooter(ui, total, noun) {
    const shown = Math.min(ui.shown, total);
    return `<div class="table-foot"><span>Показано ${n(shown)} из ${counted(total, ...noun)}</span>`
      + (shown < total ? `<button class="button" data-more>Показать ещё ${n(Math.min(state.prefs.rows, total - shown))}</button>` : '') + '</div>';
  }
  // Смещение пояса от UTC сейчас, мс.
  const zoneOffset = (zone) => {
    try {
      const now = new Date(); now.setMilliseconds(0);
      const local = new Date(now.toLocaleString('en-US', { timeZone: zone }));
      const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
      return local - utc;
    } catch { return 3 * 3600e3; }
  };
  const inPeriod = (iso, period) => {
    if (period === 'all' || !iso) return period === 'all';
    // День — по поясу склада (настройки склада), а не по часам компьютера
    // продавца: у продавца в Новосибирске «сегодня» наступало на 4 часа раньше.
    const t = new Date(iso).getTime(); const OFF = zoneOffset(state.profile?.timezone || 'Europe/Moscow');
    const start = Math.floor((Date.now() + OFF) / 864e5) * 864e5 - OFF;
    if (period === 'today') return t >= start;
    if (period === 'yesterday') return t >= start - 864e5 && t < start;
    if (period === '7d') return t >= Date.now() - 7 * 864e5;
    if (period === '30d') return t >= Date.now() - 30 * 864e5;
    return true;
  };
  const PERIODS = [{ value: 'all', text: 'За всё время' }, { value: 'today', text: 'Сегодня' }, { value: 'yesterday', text: 'Вчера' },
    { value: '7d', text: 'Последние 7 дней' }, { value: '30d', text: 'Последние 30 дней' }];
  // Панель над таблицей: сверху поиск и действия справа, под ними фильтры.
  const toolbar = (search, filters, actions = '') => `<div class="toolbar">${search}<div class="toolbar-end">${actions}</div></div>`
    + (filters ? `<div class="filters">${filters}</div>` : '');
  const searchBox = (placeholder, value) => `<label class="search">${icon('search')}<input type="search" data-search value="${h(value)}" placeholder="${h(placeholder)}" aria-label="${h(placeholder)}"></label>`;
  const matches = (q, values) => { const s = q.trim().toLocaleLowerCase('ru-RU'); return !s || values.some((v) => String(v ?? '').toLocaleLowerCase('ru-RU').includes(s)); };

  // ---------- Excel ----------
  // Оформленный файл (владелец 26.09.2026): заголовок, кто и когда выгрузил и
  // по какому фильтру, шапка с фильтром и закреплением, ширина столбцов по
  // содержимому, числа числами, итоги, ссылки на карточки WB.
  let excelReady = null;
  function loadExcel() {
    if (window.ExcelJS) return Promise.resolve();
    if (!excelReady) {
      excelReady = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
        s.integrity = 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz';
        s.crossOrigin = 'anonymous';
        s.onload = resolve;
        s.onerror = () => { excelReady = null; reject(new Error('Не загрузился модуль Excel. Проверьте интернет и повторите.')); };
        document.head.appendChild(s);
      });
    }
    return excelReady;
  }
  async function exportExcel({ file, sheet, title, filterText, columns, rows }) {
    if (!rows.length) { toast('Нечего выгружать: по фильтру ничего не найдено.'); return; }
    await loadExcel();
    const wb = new window.ExcelJS.Workbook(); wb.creator = 'Аргус'; wb.created = new Date();
    const ws = wb.addWorksheet(sheet, { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const last = columns.length; const head = 4;
    const thin = { style: 'thin', color: { argb: 'FFD3D8E4' } };
    ws.mergeCells(1, 1, 1, last); ws.getCell(1, 1).value = title;
    ws.getCell(1, 1).font = { bold: true, size: 14 };
    ws.mergeCells(2, 1, 2, last);
    ws.getCell(2, 1).value = [`Фулфилмент ${state.profile.warehouseName || ''}`.trim(), `выгружено ${new Date().toLocaleDateString('ru-RU')} в ${clock(new Date())}`, filterText].filter(Boolean).join(' · ');
    ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF6B7385' } };
    ws.getRow(1).height = 22;
    const hr = ws.getRow(head); hr.height = 34;
    columns.forEach((c, i) => {
      const cell = hr.getCell(i + 1); cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FF1B2233' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6EAF8' } };
      cell.alignment = { vertical: 'middle', horizontal: c.type === 'text' ? 'left' : 'center', wrapText: true };
      cell.border = { top: thin, bottom: { style: 'medium', color: { argb: 'FF9AA3BC' } }, left: thin, right: thin };
    });
    rows.forEach((r, k) => {
      const row = ws.getRow(head + 1 + k);
      columns.forEach((c, i) => {
        const cell = row.getCell(i + 1); const v = c.get(r, k);
        if (c.type === 'num') { cell.value = v == null || v === '' ? null : Number(v); cell.numFmt = c.money ? '#,##0.00' : '#,##0'; }
        // Excel не знает часовых поясов: пишем время таким, каким его видит человек.
        else if (c.type === 'date') { const d = v ? new Date(v) : null; cell.value = d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000) : null; cell.numFmt = c.dayOnly ? 'dd.mm.yyyy' : 'dd.mm.yyyy hh:mm'; }
        else if (c.type === 'link') { cell.value = v ? { text: 'Открыть на WB', hyperlink: v } : null; cell.font = { color: { argb: 'FF3355CC' }, underline: true }; }
        else cell.value = v == null ? '' : String(v);
        cell.alignment = { vertical: 'middle', horizontal: c.type === 'text' ? 'left' : 'center', wrapText: c.type === 'text' };
        cell.border = { top: thin, bottom: thin, left: thin, right: thin };
        if (k % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8FC' } };
      });
    });
    if (columns.some((c) => c.total)) {
      const row = ws.getRow(head + 1 + rows.length);
      columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        // Если у части строк число неизвестно, итог — «—», как в кабинете, а не
        // сумма, где неизвестное посчитано нулём.
        const unknown = c.total && rows.some((r, k) => c.get(r, k) == null);
        cell.value = i === 0 ? 'Итого' : !c.total ? null : unknown ? '—' : rows.reduce((s, r, k) => s + Number(c.get(r, k) || 0), 0);
        if (c.total) cell.numFmt = c.money ? '#,##0.00' : '#,##0';
        cell.font = { bold: true };
        cell.alignment = { vertical: 'middle', horizontal: i === 0 || c.type === 'text' ? 'left' : 'center' };
        cell.border = { top: { style: 'medium', color: { argb: 'FF9AA3BC' } }, bottom: thin, left: thin, right: thin };
      });
    }
    columns.forEach((c, i) => {
      const lens = rows.map((r, k) => { const v = c.get(r, k); return c.type === 'date' ? 16 : c.type === 'link' ? 14 : String(v ?? '').length; });
      const longest = Math.max(...String(c.header).split(' ').map((w) => w.length), ...lens);
      ws.getColumn(i + 1).width = Math.max(c.min || 8, Math.min(c.max || 48, longest + 3));
    });
    ws.views = [{ state: 'frozen', ySplit: head }];
    ws.autoFilter = { from: { row: head, column: 1 }, to: { row: head + rows.length, column: last } };
    ws.pageSetup.printTitlesRow = `${head}:${head}`;
    await saveXlsx(wb, file);
  }
  async function saveXlsx(wb, file) {
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `${file} — ${state.profile.name} — ${new Date().toLocaleDateString('ru-RU')}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function runExport(button, job) {
    button.disabled = true; const text = button.innerHTML; button.innerHTML = '<span class="spinner"></span>Готовим файл…';
    try { await job(); } catch (e) { toast(e.message); } finally { button.disabled = false; button.innerHTML = text; }
  }
  const excelButton = `<button class="button" type="button" data-excel>${icon('download')}Excel</button>`;

  // ---------- Каталог и общие данные товара ----------
  const meta = (sku) => state.catalog[sku] || { category: 'Без категории', cards: [] };
  const wbIds = (sku) => [...new Set(meta(sku).cards.map((c) => c.nmId).filter(Boolean))];
  const vendorCodes = (sku) => [...new Set(meta(sku).cards.map((c) => c.vendorCode).filter(Boolean))];
  const productName = (r) => (r.name?.startsWith('Не сопоставлен с номенклатурой:') ? 'Товар WB ' + (r.mp_nm_id || wbIds(r.sku)[0] || 'без названия') : r.name);
  function photoUrl(sku, nmId) {
    const cards = meta(sku).cards;
    const card = nmId ? cards.find((c) => String(c.nmId) === String(nmId)) : cards.find((c) => c.photoUrl) || cards[0];
    const url = card?.photoUrl;
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' && !u.username && ['wbbasket.ru', 'wbstatic.net', 'wildberries.ru'].some((d) => u.hostname === d || u.hostname.endsWith('.' + d))) return u.href;
    } catch { /* нет фото */ }
    return null;
  }
  const photo = (sku, nmId) => { const url = photoUrl(sku, nmId); return `<span class="photo" role="img" aria-label="${url ? 'Фото товара' : 'Фото нет'}">${icon('photo')}${url ? `<img src="${h(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</span>`; };
  const wirePhotos = (root) => root.querySelectorAll('.photo img').forEach((img) => { img.onerror = () => img.remove(); if (img.complete && !img.naturalWidth) img.remove(); });
  const wbLink = (nm) => (nm ? `https://www.wildberries.ru/catalog/${encodeURIComponent(nm)}/detail.aspx` : null);
  const idCell = (nmList, barcode) => `<span class="cell-main wb-id">${nmList.length ? h(nmList.join(', ')) : '<span class="muted">не передан</span>'}</span><span class="cell-label">Штрихкод</span><span class="cell-sub">${h(barcode || 'не передан')}</span>`;
  const num = (v, strong = false) => (v == null ? '<span class="zero">—</span>' : `<span class="${strong ? 'strong-num' : Number(v) === 0 ? 'zero' : ''}">${n(v)}</span>`);

  // ---------- Вход, запуск, меню ----------
  function renderNav() {
    const counts = { orders: state.data.orders ? new Set(state.data.orders.rows.filter(orderActive).map((r) => r.id)).size : 0,
      defects: defectAttention(),
      documents: state.data.documents ? state.data.documents.rows.filter((r) => r.direction === 'in' && awaitsVerdict(r)).length : 0 };
    const current = PAGES[state.view]?.nav;
    document.querySelectorAll('[data-nav-list]').forEach((host) => {
      host.innerHTML = NAV.map(([key, title, ico]) => `<a href="#${key}" ${key === current ? 'aria-current="page"' : ''}>${icon(ico)}<span>${h(title)}</span>${counts[key] ? `<span class="nav-count">${n(counts[key])}</span>` : ''}</a>`).join('');
    });
  }
  async function boot() {
    // Роль в самом входе должна совпадать с подписью (27.09.2026): иначе
    // кабинет работал бы чужим входом из соседней вкладки.
    if (state.token && jwtOf(state.token).role !== (state.owner ? state.role : 'seller')) {
      state.token = null; localStorage.removeItem('argus_token'); localStorage.removeItem('argus_role');
    }
    if (!state.token) { $('loginScreen').hidden = false; return; }
    $('loginScreen').hidden = true; $('app').hidden = false; $('view').innerHTML = loading;
    try {
      if (state.owner) {
        // Владелец склада смотрит кабинет продавца его глазами. Вместо
        // оранжевой полосы — переключатель продавца в шапке и путь к складу.
        state.companies = (await api('/api/sellers/companies')).map((c) => ({ id: c.id, name: c.name }));
        if (!state.companies.length) { $('view').innerHTML = empty('Продавцов пока нет', 'Заведите продавца в кабинете склада — его кабинет появится здесь.'); return; }
        const wanted = new URLSearchParams(location.search).get('companyId');
        state.companyId = (state.companies.find((c) => c.id === wanted) || state.companies[0]).id;
        renderOwnerSwitch();
      }
      state.profile = await api('/api/sellers/profile'); loadPreferences();
      // Склады продавца нужны не только «Товарам»: привозу, карточке прихода.
      try { state.vw = await loadVw(); } catch { state.vw = null; }
      try { const catalog = await api('/api/sellers/catalog'); state.catalog = Object.fromEntries(catalog.products.map((r) => [r.sku, r])); }
      catch { toast('Не удалось загрузить артикулы WB. Обновите страницу.'); }
      $('companyName').textContent = state.profile.name;
      $('companyAvatar').textContent = state.profile.name.trim().slice(0, 2).toUpperCase();
      $('warehouseName').textContent = state.profile.warehouseName || localStorage.getItem('argus_wh_name') || 'Ваш склад';
      document.title = state.profile.name + ' · Аргус';
      await navigate();
    } catch (e) {
      if (!state.token) return;
      $('view').innerHTML = empty('Не удалось открыть кабинет', e.message) + '<div style="text-align:center"><button class="button" id="bootRetry">Попробовать ещё раз</button></div>';
      $('bootRetry').onclick = () => { $('view').innerHTML = loading; boot(); };
    }
  }
  function renderOwnerSwitch() {
    const host = $('ownerSwitch'); host.hidden = false;
    host.innerHTML = dropdown('owner-company', {
      label: 'Продавец', value: state.companyId, options: state.companies.map((c) => ({ value: c.id, text: c.name })),
      onPick: (id) => { const u = new URL(location.href); u.searchParams.set('companyId', id); location.href = u.href; },
    }) + '<a href="cabinet_main.html">← К складу</a>';
  }
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('loginError').textContent = ''; $('loginSubmit').disabled = true;
    try {
      const data = await api('/api/auth/seller/login', { method: 'POST', body: { name: $('loginName').value.trim(), keyCode: $('loginKey').value.trim() } });
      localStorage.setItem('argus_token', data.token); localStorage.setItem('argus_role', 'seller');
      localStorage.setItem('argus_company_name', data.companyName || ''); localStorage.setItem('argus_wh_name', data.warehouseName || '');
      history.replaceState(null, '', 'client_access.html#products'); location.reload();
    } catch (error) { $('loginError').textContent = error.message; $('loginSubmit').disabled = false; }
  });
  function logout() {
    for (const k of ['argus_token', 'argus_role', 'argus_company_name', 'argus_seller_name', 'argus_wh_name']) localStorage.removeItem(k);
    history.replaceState(null, '', 'client_access.html'); location.reload();
  }
  $('logoutButton').onclick = logout;
  let accountTrigger = $('accountButton');
  function showAccount(e) {
    const menu = $('accountMenu'); accountTrigger = e.currentTarget;
    if (menu.matches(':popover-open')) { menu.hidePopover(); return; }
    menu.showPopover(); const rect = accountTrigger.getBoundingClientRect();
    menu.style.left = Math.max(10, Math.min(innerWidth - menu.offsetWidth - 10, rect.left)) + 'px';
    menu.style.top = (rect.top > menu.offsetHeight + 20 ? rect.top - menu.offsetHeight - 8 : rect.bottom + 8) + 'px';
  }
  $('accountButton').onclick = $('mobileAccount').onclick = showAccount;
  $('accountMenu').addEventListener('toggle', (e) => { for (const id of ['accountButton', 'mobileAccount']) $(id).setAttribute('aria-expanded', String(e.newState === 'open' && $(id) === accountTrigger)); });
  const draftPrefs = {};
  function renderSettings() {
    // Права склада (владелец 02.10.2026): одна галочка. Не стоит — склад сам
    // решает спорные ситуации с количеством, продавцу «обратите внимание».
    // Стоит — каждая такая ситуация ждёт решения продавца. Поставки, приёмку
    // и отгрузку склад ведёт всегда сам. Меняет только сам продавец.
    const rights = !state.owner && hasVw() ? `<div class="field"><span>Права склада — для всего вашего кабинета</span>`
      + `<label class="check-line"><input type="checkbox" id="rightForbid" ${draftPrefs.forbid ? 'checked' : ''}><span>Запретить складу решать без меня спорные ситуации с количеством`
      + `<small>Перенос товара между вашими складами, с какого склада списать недостачу при пересчёте и куда записать лишнее, расхождение приёмки по складам, с какого склада брак. Без галочки склад решает сам, а вам приходит уведомление «обратите внимание». С галочкой — каждый такой случай ждёт вашего решения. Составлять поставки, принимать и отгружать товар склад может всегда.</small></span></label></div>` : '';
    $('settingsFields').innerHTML = rights + `<div class="field"><span>Сколько строк показывать за раз</span>${dropdown('pref-rows', {
      label: 'Строк', value: String(draftPrefs.rows), options: [15, 30, 50, 100].map((v) => ({ value: String(v), text: String(v) })),
      onPick: (v) => { draftPrefs.rows = Number(v); renderSettings(); },
    })}</div><div class="field"><span>Размер текста в таблицах</span>${dropdown('pref-text', {
      label: 'Текст', value: draftPrefs.textSize, options: [{ value: 'normal', text: 'Крупный' }, { value: 'large', text: 'Очень крупный' }],
      onPick: (v) => { draftPrefs.textSize = v; renderSettings(); },
    })}</div>`;
  }
  $('accountSettings').onclick = () => {
    $('accountMenu').hidePopover(); Object.assign(draftPrefs, state.prefs);
    $('settingsCompany').textContent = state.profile.name + ' · фулфилмент ' + $('warehouseName').textContent;
    draftPrefs.forbid = state.vw?.rights?.decide === false;
    renderSettings(); $('settingsDialog').showModal();
  };
  $('settingsFields').addEventListener('change', (e) => { if (e.target.id === 'rightForbid') draftPrefs.forbid = e.target.checked; });
  $('closeSettings').onclick = () => $('settingsDialog').close();
  $('settingsForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!state.owner && hasVw() && draftPrefs.forbid !== (state.vw.rights?.decide === false)) {
      try { state.vw.rights = (await api('/api/vwarehouses/rights', { method: 'PATCH', body: { rights: { decide: !draftPrefs.forbid } } })).rights; }
      catch (err) { toast('Права склада не сохранились: ' + err.message); return; }
    }
    const { forbid, ...prefs } = draftPrefs;
    writePref('preferences', prefs); loadPreferences();
    Object.values(state.ui).forEach((ui) => { ui.shown = 0; });
    $('settingsDialog').close(); navigate(); toast('Настройки сохранены');
  };

  // ---------- Переходы ----------
  async function navigate(refresh = false) {
    if (!state.profile || !state.token) return;
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    closeMenus();
    const name = location.hash.slice(1); state.view = PAGES[name] ? name : 'products';
    const page = PAGES[state.view]; const run = ++state.viewRun;
    $('pageTitle').textContent = page.title; $('pageSubtitle').textContent = page.subtitle;
    renderNav();
    $('view').setAttribute('aria-busy', 'true'); $('refreshButton').disabled = true;
    if (!page.data) { renderBilling(); $('view').setAttribute('aria-busy', 'false'); $('refreshButton').disabled = false; return; }
    if (refresh || !state.data[page.data]) $('view').innerHTML = '<div class="skeleton skeleton-strip"></div>' + '<div class="skeleton skeleton-row"></div>'.repeat(5);
    try {
      const key = page.data;
      if (refresh) { try { const c = await api('/api/sellers/catalog'); if (run !== state.viewRun) return; state.catalog = Object.fromEntries(c.products.map((r) => [r.sku, r])); } catch { toast('Каталог не обновился — показаны прошлые данные.'); } }
      if (refresh || !state.data[key]) {
        const payload = await api(API_PATH[key] + (key === 'stock' && state.owner ? '?view=seller' : ''));
        if (key === 'stock') {
          state.data.stock = payload.rows || []; state.summary = payload.summary || null;
          // Склады WB и выставленное на WB — дополнение: не загрузились — остатки всё равно показываем.
          try { state.data.wb = await api(API_PATH.wb); state.fetchedAt.wb = new Date(); } catch { state.data.wb = null; }
          // Склады продавца, уведомления склада и переносы — дополнение тоже.
          if (refresh || !state.vw) { try { state.vw = await loadVw(); } catch { state.vw = null; } }
        }
        else if (key === 'supplies') { state.data.supplies = payload.rows || []; state.suppliesMore = !!payload.hasMore; }
        else state.data[key] = payload;
        state.fetchedAt[key] = new Date();
      }
      if (!state.data.orders && key !== 'orders') api(API_PATH.orders).then((o) => { state.data.orders = o; state.fetchedAt.orders = new Date(); renderNav(); }).catch(() => {});
      // Приходы и брак — для «Нужен ваш ответ» и чисел в меню.
      ['documents', 'defects'].forEach((k) => {
        if (!state.data[k] && key !== k) api(API_PATH[k]).then((d) => { if (state.data[k]) return; state.data[k] = d; state.fetchedAt[k] = new Date(); renderNav(); refreshNeedAnswer(); }).catch(() => {});
      });
      if (run !== state.viewRun) return;
      const ui = state.ui[state.view]; if (!ui.shown) ui.shown = state.prefs.rows;
      ({ products: renderProducts, returns: renderReturns, wb: renderWb, orders: renderOrders, supplies: renderSupplies, documents: renderDocuments, defects: renderDefects })[state.view]();
      renderNav();
      $('updateTime').textContent = 'Обновлено в ' + clock(state.fetchedAt[key]);
    } catch (e) {
      if (run === state.viewRun && state.token) { $('view').innerHTML = empty('Данные не загрузились', e.message) + '<div style="text-align:center"><button class="button" id="retryLoad">Повторить</button></div>'; $('retryLoad').onclick = () => navigate(true); }
    } finally { if (run === state.viewRun) { $('view').setAttribute('aria-busy', 'false'); $('refreshButton').disabled = false; } }
  }
  window.addEventListener('hashchange', () => navigate());
  $('refreshButton').onclick = () => navigate(true);

  // Общая обвязка раздела: поиск перерисовывает только строки (курсор не
  // прыгает), «Показать ещё», Excel, сброс фильтров.
  function wireView(ui, renderAll, renderRows, exportJob) {
    const input = $('view').querySelector('[data-search]');
    if (input) input.oninput = (e) => { ui.q = e.target.value; ui.shown = state.prefs.rows; renderRows(); };
    const reset = $('view').querySelector('[data-reset]');
    if (reset) reset.onclick = () => { Object.assign(ui, state.defaults[state.view]()); ui.shown = state.prefs.rows; renderAll(); };
    const xl = $('view').querySelector('[data-excel]');
    if (xl && exportJob) xl.onclick = () => runExport(xl, exportJob);
  }
  function wireRows(host, ui, renderRows) {
    const more = host.querySelector('[data-more]');
    if (more) more.onclick = () => { ui.shown += state.prefs.rows; renderRows(); };
    wirePhotos(host);
  }
  state.defaults = {
    products: () => ({ q: '', stock: 'all', orders: 'all', sort: 'name', extra: new Set(), category: 'all', vw: 'all' }),
    returns: () => ({ q: '', status: 'all', quality: 'all', period: 'all' }),
    orders: () => ({ q: '', status: 'all', period: 'all', supply: 'all', wbwh: new Set(), sort: 'new' }),
    supplies: () => ({ q: '', status: 'all', dest: 'all', period: 'all', sort: 'new' }),
    documents: () => ({ q: '', status: 'all', diff: 'all', period: 'all', sort: 'new' }),
    defects: () => ({ q: '', source: 'all', kind: 'all', period: 'all' }),
  };
  const isDefault = (view) => { const d = state.defaults[view](); const ui = state.ui[view]; return Object.keys(d).every((k) => k === 'q' || (d[k] instanceof Set ? ui[k].size === 0 : ui[k] === d[k])); };
  const resetLink = (view) => (isDefault(view) ? '' : '<button type="button" class="reset-filters" data-reset>Сбросить фильтры</button>');
  const segment = (current) => `<nav class="segmented" aria-label="Товары">${[['products', 'Остатки'], ['returns', 'Возвраты'], ['wb', 'Склады WB']]
    .map(([k, t]) => `<a href="#${k}" ${current === k ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;

  // ---------- Товары: остатки ----------
  // Склады продавца (виртуальные склады, 02.10.2026): выбран склад — числа
  // по нему. «Заказано» и «В пути» склада не имеют: склад у заказа появляется
  // с поставкой.
  const hasVw = () => !!state.vw?.warehouses?.length;
  const vwKey = (id) => id || 'main';
  const vwOn = () => hasVw() && state.ui.products.vw !== 'all';
  const vwPart = (r) => (!vwOn() || !r.warehouses ? null
    : r.warehouses.find((w) => vwKey(w.id) === state.ui.products.vw) || { onHand: 0, inAssembly: 0, available: 0, defect: 0 });
  const total = (r) => { const w = vwPart(r); return w ? w.onHand : r.total ?? null; };
  const orderedQty = (r) => (vwPart(r) ? null : Number(r.ordered || 0));
  const assemblyQty = (r) => { const w = vwPart(r); return w ? w.inAssembly : Number(r.inAssembly || 0); };
  const transitQty = (r) => (vwPart(r) ? null : Number(r.inTransit || 0));
  const availableQty = (r) => { const w = vwPart(r); if (w) return w.available; return r.available == null ? null : Number(r.available); };
  const defectQty = (r) => { const w = vwPart(r); return w ? w.defect : Number(r.defective || 0); };
  const vwName = (id) => (id ? (state.vw?.warehouses || []).find((w) => w.id === id)?.name || 'убранный склад' : 'Остальной товар');
  const splitText = (r) => (r.warehouses || []).filter((w) => w.onHand).map((w) => w.name + ' ' + n(w.onHand)).join(' · ');
  // Доступно для WB: только «Основной» и склады WB — товар склада Озон на WB
  // не продаётся. Заказы WB без поставки ждут как раз этого товара.
  const wbAvailable = (r) => {
    if (!r.warehouses || !state.vw?.wbChoices) return r.available == null ? null : Number(r.available);
    const ids = new Set(state.vw.wbChoices.map((c) => vwKey(c.id)));
    const parts = r.warehouses.filter((w) => ids.has(vwKey(w.id)));
    if (parts.some((w) => w.available == null)) return null;
    return Math.max(0, parts.reduce((a, w) => a + w.available, 0) - Number(r.ordered || 0));
  };
  const isShort = (r) => r.shortage === true || (total(r) != null && orderedQty(r) + assemblyQty(r) > Number(total(r)));
  // Что стоит за числами (владелец 27.09.2026): нажал на «Заказано», «В сборке»
  // или «В пути» — видишь сами заказы. Какая строка под каким числом, решает
  // сервер тем же правилом, что и сами числа (bucket в /api/sellers/orders).
  const BUCKETS = {
    ordered: { title: 'Заказано', note: 'купили на WB, поставки ещё нет', get: orderedQty },
    assembly: { title: 'В сборке', note: 'в поставке у склада или товар уже отбирали', get: assemblyQty },
    transit: { title: 'В пути', note: 'уехало поставкой на WB, WB ещё не принял', get: transitQty },
  };
  const bucketNum = (r, bucket) => {
    const v = BUCKETS[bucket].get(r);
    return v > 0
      ? `<button type="button" class="num-link" data-bucket="${bucket}" data-bucket-sku="${h(r.sku)}" title="Какие это заказы">${n(v)}</button>`
      : num(v);
  };
  const PRODUCT_COLUMNS = [
    { key: 'photo', title: 'Фото', cls: 'w-photo', cell: (r) => photo(r.sku) },
    { key: 'name', title: 'Товар', locked: true, main: true, cell: (r) => `<button class="link-button" data-open-product="${h(r.sku)}">${h(productName(r))}</button>${vendorCodes(r.sku).length ? `<span class="cell-sub">Артикул продавца: ${h(vendorCodes(r.sku).join(', '))}</span>` : ''}${isShort(r) ? '<span class="row-note bad">Заказов больше, чем товара по учёту</span>' : ''}` },
    { key: 'wb', title: 'Артикул WB', cell: (r) => idCell(wbIds(r.sku), r.barcode) },
    { key: 'total', title: 'Всего', cls: 'n', cell: (r) => num(total(r)) },
    { key: 'ordered', title: 'Заказано', cls: 'n', cell: (r) => bucketNum(r, 'ordered') },
    { key: 'assembly', title: 'В сборке', cls: 'n', cell: (r) => bucketNum(r, 'assembly') },
    { key: 'transit', title: 'В пути', cls: 'n', cell: (r) => bucketNum(r, 'transit') },
    { key: 'available', title: 'Доступно', cls: 'n', cell: (r) => num(availableQty(r), true) },
    { key: 'wbStock', title: 'На WB', cls: 'n', cell: wbStockCell },
    { key: 'defective', title: 'Брак', cls: 'n', hidden: true, cell: (r) => num(defectQty(r)) },
    { key: 'vwsplit', title: 'По складам', cell: (r) => (splitText(r) ? h(splitText(r)) : '<span class="zero">—</span>') },
    { key: 'category', title: 'Категория', hidden: true, cell: (r) => h(meta(r.sku).category || '—') },
    { key: 'updated', title: 'Учёт на', cls: 'n', hidden: true, cell: (r) => (r.updatedAt ? h(when(r.updatedAt)) : '—') },
  ];
  const STOCK_FILTER = [{ value: 'all', text: 'Все товары' }, { value: 'available', text: 'Есть к продаже' }, { value: 'low', text: 'Заканчивается (≤ 5 шт.)' }, { value: 'none', text: 'Нет к продаже' }];
  const ORDERS_FILTER = [{ value: 'all', text: 'Любые' }, { value: 'any', text: 'Есть заказы' }, { value: 'ordered', text: 'Заказано, ждёт поставки' }, { value: 'assembly', text: 'В сборке' }, { value: 'transit', text: 'В пути на WB' }, { value: 'none', text: 'Без заказов' }];
  const SORTS = [{ value: 'name', text: 'По названию' }, { value: 'availDesc', text: 'Больше доступно' }, { value: 'availAsc', text: 'Меньше доступно' }, { value: 'ordersDesc', text: 'Больше заказов' }, { value: 'totalDesc', text: 'Больше всего на складе' }, { value: 'transitDesc', text: 'Больше в пути' }];
  // «По складам» — только когда склады заведены и выбраны «Все склады».
  const productColumns = () => PRODUCT_COLUMNS.filter((c) => c.key !== 'vwsplit' || (hasVw() && !vwOn()));
  const EXTRA = [{ value: 'shortage', text: 'Заказов больше, чем товара' }, { value: 'wbOver', text: 'На WB больше, чем доступно' }, { value: 'defect', text: 'Есть брак на складе' }, { value: 'withPhoto', text: 'С фото' }, { value: 'noPhoto', text: 'Без фото' }, { value: 'noWb', text: 'Без артикула WB' }, { value: 'unknown', text: 'Остаток ещё не получен' }];
  function filteredProducts() {
    const ui = state.ui.products;
    const rows = state.data.stock.filter((r) => {
      // Выбран склад — только товар, который на нём есть (лежит, в сборке или брак).
      const w = vwPart(r);
      if (w && !w.onHand && !w.inAssembly && !w.defect) return false;
      if (!matches(ui.q, [r.name, r.barcode, ...wbIds(r.sku), ...vendorCodes(r.sku), meta(r.sku).category])) return false;
      const avail = availableQty(r);
      if (ui.stock === 'available' && !(avail > 0)) return false;
      if (ui.stock === 'low' && !(avail > 0 && avail <= 5)) return false;
      // «Остаток ещё не получен» — не «нет к продаже»: для него свой фильтр.
      if (ui.stock === 'none' && (avail == null || avail > 0)) return false;
      const any = orderedQty(r) + assemblyQty(r);
      if (ui.orders === 'any' && !any) return false;
      if (ui.orders === 'ordered' && !orderedQty(r)) return false;
      if (ui.orders === 'assembly' && !assemblyQty(r)) return false;
      if (ui.orders === 'transit' && !transitQty(r)) return false;
      if (ui.orders === 'none' && any) return false;
      if (ui.category !== 'all' && (meta(r.sku).category || 'Без категории') !== ui.category) return false;
      const x = ui.extra;
      if (x.has('shortage') && !isShort(r)) return false;
      if (x.has('wbOver') && !wbOver(r)) return false;
      if (x.has('defect') && !defectQty(r)) return false;
      if (x.has('withPhoto') && !photoUrl(r.sku)) return false;
      if (x.has('noPhoto') && photoUrl(r.sku)) return false;
      if (x.has('noWb') && wbIds(r.sku).length) return false;
      if (x.has('unknown') && total(r) != null) return false;
      return true;
    });
    const by = {
      name: (a, b) => String(productName(a)).localeCompare(String(productName(b)), 'ru'),
      availDesc: (a, b) => (availableQty(b) ?? -1) - (availableQty(a) ?? -1),
      availAsc: (a, b) => (availableQty(a) ?? 1e12) - (availableQty(b) ?? 1e12),
      ordersDesc: (a, b) => (orderedQty(b) + assemblyQty(b)) - (orderedQty(a) + assemblyQty(a)),
      totalDesc: (a, b) => (total(b) ?? -1) - (total(a) ?? -1),
      transitDesc: (a, b) => transitQty(b) - transitQty(a),
    };
    return rows.sort((a, b) => by[ui.sort](a, b) || by.name(a, b));
  }
  function productsFilterText() {
    const ui = state.ui.products; const t = [];
    if (ui.q) t.push(`поиск «${ui.q}»`);
    if (ui.stock !== 'all') t.push(STOCK_FILTER.find((o) => o.value === ui.stock).text.toLowerCase());
    if (ui.orders !== 'all') t.push(ORDERS_FILTER.find((o) => o.value === ui.orders).text.toLowerCase());
    ui.extra.forEach((v) => t.push(EXTRA.find((o) => o.value === v).text.toLowerCase()));
    if (ui.category !== 'all') t.push('категория ' + ui.category);
    if (ui.wbwh && ui.wbwh !== 'all') t.push('склад WB ' + wbName(ui.wbwh));
    if (vwOn()) t.push('ваш склад «' + vwName(ui.vw === 'main' ? null : ui.vw) + '»');
    return t.length ? 'фильтр: ' + t.join(', ') : 'все товары';
  }
  function renderProducts() {
    const rows = state.data.stock; const s = state.summary || {}; const ui = state.ui.products;
    const sum = (fn) => rows.reduce((a, r) => a + Number(fn(r) || 0), 0);
    const unknown = rows.some((r) => total(r) == null);
    // Товары без числа учёта не гасят итог, а названы под ним (30.09.2026).
    const missing = s.unknownCount ? '\nкроме ' + counted(s.unknownCount, 'товара', 'товаров', 'товаров') + ' без учёта: '
      + (s.unknownNames || []).map((x) => '«' + x + '»').join(', ') + (s.unknownCount > (s.unknownNames || []).length ? '…' : '') : '';
    const byVw = vwOn();
    const stats = byVw ? [
      ['На складе', sum(total), 'склад «' + vwName(ui.vw === 'main' ? null : ui.vw) + '»'],
      ['Заказано', null, 'у заказа склада ещё нет — он появится с поставкой'],
      ['В сборке', sum(assemblyQty), 'в поставках с этого склада'],
      ['В пути', null, 'считается по всем складам'],
      ['Доступно', sum(availableQty), 'на складе − в сборке', 'main'],
    ] : [
      ['Всего товара', s.total ?? (unknown ? null : sum(total)), counted(s.productCount ?? rows.length, 'наименование', 'наименования', 'наименований') + (s.updatedAt ? '\nучёт на ' + when(s.updatedAt) : '') + missing],
      ['Заказано', s.ordered ?? sum(orderedQty), 'куплено на WB, ещё не в поставке'],
      ['В сборке', s.inAssembly ?? sum(assemblyQty), 'в поставке, склад собирает'],
      ['В пути', s.inTransit ?? sum(transitQty), 'уехало на WB, ещё не принято'],
      ['Доступно к продаже', s.available ?? (unknown ? null : sum(availableQty)), 'всего − заказано − в сборке' + (s.unknownCount ? ', по товарам с учётом' : ''), 'main'],
    ];
    const short = rows.filter(isShort).length;
    const over = wbView() ? rows.filter(wbOver).length : 0;
    const ours = ourWb();
    const categories = [...new Set(rows.map((r) => meta(r.sku).category || 'Без категории'))].sort((a, b) => a.localeCompare(b, 'ru'));
    $('view').innerHTML = segment('products') + `<div id="needAnswer">${needAnswerHtml()}</div>` + vwNoticeHtml()
      + `<section class="stock-strip" aria-label="Состояние товаров">${stats.map(([label, value, note, cls]) => `<div class="stat ${cls || ''}"><div class="stat-label">${h(label)}</div><div class="stat-value">${value == null ? '—' : n(value) + '<small>шт.</small>'}</div><div class="stat-note">${h(note).replace('\n', '<br>')}</div></div>`).join('')}</section>`
      + (over ? `<button type="button" class="alert-line ${ui.extra.has('wbOver') ? 'on' : ''}" data-wb-over>${icon('alert')}<span><b>${counted(over, 'товар', 'товара', 'товаров')}:</b> на WB выставлено больше, чем доступно на складе — WB может продать то, чего нет. ${ourWb().length > 1 ? 'Где снять — под числом в столбце «На WB».' : 'Обновите остатки на WB файлом «Остатки для WB».'}</span><span class="alert-action">${ui.extra.has('wbOver') ? 'Показаны только они' : 'Показать'}</span></button>` : '')
      + (short ? `<button type="button" class="alert-line ${ui.extra.has('shortage') ? 'on' : ''}" data-shortage>${icon('alert')}<span><b>${counted(short, 'товар', 'товара', 'товаров')}:</b> заказов больше, чем товара по учёту — склад проверяет, «Доступно» по ним ноль.</span><span class="alert-action">${ui.extra.has('shortage') ? 'Показаны только они' : 'Показать'}</span></button>` : '')
      + toolbar(searchBox('Название, артикул WB, штрихкод', ui.q),
        dropdown('p-stock', { label: 'Наличие', value: ui.stock, options: STOCK_FILTER, onPick: (v) => { ui.stock = v; ui.shown = state.prefs.rows; renderProducts(); } })
        + dropdown('p-orders', { label: 'Заказы', value: ui.orders, options: ORDERS_FILTER, onPick: (v) => { ui.orders = v; ui.shown = state.prefs.rows; renderProducts(); } })
        + dropdown('p-sort', { label: 'Сортировка', value: ui.sort, options: SORTS, onPick: (v) => { ui.sort = v; renderProducts(); } })
        + dropdown('p-extra', { label: 'Ещё фильтры', multi: true, value: ui.extra, options: EXTRA, onPick: (v) => { if (ui.extra.has(v)) ui.extra.delete(v); else ui.extra.add(v); ui.shown = state.prefs.rows; renderProducts(); } })
        + (ours.length > 1 ? dropdown('p-wbwh', { label: 'Склад WB', value: ui.wbwh || 'all', options: [{ value: 'all', text: 'Все ваши склады' }, ...ours.map((w) => ({ value: w.id, text: w.name }))], onPick: (v) => { ui.wbwh = v; renderProducts(); } }) : '')
        + (hasVw() ? dropdown('p-vw', { label: 'Ваш склад', value: ui.vw, options: [{ value: 'all', text: 'Основной — весь товар' }, ...state.vw.warehouses.map((w) => ({ value: w.id, text: w.name })), { value: 'main', text: 'Остальной товар' }], onPick: (v) => { ui.vw = v; ui.shown = state.prefs.rows; renderProducts(); } }) : '')
        + (categories.length > 1 ? dropdown('p-cat', { label: 'Категория', value: ui.category, options: [{ value: 'all', text: 'Все' }, ...categories.map((c) => ({ value: c, text: c }))], onPick: (v) => { ui.category = v; ui.shown = state.prefs.rows; renderProducts(); } }) : '')
        + resetLink('products'),
        columnChooser('products', productColumns(), renderProducts) + excelButton
        + `<button class="button" type="button" data-wb-stock title="Файл для WB: «Остатки» → склад продавца → «Загрузить Excel»">${icon('download')}Остатки для WB</button>`)
      + '<div id="rows"></div>';
    const overBtn = $('view').querySelector('[data-wb-over]');
    if (overBtn) overBtn.onclick = () => { if (ui.extra.has('wbOver')) ui.extra.delete('wbOver'); else ui.extra.add('wbOver'); ui.shown = state.prefs.rows; renderProducts(); };
    const shortBtn = $('view').querySelector('[data-shortage]');
    if (shortBtn) shortBtn.onclick = () => { if (ui.extra.has('shortage')) ui.extra.delete('shortage'); else ui.extra.add('shortage'); ui.shown = state.prefs.rows; renderProducts(); };
    wireView(ui, renderProducts, renderProductRows, exportProducts);
    wireVwNotices(); wireNeedAnswer();
    const wbBtn = $('view').querySelector('[data-wb-stock]');
    wbBtn.onclick = () => runExport(wbBtn, exportWbStock);
    renderProductRows();
  }
  function renderProductRows() {
    const ui = state.ui.products; const rows = filteredProducts(); const host = $('rows');
    host.innerHTML = rows.length
      ? table(visibleColumns('products', productColumns()), rows.slice(0, ui.shown), { rowAttrs: (r) => `class="clickable" data-product="${h(r.sku)}"` }) + moreFooter(ui, rows.length, ['товар', 'товара', 'товаров'])
      : empty('Товары не найдены', ui.q ? 'Проверьте название, артикул WB или штрихкод.' : 'Под выбранные фильтры не подошёл ни один товар.');
    host.querySelectorAll('[data-product]').forEach((tr) => { tr.onclick = () => openProduct(tr.dataset.product); });
    // Число в строке — сразу к заказам за ним, а не просто в карточку.
    host.querySelectorAll('[data-bucket]').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); openProduct(b.dataset.bucketSku, b.dataset.bucket); };
    });
    wireRows(host, ui, renderProductRows);
  }
  const exportProducts = () => exportExcel({
    file: 'Остатки', sheet: 'Остатки', title: `Остатки товаров — ${state.profile.name}`, filterText: productsFilterText(), rows: filteredProducts(),
    columns: [
      { header: '№', type: 'num', get: (r, k) => k + 1, min: 5, max: 6 },
      { header: 'Товар', type: 'text', get: (r) => productName(r), min: 30, max: 60 },
      { header: 'Артикул продавца', type: 'text', get: (r) => vendorCodes(r.sku).join(', ') },
      { header: 'Артикул WB', type: 'text', get: (r) => wbIds(r.sku).join(', ') },
      { header: 'Штрихкод', type: 'text', get: (r) => r.barcode || '', min: 15 },
      { header: 'Категория', type: 'text', get: (r) => meta(r.sku).category || '' },
      { header: 'Всего, шт.', type: 'num', total: true, get: total },
      { header: 'Заказано, шт.', type: 'num', total: true, get: orderedQty },
      { header: 'В сборке, шт.', type: 'num', total: true, get: assemblyQty },
      { header: 'В пути, шт.', type: 'num', total: true, get: transitQty },
      { header: 'Доступно к продаже, шт.', type: 'num', total: true, get: availableQty },
      { header: 'Выставлено на WB, шт.', type: 'num', total: true, get: (r) => wbStockOf(r.sku) },
      { header: 'Брак на складе, шт.', type: 'num', total: true, get: defectQty },
      ...(hasVw() && !vwOn() ? [{ header: 'По складам', type: 'text', get: splitText, min: 20, max: 60 }] : []),
      { header: 'Учёт на', type: 'date', get: (r) => r.updatedAt },
      { header: 'Карточка WB', type: 'link', get: (r) => wbLink(wbIds(r.sku)[0]) },
    ],
  });

  // ---------- Склады продавца ----------
  // Часть товара под своё назначение (площадка, юрлицо). Заводит склад;
  // продавец видит раскладку, просит перенести, отвечает на просьбы склада.
  async function loadVw() {
    const [d, notes, transfers, decisions] = await Promise.all([api('/api/vwarehouses'), api('/api/vwarehouses/notifications'),
      api('/api/vwarehouses/transfers?open=1'), api('/api/vwarehouses/decisions?open=1')]);
    return { ...d, notes, transfers, decisions };
  }
  // «Нужен ваш ответ» (рецензия 04.10, рекомендация 1): всё, что ждёт
  // продавца, одним списком сверху — что, как давно и куда нажать. Сами
  // ответы остаются, где были: переносы — ниже на этой странице, акты — в
  // «Приходах», брак — в «Складе брака».
  function needAnswerHtml() {
    const v = state.vw || {}; const docs = state.data.documents?.rows || []; const def = state.data.defects;
    const oldest = (list) => list.filter(Boolean).sort()[0];
    const waited = (ts) => { const hrs = Math.floor((Date.now() - new Date(ts)) / 36e5);
      return hrs < 1 ? 'меньше часа' : hrs < 48 ? counted(hrs, 'час', 'часа', 'часов') : counted(Math.floor(hrs / 24), 'день', 'дня', 'дней'); };
    const asks = (v.transfers || []).filter((t) => t.status === 'waiting_seller');
    const decisions = v.decisions || [];
    const acts = docs.filter((r) => r.direction === 'in' && awaitsVerdict(r));
    const defects = def ? def.balances.filter((b) => b.undecided > 0) : [];
    const rows = [
      [asks.length, counted(asks.length, 'просьба', 'просьбы', 'просьб') + ' склада перенести товар между вашими складами', oldest(asks.map((t) => t.requestedAt)), 'ask', 'Ответить ниже'],
      [decisions.length, counted(decisions.length, 'спорный случай', 'спорных случая', 'спорных случаев') + ' по вашим складам: как записать', oldest(decisions.map((d) => d.createdAt)), 'decision', 'Решить ниже'],
      [acts.length, counted(acts.length, 'приход', 'прихода', 'приходов') + (state.owner ? ' приняты не столько, сколько заявил продавец' : ' приняты не столько, сколько вы заявили: согласны?'), oldest(acts.map((r) => r.last_at || r.created_at)), 'acts', 'Открыть приходы'],
      [defects.length, counted(defects.length, 'товар', 'товара', 'товаров') + ' в браке' + (state.owner ? ' без решения продавца' : ': решите, что делать с браком'), oldest(defects.map((b) => b.since)), 'defects', 'Открыть брак'],
    ].filter((r) => r[0] > 0);
    if (!rows.length) return '';
    const total = rows.reduce((a, r) => a + r[0], 0);
    return `<div class="notice warning need-answer">${icon('alert')}<div><strong>${state.owner ? 'Ждёт ответа продавца' : 'Нужен ваш ответ'} · ${n(total)}</strong>`
      + rows.map(([, text, since, go, action]) => `<button type="button" class="na-row" data-na="${go}"><span>${h(text)}${since ? `<small>ждёт ${h(waited(since))}</small>` : ''}</span><span class="na-go">${h(action)} →</span></button>`).join('')
      + '</div></div>';
  }
  function wireNeedAnswer() {
    $('view').querySelectorAll('[data-na]').forEach((b) => { b.onclick = () => {
      const go = b.dataset.na;
      if (go === 'acts') { state.ui.documents.diff = 'answer'; location.hash = 'documents'; return; }
      if (go === 'defects') { location.hash = 'defects'; return; }
      $('view').querySelector(go === 'ask' ? '.vw-ask:not(.vw-decision)' : '.vw-decision')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }; });
  }
  function refreshNeedAnswer() {
    const host = $('needAnswer'); if (!host || state.view !== 'products') return;
    host.innerHTML = needAnswerHtml(); wireNeedAnswer();
  }
  function vwNoticeHtml() {
    const v = state.vw; if (!v) return '';
    const mine = !state.owner;
    const ask = (v.transfers || []).filter((t) => t.status === 'waiting_seller').map((t) => `<div class="notice warning vw-ask">${icon('alert')}<div>`
      + `<strong>Склад просит перенести «${h(t.name || t.sku)}», ${n(t.qty)} шт.: «${h(t.fromName)}» → «${h(t.toName)}»</strong>`
      + `<p>${t.note ? 'Комментарий склада: ' + h(t.note) + '. ' : ''}${mine ? 'Вы запретили складу решать такое без вас — решите сами.' : 'Ждёт согласия продавца.'}</p>`
      + (mine ? `<div class="vw-ask-form"><label class="field"><span>Причина отказа — не обязательно, склад её увидит</span><input id="vwReason-${h(t.id)}" maxlength="300"></label>`
        + `<div class="drawer-actions"><button class="button primary" type="button" data-vw-yes="${h(t.id)}">Согласен</button><button class="button" type="button" data-vw-no="${h(t.id)}">Отказать</button></div></div>` : '')
      + '</div></div>').join('');
    const open = (v.transfers || []).filter((t) => t.status === 'requested');
    const asked = open.length ? notice(mine ? 'Ваши заявки на перенос ждут склада' : 'Заявки продавца на перенос ждут склада',
      open.map((t) => `${t.number}: «${t.name || t.sku}», ${n(t.qty)} шт., «${t.fromName}» → «${t.toName}»`).join('; ')) : '';
    // Спорные ситуации, которые ждут продавца (он запретил складу решать без
    // него): как записано по правилу и поле на каждый склад.
    const LABEL = { inventory: ['было', 'останется'], receiving: ['заявлено', 'принято'], defect: ['годного было', 'брак с этого склада'] };
    const decide = (v.decisions || []).map((d) => `<div class="notice warning vw-ask vw-decision" data-decision="${h(d.id)}">${icon('alert')}<div>`
      + `<strong>${h(d.title)}</strong>`
      + `<p>${mine ? 'Вы запретили складу решать такое без вас. Пока учёт записан по правилу склада — согласитесь или разделите по-своему.' : 'Ждёт решения продавца: он запретил складу решать такое без него.'}</p>`
      + `<div class="vw-split">${d.parts.map((x) => `<label class="field"><span>«${h(x.name)}» · ${LABEL[d.kind][0]} ${n(x.before)}</span>`
        + (mine ? `<input type="number" inputmode="numeric" min="${x.min}" max="${x.max}" value="${x.value}" data-part="${h(x.vw || '')}" aria-label="${h(x.name)}: ${LABEL[d.kind][1]}">`
          : `<b>${n(x.value)}</b>`) + `<small>${LABEL[d.kind][1]}</small></label>`).join('')}</div>`
      + (mine ? `<p class="vw-split-sum">Всего должно получиться ${n(d.parts.reduce((a, x) => a + x.value, 0))} шт.</p>`
        + `<div class="drawer-actions"><button class="button primary" type="button" data-decision-ok="${h(d.id)}">Согласен</button>`
        + `<button class="button" type="button" data-decision-save="${h(d.id)}">Сохранить по-моему</button></div>` : '')
      + '</div></div>').join('');
    // Просьбы склада о согласии и о решении — не здесь: ждущие стоят сверху с
    // кнопками, на решённые продавец уже ответил сам. Что склад решил сам —
    // отдельно и заметно: «обратите внимание» (владелец 02.10.2026).
    const unseen = (v.notes || []).filter((x) => x.unseen && !['vw_transfer_consent', 'vw_decision'].includes(x.kind));
    const block = (list, cls, ico, title, seenBtn) => (list.length ? `<div class="notice ${cls}">${icon(ico)}<div><strong>${title} · ${n(list.length)}</strong>`
      + list.slice(0, 5).map((x) => `<p class="note-line" title="Нажмите, чтобы прочитать целиком">${h(when(x.at))} — ${h(x.text)}</p>`).join('')
      + (list.length > 5 ? `<p>и ещё ${n(list.length - 5)}</p>` : '')
      + (mine ? `<div class="drawer-actions"><button class="button" type="button" data-vw-seen="${seenBtn}">Понятно</button></div>` : '') + '</div></div>' : '');
    const self = unseen.filter((x) => x.kind === 'ff_decided');
    const rest = unseen.filter((x) => x.kind !== 'ff_decided');
    return decide + ask + asked
      + block(self, 'warning vw-notes', 'alert', 'Склад решил сам — обратите внимание', 'self')
      + block(rest, 'vw-notes', 'info', 'От склада', 'rest');
  }
  function wireVwNotices() {
    const host = $('view');
    host.querySelectorAll('[data-decision-ok], [data-decision-save]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.decisionOk || b.dataset.decisionSave;
        const box = host.querySelector(`[data-decision="${CSS.escape(id)}"]`);
        const chosen = [...box.querySelectorAll('[data-part]')].map((i) => ({ vw: i.dataset.part || null, qty: Number(i.value) }));
        b.disabled = true;
        try {
          const d = await api('/api/vwarehouses/decisions/' + encodeURIComponent(id), { method: 'POST',
            body: b.dataset.decisionOk ? { confirm: true } : { chosen } });
          toast(d.status === 'changed' ? 'Сделано по-вашему: ' + (d.transfers || []).join(', ') : 'Записано: вы согласились.');
          navigate(true);
        } catch (e) { b.disabled = false; toast(e.message); }
      };
    });
    // Сумма по складам — сразу под полями.
    host.querySelectorAll('.vw-decision').forEach((box) => {
      const sum = box.querySelector('.vw-split-sum'); if (!sum) return;
      const need = sum.textContent;
      box.querySelectorAll('[data-part]').forEach((i) => { i.oninput = () => {
        const got = [...box.querySelectorAll('[data-part]')].reduce((a, x) => a + Number(x.value || 0), 0);
        sum.textContent = need + ' Сейчас: ' + n(got) + ' шт.';
      }; });
    });
    // Длинные уведомления свёрнуты до двух строк — целиком по нажатию.
    host.querySelectorAll('.note-line').forEach((p) => { p.onclick = () => p.classList.toggle('open'); });
    host.querySelectorAll('[data-vw-seen]').forEach((seen) => { seen.onclick = async () => {
      const self = seen.dataset.vwSeen === 'self';
      const list = state.vw.notes.filter((x) => x.unseen && !['vw_transfer_consent', 'vw_decision'].includes(x.kind) && (x.kind === 'ff_decided') === self);
      seen.disabled = true;
      try { await api('/api/vwarehouses/notifications/seen', { method: 'POST', body: { ids: list.map((x) => x.id) } }); list.forEach((x) => { x.unseen = false; }); renderProducts(); }
      catch (e) { seen.disabled = false; toast(e.message); }
    }; });
    host.querySelectorAll('[data-vw-yes], [data-vw-no]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.vwYes || b.dataset.vwNo; const approve = !!b.dataset.vwYes;
        b.disabled = true;
        try {
          const t = await api('/api/vwarehouses/transfers/' + encodeURIComponent(id) + '/decide', { method: 'POST',
            body: { approve, reason: approve ? undefined : ($('vwReason-' + id)?.value.trim() || undefined) } });
          toast(approve ? `Перенос ${t.number} выполнен: «${t.fromName}» → «${t.toName}», ${n(t.qty)} шт.` : `Отказано: перенос ${t.number} не сделан.`);
          navigate(true);
        } catch (e) { b.disabled = false; toast(e.message); }
      };
    });
  }
  // Карточка товара: сколько на каждом складе и заявка складу на перенос.
  function productVwHtml(r) {
    if (!hasVw() || !r.warehouses) return '';
    // Как товар хранится, продавцу не показываем (владелец 03.10.2026) — только остатки.
    const cols = [{ title: 'Склад', cell: (w) => h(w.name) },{ title: 'На складе', cls: 'n', cell: (w) => num(w.onHand) },
      { title: 'В сборке', cls: 'n', cell: (w) => num(w.inAssembly) }, { title: 'Доступно', cls: 'n', cell: (w) => num(w.available, true) },
      { title: 'Брак', cls: 'n', cell: (w) => num(w.defect) }];
    // «Основной» — весь товар вместе, склады — его части (владелец 03.10.2026).
    // Строка «Основной» — те же числа, что в плитках выше (проверка 03.10.2026).
    const all = { id: 'all', name: 'Основной — весь товар', onHand: r.total ?? null, inAssembly: Number(r.inAssembly || 0), available: r.available ?? null, defect: Number(r.defective || 0) };
    const ordered = Number(r.ordered || 0);
    return `<section class="detail-section" style="margin-top:0"><h3>По вашим складам</h3>${table(cols, [all, ...r.warehouses])}`
      + (ordered > 0 ? `<p class="help">По складам «Доступно» — без заказанного (${n(ordered)} шт.): у заказов, которые ещё не в поставке, склада пока нет.</p>` : '')
      + (state.owner ? '' : `<div id="vwMoveForm"></div><div class="drawer-actions" id="vwMoveRow"><button class="button" type="button" id="vwMove">Попросить склад перенести</button></div>`)
      + '</section>';
  }
  function wireProductVw(r) {
    if (!$('vwMove')) return;
    const m = { from: vwKey((r.warehouses.find((w) => w.onHand > 0) || r.warehouses[0]).id), to: '', busy: false, error: '' };
    m.to = vwKey((r.warehouses.find((w) => vwKey(w.id) !== m.from) || r.warehouses[0]).id);
    const opts = () => r.warehouses.map((w) => ({ value: vwKey(w.id), text: w.name + ' — ' + (w.onHand == null ? '—' : n(w.onHand)) + ' шт.' }));
    const draw = () => {
      $('vwMoveRow').hidden = true;
      $('vwMoveForm').innerHTML = `<div class="vw-move"><div class="two"><div class="field"><span>Откуда</span>${dropdown('vw-from', { value: m.from, neutral: true, options: opts(), onPick: (v) => { m.from = v; keep(); draw(); } })}</div>`
        + `<div class="field"><span>Куда</span>${dropdown('vw-to', { value: m.to, neutral: true, options: opts(), onPick: (v) => { m.to = v; keep(); draw(); } })}</div></div>`
        + `<div class="two"><label class="field"><span>Сколько штук</span><input id="vwQty" inputmode="numeric" maxlength="7" value="${h(m.qty || '')}"></label>`
        + `<label class="field"><span>Комментарий складу — не обязательно</span><input id="vwNote" maxlength="300" value="${h(m.note || '')}" placeholder="Например: под поставку на Озон"></label></div>`
        + (m.error ? `<p class="error-text">${h(m.error)}</p>` : '')
        + `<p class="help">Заявка уйдёт складу как важная. Перенесёт склад — вам придёт уведомление.</p>`
        + `<div class="drawer-actions"><button class="button primary" type="button" id="vwSend" ${m.busy ? 'disabled' : ''}>Отправить заявку</button><button class="button ghost" type="button" id="vwCancel">Отмена</button></div></div>`;
      $('vwCancel').onclick = () => { $('vwMoveForm').innerHTML = ''; $('vwMoveRow').hidden = false; };
      $('vwSend').onclick = send;
    };
    const keep = () => { m.qty = $('vwQty')?.value; m.note = $('vwNote')?.value; };
    async function send() {
      keep();
      const qty = Number(String(m.qty || '').replace(/\s/g, ''));
      m.error = m.from === m.to ? 'Склад «откуда» и «куда» — один и тот же.' : !Number.isInteger(qty) || qty < 1 ? 'Сколько штук перенести?' : '';
      if (m.error) { draw(); return; }
      m.busy = true; draw();
      try {
        const t = await api('/api/vwarehouses/transfers', { method: 'POST', body: { sku: r.sku, qty,
          fromVw: m.from === 'main' ? null : m.from, toVw: m.to === 'main' ? null : m.to, note: (m.note || '').trim() || undefined } });
        toast(`Заявка ${t.number} отправлена складу: «${t.fromName}» → «${t.toName}», ${n(t.qty)} шт.`);
        $('vwMoveForm').innerHTML = ''; $('vwMoveRow').hidden = false;
        try { state.vw = await loadVw(); } catch { /* заявка ушла, список обновится с «Обновить» */ }
      } catch (e) { m.busy = false; m.error = e.message; draw(); }
    }
    $('vwMove').onclick = draw;
  }

  // ---------- Склады WB ----------
  // Склады продавца на WB у этого фулфилмента и сколько он выставил на WB по
  // каждому (владелец 30.09.2026). Аргус WB только читает.
  const ourWb = () => (state.data.wb?.warehouses || []).filter((w) => w.ours);
  const wbName = (id) => (state.data.wb?.warehouses || []).find((w) => w.id === id)?.name || 'склад WB ' + id;
  // Выставлено на WB: по выбранному складу или по всем нашим; null — WB не
  // сказал (товар ни разу не заказывали — размера WB мы не знаем).
  function wbStockOf(sku, whId = state.ui.products.wbwh) {
    const s = state.data.wb?.stock?.[sku]; if (!s) return null;
    const ids = whId && whId !== 'all' ? [whId] : ourWb().map((w) => w.id);
    return ids.some((id) => s[id] != null) ? ids.reduce((a, id) => a + (s[id] || 0), 0) : null;
  }
  // Всегда по всем нашим складам: WB продаёт с любого из них один и тот же товар.
  const wbOver = (r) => { const v = wbStockOf(r.sku, 'all'); const a = wbAvailable(r); return v != null && a != null && v > a; };
  // Выбран склад не для WB (Озон) — про остатки WB не пугаем (проверка 03.10.2026).
  const wbView = () => !vwOn() || (state.vw?.wbChoices || []).some((c) => vwKey(c.id) === state.ui.products.vw);
  // Где снять лишнее: на нашем складе WB, где выставлено больше всего
  // (владелец 06.10.2026). Файл «Остатки для WB» ставит одно число на склад —
  // при нескольких складах WB он только прибавит.
  function wbFix(r) {
    const s = state.data.wb?.stock?.[r.sku] || {};
    const extra = wbStockOf(r.sku, 'all') - wbAvailable(r);
    const top = ourWb().map((w) => ({ name: w.name, amount: s[w.id] || 0 })).sort((a, b) => b.amount - a.amount)[0];
    return top && top.amount >= extra ? `снимите ${n(extra)}: «${top.name}» ${n(top.amount)} → ${n(top.amount - extra)}` : `снимите ${n(extra)} на складах WB`;
  }
  function wbStockCell(r) {
    const v = wbStockOf(r.sku);
    if (v == null) return num(null);
    return wbOver(r) && wbView() ? `<span class="warn-num" title="На WB выставлено больше, чем свободно на складе">${n(v)}</span><span class="cell-sub">${h(wbFix(r))}</span>` : num(v);
  }
  async function markWb(id, ours) {
    const path = state.owner ? `/api/marketplaces/${encodeURIComponent(state.companyId)}/wb/warehouses/${encodeURIComponent(id)}`
      : `/api/sellers/wb-warehouses/${encodeURIComponent(id)}`;
    try {
      const r = await api(path, { method: 'PATCH', body: { ours } });
      state.ui.wb.confirm = null;
      // Какие заказы в работе, поменялось — остатки и заказы перечитаем.
      delete state.data.orders; delete state.data.stock;
      state.data.wb = await api(API_PATH.wb);
      renderWb();
      toast(ours ? `Склад отмечен вашим.${r.restored ? ` Вернулось в работу ${counted(r.restored, 'заказ', 'заказа', 'заказов')}.` : ''}`
        : `Отметка снята.${r.hidden ? ` Из работы убрано ${counted(r.hidden, 'заказ', 'заказа', 'заказов')}.` : ''}`);
    } catch (e) { toast(e.message); renderWb(); }
  }
  function renderWb() {
    const info = state.data.wb; const ui = state.ui.wb;
    if (!info?.connected) {
      $('view').innerHTML = segment('wb') + empty('Wildberries не подключён', 'Склад ещё не подключил ваш ключ WB. Попросите менеджера склада — после этого здесь появятся ваши склады на WB.', 'truck');
      return;
    }
    const ff = info.ffName || 'этого фулфилмента';
    const whStock = (id) => Object.values(info.stock || {}).reduce((a, s) => a + (s[id] || 0), 0);
    const single = info.warehouses.filter((w) => !w.gone).length === 1;
    const who = (w) => (w.auto ? (w.ours ? (w.nameMatches ? `Отмечен Аргусом: в названии «${ff}»` : single ? 'Отмечен Аргусом: ваш единственный склад' : 'Отмечен Аргусом') : 'Не отмечен') : `${w.ours ? 'Отметил' : 'Снял'}: ${w.decidedBy}${w.decidedAt ? ', ' + when(w.decidedAt) : ''}`);
    const card = (w) => {
      const place = [w.office.city, w.office.address || w.office.name].filter(Boolean).join(', ');
      const facts = [
        `<span>${counted(w.openOrders, 'заказ', 'заказа', 'заказов')} в работе</span>`,
        w.ours ? `<span><b>${n(whStock(w.id))}</b> шт. выставлено на WB</span>` : '',
        w.hidden ? `<span>${counted(w.hidden, 'заказ', 'заказа', 'заказов')} склад не собирает</span>` : '',
      ].filter(Boolean).join('');
      const confirm = ui.confirm === w.id
        ? `<div class="wbwh-confirm"><p>Снять отметку? Склад перестанет собирать заказы с «${h(w.name)}»${w.openOrders ? ` — ${counted(w.openOrders, 'заказ', 'заказа', 'заказов')} в работе уйдут из списка` : ''}. Если товар для этого склада лежит у «${h(ff)}», не снимайте.</p><div class="wbwh-actions"><button class="button" type="button" data-wb-off="${h(w.id)}">Снять отметку</button><button class="button ghost" type="button" data-wb-cancel>Оставить</button></div></div>`
        : '';
      return `<div class="wbwh ${w.ours ? 'on' : ''}"><label class="check-line"><input type="checkbox" data-wb-mark="${h(w.id)}" ${w.ours ? 'checked' : ''}><span><strong>${h(w.name)}</strong>${w.gone ? ' <span class="badge issue">удалён на WB</span>' : ''}<small>${h(place || 'пункт приёмки WB не указан')}</small></span></label>`
        + `<div class="wbwh-facts">${facts}</div><p class="wbwh-who">${h(who(w))}</p>${confirm}</div>`;
    };
    const ours = info.warehouses.filter((w) => w.ours).length;
    $('view').innerHTML = segment('wb')
      + notice(`Все ваши склады на WB`, `Отметьте склады, товар для которых лежит у «${ff}»: «${ff}» собирает заказы только с отмеченных. Заказы остальных складов не удаляются — поставите галочку, вернутся.`)
      + (!ours && info.warehouses.length ? notice('Ни один склад не отмечен', `«${ff}» не забирает ваши заказы с WB, пока вы не отметите склады, товар для которых лежит у «${ff}».`, true) : '')
      + (info.error ? notice('WB не отдал список складов', info.error + '. Нажмите «Обновить из WB» чуть позже.', true) : '')
      + `<div class="wbwh-bar"><strong>${info.warehouses.length ? `Отмечено ${ours} из ${info.warehouses.length}` : 'Складов пока нет'}</strong>`
      + `<button class="button" type="button" id="wbRefresh">${icon('refresh')}Обновить из WB</button></div>`
      + (info.warehouses.length ? `<div class="wbwh-list">${info.warehouses.map(card).join('')}</div>` : empty('Складов пока нет', 'Заведите склад в кабинете WB и нажмите «Обновить из WB».', 'box'))
      + `<p class="help wbwh-note">${info.refreshedAt ? `Список складов получен из WB ${h(when(info.refreshedAt))}; Аргус обновляет его сам раз в час. ` : ''}${info.stocksError ? `Остатки WB не читаются: ${h(info.stocksError)}.` : info.stocksAt ? `«Выставлено на WB» — по данным WB на ${h(when(info.stocksAt))}. Аргус в WB ничего не меняет.` : 'Остатки WB ещё не прочитаны — это займёт до получаса.'}${info.unknownOrders ? ` У ${counted(info.unknownOrders, 'заказа', 'заказов', 'заказов')} склад WB ещё не известен — Аргус узнаёт его у WB.` : ''}</p>`;
    $('view').querySelectorAll('[data-wb-mark]').forEach((box) => {
      box.onchange = () => {
        if (box.checked) { box.disabled = true; markWb(box.dataset.wbMark, true); return; }
        box.checked = true; ui.confirm = box.dataset.wbMark; renderWb();
      };
    });
    $('view').querySelectorAll('[data-wb-off]').forEach((b) => { b.onclick = () => { b.disabled = true; markWb(b.dataset.wbOff, false); }; });
    const cancel = $('view').querySelector('[data-wb-cancel]');
    if (cancel) cancel.onclick = () => { ui.confirm = null; renderWb(); };
    const refresh = $('wbRefresh');
    if (refresh) refresh.onclick = async () => {
      refresh.disabled = true; refresh.innerHTML = '<span class="spinner"></span>Спрашиваю WB…';
      const path = state.owner ? `/api/marketplaces/${encodeURIComponent(state.companyId)}/wb/warehouses/refresh` : '/api/sellers/wb-warehouses/refresh';
      try {
        await api(path, { method: 'POST' });
        state.data.wb = await api(API_PATH.wb);
        delete state.data.orders; delete state.data.stock;
        toast('Склады обновлены из WB.');
      } catch (e) { toast(e.message); }
      renderWb();
    };
  }

  // Файл для загрузки остатков в WB (FBS): как шаблон WB — одна таблица
  // «Баркод | Количество», первая строка — заголовки, без шапки. Число —
  // «Доступно к продаже»: заказы, которые WB уже принял, он держит сам.
  // Все товары, без учёта фильтров: ноль тоже нужен — WB снимет товар с продажи.
  async function exportWbStock() {
    const lines = []; const noCode = []; const manyCodes = []; const noQty = [];
    for (const r of state.data.stock) {
      const codes = meta(r.sku).wbBarcodes || []; const qty = wbAvailable(r);
      if (!codes.length) noCode.push(productName(r));
      else if (codes.length > 1) manyCodes.push(productName(r));
      else if (qty == null) noQty.push(productName(r));
      else lines.push([codes[0], Math.max(0, qty)]);
    }
    if (!lines.length) { toast('Нечего выгружать: ни у одного товара нет баркода WB и остатка.'); return; }
    await loadExcel();
    const wb = new window.ExcelJS.Workbook(); wb.creator = 'Аргус'; wb.created = new Date();
    const ws = wb.addWorksheet('Остатки');
    ws.addRow(['Баркод', 'Количество']);
    lines.forEach((l) => ws.addRow(l));
    ws.getColumn(1).numFmt = '@'; ws.getColumn(1).width = 18; ws.getColumn(2).width = 12;
    ws.getRow(1).font = { bold: true };
    await saveXlsx(wb, 'Остатки для WB');
    const names = (list) => list.slice(0, 3).map((x) => '«' + x + '»').join(', ') + (list.length > 3 ? ' и ещё ' + (list.length - 3) : '');
    const left = [
      noCode.length && `без баркода WB (по ним ещё не было заказов) — ${names(noCode)}`,
      manyCodes.length && `несколько баркодов WB — ${names(manyCodes)}`,
      noQty.length && `остаток ещё не получен — ${names(noQty)}`,
    ].filter(Boolean);
    toast(`В файле ${counted(lines.length, 'товар', 'товара', 'товаров')}.` + (left.length ? ' Не вошли: ' + left.join('; ') + '.' : '')
      + (ourWb().length > 1 ? ' Файл ставит это число на один склад WB целиком. Товар, выставленный на нескольких складах WB, после загрузки станет на WB больше — его меняйте руками.' : ''));
  }

  // ---------- Товары: возвраты ----------
  const RETURN_STATUS = { open: ['Ждёт разбора', 'waiting'], in_progress: ['Разбирается', 'working'], completed: ['Разобран', 'ready'] };
  function filteredReturns() {
    const ui = state.ui.returns;
    return state.data.documents.rows.filter((r) => r.direction === 'return'
      && matches(ui.q, [r.number, ...(r.received_by || [])])
      && (ui.status === 'all' || r.status === ui.status)
      && (ui.quality === 'all' || (ui.quality === 'defect' ? Number(r.bad_qty) > 0 : r.status === 'completed' && !(Number(r.bad_qty) > 0)))
      && inPeriod(r.first_at || r.created_at, ui.period));
  }
  const RETURN_COLUMNS = [
    { key: 'doc', title: 'Возврат', locked: true, cell: (r) => `<button class="link-button" data-doc="${h(r.id)}">${h(r.number)}</button><span class="cell-sub">${counted(r.item_count, 'позиция', 'позиции', 'позиций')}</span>` },
    { key: 'at', title: 'Когда разобрали', cls: 'n', cell: (r) => h(when(r.last_at || r.created_at)) },
    { key: 'qty', title: 'Штук', cls: 'n', cell: (r) => num(r.declared_qty) },
    { key: 'good', title: 'Годное', cls: 'n', cell: (r) => num(r.good_qty) },
    { key: 'bad', title: 'Брак', cls: 'n', cell: (r) => (Number(r.bad_qty) > 0 ? `<span class="row-note bad" style="margin:0">${n(r.bad_qty)}</span>` : num(r.bad_qty)) },
    { key: 'status', title: 'Статус', cls: 'c', cell: (r) => badge(...(RETURN_STATUS[r.status] || [r.status])) },
    { key: 'who', title: 'Разбирал', cell: (r) => h((r.received_by || []).join(', ') || '—') },
  ];
  function renderReturns() {
    const ui = state.ui.returns;
    $('view').innerHTML = segment('returns') + toolbar(searchBox('Номер возврата', ui.q),
      dropdown('r-status', { label: 'Статус', value: ui.status, options: [{ value: 'all', text: 'Все' }, { value: 'open', text: 'Ждут разбора' }, { value: 'in_progress', text: 'Разбираются' }, { value: 'completed', text: 'Разобраны' }], onPick: (v) => { ui.status = v; ui.shown = state.prefs.rows; renderReturns(); } })
      + dropdown('r-quality', { label: 'Состояние', value: ui.quality, options: [{ value: 'all', text: 'Любое' }, { value: 'defect', text: 'Есть брак' }, { value: 'good', text: 'Только годное' }], onPick: (v) => { ui.quality = v; ui.shown = state.prefs.rows; renderReturns(); } })
      + dropdown('r-period', { label: 'Период', value: ui.period, options: PERIODS, onPick: (v) => { ui.period = v; ui.shown = state.prefs.rows; renderReturns(); } })
      + resetLink('returns'), excelButton) + '<div id="rows"></div>';
    wireView(ui, renderReturns, renderReturnRows, () => exportExcel({
      file: 'Возвраты', sheet: 'Возвраты', title: `Возвраты — ${state.profile.name}`, filterText: '', rows: filteredReturns(),
      columns: [
        { header: '№', type: 'num', get: (r, k) => k + 1, min: 5, max: 6 },
        { header: 'Возврат', type: 'text', get: (r) => r.number, min: 12 },
        { header: 'Когда разобрали', type: 'date', get: (r) => r.last_at || r.created_at },
        { header: 'Позиций', type: 'num', get: (r) => r.item_count },
        { header: 'Штук', type: 'num', total: true, get: (r) => r.declared_qty },
        { header: 'Годное, шт.', type: 'num', total: true, get: (r) => r.good_qty || 0 },
        { header: 'Брак, шт.', type: 'num', total: true, get: (r) => r.bad_qty || 0 },
        { header: 'Статус', type: 'text', get: (r) => (RETURN_STATUS[r.status] || [r.status])[0] },
        { header: 'Разбирал', type: 'text', get: (r) => (r.received_by || []).join(', ') },
      ],
    }));
    renderReturnRows();
  }
  function renderReturnRows() {
    const ui = state.ui.returns; const rows = filteredReturns(); const host = $('rows');
    host.innerHTML = rows.length ? table(RETURN_COLUMNS, rows.slice(0, ui.shown), { rowAttrs: (r) => `class="clickable" data-doc-row="${h(r.id)}"` }) + moreFooter(ui, rows.length, ['возврат', 'возврата', 'возвратов'])
      : empty('Возвратов нет', 'Когда на склад вернётся ваш товар, здесь будет видно, что годное и что брак.', 'inbox');
    host.querySelectorAll('[data-doc-row]').forEach((tr) => { tr.onclick = () => openDocument(tr.dataset.docRow); });
    wireRows(host, ui, renderReturnRows);
  }

  // ---------- Заказы ----------
  const statusClass = { open: 'waiting', in_progress: 'working', ready: 'ready', shipped: '' };
  const orderActive = (r) => r.status !== 'shipped' && (!r.mp_closed_at || !!r.stock_conflict);
  const inWork = { in_progress: 'Собирается', ready: 'Собран, ждёт отгрузки' };
  const orderStatus = (r) => (r.status === 'shipped' ? (r.mp_closed_at ? (r.mp_close_reason === 'canceled' ? 'Отменён на WB' : 'Принят WB') : 'Отгружен, в пути на WB')
    : r.mp_closed_at ? (r.mp_close_reason === 'canceled' ? 'Отменён на WB' : 'Завершён на WB')
      : inWork[r.status] || (r.in_supply ? 'В сборке' : r.mp_supplier_status === 'confirm' ? 'Подтверждён в кабинете WB' : 'Заказан, ждёт поставки'));
  const orderStyle = (r) => (r.stock_conflict ? 'issue' : r.mp_closed_at ? (r.mp_close_reason === 'canceled' ? 'issue' : 'ready') : r.in_supply && r.status === 'open' ? 'working' : statusClass[r.status] ?? '');
  const ORDER_STATUS = [{ value: 'all', text: 'Все' }, { value: 'active', text: 'В работе' }, { value: 'queued', text: 'Ждут поставки' }, { value: 'assembly', text: 'В сборке' }, { value: 'ready', text: 'Собраны' }, { value: 'transit', text: 'В пути на WB' }, { value: 'shipped', text: 'Отгружены' }, { value: 'canceled', text: 'Отменены' }, { value: 'conflict', text: 'Склад сверяет' }];
  function orderMatchesStatus(r, s) {
    if (s === 'all') return true;
    if (s === 'active') return orderActive(r);
    if (s === 'queued') return !r.in_supply && r.status === 'open' && !r.mp_closed_at;
    if (s === 'assembly') return !r.mp_closed_at && r.status !== 'shipped' && (r.in_supply || ['in_progress', 'ready'].includes(r.status));
    if (s === 'ready') return r.status === 'ready' && !r.mp_closed_at;
    if (s === 'transit') return r.status === 'shipped' && !r.mp_closed_at;
    if (s === 'shipped') return r.status === 'shipped';
    if (s === 'canceled') return r.mp_close_reason === 'canceled';
    if (s === 'conflict') return !!r.stock_conflict;
    return true;
  }
  const orderAt = (r) => r.mp_created_at || r.created_at;
  function filteredOrders() {
    const ui = state.ui.orders;
    const rows = state.data.orders.rows.filter((r) => matches(ui.q, [r.number, r.name, r.sku, r.mp_rid, r.mp_nm_id, r.mp_article, r.mp_barcode, r.supply_number, ...wbIds(r.sku)])
      && orderMatchesStatus(r, ui.status) && inPeriod(orderAt(r), ui.period)
      && (ui.supply === 'all' || (ui.supply === 'none' ? !r.supply_number : r.supply_number === ui.supply))
      && (!ui.wbwh.size || ui.wbwh.has(String(r.mp_warehouse_id || 'none'))));
    const by = { new: (a, b) => new Date(orderAt(b)) - new Date(orderAt(a)), old: (a, b) => new Date(orderAt(a)) - new Date(orderAt(b)),
      product: (a, b) => String(productName(a)).localeCompare(String(productName(b)), 'ru'), qty: (a, b) => Number(b.qty) - Number(a.qty) };
    return rows.sort(by[ui.sort]);
  }
  const ORDER_COLUMNS = [
    { key: 'photo', title: 'Фото', cls: 'w-photo', cell: (r) => photo(r.sku, r.mp_nm_id) },
    { key: 'product', title: 'Товар', locked: true, main: true, cell: (r) => `<span class="cell-main">${h(productName(r))}</span>${r.mp_article ? `<span class="cell-sub">Артикул продавца: ${h(r.mp_article)}</span>` : ''}` },
    { key: 'order', title: 'Заказ', cell: (r) => `<button class="link-button nowrap" data-order="${h(r.id)}">${h(r.number)}</button> ${sellerOrderMarketplace(r.source)}${r.mp_rid ? `<span class="cell-sub nowrap">${h(r.mp_rid)}</span>` : ''}` },
    { key: 'wb', title: 'Артикул WB', cell: (r) => idCell(r.mp_nm_id ? [r.mp_nm_id] : wbIds(r.sku), r.mp_barcode) },
    { key: 'qty', title: 'Кол-во', cls: 'n', cell: (r) => num(r.qty) },
    { key: 'at', title: 'Оформлен на WB', cls: 'n', cell: (r) => h(when(orderAt(r))) },
    { key: 'wbwh', title: 'Склад WB', cell: (r) => (r.mp_warehouse_id ? h(r.mp_warehouse_name || 'склад WB ' + r.mp_warehouse_id) : '<span class="zero">—</span>') },
    { key: 'supply', title: 'Поставка', cell: (r) => (r.supply_number ? `<span class="cell-main nowrap">${h(r.supply_number)}</span>${r.supply_destination ? `<span class="cell-sub">${h(r.supply_destination)}</span>` : ''}` : '<span class="zero">—</span>') },
    { key: 'status', title: 'Статус', cls: 'c', cell: (r) => badge(orderStatus(r), orderStyle(r)) + (r.stock_conflict ? '<span class="row-note warn">Склад сверяет заказ</span>' : '') },
    { key: 'loaded', title: 'Загружен в Аргус', cls: 'n', hidden: true, cell: (r) => h(when(r.created_at)) },
  ];
  const sellerOrderMarketplace = (source) => {
    const key = String(source || '').toLowerCase();
    if (!key) return '';
    return `<span class="workspace-marketplace ${key === '1c' ? 'onec' : ['wb', 'ozon'].includes(key) ? key : ''}">${h({ wb: 'WB', ozon: 'Ozon', '1c': '1С' }[key] || key.toUpperCase())}</span>`;
  };
  function renderOrders() {
    const ui = state.ui.orders; const supplies = [...new Set(state.data.orders.rows.map((r) => r.supply_number).filter(Boolean))].sort().reverse();
    const whs = [...new Map(state.data.orders.rows.filter((r) => r.mp_warehouse_id).map((r) => [r.mp_warehouse_id, r.mp_warehouse_name || 'склад WB ' + r.mp_warehouse_id])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'ru'));
    $('view').innerHTML = (state.data.orders.hasMore ? notice('Показана часть заказов', 'Загружены последние 1 000 позиций.', true) : '')
      + toolbar(searchBox('Номер заказа, товар, артикул WB, штрихкод', ui.q),
        dropdown('o-status', { label: 'Статус', value: ui.status, options: ORDER_STATUS, onPick: (v) => { ui.status = v; ui.shown = state.prefs.rows; renderOrders(); } })
        + dropdown('o-period', { label: 'Период', value: ui.period, options: PERIODS, onPick: (v) => { ui.period = v; ui.shown = state.prefs.rows; renderOrders(); } })
        + dropdown('o-supply', { label: 'Поставка', value: ui.supply, options: [{ value: 'all', text: 'Любая' }, { value: 'none', text: 'Без поставки' }, ...supplies.map((x) => ({ value: x, text: x }))], onPick: (v) => { ui.supply = v; ui.shown = state.prefs.rows; renderOrders(); } })
        + (whs.length || ui.wbwh.size ? dropdown('o-wbwh', { label: ui.wbwh.size ? 'Склады WB' : 'Все склады WB', value: ui.wbwh, multi: true,
          options: [{ value: 'all', text: 'Все склады WB' }, ...whs.map(([value, text]) => ({ value: String(value), text })),
            ...(state.data.orders.rows.some((r) => !r.mp_warehouse_id) ? [{ value: 'none', text: 'Склад не известен' }] : [])],
          onPick: (v) => { if (v === 'all') ui.wbwh.clear(); else if (ui.wbwh.has(v)) ui.wbwh.delete(v); else ui.wbwh.add(v); ui.shown = state.prefs.rows; renderOrders(); } }) : '')
        + dropdown('o-sort', { label: 'Сортировка', value: ui.sort, options: [{ value: 'new', text: 'Сначала новые' }, { value: 'old', text: 'Сначала старые' }, { value: 'product', text: 'По товару' }, { value: 'qty', text: 'Больше штук' }], onPick: (v) => { ui.sort = v; renderOrders(); } })
        + resetLink('orders'),
        columnChooser('orders', ORDER_COLUMNS, renderOrders) + excelButton)
      + '<div id="rows"></div>';
    wireView(ui, renderOrders, renderOrderRows, () => exportExcel({
      file: 'Заказы', sheet: 'Заказы', title: `Заказы — ${state.profile.name}`, filterText: ui.status !== 'all' ? 'статус: ' + ORDER_STATUS.find((o) => o.value === ui.status).text.toLowerCase() : '', rows: filteredOrders(),
      columns: [
        { header: '№', type: 'num', get: (r, k) => k + 1, min: 5, max: 6 },
        { header: 'Заказ', type: 'text', get: (r) => r.number, min: 14 },
        { header: 'Отправление', type: 'text', get: (r) => r.mp_rid || '' },
        { header: 'Товар', type: 'text', get: (r) => productName(r), min: 30, max: 60 },
        { header: 'Артикул продавца', type: 'text', get: (r) => r.mp_article || '' },
        { header: 'Артикул WB', type: 'text', get: (r) => r.mp_nm_id || wbIds(r.sku).join(', ') },
        { header: 'Штрихкод', type: 'text', get: (r) => r.mp_barcode || '', min: 15 },
        { header: 'Кол-во, шт.', type: 'num', total: true, get: (r) => r.qty },
        { header: 'Оформлен на WB', type: 'date', get: orderAt },
        { header: 'Склад WB', type: 'text', get: (r) => r.mp_warehouse_name || '' },
        { header: 'Поставка', type: 'text', get: (r) => r.supply_number || '' },
        { header: 'Куда', type: 'text', get: (r) => r.supply_destination || '' },
        { header: 'Статус', type: 'text', get: (r) => orderStatus(r) + (r.stock_conflict ? ' · склад сверяет' : ''), min: 18 },
      ],
    }));
    renderOrderRows();
  }
  function renderOrderRows() {
    const ui = state.ui.orders; const rows = filteredOrders(); const host = $('rows');
    const orders = new Set(rows.map((r) => r.id)).size;
    host.innerHTML = rows.length ? table(visibleColumns('orders', ORDER_COLUMNS), rows.slice(0, ui.shown), { rowAttrs: (r) => `class="clickable" data-order-row="${h(r.id)}"` })
      + moreFooter(ui, rows.length, orders === rows.length ? ['заказ', 'заказа', 'заказов'] : ['строка', 'строки', 'строк'])
      : empty('Заказы не найдены', ui.q ? 'Попробуйте другой номер, артикул или штрихкод.' : 'Под выбранные фильтры заказов нет.', 'orders');
    host.querySelectorAll('[data-order-row]').forEach((tr) => { tr.onclick = () => openDocument(tr.dataset.orderRow, true); });
    wireRows(host, ui, renderOrderRows);
  }

  // ---------- Поставки на WB ----------
  const SUPPLY_STYLE = { collecting: 'working', ready: 'waiting', shipped: 'ready' };
  function filteredSupplies() {
    const ui = state.ui.supplies;
    const rows = (state.data.supplies || []).filter((r) => matches(ui.q, [r.number, r.destination, r.mpSupplyId])
      && (ui.status === 'all' || r.status === ui.status) && (ui.dest === 'all' || (r.destination || '') === ui.dest) && inPeriod(r.createdAt, ui.period));
    const by = { new: (a, b) => new Date(b.createdAt) - new Date(a.createdAt), old: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
      unitsDesc: (a, b) => b.units - a.units, unitsAsc: (a, b) => a.units - b.units, ordersDesc: (a, b) => b.orders - a.orders, ordersAsc: (a, b) => a.orders - b.orders,
      ship: (a, b) => String(a.shipDate || '9').localeCompare(String(b.shipDate || '9')) };
    return rows.sort(by[ui.sort]);
  }
  // Что с уехавшей поставкой на WB (владелец 06.10.2026): сколько посылок
  // сортировочный центр уже принял и сколько ещё едет.
  function supplyWbCell(r) {
    if (!r.mpSupplyId) return '<span class="zero">—</span>';
    if (r.status !== 'shipped') return `<span class="zero">${r.mpBarcodeFile ? 'ждёт отправки' : '—'}</span>`;
    const subs = [r.ordersInTransit ? `ещё в пути ${n(r.ordersInTransit)}` : '', r.ordersCanceled ? `отменено ${n(r.ordersCanceled)}` : ''].filter(Boolean);
    return `<span class="cell-main">принято ${n(r.ordersAccepted)} из ${n(r.orders)}</span>${subs.map((s) => `<span class="cell-sub">${s}</span>`).join('')}`;
  }
  const SUPPLY_COLUMNS = [
    { key: 'num', title: 'Поставка', cell: (r) => `<button class="link-button nowrap" data-supply="${h(r.id)}">${h(r.number)}</button> ${sellerOrderMarketplace(r.marketplace || (r.mpSupplyId ? 'wb' : ''))}<span class="cell-sub">составлена ${h(when(r.createdAt))}</span>` },
    { key: 'dest', title: 'Куда и когда', cell: (r) => `<span class="cell-main">${h(r.destination || 'пункт ещё не выбран')}</span>${r.shipDate ? `<span class="cell-sub">отгрузка ${h(day(dateOnly(r.shipDate)))}</span>` : ''}` },
    { key: 'units', title: 'Штук', cls: 'n', cell: (r) => num(r.units) },
    { key: 'status', title: 'Статус', cls: 'c', cell: (r) => badge(r.statusName, SUPPLY_STYLE[r.status] || '') },
    { key: 'wb', title: 'Приёмка WB', cls: 'c', cell: supplyWbCell },
    { key: 'qr', title: 'QR', cls: 'c', cell: (r) => (r.mpBarcodeFile ? `<img class="qr-thumb" src="data:image/svg+xml;base64,${h(r.mpBarcodeFile)}" alt="QR поставки">` : `<span class="zero">${r.mpSupplyId ? 'после передачи в доставку' : '—'}</span>`) },
  ];
  function renderSupplies() {
    const ui = state.ui.supplies; const dests = [...new Set((state.data.supplies || []).map((r) => r.destination || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    $('view').innerHTML = (state.suppliesMore ? notice('Показана часть поставок', 'Загружены последние 1 000 поставок.', true) : '')
      + toolbar(searchBox('Номер поставки', ui.q),
      dropdown('s-status', { label: 'Статус', value: ui.status, options: [{ value: 'all', text: 'Все' }, { value: 'collecting', text: 'Собирается' }, { value: 'ready', text: 'Собрана, ждёт машину' }, { value: 'shipped', text: 'Уехала' }], onPick: (v) => { ui.status = v; ui.shown = state.prefs.rows; renderSupplies(); } })
      + dropdown('s-dest', { label: 'Куда', value: ui.dest, options: [{ value: 'all', text: 'Любой пункт' }, ...dests.map((d) => ({ value: d, text: d }))], onPick: (v) => { ui.dest = v; ui.shown = state.prefs.rows; renderSupplies(); } })
      + dropdown('s-sort', { label: 'Сортировка', value: ui.sort, options: [{ value: 'new', text: 'Сначала новые' }, { value: 'old', text: 'Сначала старые' }, { value: 'ship', text: 'По дате отгрузки' }, { value: 'unitsDesc', text: 'Больше штук' }, { value: 'unitsAsc', text: 'Меньше штук' }, { value: 'ordersDesc', text: 'Больше заказов' }, { value: 'ordersAsc', text: 'Меньше заказов' }], onPick: (v) => { ui.sort = v; renderSupplies(); } })
      + dropdown('s-period', { label: 'Составлена', value: ui.period, options: PERIODS, onPick: (v) => { ui.period = v; ui.shown = state.prefs.rows; renderSupplies(); } })
      + resetLink('supplies')) + '<div id="rows"></div>';
    wireView(ui, renderSupplies, renderSupplyRows);
    renderSupplyRows();
  }
  function renderSupplyRows() {
    const ui = state.ui.supplies; const rows = filteredSupplies(); const host = $('rows');
    host.innerHTML = rows.length ? table(SUPPLY_COLUMNS, rows.slice(0, ui.shown), { rowAttrs: (r) => `class="clickable" data-supply-row="${h(r.id)}"` }) + moreFooter(ui, rows.length, ['поставка', 'поставки', 'поставок'])
      + '<p class="note-line" style="margin-top:12px">QR поставки выдаёт Wildberries, когда склад передаёт её в доставку; его показывают на воротах сортировочного центра.</p>'
      : empty('Поставок нет', (state.data.supplies || []).length ? 'Под выбранные фильтры поставок нет.' : 'Когда менеджер склада составит поставку из ваших заказов, она появится здесь.', 'truck');
    host.querySelectorAll('[data-supply-row]').forEach((tr) => { tr.onclick = () => openSupply(tr.dataset.supplyRow); });
    wireRows(host, ui, renderSupplyRows);
  }
  function openSupply(id) {
    const r = (state.data.supplies || []).find((x) => x.id === id); if (!r) return; openDrawer(r.number, 'Поставка на WB');
    $('drawerBody').innerHTML = `<div class="drawer-meta"><span>${h(r.destination || 'Пункт ещё не выбран')}</span>${r.shipDate ? `<span>отгрузка <b>${h(day(dateOnly(r.shipDate)))}</b></span>` : ''}${badge(r.statusName, SUPPLY_STYLE[r.status] || '')}</div>`
      + `<div class="mini-stats"><div><span>Заказов</span><strong>${n(r.orders)}</strong></div><div><span>Штук</span><strong>${n(r.units)}</strong></div><div><span>Составлена</span><strong style="font-size:15px">${h(when(r.createdAt))}</strong></div></div>`
      + (r.mpBarcodeFile ? `<div class="supply-qr-big"><img src="data:image/svg+xml;base64,${h(r.mpBarcodeFile)}" alt="QR поставки"><div><div class="help">Поставка на WB</div><b>${h(r.mpSupplyId || '')}</b></div></div>` : '')
      + table([
        { title: 'Заказ', cell: (i) => h(i.order) }, { title: 'Фото', cls: 'w-photo', cell: (i) => photo(i.sku) },
        { title: 'Товар', cell: (i) => h(productName({ sku: i.sku, name: i.name })) },
        { title: 'Шт.', cls: 'n', cell: (i) => n(i.qty) }, { title: 'Статус', cls: 'c', cell: (i) => h(i.status) },
      ], r.items);
    wirePhotos($('drawerBody'));
  }

  // ---------- Приходы ----------
  // Путь привоза (владелец 26.09.2026): ждёт приёмки → машина приехала →
  // принимается → принят и размещён по ячейкам.
  const hm = (t) => (t ? String(t).slice(0, 5) : '');
  const windowText = (from, to) => (from && to ? `${hm(from)}–${hm(to)}` : from ? `с ${hm(from)}` : to ? `до ${hm(to)}` : '');
  const placesText = (boxes, pallets) => [boxes > 0 && counted(boxes, 'короб', 'короба', 'коробов'),
    pallets > 0 && counted(pallets, 'паллета', 'паллеты', 'паллет')].filter(Boolean).join(', ');
  function inboundState(r) {
    if (r.status === 'completed') return Number(r.unplaced_qty) > 0 ? ['Не всё в ячейках', 'waiting'] : ['Принят', 'ready'];
    if (r.status === 'in_progress') return ['Принимается', 'working'];
    return r.arrived_at ? ['Машина приехала', 'working'] : ['Ждёт приёмки', 'waiting'];
  }
  const diffOf = (r) => (r.status === 'completed' && r.done_qty != null ? Number(r.done_qty) - Number(r.declared_qty) : null);
  // Акт с расхождением ждёт ответа продавца: «согласен» или «не согласен».
  const awaitsVerdict = (r) => diffOf(r) != null && diffOf(r) !== 0 && !r.seller_verdict;
  function filteredInbound() {
    const ui = state.ui.documents;
    const statusOk = (r) => ui.status === 'all' || (ui.status === 'open' ? r.status === 'open' && !r.arrived_at
      : ui.status === 'arrived' ? r.status === 'open' && !!r.arrived_at : r.status === ui.status);
    const rows = state.data.documents.rows.filter((r) => r.direction === 'in'
      && matches(ui.q, [r.number, r.carrier, r.vehicle, r.inbound_comment, ...(r.received_by || [])])
      && statusOk(r)
      && (ui.diff === 'all' || (ui.diff === 'answer' ? awaitsVerdict(r) : ui.diff === 'with' ? diffOf(r) != null && diffOf(r) !== 0 : diffOf(r) === 0))
      && inPeriod(r.first_at || r.created_at, ui.period));
    const by = { new: (a, b) => new Date(b.created_at) - new Date(a.created_at), old: (a, b) => new Date(a.created_at) - new Date(b.created_at), units: (a, b) => Number(b.declared_qty) - Number(a.declared_qty) };
    return rows.sort(by[ui.sort]);
  }
  const INBOUND_COLUMNS = [
    { key: 'doc', title: 'Приход', locked: true, cell: (r) => `<button class="link-button nowrap" data-doc="${h(r.id)}">${h(r.number)}</button><span class="cell-sub">${counted(r.item_count, 'позиция', 'позиции', 'позиций')}</span>` },
    // Время выгрузки и места — подписью под датой: отдельными столбцами
    // таблица не помещалась в экран.
    { key: 'planned', title: 'Привезут', cls: 'n', cell: (r) => (r.source_document_type === 'seller_inbound' && r.source_document_date ? `${h(day(dateOnly(String(r.source_document_date).slice(0, 10))))}${windowText(r.planned_from, r.planned_to) ? `<span class="cell-sub">время выгрузки ${h(windowText(r.planned_from, r.planned_to))}</span>` : ''}${placesText(r.boxes, r.pallets) ? `<span class="cell-sub">${h(placesText(r.boxes, r.pallets))}</span>` : ''}` : '<span class="zero">—</span>') },
    { key: 'places', title: 'Мест', hidden: true, cell: (r) => (placesText(r.boxes, r.pallets) ? `<span class="cell-main" style="font-weight:400">${h(placesText(r.boxes, r.pallets))}</span>${r.weight_kg != null ? `<span class="cell-sub">${n(r.weight_kg)} кг</span>` : ''}` : '<span class="zero">—</span>') },
    { key: 'came', title: 'Машина приехала', cls: 'n', hidden: true, cell: (r) => (r.arrived_at ? h(when(r.arrived_at)) : '<span class="zero">ещё нет</span>') },
    { key: 'arrived', title: 'Начали выгрузку', cls: 'n', cell: (r) => (r.first_at ? h(when(r.first_at)) : '<span class="zero">ещё нет</span>') },
    { key: 'carrier', title: 'Кто привёз', cell: (r) => (r.carrier ? `<span class="cell-main">${h(r.carrier)}</span>${r.vehicle ? `<span class="cell-sub">машина ${h(r.vehicle)}</span>` : ''}` : '<span class="zero">—</span>') },
    { key: 'vehicle', title: 'Машина', cls: 'n', hidden: true, cell: (r) => h(r.vehicle || '—') },
    { key: 'declared', title: 'Заявлено', cls: 'n', cell: (r) => num(r.declared_qty) },
    { key: 'accepted', title: 'Принято', cls: 'n', cell: (r) => num(r.done_qty ?? null) },
    { key: 'diff', title: 'Расхождение', cls: 'n', cell: (r) => { const d = diffOf(r); if (d == null) return '<span class="zero">—</span>'; if (d === 0) return '<span class="zero">нет</span>'; return `<span class="row-note bad" style="margin:0">${d > 0 ? '+' : '−'}${n(Math.abs(d))}</span><span class="cell-sub">${r.seller_verdict === 'agreed' ? 'вы согласны' : r.seller_verdict === 'disputed' ? 'вы не согласны' : 'ждёт ответа'}</span>`; } },
    { key: 'who', title: 'Принимали', hidden: true, cell: (r) => h((r.received_by || []).join(', ') || '—') },
    { key: 'finished', title: 'Приёмка закончена', cls: 'n', hidden: true, cell: (r) => (r.status === 'completed' && r.last_at ? h(when(r.last_at)) : '—') },
    { key: 'status', title: 'Статус', cls: 'c', cell: (r) => badge(...inboundState(r)) },
    { key: 'talk', title: 'Переписка', cls: 'n', hidden: true, cell: (r) => (r.comment_count ? counted(r.comment_count, 'сообщение', 'сообщения', 'сообщений') : '<span class="zero">—</span>') },
    { key: 'papers', title: 'Документы', cls: 'n', hidden: true, cell: (r) => (r.document_count ? n(r.document_count) : '<span class="zero">—</span>') },
    { key: 'created', title: 'Оформлен', cls: 'n', hidden: true, cell: (r) => h(when(r.created_at)) },
    { key: 'comment', title: 'Комментарий', hidden: true, cell: (r) => h(r.inbound_comment || '—') },
  ];
  function renderDocuments() {
    const ui = state.ui.documents;
    $('view').innerHTML = toolbar(searchBox('Номер, перевозчик, машина', ui.q),
      dropdown('d-status', { label: 'Статус', value: ui.status, options: [{ value: 'all', text: 'Все' }, { value: 'open', text: 'Ждут приёмки' }, { value: 'arrived', text: 'Машина приехала' }, { value: 'in_progress', text: 'Принимаются' }, { value: 'completed', text: 'Приняты' }], onPick: (v) => { ui.status = v; ui.shown = state.prefs.rows; renderDocuments(); } })
      + dropdown('d-diff', { label: 'Расхождение', value: ui.diff, options: [{ value: 'all', text: 'Любое' }, { value: 'answer', text: 'Ждут вашего ответа' }, { value: 'with', text: 'Есть расхождение' }, { value: 'none', text: 'Без расхождения' }], onPick: (v) => { ui.diff = v; ui.shown = state.prefs.rows; renderDocuments(); } })
      + dropdown('d-period', { label: 'Период', value: ui.period, options: PERIODS, onPick: (v) => { ui.period = v; ui.shown = state.prefs.rows; renderDocuments(); } })
      + dropdown('d-sort', { label: 'Сортировка', value: ui.sort, options: [{ value: 'new', text: 'Сначала новые' }, { value: 'old', text: 'Сначала старые' }, { value: 'units', text: 'Больше штук' }], onPick: (v) => { ui.sort = v; renderDocuments(); } })
      + resetLink('documents'),
      columnChooser('documents', INBOUND_COLUMNS, renderDocuments) + `<button class="button primary" type="button" id="inboundButton">${icon('box')}Привезти товар</button>`)
      + '<div id="rows"></div>';
    $('inboundButton').onclick = () => openInbound();
    wireView(ui, renderDocuments, renderDocumentRows);
    renderDocumentRows();
  }
  function renderDocumentRows() {
    const ui = state.ui.documents; const rows = filteredInbound(); const host = $('rows');
    const answer = state.data.documents.rows.filter((r) => r.direction === 'in' && awaitsVerdict(r)).length;
    host.innerHTML = (answer && ui.diff !== 'answer' && !state.owner ? `<div class="notice warning">${icon('info')}<div><strong>${counted(answer, 'акт ждёт', 'акта ждут', 'актов ждут')} вашего ответа</strong><p>Склад принял не столько, сколько вы заявили. Откройте приход и ответьте: согласны или нет. <button class="link-button" id="showAnswer">Показать их</button></p></div></div>` : '')
      + (rows.length ? table(visibleColumns('documents', INBOUND_COLUMNS), rows.slice(0, ui.shown), { rowAttrs: (r) => `class="clickable" data-doc-row="${h(r.id)}"` }) + moreFooter(ui, rows.length, ['приход', 'прихода', 'приходов'])
      : empty('Приходов нет', state.data.documents.rows.some((r) => r.direction === 'in') ? 'Под выбранные фильтры приходов нет.' : 'Нажмите «Привезти товар» и загрузите таблицу, по которой собираете товар для склада.', 'inbox'));
    if ($('showAnswer')) $('showAnswer').onclick = () => { ui.diff = 'answer'; ui.shown = state.prefs.rows; renderDocuments(); };
    host.querySelectorAll('[data-doc-row]').forEach((tr) => { tr.onclick = () => openDocument(tr.dataset.docRow); });
    wireRows(host, ui, renderDocumentRows);
  }

  // ---------- Персональный прайс, начисления и выставленные счета ----------
  let billMonth = null, billRun = 0, billInvoices = [], billNextCursor = null;
  const rub = (v) => v == null ? '—' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
  // Сумма работы = количество × ставка строки, в копейках (проверка 05.10).
  const workAmount = (qty, rate) => { if (qty == null || rate == null || !Number.isInteger(Number(qty))) return null; const c = BigInt(Math.round(Number(rate) * 100)) * BigInt(Number(qty)); return `${c / 100n}.${String(c % 100n).padStart(2, '0')}`; };
  const billDate = (v) => v ? String(v).slice(0,10).split('-').reverse().join('.') : '—';
  const BILL_STATUS = {unpaid:'Ожидает оплаты',partial:'Оплачен частично',paid:'Оплачен',overdue:'Просрочен'};
  const BILL_SERVICE = {receiving:'Приёмка',picking:'Сборка заказов',returns:'Возвраты',storage:'Хранение'};
  function billLinesTable(lines){
    return table([
      {title:'Услуга',cell:l => '<span class="cell-main">' + h(l.title || BILL_SERVICE[l.service]) + '</span>' + ((l.details || []).length ? '<details class="bill-work"><summary>Работы и даты</summary>' + l.details.map(d => '<div>' + h(d.label || d.day || d.date || '') + ' · ' + n(d.qty) + ' · ' + h(rub(d.amount ?? workAmount(d.qty, l.rate))) + '</div>').join('') + '</details>' : '')},
      {title:'Количество',cls:'n',cell:l => n(l.qty)},
      {title:'Единица',cell:l => h(l.unit)},
      {title:'Цена',cls:'n',cell:l => l.missingTariff ? 'Нет цены на дату работы' : l.rate == null ? 'По истории цен' : h(rub(l.rate))},
      {title:'Сумма',cls:'n',cell:l => l.missingTariff ? 'Нужен прайс' : '<span class="strong-num">' + h(rub(l.amount)) + '</span>'}
    ],lines || []);
  }
  function sellerInvoiceHtml(i){
    return '<details class="seller-invoice" data-seller-invoice="' + h(i.id) + '"><summary><strong>Счёт ' + h(i.number) + '</strong><span>' + billDate(i.from) + ' — ' + billDate(i.to) + '</span><strong>' + h(rub(i.total)) + '</strong><span class="seller-invoice-status ' + h(i.status) + '">' + h(BILL_STATUS[i.status] || i.status) + '</span></summary><div class="seller-invoice-body">'
      + '<div class="seller-bill-facts"><span>Оплатить до <b>' + billDate(i.dueDate) + '</b></span><span>Оплачено <b>' + h(rub(i.paid)) + '</b></span><span>Осталось <b>' + h(rub(i.balance)) + '</b></span><button type="button" class="button" data-invoice-excel="' + h(i.id) + '">Выгрузить счёт в Excel</button></div>'
      + billLinesTable(i.lines)
      + '<h3>Полученные складом оплаты</h3>'
      + ((i.payments || []).length ? table([{title:'Дата',cell:p => billDate(p.paidOn)},{title:'Сумма',cls:'n',cell:p => h(rub(p.amount))},{title:'Комментарий',cell:p => h(p.note || '—')}],i.payments) : '<p class="help">Оплат пока не отмечено.</p>') + '</div></details>';
  }
  function renderSellerInvoices(){
    const host = $('sellerInvoices');
    if(!host) return;
    const open = new Set([...host.querySelectorAll('details[data-seller-invoice][open]')].map(e => e.dataset.sellerInvoice));
    host.innerHTML = '<h2>Выставленные счета</h2>' + (billInvoices.length ? billInvoices.map(sellerInvoiceHtml).join('') : empty('Счетов ещё нет','Склад пока не выставлял вам счёт за работу.','document'))
      + (billNextCursor ? '<button type="button" class="button" id="sellerInvoiceMore">Ещё счета</button>' : '');
    host.querySelectorAll('details[data-seller-invoice]').forEach(e => { e.open = open.has(e.dataset.sellerInvoice); });
    host.querySelectorAll('[data-invoice-excel]').forEach(button => { button.onclick = () => {
      const i = billInvoices.find(i => i.id === button.dataset.invoiceExcel);
      if(!i) return;
      const rows = [...i.lines,{title:'Итого по счёту',amount:i.total},{title:'Оплачено',amount:i.paid},{title:'Остаток',amount:i.balance}];
      runExport(button,() => exportExcel({file:'Счёт ' + i.number,sheet:'Счёт',title:'Счёт ' + i.number + ' — ' + state.profile.name,
        filterText:billDate(i.from) + ' — ' + billDate(i.to) + '. Оплатить до ' + billDate(i.dueDate),rows,
        columns:[{header:'Услуга',type:'text',get:l => l.title,min:24},{header:'Количество',type:'num',get:l => l.qty},
          {header:'Единица',type:'text',get:l => l.unit,min:18},{header:'Цена, ₽',type:'num',money:true,get:l => l.rate},
          {header:'Сумма, ₽',type:'num',money:true,get:l => l.amount}]}));
    }; });
    const more = $('sellerInvoiceMore');
    if(more) more.onclick = async () => {
      const run = billRun, viewRun = state.viewRun; more.disabled = true;
      try{
        const b = await api('/api/sellers/billing?month=' + encodeURIComponent(billMonth) + '&invoiceCursor=' + encodeURIComponent(billNextCursor));
        if(run !== billRun || viewRun !== state.viewRun) return;
        billInvoices.push(...b.invoices); billNextCursor = b.nextInvoiceCursor; renderSellerInvoices();
      }catch(e){toast('Не удалось загрузить счета: ' + e.message); more.disabled = false;}
    };
  }
  async function renderBilling(){
    const run = ++billRun, viewRun = state.viewRun;
    const zone = state.profile?.timezone || 'Europe/Moscow';
    if(!billMonth) billMonth = new Date().toLocaleDateString('sv-SE',{timeZone:zone}).slice(0,7);
    $('view').innerHTML = loading;
    let b;
    try{ b = await api('/api/sellers/billing?month=' + encodeURIComponent(billMonth)); }
    catch(e){ if(run === billRun && viewRun === state.viewRun) $('view').innerHTML = empty('Расчёты не загрузились',e.message); return; }
    if(run !== billRun || viewRun !== state.viewRun) return;
    if(!b.enabled){ renderBillingSoon(); return; }
    billInvoices = b.invoices || []; billNextCursor = b.nextInvoiceCursor;
    const t = b.tariff || {}, s = b.schedule || {};
    const cadence = {daily:'каждый день',weekly:'каждую неделю',monthly:'каждый месяц',custom:'каждые ' + s.intervalDays + ' дней'}[s.cadence];
    $('view').innerHTML = (state.owner && !b.shownToSeller ? notice('Клиент этот расчёт пока не видит','Показ включается в настройках персонального прайса клиента в разделе «Расчёты».',true) : '')
      + '<div class="seller-bill-toolbar"><label class="field"><span>Месяц начислений</span><input type="month" id="sellerBillMonth" value="' + h(billMonth) + '"></label><button type="button" class="button" data-bill-excel>Выгрузить начисления в Excel</button></div>'
      + '<section class="stat-strip"><div class="stat"><div class="stat-label">Начислено за выбранный месяц</div><div class="stat-value">' + h(rub(b.total)) + '</div><div class="stat-note">по вашему персональному прайсу услуг; выставленные счета — ниже</div></div></section>'
      + (b.lines?.length ? billLinesTable(b.lines) : empty('За этот месяц начислений нет','За выбранный месяц склад не записал оплачиваемую работу.','check'))
      + '<details class="seller-invoice"><summary><strong>Ваш прайс услуг</strong><span>' + (t.configured ? 'Персональные цены услуг' : 'Склад ещё не настроил ваш прайс') + '</span></summary><div class="seller-invoice-body">'
      + (t.configured ? table([{title:'Услуга',cell:l => h(l.title)},{title:'Цена',cls:'n',cell:l => h(rub(l.rate))},{title:'Единица',cell:l => h(l.unit)}],Object.entries(BILL_SERVICE).map(([k,title]) => ({title,rate:t.prices[k],unit:k === 'storage' ? (t.storageUnit === 'unit_day' ? 'штука в день' : 'место в день') : k === 'picking' ? 'заказ' : 'штука'}))) : '<p class="help">При отсутствии цены склад сначала настраивает прайс, затем выставляет счёт.</p>')
      + (t.history?.length ? '<details class="bill-work"><summary>История цен</summary>' + table([{title:'Действуют с',cell:x => billDate(x.effectiveFrom)},...Object.entries(BILL_SERVICE).map(([k,title]) => ({title,cls:'n',cell:x => h(rub(x.prices[k]))})),{title:'Хранение за',cell:x => x.storageUnit === 'unit_day' ? 'штуку в день' : 'место в день'}],t.history) + '</details>' : '')
      + '<p class="help">' + (s.enabled ? 'Счета выставляются ' + h(cadence) + '.' : 'Счета выставляются складом вручную.') + ' Срок оплаты: ' + h(s.paymentDays ?? 14) + ' дней после выставления. Суммы уже выставленных счетов сохраняются при изменении прайса.</p></div></details>'
      + '<div id="sellerInvoices"></div><p class="help">Упаковка и маркировка пока не учитываются: склад ещё не записывает эти операции для расчёта.</p>';
    $('sellerBillMonth').onchange = e => { if(e.target.value){billMonth = e.target.value;renderBilling();} };
    renderSellerInvoices();
    const xl = $('view').querySelector('[data-bill-excel]');
    xl.onclick = () => runExport(xl,() => exportExcel({file:'Начисления ' + billMonth,sheet:'Начисления',title:'Начисления — ' + state.profile.name,
      filterText:billMonth,rows:b.lines || [],columns:[{header:'Услуга',type:'text',get:l => l.title,min:24},{header:'Количество',type:'num',get:l => l.qty},
        {header:'Единица',type:'text',get:l => l.unit,min:18},{header:'Цена, ₽',type:'num',money:true,get:l => l.rate},{header:'Сумма, ₽',type:'num',money:true,get:l => l.amount}]}));
  }
  function renderBillingSoon(){
    $('view').innerHTML = notice('Склад пока не открыл вам расчёты','После включения здесь будут ваш персональный прайс, начисления, отдельные счета и отмеченные складом оплаты.');
  }

  // ---------- Склад брака ----------
  // Владелец 02.10.2026: у каждого продавца свой склад брака. Брак попадает
  // туда с приёмки, сборки, возврата или пересчёта; продавец решает, что с
  // ним делать (частями можно), склад выполняет. Склад может решить за
  // продавца — тогда продавцу приходит уведомление здесь же.
  const BUCKET = { defective: 'Брак', packaging_defect: 'Повреждена упаковка', good: 'Годное' };
  const ACTIONS = {
    return_to_seller: { title: 'Вернуть мне', text: 'Склад выдаст брак вам или вашему курьеру по акту выдачи. Когда забрать — договоритесь с менеджером склада.' },
    dispose: { title: 'Утилизировать', text: 'Склад утилизирует брак и составит акт утилизации. Товар уйдёт с вашего остатка навсегда.' },
    repack: { title: 'Перепаковать и вернуть в продажу', text: 'Когда сам товар цел, а повреждена упаковка. Склад переупакует его, и он вернётся в обычный остаток — его снова можно продавать.' },
    markdown: { title: 'Уценка отдельным товаром', text: 'Что такое уценка: товар с дефектом продаётся дешевле, отдельной карточкой на Wildberries. Сначала создайте в кабинете WB карточку уценённого товара, потом впишите сюда её штрихкод. Склад наклеит этот штрихкод, и товар появится в остатке как «название — уценка».' },
  };
  const DONE = { return_to_seller: 'выдан', dispose: 'утилизирован', repack: 'перепакован, в продаже', markdown: 'в продаже как уценка' };
  function defectAttention() {
    const d = state.data.defects; if (!d) return 0;
    const waiting = d.balances.filter((b) => b.undecided > 0).length;
    return waiting + (state.owner ? 0 : d.decisions.filter((x) => x.unseen).length);
  }
  function filteredDefects() {
    const ui = state.ui.defects;
    return state.data.defects.moves.filter((e) => matches(ui.q, [e.name, e.sku, e.note, e.document, e.number, ...wbIds(e.sku)])
      && (ui.source === 'all' || e.source === ui.source) && (ui.kind === 'all' || e.bucket === ui.kind) && inPeriod(e.at, ui.period));
  }
  const whoDecided = (x) => (x.decidedRole === 'seller' ? (state.owner ? 'Продавец' : 'Вы') : x.decidedName || 'Склад');
  // Решение выполнено частями или на найденное (проверка 03.10.2026).
  const doneOf = (x) => (Number(x.doneQty) > 0 && Number(x.doneQty) < Number(x.qty)
    ? `<span class="cell-sub">${x.status === 'done' ? 'выполнено' : 'сделано'} ${n(x.doneQty)} из ${n(x.qty)} шт.${x.status === 'done' ? ' — брака оказалось меньше' : ''}</span>`
    : x.status === 'done' && Number(x.doneQty) === 0 && x.doneQty != null ? '<span class="cell-sub">брака на складе не оказалось</span>' : '');
  const actLink = (x) => (x.status === 'done' && (x.action === 'return_to_seller' || x.action === 'dispose')
    ? `<a class="link-button" href="act_print.html?kind=defect&id=${encodeURIComponent(x.id)}" target="_blank" rel="noopener">${x.action === 'dispose' ? 'Акт утилизации' : 'Акт выдачи'}</a>` : '');
  function renderDefects() {
    const ui = state.ui.defects; const d = state.data.defects;
    const total = d.balances.reduce((s, r) => s + r.qty, 0);
    const undecided = d.balances.reduce((s, r) => s + r.undecided, 0);
    const unseen = state.owner ? [] : d.decisions.filter((x) => x.unseen);
    const sources = [...new Map(d.moves.map((e) => [e.source, e.sourceName])).entries()];
    $('view').innerHTML = (unseen.length ? `<div class="notice">${icon('info')}<div><strong>Склад решил по вашему браку без вас: ${counted(unseen.length, 'решение', 'решения', 'решений')}</strong>`
        + unseen.slice(0, 5).map((x) => `<p>${h(x.decidedName || 'Склад')}: «${h(ACTIONS[x.action].title)}» — ${h(x.name || x.sku)}, ${n(x.qty)} шт.${x.note ? ' · ' + h(x.note) : ''}</p>`).join('')
        + `<p><button class="link-button" id="defectSeen">Понятно</button></p></div></div>` : '')
      + (undecided ? notice(state.owner ? `Продавец не решил по ${counted(undecided, 'штуке', 'штукам', 'штукам')} брака` : `${counted(undecided, 'штука', 'штуки', 'штук')} брака ждут вашего решения`,
        state.owner ? 'Решите за продавца, если он попросил по телефону: продавец увидит, кто решил.' : 'Нажмите «Решить» у товара: вернуть вам, утилизировать, перепаковать или продать уценкой. Можно частями.', true) : '')
      + `<div class="section-title" style="margin-top:0"><h2>Сейчас на складе брака</h2><span>${total ? counted(total, 'штука', 'штуки', 'штук') + ' · ' + counted(d.balances.length, 'товар', 'товара', 'товаров') : 'брака нет'}</span></div>`
      + (d.balances.length ? table([
        { title: 'Фото', cls: 'w-photo', cell: (r) => photo(r.sku) },
        { title: 'Товар', cell: (r) => `<button class="link-button" data-open-product="${h(r.sku)}">${h(r.name)}</button>${wbIds(r.sku).length ? `<span class="cell-sub">Артикул WB: ${h(wbIds(r.sku).join(', '))}</span>` : ''}` },
        { title: 'Что с товаром', cell: (r) => badge(BUCKET[r.bucket] || r.bucket, 'issue') },
        { title: 'Всего', cls: 'n', cell: (r) => num(r.qty, true) },
        { title: 'Ждёт решения', cls: 'n', cell: (r) => num(r.undecided) },
        { title: 'Решено', cls: 'n', cell: (r) => num(r.decided) },
        { title: 'Лежит с', cls: 'n', cell: (r) => h(r.since ? day(r.since) : '—') },
        { title: 'Решение', cell: (r) => (r.undecided > 0 ? `<button class="button primary" type="button" data-decide="${h(r.sku)}" data-bucket="${h(r.bucket)}">Решить</button>` : '<span class="muted">решено</span>') },
      ], d.balances) : '<div class="table-wrap">' + empty('Брака на складе нет', 'Если склад признает ваш товар браком, он появится здесь, и вы решите, что с ним делать.', 'check') + '</div>')
      + `<div class="section-title"><h2>Решения</h2><span>${counted(d.decisions.length, 'решение', 'решения', 'решений')}</span></div>`
      + (d.decisions.length ? table([
        { title: 'Товар', cell: (x) => `<span class="cell-main">${h(x.name || x.sku)}</span><span class="cell-sub">${h(x.number)} · ${h(BUCKET[x.bucket] || x.bucket)}</span>` },
        { title: 'Решение', cell: (x) => `<span class="cell-main">${h(ACTIONS[x.action].title)}</span>${x.markdownBarcode ? `<span class="cell-sub">Штрихкод уценки: ${h(x.markdownBarcode)}</span>` : ''}${x.note ? `<span class="cell-sub">${h(x.note)}</span>` : ''}` },
        { title: 'Кол-во', cls: 'n', cell: (x) => num(x.qty) },
        { title: 'Кто решил', cell: (x) => `<span class="cell-main">${h(whoDecided(x))}</span><span class="cell-sub">${h(when(x.decidedAt))}</span>` },
        { title: 'Склад', cell: (x) => (x.status === 'done' ? `${badge('Готово: ' + DONE[x.action], 'ready')}<span class="cell-sub">${h(when(x.doneAt))}</span>${doneOf(x)}${actLink(x)}` : badge('Ждёт склада', 'waiting') + doneOf(x)) },
      ], d.decisions) : '<div class="table-wrap">' + empty('Решений пока нет', 'Здесь будет видно, что вы решили по браку и когда склад это выполнил.', 'document') + '</div>')
      + (d.hasMore ? notice('Показана часть документов', 'Загружены последние 1 000 перемещений на склад брака.', true) : '')
      + `<div class="section-title"><h2>Как брак попал на склад</h2><span>${counted(d.moves.length, 'документ', 'документа', 'документов')}</span></div>`
      + toolbar(searchBox('Товар, артикул WB, описание, номер', ui.q),
        dropdown('f-source', { label: 'Откуда', value: ui.source, options: [{ value: 'all', text: 'Отовсюду' }, ...sources.map(([value, text]) => ({ value, text }))], onPick: (v) => { ui.source = v; ui.shown = state.prefs.rows; renderDefects(); } })
        + dropdown('f-kind', { label: 'Что с товаром', value: ui.kind, options: [{ value: 'all', text: 'Любое' }, { value: 'defective', text: 'Брак' }, { value: 'packaging_defect', text: 'Повреждена упаковка' }], onPick: (v) => { ui.kind = v; ui.shown = state.prefs.rows; renderDefects(); } })
        + dropdown('f-period', { label: 'Период', value: ui.period, options: PERIODS, onPick: (v) => { ui.period = v; ui.shown = state.prefs.rows; renderDefects(); } })
        + resetLink('defects'))
      + '<div id="rows"></div>';
    wirePhotos($('view'));
    $('view').querySelectorAll('[data-decide]').forEach((b) => { b.onclick = () => openDecision(b.dataset.decide, b.dataset.bucket); });
    if ($('defectSeen')) {
      $('defectSeen').onclick = async () => {
        try { await api('/api/sellers/defects/seen', { method: 'POST' }); d.decisions.forEach((x) => { x.unseen = false; }); renderDefects(); renderNav(); }
        catch (e) { toast(e.message); }
      };
    }
    wireView(ui, renderDefects, renderDefectRows);
    renderDefectRows();
  }
  function renderDefectRows() {
    const ui = state.ui.defects; const rows = filteredDefects(); const host = $('rows');
    host.innerHTML = rows.length ? table([
      { title: 'Фото', cls: 'w-photo', cell: (e) => photo(e.sku) },
      { title: 'Товар', cell: (e) => `<span class="cell-main">${h(e.name || e.sku)}</span>${wbIds(e.sku).length ? `<span class="cell-sub">Артикул WB: ${h(wbIds(e.sku).join(', '))}</span>` : ''}` },
      { title: 'Кол-во', cls: 'n', cell: (e) => num(e.qty) },
      { title: 'Что с товаром', cell: (e) => `${badge(BUCKET[e.bucket] || e.bucket, 'issue')}${e.note ? `<span class="cell-sub">${h(e.note)}</span>` : ''}${e.hasPhoto ? `<button class="link-button" type="button" data-defect-photo="${h(e.id)}">Фото брака</button>` : ''}` },
      { title: 'Откуда', cell: (e) => `<span class="cell-main">${h(e.sourceName)}</span><span class="cell-sub">${h([e.number, e.document].filter(Boolean).join(' · '))}</span>` },
      { title: 'Когда', cls: 'n', cell: (e) => h(when(e.at)) },
    ], rows.slice(0, ui.shown)) + moreFooter(ui, rows.length, ['документ', 'документа', 'документов'])
      : '<div class="table-wrap">' + empty('Ничего не найдено', state.data.defects.moves.length ? 'Под выбранные фильтры документов нет.' : 'Склад ещё не признавал ваш товар браком.', 'check') + '</div>';
    wireDefectPhotos(host);
    wireRows(host, ui, renderDefectRows);
  }
  function wireDefectPhotos(host) {
    host.querySelectorAll('[data-defect-photo]').forEach((b) => {
      b.onclick = async () => {
        // Окно открываем сразу, по нажатию: иначе браузер примет его за всплывающее.
        const w = window.open('', '_blank'); b.disabled = true;
        try {
          const response = await fetch('https://api.argus-ai.online/api/defects/moves/' + encodeURIComponent(b.dataset.defectPhoto) + '/photo', { headers: { Authorization: 'Bearer ' + state.token }, cache: 'no-store' });
          if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Фото не открылось');
          const url = URL.createObjectURL(await response.blob());
          if (w) w.location.href = url; else location.href = url;
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (e) { if (w) w.close(); toast(e.message); }
        b.disabled = false;
      };
    });
  }
  // Решение по браку: что сделать, сколько штук (можно часть), для уценки —
  // штрихкод карточки уценки на WB.
  function openDecision(sku, bucket) {
    const r = state.data.defects.balances.find((x) => x.sku === sku && x.bucket === bucket); if (!r) return;
    openDrawer(r.name, 'Решение по браку');
    const pick = { action: '' };
    const draw = () => {
      $('drawerBody').innerHTML = `<div class="mini-stats">${mini('На складе брака', r.qty)}${mini('Ждёт решения', r.undecided)}${mini('Уже решено', r.decided)}</div>`
        + `<p class="help" style="margin-bottom:12px">${h(BUCKET[r.bucket])}${r.since ? ', лежит с ' + h(day(r.since)) : ''} — что с ним сделать?</p>`
        + `<div class="decide-options">${Object.entries(ACTIONS).map(([key, a]) => `<button type="button" class="decide-option" data-action="${key}" aria-pressed="${pick.action === key}"><strong>${h(a.title)}</strong><span>${h(a.text)}</span></button>`).join('')}</div>`
        + (pick.action ? '<div class="settings-form" style="margin-top:16px">'
          + `<label class="field"><span>Сколько штук — можно часть, остальное решите потом</span><input id="decQty" type="number" inputmode="numeric" min="1" max="${r.undecided}" value="${r.undecided}"></label>`
          + (pick.action === 'markdown' ? '<label class="field"><span>Штрихкод карточки уценки на WB</span><input id="decBarcode" inputmode="numeric" maxlength="64" placeholder="Например: 2040000000017"></label>' : '')
          + `<label class="field"><span>Комментарий складу — не обязательно</span><textarea id="decNote" rows="2" maxlength="300" placeholder="${pick.action === 'return_to_seller' ? 'Например: заберёт курьер в пятницу' : 'Например: только те, где вмятина'}"></textarea></label>`
          + (state.owner ? '<p class="help">Вы решаете за продавца: в его кабинете будет видно, кто решил, и придёт уведомление.</p>' : '')
          + '<div class="drawer-actions"><button class="button primary" type="button" id="decSend">Отправить складу</button></div><p class="error-text" id="decError"></p></div>' : '');
      $('drawerBody').querySelectorAll('[data-action]').forEach((b) => { b.onclick = () => { pick.action = b.dataset.action; draw(); $('decQty')?.scrollIntoView({ block: 'nearest' }); }; });
      if (!$('decSend')) return;
      $('decSend').onclick = async () => {
        const qty = Number($('decQty').value); const barcode = $('decBarcode')?.value.trim();
        if (!Number.isInteger(qty) || qty < 1 || qty > r.undecided) { $('decError').textContent = `Сколько штук — от 1 до ${n(r.undecided)}`; return; }
        if (pick.action === 'markdown' && !barcode) { $('decError').textContent = 'Впишите штрихкод карточки уценки'; $('decBarcode').focus(); return; }
        $('decSend').disabled = true;
        try {
          await api('/api/sellers/defects/decisions', { method: 'POST', body: { sku: r.sku, bucket: r.bucket, qty, action: pick.action, markdownBarcode: barcode || undefined, note: $('decNote').value.trim() || undefined } });
          $('drawer').close(); toast(`Решение отправлено складу: ${ACTIONS[pick.action].title.toLowerCase()}, ${n(qty)} шт.`); navigate(true);
        } catch (e) { $('decError').textContent = e.message; $('decSend').disabled = false; }
      };
    };
    draw();
  }

  // ---------- Карточки ----------
  function openDrawer(title, eyebrow) {
    state.drawerRun += 1; $('drawerTitle').textContent = title; $('drawerTitle').classList.remove('open'); $('drawerEyebrow').textContent = eyebrow; $('drawerBody').innerHTML = loading;
    if (!$('drawer').open) $('drawer').showModal();
    return state.drawerRun;
  }
  $('closeDrawer').onclick = () => $('drawer').close();
  // Длинное название — три строки, целиком по нажатию: на телефоне числа
  // карточки не должны уезжать под название (рецензия 04.10).
  $('drawerTitle').onclick = () => $('drawerTitle').classList.toggle('open');
  $('drawer').addEventListener('close', () => { state.drawerRun += 1; });
  $('drawer').addEventListener('click', (e) => { if (e.target === $('drawer') && e.clientX < $('drawer').getBoundingClientRect().left) $('drawer').close(); });
  const mini = (label, value) => `<div><span>${h(label)}</span><strong>${value == null ? '—' : n(value)}</strong></div>`;
  // Число над списком заказов — кнопка: переключает список под собой.
  const miniBucket = (bucket, value) => `<button type="button" class="mini-link" data-mini-bucket="${bucket}"><span>${h(BUCKETS[bucket].title)}</span><strong>${n(value)}</strong></button>`;
  const BUCKET_COLUMNS = [
    { key: 'order', title: 'Заказ WB', cell: (x) => `<span class="cell-main nowrap">${h(x.number)}</span>${x.mp_rid ? `<span class="cell-sub rid">${h(x.mp_rid)}</span>` : ''}` },
    { key: 'at', title: 'Дата', cls: 'n', cell: (x) => (orderAt(x) ? `${h(day(orderAt(x)))}<span class="cell-sub">${h(clock(orderAt(x)))}</span>` : '—') },
    { key: 'supply', title: 'Поставка', cell: (x) => (x.supply_number ? `<span class="cell-main nowrap">${h(x.supply_number)}</span>${x.supply_destination ? `<span class="cell-sub">${h(x.supply_destination)}</span>` : ''}` : '<span class="zero">нет</span>') },
    { key: 'status', title: 'Статус', cell: (x) => badge(orderStatus(x), orderStyle(x)) },
    { key: 'qty', title: 'Шт.', cls: 'n', cell: (x) => num(x.qty) },
  ];

  // «Почему доступно именно столько» (рецензия 04.10, рекомендация 3): то же
  // правило, что у сервера (sellers/stock.js), словами и с числами товара.
  function whyAvailable(r) {
    if (!('total' in r)) return '';
    if (r.total == null) return '<p class="why-available">Доступно не посчитать: учёта по этому товару у склада пока нет.</p>';
    const ord = Number(r.ordered || 0); const asm = Number(r.inAssembly || 0); const raw = Number(r.total) - ord - asm;
    if (Math.max(0, raw) !== Number(r.available)) return '';
    return `<p class="why-available"><b>Почему доступно ${n(r.available)}:</b> всего ${n(r.total)} − заказано ${n(ord)} − в сборке ${n(asm)}`
      + (raw < 0 ? ` = ${n(raw)}. Заказов больше, чем товара, поэтому доступно 0 — склад сверяет.` : ` = ${n(raw)}.`)
      + (Number(r.inTransit) ? ' «В пути» не вычитается: этот товар уже уехал со склада.' : '')
      + (ord || asm ? ' Нажмите «Заказано» или «В сборке» — увидите сами заказы.' : '') + '</p>';
  }
  async function openProduct(sku, bucket = null) {
    const r = (state.data.stock || []).find((x) => x.sku === sku)
      || (state.data.defects?.balances || []).find((x) => x.sku === sku) || { sku, name: sku };
    const run = openDrawer(productName(r), 'Карточка товара');
    const ids = wbIds(sku);
    $('drawerBody').innerHTML = `<div class="drawer-meta"><span>Артикул WB <b>${h(ids.join(', ') || 'не передан')}</b></span><span>Штрихкод <b>${h(r.barcode || 'не указан')}</b></span>${vendorCodes(sku).length ? `<span>Артикул продавца <b>${h(vendorCodes(sku).join(', '))}</b></span>` : ''}</div>`
      + `<div class="mini-stats">${mini('Всего', r.total ?? null)}${miniBucket('ordered', Number(r.ordered || 0))}${miniBucket('assembly', Number(r.inAssembly || 0))}${miniBucket('transit', Number(r.inTransit || 0))}${mini('Доступно', r.available ?? null)}${mini('Брак', r.defective || 0)}</div>`
      + whyAvailable(r) + productVwHtml(r)
      + `<section class="detail-section" id="bucketSection"><h3>Какие заказы за этими числами</h3><div id="bucketOrders">${loading}</div></section>`
      + `<div class="drawer-actions"><button class="button" id="productOrders">Все заказы с этим товаром</button>${ids[0] ? `<a class="button ghost" href="${h(wbLink(ids[0]))}" target="_blank" rel="noopener">Карточка на WB</a>` : ''}</div>`
      + `<section class="detail-section"><h3>Движение товара</h3><div id="productHistory">${loading}</div></section>`
      + (r.updatedAt ? `<p class="help" style="margin-top:20px">Учёт на ${h(when(r.updatedAt))}</p>` : '');
    $('productOrders').onclick = () => { Object.assign(state.ui.orders, state.defaults.orders(), { q: ids[0] || productName(r), shown: state.prefs.rows }); $('drawer').close(); location.hash = 'orders'; };
    wireProductVw(r);
    showBucketOrders(r, bucket, run);
    const events = []; let cursor = null; let busy = false;
    async function more() {
      if (busy || run !== state.drawerRun) return; busy = true;
      try {
        const data = await api('/api/sellers/history?sku=' + encodeURIComponent(sku) + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
        if (run !== state.drawerRun) return;
        events.push(...data.events); cursor = data.nextCursor || null;
        $('productHistory').innerHTML = events.length ? `<ol class="timeline">${events.map(historyEvent).join('')}</ol>${cursor ? '<button class="button" id="historyMore" style="margin-top:16px">Показать ещё</button>' : ''}`
          : '<p class="help">Склад ещё не записывал операций по этому товару.</p>';
        if ($('historyMore')) $('historyMore').onclick = more;
      } catch (e) {
        if (run === state.drawerRun) $('productHistory').innerHTML = `<p class="error-text">${h(e.message)}</p><button class="button" id="historyMore">Повторить</button>`;
        if ($('historyMore')) $('historyMore').onclick = more;
      } finally { busy = false; }
    }
    await more();
  }
  // Заказы за числами «Заказано», «В сборке», «В пути». Берём с сервера по
  // одному товару: общий список заказов обрезан тысячей строк, и у продавца
  // побольше «В пути» уехавшие заказы в него уже не попадали бы.
  async function showBucketOrders(r, bucket, run) {
    const box = $('bucketOrders');
    let rows;
    try {
      rows = (await api('/api/sellers/orders?sku=' + encodeURIComponent(r.sku))).rows || [];
    } catch (e) {
      if (run === state.drawerRun && $('bucketOrders')) box.innerHTML = `<p class="error-text">${h(e.message)}</p>`;
      return;
    }
    if (run !== state.drawerRun || !$('bucketOrders')) return;
    const by = { ordered: [], assembly: [], transit: [] };
    rows.forEach((x) => { if (by[x.bucket]) by[x.bucket].push(x); });
    const qty = (list) => list.reduce((a, x) => a + Number(x.qty || 0), 0);
    const orders = (list) => new Set(list.map((x) => x.id)).size;
    let current = bucket && by[bucket] ? bucket : Object.keys(by).find((k) => by[k].length) || 'ordered';
    const draw = () => {
      const list = by[current].slice().sort((a, b) => new Date(orderAt(b)) - new Date(orderAt(a)));
      // Список свежее таблицы (пришли новые заказы) — говорим прямо, а не
      // показываем под числом «3» четыре заказа молча.
      const all = { ordered: Number(r.ordered || 0), assembly: Number(r.inAssembly || 0), transit: Number(r.inTransit || 0) };
      const stale = Object.keys(BUCKETS).filter((k) => qty(by[k]) !== all[k]);
      box.innerHTML = `<div class="segmented bucket-tabs" role="tablist" aria-label="Заказы за числами">${Object.keys(BUCKETS).map((k) => `<button type="button" role="tab" aria-selected="${k === current}" data-bucket-tab="${k}">${h(BUCKETS[k].title)} · ${n(qty(by[k]))} шт.</button>`).join('')}</div>`
        + `<p class="help bucket-note">${h(BUCKETS[current].title)} — ${h(BUCKETS[current].note)}.${list.length ? ' ' + h(counted(orders(list), 'заказ', 'заказа', 'заказов')) + ', ' + h(n(qty(list))) + ' шт.' : ''}</p>`
        + (stale.length ? `<p class="help bucket-note warn">Пока открыта страница, заказы изменились — числа в таблице обновятся по кнопке «Обновить».</p>` : '')
        + (list.length ? table(BUCKET_COLUMNS, list) : `<p class="help">Таких заказов по этому товару сейчас нет.</p>`);
      box.querySelectorAll('[data-bucket-tab]').forEach((b) => { b.onclick = () => { current = b.dataset.bucketTab; draw(); }; });
    };
    draw();
    document.querySelectorAll('[data-mini-bucket]').forEach((b) => {
      b.onclick = () => { current = b.dataset.miniBucket; draw(); $('bucketSection').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    });
    if (bucket) $('bucketSection').scrollIntoView({ block: 'start' });
  }

  function historyEvent(e) {
    const labels = { received: 'Принято на склад', picked: 'Собрано для заказа', shipped: 'Отгружено со склада', returned: 'Возврат', add: 'Добавлено', remove: 'Списано', move: 'Перемещение', adjust: 'Корректировка', set: 'Пересчёт', inventory_adjust: 'Пересчёт', inventory: 'Пересчёт', kit_assemble: 'Собран набор', repack: 'Перепаковка', canceled_pick_return: 'Возвращено после отмены WB', initial_load: 'Начальный остаток на складе', initial_load_undo: 'Отмена начального остатка', defect_in: 'Отмечено браком — на складе брака', defect_return_to_seller: 'Брак выдан вам', defect_dispose: 'Брак утилизирован', defect_repack: 'Брак перепакован — снова в продаже', defect_markdown: 'Брак переклеен на уценку', vw_transfer: 'Перенос между вашими складами' };
    const sign = ['received', 'returned', 'initial_load'].includes(e.kind) ? '+' : ['shipped', 'initial_load_undo'].includes(e.kind) ? '−' : '';
    return `<li><div class="timeline-line"><strong>${h(labels[e.kind] || 'Операция склада')}</strong><span>${sign}${n(e.qty)} шт.</span></div><time>${e.at ? h(when(e.at)) : 'время не сохранено'}</time>${e.document ? `<p>${h(e.document)}</p>` : ''}${e.supplyNumber ? `<p>Поставка ${h(e.supplyNumber)}</p>` : ''}${e.quality ? `<p>${h(BUCKET[e.quality] || e.quality)}</p>` : ''}${e.note ? `<p>${h(e.note)}</p>` : ''}</li>`;
  }

  async function openDocument(id, order = false) {
    const list = order ? state.data.orders.rows : state.data.documents.rows;
    const selected = list.find((r) => r.id === id); if (!selected) return;
    if (!order && selected.direction === 'in') return openInboundCard(id);
    const kind = order ? 'Заказ' : selected.direction === 'return' ? 'Возврат' : 'Приход';
    const run = openDrawer(selected.number, kind);
    try {
      const data = await api('/api/invoices/' + encodeURIComponent(id)); if (run !== state.drawerRun) return;
      const items = data.items.map((r) => ({ ...r,
        finalized: data.direction === 'return' ? data.status === 'completed' : data.direction === 'out' ? r.closed : r.accepted_qty != null,
        accepted: data.direction === 'return' ? (r.buckets?.length || data.status === 'completed' ? Number(r.returned_qty) : null) : data.direction === 'out' ? Number(r.picked_qty) : r.accepted_qty == null ? null : Number(r.accepted_qty) }));
      const detail = { ...selected, ...data };
      detail.stock_conflict = !!(detail.mp_closed_at && !detail.mp_stock_returned_at && detail.status !== 'shipped' && (detail.mp_close_reason === 'fulfilled' || items.some((r) => Number(r.picked_qty) > 0)));
      const declared = items.reduce((s, r) => s + Number(r.declared_qty), 0); const complete = items.every((r) => r.finalized); const done = items.reduce((s, r) => s + Number(r.accepted || 0), 0);
      const doneWord = order ? 'Собрано' : data.direction === 'return' ? 'Разобрано' : 'Принято';
      const statusBadge = order ? badge(orderStatus(detail), orderStyle(detail))
        : badge(...(RETURN_STATUS[data.status] || [data.status]));
      items.sort((a, b) => Number(b.finalized && b.accepted !== Number(b.declared_qty)) - Number(a.finalized && a.accepted !== Number(a.declared_qty)));
      $('drawerBody').innerHTML = `<div class="drawer-meta"><span>Загружено ${h(when(data.created_at))}</span>${statusBadge}</div>`
        + (order && detail.stock_conflict ? notice('Заказ закрыт на Wildberries', detail.mp_close_reason === 'fulfilled' ? 'WB сообщил о завершении, а отгрузка в Аргусе ещё не подтверждена. До сверки количество остаётся в сборке.' : 'Товар уже был собран. Склад возвращает его на полку; до этого он учтён в сборке.', true) : '')
        + `<div class="mini-stats">${mini('Заявлено', declared)}${mini(doneWord, items.some((r) => r.accepted !== null) ? done : null)}${mini('Расхождение', complete ? done - declared : null)}</div>`
        + (!complete ? '<p class="help" style="margin-bottom:16px">Работа ещё идёт: показано уже сделанное, расхождение появится в конце.</p>' : '')
        + `<section class="detail-section" style="margin-top:0"><h3>Позиции · ${items.length}</h3><div class="receipt-lines">${items.map((r) => {
          const dec = Number(r.declared_qty); const diff = r.finalized && r.accepted !== dec; const scale = Math.max(1, dec, r.accepted || 0);
          return `<article class="receipt-item ${diff ? 'issue' : ''}"><h3>${h(productName(r))}</h3><span class="cell-sub">Артикул WB: ${h((order ? [selected.mp_nm_id] : wbIds(r.sku)).filter(Boolean).join(', ') || 'не передан')}</span>${diff ? `<span class="row-note bad">Расхождение: ${n(r.accepted - dec)} шт.</span>` : ''}`
            + `<div class="receipt-bars"><div class="receipt-bar"><span>Заявлено</span><div class="track"><i style="width:${dec / scale * 100}%"></i></div><span class="num">${n(dec)}</span></div><div class="receipt-bar"><span>${doneWord}</span><div class="track accepted"><i style="width:${(r.accepted || 0) / scale * 100}%"></i></div><span class="num">${r.accepted == null ? '—' : n(r.accepted)}</span></div></div>`
            + (r.buckets || []).map((b) => `<p class="row-note ${b.qualityBucket === 'good' ? '' : 'bad'}">${h(BUCKET[b.qualityBucket] || b.qualityBucket)}: ${n(b.qty)} шт.${b.defectNote ? ' — ' + h(b.defectNote) : ''}</p>`).join('') + '</article>';
        }).join('')}</div></section>`
        + `<div class="drawer-actions">${!order && data.direction === 'return' ? `<button class="button" id="exportDocument">${icon('download')}Excel этого возврата</button>` : ''}</div>`;
      const xl = $('exportDocument');
      if (xl) xl.onclick = () => runExport(xl, () => exportExcel({
        file: 'Возврат ' + selected.number, sheet: 'Возврат', title: `Возврат ${selected.number} — ${state.profile.name}`, filterText: '', rows: items,
        columns: [
          { header: 'Товар', type: 'text', get: (r) => productName(r), min: 30, max: 60 },
          { header: 'Артикул WB', type: 'text', get: (r) => wbIds(r.sku).join(', ') },
          { header: 'Заявлено, шт.', type: 'num', total: true, get: (r) => Number(r.declared_qty) },
          { header: 'Разобрано, шт.', type: 'num', total: true, get: (r) => r.accepted ?? null },
          { header: 'Годное, шт.', type: 'num', total: true, get: (r) => (r.buckets || []).filter((b) => b.qualityBucket === 'good').reduce((s, b) => s + Number(b.qty), 0) },
          { header: 'Брак, шт.', type: 'num', total: true, get: (r) => (r.buckets || []).filter((b) => b.qualityBucket !== 'good').reduce((s, b) => s + Number(b.qty), 0) },
          { header: 'Описание брака', type: 'text', get: (r) => (r.buckets || []).map((b) => b.defectNote).filter(Boolean).join('; '), max: 60 },
        ],
      }));
    } catch (e) { if (run === state.drawerRun) $('drawerBody').innerHTML = empty('Не удалось открыть', e.message); }
  }

  // ---------- Карточка привоза ----------
  // Всё о привозе в одном месте (владелец 26.09.2026): где он сейчас, что
  // заявлено и что приехало, документы поставщика, переписка со складом и
  // ответ на акт расхождений. Изменить и отменить — пока машина не приехала.
  const DOC_KINDS = ['УПД', 'ТТН', 'ТОРГ-12', 'Счёт-фактура', 'Накладная ТК', 'Другое'];
  const FILE_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };
  const FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic';
  const fileType = (file) => (Object.values(FILE_TYPES).includes(file.type) ? file.type : FILE_TYPES[(file.name.split('.').pop() || '').toLowerCase()] || '');
  const fileSize = (b) => (b >= 1048576 ? (b / 1048576).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' МБ' : Math.max(1, Math.round(b / 1024)) + ' КБ');
  function checkFile(file) {
    if (!fileType(file)) return 'Файл — PDF или фото (JPG, PNG, WEBP, HEIC)';
    if (file.size > 10 * 1048576) return 'Файл больше 10 МБ — сожмите скан или разбейте на части';
    return '';
  }
  async function uploadFile(invoiceId, docId, file) {
    const response = await fetch('https://api.argus-ai.online/api/inbound/' + encodeURIComponent(invoiceId) + '/documents/' + encodeURIComponent(docId) + '/file', {
      method: 'PUT', body: file,
      headers: { 'Content-Type': fileType(file), 'X-File-Name': encodeURIComponent(file.name), Authorization: 'Bearer ' + state.token },
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Файл не загрузился');
  }
  // Реквизиты документа и файл: сначала строка документа, потом файл к ней.
  async function saveDocument(invoiceId, doc) {
    const created = await api('/api/inbound/' + encodeURIComponent(invoiceId) + '/documents', { method: 'POST', body: { kind: doc.kind, number: doc.number, date: doc.date, supplier: doc.supplier } });
    if (doc.file) await uploadFile(invoiceId, created.id, doc.file);
  }
  // Поля документа поставщика — в форме привоза и в карточке. prefix — чтобы
  // не спутать поля двух форм; files — выбранный файл по prefix.
  const docState = {};
  function docKindPicker(prefix) {
    return dropdown(prefix + '-kind', { label: '', value: docState[prefix].kind, neutral: true,
      options: DOC_KINDS.map((k) => ({ value: k, text: k })),
      onPick: (v) => { docState[prefix].kind = v; const el = document.querySelector(`.dd[data-dd="${prefix}-kind"]`); if (el) el.outerHTML = docKindPicker(prefix); } });
  }
  function docFields(prefix) {
    docState[prefix] = { kind: 'УПД', file: null };
    return `<div class="doc-fields"><div class="two"><div class="field"><span>Вид документа</span>${docKindPicker(prefix)}</div><label class="field"><span>Номер</span><input id="${prefix}Number" maxlength="60" placeholder="123"></label></div>`
      + `<div class="two"><label class="field"><span>Дата документа</span><input type="date" id="${prefix}Date"></label><label class="field"><span>От кого — поставщик</span><input id="${prefix}Supplier" maxlength="200" placeholder="ООО «Поставщик»"></label></div>`
      + `<div class="field"><span>Файл — скан или PDF, до 10 МБ</span><div class="file-row"><label class="file-pick"><input type="file" id="${prefix}File" accept="${FILE_ACCEPT}"><span class="button">${icon('document')}Выбрать файл</span><span class="help" id="${prefix}FileName">Можно без файла</span></label><button class="button ghost" type="button" id="${prefix}FileDrop" hidden>Убрать файл</button></div></div></div>`;
  }
  function wireDocFields(prefix, onError) {
    $(prefix + 'File').onchange = (e) => {
      const file = e.target.files[0]; if (!file) return;
      const bad = checkFile(file); e.target.value = '';
      if (bad) { docState[prefix].file = null; $(prefix + 'FileName').textContent = 'Можно без файла'; $(prefix + 'FileDrop').hidden = true; onError(bad); return; }
      docState[prefix].file = file; $(prefix + 'FileName').textContent = file.name + ' · ' + fileSize(file.size); $(prefix + 'FileDrop').hidden = false; onError('');
    };
    // Ошиблись файлом — убрать его, а не только заменить (владелец 30.09.2026).
    $(prefix + 'FileDrop').onclick = () => {
      docState[prefix].file = null; $(prefix + 'FileName').textContent = 'Можно без файла'; $(prefix + 'FileDrop').hidden = true; onError('');
    };
  }
  function readDocFields(prefix) {
    const doc = { kind: docState[prefix].kind, number: $(prefix + 'Number').value.trim(), date: $(prefix + 'Date').value || null,
      supplier: $(prefix + 'Supplier').value.trim(), file: docState[prefix].file };
    return doc.number || doc.date || doc.supplier || doc.file ? doc : null;
  }

  async function openInboundCard(id, refresh = false) {
    const row = (state.data.documents?.rows || []).find((r) => r.id === id);
    const run = refresh ? state.drawerRun : openDrawer(row ? row.number : 'Приход', 'Приход');
    const scroll = $('drawerBody').scrollTop;
    try {
      const [c, data] = await Promise.all([api('/api/inbound/' + encodeURIComponent(id)), api('/api/invoices/' + encodeURIComponent(id)),
        state.data.defects ? null : api(API_PATH.defects).then((d) => { state.data.defects = d; }).catch(() => {})]);
      if (run !== state.drawerRun) return;
      $('drawerTitle').textContent = c.number;
      $('drawerBody').innerHTML = inboundCardHtml(c, data);
      wireInboundCard(c);
      if (refresh) $('drawerBody').scrollTop = scroll;
    } catch (e) { if (run === state.drawerRun) $('drawerBody').innerHTML = empty('Не удалось открыть', e.message); }
  }
  const cardUi = { about: '' };
  function aboutPicker(c) {
    return dropdown('comment-about', { label: 'О чём', value: cardUi.about, neutral: true,
      options: [{ value: '', text: 'Весь приход' }, ...c.lines.map((l) => ({ value: l.sku, text: productName(l) }))],
      onPick: (v) => { cardUi.about = v; const el = document.querySelector('.dd[data-dd="comment-about"]'); if (el) el.outerHTML = aboutPicker(c); } });
  }
  function inboundCardHtml(c, data) {
    const who = state.owner ? 'Продавец' : 'Вы';
    const steps = [
      ['Оформлен', c.createdAt, ''],
      ['Машина приехала', c.arrivedAt, placesText(c.arrivedBoxes, c.arrivedPallets) ? 'Мест: ' + placesText(c.arrivedBoxes, c.arrivedPallets) : ''],
      ['Начали приёмку', c.firstAt, ''],
      ['Принят', c.status === 'completed' ? c.lastAt : null, c.status === 'completed' && c.accepted != null ? `${n(c.accepted)} шт. из ${n(c.declared)} заявленных` : ''],
      ['Размещён по ячейкам', c.status === 'completed' && !c.unplaced ? c.lastAt : null, c.unplaced ? `${n(c.unplaced)} шт. приняты без ячейки` : ''],
    ];
    const current = steps.findIndex((x) => !x[1]);
    const stepsHtml = `<ol class="steps">${steps.map(([t, at, note], i) => `<li class="${at ? 'done' : i === current ? 'now' : ''}"><strong>${h(t)}</strong><time>${at ? h(when(at)) : 'ещё нет'}</time>${note ? `<p>${h(note)}</p>` : ''}</li>`).join('')}</ol>`;
    const facts = [
      c.plannedDate && ['Привезут', day(dateOnly(c.plannedDate))],
      // «Время выгрузки» — время у ворот склада (владелец 27.09.2026; раньше
      // называлось «окно выгрузки»).
      c.plannedDate && windowText(c.plannedFrom, c.plannedTo) && ['Время выгрузки', windowText(c.plannedFrom, c.plannedTo)],
      placesText(c.boxes, c.pallets) && ['Мест заявлено', placesText(c.boxes, c.pallets)],
      c.weightKg != null && ['Вес', n(c.weightKg) + ' кг'],
      (c.carrier || c.vehicle) && ['Кто везёт', [c.carrier, c.vehicle && 'машина ' + c.vehicle].filter(Boolean).join(', ')],
      c.comment && ['Комментарий складу', c.comment],
    ].filter(Boolean);
    const factsHtml = facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(v)}</dd>`).join('')}</dl>` : '';
    const edit = c.editable ? `<div class="drawer-actions" id="editActions"><button class="button" type="button" id="inboundEdit">Изменить привоз</button><button class="button ghost" type="button" id="inboundCancel">Отменить привоз</button></div><p class="help" style="margin-top:8px">Изменить или отменить можно, пока машина не приехала.</p>` : '';

    let verdict = '';
    if (c.status === 'completed' && c.discrepancy) {
      const what = `Склад принял ${n(c.accepted)} шт. из ${n(c.declared)} заявленных — на ${n(Math.abs(c.discrepancy))} ${c.discrepancy > 0 ? 'больше' : 'меньше'}.`;
      if (c.verdict) {
        verdict = notice(c.verdict.value === 'agreed' ? `${who} согласились с актом расхождений` : `${who} не согласились с актом расхождений`,
          [c.verdict.note, when(c.verdict.at)].filter(Boolean).join(' · '), c.verdict.value !== 'agreed');
      } else if (state.owner) {
        verdict = notice('Продавец ещё не ответил на акт расхождений', what, true);
      } else {
        verdict = `<section class="verdict"><h3>Акт расхождений</h3><p>${h(what)} Согласны с актом?</p>`
          + `<label class="field"><span>Комментарий — обязателен, если не согласны</span><textarea id="verdictNote" rows="3" maxlength="1000" placeholder="Например: отгружали 7 шт., есть видео упаковки"></textarea></label>`
          + `<div class="drawer-actions"><button class="button primary" type="button" id="verdictAgree">Согласен</button><button class="button" type="button" id="verdictDispute">Не согласен</button></div><p class="error-text" id="verdictError"></p></section>`;
      }
    }

    // Что дальше и от кого (рецензия 04.10, рекомендация 2): статус говорит,
    // где приход сейчас, эта строка — кто его продолжит.
    const you = !state.owner;
    const next = c.status === 'open' && !c.arrivedAt ? 'склад ждёт машину.'
      : c.status === 'open' ? 'склад начнёт приёмку.'
      : c.status === 'in_progress' ? 'склад досчитает товар — расхождение, если будет, появится в конце.'
      : c.discrepancy && !c.verdict ? (you ? 'ваш ответ на акт расхождений — согласны или нет. Без него вопрос по расхождению не закрыт.' : 'ответ продавца на акт расхождений.')
      : c.verdict?.value === 'disputed' ? (you ? 'склад видит ваше несогласие и ответит в переписке ниже.' : 'продавец не согласен — ответьте ему в переписке ниже.')
      : c.unplaced ? `склад разложит ${n(c.unplaced)} шт. по ячейкам.`
      : null;
    const nextHtml = `<p class="next-step">${next ? '<b>Дальше:</b> ' + h(next) : '<b>Готово:</b> товар на складе и учтён в остатках.'}</p>`;

    // История расхождения одной лентой (рецензия 04.10, рекомендация 5): что
    // ждали → что нашли → брак с фото → ответ на акт → решение и исполнение.
    // Всё из уже существующих данных: приход, брак этого прихода, решения.
    const def = state.data.defects;
    const found = def ? def.moves.filter((m) => m.invoiceId === c.id) : [];
    let storyHtml = '';
    if ((c.status === 'completed' && c.discrepancy) || found.length) {
      const story = [];
      const li = (title, at, body, cls) => story.push(`<li class="${cls}"><strong>${h(title)}</strong>${at ? `<time>${h(when(at))}</time>` : ''}${body}</li>`);
      li('Ожидали', c.createdAt, `<p>${you ? 'Вы заявили' : 'Продавец заявил'} ${n(c.declared)} шт.</p>`, 'done');
      if (c.status === 'completed') {
        const diffs = c.lines.filter((l) => l.accepted != null && l.accepted !== l.declared);
        li('Нашли при приёмке', c.lastAt, `<p>Принято ${n(c.accepted)} шт.${c.discrepancy ? ` — на ${n(Math.abs(c.discrepancy))} ${c.discrepancy > 0 ? 'больше' : 'меньше'}` : ''}.</p>`
          + diffs.slice(0, 5).map((l) => `<p>«${h(productName(l))}»: заявлено ${n(l.declared)}, принято ${n(l.accepted)}</p>`).join('')
          + (diffs.length > 5 ? `<p>и ещё ${counted(diffs.length - 5, 'позиция', 'позиции', 'позиций')} — в списке ниже</p>` : ''), 'done');
      }
      if (found.length) {
        li('Брак при приёмке', found[found.length - 1].at, found.map((m) => `<p>«${h(m.name || m.sku)}» — ${n(m.qty)} шт., ${h((BUCKET[m.bucket] || m.bucket).toLowerCase())}${m.note ? ': ' + h(m.note) : ''}`
          + (m.hasPhoto ? ` <button class="link-button" type="button" data-defect-photo="${h(m.id)}">Фото</button>` : ' · без фото') + '</p>').join(''), 'done');
      }
      if (c.status === 'completed' && c.discrepancy) {
        li('Ответ на акт', c.verdict?.at, `<p>${c.verdict ? (c.verdict.value === 'agreed' ? `${who} согласились` : `${who} не согласились${c.verdict.note ? ': ' + h(c.verdict.note) : ''}`)
          : you ? 'Ждём вашего ответа — он выше.' : 'Ждём ответа продавца.'}</p>`, c.verdict ? 'done' : 'now');
      }
      if (found.length) {
        const skus = [...new Set(found.map((m) => m.sku))];
        const lines = skus.map((sku) => {
          const ds = def.decisions.filter((d) => d.sku === sku);
          const left = def.balances.filter((b) => b.sku === sku).reduce((a, b) => a + b.undecided, 0);
          const name = found.find((m) => m.sku === sku).name || sku;
          return `<p>«${h(name)}»: ` + (ds.map((d) => `${h(ACTIONS[d.action]?.title || d.action)}, ${n(d.qty)} шт. — ${d.status === 'done' ? h(DONE[d.action] || 'сделано') + ' ' + h(when(d.doneAt)) : 'ждёт склада'}`).join('; ')
            + (left ? `${ds.length ? '; ' : ''}${n(left)} шт. ждут решения${you ? ' — в «Складе брака»' : ' продавца'}` : '') || 'решено') + '</p>';
        });
        const waiting = skus.some((sku) => def.balances.some((b) => b.sku === sku && b.undecided > 0) || def.decisions.some((d) => d.sku === sku && d.status !== 'done'));
        li('Решение по браку этого товара', null, lines.join(''), waiting ? 'now' : 'done');
      }
      storyHtml = `<section class="detail-section"><h3>История расхождения</h3><ol class="steps story">${story.join('')}</ol></section>`;
    }

    const items = data.items.map((r) => ({ ...r, finalized: r.accepted_qty != null, accepted: r.accepted_qty == null ? null : Number(r.accepted_qty) }));
    items.sort((a, b) => Number(b.finalized && b.accepted !== Number(b.declared_qty)) - Number(a.finalized && a.accepted !== Number(a.declared_qty)));
    const complete = items.every((r) => r.finalized);
    const lines = `<div class="mini-stats">${mini('Заявлено', c.declared)}${mini('Принято', c.accepted)}${mini('Расхождение', complete ? c.discrepancy : null)}</div>`
      + (!complete ? '<p class="help" style="margin-bottom:16px">Приёмка ещё не закончена: расхождение появится в конце.</p>' : '')
      + `<section class="detail-section" style="margin-top:0"><h3>Позиции · ${items.length}</h3><div class="receipt-lines">${items.map((r) => {
        const dec = Number(r.declared_qty); const diff = r.finalized && r.accepted !== dec; const scale = Math.max(1, dec, r.accepted || 0);
        return `<article class="receipt-item ${diff ? 'issue' : ''}"><h3>${h(productName(r))}</h3><span class="cell-sub">Артикул WB: ${h(wbIds(r.sku).join(', ') || 'не передан')}${hasVw() ? ' · склад «' + h(vwName(r.virtual_warehouse_id)) + '»' : ''}</span>${diff ? `<span class="row-note bad">Расхождение: ${n(r.accepted - dec)} шт.</span>` : ''}`
          + `<div class="receipt-bars"><div class="receipt-bar"><span>Заявлено</span><div class="track"><i style="width:${dec / scale * 100}%"></i></div><span class="num">${n(dec)}</span></div><div class="receipt-bar"><span>Принято</span><div class="track accepted"><i style="width:${(r.accepted || 0) / scale * 100}%"></i></div><span class="num">${r.accepted == null ? '—' : n(r.accepted)}</span></div></div></article>`;
      }).join('')}</div></section>`;

    const canEditDoc = (d) => state.owner || (d.addedBy === 'seller' && c.status !== 'completed');
    const docs = `<section class="detail-section"><h3>Документы поставщика · ${c.documents.length}</h3>`
      + (c.documents.length ? `<div class="doc-list">${c.documents.map((d) => `<div class="doc-row"><div><span class="cell-main">${h([d.kind, d.number && '№ ' + d.number, d.date && 'от ' + d.date].filter(Boolean).join(' '))}</span>`
        + `<span class="cell-sub">${h([d.supplier, d.addedBy === 'seller' ? (state.owner ? 'добавил продавец' : 'добавили вы') : 'добавил склад', d.fileName ? d.fileName + ', ' + fileSize(d.fileSize) : 'без файла'].filter(Boolean).join(' · '))}</span></div>`
        + `<div class="doc-actions">${d.fileName ? `<button class="button" type="button" data-doc-open="${h(d.id)}">Открыть</button>` : ''}`
        + (canEditDoc(d) ? `<label class="button">${d.fileName ? 'Заменить файл' : 'Приложить файл'}<input type="file" accept="${FILE_ACCEPT}" data-doc-file="${h(d.id)}" hidden></label><button class="button ghost" type="button" data-doc-del="${h(d.id)}">Убрать</button>` : '')
        + '</div></div>').join('')}</div>` : '<p class="help">УПД, ТТН или другой документ, с которым едет товар: склад принимает груз по нему.</p>')
      + `<div id="docForm"></div><div class="drawer-actions" id="docAddRow"><button class="button" type="button" id="docAdd">${icon('document')}Добавить документ</button></div><p class="error-text" id="docError"></p></section>`;

    const mine = (m) => (state.owner ? m.authorRole !== 'seller' : m.authorRole === 'seller');
    const talk = `<section class="detail-section"><h3>${state.owner ? 'Переписка с продавцом' : 'Переписка со складом'} · ${c.comments.length}</h3>`
      + (c.comments.length ? `<div class="comments">${c.comments.map((m) => `<article class="comment ${mine(m) ? 'mine' : ''}"><div class="comment-head"><b>${h(m.authorName || (m.authorRole === 'seller' ? 'Продавец' : 'Склад'))}</b><time>${h(when(m.createdAt))}</time></div>${m.productName ? `<span class="cell-sub">О товаре: ${h(m.productName)}</span>` : ''}<p>${h(m.body)}</p></article>`).join('')}</div>`
        : `<p class="help">${state.owner ? 'Продавец пока ничего не писал.' : 'Напишите складу, если что-то не так с документами или товаром — например, в УПД нет кода товара. Можно про весь приход или про один товар.'}</p>`)
      + `<div class="comment-form"><div class="field">${aboutPicker(c)}</div><label class="field"><span>Сообщение</span><textarea id="commentBody" rows="3" maxlength="1000"></textarea></label><div class="drawer-actions"><button class="button primary" type="button" id="commentSend">Отправить</button></div><p class="error-text" id="commentError"></p></div></section>`;

    return `<div class="drawer-meta">${badge(...inboundState({ status: c.status, arrived_at: c.arrivedAt, unplaced_qty: c.unplaced }))}<span>Оформлен ${h(when(c.createdAt))}</span></div>`
      + nextHtml + verdict + storyHtml + stepsHtml + factsHtml + edit + `<div style="margin-top:24px">${lines}</div>` + docs + talk
      + `<div class="drawer-actions"><a class="button" href="act_print.html?kind=receipt&id=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">${icon('document')}Акт приёмки${c.discrepancy ? ' и расхождений' : ''}</a></div>`;
  }
  function wireInboundCard(c) {
    const again = () => { state.inboundDirty = true; return openInboundCard(c.id, true); };
    const busy = (btn, on) => { if (btn) btn.disabled = on; };
    if ($('inboundEdit')) $('inboundEdit').onclick = () => openInbound(c);
    wireDefectPhotos($('drawerBody'));
    if ($('inboundCancel')) $('inboundCancel').onclick = () => {
      $('editActions').innerHTML = `<span class="help">Отменить привоз ${h(c.number)}? Склад перестанет его ждать.</span><button class="button" type="button" id="cancelYes">Да, отменить</button><button class="button ghost" type="button" id="cancelNo">Нет</button>`;
      $('cancelNo').onclick = () => openInboundCard(c.id, true);
      $('cancelYes').onclick = async () => {
        busy($('cancelYes'), true);
        try { await api('/api/inbound/' + encodeURIComponent(c.id), { method: 'DELETE' }); state.inboundDirty = true; $('drawer').close(); toast('Привоз ' + c.number + ' отменён'); }
        catch (e) { toast(e.message); openInboundCard(c.id, true); }
      };
    };
    const verdict = async (value) => {
      const note = $('verdictNote').value.trim();
      if (value === 'disputed' && note.length < 3) { $('verdictError').textContent = 'Напишите, с чем вы не согласны'; $('verdictNote').focus(); return; }
      busy($('verdictAgree'), true); busy($('verdictDispute'), true);
      try { await api('/api/inbound/' + encodeURIComponent(c.id) + '/verdict', { method: 'POST', body: { verdict: value, note } }); toast(value === 'agreed' ? 'Ответ отправлен: вы согласны с актом' : 'Склад получил ваше несогласие'); again(); }
      catch (e) { $('verdictError').textContent = e.message; busy($('verdictAgree'), false); busy($('verdictDispute'), false); }
    };
    if ($('verdictAgree')) { $('verdictAgree').onclick = () => verdict('agreed'); $('verdictDispute').onclick = () => verdict('disputed'); }
    $('drawerBody').querySelectorAll('[data-doc-open]').forEach((b) => { b.onclick = async () => {
      // Окно открываем сразу, по нажатию: иначе браузер примет его за всплывающее.
      const w = window.open('', '_blank'); busy(b, true);
      try {
        const response = await fetch('https://api.argus-ai.online/api/inbound/' + encodeURIComponent(c.id) + '/documents/' + encodeURIComponent(b.dataset.docOpen) + '/file', { headers: { Authorization: 'Bearer ' + state.token }, cache: 'no-store' });
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Файл не открылся');
        const url = URL.createObjectURL(await response.blob());
        if (w) w.location.href = url; else location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) { if (w) w.close(); $('docError').textContent = e.message; }
      busy(b, false);
    }; });
    $('drawerBody').querySelectorAll('[data-doc-file]').forEach((input) => { input.onchange = async () => {
      const file = input.files[0]; input.value = ''; if (!file) return;
      const bad = checkFile(file); if (bad) { $('docError').textContent = bad; return; }
      $('docError').textContent = 'Загружаем файл…';
      try { await uploadFile(c.id, input.dataset.docFile, file); again(); } catch (e) { $('docError').textContent = e.message; }
    }; });
    $('drawerBody').querySelectorAll('[data-doc-del]').forEach((b) => { b.onclick = async () => {
      busy(b, true);
      try { await api('/api/inbound/' + encodeURIComponent(c.id) + '/documents/' + encodeURIComponent(b.dataset.docDel), { method: 'DELETE' }); again(); }
      catch (e) { $('docError').textContent = e.message; busy(b, false); }
    }; });
    $('docAdd').onclick = () => {
      $('docAddRow').hidden = true;
      $('docForm').innerHTML = `<div class="doc-form">${docFields('card')}<div class="drawer-actions"><button class="button primary" type="button" id="docSave">Сохранить документ</button><button class="button ghost" type="button" id="docCancel">Отмена</button></div></div>`;
      wireDocFields('card', (m) => { $('docError').textContent = m; });
      $('docCancel').onclick = () => { $('docForm').innerHTML = ''; $('docAddRow').hidden = false; $('docError').textContent = ''; };
      $('docSave').onclick = async () => {
        const doc = readDocFields('card') || { kind: docState.card.kind, file: null };
        busy($('docSave'), true); $('docError').textContent = '';
        try { await saveDocument(c.id, doc); again(); } catch (e) { $('docError').textContent = e.message; busy($('docSave'), false); }
      };
    };
    $('commentSend').onclick = async () => {
      const body = $('commentBody').value.trim();
      if (!body) { $('commentError').textContent = 'Напишите сообщение'; $('commentBody').focus(); return; }
      busy($('commentSend'), true);
      try { await api('/api/inbound/' + encodeURIComponent(c.id) + '/comments', { method: 'POST', body: { body, sku: cardUi.about || null } }); cardUi.about = ''; again(); }
      catch (e) { $('commentError').textContent = e.message; busy($('commentSend'), false); }
    };
  }
  $('drawer').addEventListener('close', () => {
    // Что-то поменялось в карточке — список приходов перечитать.
    if (state.inboundDirty) { state.inboundDirty = false; state.data.documents = null; if (['documents', 'returns'].includes(state.view)) navigate(); }
  });

  // Привоз на склад файлом (владелец 25.09.2026) — кто везёт и на чём
  // (26.09.2026) пишут здесь же: это и есть документы на выгрузку.
  // edit — карточка привоза (GET /api/inbound/:id): правка до приезда машины.
  function openInbound(edit = null) {
    const run = openDrawer(edit ? 'Изменить привоз ' + edit.number : 'Привезти товар на склад', edit ? 'Привоз' : 'Новый приход');
    const f = { grid: null, name: '', preview: null, busy: false, error: '', errorTitle: '', createNew: true, byRow: {} };
    const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('sv-SE');
    const v = (x) => h(x ?? '');
    $('drawerBody').innerHTML = `<form class="inbound-form" id="inboundForm"><p class="help">${edit ? 'Поменяйте, что изменилось. Список товаров меняется новым файлом — без файла останется прежний.' : 'Загрузите таблицу, по которой собираете товар: шаблон поставки WB, свою таблицу или выгрузку из 1С. Нужны количество и штрихкод, артикул или название.'}</p>
      <div class="field"><span>${edit ? 'Новый список товаров — если поменялся' : 'Файл Excel или CSV'}</span><label class="file-pick"><input type="file" id="inboundFile" accept=".xlsx,.xls,.csv"><span class="button">${icon('document')}Выбрать файл</span><span class="help" id="inboundFileName">Файл не выбран</span></label></div>
      <div class="three"><label class="field"><span>Когда привезёте</span><input type="date" id="inboundDate" value="${edit ? v(edit.plannedDate) : tomorrow}"></label><label class="field"><span>Время выгрузки: с</span><input type="time" id="inboundFrom" value="${v(edit?.plannedFrom)}"></label><label class="field"><span>до</span><input type="time" id="inboundTo" value="${v(edit?.plannedTo)}"></label></div>
      <div class="three"><label class="field"><span>Коробов</span><input id="inboundBoxes" inputmode="numeric" maxlength="6" value="${v(edit?.boxes)}"></label><label class="field"><span>Паллет</span><input id="inboundPallets" inputmode="numeric" maxlength="6" value="${v(edit?.pallets)}"></label><label class="field"><span>Вес всего, кг</span><input id="inboundWeight" inputmode="decimal" maxlength="10" value="${v(edit?.weightKg)}"></label></div>
      <div class="two"><label class="field"><span>Кто везёт — транспортная компания или водитель</span><input id="inboundCarrier" maxlength="120" placeholder="ТК «Деловые линии» или Иван, +7 900 …" value="${v(edit?.carrier)}"></label><label class="field"><span>Номер машины</span><input id="inboundVehicle" maxlength="20" placeholder="А123ВС 77" value="${v(edit?.vehicle)}"></label></div>
      <label class="field"><span>Комментарий складу</span><input id="inboundComment" maxlength="300" value="${v(edit?.comment)}"></label>
      ${edit ? '' : `<details class="doc-box"><summary>Документ поставщика — УПД, ТТН (можно добавить и потом)</summary>${docFields('inb')}</details>`}
      <div id="inboundPreview"></div>
      ${edit ? `<div class="drawer-actions" id="editSaveRow"><button class="button primary" type="button" id="inboundSave">Сохранить</button><button class="button ghost" type="button" id="inboundBack">Назад к привозу</button></div>` : ''}</form>`;
    if (!edit) wireDocFields('inb', (m) => { f.error = m; f.errorTitle = 'Документ не подходит'; draw(); });
    const details = () => ({
      plannedDate: $('inboundDate').value || null, plannedFrom: $('inboundFrom').value || null, plannedTo: $('inboundTo').value || null,
      boxes: $('inboundBoxes').value.trim() || null, pallets: $('inboundPallets').value.trim() || null,
      weightKg: $('inboundWeight').value.trim().replace(',', '.') || null,
      carrier: $('inboundCarrier').value, vehicle: $('inboundVehicle').value, comment: $('inboundComment').value,
    });
    // Строка со складом, которого у продавца нет (опечатка в файле).
    const noVw = (l) => /^склада «/.test(l.error || '');
    function draw() {
      if (run !== state.drawerRun) return; const p = f.preview;
      $('inboundFileName').textContent = f.name || 'Файл не выбран';
      if (edit) $('editSaveRow').hidden = !!p;
      const err = f.error ? notice(f.errorTitle || 'Не получилось', f.error, true) : '';
      if (!p) { $('inboundPreview').innerHTML = err || (f.busy ? loading : ''); return; }
      const s = p.summary; const newLines = p.lines.filter((l) => l.isNew).length;
      const products = s.products + (f.createNew ? s.newProducts : 0); const units = s.units + (f.createNew ? s.newUnits : 0);
      const lost = s.notMatched + (f.createNew ? 0 : newLines);
      // Три группы строк (рецензия 04.10, рекомендация 7): готово, нужен ваш
      // выбор, не попадут — проблемные наверху, чтобы не искать их в файле.
      const group = (l) => (noVw(l) && !f.byRow[l.row] ? 1 : l.sku || (l.isNew && f.createNew) ? 2 : l.isNew ? 1 : 0);
      const counts = [0, 0, 0]; p.lines.forEach((l) => { counts[group(l)] += 1; });
      const lines = [...p.lines].sort((a, b) => group(a) - group(b) || a.row - b.row);
      $('inboundPreview').innerHTML = err
        + `<div class="mini-stats">${mini('Штук в приход', units)}${mini('Готово строк', counts[2])}${mini('Нужен выбор', counts[1])}${mini('Не попадут строк', counts[0])}</div>`
        + (s.newProducts ? `<label class="check-line"><input type="checkbox" id="createNew" ${f.createNew ? 'checked' : ''}><span>Завести новые товары в каталог — ${counted(s.newProducts, 'товар', 'товара', 'товаров')}, ${n(s.newUnits)} шт.<small>Название, артикул и штрихкод возьмём из файла. Склад проверит карточки при приёмке.</small></span></label>` : '')
        + (lost ? notice('Часть строк не попадёт в приход', 'Товара нет в вашем каталоге на складе, а для нового не хватает названия и артикула или штрихкода, или количество не целое.'
          + (p.lines.some(noVw) ? ' Или склада из столбца «Склад» у вас нет — выберите склад у строки.' : ''), true) : '')
        + table([{ title: 'Строка файла', cell: (l) => `<span class="cell-main" style="font-weight:400">${h([l.barcode, l.article, l.name].filter(Boolean).join(' · '))}</span><span class="cell-sub">строка ${l.row}</span>` },
          { title: 'Товар на складе', cell: (l) => (l.sku ? `<span class="cell-main" style="font-weight:400">${h(l.productName)}</span><span class="cell-sub">узнали по: ${h(l.by)}</span>`
            : l.isNew ? `<span class="row-note ${f.createNew ? 'warn' : 'bad'}" style="margin:0">${f.createNew ? 'Новый товар — заведём в каталог' : 'Нет в каталоге — не попадёт'}</span>`
              : `<span class="row-note bad" style="margin:0">${h(l.error || 'Не узнали')}</span>`) + (noVw(l) && !f.byRow[l.row] ? '<span class="cell-sub">выберите склад в столбце «Склад»</span>' : '') },
          { title: 'Шт.', cls: 'n', cell: (l) => (l.error ? '—' : n(l.qty)) },
          // Склады продавца: строка ложится на выбранный склад (02.10.2026).
          ...(p.lines.some((l) => l.vwName) ? [{ title: 'Склад', cell: (l) => dropdown('inb-vw-' + l.row, {
            value: f.byRow[l.row] || (noVw(l) ? '' : l.vwName || 'Остальной товар'), neutral: true,
            options: [...(noVw(l) && !f.byRow[l.row] ? [{ value: '', text: 'Выберите склад' }] : []),
              ...[...(state.vw?.warehouses || []).map((w) => w.name), 'Остальной товар'].map((x) => ({ value: x, text: x }))],
            onPick: (x) => { f.byRow[l.row] = x; send(false); } }) }] : [])], lines).replace('class="table-wrap"', 'class="table-wrap open-menus"')
        + (p.lines.some((l) => l.vwName) ? '<p class="help" style="margin-top:8px">Разделить товар между складами — например, 500 на Озон и 300 на WB — можно в файле: столбец «Склад» и по строке на каждый склад.</p>' : '')
        + `<button class="button primary" type="submit" style="margin-top:16px;width:100%" ${f.busy || !products ? 'disabled' : ''}>${f.busy ? 'Отправляем…' : edit ? 'Сохранить с новым списком' : 'Отправить на склад'}</button>`;
      if ($('createNew')) $('createNew').onchange = (e) => { f.createNew = e.target.checked; draw(); };
    }
    async function send(apply) {
      f.busy = true; f.error = ''; draw();
      try {
        const r = await api('/api/sellers/inbound', { method: 'POST', body: { grid: f.grid, apply, createNew: f.createNew, warehouseByRow: f.byRow, ...(edit ? { invoiceId: edit.id } : {}), ...details() } });
        if (run !== state.drawerRun) return;
        if (apply) {
          let docNote = '';
          const doc = edit ? null : readDocFields('inb');
          if (doc) { try { await saveDocument(r.invoice.id, doc); } catch (e) { docNote = ` Документ не сохранился (${e.message}) — добавьте его в карточке прихода.`; } }
          state.data.documents = null;
          toast((edit ? 'Привоз ' + r.invoice.number + ' изменён' : 'Приход ' + r.invoice.number + ' отправлен на склад') + (r.created ? `. Новых товаров в каталоге: ${r.created}` : '') + '.' + docNote);
          if (edit) { state.inboundDirty = true; openInboundCard(edit.id); } else navigate(true);
          return;
        }
        f.preview = r;
      } catch (e) { f.error = e.message; f.errorTitle = apply ? 'Не отправилось' : 'Файл не принят'; }
      f.busy = false; draw();
    }
    $('inboundFile').onchange = (e) => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return; f.preview = null; f.error = ''; f.name = file.name; f.byRow = {};
      if (typeof XLSX === 'undefined') { f.error = 'Не загрузился модуль чтения Excel. Обновите страницу.'; f.errorTitle = 'Файл не принят'; draw(); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          // CSV — только как текст: иначе «1,5» превращается в 15. Русский Excel пишет CSV в Windows-1251.
          let book;
          if (/\.(csv|txt)$/i.test(file.name)) { let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(reader.result); } catch { text = new TextDecoder('windows-1251').decode(reader.result); } book = XLSX.read(text.replace(/^\uFEFF/, ''), { type: 'string', raw: true }); }
          else book = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
          const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: true, defval: null });
          // Ведомость 1С бывает в двести колонок: серверу нужны подписи слева и итог справа.
          const wide = rows.slice(0, 25).some((r) => r.some((x) => /^конечный остаток$/i.test(String(x ?? '').trim())));
          f.grid = rows.slice(0, 20000).map((r) => (wide && r.length > 13 ? r.slice(0, 4).concat(r.slice(-9)) : r.slice(0, 40))); send(false);
        } catch (err) { f.error = 'Не удалось прочитать файл: ' + err.message; f.errorTitle = 'Файл не принят'; draw(); }
      };
      reader.readAsArrayBuffer(file);
    };
    $('inboundForm').onsubmit = (e) => { e.preventDefault(); if (f.preview && !f.busy) send(true); };
    if (edit) {
      $('inboundBack').onclick = () => openInboundCard(edit.id);
      $('inboundSave').onclick = async () => {
        f.busy = true; f.error = ''; $('inboundSave').disabled = true;
        try {
          await api('/api/inbound/' + encodeURIComponent(edit.id), { method: 'PATCH', body: details() });
          if (run !== state.drawerRun) return;
          toast('Привоз ' + edit.number + ' изменён'); state.inboundDirty = true; openInboundCard(edit.id);
        } catch (e) { f.busy = false; f.error = e.message; f.errorTitle = 'Не сохранилось'; $('inboundSave').disabled = false; draw(); }
      };
    }
  }

  // Кнопка названия товара в таблицах тоже открывает карточку.
  document.addEventListener('click', (e) => {
    const p = e.target.closest('[data-open-product]'); if (p && !p.closest('tr.clickable')) { openProduct(p.dataset.openProduct); }
  });

  paintIcons();
  boot();
})();
