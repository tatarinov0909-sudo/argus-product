// Synthetic orders/supplies UI regression: all API calls are mocked; external network is blocked.
// Run from the repository: node tests/order-workspace-ui.cjs
// Use ARGUS_PLAYWRIGHT_MODULE for an existing Playwright installation, and ARGUS_BROWSER_CHANNEL
// to select an installed browser (default: msedge). No live credentials or database are needed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.ARGUS_PLAYWRIGHT_MODULE || 'playwright');
const SITE = path.resolve(__dirname, '..');
const companyId = '11111111-1111-1111-1111-111111111111';
const token = (role) => `x.${Buffer.from(JSON.stringify({ role, warehouseId: 'warehouse-test', ownerId: 'owner-test', companyId,
  sellerKeyId: 'seller-test', grants: ['orders', 'supplies'], exp: 4102444800 })).toString('base64url')}.x`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/kBsAAAAASUVORK5CYII=', 'base64');
const catalog = { products: [{ sku: 'sku-a', name: 'Товар А', cards: [{ nmId: '1001', photoUrl: 'https://basket-01.wbbasket.ru/vol1/part1/1001/images/c516x688/1.webp' }] }] };
const pending = [
  { id: 'order-a', number: 'ЗК-А', name: 'Товар А', sku: 'sku-a', ready: true, qty: 1, marketplace: 'wb', nmId: '1001', wbWarehouseId: '101', wbWarehouse: 'Москва', createdAt: '2026-10-04T10:00:00Z' },
  { id: 'order-b', number: 'ЗК-Б', name: 'Товар Б', sku: 'sku-b', ready: true, qty: 1, marketplace: 'wb', wbWarehouseId: '202', wbWarehouse: 'Казань', createdAt: '2026-10-04T10:00:00Z' },
  { id: 'order-c', number: 'ЗК-В', name: 'Товар В', sku: 'sku-c', ready: true, qty: 1, marketplace: 'ozon', wbWarehouseId: null, wbWarehouse: null, createdAt: '2026-10-04T10:00:00Z' },
];
const sellerRows = pending.map((p) => ({ id: p.id, number: p.number, name: p.name, sku: p.sku, qty: p.qty,
  status: 'open', source: p.marketplace, mp_warehouse_id: p.wbWarehouseId, mp_warehouse_name: p.wbWarehouse,
  mp_nm_id: p.nmId, created_at: p.createdAt, mp_created_at: p.createdAt }));
const supplies = [{ id: 'supply-a', number: 'ПС-А', company_name: 'Клиент А', companyId, orders: 1,
  picked: 0, status: 'collecting', statusName: 'Собирается', marketplace: 'wb', created_at: '2026-10-04T10:00:00Z' }];
const sellerSupplies = [{ id: 'supply-a', number: 'ПС-А', orders: 1, units: 1, status: 'collecting', statusName: 'Собирается',
  mpSupplyId: 'WB-SUPPLY-A', createdAt: '2026-10-04T10:00:00Z', items: [{ order: 'ЗК-А', sku: 'sku-a', name: 'Товар А', qty: 1, status: 'собирается' }] }];
const type = (name) => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }[path.extname(name)] || 'application/octet-stream');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.ARGUS_BROWSER_CHANNEL || 'msedge' });
  const errors = [], mutations = [];
  try {
    const prepare = async (role, file, viewport) => {
      const page = await browser.newPage({ viewport });
      page.on('pageerror', (e) => errors.push(`${role}: ${e.stack}`));
      await page.addInitScript(([role, token]) => { localStorage.setItem('argus_role', role); localStorage.setItem('argus_token', token); }, [role, token(role)]);
      await page.route('**/*', async (route) => {
        const req = route.request(), url = new URL(req.url()), p = url.pathname;
        if (url.origin === 'http://argus-workspace.test') {
          const local = path.join(SITE, decodeURIComponent(p));
          return fs.existsSync(local) ? route.fulfill({ body: fs.readFileSync(local), contentType: type(local) }) : route.fulfill({ status: 404, body: '' });
        }
        if (url.hostname.endsWith('wbbasket.ru')) return route.fulfill({ contentType: 'image/png', body: png });
        if (url.origin !== 'https://api.argus-ai.online') return route.abort();
        if (req.method() !== 'GET') mutations.push({ path: p, method: req.method(), body: req.postDataJSON() });
        let data = [];
        if (p === '/api/warehouses/me') data = { name: 'Тестовый склад', timezone: 'Europe/Moscow', setup_at: '2026-10-01', warehouse_code: 'ТЕСТ' };
        else if (p === '/api/warehouses/me/readiness') data = { steps: [], complete: true };
        else if (p === '/api/sellers/companies') data = [{ id: companyId, name: 'Клиент А', keys: [] }];
        else if (p === '/api/sellers/profile') data = { id: companyId, name: 'Клиент А', warehouseName: 'Тестовый склад' };
        else if (p === '/api/sellers/catalog') data = catalog;
        else if (p === '/api/sellers/orders') data = { rows: sellerRows, hasMore: false };
        else if (p === '/api/sellers/documents') data = { rows: [], hasMore: false };
        else if (p === '/api/sellers/defects') data = { rows: [], balances: [], moves: [], decisions: [], unseen: [] };
        else if (p === '/api/sellers/supplies') data = { rows: sellerSupplies, hasMore: false };
        else if (p === '/api/vwarehouses') data = { warehouses: [], wbChoices: [{ id: null, name: 'Остальной товар' }], rights: {} };
        else if (p === '/api/supplies/pending') data = [{ companyId, companyName: 'Клиент А', orders: 3, units: 3, marketplace: 'wb' }];
        else if (p === '/api/supplies/pending/' + companyId) data = pending;
        else if (p === '/api/supplies/shipping-points/' + companyId) data = { points: [] };
        else if (p === '/api/supplies' && req.method() === 'POST') data = { id: 'new-supply', number: 'ПС-НОВАЯ', orders: 1, marketplace: null };
        else if (p === '/api/supplies') data = supplies;
        else if (p === '/api/supplies/supply-a') data = { supply: { companyId, status: 'collecting' }, picking: [{ sku: 'sku-a', qty: 1, available: 1 }], packing: [{ sku: 'sku-a', name: 'Товар А', qty: 1, orderNumber: 'ЗК-А', photo: catalog.products[0].cards[0].photoUrl }], notes: [] };
        else if (p === '/api/journal') data = url.searchParams.has('date') ? { date: url.searchParams.get('date'), timezone: 'Europe/Moscow', entries: [], pending: [], nextCursor: null, pendingNextCursor: null } : [];
        else if (p === '/api/inventory/advice') data = null;
        else if (p === '/api/inventory/settings' || p === '/api/sync/status') data = {};
        return route.fulfill({ json: data });
      });
      await page.goto(`http://argus-workspace.test/${file}`);
      return page;
    };

    const owner = await prepare('owner', 'cabinet_main.html', { width: 1440, height: 1000 });
    await owner.waitForFunction(() => typeof window.switchView === 'function');
    await owner.evaluate(() => switchView('supplies'));
    await owner.locator('#suppliesList .sup-row').waitFor();
    // «+ Заказ физлицу» в «Поставках» ведёт в «Заказы» (08.10.2026): поставку
    // составляют из заказов — с площадок и физлицам.
    await owner.locator('#newSupplyButton').click();
    await owner.locator('#directOrder').waitFor();
    await owner.locator('#directOrder').getByRole('button', { name: 'Закрыть' }).click();
    await owner.locator('.ord-partner').click();
    await owner.locator('#ordersDetail .ord-table tbody tr').first().waitFor();
    assert.equal(await owner.locator('#ordersDetail .ord-table tbody tr').count(), 3);
    await owner.locator('.order-warehouse-filter summary').click();
    await owner.locator('.order-warehouse-menu input[value="101"]').check();
    assert.equal(await owner.locator('#ordersDetail .ord-table tbody tr').count(), 1);
    await owner.locator('.order-warehouse-menu input[value="202"]').check();
    assert.equal(await owner.locator('#ordersDetail .ord-table tbody tr').count(), 2);
    assert.match(await owner.locator('.order-warehouse-filter summary').innerText(), /2/);
    await owner.locator('.order-warehouse-menu input[value="202"]').uncheck();
    await owner.keyboard.press('Escape');
    assert.equal(await owner.locator('.order-warehouse-filter').getAttribute('open'), null);
    await owner.locator('#ordersDetail thead input[type=checkbox]').first().check();
    await owner.locator('#ordersDetail button').filter({ hasText: 'Составить поставку' }).click();
    await owner.locator('.ask-ok').click();
    await owner.waitForFunction(() => !document.querySelector('.ask-overlay'));
    const made = mutations.find((r) => r.path === '/api/supplies' && r.method === 'POST');
    assert.deepEqual(made?.body.invoiceIds, ['order-a']);
    assert.ok(!mutations.some((r) => /warehouses/.test(r.path)), 'view filter must never mutate warehouse ownership');
    await owner.evaluate(() => switchView('orders'));
    await owner.locator('#ordersDetail .order-warehouse-filter').waitFor();
    await owner.locator('.order-warehouse-filter summary').click();
    await owner.locator('.order-warehouse-menu input[value="all"]').check();
    await owner.keyboard.press('Escape');
    assert.equal(await owner.locator('#ordersDetail .ord-table tbody tr').count(), 3);
    assert.equal(await owner.locator('#ordersDetail .workspace-marketplace.wb').count(), 2);
    assert.equal(await owner.locator('#ordersDetail .workspace-marketplace.ozon').count(), 1);
    assert.ok(await owner.locator('#ordersDetail .order-product-photo img').count());
    await owner.setViewportSize({ width: 375, height: 900 });
    await owner.locator('#ordersDetail .ord-table tbody tr').last().scrollIntoViewIfNeeded();
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'owner page must fit mobile width');

    const seller = await prepare('seller', 'client_access.html#orders', { width: 1440, height: 1000 });
    await seller.locator('#rows [data-order-row]').first().waitFor();
    assert.equal(await seller.locator('#rows [data-order-row]').count(), 3);
    await seller.locator('[data-dd="o-wbwh"] .dd-btn').click();
    await seller.locator('[data-dd="o-wbwh"] [data-value="101"]').click();
    assert.equal(await seller.locator('#rows [data-order-row]').count(), 1);
    await seller.locator('[data-dd="o-wbwh"] [data-value="202"]').click();
    assert.equal(await seller.locator('#rows [data-order-row]').count(), 2);
    assert.equal(await seller.locator('[data-dd="o-wbwh"] .dd-count').innerText(), '2');
    await seller.keyboard.press('Escape');
    await seller.getByRole('button', { name: 'Сбросить фильтры' }).click();
    assert.equal(await seller.locator('#rows [data-order-row]').count(), 3);
    assert.equal(await seller.locator('#rows .workspace-marketplace.ozon').innerText(), 'Ozon');
    await seller.setViewportSize({ width: 375, height: 900 });
    assert.ok(await seller.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'seller page must fit mobile width');
    await seller.evaluate(() => { location.hash = 'supplies'; });
    await seller.locator('[data-supply-row]').waitFor();
    await seller.locator('[data-supply-row]').click();
    assert.ok(await seller.locator('#drawerBody .photo img').count(), 'supply drawer reuses catalog photo');
    assert.ok(!mutations.some((r) => /warehouses/.test(r.path)), 'both filters are read-only');
    const manager = await prepare('manager', 'cabinet_main.html', { width: 1440, height: 1000 });
    await manager.waitForFunction(() => typeof window.switchView === 'function');
    await manager.evaluate(() => switchView('supplies'));
    await manager.locator('#suppliesList .sup-row').waitFor();
    assert.ok(await manager.locator('#newSupplyButton').isVisible());
    await manager.locator('#newSupplyButton').click();
    await manager.locator('#directOrder').getByRole('button', { name: 'Закрыть' }).click();
    await manager.locator('.ord-partner').click();
    await manager.locator('#ordersDetail .order-warehouse-filter').waitFor();
    await manager.locator('.order-warehouse-filter summary').click();
    await manager.locator('.order-warehouse-menu input[value="101"]').check();
    await manager.locator('.order-warehouse-menu input[value="202"]').check();
    assert.equal(await manager.locator('#ordersDetail .ord-table tbody tr').count(), 2);
    assert.deepEqual(errors, [], 'no browser page errors');
    console.log('PASS owner/seller multiple warehouses, reset, keyboard close, mobile width, cached photos, existing supply creation and no ownership mutations');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.stack); process.exit(1); });
