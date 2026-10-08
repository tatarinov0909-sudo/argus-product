/* Панель выбора товаров (владелец 06.10.2026: «везде, где выбирают товар, —
   как у виртуального склада»; правило — rules/architecture.md). Поиск,
   галочки, протягивание левой кнопкой мыши, количество у строки; выбор не
   теряется между страницами и при поиске. Excel: лист, строка заголовков и
   столбцы выбираются явно, строки узнаёт сервер по каталогу продавца
   (POST /api/products/match). Что делать с выбором, решает тот, кто открыл
   панель (onSubmit). Вид — тот же, что у переноса в виртуальный склад. */
(function(){
  'use strict';
  const PAGE_SIZE = 50, MAX_FILE = 10 * 1024 * 1024, MAX_FILE_ROWS = 10000, MATCH_CHUNK = 1000;
  const mounted = new WeakMap();
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => value == null ? '—' : Number(value).toLocaleString('ru-RU');
  const integer = value => { const s = String(value).trim().replace(/[   ]/g, ''); const n = Number(s); return /^\d+$/.test(s) && Number.isSafeInteger(n) && n > 0 ? n : null; };
  const low = value => String(value == null ? '' : value).toLowerCase();
  const rules = new Intl.PluralRules('ru');
  const counted = (n, one, few, many) => fmt(n) + ' ' + ({ one, few, many }[rules.select(n)] || many);
  const button = (action, title, extra = '') => '<button type="button" class="vws-button" data-action="' + action + '" ' + extra + '>' + title + '</button>';
  const choice = (label, current, options, action) => '<details class="vws-choice"><summary><span>' + esc(label) + '</span><b>' + esc(current) + '</b></summary><div class="vws-choice-menu">'
    + options.map(o => button(action, esc(o.label), 'data-value="' + esc(o.value) + '"')).join('') + '</div></details>';

  // o: host, request(path, {method, body}), companyId, loadRows() → [{sku, name, barcode}],
  //    columns [{title, value(row)}], limit(row) → число или null (больше — с предупреждением),
  //    defaultQty(row), submitLabel, onSubmit(items) — бросает Error, если не получилось,
  //    eyebrow, title, subtitle, closeLabel, onClose, flat, maxItems, templateName,
  //    submitAtEnd — главная кнопка под списком, в конце формы (правила 08.10:
  //    «главная кнопка под последним полем»), а не в строке выбора.
  function open(o){
    const host = o.host;
    mounted.get(host)?.close();
    const events = new AbortController();
    const maxItems = o.maxItems || 500, columns = o.columns || [];
    const state = { rows: [], bySku: new Map(), loading: true, error: '', message: '', search: '', page: 0, onlySelected: false,
      selected: new Map(), drafts: new Map(), mode: 'pick', busy: false, closed: false, paint: null, searchTimer: null,
      workbook: null, sheet: '', header: 0, mapping: { sku: '', barcode: '', qty: '' }, imported: [], importPage: 0, importVerified: false, fileRun: 0 };
    const el = selector => host.querySelector(selector);
    const limitOf = sku => { const row = state.bySku.get(sku); const n = row && o.limit ? o.limit(row) : null; return Number.isFinite(n) ? n : null; };
    const total = () => [...state.selected.values()].reduce((n, row) => n + (integer(row.qty) || 0), 0);
    const warnOf = sku => {
      const row = state.selected.get(sku); if(!row) return '';
      const qty = integer(row.qty), limit = limitOf(sku);
      if(!qty) return 'Укажите количество';
      return limit != null && qty > limit ? 'Больше, чем доступно (' + fmt(limit) + ')' : '';
    };

    function close(notify = false){
      state.closed = true; state.fileRun++; clearTimeout(state.searchTimer); events.abort(); mounted.delete(host); host.innerHTML = ''; host.hidden = true;
      if(notify) o.onClose?.();
    }
    // reload — перечитать каталог (завели новый товар), выбор остаётся.
    const controller = { close, reload: () => load() };
    mounted.set(host, controller); host.hidden = false;

    function shell(){
      host.innerHTML = '<div class="vws-panel' + (o.flat ? ' pp-flat' : '') + '">'
        + (o.title ? '<div class="vws-heading"><div>' + (o.eyebrow ? '<p class="vws-eyebrow">' + esc(o.eyebrow) + '</p>' : '') + '<h2>' + esc(o.title) + '</h2>'
          + (o.subtitle ? '<p class="vws-sub">' + esc(o.subtitle) + '</p>' : '') + '</div>' + (o.closeLabel ? button('close', esc(o.closeLabel)) : '') + '</div>' : '')
        + '<div class="vws-notice" data-role="notice" role="status" hidden></div><div data-role="content"></div></div>';
    }
    function notice(){
      const box = el('[data-role=notice]'); if(!box) return;
      box.hidden = !state.error && !state.message;
      box.textContent = state.error || state.message;
      box.classList.toggle('vws-error', !!state.error); box.setAttribute('role', state.error ? 'alert' : 'status');
    }
    async function load(){
      state.loading = true; state.error = ''; render();
      try{
        const rows = await o.loadRows();
        if(state.closed) return;
        if(!Array.isArray(rows)) throw new Error('Не удалось прочитать список товаров.');
        state.rows = rows.map(r => ({ ...r, sku: String(r.sku), name: String(r.name || r.sku), barcode: r.barcode ? String(r.barcode) : '' }));
        state.bySku = new Map(state.rows.map(r => [r.sku, r]));
      } catch(error){ if(state.closed) return; state.error = error.message || 'Не удалось загрузить товары.'; }
      state.loading = false; render();
    }
    function visible(){
      const words = low(state.search).split(/\s+/).filter(Boolean);
      const list = state.onlySelected ? state.rows.filter(r => state.selected.has(r.sku)) : state.rows;
      return words.length ? list.filter(r => { const hay = low(r.name + ' ' + r.sku + ' ' + r.barcode); return words.every(w => hay.includes(w)); }) : list;
    }
    function pager(count, page, action){
      const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
      return '<div class="vws-pager">' + button(action, '← Назад', 'data-page="' + (page - 1) + '"' + (page <= 0 ? ' disabled' : ''))
        + '<span>Страница ' + (page + 1) + ' из ' + pages + ' · ' + counted(count, 'строка', 'строки', 'строк') + '</span>' + button(action, 'Далее →', 'data-page="' + (page + 1) + '"' + (page + 1 >= pages ? ' disabled' : '')) + '</div>';
    }
    function selectionHtml(){
      return '<div class="vws-selection"><div><b data-role="selected-total"></b><p class="vws-sub">Выбор сохраняется между страницами и при поиске.</p></div><div class="vws-actions">'
        + button('only', state.onlySelected ? 'Показать все' : 'Только выбранные', 'data-role="only"')
        + button('clear', 'Снять выбор', 'data-role="clear"')
        + (o.submitAtEnd ? '' : submitButton()) + '</div></div>';
    }
    function submitButton(){
      return button('submit', esc(state.busy ? 'Отправляем…' : o.submitLabel || 'Готово'), 'data-role="submit"');
    }
    function pickHtml(){
      const list = visible();
      state.page = Math.min(state.page, Math.max(0, Math.ceil(list.length / PAGE_SIZE) - 1));
      const rows = list.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
      return '<div class="vws-toolbar pp-toolbar"><label class="vws-search"><span>Найти товар</span><input type="search" data-action="search" aria-label="Найти товар" placeholder="Название, артикул или штрихкод" value="' + esc(state.search) + '"></label>'
        + '<div class="vws-actions">' + button('import', 'Загрузить Excel') + button('template', 'Скачать шаблон') + '</div></div>'
        + selectionHtml() + '<p class="vws-sub vws-instruction">Отмечайте строки галочками или проводите левой кнопкой мыши по товарам. Количество можно вписать сразу — строка отметится сама.</p>'
        + (rows.length ? '<div class="vws-table-wrap"><table class="vws-table pp-table"><colgroup><col class="vws-check-col"><col>' + columns.map(() => '<col class="pp-num-col">').join('') + '<col class="pp-qty-col"></colgroup>'
          + '<thead><tr><th><input type="checkbox" data-action="page-select" aria-label="Выбрать товары на этой странице"></th><th>Товар</th>' + columns.map(c => '<th>' + esc(c.title) + '</th>').join('') + '<th>Штук</th></tr></thead><tbody>'
          + rows.map(r => {
            const picked = state.selected.get(r.sku), qty = picked ? picked.qty : state.drafts.get(r.sku) ?? '';
            return '<tr class="vws-row' + (picked ? ' vws-selected' : '') + '" data-sku="' + esc(r.sku) + '"><td data-label="Выбрать"><input type="checkbox" data-action="row-select" aria-label="Выбрать ' + esc(r.name) + '"' + (picked ? ' checked' : '') + '></td>'
              + '<td data-label="Товар"><b>' + esc(r.name) + '</b><div class="vws-identifiers"><span>Артикул: ' + esc(r.sku) + '</span>' + (r.barcode ? '<span>Штрихкод: ' + esc(r.barcode) + '</span>' : '') + '</div></td>'
              + columns.map(c => '<td class="vws-num" data-label="' + esc(c.title) + '">' + fmt(c.value(r)) + '</td>').join('')
              + '<td data-label="Штук"><input class="vws-quantity" type="text" inputmode="numeric" data-action="qty" data-sku="' + esc(r.sku) + '" aria-label="Количество ' + esc(r.name) + '" value="' + esc(qty) + '">'
              + '<div class="pp-warn" data-warn="' + esc(r.sku) + '"></div></td></tr>';
          }).join('') + '</tbody></table></div>'
          : '<div class="vws-empty"><b>' + (state.search ? 'Товар не найден' : state.onlySelected ? 'Ничего не выбрано' : 'В каталоге продавца нет товаров') + '</b><p>Измените поиск. Новый товар заводят в «Товары» → «Добавить товар».</p></div>')
        + pager(list.length, state.page, 'page')
        + (o.submitAtEnd ? '<div class="pp-end">' + submitButton() + '</div>' : '');
    }
    function importHtml(){
      let html = '<div class="vws-import-head"><div><h3>Загрузка из Excel</h3><p class="vws-sub">Файл остаётся в браузере. Нужны артикул или штрихкод и целое количество. Каждый столбец выбирается явно.</p></div><div class="vws-actions">'
        + button('pick', '← Выбор товаров') + button('file', 'Выбрать файл') + button('template', 'Скачать шаблон') + '</div></div><input type="file" data-role="file" accept=".xlsx,.xls,.csv" hidden>';
      if(!state.workbook) return html + '<div class="vws-empty">Выберите .xlsx, .xls или .csv до 10 МБ. Формулы в используемых столбцах не принимаются.</div>';
      const sheet = state.workbook.Sheets[state.sheet], range = window.XLSX.utils.decode_range(sheet['!ref']);
      const cols = [];
      for(let c = range.s.c; c <= range.e.c; c++) cols.push({ value: String(c), label: window.XLSX.utils.encode_col(c) + ' — ' + (cellLabel(sheet, state.header, c) || 'Без заголовка') });
      const optional = [{ value: '', label: 'Не использовать' }, ...cols];
      const heads = []; for(let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 19); r++) heads.push({ value: String(r), label: 'Строка ' + (r + 1) + ' — ' + cols.slice(0, 4).map((_, i) => cellLabel(sheet, r, range.s.c + i)).filter(Boolean).join(' · ') });
      html += '<div class="vws-import-mapping">' + choice('Лист', state.sheet, state.workbook.SheetNames.map(n => ({ value: n, label: n })), 'sheet')
        + choice('Строка заголовков', 'Строка ' + (state.header + 1), heads, 'header')
        + choice('Артикул', cols.find(c => c.value === state.mapping.sku)?.label || 'Не использовать', optional, 'map-sku')
        + choice('Штрихкод', cols.find(c => c.value === state.mapping.barcode)?.label || 'Не использовать', optional, 'map-barcode')
        + choice('Количество', cols.find(c => c.value === state.mapping.qty)?.label || 'Выберите столбец', optional, 'map-qty') + '</div>'
        + '<p class="vws-sub">Коды длиннее 15 значащих цифр укажите в Excel текстом. Ведущие нули коротких числовых кодов сохраняются по формату ячейки.</p>'
        + '<div class="vws-actions">' + button('parse', state.imported.length ? 'Проверить ещё раз' : 'Проверить строки файла') + '</div>';
      if(!state.imported.length) return html;
      const active = state.imported.filter(r => !r.excluded), problems = active.filter(r => r.error).length, rows = state.imported.slice(state.importPage * PAGE_SIZE, (state.importPage + 1) * PAGE_SIZE);
      html += '<div class="vws-import-summary" data-role="import-summary">' + importSummary(active, problems) + '</div><div class="vws-table-wrap"><table class="vws-table vws-import-table"><thead><tr><th>Строка</th><th>Товар и код из файла</th><th>Количество</th><th>Проверка</th><th>Действие</th></tr></thead><tbody>'
        + rows.map(r => '<tr class="' + (r.excluded ? 'vws-excluded' : '') + '" data-line="' + r.line + '"><td class="vws-num" data-label="Строка">' + r.line + '</td><td data-label="Товар"><b>' + esc(r.product?.name || r.sku || r.barcode || 'Код не указан') + '</b><div class="vws-identifiers">' + esc([r.sku ? 'Артикул: ' + r.sku : '', r.barcode ? 'Штрихкод: ' + r.barcode : ''].filter(Boolean).join(' · ')) + '</div></td>'
          + '<td data-label="Количество"><input type="text" inputmode="numeric" class="vws-quantity" data-action="import-qty" data-line="' + r.line + '" aria-label="Количество в строке ' + r.line + '" value="' + esc(r.qty) + '"' + (r.excluded ? ' disabled' : '') + '></td>'
          + '<td data-label="Проверка" class="vws-import-status" data-status-line="' + r.line + '">' + esc(importRowStatus(r)) + '</td><td data-label="Действие">' + button('exclude', r.excluded ? 'Вернуть' : 'Исключить', 'data-line="' + r.line + '"') + '</td></tr>').join('')
        + '</tbody></table></div>' + pager(state.imported.length, state.importPage, 'import-page') + '<div class="vws-actions">' + button('apply-import', 'Добавить проверенные строки в выбор', 'data-role="apply-import"' + (!active.length || problems || !state.importVerified ? ' disabled' : '')) + '</div>';
      return html;
    }
    const importRowStatus = r => r.excluded ? 'Исключена' : r.error || (state.importVerified ? 'Можно добавить' : 'Нужна проверка на сервере');
    const importSummary = (rows, errors) => '<b>' + fmt(rows.length) + ' строк · ' + fmt(rows.reduce((n, r) => n + (integer(r.qty) || 0), 0)) + ' шт.</b><span>' + (errors ? 'Нужно исправить или исключить: ' + fmt(errors) + ' строк.' : state.importVerified ? 'Все строки проверены — добавьте их в выбор.' : 'Нажмите «Проверить ещё раз», чтобы сервер узнал товары.') + '</span>';

    function render(){
      if(state.closed) return; if(!el('[data-role=content]')) shell();
      const content = el('[data-role=content]');
      content.innerHTML = state.loading ? '<div class="vws-empty" role="status">Загружаем товары…</div>'
        : state.mode === 'import' ? importHtml() : !state.rows.length && state.error ? '<div class="vws-empty">' + button('reload', 'Повторить загрузку') + '</div>' : pickHtml();
      if(state.busy) host.querySelectorAll('[data-action]').forEach(control => { if(control.dataset.action !== 'close') control.disabled = true; });
      notice(); updateSelection();
    }
    function updateSelection(){
      host.querySelectorAll('.vws-row').forEach(tr => {
        const sku = tr.dataset.sku, picked = state.selected.has(sku);
        tr.classList.toggle('vws-selected', picked); tr.querySelector('[data-action=row-select]').checked = picked;
        const input = tr.querySelector('[data-action=qty]'), row = state.selected.get(sku);
        if(row && input !== document.activeElement && input.value !== row.qty) input.value = row.qty;
        const warn = tr.querySelector('[data-warn]'); if(warn) warn.textContent = warnOf(sku);
      });
      const count = el('[data-role=selected-total]'); if(count) count.textContent = 'Выбрано ' + counted(state.selected.size, 'позиция', 'позиции', 'позиций') + ' · ' + fmt(total()) + ' шт.';
      const submit = el('[data-role=submit]'); if(submit) submit.disabled = !state.selected.size || state.busy;
      const clear = el('[data-role=clear]'); if(clear) clear.disabled = !state.selected.size || state.busy;
      const only = el('[data-role=only]'); if(only) only.disabled = state.busy || !state.selected.size && !state.onlySelected;
      const boxes = [...host.querySelectorAll('[data-action=row-select]')], master = el('[data-action=page-select]');
      if(master){ const n = boxes.filter(b => b.checked).length; master.checked = !!boxes.length && n === boxes.length; master.indeterminate = n > 0 && n < boxes.length; master.disabled = !boxes.length || state.busy; }
    }
    function select(sku, on){
      if(state.busy) return; const row = state.bySku.get(sku); if(!row || on === state.selected.has(sku)) return;
      if(on){
        if(state.selected.size >= maxItems){ state.error = 'За один раз можно выбрать не больше ' + maxItems + ' товаров.'; notice(); return; }
        const draft = state.drafts.get(sku);
        state.selected.set(sku, { sku, name: row.name, qty: draft != null && draft !== '' ? draft : String(o.defaultQty ? o.defaultQty(row) ?? '' : '') });
      } else state.selected.delete(sku);
      state.error = ''; notice();
    }
    function setQty(sku, value){
      state.drafts.set(sku, value);
      const picked = state.selected.get(sku);
      if(picked) picked.qty = value;
      else if(integer(value)) select(sku, true);
    }

    // ---------- Excel ----------
    function cellText(sheet, r, c, code){
      const cell = sheet[window.XLSX.utils.encode_cell({ r, c })]; if(!cell) return '';
      if(cell.f) throw new Error('Строка ' + (r + 1) + ': формулу замените обычным значением.');
      if(cell.t === 'd' || cell.v instanceof Date || cell.t === 'n' && cell.z && window.XLSX.SSF?.is_date(cell.z)) throw new Error('Строка ' + (r + 1) + ': Excel превратил код в дату. Укажите код текстом.');
      if(code && cell.t === 'n'){
        if(!Number.isSafeInteger(cell.v) || String(Math.abs(cell.v)).length > 15) throw new Error('Строка ' + (r + 1) + ': код длиннее 15 цифр или потерял точность. Укажите его текстом.');
        const shown = String(cell.w ?? window.XLSX.utils.format_cell(cell)).trim(); return /^\d+$/.test(shown) ? shown : String(cell.v);
      }
      return String(cell.v == null ? '' : cell.v).trim();
    }
    function cellLabel(sheet, r, c){
      const cell = sheet[window.XLSX.utils.encode_cell({ r, c })]; if(!cell) return ''; if(cell.f) return '(формула)';
      return String(cell.w ?? cell.v ?? '').trim();
    }
    // Размер листа — по самим ячейкам, а не по служебной пометке файла (проверка 05.10).
    function fitRange(sheet){
      if(!sheet) return; let r0 = Infinity, c0 = Infinity, r1 = -1, c1 = -1;
      for(const key of Object.keys(sheet)){
        if(key[0] === '!') continue; const cell = sheet[key];
        if(!cell || ((cell.v == null || cell.v === '') && cell.f == null)) continue;
        const a = window.XLSX.utils.decode_cell(key);
        if(a.r < r0) r0 = a.r; if(a.c < c0) c0 = a.c; if(a.r > r1) r1 = a.r; if(a.c > c1) c1 = a.c;
      }
      if(r1 < 0) delete sheet['!ref']; else sheet['!ref'] = window.XLSX.utils.encode_range({ s: { r: r0, c: c0 }, e: { r: r1, c: c1 } });
    }
    function setSheet(name, book = state.workbook){
      const sheet = book.Sheets[name], range = window.XLSX.utils.decode_range(sheet['!ref']);
      if(range.e.r - range.s.r + 1 > MAX_FILE_ROWS || range.e.c - range.s.c + 1 > 100) throw new Error('В листе больше 10 000 строк или 100 столбцов. Разделите файл.');
      state.sheet = name; state.header = range.s.r; state.mapping = { sku: '', barcode: '', qty: '' }; state.imported = []; state.importPage = 0; state.importVerified = false;
    }
    async function readFile(file){
      if(!file) return; if(!window.XLSX){ state.error = 'Excel ещё загружается. Повторите выбор файла.'; notice(); return; }
      if(file.size > MAX_FILE || !/\.(xlsx|xls|csv)$/i.test(file.name)){ state.error = 'Выберите .xlsx, .xls или .csv до 10 МБ.'; notice(); return; }
      const run = ++state.fileRun;
      try{
        const buffer = await file.arrayBuffer(); if(state.closed || run !== state.fileRun) return; let book;
        if(/\.csv$/i.test(file.name)){ let text; try{ text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch(_){ text = new TextDecoder('windows-1251').decode(buffer); } book = window.XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true }); }
        else book = window.XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true, cellNF: true });
        book.SheetNames.forEach(name => fitRange(book.Sheets[name]));
        const valid = book.SheetNames.filter(name => book.Sheets[name]?.['!ref']); if(!valid.length) throw new Error('В файле нет листа с данными.');
        book.SheetNames = valid; setSheet(valid[0], book); state.workbook = book; state.error = ''; render();
      } catch(error){ state.error = error.message || 'Не удалось прочитать файл.'; notice(); }
    }
    function parseFile(){
      const m = state.mapping; if((m.sku === '' && m.barcode === '') || m.qty === ''){ state.error = 'Выберите столбец количества и хотя бы один столбец: артикул или штрихкод.'; notice(); return; }
      const used = [m.sku, m.barcode, m.qty].filter(v => v !== ''); if(new Set(used).size !== used.length){ state.error = 'Артикул, штрихкод и количество должны быть в разных столбцах.'; notice(); return; }
      const sheet = state.workbook.Sheets[state.sheet], range = window.XLSX.utils.decode_range(sheet['!ref']), rows = [];
      for(let r = state.header + 1; r <= range.e.r; r++){
        const row = { line: r + 1, sku: '', barcode: '', qty: '', excluded: false, parseError: '' };
        try{ row.sku = m.sku === '' ? '' : cellText(sheet, r, Number(m.sku), true); row.barcode = m.barcode === '' ? '' : cellText(sheet, r, Number(m.barcode), true); row.qty = cellText(sheet, r, Number(m.qty), false); }
        catch(error){ row.parseError = error.message; }
        if(row.sku || row.barcode || row.qty || row.parseError) rows.push(row);
      }
      if(!rows.length){ state.error = 'Под выбранным заголовком нет строк с товаром и количеством.'; notice(); return; }
      state.imported = rows; state.importPage = 0; state.importVerified = false; validateImport(); state.error = ''; render(); checkImport();
    }
    function validateImport(){
      const seen = new Map();
      state.imported.forEach(r => {
        r.error = r.parseError || r.serverError || '';
        if(r.error || r.excluded) return;
        if(!integer(r.qty)) r.error = 'Укажите целое количество больше нуля.';
        else if(!r.sku && !r.barcode) r.error = 'Не указан артикул или штрихкод.';
        if(r.product){
          if(state.selected.has(r.product.sku)) r.error = 'Этот товар уже выбран. Исключите строку файла или уберите товар из выбора.';
          if(!seen.has(r.product.sku)) seen.set(r.product.sku, []); seen.get(r.product.sku).push(r);
        }
      });
      seen.forEach(rows => { if(rows.length > 1) rows.forEach(r => { r.error = 'Товар повторяется в строках ' + rows.map(x => x.line).join(', ') + '. Оставьте одну строку.'; }); });
      const active = state.imported.filter(r => !r.excluded), errors = active.filter(r => r.error).length, summary = el('[data-role=import-summary]');
      if(summary) summary.innerHTML = importSummary(active, errors);
      host.querySelectorAll('[data-status-line]').forEach(cell => { const r = state.imported.find(x => x.line === Number(cell.dataset.statusLine)); cell.textContent = importRowStatus(r); cell.classList.toggle('vws-error', !!r.error && !r.excluded); });
      const apply = el('[data-role=apply-import]'); if(apply) apply.disabled = !active.length || !!errors || !state.importVerified;
    }
    async function checkImport(){
      const active = state.imported.filter(r => !r.excluded); state.importVerified = false;
      active.forEach(r => { r.serverError = ''; r.product = null; }); validateImport();
      const checked = active.filter(r => !r.error); if(!checked.length){ render(); return; }
      state.busy = true; state.error = ''; state.message = 'Проверяем строки файла по каталогу продавца…'; render();
      try{
        for(let i = 0; i < checked.length; i += MATCH_CHUNK){
          const part = checked.slice(i, i + MATCH_CHUNK);
          const data = await o.request('/api/products/match', { method: 'POST', body: { companyId: o.companyId, lines: part.map(r => ({ sku: r.sku, barcode: r.barcode })) } });
          if(state.closed) return;
          if(!Array.isArray(data?.items) || data.items.length !== part.length) throw new Error('Сервер не подтвердил проверку файла.');
          data.items.forEach((item, k) => { if(item.error) part[k].serverError = item.error; else part[k].product = { sku: String(item.sku), name: item.name }; });
        }
        state.importVerified = true; validateImport();
      } catch(error){ if(state.closed) return; state.error = error.message || 'Не удалось проверить файл.'; }
      state.busy = false; state.message = ''; if(!state.closed) render();
    }
    function template(){
      if(!window.XLSX){ state.error = 'Excel ещё загружается. Повторите через секунду.'; notice(); return; }
      const sheet = window.XLSX.utils.aoa_to_sheet([['Артикул', 'Штрихкод', 'Количество']]);
      sheet['!cols'] = [{ wch: 24 }, { wch: 24 }, { wch: 16 }];
      for(let r = 1; r <= 100; r++){ sheet[window.XLSX.utils.encode_cell({ r, c: 0 })] = { t: 's', v: '', z: '@' }; sheet[window.XLSX.utils.encode_cell({ r, c: 1 })] = { t: 's', v: '', z: '@' }; }
      sheet['!ref'] = 'A1:C101'; const book = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(book, sheet, 'Товары'); window.XLSX.writeFile(book, (o.templateName || 'Товары') + '.xlsx');
    }

    async function submit(){
      const items = [...state.selected.values()], bad = items.filter(r => !integer(r.qty));
      if(bad.length){
        state.error = 'Укажите целое количество больше нуля: ' + bad.slice(0, 3).map(r => '«' + r.name + '»').join(', ') + (bad.length > 3 ? ' и ещё ' + (bad.length - 3) : '') + '.';
        notice(); return;
      }
      state.busy = true; state.error = ''; state.message = ''; render();
      try{ await o.onSubmit(items.map(r => ({ sku: r.sku, name: r.name, qty: integer(r.qty), limit: limitOf(r.sku) }))); }
      catch(error){ if(!state.closed) state.error = error.message || 'Не получилось.'; }
      state.busy = false; if(!state.closed) render();
    }

    function click(event){
      const control = event.target.closest('[data-action]'); if(!control || !host.contains(control) || control.disabled) return;
      const action = control.dataset.action; if(['qty', 'search', 'row-select', 'page-select', 'import-qty'].includes(action)) return;
      if(state.busy && action !== 'close') return;
      try{
        if(action === 'close') close(true);
        else if(action === 'reload') load();
        else if(action === 'template') template();
        else if(action === 'submit') submit();
        else if(action === 'file') el('[data-role=file]').click();
        else if(action === 'pick' || action === 'import'){ state.mode = action; state.error = ''; render(); }
        else if(action === 'page'){ state.page = Number(control.dataset.page); render(); host.scrollIntoView({ block: 'start' }); }
        else if(action === 'import-page'){ state.importPage = Number(control.dataset.page); render(); }
        else if(action === 'only'){ state.onlySelected = !state.onlySelected; state.page = 0; render(); }
        else if(action === 'clear'){ state.selected.clear(); state.onlySelected = false; render(); }
        else if(action === 'sheet'){ setSheet(control.dataset.value); state.error = ''; render(); }
        else if(action === 'header'){ state.header = Number(control.dataset.value); state.imported = []; render(); }
        else if(action.startsWith('map-')){ state.mapping[action.slice(4)] = control.dataset.value; state.imported = []; render(); }
        else if(action === 'parse'){ if(state.imported.length) checkImport(); else parseFile(); }
        else if(action === 'exclude'){ const r = state.imported.find(x => x.line === Number(control.dataset.line)); r.excluded = !r.excluded; validateImport(); render(); }
        else if(action === 'apply-import'){
          validateImport(); const active = state.imported.filter(r => !r.excluded); if(!state.importVerified || active.some(r => r.error)) return;
          if(state.selected.size + active.length > maxItems) throw new Error('За один раз можно выбрать не больше ' + maxItems + ' товаров.');
          active.forEach(r => { const row = state.bySku.get(r.product.sku); state.selected.set(r.product.sku, { sku: r.product.sku, name: row ? row.name : r.product.name, qty: String(integer(r.qty)) }); });
          state.mode = 'pick'; state.imported = []; state.workbook = null; state.onlySelected = true; state.page = 0;
          state.message = 'Строки файла добавлены в выбор — ниже только выбранные. Проверьте количество.'; render();
        }
      } catch(error){ state.error = error.message; notice(); }
    }
    function input(event){
      const control = event.target, action = control.dataset.action; if(state.busy) return;
      if(action === 'search'){ state.search = control.value; clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => { state.page = 0; const caret = control.selectionStart; render(); const box = el('[data-action=search]'); if(box){ box.focus(); box.setSelectionRange(caret, caret); } }, 200); }
      else if(action === 'qty'){ setQty(control.dataset.sku, control.value); updateSelection(); }
      else if(action === 'import-qty'){ const r = state.imported.find(x => x.line === Number(control.dataset.line)); r.qty = control.value; validateImport(); }
    }
    function change(event){
      const control = event.target; if(state.busy) return;
      if(control.dataset.role === 'file'){ const file = control.files?.[0]; control.value = ''; readFile(file); }
      else if(control.dataset.action === 'row-select'){ select(control.closest('.vws-row').dataset.sku, control.checked); updateSelection(); }
      else if(control.dataset.action === 'page-select'){ const on = control.checked; host.querySelectorAll('.vws-row').forEach(tr => select(tr.dataset.sku, on)); updateSelection(); }
    }
    host.addEventListener('click', click, { signal: events.signal });
    host.addEventListener('input', input, { signal: events.signal });
    host.addEventListener('change', change, { signal: events.signal });
    // Протягивание левой кнопкой мыши — как у виртуального склада.
    host.addEventListener('pointerdown', event => {
      if(event.button !== 0 || event.pointerType !== 'mouse' || state.busy || event.target.closest('button,a,summary,input[type=text],input[type=search]')) return;
      const tr = event.target.closest('.vws-row'); if(!tr) return;
      event.preventDefault(); state.paint = { on: !state.selected.has(tr.dataset.sku) }; select(tr.dataset.sku, state.paint.on); updateSelection();
    }, { signal: events.signal });
    document.addEventListener('pointermove', event => {
      if(!state.paint) return; const target = document.elementFromPoint(event.clientX, event.clientY), tr = target?.closest('.vws-row');
      if(tr && host.contains(tr) && !target.closest('[data-action=qty]')){ select(tr.dataset.sku, state.paint.on); updateSelection(); }
    }, { signal: events.signal });
    let suppressClick = false;
    document.addEventListener('pointerup', () => { if(!state.paint) return; state.paint = null; suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }, { signal: events.signal });
    host.addEventListener('click', event => { if(suppressClick && event.target.closest('[data-action=row-select]')){ event.preventDefault(); event.stopImmediatePropagation(); queueMicrotask(updateSelection); } }, { capture: true, signal: events.signal });
    document.addEventListener('keydown', event => { if(event.key !== 'Escape' || !host.contains(event.target)) return; const details = event.target.closest('details[open]'); if(details){ event.preventDefault(); details.open = false; details.querySelector('summary').focus(); } }, { signal: events.signal });
    document.addEventListener('click', event => host.querySelectorAll('details[open]').forEach(details => { if(!details.contains(event.target)) details.open = false; }), { signal: events.signal });
    shell(); load();
    return controller;
  }
  window.ArgusProductPicker = { open };
})();
