const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('../mobile/node_modules/playwright');
const base = process.env.ARGUS_DOWNLOAD_PREVIEW || 'http://127.0.0.1:8740';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const out = path.resolve(__dirname, '../test-results'); fs.mkdirSync(out, { recursive: true });
  try {
    for (const width of [375, 390, 659, 660, 661, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(base + '/login.html');
      await page.getByRole('link', { name: 'Скачать приложение грузчика', exact: true }).click();
      await page.waitForURL('**/worker-app.html');
      assert.equal(await page.locator('#downloadAndroid').getAttribute('href'), 'downloads/argus-worker-0.1.1.apk');
      assert.equal(await page.getByRole('link', { name: 'Открыть вход грузчика', exact: true }).getAttribute('href'), 'worker-login.html');
      const rects = await page.evaluate(() => [...document.querySelectorAll('a, summary, h1, h2')].map(el => {
        const r = el.getBoundingClientRect(); return { text: el.textContent, left: r.left, right: r.right, width: r.width, height: r.height };
      }));
      for (const r of rects) assert.ok(r.left >= 0 && r.right <= width + 1 && r.width > 0, 'Clipped control: ' + r.text);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByText('Как установить', { exact: true }).click();
      await page.getByText('Добавить на экран «Домой»', { exact: true }).click();
      assert.equal(await page.locator('details[open]').count(), 2);
      if ([390, 768, 1440].includes(width)) await page.screenshot({ path: path.join(out, 'download-' + width + '.png'), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log('PASS: download page, login link, Android/iPhone instructions, 375/390/659/660/661/768/1440 widths; no page errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
