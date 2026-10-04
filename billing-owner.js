/* Один прайс каждого клиента, расчёт на сервере, неизменяемые счета. */
const ArgusBilling = (() => {
  const base = '/api/warehouses/billing';
  const services = {receiving:'Приёмка', picking:'Сборка заказов', returns:'Возвраты', storage:'Хранение'};
  const units = {cell_day:'место в день',unit_day:'штуку в день'};
  const statusLabels = {unpaid:'Ожидает оплаты',partial:'Оплачен частично',paid:'Оплачен',overdue:'Просрочен'};
  const state = {companyId:null,companies:[],tariff:null,schedule:null,preview:null,invoices:[],nextCursor:null,run:0};
  const esc = (value) => escapeHTML(String(value ?? ''));
  const money = (value) => value == null ? '—' : Number(value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' ₽';
  const date = (value) => value ? String(value).slice(0,10).split('-').reverse().join('.') : '—';
  const field = (id) => document.getElementById(id);
  const period = () => ({from:field('billFrom').value,to:field('billTo').value});
  function error(message){ field('billError').innerHTML = message ? '<div class="workspace-notice error">' + esc(message) + '</div>' : ''; }
  function selected(){ return state.companies.find(c => c.companyId === state.companyId); }
  function renderChoice(){
    const c = selected();
    field('billCompanyChoice').innerHTML = '<div class="finance-client-choice"><details class="workspace-choice"><summary><span class="finance-choice-name" title="' + esc(c ? c.name : 'Все клиенты — сводка') + '">' + esc(c ? c.name : 'Все клиенты — сводка') + '</span></summary><div class="workspace-choice-menu">'
      + '<button type="button" data-bill-company="">Все клиенты — сводка</button>'
      + state.companies.map(c => '<button type="button" data-bill-company="' + esc(c.companyId) + '" aria-pressed="' + (c.companyId === state.companyId) + '">' + esc(c.name) + '</button>').join('') + '</div></details></div>';
  }
  async function load(){
    const run = ++state.run;
    renderChoice();
    ['billTariff','billCharges','billInvoices'].forEach(id => { field(id).inert = true; field(id).setAttribute('aria-busy','true'); });
    if(!field('billFrom').value){ const previous = new Date(whDay(new Date()) + 'T12:00:00Z'); previous.setUTCDate(previous.getUTCDate()-1); const day = previous.toISOString().slice(0,10); field('billFrom').value = day.slice(0,7) + '-01'; field('billTo').value = day; }
    const p = period();
    if(!p.from || !p.to || p.from > p.to){ error('Выберите начало и конец периода. Начало должно быть не позднее конца.'); ['billTariff','billCharges','billInvoices'].forEach(id => {field(id).innerHTML='';field(id).inert=false;field(id).removeAttribute('aria-busy');}); return; }
    error('');
    const query = new URLSearchParams(p);
    try{
      // В сводке сервер отдаёт всех активных клиентов, даже без операций.
      const overview = await apiFetch(base + '/charges?' + query);
      if(run !== state.run) return;
      state.companies = overview.sellers || [];
      if(state.companyId && !selected()) state.companyId = null;
      state.preview = overview;
      renderChoice();
      const company = state.companyId ? '?companyId=' + encodeURIComponent(state.companyId) : '';
      const [tariff,schedule,invoices] = await Promise.all([
        state.companyId ? apiFetch(base + '/tariff' + company) : null,
        state.companyId ? apiFetch(base + '/schedule' + company) : null,
        apiFetch(base + '/invoices' + company)
      ]);
      if(run !== state.run) return;
      state.tariff = tariff; state.schedule = schedule;
      state.invoices = invoices.items || []; state.nextCursor = invoices.nextCursor;
      renderTariff(); renderCharges(); renderInvoices();
    } catch(e){ if(run === state.run){ error('Расчёты не загрузились: ' + e.message); ['billTariff','billCharges','billInvoices'].forEach(id => { field(id).innerHTML=''; }); } }
    finally{ if(run === state.run) ['billTariff','billCharges','billInvoices'].forEach(id => {field(id).inert=false;field(id).removeAttribute('aria-busy');}); }
  }
  function renderTariff(){
    const host = field('billTariff'), t = state.tariff;
    if(!state.companyId){ host.innerHTML = '<div class="workspace-notice finance-guide">Откройте клиента в сводке: его цены услуг, периодичность счетов и срок оплаты настраиваются отдельно.</div>'; return; }
    const s = state.schedule || {};
    host.innerHTML = '<div class="finance-client-context"><button type="button" class="workspace-back finance-back" data-bill-company="">← Все клиенты</button><h2>' + esc(selected().name) + '</h2></div>'
      + '<details class="workspace-invoice finance-panel" id="billTariffPanel"><summary><b>Прайс клиента</b><span>' + (t.configured ? 'Свои цены услуг' : 'Прайс ещё не настроен') + '</span></summary><div class="workspace-invoice-body" data-form>'
      + '<div class="workspace-notice">Новые цены применяются с указанной даты. Уже выставленные счета сохраняют свои суммы и состав.</div>'
      + '<div class="bill-prices">' + Object.entries(services).map(([k,label]) => '<label class="rc-field"><span>' + label + ', ₽</span><input type="text" inputmode="decimal" class="mp-field" data-bill-price="' + k + '" value="' + esc(t.prices?.[k] ?? '') + '" placeholder="Укажите цену"><small>' + (k === 'storage' ? 'Единица хранения — ниже' : k === 'picking' ? 'за заказ' : 'за штуку') + '</small></label>').join('') + '</div>'
      + '<div class="workspace-filters"><label class="rc-field"><span>Цены действуют с</span><input type="date" class="mp-field" id="billEffective" value="' + whDay(new Date()) + '"></label>'
      + '<fieldset class="bill-opts"><legend>Хранение</legend>' + Object.entries(units).map(([u,label]) => '<label><input type="radio" name="billUnit" value="' + u + '"' + ((t.storageUnit || 'cell_day') === u ? ' checked' : '') + '> За ' + label + '</label>').join('') + '</fieldset></div>'
      + '<label class="bill-opts finance-check"><input type="checkbox" id="billShow"' + (s.showSellers || t.showSellers ? ' checked' : '') + '><span>Показывать этому клиенту расчёты и счета в его кабинете</span></label>'
      + '<button type="button" class="workspace-button primary" id="billSave" onclick="ArgusBilling.saveTariff()">Сохранить цены клиента</button>'
      + (t.history?.length ? '<details class="workspace-section finance-history"><summary>История цен</summary><div class="workspace-table-wrap"><table class="workspace-table finance-table"><thead><tr><th>Действуют с</th>' + Object.values(services).map(label => '<th class="num">' + label + '</th>').join('') + '<th>Хранение за</th></tr></thead><tbody>' + t.history.map(h => '<tr><td data-label="Действуют с">' + date(h.effectiveFrom) + '</td>' + Object.keys(services).map(k => '<td class="num" data-label="' + services[k] + '">' + money(h.prices[k]) + '</td>').join('') + '<td data-label="Хранение за">' + esc(units[h.storageUnit]) + '</td></tr>').join('') + '</tbody></table></div></details>' : '')
      + '</div></details>'
      + '<details class="workspace-invoice finance-panel" id="billSchedulePanel"><summary><b>Периодичность счетов и срок оплаты</b><span>' + (s.enabled ? 'Автоматическое выставление включено' : 'Счета выставляются вручную') + '</span></summary><div class="workspace-invoice-body" data-form>'
      + '<label class="bill-opts finance-check"><input type="checkbox" id="billScheduleEnabled"' + (s.enabled ? ' checked' : '') + '><span>Выставлять отдельные счета этому клиенту автоматически</span></label>'
      + '<fieldset class="bill-opts"><legend>Как часто выставлять</legend>' + [['daily','Каждый день'],['weekly','Каждую неделю'],['monthly','Каждый месяц'],['custom','Свой интервал']].map(([key,label]) => '<label><input type="radio" name="billCadence" value="' + key + '"' + ((s.cadence || 'monthly') === key ? ' checked' : '') + '> ' + label + '</label>').join('') + '</fieldset>'
      + '<div class="workspace-filters"><label class="rc-field"><span>Первый расчётный день</span><input type="date" class="mp-field" id="billScheduleStart" value="' + esc(s.startDate || whDay(new Date())) + '"></label>'
      + '<label class="rc-field"><span>Свой интервал, дней</span><input type="number" class="mp-field" id="billInterval" min="1" max="366" value="' + esc(s.intervalDays || 30) + '"></label>'
      + '<label class="rc-field"><span>Оплатить в течение, дней</span><input type="number" class="mp-field" id="billPaymentDays" min="0" max="365" value="' + esc(s.paymentDays ?? 14) + '"></label></div>'
      + '<div class="ord-meta">Период счёта и срок его оплаты задаются отдельно. ' + (s.nextStart ? 'Следующий период начинается ' + date(s.nextStart) + '.' : '') + '</div>'
      + '<button type="button" class="workspace-button primary" id="billScheduleSave" onclick="ArgusBilling.saveSchedule()">Сохранить расписание</button></div></details>';
  }
  async function saveTariff(){
    const prices = {};
    document.querySelectorAll('[data-bill-price]').forEach(i => { prices[i.dataset.billPrice] = i.value.trim().replace(',','.'); });
    const effectiveFrom = field('billEffective').value;
    if(!effectiveFrom || Object.values(prices).some(v => !/^\d+(?:\.\d{1,2})?$/.test(v))){ error('Укажите дату и все четыре цены. Бесплатную услугу укажите как 0.'); return; }
    const button = field('billSave'); button.disabled = true;
    try{ await apiFetch(base + '/tariff',{method:'PUT',body:{companyId:state.companyId,effectiveFrom,prices,storageUnit:document.querySelector('[name="billUnit"]:checked').value,showSellers:field('billShow').checked}}); showWhToast('Персональный прайс сохранён.'); await load(); }
    catch(e){ error('Цены не сохранены: ' + e.message); button.disabled = false; }
  }
  async function saveSchedule(){
    const button = field('billScheduleSave'); button.disabled = true;
    try{ await apiFetch(base + '/schedule',{method:'PUT',body:{companyId:state.companyId,enabled:field('billScheduleEnabled').checked,cadence:document.querySelector('[name="billCadence"]:checked').value,intervalDays:Number(field('billInterval').value),startDate:field('billScheduleStart').value,paymentDays:Number(field('billPaymentDays').value)}}); showWhToast('Расписание счетов сохранено.'); await load(); }
    catch(e){ error('Расписание не сохранено: ' + e.message); button.disabled = false; }
  }
  function lineRows(lines){
    return (lines || []).map(l => '<tr><td data-label="Услуга">' + esc(l.title || services[l.service] || l.service) + '</td><td class="num" data-label="Количество">' + esc(l.qty) + '</td><td data-label="Единица">' + esc(l.unit) + '</td><td class="num" data-label="Цена">' + (l.rate == null && !l.missingTariff ? 'По истории цен' : money(l.rate)) + '</td><td class="num finance-amount" data-label="Сумма">' + (l.missingTariff ? 'Нет цены на дату работы' : money(l.amount)) + '</td></tr>'
      + ((l.details || []).length ? '<tr class="finance-source-row"><td colspan="5"><details class="finance-sources"><summary>Работы и даты</summary><div class="workspace-table-wrap"><table class="workspace-table finance-table"><thead><tr><th>Работа или дата</th><th class="num">Количество</th><th class="num">Цена</th><th class="num">Сумма</th></tr></thead><tbody>' + l.details.map(d => '<tr><td data-label="Работа или дата">' + esc(d.label || d.day || d.date || '') + '</td><td class="num" data-label="Количество">' + esc(d.qty) + '</td><td class="num" data-label="Цена">' + money(d.rate) + '</td><td class="num" data-label="Сумма">' + money(d.amount) + '</td></tr>').join('') + '</tbody></table></div></details></td></tr>' : '')).join('');
  }
  function linesTable(lines){ return '<div class="workspace-table-wrap"><table class="workspace-table finance-table finance-lines"><thead><tr><th>Услуга</th><th class="num">Количество</th><th>Единица</th><th class="num">Цена</th><th class="num">Сумма</th></tr></thead><tbody>' + lineRows(lines) + '</tbody></table></div>'; }
  function renderCharges(){
    const host = field('billCharges'), d = state.preview;
    const sellers = state.companyId ? d.sellers.filter(c => c.companyId === state.companyId) : d.sellers;
    const p = period();
    host.innerHTML = '<section class="workspace-section finance-charges"><div class="staff-head finance-section-head"><div><h3>' + (state.companyId ? 'Начисления клиента' : 'Начисления всех клиентов') + '</h3><div class="finance-period">' + date(p.from) + ' — ' + date(p.to) + '</div><div class="ord-meta">Приёмка, сборка, возвраты и ежедневное хранение из записанной работы. Упаковка и маркировка пока не учитываются.</div></div><button type="button" class="workspace-button" onclick="ArgusBilling.exportPreview()">Выгрузить в Excel</button></div>'
      + (state.companyId ? linesTable(sellers[0]?.lines || []) + '<div class="bill-total"><span>Итого за период</span><b>' + money(sellers[0]?.total) + '</b></div>'
        : '<div class="workspace-table-wrap"><table class="workspace-table finance-table finance-clients"><thead><tr><th>Клиент</th>' + Object.values(services).map(label => '<th class="num">' + label + '</th>').join('') + '<th class="num">Итого</th><th>Прайс</th></tr></thead><tbody>' + sellers.map(c => '<tr><td><button class="finance-client-button" type="button" data-bill-company="' + esc(c.companyId) + '"><span>' + esc(c.name) + '</span><span class="finance-client-arrow" aria-hidden="true">→</span></button></td>' + Object.keys(services).map(k => { const lines = (c.lines || []).filter(l => l.service === k); return '<td class="num" data-label="' + services[k] + '">' + (lines.length === 1 ? money(lines[0].amount) : lines.length ? 'См. детали' : money('0')) + '</td>'; }).join('') + '<td class="num finance-amount" data-label="Итого">' + money(c.total) + '</td><td data-label="Прайс"><span class="finance-price-status ' + (c.configured ? 'configured' : 'missing') + '">' + (c.configured ? 'Настроен' : 'Нужны цены клиента') + '</span></td></tr>').join('') + '</tbody></table></div>')
      + (state.companyId ? '<div class="workspace-filters finance-issue"><label class="rc-field"><span>Оплатить до (необязательно)</span><input type="date" class="mp-field" id="billDueDate"></label><button type="button" class="workspace-button primary" id="billIssue" onclick="ArgusBilling.issue()"' + (!sellers[0] || sellers[0].total == null || !state.tariff.configured || p.to >= whDay(new Date()) ? ' disabled' : '') + '>Выставить отдельный счёт клиенту</button></div><div class="ord-meta">Счёт выставляется за завершённые дни — по вчерашний день включительно. Сохранит цены и работы этого периода; пересекающийся счёт не создаётся.</div>' : '') + '</section>';
  }
  async function issue(){
    const p = period(), button = field('billIssue'); button.disabled = true;
    try{ const invoice = await apiFetch(base + '/invoices',{method:'POST',body:{companyId:state.companyId,...p,...(field('billDueDate').value ? {dueDate:field('billDueDate').value} : {})}}); showWhToast('Счёт ' + invoice.number + ' выставлен клиенту.'); await load(); }
    catch(e){ error('Счёт не выставлен: ' + e.message); button.disabled = false; }
  }
  function invoiceHtml(i){
    const remain = BigInt(i.balanceCents || '0') > 0n;
    return '<details class="workspace-invoice finance-invoice" data-invoice="' + esc(i.id) + '"><summary><span class="finance-invoice-name"><b>Счёт ' + esc(i.number) + '</b><span>' + esc(i.companyName) + '</span></span><span class="finance-invoice-period">' + date(i.from) + ' — ' + date(i.to) + '</span><b class="finance-invoice-amount">' + money(i.total) + '</b><span class="invoice-status ' + esc(i.status) + '">' + esc(statusLabels[i.status] || i.status) + '</span></summary><div class="workspace-invoice-body">'
      + '<div class="finance-invoice-meta"><div><span>Оплатить до</span><b>' + date(i.dueDate) + '</b></div><div><span>Оплачено</span><b>' + money(i.paid) + '</b></div><div><span>Осталось</span><b>' + money(i.balance) + '</b></div><button type="button" class="workspace-button" data-export-invoice="' + esc(i.id) + '">Выгрузить счёт в Excel</button></div>'
      + linesTable(i.lines)
      + '<div class="workspace-section finance-payments"><h3>Полученные оплаты</h3>' + (i.payments.length ? '<div class="workspace-table-wrap"><table class="workspace-table finance-table"><thead><tr><th>Дата</th><th class="num">Сумма</th><th>Комментарий</th></tr></thead><tbody>' + i.payments.map(p => '<tr><td data-label="Дата оплаты">' + date(p.paidOn) + '</td><td class="num" data-label="Сумма оплаты">' + money(p.amount) + '</td><td data-label="Комментарий">' + esc(p.note) + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="ord-meta">Оплат пока не отмечено.</div>') + '</div>'
      + (remain ? '<details class="finance-payment"><summary>Отметить полученную оплату</summary><div class="workspace-filters" data-payment-form="' + esc(i.id) + '" data-key="' + crypto.randomUUID() + '" data-form><label class="rc-field"><span>Получено, ₽</span><input class="mp-field" type="text" inputmode="decimal" data-pay-amount placeholder="' + esc(i.balance) + '"></label><label class="rc-field"><span>Дата получения</span><input class="mp-field" type="date" data-pay-date value="' + whDay(new Date()) + '"></label><label class="rc-field finance-payment-note"><span>Комментарий</span><input class="mp-field" type="text" data-pay-note maxlength="500"></label><button type="button" class="workspace-button primary" data-pay-invoice="' + esc(i.id) + '">Сохранить оплату</button></div><div class="ord-meta">Это запись о полученных деньгах. Банковский перевод не выполняется.</div></details>' : '')
      + '</div></details>';
  }
  function renderInvoices(){
    const host = field('billInvoices');
    const opened = new Set([...host.querySelectorAll('details[data-invoice][open]')].map(e => e.dataset.invoice));
    host.innerHTML = '<section class="workspace-section finance-invoices"><h3>Выставленные счета' + (selected() ? ' · ' + esc(selected().name) : '') + '</h3>' + (state.invoices.length ? state.invoices.map(invoiceHtml).join('') : '<div class="finance-empty"><b>Счетов ещё нет.</b><span>' + (selected() ? 'Выберите завершённый период в начислениях и выставьте отдельный счёт.' : 'Откройте клиента в сводке, чтобы проверить начисления и выставить счёт.') + '</span></div>')
      + (state.nextCursor ? '<button class="workspace-button" type="button" id="billMoreInvoices" onclick="ArgusBilling.moreInvoices()">Ещё счета</button>' : '') + '</section>';
    host.querySelectorAll('details[data-invoice]').forEach(e => { e.open = opened.has(e.dataset.invoice); });
  }
  async function moreInvoices(){
    const run = state.run, query = new URLSearchParams({cursor:state.nextCursor});
    if(state.companyId) query.set('companyId',state.companyId);
    field('billMoreInvoices').disabled = true;
    try{ const data = await apiFetch(base + '/invoices?' + query); if(run !== state.run) return; state.invoices.push(...data.items); state.nextCursor = data.nextCursor; renderInvoices(); }
    catch(e){ error(e.message); if(field('billMoreInvoices')) field('billMoreInvoices').disabled = false; }
  }
  async function payment(button){
    const form = button.closest('[data-payment-form]'), amount = form.querySelector('[data-pay-amount]').value.trim().replace(',','.');
    if(!/^\d+(?:\.\d{1,2})?$/.test(amount) || !form.querySelector('[data-pay-date]').value){ error('Укажите сумму и дату полученной оплаты.'); return; }
    button.disabled = true;
    try{ await apiFetch(base + '/invoices/' + encodeURIComponent(button.dataset.payInvoice) + '/payments',{method:'POST',body:{amount,paidOn:form.querySelector('[data-pay-date]').value,note:form.querySelector('[data-pay-note]').value.trim(),idempotencyKey:form.dataset.key}}); showWhToast('Полученная оплата сохранена.'); await load(); }
    catch(e){ error('Оплата не сохранена: ' + e.message); button.disabled = false; }
  }
  function exportLines(lines,client){ return lines.map(l => ({'Клиент':client,'Услуга':l.title || services[l.service],'Количество':l.qty,'Единица':l.unit,'Цена, ₽':l.rate ?? 'Нет единой цены','Сумма, ₽':l.amount ?? 'Нужен прайс'})); }
  function exportPreview(){ const p = period(), sellers = state.companyId ? state.preview.sellers.filter(c => c.companyId === state.companyId) : state.preview.sellers; saveXlsx('Начисления ' + p.from + ' — ' + p.to,'Начисления',sellers.flatMap(c => exportLines(c.lines,c.name)),[28,24,14,18,16,18]); }
  function exportInvoice(id){ const i = state.invoices.find(i => i.id === id); if(!i) return; const rows = exportLines(i.lines,i.companyName); rows.push({'Клиент':i.companyName,'Услуга':'Итого по счёту ' + i.number,'Сумма, ₽':i.total},{'Услуга':'Оплачено','Сумма, ₽':i.paid},{'Услуга':'Остаток','Сумма, ₽':i.balance},{'Услуга':'Оплатить до','Сумма, ₽':date(i.dueDate)}); saveXlsx('Счёт ' + i.number,'Счёт',rows,[28,30,14,18,16,18]); }
  document.addEventListener('click',e => {
    document.querySelectorAll('.workspace-choice[open]').forEach(menu => { if(!menu.contains(e.target)) menu.open=false; });
    const company = e.target.closest('[data-bill-company]');
    if(company){ state.companyId = company.dataset.billCompany || null; load(); return; }
    const pay = e.target.closest('[data-pay-invoice]'); if(pay){ payment(pay); return; }
    const exp = e.target.closest('[data-export-invoice]'); if(exp) exportInvoice(exp.dataset.exportInvoice);
  });
  document.addEventListener('keydown',e => { if(e.key==='Escape') document.querySelectorAll('.workspace-choice[open]').forEach(menu => { menu.open=false; menu.querySelector('summary').focus(); }); });
  return {load,saveTariff,saveSchedule,issue,moreInvoices,exportPreview};
})();
