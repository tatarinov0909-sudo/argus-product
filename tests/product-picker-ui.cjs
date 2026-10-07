// Панель выбора товаров (product-picker.js) в «Поставки» → «Новая поставка»:
// протягивание мышью, количество у строки, выбор между страницами и поиском,
// Excel, предупреждение «больше доступного», создание поставки физлицу, телефон.
// Все запросы к API — синтетические, без записей в рабочую базу.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.ARGUS_PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://picker.invalid';
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const catalog = Array.from({ length: 120 }, (_, i) => ({ sku: 'PP' + String(i + 1).padStart(3, '0'),
  name: 'Тестовый товар ' + (i + 1), barcode: String(i + 1).padStart(13, '0'), total: 10, available: 6 }));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.ARGUS_BROWSER_CHANNEL || 'msedge' });
  const errors = [];
  let xlsxAsset;
  const prepare = async (width) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(15000);
    const calls = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((token) => { localStorage.setItem('argus_role', 'owner'); localStorage.setItem('argus_token', token); },
      'test.' + Buffer.from(JSON.stringify({ role: 'owner', warehouseId: 'fixture', ownerId: 'fixture' })).toString('base64url') + '.test');
    await page.route('**/*', async (route) => {
      const req = route.request(), u = new URL(req.url()), p = u.pathname;
      if (u.origin === ORIGIN) {
        const local = path.resolve(ROOT, '.' + decodeURIComponent(p));
        return local.startsWith(ROOT + path.sep) && fs.existsSync(local) ? route.fulfill({ path: local }) : route.fulfill({ status: 404, body: '' });
      }
      if (u.hostname === 'cdnjs.cloudflare.com' && p === '/ajax/libs/xlsx/0.18.5/xlsx.full.min.js') {
        if (!xlsxAsset) xlsxAsset = route.fetch().then(async (r) => ({ status: r.status(), headers: r.headers(), body: await r.body() }));
        return route.fulfill(await xlsxAsset);
      }
      if (u.origin !== 'https://api.argus-ai.online') return route.abort();
      const body = req.postDataJSON();
      calls.push({ path: p, method: req.method(), body, query: Object.fromEntries(u.searchParams) });
      let data = [];
      if (p === '/api/leads/manage/access') return route.fulfill({ status: 403, json: { error: 'fixture' } });
      if (p === '/api/warehouses/me') data = { name: 'Тестовый склад', timezone: 'Europe/Moscow', stock_source: 'argus', setup_at: '2001-01-01' };
      if (p === '/api/warehouses/me/readiness') data = { steps: [] };
      if (p === '/api/sellers/companies') data = [{ id: COMPANY, name: 'Тестовый клиент', keys: [] }];
      if (p === '/api/sellers/stock-summary') data = { sellers: [] };
      if (p === '/api/alerts/today') data = { ship: {}, receive: {}, decide: {}, exchange: { sync: [] } };
      if (p === '/api/alerts') data = { alerts: [] };
      if (p === '/api/inventory/advice' || p === '/api/inventory/settings') data = { reasons: [] };
      if (p === '/api/sync/status') data = {};
      if (p === '/api/cells/rows') data = [];
      if (p === '/api/sellers/stock') data = { rows: catalog, summary: {} };
      if (p === '/api/products/match') {
        data = { items: body.lines.map((l, i) => {
          const found = catalog.filter((x) => (l.sku ? x.sku.toLowerCase() === l.sku.toLowerCase() : x.barcode === l.barcode));
          return found.length === 1 ? { row: i + 1, sku: found[0].sku, name: found[0].name } : { row: i + 1, error: 'Артикул не найден в каталоге продавца' };
        }) };
      }
      if (p === '/api/supplies/direct') return route.fulfill({ status: 201, json: { id: 'supply', number: 'ПС-TEST-01' } });
      return route.fulfill({ json: data });
    });
    await page.goto(ORIGIN + '/cabinet_main.html');
    await page.locator('#view-home.active').waitFor();
    await page.evaluate(() => switchView('supplies'));
    await page.locator('#newSupplyButton').click();
    await page.locator('#directSupplyPicker .vws-row').first().waitFor();
    return { page, calls };
  };
  const act = (page, name) => page.locator('#directSupplyPicker [data-action="' + name + '"]');
  const total = (page) => page.locator('#directSupplyPicker [data-role=selected-total]').innerText();
  const row = (page, sku) => page.locator('#directSupplyPicker .vws-row[data-sku="' + sku + '"]');
  try {
    const { page, calls } = await prepare(1440);
    assert.equal(await page.locator('#suppliesList').isVisible(), false, 'список поставок спрятан, пока открыта новая');
    assert.equal(await page.locator('#directSupplyPicker .vws-row').count(), 50, 'по 50 строк на странице');
    const wrap = await page.locator('#directSupplyPicker .vws-table-wrap').evaluate((el) => [el.scrollWidth, el.clientWidth]);
    assert.ok(wrap[0] <= wrap[1], 'таблица не шире своего места: ' + wrap);

    // Протягивание мышью: три строки, количество по умолчанию — 1.
    await row(page, 'PP002').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const a = await row(page, 'PP001').locator('td').nth(1).boundingBox(), b = await row(page, 'PP003').locator('td').nth(1).boundingBox();
    await page.mouse.move(a.x + 20, a.y + 20); await page.mouse.down();
    await page.mouse.move(b.x + 20, b.y + 20, { steps: 12 }); await page.mouse.up();
    assert.equal(await page.locator('#directSupplyPicker .vws-row [data-action=row-select]:checked').count(), 3, 'протягивание выбрало три строки');
    assert.equal(await row(page, 'PP002').locator('[data-action=qty]').inputValue(), '1', 'у выбранной строки видно количество');
    // Вписали количество — строка отметилась сама.
    await row(page, 'PP005').locator('[data-action=qty]').fill('4');
    assert.equal(await row(page, 'PP005').locator('[data-action=row-select]').isChecked(), true);
    assert.equal(await total(page), 'Выбрано 4 позиции · 7 шт.');
    // Больше доступного — предупреждение у строки.
    await row(page, 'PP005').locator('[data-action=qty]').fill('9');
    assert.match(await row(page, 'PP005').locator('.pp-warn').innerText(), /Больше, чем доступно \(6\)/);

    // Выбор держится между страницами и при поиске.
    await act(page, 'page').last().click(); await row(page, 'PP051').waitFor();
    await row(page, 'PP051').locator('[data-action=row-select]').check();
    await act(page, 'page').first().click(); await row(page, 'PP001').waitFor();
    assert.equal(await row(page, 'PP001').locator('[data-action=row-select]').isChecked(), true);
    await act(page, 'search').fill('товар 77');
    await page.waitForFunction(() => document.querySelectorAll('#directSupplyPicker .vws-row').length === 1);
    await row(page, 'PP077').locator('[data-action=row-select]').check();
    await act(page, 'search').fill('');
    await page.waitForFunction(() => document.querySelectorAll('#directSupplyPicker .vws-row').length === 50);
    assert.equal(await total(page), 'Выбрано 6 позиций · 14 шт.');
    await act(page, 'only').click();
    assert.equal(await page.locator('#directSupplyPicker .vws-row').count(), 6, '«Только выбранные»');
    await act(page, 'only').click();

    // Excel: строки узнаёт сервер; неизвестную исключили — остальные в выборе.
    await page.waitForFunction(() => !!window.XLSX);
    await act(page, 'import').click();
    const bytes = await page.evaluate(() => {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Артикул', 'Штрихкод', 'Количество'],
        ['pp010', '', 2], ['', '0000000000011', 3], ['НЕТ-ТАКОГО', '', 1]]), 'Товары');
      return Array.from(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })));
    });
    await page.locator('#directSupplyPicker input[type=file]').setInputFiles({ name: 'synthetic.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bytes) });
    await page.locator('#directSupplyPicker .vws-import-mapping').waitFor();
    for (const [name, letter] of [['sku', 'A'], ['barcode', 'B'], ['qty', 'C']]) {
      const option = act(page, 'map-' + name).filter({ hasText: new RegExp('^' + letter + ' —') });
      if (!(await option.isVisible())) await page.locator('#directSupplyPicker .vws-import-mapping details').nth(2 + ['sku', 'barcode', 'qty'].indexOf(name)).locator('summary').click();
      await option.click();
    }
    await act(page, 'parse').click(); await page.locator('#directSupplyPicker .vws-import-summary').waitFor();
    await page.waitForFunction(() => document.querySelector('#directSupplyPicker [data-status-line="4"]')?.textContent.includes('не найден'));
    assert.equal(await act(page, 'apply-import').isDisabled(), true, 'неизвестный товар не даёт добавить файл');
    await page.locator('#directSupplyPicker [data-action=exclude][data-line="4"]').click();
    await page.waitForFunction(() => !document.querySelector('#directSupplyPicker [data-action=apply-import]').disabled);
    await act(page, 'apply-import').click();
    assert.equal(await page.locator('#directSupplyPicker .vws-row').count(), 8, 'после файла видны только выбранные');
    assert.equal(await row(page, 'PP011').locator('[data-action=qty]').inputValue(), '3', 'штрихкод из файла узнан');
    assert.equal(await total(page), 'Выбрано 8 позиций · 19 шт.');

    // Без «куда / кому» не создаётся; больше доступного — с подтверждением.
    await act(page, 'submit').click();
    assert.match(await page.locator('#directSupplyPicker [data-role=notice]').innerText(), /куда и кому/);
    assert.equal(calls.filter((c) => c.path === '/api/supplies/direct').length, 0);
    await page.locator('#directSupplyWhere').fill('Иванов, Казань, СДЭК');
    await act(page, 'submit').click();
    await page.locator('.ask-overlay').waitFor();
    assert.match(await page.locator('.ask-overlay').innerText(), /Тестовый товар 5» — 9 из 6/);
    await page.locator('.ask-overlay button', { hasText: 'Да' }).click();
    await page.locator('#directSupply').waitFor({ state: 'hidden' });
    const sent = calls.find((c) => c.path === '/api/supplies/direct').body;
    assert.equal(sent.companyId, COMPANY);
    assert.equal(sent.destination, 'Иванов, Казань, СДЭК');
    assert.equal(sent.items.length, 8);
    assert.deepEqual(sent.items.find((i) => i.sku === 'PP005'), { sku: 'PP005', qty: 9 });
    assert.equal(await page.locator('#suppliesList').isVisible(), true);

    // «Приход» на компьютере: форма видна сразу — и панель в ней тоже.
    await page.evaluate(() => switchView('receipts'));
    await page.locator('#receiptPicker .vws-row').first().waitFor();
    await page.locator('#receiptPicker .vws-row[data-sku="PP002"] [data-action=qty]').fill('12');
    await page.locator('#receiptPicker [data-action=submit]').click();
    await page.waitForFunction(() => document.querySelector('#receiptPicker [data-role=selected-total]')?.textContent === 'Выбрано 0 позиций · 0 шт.'
      && document.querySelector('#receiptPicker .vws-row'));
    const receipt = calls.find((c) => c.path === '/api/invoices' && c.method === 'POST').body;
    assert.equal(receipt.direction, 'in');
    assert.deepEqual(receipt.items, [{ name: 'Тестовый товар 2', sku: 'PP002', declaredQty: 12 }]);
    assert.ok(receipt.number, 'номер прихода подставлен');
    await page.close();

    // Телефон: без прокрутки вбок, строки — карточками.
    const phone = await prepare(375);
    assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'страница не шире телефона');
    assert.equal(await phone.page.locator('#directSupplyPicker .vws-table thead').isVisible(), false);
    await phone.page.close();
    assert.deepEqual(errors, []);
    console.log('product picker UI: OK');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
