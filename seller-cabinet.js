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
    check: 'm5 12 4 4L19 6', chevron: 'm6 9 6 6 6-6', columns: 'M4 4h16v16H4zM10 4v16M16 4v16', left: 'm14 5-7 7 7 7',
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[name] || PATHS.box}"/></svg>`;
  const paintIcons = (root = document) => root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

  const NAV = [['products', 'Товары', 'box'], ['orders', 'Заказы', 'orders'], ['supplies', 'Поставки на WB', 'truck'],
    ['documents', 'Приходы', 'inbox'], ['defects', 'Брак', 'alert']];
  const PAGES = {
    products: { title: 'Товары', subtitle: 'Сколько вашего товара на складе и сколько можно продавать.', data: 'stock', nav: 'products' },
    returns: { title: 'Товары', subtitle: 'Что вернулось на склад и в каком состоянии.', data: 'documents', nav: 'products' },
    orders: { title: 'Заказы', subtitle: 'Как склад готовит ваши заказы с Wildberries.', data: 'orders', nav: 'orders' },
    supplies: { title: 'Поставки на WB', subtitle: 'Склад собирает их из ваших заказов и везёт на Wildberries.', data: 'supplies', nav: 'supplies' },
    documents: { title: 'Приходы', subtitle: 'Товар, который вы привозите на склад на хранение.', data: 'documents', nav: 'documents' },
    defects: { title: 'Брак', subtitle: 'Что склад признал браком. Решение по нему — вместе с менеджером склада.', data: 'defects', nav: 'defects' },
  };
  const API_PATH = { stock: '/api/sellers/stock', orders: '/api/sellers/orders', supplies: '/api/sellers/supplies',
    documents: '/api/sellers/documents', defects: '/api/sellers/defects' };

  const blankUi = () => ({ q: '', shown: 0 });
  const state = {
    token: localStorage.getItem('argus_token'), owner: localStorage.getItem('argus_role') === 'owner',
    companyId: null, profile: null, catalog: {}, companies: [],
    prefs: { rows: 30, textSize: 'normal' },
    data: {}, summary: null, fetchedAt: {}, view: 'products', viewRun: 0, drawerRun: 0,
    ui: {
      products: { ...blankUi(), stock: 'all', orders: 'all', sort: 'name', extra: new Set(), category: 'all' },
      returns: { ...blankUi(), status: 'all', quality: 'all', period: 'all' },
      orders: { ...blankUi(), status: 'all', period: 'all', supply: 'all', sort: 'new' },
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
  async function api(path, options = {}) {
    if (state.owner && state.companyId && path.startsWith('/api/sellers/')) path += (path.includes('?') ? '&' : '?') + 'companyId=' + encodeURIComponent(state.companyId);
    const response = await fetch('https://api.argus-ai.online' + path, {
      method: options.method || 'GET', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => null);
    const renewed = response.headers.get('X-Argus-Token');
    if (renewed) { state.token = renewed; localStorage.setItem('argus_token', renewed); }
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
      + `<span class="dd-label">${h(label)}</span>`
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
  const inPeriod = (iso, period) => {
    if (period === 'all' || !iso) return period === 'all';
    const t = new Date(iso).getTime(); const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
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
        const cell = row.getCell(i + 1); const v = c.get(r);
        if (c.type === 'num') { cell.value = v == null || v === '' ? null : Number(v); cell.numFmt = '#,##0'; }
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
        cell.value = i === 0 ? 'Итого' : c.total ? rows.reduce((s, r) => s + Number(c.get(r) || 0), 0) : null;
        if (c.total) cell.numFmt = '#,##0';
        cell.font = { bold: true };
        cell.alignment = { vertical: 'middle', horizontal: i === 0 || c.type === 'text' ? 'left' : 'center' };
        cell.border = { top: { style: 'medium', color: { argb: 'FF9AA3BC' } }, bottom: thin, left: thin, right: thin };
      });
    }
    columns.forEach((c, i) => {
      const lens = rows.map((r) => { const v = c.get(r); return c.type === 'date' ? 16 : c.type === 'link' ? 14 : String(v ?? '').length; });
      const longest = Math.max(...String(c.header).split(' ').map((w) => w.length), ...lens);
      ws.getColumn(i + 1).width = Math.max(c.min || 8, Math.min(c.max || 48, longest + 3));
    });
    ws.views = [{ state: 'frozen', ySplit: head }];
    ws.autoFilter = { from: { row: head, column: 1 }, to: { row: head + rows.length, column: last } };
    ws.pageSetup.printTitlesRow = `${head}:${head}`;
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
    const counts = { orders: state.data.orders ? new Set(state.data.orders.rows.filter(orderActive).map((r) => r.id)).size : 0 };
    const current = PAGES[state.view]?.nav;
    document.querySelectorAll('[data-nav-list]').forEach((host) => {
      host.innerHTML = NAV.map(([key, title, ico]) => `<a href="#${key}" ${key === current ? 'aria-current="page"' : ''}>${icon(ico)}<span>${h(title)}</span>${counts[key] ? `<span class="nav-count">${n(counts[key])}</span>` : ''}</a>`).join('');
    });
  }
  async function boot() {
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
    $('settingsFields').innerHTML = `<div class="field"><span>Сколько строк показывать за раз</span>${dropdown('pref-rows', {
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
    renderSettings(); $('settingsDialog').showModal();
  };
  $('closeSettings').onclick = () => $('settingsDialog').close();
  $('settingsForm').onsubmit = (e) => {
    e.preventDefault(); writePref('preferences', { ...draftPrefs }); loadPreferences();
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
    if (refresh || !state.data[page.data]) $('view').innerHTML = '<div class="skeleton skeleton-strip"></div>' + '<div class="skeleton skeleton-row"></div>'.repeat(5);
    try {
      const key = page.data;
      if (refresh) { try { const c = await api('/api/sellers/catalog'); if (run !== state.viewRun) return; state.catalog = Object.fromEntries(c.products.map((r) => [r.sku, r])); } catch { toast('Каталог не обновился — показаны прошлые данные.'); } }
      if (refresh || !state.data[key]) {
        const payload = await api(API_PATH[key] + (key === 'stock' && state.owner ? '?view=seller' : ''));
        if (key === 'stock') { state.data.stock = payload.rows || []; state.summary = payload.summary || null; } else state.data[key] = payload;
        state.fetchedAt[key] = new Date();
      }
      if (!state.data.orders && key !== 'orders') api(API_PATH.orders).then((o) => { state.data.orders = o; state.fetchedAt.orders = new Date(); renderNav(); }).catch(() => {});
      if (run !== state.viewRun) return;
      const ui = state.ui[state.view]; if (!ui.shown) ui.shown = state.prefs.rows;
      ({ products: renderProducts, returns: renderReturns, orders: renderOrders, supplies: renderSupplies, documents: renderDocuments, defects: renderDefects })[state.view]();
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
    products: () => ({ q: '', stock: 'all', orders: 'all', sort: 'name', extra: new Set(), category: 'all' }),
    returns: () => ({ q: '', status: 'all', quality: 'all', period: 'all' }),
    orders: () => ({ q: '', status: 'all', period: 'all', supply: 'all', sort: 'new' }),
    supplies: () => ({ q: '', status: 'all', dest: 'all', period: 'all', sort: 'new' }),
    documents: () => ({ q: '', status: 'all', diff: 'all', period: 'all', sort: 'new' }),
    defects: () => ({ q: '', source: 'all', kind: 'all', period: 'all' }),
  };
  const isDefault = (view) => { const d = state.defaults[view](); const ui = state.ui[view]; return Object.keys(d).every((k) => k === 'q' || (d[k] instanceof Set ? ui[k].size === 0 : ui[k] === d[k])); };
  const resetLink = (view) => (isDefault(view) ? '' : '<button type="button" class="reset-filters" data-reset>Сбросить фильтры</button>');
  const segment = (current) => `<nav class="segmented" aria-label="Товары"><a href="#products" ${current === 'products' ? 'aria-current="page"' : ''}>Остатки</a><a href="#returns" ${current === 'returns' ? 'aria-current="page"' : ''}>Возвраты</a></nav>`;

  // ---------- Товары: остатки ----------
  const total = (r) => r.total ?? null;
  const orderedQty = (r) => Number(r.ordered || 0);
  const assemblyQty = (r) => Number(r.inAssembly || 0);
  const transitQty = (r) => Number(r.inTransit || 0);
  const availableQty = (r) => (r.available == null ? null : Number(r.available));
  const isShort = (r) => r.shortage === true || (total(r) != null && orderedQty(r) + assemblyQty(r) > Number(total(r)));
  const PRODUCT_COLUMNS = [
    { key: 'photo', title: 'Фото', cls: 'w-photo', cell: (r) => photo(r.sku) },
    { key: 'name', title: 'Товар', locked: true, main: true, cell: (r) => `<button class="link-button" data-open-product="${h(r.sku)}">${h(productName(r))}</button>${vendorCodes(r.sku).length ? `<span class="cell-sub">Артикул продавца: ${h(vendorCodes(r.sku).join(', '))}</span>` : ''}${isShort(r) ? '<span class="row-note bad">Заказов больше, чем товара по учёту</span>' : ''}` },
    { key: 'wb', title: 'Артикул WB', cell: (r) => idCell(wbIds(r.sku), r.barcode) },
    { key: 'total', title: 'Всего', cls: 'n', cell: (r) => num(total(r)) },
    { key: 'ordered', title: 'Заказано', cls: 'n', cell: (r) => num(orderedQty(r)) },
    { key: 'assembly', title: 'В сборке', cls: 'n', cell: (r) => num(assemblyQty(r)) },
    { key: 'transit', title: 'В пути', cls: 'n', cell: (r) => num(transitQty(r)) },
    { key: 'available', title: 'Доступно', cls: 'n', cell: (r) => num(availableQty(r), true) },
    { key: 'defective', title: 'Брак', cls: 'n', hidden: true, cell: (r) => num(r.defective || 0) },
    { key: 'category', title: 'Категория', hidden: true, cell: (r) => h(meta(r.sku).category || '—') },
    { key: 'updated', title: 'Учёт на', cls: 'n', hidden: true, cell: (r) => (r.updatedAt ? h(when(r.updatedAt)) : '—') },
  ];
  const STOCK_FILTER = [{ value: 'all', text: 'Все товары' }, { value: 'available', text: 'Есть к продаже' }, { value: 'low', text: 'Заканчивается (≤ 5 шт.)' }, { value: 'none', text: 'Нет к продаже' }];
  const ORDERS_FILTER = [{ value: 'all', text: 'Любые' }, { value: 'any', text: 'Есть заказы' }, { value: 'ordered', text: 'Заказано, ждёт поставки' }, { value: 'assembly', text: 'В сборке' }, { value: 'transit', text: 'В пути на WB' }, { value: 'none', text: 'Без заказов' }];
  const SORTS = [{ value: 'name', text: 'По названию' }, { value: 'availDesc', text: 'Больше доступно' }, { value: 'availAsc', text: 'Меньше доступно' }, { value: 'ordersDesc', text: 'Больше заказов' }, { value: 'totalDesc', text: 'Больше всего на складе' }, { value: 'transitDesc', text: 'Больше в пути' }];
  const EXTRA = [{ value: 'shortage', text: 'Заказов больше, чем товара' }, { value: 'defect', text: 'Есть брак на складе' }, { value: 'withPhoto', text: 'С фото' }, { value: 'noPhoto', text: 'Без фото' }, { value: 'noWb', text: 'Без артикула WB' }, { value: 'unknown', text: 'Остаток ещё не получен' }];
  function filteredProducts() {
    const ui = state.ui.products;
    const rows = state.data.stock.filter((r) => {
      if (!matches(ui.q, [r.name, r.barcode, ...wbIds(r.sku), ...vendorCodes(r.sku), meta(r.sku).category])) return false;
      const avail = availableQty(r);
      if (ui.stock === 'available' && !(avail > 0)) return false;
      if (ui.stock === 'low' && !(avail > 0 && avail <= 5)) return false;
      if (ui.stock === 'none' && avail > 0) return false;
      const any = orderedQty(r) + assemblyQty(r);
      if (ui.orders === 'any' && !any) return false;
      if (ui.orders === 'ordered' && !orderedQty(r)) return false;
      if (ui.orders === 'assembly' && !assemblyQty(r)) return false;
      if (ui.orders === 'transit' && !transitQty(r)) return false;
      if (ui.orders === 'none' && any) return false;
      if (ui.category !== 'all' && (meta(r.sku).category || 'Без категории') !== ui.category) return false;
      const x = ui.extra;
      if (x.has('shortage') && !isShort(r)) return false;
      if (x.has('defect') && !r.defective) return false;
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
    return t.length ? 'фильтр: ' + t.join(', ') : 'все товары';
  }
  function renderProducts() {
    const rows = state.data.stock; const s = state.summary || {}; const ui = state.ui.products;
    const sum = (fn) => rows.reduce((a, r) => a + Number(fn(r) || 0), 0);
    const unknown = rows.some((r) => total(r) == null);
    const stats = [
      ['Всего товара', s.total ?? (unknown ? null : sum(total)), counted(s.productCount ?? rows.length, 'наименование', 'наименования', 'наименований') + (s.updatedAt ? '\nучёт на ' + when(s.updatedAt) : '')],
      ['Заказано', s.ordered ?? sum(orderedQty), 'куплено на WB, ещё не в поставке'],
      ['В сборке', s.inAssembly ?? sum(assemblyQty), 'в поставке, склад собирает'],
      ['В пути', s.inTransit ?? sum(transitQty), 'уехало на WB, ещё не принято'],
      ['Доступно к продаже', s.available ?? (unknown ? null : sum(availableQty)), 'всего − заказано − в сборке', 'main'],
    ];
    const short = rows.filter(isShort).length;
    const categories = [...new Set(rows.map((r) => meta(r.sku).category || 'Без категории'))].sort((a, b) => a.localeCompare(b, 'ru'));
    $('view').innerHTML = segment('products')
      + `<section class="stock-strip" aria-label="Состояние товаров">${stats.map(([label, value, note, cls]) => `<div class="stat ${cls || ''}"><div class="stat-label">${h(label)}</div><div class="stat-value">${value == null ? '—' : n(value) + '<small>шт.</small>'}</div><div class="stat-note">${h(note).replace('\n', '<br>')}</div></div>`).join('')}</section>`
      + (short ? `<button type="button" class="alert-line ${ui.extra.has('shortage') ? 'on' : ''}" data-shortage>${icon('alert')}<span><b>${counted(short, 'товар', 'товара', 'товаров')}:</b> заказов больше, чем товара по учёту — склад проверяет, «Доступно» по ним ноль.</span><span class="alert-action">${ui.extra.has('shortage') ? 'Показаны только они' : 'Показать'}</span></button>` : '')
      + toolbar(searchBox('Название, артикул WB, штрихкод', ui.q),
        dropdown('p-stock', { label: 'Наличие', value: ui.stock, options: STOCK_FILTER, onPick: (v) => { ui.stock = v; ui.shown = state.prefs.rows; renderProducts(); } })
        + dropdown('p-orders', { label: 'Заказы', value: ui.orders, options: ORDERS_FILTER, onPick: (v) => { ui.orders = v; ui.shown = state.prefs.rows; renderProducts(); } })
        + dropdown('p-sort', { label: 'Сортировка', value: ui.sort, options: SORTS, onPick: (v) => { ui.sort = v; renderProducts(); } })
        + dropdown('p-extra', { label: 'Ещё фильтры', multi: true, value: ui.extra, options: EXTRA, onPick: (v) => { if (ui.extra.has(v)) ui.extra.delete(v); else ui.extra.add(v); ui.shown = state.prefs.rows; renderProducts(); } })
        + (categories.length > 1 ? dropdown('p-cat', { label: 'Категория', value: ui.category, options: [{ value: 'all', text: 'Все' }, ...categories.map((c) => ({ value: c, text: c }))], onPick: (v) => { ui.category = v; ui.shown = state.prefs.rows; renderProducts(); } }) : '')
        + resetLink('products'),
        columnChooser('products', PRODUCT_COLUMNS, renderProducts) + excelButton)
      + '<div id="rows"></div>';
    const shortBtn = $('view').querySelector('[data-shortage]');
    if (shortBtn) shortBtn.onclick = () => { if (ui.extra.has('shortage')) ui.extra.delete('shortage'); else ui.extra.add('shortage'); ui.shown = state.prefs.rows; renderProducts(); };
    wireView(ui, renderProducts, renderProductRows, exportProducts);
    renderProductRows();
  }
  function renderProductRows() {
    const ui = state.ui.products; const rows = filteredProducts(); const host = $('rows');
    host.innerHTML = rows.length
      ? table(visibleColumns('products', PRODUCT_COLUMNS), rows.slice(0, ui.shown), { rowAttrs: (r) => `class="clickable" data-product="${h(r.sku)}"` }) + moreFooter(ui, rows.length, ['товар', 'товара', 'товаров'])
      : empty('Товары не найдены', ui.q ? 'Проверьте название, артикул WB или штрихкод.' : 'Под выбранные фильтры не подошёл ни один товар.');
    host.querySelectorAll('[data-product]').forEach((tr) => { tr.onclick = () => openProduct(tr.dataset.product); });
    wireRows(host, ui, renderProductRows);
  }
  const exportProducts = () => exportExcel({
    file: 'Остатки', sheet: 'Остатки', title: `Остатки товаров — ${state.profile.name}`, filterText: productsFilterText(), rows: filteredProducts(),
    columns: [
      { header: '№', type: 'num', get: (r) => filteredProducts().indexOf(r) + 1, min: 5, max: 6 },
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
      { header: 'Брак на складе, шт.', type: 'num', total: true, get: (r) => r.defective || 0 },
      { header: 'Учёт на', type: 'date', get: (r) => r.updatedAt },
      { header: 'Карточка WB', type: 'link', get: (r) => wbLink(wbIds(r.sku)[0]) },
    ],
  });

  // ---------- Товары: возвраты ----------
  const RETURN_STATUS = { open: ['Ждёт разбора', 'waiting'], in_progress: ['Разбирается', 'working'], completed: ['Разобран', 'ready'] };
  function filteredReturns() {
    const ui = state.ui.returns;
    return state.data.documents.rows.filter((r) => r.direction === 'return'
      && matches(ui.q, [r.number, ...(r.received_by || [])])
      && (ui.status === 'all' || r.status === ui.status)
      && (ui.quality === 'all' || (ui.quality === 'defect' ? Number(r.bad_qty) > 0 : !(Number(r.bad_qty) > 0)))
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
        { header: '№', type: 'num', get: (r) => filteredReturns().indexOf(r) + 1, min: 5, max: 6 },
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
    if (s === 'queued') return !r.in_supply && r.status !== 'shipped' && !r.mp_closed_at;
    if (s === 'assembly') return r.in_supply && ['open', 'in_progress'].includes(r.status) && !r.mp_closed_at;
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
      && (ui.supply === 'all' || (ui.supply === 'none' ? !r.supply_number : r.supply_number === ui.supply)));
    const by = { new: (a, b) => new Date(orderAt(b)) - new Date(orderAt(a)), old: (a, b) => new Date(orderAt(a)) - new Date(orderAt(b)),
      product: (a, b) => String(productName(a)).localeCompare(String(productName(b)), 'ru'), qty: (a, b) => Number(b.qty) - Number(a.qty) };
    return rows.sort(by[ui.sort]);
  }
  const ORDER_COLUMNS = [
    { key: 'photo', title: 'Фото', cls: 'w-photo', cell: (r) => photo(r.sku, r.mp_nm_id) },
    { key: 'product', title: 'Товар', locked: true, main: true, cell: (r) => `<span class="cell-main">${h(productName(r))}</span>${r.mp_article ? `<span class="cell-sub">Артикул продавца: ${h(r.mp_article)}</span>` : ''}` },
    { key: 'order', title: 'Заказ', cell: (r) => `<button class="link-button nowrap" data-order="${h(r.id)}">${h(r.number)}</button>${r.mp_rid ? `<span class="cell-sub nowrap">${h(r.mp_rid)}</span>` : ''}` },
    { key: 'wb', title: 'Артикул WB', cell: (r) => idCell(r.mp_nm_id ? [r.mp_nm_id] : wbIds(r.sku), r.mp_barcode) },
    { key: 'qty', title: 'Кол-во', cls: 'n', cell: (r) => num(r.qty) },
    { key: 'at', title: 'Оформлен на WB', cls: 'n', cell: (r) => h(when(orderAt(r))) },
    { key: 'supply', title: 'Поставка', cell: (r) => (r.supply_number ? `<span class="cell-main nowrap">${h(r.supply_number)}</span>${r.supply_destination ? `<span class="cell-sub">${h(r.supply_destination)}</span>` : ''}` : '<span class="zero">—</span>') },
    { key: 'status', title: 'Статус', cls: 'c', cell: (r) => badge(orderStatus(r), orderStyle(r)) + (r.stock_conflict ? '<span class="row-note warn">Склад сверяет заказ</span>' : '') },
    { key: 'loaded', title: 'Загружен в Аргус', cls: 'n', hidden: true, cell: (r) => h(when(r.created_at)) },
  ];
  function renderOrders() {
    const ui = state.ui.orders; const supplies = [...new Set(state.data.orders.rows.map((r) => r.supply_number).filter(Boolean))].sort().reverse();
    $('view').innerHTML = (state.data.orders.hasMore ? notice('Показана часть заказов', 'Загружены последние 1 000 позиций.', true) : '')
      + toolbar(searchBox('Номер заказа, товар, артикул WB, штрихкод', ui.q),
        dropdown('o-status', { label: 'Статус', value: ui.status, options: ORDER_STATUS, onPick: (v) => { ui.status = v; ui.shown = state.prefs.rows; renderOrders(); } })
        + dropdown('o-period', { label: 'Период', value: ui.period, options: PERIODS, onPick: (v) => { ui.period = v; ui.shown = state.prefs.rows; renderOrders(); } })
        + dropdown('o-supply', { label: 'Поставка', value: ui.supply, options: [{ value: 'all', text: 'Любая' }, { value: 'none', text: 'Без поставки' }, ...supplies.map((x) => ({ value: x, text: x }))], onPick: (v) => { ui.supply = v; ui.shown = state.prefs.rows; renderOrders(); } })
        + dropdown('o-sort', { label: 'Сортировка', value: ui.sort, options: [{ value: 'new', text: 'Сначала новые' }, { value: 'old', text: 'Сначала старые' }, { value: 'product', text: 'По товару' }, { value: 'qty', text: 'Больше штук' }], onPick: (v) => { ui.sort = v; renderOrders(); } })
        + resetLink('orders'),
        columnChooser('orders', ORDER_COLUMNS, renderOrders) + excelButton)
      + '<div id="rows"></div>';
    wireView(ui, renderOrders, renderOrderRows, () => exportExcel({
      file: 'Заказы', sheet: 'Заказы', title: `Заказы — ${state.profile.name}`, filterText: ui.status !== 'all' ? 'статус: ' + ORDER_STATUS.find((o) => o.value === ui.status).text.toLowerCase() : '', rows: filteredOrders(),
      columns: [
        { header: '№', type: 'num', get: (r) => filteredOrders().indexOf(r) + 1, min: 5, max: 6 },
        { header: 'Заказ', type: 'text', get: (r) => r.number, min: 14 },
        { header: 'Отправление', type: 'text', get: (r) => r.mp_rid || '' },
        { header: 'Товар', type: 'text', get: (r) => productName(r), min: 30, max: 60 },
        { header: 'Артикул продавца', type: 'text', get: (r) => r.mp_article || '' },
        { header: 'Артикул WB', type: 'text', get: (r) => r.mp_nm_id || wbIds(r.sku).join(', ') },
        { header: 'Штрихкод', type: 'text', get: (r) => r.mp_barcode || '', min: 15 },
        { header: 'Кол-во, шт.', type: 'num', total: true, get: (r) => r.qty },
        { header: 'Оформлен на WB', type: 'date', get: orderAt },
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
  const SUPPLY_COLUMNS = [
    { key: 'num', title: 'Поставка', cell: (r) => `<button class="link-button nowrap" data-supply="${h(r.id)}">${h(r.number)}</button><span class="cell-sub">составлена ${h(when(r.createdAt))}</span>` },
    { key: 'dest', title: 'Куда и когда', cell: (r) => `<span class="cell-main">${h(r.destination || 'пункт ещё не выбран')}</span>${r.shipDate ? `<span class="cell-sub">отгрузка ${h(day(dateOnly(r.shipDate)))}</span>` : ''}` },
    { key: 'units', title: 'Штук', cls: 'n', cell: (r) => num(r.units) },
    { key: 'status', title: 'Статус', cls: 'c', cell: (r) => badge(r.statusName, SUPPLY_STYLE[r.status] || '') },
    { key: 'qr', title: 'QR', cls: 'c', cell: (r) => (r.mpBarcodeFile ? `<img class="qr-thumb" src="data:image/svg+xml;base64,${h(r.mpBarcodeFile)}" alt="QR поставки">` : `<span class="zero">${r.mpSupplyId ? 'после «Уехала»' : '—'}</span>`) },
  ];
  function renderSupplies() {
    const ui = state.ui.supplies; const dests = [...new Set((state.data.supplies || []).map((r) => r.destination || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    $('view').innerHTML = toolbar(searchBox('Номер поставки', ui.q),
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
        { title: 'Заказ', cell: (i) => h(i.order) }, { title: 'Товар', cell: (i) => h(productName({ sku: i.sku, name: i.name })) },
        { title: 'Шт.', cls: 'n', cell: (i) => n(i.qty) }, { title: 'Статус', cls: 'c', cell: (i) => h(i.status) },
      ], r.items);
  }

  // ---------- Приходы ----------
  const INBOUND_STATUS = { open: ['Ждёт приёмки', 'waiting'], in_progress: ['Принимается', 'working'], completed: ['Принят', 'ready'] };
  const diffOf = (r) => (r.status === 'completed' && r.done_qty != null ? Number(r.done_qty) - Number(r.declared_qty) : null);
  function filteredInbound() {
    const ui = state.ui.documents;
    const rows = state.data.documents.rows.filter((r) => r.direction === 'in'
      && matches(ui.q, [r.number, r.carrier, r.vehicle, r.inbound_comment, ...(r.received_by || [])])
      && (ui.status === 'all' || r.status === ui.status)
      && (ui.diff === 'all' || (ui.diff === 'with' ? diffOf(r) != null && diffOf(r) !== 0 : diffOf(r) === 0))
      && inPeriod(r.first_at || r.created_at, ui.period));
    const by = { new: (a, b) => new Date(b.created_at) - new Date(a.created_at), old: (a, b) => new Date(a.created_at) - new Date(b.created_at), units: (a, b) => Number(b.declared_qty) - Number(a.declared_qty) };
    return rows.sort(by[ui.sort]);
  }
  const INBOUND_COLUMNS = [
    { key: 'doc', title: 'Приход', locked: true, cell: (r) => `<button class="link-button nowrap" data-doc="${h(r.id)}">${h(r.number)}</button><span class="cell-sub">${counted(r.item_count, 'позиция', 'позиции', 'позиций')}</span>` },
    { key: 'planned', title: 'Привезут', cls: 'n', hidden: true, cell: (r) => (r.source_document_type === 'seller_inbound' && r.source_document_date ? h(day(dateOnly(String(r.source_document_date).slice(0, 10)))) : '—') },
    { key: 'arrived', title: 'Начали выгрузку', cls: 'n', cell: (r) => (r.first_at ? h(when(r.first_at)) : '<span class="zero">ещё нет</span>') },
    { key: 'carrier', title: 'Кто привёз', cell: (r) => (r.carrier ? `<span class="cell-main">${h(r.carrier)}</span>${r.vehicle ? `<span class="cell-sub">машина ${h(r.vehicle)}</span>` : ''}` : '<span class="zero">—</span>') },
    { key: 'vehicle', title: 'Машина', cls: 'n', hidden: true, cell: (r) => h(r.vehicle || '—') },
    { key: 'declared', title: 'Заявлено', cls: 'n', cell: (r) => num(r.declared_qty) },
    { key: 'accepted', title: 'Принято', cls: 'n', cell: (r) => num(r.done_qty ?? null) },
    { key: 'diff', title: 'Расхождение', cls: 'n', cell: (r) => { const d = diffOf(r); return d == null ? '<span class="zero">—</span>' : d === 0 ? '<span class="zero">нет</span>' : `<span class="row-note bad" style="margin:0">${d > 0 ? '+' : '−'}${n(Math.abs(d))}</span>`; } },
    { key: 'who', title: 'Принимали', hidden: true, cell: (r) => h((r.received_by || []).join(', ') || '—') },
    { key: 'finished', title: 'Приёмка закончена', cls: 'n', hidden: true, cell: (r) => (r.status === 'completed' && r.last_at ? h(when(r.last_at)) : '—') },
    { key: 'status', title: 'Статус', cls: 'c', cell: (r) => badge(...(INBOUND_STATUS[r.status] || [r.status])) },
    { key: 'created', title: 'Оформлен', cls: 'n', hidden: true, cell: (r) => h(when(r.created_at)) },
    { key: 'comment', title: 'Комментарий', hidden: true, cell: (r) => h(r.inbound_comment || '—') },
  ];
  function renderDocuments() {
    const ui = state.ui.documents;
    $('view').innerHTML = toolbar(searchBox('Номер, перевозчик, машина', ui.q),
      dropdown('d-status', { label: 'Статус', value: ui.status, options: [{ value: 'all', text: 'Все' }, { value: 'open', text: 'Ждут приёмки' }, { value: 'in_progress', text: 'Принимаются' }, { value: 'completed', text: 'Приняты' }], onPick: (v) => { ui.status = v; ui.shown = state.prefs.rows; renderDocuments(); } })
      + dropdown('d-diff', { label: 'Расхождение', value: ui.diff, options: [{ value: 'all', text: 'Любое' }, { value: 'with', text: 'Есть расхождение' }, { value: 'none', text: 'Без расхождения' }], onPick: (v) => { ui.diff = v; ui.shown = state.prefs.rows; renderDocuments(); } })
      + dropdown('d-period', { label: 'Период', value: ui.period, options: PERIODS, onPick: (v) => { ui.period = v; ui.shown = state.prefs.rows; renderDocuments(); } })
      + dropdown('d-sort', { label: 'Сортировка', value: ui.sort, options: [{ value: 'new', text: 'Сначала новые' }, { value: 'old', text: 'Сначала старые' }, { value: 'units', text: 'Больше штук' }], onPick: (v) => { ui.sort = v; renderDocuments(); } })
      + resetLink('documents'),
      columnChooser('documents', INBOUND_COLUMNS, renderDocuments) + `<button class="button primary" type="button" id="inboundButton">${icon('box')}Привезти товар</button>`)
      + '<div id="rows"></div>';
    $('inboundButton').onclick = openInbound;
    wireView(ui, renderDocuments, renderDocumentRows);
    renderDocumentRows();
  }
  function renderDocumentRows() {
    const ui = state.ui.documents; const rows = filteredInbound(); const host = $('rows');
    host.innerHTML = rows.length ? table(visibleColumns('documents', INBOUND_COLUMNS), rows.slice(0, ui.shown), { rowAttrs: (r) => `class="clickable" data-doc-row="${h(r.id)}"` }) + moreFooter(ui, rows.length, ['приход', 'прихода', 'приходов'])
      : empty('Приходов нет', state.data.documents.rows.some((r) => r.direction === 'in') ? 'Под выбранные фильтры приходов нет.' : 'Нажмите «Привезти товар» и загрузите таблицу, по которой собираете товар для склада.', 'inbox');
    host.querySelectorAll('[data-doc-row]').forEach((tr) => { tr.onclick = () => openDocument(tr.dataset.docRow); });
    wireRows(host, ui, renderDocumentRows);
  }

  // ---------- Брак ----------
  const BUCKET = { defective: 'Брак', packaging_defect: 'Повреждена упаковка', good: 'Годное' };
  function filteredDefects() {
    const ui = state.ui.defects;
    return state.data.defects.events.filter((e) => matches(ui.q, [e.name, e.sku, e.note, e.document, ...wbIds(e.sku)])
      && (ui.source === 'all' || e.source === ui.source) && (ui.kind === 'all' || e.bucket === ui.kind) && inPeriod(e.at, ui.period));
  }
  function renderDefects() {
    const ui = state.ui.defects; const d = state.data.defects;
    const nowQty = d.now.reduce((s, r) => s + r.defective + r.packaging, 0);
    const sources = [...new Set(d.events.map((e) => e.source))];
    $('view').innerHTML = `<p class="note-line">Фото брака со склада появятся здесь, когда склад начнёт их прикладывать. Сейчас видно описание, товар и откуда брак.</p>`
      + `<div class="section-title" style="margin-top:0"><h2>Сейчас на складе</h2><span>${nowQty ? counted(nowQty, 'штука', 'штуки', 'штук') + ' · ' + counted(d.now.length, 'товар', 'товара', 'товаров') : 'брака нет'}</span></div>`
      + (d.now.length ? table([
        { title: 'Фото', cls: 'w-photo', cell: (r) => photo(r.sku) },
        { title: 'Товар', cell: (r) => `<button class="link-button" data-open-product="${h(r.sku)}">${h(r.name)}</button>` },
        { title: 'Артикул WB', cell: (r) => idCell(wbIds(r.sku), state.data.stock?.find((x) => x.sku === r.sku)?.barcode) },
        { title: 'Брак', cls: 'n', cell: (r) => num(r.defective) },
        { title: 'Повреждена упаковка', cls: 'n', cell: (r) => num(r.packaging) },
      ], d.now) : '<div class="table-wrap">' + empty('Брака на складе нет', 'Если склад признает ваш товар браком, он появится здесь.', 'check') + '</div>')
      + `<div class="section-title"><h2>Когда признан браком</h2><span>${counted(d.events.length, 'случай', 'случая', 'случаев')}</span></div>`
      + toolbar(searchBox('Товар, артикул WB, описание', ui.q),
        dropdown('f-source', { label: 'Откуда', value: ui.source, options: [{ value: 'all', text: 'Отовсюду' }, ...sources.map((x) => ({ value: x, text: x }))], onPick: (v) => { ui.source = v; ui.shown = state.prefs.rows; renderDefects(); } })
        + dropdown('f-kind', { label: 'Что с товаром', value: ui.kind, options: [{ value: 'all', text: 'Любое' }, { value: 'defective', text: 'Брак' }, { value: 'packaging_defect', text: 'Повреждена упаковка' }], onPick: (v) => { ui.kind = v; ui.shown = state.prefs.rows; renderDefects(); } })
        + dropdown('f-period', { label: 'Период', value: ui.period, options: PERIODS, onPick: (v) => { ui.period = v; ui.shown = state.prefs.rows; renderDefects(); } })
        + resetLink('defects'))
      + '<div id="rows"></div>';
    wirePhotos($('view'));
    wireView(ui, renderDefects, renderDefectRows);
    renderDefectRows();
  }
  function renderDefectRows() {
    const ui = state.ui.defects; const rows = filteredDefects(); const host = $('rows');
    host.innerHTML = rows.length ? table([
      { title: 'Фото', cls: 'w-photo', cell: (e) => photo(e.sku) },
      { title: 'Товар', cell: (e) => `<span class="cell-main">${h(e.name)}</span>${wbIds(e.sku).length ? `<span class="cell-sub">Артикул WB: ${h(wbIds(e.sku).join(', '))}</span>` : ''}` },
      { title: 'Кол-во', cls: 'n', cell: (e) => num(e.qty) },
      { title: 'Что с товаром', cell: (e) => `${badge(BUCKET[e.bucket] || e.bucket, 'issue')}${e.note ? `<span class="cell-sub">${h(e.note)}</span>` : ''}` },
      { title: 'Откуда', cell: (e) => `<span class="cell-main">${h(e.source)}</span>${e.document ? `<span class="cell-sub">${h(e.document)}</span>` : ''}` },
      { title: 'Когда', cls: 'n', cell: (e) => h(when(e.at)) },
    ], rows.slice(0, ui.shown)) + moreFooter(ui, rows.length, ['случай', 'случая', 'случаев'])
      : '<div class="table-wrap">' + empty('Ничего не найдено', state.data.defects.events.length ? 'Под выбранные фильтры случаев нет.' : 'Склад ещё не признавал ваш товар браком.', 'check') + '</div>';
    wireRows(host, ui, renderDefectRows);
  }

  // ---------- Карточки ----------
  function openDrawer(title, eyebrow) {
    state.drawerRun += 1; $('drawerTitle').textContent = title; $('drawerEyebrow').textContent = eyebrow; $('drawerBody').innerHTML = loading;
    if (!$('drawer').open) $('drawer').showModal();
    return state.drawerRun;
  }
  $('closeDrawer').onclick = () => $('drawer').close();
  $('drawer').addEventListener('close', () => { state.drawerRun += 1; });
  $('drawer').addEventListener('click', (e) => { if (e.target === $('drawer') && e.clientX < $('drawer').getBoundingClientRect().left) $('drawer').close(); });
  const mini = (label, value) => `<div><span>${h(label)}</span><strong>${value == null ? '—' : n(value)}</strong></div>`;

  async function openProduct(sku) {
    const r = (state.data.stock || []).find((x) => x.sku === sku)
      || (state.data.defects?.now || []).find((x) => x.sku === sku) || { sku, name: sku };
    const run = openDrawer(productName(r), 'Карточка товара');
    const ids = wbIds(sku);
    $('drawerBody').innerHTML = `<div class="drawer-meta"><span>Артикул WB <b>${h(ids.join(', ') || 'не передан')}</b></span><span>Штрихкод <b>${h(r.barcode || 'не указан')}</b></span>${vendorCodes(sku).length ? `<span>Артикул продавца <b>${h(vendorCodes(sku).join(', '))}</b></span>` : ''}</div>`
      + `<div class="mini-stats">${mini('Всего', total(r))}${mini('Заказано', orderedQty(r))}${mini('В сборке', assemblyQty(r))}${mini('В пути', transitQty(r))}${mini('Доступно', availableQty(r))}${mini('Брак', r.defective || 0)}</div>`
      + `<div class="drawer-actions"><button class="button" id="productOrders">Заказы с этим товаром</button>${ids[0] ? `<a class="button ghost" href="${h(wbLink(ids[0]))}" target="_blank" rel="noopener">Карточка на WB</a>` : ''}</div>`
      + `<section class="detail-section"><h3>Движение товара</h3><div id="productHistory">${loading}</div></section>`
      + (r.updatedAt ? `<p class="help" style="margin-top:20px">Учёт на ${h(when(r.updatedAt))}</p>` : '');
    $('productOrders').onclick = () => { Object.assign(state.ui.orders, state.defaults.orders(), { q: ids[0] || productName(r), shown: state.prefs.rows }); $('drawer').close(); location.hash = 'orders'; };
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
  function historyEvent(e) {
    const labels = { received: 'Принято на склад', picked: 'Собрано для заказа', shipped: 'Отгружено со склада', returned: 'Возврат', add: 'Добавлено', remove: 'Списано', move: 'Перемещение', adjust: 'Корректировка', set: 'Пересчёт', inventory_adjust: 'Пересчёт', inventory: 'Пересчёт', kit_assemble: 'Собран набор', repack: 'Перепаковка', canceled_pick_return: 'Возвращено после отмены WB', initial_load: 'Начальный остаток на складе', initial_load_undo: 'Отмена начального остатка' };
    const sign = ['received', 'returned', 'initial_load'].includes(e.kind) ? '+' : ['shipped', 'initial_load_undo'].includes(e.kind) ? '−' : '';
    return `<li><div class="timeline-line"><strong>${h(labels[e.kind] || 'Операция склада')}</strong><span>${sign}${n(e.qty)} шт.</span></div><time>${e.at ? h(when(e.at)) : 'время не сохранено'}</time>${e.document ? `<p>${h(e.document)}</p>` : ''}${e.supplyNumber ? `<p>Поставка ${h(e.supplyNumber)}</p>` : ''}${e.quality ? `<p>${h(BUCKET[e.quality] || e.quality)}</p>` : ''}${e.note ? `<p>${h(e.note)}</p>` : ''}</li>`;
  }

  async function openDocument(id, order = false) {
    const list = order ? state.data.orders.rows : state.data.documents.rows;
    const selected = list.find((r) => r.id === id); if (!selected) return;
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
        : badge(...((data.direction === 'return' ? RETURN_STATUS : INBOUND_STATUS)[data.status] || [data.status]));
      const facts = !order && data.direction === 'in' ? [
        selected.carrier && `<span>Вёз <b>${h(selected.carrier)}</b>${selected.vehicle ? `, машина <b>${h(selected.vehicle)}</b>` : ''}</span>`,
        selected.first_at && `<span>Начали выгрузку <b>${h(when(selected.first_at))}</b></span>`,
        (selected.received_by || []).length && `<span>Принимали <b>${h(selected.received_by.join(', '))}</b></span>`,
        selected.inbound_comment && `<span>Комментарий: ${h(selected.inbound_comment)}</span>`,
      ].filter(Boolean).join('') : '';
      items.sort((a, b) => Number(b.finalized && b.accepted !== Number(b.declared_qty)) - Number(a.finalized && a.accepted !== Number(a.declared_qty)));
      $('drawerBody').innerHTML = `<div class="drawer-meta"><span>Загружено ${h(when(data.created_at))}</span>${statusBadge}${facts}</div>`
        + (order && detail.stock_conflict ? notice('Заказ закрыт на Wildberries', detail.mp_close_reason === 'fulfilled' ? 'WB сообщил о завершении, а отгрузка в Аргусе ещё не подтверждена. До сверки количество остаётся в сборке.' : 'Товар уже был собран. Склад возвращает его на полку; до этого он учтён в сборке.', true) : '')
        + `<div class="mini-stats">${mini('Заявлено', declared)}${mini(doneWord, items.some((r) => r.accepted !== null) ? done : null)}${mini('Расхождение', complete ? done - declared : null)}</div>`
        + (!complete ? '<p class="help" style="margin-bottom:16px">Работа ещё идёт: показано уже сделанное, расхождение появится в конце.</p>' : '')
        + `<section class="detail-section" style="margin-top:0"><h3>Позиции · ${items.length}</h3><div class="receipt-lines">${items.map((r) => {
          const dec = Number(r.declared_qty); const diff = r.finalized && r.accepted !== dec; const scale = Math.max(1, dec, r.accepted || 0);
          return `<article class="receipt-item ${diff ? 'issue' : ''}"><h3>${h(productName(r))}</h3><span class="cell-sub">Артикул WB: ${h((order ? [selected.mp_nm_id] : wbIds(r.sku)).filter(Boolean).join(', ') || 'не передан')}</span>${diff ? `<span class="row-note bad">Расхождение: ${n(r.accepted - dec)} шт.</span>` : ''}`
            + `<div class="receipt-bars"><div class="receipt-bar"><span>Заявлено</span><div class="track"><i style="width:${dec / scale * 100}%"></i></div><span class="num">${n(dec)}</span></div><div class="receipt-bar"><span>${doneWord}</span><div class="track accepted"><i style="width:${(r.accepted || 0) / scale * 100}%"></i></div><span class="num">${r.accepted == null ? '—' : n(r.accepted)}</span></div></div>`
            + (r.buckets || []).map((b) => `<p class="row-note ${b.qualityBucket === 'good' ? '' : 'bad'}">${h(BUCKET[b.qualityBucket] || b.qualityBucket)}: ${n(b.qty)} шт.${b.defectNote ? ' — ' + h(b.defectNote) : ''}</p>`).join('') + '</article>';
        }).join('')}</div></section>`
        + `<div class="drawer-actions">${!order && data.direction === 'in' ? `<a class="button" href="act_print.html?kind=receipt&id=${encodeURIComponent(id)}" target="_blank" rel="noopener">${icon('document')}Акт приёмки</a>` : ''}${!order && data.direction === 'return' ? `<button class="button" id="exportDocument">${icon('download')}Excel этого возврата</button>` : ''}</div>`;
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

  // Привоз на склад файлом (владелец 25.09.2026) — кто везёт и на чём
  // (26.09.2026) пишут здесь же: это и есть документы на выгрузку.
  function openInbound() {
    const run = openDrawer('Привезти товар на склад', 'Новый приход'); const f = { grid: null, name: '', preview: null, busy: false, error: '' };
    const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('sv-SE');
    $('drawerBody').innerHTML = `<form class="inbound-form" id="inboundForm"><p class="help">Загрузите таблицу, по которой собираете товар: шаблон поставки WB, свою таблицу или выгрузку из 1С. Нужны количество и штрихкод, артикул или название.</p>
      <div class="field"><span>Файл Excel или CSV</span><label class="file-pick"><input type="file" id="inboundFile" accept=".xlsx,.xls,.csv"><span class="button">${icon('document')}Выбрать файл</span><span class="help" id="inboundFileName">Файл не выбран</span></label></div>
      <div class="two"><label class="field"><span>Когда привезёте</span><input type="date" id="inboundDate" value="${tomorrow}"></label><label class="field"><span>Номер машины</span><input id="inboundVehicle" maxlength="20" placeholder="А123ВС 77"></label></div>
      <label class="field"><span>Кто везёт — транспортная компания или водитель</span><input id="inboundCarrier" maxlength="120" placeholder="ТК «Деловые линии» или Иван, +7 900 …"></label>
      <label class="field"><span>Комментарий складу</span><input id="inboundComment" maxlength="300" placeholder="Сколько коробов и паллет"></label>
      <div id="inboundPreview"></div></form>`;
    function draw() {
      if (run !== state.drawerRun) return; const p = f.preview;
      $('inboundFileName').textContent = f.name || 'Файл не выбран';
      $('inboundPreview').innerHTML = f.error ? notice('Файл не принят', f.error, true) : f.busy && !p ? loading : !p ? ''
        : `<div class="mini-stats">${mini('Товаров', p.summary.products)}${mini('Штук', p.summary.units)}${mini('Не узнали строк', p.summary.notMatched)}</div>`
          + (p.summary.notMatched ? notice('Часть строк не попадёт в приход', 'Товара нет в вашем каталоге на складе или количество не целое. Проверьте штрихкод, артикул и количество.', true) : '')
          + table([{ title: 'Строка файла', cell: (l) => `<span class="cell-main" style="font-weight:400">${h([l.barcode, l.article, l.name].filter(Boolean).join(' · '))}</span><span class="cell-sub">строка ${l.row}</span>` },
            { title: 'Товар на складе', cell: (l) => (l.sku ? `<span class="cell-main" style="font-weight:400">${h(l.productName)}</span><span class="cell-sub">узнали по: ${h(l.by)}</span>` : `<span class="row-note bad" style="margin:0">${h(l.error || 'Не узнали')}</span>`) },
            { title: 'Шт.', cls: 'n', cell: (l) => (l.error ? '—' : n(l.qty)) }], p.lines)
          + `<button class="button primary" type="submit" style="margin-top:16px;width:100%" ${f.busy || !p.summary.products ? 'disabled' : ''}>${f.busy ? 'Отправляем…' : 'Отправить на склад'}</button>`;
    }
    async function send(apply) {
      f.busy = true; f.error = ''; draw();
      try {
        const r = await api('/api/sellers/inbound', { method: 'POST', body: { grid: f.grid, apply, plannedDate: $('inboundDate').value || null,
          comment: $('inboundComment').value, carrier: $('inboundCarrier').value, vehicle: $('inboundVehicle').value } });
        if (run !== state.drawerRun) return;
        if (apply) { $('drawer').close(); state.data.documents = null; toast('Приход ' + r.invoice.number + ' отправлен на склад'); navigate(true); return; }
        f.preview = r;
      } catch (e) { f.error = e.message; }
      f.busy = false; draw();
    }
    $('inboundFile').onchange = (e) => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return; f.preview = null; f.error = ''; f.name = file.name;
      if (typeof XLSX === 'undefined') { f.error = 'Не загрузился модуль чтения Excel. Обновите страницу.'; draw(); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          // CSV — только как текст: иначе «1,5» превращается в 15. Русский Excel пишет CSV в Windows-1251.
          let book;
          if (/\.(csv|txt)$/i.test(file.name)) { let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(reader.result); } catch { text = new TextDecoder('windows-1251').decode(reader.result); } book = XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true }); }
          else book = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
          const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: true, defval: null });
          // Ведомость 1С бывает в двести колонок: серверу нужны подписи слева и итог справа.
          const wide = rows.slice(0, 25).some((r) => r.some((v) => /^конечный остаток$/i.test(String(v ?? '').trim())));
          f.grid = rows.slice(0, 20000).map((r) => (wide && r.length > 13 ? r.slice(0, 4).concat(r.slice(-9)) : r.slice(0, 40))); send(false);
        } catch (err) { f.error = 'Не удалось прочитать файл: ' + err.message; draw(); }
      };
      reader.readAsArrayBuffer(file);
    };
    $('inboundForm').onsubmit = (e) => { e.preventDefault(); if (f.preview && !f.busy) send(true); };
  }

  // Кнопка названия товара в таблицах тоже открывает карточку.
  document.addEventListener('click', (e) => {
    const p = e.target.closest('[data-open-product]'); if (p && !p.closest('tr.clickable')) { openProduct(p.dataset.openProduct); }
  });

  paintIcons();
  boot();
})();
