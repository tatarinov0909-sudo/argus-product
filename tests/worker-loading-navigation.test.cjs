'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/worker-browser.cjs');
let browser;
before(async () => { browser = await h.chromium.launch({ headless: true, channel: 'msedge' }); });
after(async () => { await browser?.close(); });

test('503 remains distinct from empty; retry has loading feedback and restores work', { timeout: 25000 }, async () => {
  let unavailable = true, release;
  const gate = new Promise(resolve => { release = resolve; });
  const x = await h.create(browser, { handler: async (route, url) => {
    if (!['/api/invoices', '/api/supplies'].includes(url.pathname)) return;
    if (unavailable) { await route.fulfill({ status: 503, json: { error: 'Временно недоступно' } }); return true; }
    await gate;
  } });
  const empty = await h.create(browser, { state: { invoices: [], supplies: [] } });
  try {
    await h.home(x);
    assert.match(await x.page.locator('.home-error').innerText(), /Не удалось обновить/);
    assert.equal(await x.page.getByText('поставок на сборку нет', { exact: true }).count(), 0);
    assert.equal(await x.page.locator('.home-tile-count').nth(1).innerText(), '');
    for (const width of [390, 768, 1440]) {
      await x.page.setViewportSize({ width, height: 844 });
      const button = await x.page.getByRole('button', { name: 'Повторить', exact: true }).boundingBox();
      assert.ok(button.width > 0 && button.height >= 44 && button.x >= 0 && button.x + button.width <= width);
      assert.equal(await x.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await h.snapshot(x.page, 'loading-error-' + width + '.png');
    }
    unavailable = false;
    await x.page.getByRole('button', { name: 'Повторить', exact: true }).click();
    assert.equal(await x.page.locator('.home-retry').isDisabled(), true);
    assert.match(await x.page.locator('#homeSub').innerText(), /Загружаю/);
    release();
    await x.page.locator('#homeBody[aria-busy="false"]').waitFor();
    assert.equal(await x.page.locator('.home-error').count(), 0);
    assert.equal(await x.page.locator('.home-tile-count').nth(1).innerText(), '1');
    await h.home(empty);
    assert.equal(await empty.page.locator('.home-error').count(), 0);
    assert.equal(await empty.page.getByText('поставок на сборку нет', { exact: true }).count(), 1);
    assert.deepEqual(x.errors, []);
  } finally { release(); await x.context.close(); await empty.context.close(); }
});

test('failed refresh labels old data; failed optional work list is not silently hidden', async () => {
  let fail = false;
  const x = await h.create(browser, { handler: async (route, url) => {
    if (fail && ['/api/invoices', '/api/vwarehouses/move-tasks'].includes(url.pathname)) {
      await route.fulfill({ status: 503, json: { error: 'Недоступно' } }); return true;
    }
  } });
  try {
    await h.home(x);
    fail = true;
    await x.page.evaluate(() => showHome());
    assert.match(await x.page.locator('.home-error').innerText(), /ранее загруженный список/);
    assert.match(await x.page.locator('.home-error').innerText(), /задания на перемещение/);
    assert.equal(await x.page.getByRole('button', { name: /Переложить товар склада/ }).isVisible(), true);
    assert.equal(await x.page.locator('.home-tile-count').nth(1).innerText(), '1');
    assert.deepEqual(x.errors, []);
  } finally { await x.context.close(); }
});

function order(id, number) { return { ...h.invoice, id, direction: 'out', supply_id: null, number,
  items: h.invoice.items.map(item => ({ ...item, closed: false, picked_qty: 0 })) }; }
const first = order(h.ids.invoice, 'ОТГ-2026-001'), second = order(h.ids.invoice2, 'ОТГ-2026-002');
async function navigationFixture() {
  let release, arrived;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { arrived = resolve; });
  const x = await h.create(browser, { state: { invoices: [first, second], supplies: [] }, handler: async (route, url) => {
    if (url.pathname === '/api/invoices/' + first.id) {
      arrived(); await gate; await route.fulfill({ json: first }); return true;
    }
    if (url.pathname.startsWith('/api/shipping/suggest/')) {
      await route.fulfill({ json: { item: { id: h.ids.item, remaining: 12, alreadyPicked: 0 }, cells: [], totalAvailable: 0, shortfall: 12 } }); return true;
    }
  } });
  return { ...x, release, started };
}

test('late document response cannot override Back or change the current work context', async () => {
  const x = await navigationFixture();
  try {
    await h.home(x);
    await x.page.getByText('Сборка поставок', { exact: true }).first().click();
    await x.page.locator('.order-row').first().waitFor();
    // Await the real selection promise after releasing the response, not a mutation that must disappear.
    const selecting = x.page.evaluate(id => selectInvoice(id), first.id);
    await x.started;
    await x.page.locator('#suppliesScreen .job-back').click();
    await x.page.locator('#homeBody[aria-busy="false"]').waitFor();
    x.release(); await selecting;
    assert.equal(await x.page.locator('#homeScreen').isVisible(), true);
    assert.equal(await x.page.locator('#taskScreen').isVisible(), false);
    assert.equal(await x.page.evaluate(() => currentInvoice), null);
    assert.deepEqual(x.errors, []);
  } finally { x.release(); await x.context.close(); }
});

test('latest document selection wins when successful responses arrive out of order', async () => {
  const x = await navigationFixture();
  try {
    await h.home(x);
    const selecting = x.page.evaluate(id => selectInvoice(id), first.id);
    await x.started;
    await x.page.evaluate(id => selectInvoice(id), second.id);
    x.release(); await selecting;
    assert.equal(await x.page.evaluate(() => currentInvoice.id), second.id);
    assert.equal(await x.page.locator('#taskScreen').isVisible(), true);
    assert.equal(await x.page.locator('#invoiceNum').innerText(), second.number);
    assert.deepEqual(x.errors, []);
  } finally { x.release(); await x.context.close(); }
});
