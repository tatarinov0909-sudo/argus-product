'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const h = require('./helpers/worker-browser.cjs');
const { chromium, invoice, site, output } = h;
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true, channel: process.env.ARGUS_BROWSER_CHANNEL || 'msedge' });
});
after(async () => { await browser?.close(); });

async function screen(width, invoices = [invoice], height = 844) {
  const x = await h.create(browser, { width, height, state: { invoices, supplies: [] },
    handler: async (route) => { assert.equal(route.request().method(), 'GET', 'Layout scenarios must never write business data'); } });
  await h.home(x);
  await x.page.evaluate(() => document.fonts.ready);
  return x;
}
async function snapshot(page, name) {
  await page.screenshot({ path: path.join(output, name + '.png'), animations: 'disabled' });
}
async function tabTo(page, selector, max = 12) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(sel => document.activeElement.matches(sel), selector)) return;
  }
  assert.fail('Keyboard did not reach ' + selector);
}
async function noHorizontalOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}
async function rowPosition(page) {
  return page.locator('.recv-row').first().evaluate(row => {
    const r = row.getBoundingClientRect(), phone = row.closest('.phone').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y, bottom: r.bottom, visibleBottom: Math.min(innerHeight, phone.bottom) };
  });
}

test('Home sections and logout work with Tab, Enter and Space with visible focus', async () => {
  for (const key of ['Enter', 'Space']) {
    const { context, page, errors } = await screen(390);
    try {
      await tabTo(page, '.job-logout');
      assert.equal(await page.locator('.job-logout').evaluate(e => e.tagName), 'BUTTON');
      assert.equal(await page.locator('.job-logout').evaluate(e => getComputedStyle(e).outlineStyle), 'solid');
      await tabTo(page, '.home-tile:nth-of-type(2)');
      assert.match(await page.evaluate(() => document.activeElement.textContent), /Приёмка товара/);
      await snapshot(page, 'home-keyboard-' + key);
      await page.keyboard.press(key);
      await page.locator('#docsScreen.show .recv-row').waitFor();
      await page.goto(site + '/loader.html');
      await page.locator('.home-tile').first().waitFor();
      await tabTo(page, '.job-logout');
      await page.keyboard.press(key);
      await page.waitForURL('**/worker-login.html');
      assert.equal(await page.evaluate(() => localStorage.getItem('argus_auth_worker')), null);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('Long receipt identifier remains fully readable on all changed widths', async () => {
  const long = { ...invoice, number: 'ПРИХОД-2026-10-09-00000000000000000000000001' };
  for (const width of [375, 390, 768, 999, 1000, 1001, 1440]) {
    const { context, page, errors } = await screen(width, [long]);
    try {
      await page.getByText('Приёмка товара', { exact: true }).click();
      await page.locator('.recv-row').click();
      await page.locator('.rcv-item').waitFor();
      const fits = await page.locator('#receiptTitle').evaluate(e => {
        const range = document.createRange(); range.selectNodeContents(e);
        const box = e.getBoundingClientRect();
        return [...range.getClientRects()].every(r => r.left >= box.left - 1 && r.right <= box.right + 1);
      });
      assert.equal(fits, true, 'Clipped receipt identifier at ' + width);
      await noHorizontalOverflow(page);
      await snapshot(page, 'receipt-long-' + width);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('60/120 sellers retain usable scrolling, filtering and receipt access', { timeout: 120000 }, async () => {
  for (const width of [375, 390, 768, 999, 1000, 1001, 1440]) {
    for (const count of [60, 120]) {
      const invoices = Array.from({ length: count }, (_, i) => ({ ...invoice,
        id: '10000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
        number: 'ПР-' + String(i + 1).padStart(5, '0'),
        company_name: 'Продавец ' + String(i + 1).padStart(3, '0') + ' — учебные товары',
      }));
      const { context, page, errors } = await screen(width, invoices);
      try {
        await page.getByText('Приёмка товара', { exact: true }).click();
        await page.locator('.recv-row').first().waitFor();
        await noHorizontalOverflow(page);
        // Real wheel/PageDown only. No scrollIntoView or locator-click auto-scroll to receipts.
        if (count === 120) await tabTo(page, '.docs-content');
        else await page.mouse.move(width / 2, 600);
        let row;
        for (let i = 0; i < 70; i++) {
          row = await rowPosition(page);
          if (row.y >= 0 && row.y + 30 < row.visibleBottom) break;
          if (count === 120) await page.keyboard.press('PageDown');
          else await page.mouse.wheel(0, 300);
          await page.waitForTimeout(60);
        }
        row = await rowPosition(page);
        assert.ok(row.y >= 0 && row.y + 30 < row.visibleBottom, 'First receipt unreachable at ' + width + ', sellers=' + count);
        await snapshot(page, 'receipts-' + width + '-' + count);
        await page.mouse.click(row.x, row.y + 25);
        await page.locator('#receiptScreen.show .rcv-item').waitFor();
        await page.locator('#receiptScreen .job-back').click();
        await page.locator('#docsScreen.show .recv-row').first().waitFor();
        const seller = page.locator('[data-recv="seller"]').nth(2);
        await seller.click();
        await page.keyboard.press('Space');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.value), invoices[1].company_name, 'Filter lost keyboard focus after rerender');
        await page.waitForFunction(() => document.querySelectorAll('.recv-row').length === 1);
        assert.match(await page.locator('.recv-row').innerText(), /ПР-00002/);
        await noHorizontalOverflow(page);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  }
});
