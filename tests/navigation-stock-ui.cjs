// Synthetic navigation/home/stock regression. Every request is intercepted; no live data is used.
// Run: node tests/navigation-stock-ui.cjs
// ARGUS_PLAYWRIGHT_MODULE selects an existing Playwright package; ARGUS_BROWSER_CHANNEL defaults to msedge.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.ARGUS_PLAYWRIGHT_MODULE || 'playwright');
const SITE = path.resolve(__dirname, '..');
const ORIGIN = 'https://navigation-stock.invalid';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VW_A = '11111111-1111-4111-8111-111111111111';
const VW_B = '22222222-2222-4222-8222-222222222222';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/kBsAAAAASUVORK5CYII=', 'base64');
const rows = [{ id: 'test-row', row_num: 1, rack_count: 1, tier_count: 1, blocks: [
  { id: 'test-block', rack_start: 1, rack_end: 1, tier_start: 1, tier_end: 1, state: 'occupied',
    stock: [{ companyId: A, sku: 'sku-1', qty: 6, quality: 'good' }] },
] }];
const stock = (companyId, extra) => [
  { sku: 'sku-1', name: 'Тестовый товар А', listed: true, totalKnown: true, total: 12, qty: 6, notForSale: 2,
    staged: 1, defective: 2, packagingDefect: 0, orderedNotInSupply: 1, inAssembly: 1, inTransit: 2, sellerAvailable: 10,
    byWarehouse: [{ id: null, name: 'Остальной товар', onHand: 7, inAssembly: 0, available: 7, defect: 0 },
      { id: companyId === A ? VW_A : VW_B, name: companyId === A ? 'WB А' : 'Озон Б', onHand: 4, inAssembly: 1, available: 3, defect: 2 }] },
  ...Array.from({ length: 1 + extra }, (_, i) => ({ sku: 'sku-' + (i + 2), name: 'Тестовый товар ' + (i + 2),
    listed: true, totalKnown: true, total: 4, qty: 4, notForSale: 0, staged: 0, defective: 0, packagingDefect: 0,
    orderedNotInSupply: 0, inAssembly: 0, inTransit: 0, sellerAvailable: 4,
    byWarehouse: [{ id: null, name: 'Остальной товар', onHand: 4, inAssembly: 0, available: 4, defect: 0 }] })),
];

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.ARGUS_BROWSER_CHANNEL || 'msedge' });
  const errors = [];
  const prepare = async (role, grants = []) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const store = { calls: [], failHome: false, failVw: false, holdVw: false, holdMixed: false, release: null, extraStock: 0, timezone: 'Europe/Moscow',
      warehouses: { [A]: [{ id: VW_A, name: 'WB А', marketplace: 'wb', keepSeparate: false }],
        [B]: [{ id: VW_B, name: 'Озон Б', marketplace: 'ozon', keepSeparate: false }] } };
    page.on('pageerror', error => errors.push(`${role}: ${error.stack}`));
    const token = 'test.' + Buffer.from(JSON.stringify({ role, grants, warehouseId: 'test-warehouse', ownerId: 'test-owner' })).toString('base64url') + '.test';
    await page.addInitScript(({ role, token }) => {
      localStorage.setItem('argus_role', role); localStorage.setItem('argus_token', token);
      localStorage.setItem('argus_logo_target_' + role, 'warehouse');
    }, { role, token });
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname;
      if (url.origin === ORIGIN) {
        const local = path.resolve(SITE, '.' + decodeURIComponent(p));
        if (!local.startsWith(SITE + path.sep) || !fs.existsSync(local)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ path: local });
      }
      if (url.hostname.endsWith('.wbstatic.net')) return route.fulfill({ contentType: 'image/png', body: PNG });
      if (url.origin !== 'https://api.argus-ai.online') return route.abort();
      const companyId = url.searchParams.get('companyId'), body = req.postDataJSON();
      if (req.method() !== 'OPTIONS') store.calls.push({ path: p, method: req.method(), body });
      let data = [], status = 200;
      if (p === '/api/leads/manage/access') return route.fulfill({ status: 403, json: { error: 'test' } });
      if (p === '/api/warehouses/me') {
        if (req.method() === 'PATCH') store.timezone = body.timezone;
        data = { name: 'Тестовый склад', timezone: store.timezone, stock_source: 'argus', wb_supplies_by: 'ff', setup_at: '2001-01-01' };
      }
      if (p === '/api/sellers/companies') data = [{ id: A, name: 'Тестовый продавец А', keys: [] }, { id: B, name: 'Тестовый продавец Б', keys: [] }];
      if (p === '/api/alerts/today') {
        data = { ship: { supplies: 2, ready: 1, onec: 3 }, receive: { arrivals: 4, arrived: 1, returns: 2 },
          decide: { discrepancies: 1, sellerRequests: 2, recounts: 1 }, exchange: { sync: ['test'], wbUnmapped: 3 } };
        if (store.failHome) { status = 503; data = { error: 'test' }; }
      }
      if (p === '/api/alerts') data = { alerts: [] };
      if (p === '/api/warehouses/me/readiness') data = { steps: [{ key: 'survey', done: false, optional: false }] };
      if (p === '/api/supplies/pending') data = [{ companyId: A, companyName: 'Тестовый продавец А', orders: 3, units: 5 }];
      if (p === '/api/sellers/stock-summary') data = { source: 'argus', sellers: [A, B].map((id, i) => ({ companyId: id,
        name: 'Тестовый продавец ' + (i ? 'Б' : 'А'), total: 16, ordered: 1, inAssembly: 1, inTransit: 2,
        available: 14, defect: 2, shortageCount: 0, inCells: 10, productCount: 2 })) };
      if (p === '/api/sellers/stock') data = stock(companyId, store.extraStock);
      if (p === '/api/sellers/catalog') data = { products: [{ sku: 'sku-1', cards: [{ photoUrl: 'https://test.wbstatic.net/photo.png' }] }] };
      if (p === '/api/vwarehouses') {
        if (req.method() === 'GET' && companyId === A && store.holdVw) {
          store.holdVw = false; await new Promise(resolve => { store.release = resolve; });
        }
        if (req.method() === 'POST') { store.warehouses[body.companyId].push({ id: 'test-new-vw', ...body }); data = { id: 'test-new-vw' }; }
        else data = { warehouses: store.warehouses[companyId] || [], rights: { decide: true }, wbChoices: [] };
        if (store.failVw && companyId === A) { status = 503; data = { error: 'Тестовая ошибка загрузки' }; }
      }
      if (p.endsWith('/mixed')) {
        if (store.holdMixed) { store.holdMixed = false; await new Promise(resolve => { store.release = resolve; }); }
        data = { cells: 1 };
      }
      if (p === '/api/cells/rows') data = store.largeMap ? Array.from({length:7}, (_, index) => ({
        id:'large-row-' + index, row_num:index + 1, rack_count:81, tier_count:1,
        blocks:Array.from({length:81}, (_, rack) => ({id:'large-block-' + index + '-' + rack,
          rack_start:rack + 1,rack_end:rack + 1,tier_start:1,tier_end:1,state:'empty',stock:[]})),
      })) : rows;
      if (p.endsWith('/contents')) data = { items: [] };
      if (p === '/api/dropzones') data = [{ id: 'test-zone', zone_num: 1, label: 'Тестовая зона', items: [] }];
      if (p === '/api/sync/status') data = {};
      if (p === '/api/inventory/advice' || p === '/api/inventory/settings') data = { reasons: [], recountAfterDays: 30, cellsPerRun: 10, minDaysBetweenRuns: 7, cycleDays: 0 };
      if (p === '/api/journal') data = { date: url.searchParams.get('date'), entries: [], pending: [], nextCursor: null, pendingNextCursor: null };
      return route.fulfill({ status, json: data });
    });
    await page.goto(ORIGIN + '/cabinet_main.html');
    await page.locator('#view-home.active').waitFor();
    await page.waitForFunction(() => document.querySelector('#productFormCompany').options.length === 2);
    return { page, store };
  };
  try {
    const { page: owner, store } = await prepare('owner');
    await owner.locator('.home-table').first().waitFor();
    assert.equal(await owner.locator('.sidebar-nav .nav-item').count(), 11);
    const homeCounts = await owner.locator('.home-table tbody tr').evaluateAll(rows => Object.fromEntries(
      rows.map(row => [row.querySelector('td b').textContent, row.querySelector('.home-num').textContent]),
    ));
    assert.deepEqual(homeCounts, {'Отгрузки':'6','Приёмка':'6','Ждут решения':'4','Проблемы обмена':'2','Переписка с клиентами':'—'});
    assert.equal(await owner.locator('#view-chat #readyCard,#view-chat #todayStrip').count(), 0);
    await owner.locator('#logoLink').click();
    await owner.locator('#view-warehouse.active').waitFor();
    assert.equal(await owner.locator('#view-stock .pane-tab').count(), 3);
    assert.equal(await owner.locator('#warehouseVwCreate').isVisible(), true);
    await owner.locator('#warehouseVwCreate').click();
    assert.equal(await owner.locator('#warehouseVwWorkspace').getAttribute('open'), '');
    assert.equal(await owner.locator('#vwName').count(), 0, 'choose a client before creating its warehouse');
    await owner.locator('#warehouseVwPicker summary').click();
    await owner.locator('#warehouseVwPicker').getByRole('button', {name:'Тестовый продавец А', exact:true}).click();
    await owner.locator('#vwName').waitFor();
    assert.equal(await owner.locator('#warehouseVwPicker').isVisible(), false, 'a selected client is not requested twice');
    await owner.getByRole('button', {name:'Отмена', exact:true}).click();
    await owner.locator('#tab-inv').click();
    await owner.locator('#tab-inv').press('ArrowLeft');
    assert.equal(await owner.locator('#tab-warehouse').getAttribute('aria-selected'), 'true');
    await owner.locator('#nav-settings').click();
    await owner.locator('#readyCard:not([hidden])').waitFor();
    assert.equal(await owner.locator('#view-configuration .pane-tab').count(), 2);
    await owner.locator('#tab-1c').click();
    await owner.setViewportSize({width:2560,height:700});
    assert.ok(await owner.locator('#view-1c .oc-wrap').evaluate(el => el.getBoundingClientRect().width > 1800), '1C uses the full workspace');
    await owner.setViewportSize({width:1440,height:900});
    await owner.locator('#nav-receipts').click();
    await owner.locator('#tab-acts').click();
    assert.equal(await owner.locator('#nav-receipts').getAttribute('aria-current'), 'page');

    await owner.locator('#nav-products').click(); await owner.locator('#tab-products').click();
    await owner.locator('#sellersList .pr-click').first().click();
    await owner.waitForFunction(() => document.querySelectorAll('#productsList tbody tr').length === 2);
    assert.ok((await owner.locator('#productsSellerCabinet').getAttribute('href')).includes(A));
    assert.ok(await owner.locator('.stock-back').evaluate(el => el.getBoundingClientRect().height >= 44));
    await owner.locator('#productsList .order-product-photo img').waitFor();
    await owner.locator('#productsVwBar summary').click();
    await owner.locator('#productsVwBar button').filter({ hasText: 'WB А' }).click();
    await owner.locator('#productsFilters button').filter({ hasText: 'Есть брак' }).click();
    assert.equal(await owner.locator('#productsList tbody tr').count(), 1);
    await owner.locator('#nav-journal').click(); await owner.locator('#nav-products').click();
    await owner.waitForFunction(() => document.querySelectorAll('#productsList tbody tr').length === 1);
    assert.ok((await owner.locator('#productsVwBar summary').innerText()).includes('WB А'));
    await owner.locator('#productsWarehouseSettings').click();
    await owner.waitForFunction(() => document.querySelector('#warehouseVwBody').textContent.includes('WB А'));
    await owner.locator('#warehouseVwCreate').click();
    assert.equal(await owner.locator('#vwName').count(), 1);
    await owner.locator('#vwName').fill('Тестовый новый склад');
    await owner.locator('#vwMarketplaceChoice summary').click();
    await owner.locator('#vwMarketplaceChoice button').filter({ hasText: 'Озон' }).click();
    await owner.locator('#vwSep').check(); await owner.locator('#vwZone').fill('ряд 1');
    await owner.locator('#vwSave').click();
    await owner.waitForFunction(() => document.querySelector('#warehouseVwBody').textContent.includes('Тестовый новый склад'));
    const created = store.calls.find(call => call.path === '/api/vwarehouses' && call.method === 'POST');
    assert.equal(created.body.companyId, A); assert.equal(created.body.marketplace, 'ozon');
    assert.deepEqual(created.body.zone, { rows: [1], cells: [] });
    await owner.evaluate(id => openSellerPanel(id), A);
    await owner.waitForFunction(() => document.querySelector('#wbWhBody').textContent.includes('Тестовый новый склад'));
    assert.equal(await owner.locator('#warehouseVwBody #vwName').count(), 0);
    await owner.evaluate(() => closeWbWarehouses()); await owner.locator('#warehouseVwWorkspace>summary').click();

    await owner.evaluate(id => setWarehouseVwCompany(id), B);
    await owner.waitForFunction(() => document.querySelector('#warehouseVwBody').textContent.includes('Озон Б'));
    store.holdVw = true;
    await owner.evaluate(id => setWarehouseVwCompany(id), A);
    await owner.waitForTimeout(80); assert.equal(typeof store.release, 'function');
    await owner.evaluate(id => setWarehouseVwCompany(id), B); store.release(); store.release = null;
    await owner.waitForFunction(() => document.querySelector('#warehouseVwBody').textContent.includes('Озон Б'));
    await owner.waitForTimeout(80);
    assert.ok(!(await owner.locator('#warehouseVwBody').innerText()).includes('WB А'));
    await owner.evaluate(id => setWarehouseVwCompany(id), A);
    await owner.waitForFunction(() => document.querySelector('#warehouseVwBody').textContent.includes('WB А'));
    await owner.evaluate(id => openVwForm(id), VW_A); await owner.locator('#vwSep').check();
    store.holdMixed = true; await owner.locator('#vwSave').click();
    await owner.waitForTimeout(80); assert.equal(typeof store.release, 'function');
    await owner.evaluate(id => setWarehouseVwCompany(id), B); store.release(); store.release = null;
    await owner.waitForTimeout(80);
    assert.ok(!store.calls.some(call => call.method === 'PATCH'), 'switching client must cancel an unfinished preparation');
    store.failVw = true; await owner.evaluate(id => setWarehouseVwCompany(id), A);
    await owner.waitForFunction(() => document.querySelector('#warehouseVwBody').textContent.includes('Тестовая ошибка загрузки'));
    store.failVw = false; await owner.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await owner.waitForFunction(() => document.querySelector('#warehouseVwBody').textContent.includes('WB А'));

    await owner.locator('#warehouseVwWorkspace>summary').click();
    await owner.locator('#row-rect-1').click(); await owner.locator('#fp-row-1.visible').waitFor();
    await owner.locator('#row-rect-1').click(); await owner.locator('#whSummary.visible').waitFor();
    await owner.locator('#row-rect-1').click();
    await owner.locator('#fp-row-1 .wh-cell').click(); await owner.locator('#whCellDetail.open').waitFor();
    const closeControl = owner.locator('#fp-row-1 [aria-label="Убрать все панели карты"]');
    const closeSize = await closeControl.boundingBox();
    assert.ok(closeSize.width >= 44 && closeSize.height >= 44, 'the icon close control remains easy to press');
    assert.ok(!(await closeControl.innerText()).includes('Убрать панели'), 'the close action is a compact icon');
    await owner.locator('#fp-row-1 [aria-label="Убрать все панели карты"]').click();
    assert.equal(await owner.locator('#whContent>.visible,#whCellDetail.open,.selected-row,.wh-cell.selected').count(), 0);
    await owner.evaluate(() => selectZone('test-zone')); await owner.locator('#whZoneDetail.visible').waitFor();
    await owner.locator('#whZoneDetail [aria-label="Убрать все панели карты"]').click();
    assert.equal(await owner.locator('#whContent>.visible').count(), 0);
    await owner.locator('#nav-mp').click();
    assert.equal(await owner.locator('#mpStatusBar').count(), 0, 'the redundant connection summary is removed');

    await owner.locator('#nav-products').click();
    await owner.locator('#tab-products').click();
    await owner.evaluate(() => { setProductsVw('all'); setProductsFilter('all'); });
    store.extraStock = 30; await owner.evaluate(() => loadProducts());
    await owner.locator('.stock-workspace').evaluate(el => { el.scrollTop = 400; });
    await owner.locator('#nav-journal').click(); await owner.locator('#nav-products').click();
    await owner.waitForFunction(() => document.querySelectorAll('#productsList tbody tr').length === 32);
    assert.ok(await owner.locator('.stock-workspace').evaluate(el => el.scrollTop >= 380), 'table position survives returning');
    for (const width of [375, 1440, 2048, 2560]) {
      await owner.setViewportSize({ width, height: 700 });
      assert.ok(await owner.locator('.stock-workspace').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `stock fits ${width}`);
      if(process.env.ARGUS_SCREENSHOT_DIR){fs.mkdirSync(process.env.ARGUS_SCREENSHOT_DIR,{recursive:true});await owner.locator('.stock-workspace').evaluate(el=>{el.scrollTop=0;});await owner.screenshot({animations:'disabled',path:path.join(process.env.ARGUS_SCREENSHOT_DIR,'stock-'+width+'.png')});}
    }
    store.failHome = true; await owner.locator('#nav-home').click();
    await owner.waitForFunction(() => document.querySelector('#homeUpdated').textContent.includes('Сводка не загрузилась'));
    assert.equal(await owner.locator('#todayStrip .home-table').count(), 0);
    store.failHome = false; await owner.getByRole('button', { name: 'Обновить сводку', exact: true }).click();
    await owner.locator('.home-table').first().waitFor();
    for (const width of [375, 1440, 2048, 2560]) {
      await owner.setViewportSize({ width, height: 700 });
      assert.ok(await owner.locator('.home-wrap').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `home fits ${width}`);
      if(process.env.ARGUS_SCREENSHOT_DIR){await owner.locator('.home-wrap').evaluate(el=>{el.scrollTop=0;});await owner.screenshot({animations:'disabled',path:path.join(process.env.ARGUS_SCREENSHOT_DIR,'home-'+width+'.png')});}
    }
    assert.ok(!store.calls.some(call => call.path.startsWith('/api/marketplaces/') && call.method !== 'GET'));
    store.timezone = 'Pacific/Auckland';
    await owner.locator('#nav-settings').click();
    await owner.locator('#tab-settings').click();
    await owner.waitForFunction(() => document.querySelector('#setTz').value === 'Pacific/Auckland');
    assert.equal(await owner.locator('#setTz').getAttribute('type'), 'hidden');
    await owner.locator('#setTzChoice summary').click();
    await owner.locator('#setTzMenu [data-timezone="Asia/Yakutsk"]').click();
    assert.equal(await owner.locator('#setTz').inputValue(), 'Asia/Yakutsk');
    assert.equal(await owner.locator('#setTzChoice').evaluate(el => el.open), false);
    await owner.locator('#setTzChoice summary').click();
    await owner.locator('#setTzChoice summary').press('Escape');
    assert.equal(await owner.locator('#setTzChoice').evaluate(el => el.open), false);
    await owner.locator('#setTzChoice summary').click();
    await owner.locator('#setTzMenu [data-timezone="Pacific/Auckland"]').click();
    await owner.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
    await owner.waitForFunction(() => document.querySelector('#setResult').textContent === 'Сохранено.');
    const settingsSaved = store.calls.find(call => call.path === '/api/warehouses/me' && call.method === 'PATCH');
    assert.equal(settingsSaved.body.timezone, 'Pacific/Auckland', 'an existing timezone outside the menu must survive saving');
    await owner.close();

    for (const grants of [[], ['integration'], ['integration', 'warehouse', 'clients', 'staff', 'billing']]) {
      const { page, store: managerStore } = await prepare('manager', grants);
      await page.locator('.home-table').waitFor();
      assert.equal(await page.locator('.home-table tbody tr').count(), 4);
      assert.equal(await page.locator('#nav-chat').count(), 0);
      assert.equal(await page.locator('#tab-warehouse').count(), grants.includes('warehouse') ? 1 : 0);
      assert.equal(await page.locator('#productsWarehouseSettings').evaluate(el => getComputedStyle(el).display === 'none'), !grants.includes('warehouse'));
      if (grants.includes('integration')) {
        await page.locator('#nav-settings').click();
        assert.equal(await page.locator('#view-configuration .pane-tab').count(), 1);
        assert.equal(await page.locator('#tab-1c').getAttribute('aria-selected'), 'true');
        await page.evaluate(() => switchView('settings'));
        assert.equal(await page.locator('#view-1c').getAttribute('hidden'), null);
      }
      assert.ok(!managerStore.calls.some(call => ['/api/alerts/today', '/api/warehouses/me/readiness'].includes(call.path)));
      await page.close();
    }
    // The warehouse page owns scrolling, including long virtual warehouse lists.
    // Hit the visible list itself and verify that the map below remains reachable.
    for (const width of [375, 1440, 2048, 2560]) {
      const {page, store: wheelStore} = await prepare('owner');
      await page.setViewportSize({width, height:900});
      wheelStore.largeMap = true;
      wheelStore.warehouses[A] = Array.from({length:12}, (_, index) => ({
        id:'fixture-vw-' + index,name:'Направление клиента ' + (index + 1),marketplace:'wb',keepSeparate:false,
      }));
      await page.locator('#nav-products').click(); await page.locator('#tab-warehouse').click();
      await page.locator('#fpSvgWrap svg').waitFor();
      await page.evaluate(() => renderWarehouseMap());
      assert.equal(await page.locator('.wh-row-rect').count(), 7);
      await page.locator('#warehouseVwWorkspace>summary').click();
      await page.evaluate(id => setWarehouseVwCompany(id), A);
      await page.waitForFunction(() => document.querySelector('#warehouseVwBody').textContent.includes('Направление клиента 12'));
      const button = page.locator('#warehouseVwBody button.mp-act').first();
      const style = await button.evaluate(el => {
        const css = getComputedStyle(el), color = css.backgroundColor.match(/\d+/g).map(Number);
        return {dark: Math.max(...color.slice(0,3)) < 100, height:el.getBoundingClientRect().height};
      });
      assert.ok(style.dark && style.height >= 44, 'VW action uses the dark theme and a usable target');
      if(process.env.ARGUS_SCREENSHOT_DIR) await page.screenshot({animations:'disabled',path:path.join(process.env.ARGUS_SCREENSHOT_DIR,'warehouse-buttons-'+width+'.png')});
      const contentPoint = await page.locator('.stock-vw-content').evaluate(el => {
        const box = el.getBoundingClientRect(), outer = document.querySelector('#view-warehouse').getBoundingClientRect();
        const top = Math.max(0, box.top, outer.top), bottom = Math.min(window.innerHeight, box.bottom, outer.bottom);
        const point = {x:box.left + 4, y:(top + bottom) / 2};
        const css = getComputedStyle(el);
        return {...point, visible:bottom > top, hitsContent:el.contains(document.elementFromPoint(point.x, point.y)),
          overflowY:css.overflowY, maxHeight:css.maxHeight, scrollTop:el.scrollTop};
      });
      assert.ok(contentPoint.visible && contentPoint.hitsContent, 'wheel must hit the visible warehouse list');
      assert.equal(contentPoint.overflowY, 'visible', 'the warehouse list must not own a nested scroll container');
      assert.equal(contentPoint.maxHeight, 'none');
      await page.mouse.move(contentPoint.x, contentPoint.y);
      await page.mouse.wheel(0, 450);
      await page.waitForFunction(() => document.querySelector('#view-warehouse').scrollTop > 100);
      assert.equal(await page.locator('.stock-vw-content').evaluate(el => el.scrollTop), 0, 'wheel scroll belongs to the outer page');
      await page.locator('#view-warehouse').evaluate(el => {el.scrollTop = 0;});
      const outer = await page.locator('#view-warehouse').boundingBox();
      await page.mouse.move(outer.x + 3, Math.min(875, outer.y + 200));
      await page.mouse.wheel(0, 450);
      await page.waitForFunction(() => document.querySelector('#view-warehouse').scrollTop > 100);
      await page.locator('#whMapWrap').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#fpSvgWrap').isVisible(), 'warehouse map is reachable');
      if(process.env.ARGUS_SCREENSHOT_DIR) await page.screenshot({animations:'disabled',path:path.join(process.env.ARGUS_SCREENSHOT_DIR,'warehouse-scroll-'+width+'.png')});
      await page.evaluate(id => openSellerPanel(id), A);
      await page.waitForFunction(() => document.querySelector('#wbWhBody button.mp-act'));
      assert.ok(await page.locator('#wbWhBody button.mp-act').first().evaluate(el => Math.max(...getComputedStyle(el).backgroundColor.match(/\d+/g).slice(0,3).map(Number)) < 100), 'seller modal uses the same dark buttons');
      if(process.env.ARGUS_SCREENSHOT_DIR) await page.screenshot({animations:'disabled',path:path.join(process.env.ARGUS_SCREENSHOT_DIR,'warehouse-modal-buttons-'+width+'.png')});
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS navigation/groups/keyboard; real home counts/error retry; readiness placement and manager grants; stock filters/photo/context/scroll/mobile; VW create/old modal/races/retry; map close/reset.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
