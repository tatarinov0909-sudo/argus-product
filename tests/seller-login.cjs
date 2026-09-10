// Run with Node + Playwright. No real credentials or production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.ARGUS_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const expectBug = process.argv.includes('--expect-bug');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const suffix of ['#products', '', '#orders']) {
      const context = await browser.newContext();
      const page = await context.newPage();
      let documents = 0, logins = 0;
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ body: '' }));
      await page.route('http://argus.test/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/client_access.html') documents++;
        const filename = path.join(root, url.pathname);
        await route.fulfill({ body: fs.readFileSync(filename), contentType:
          url.pathname.endsWith('.html') ? 'text/html; charset=utf-8' :
          url.pathname.endsWith('.js') ? 'text/javascript' :
          url.pathname.endsWith('.css') ? 'text/css' : 'font/woff2' });
      });
      await page.route('https://api.argus-ai.online/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/auth/seller/login')) {
          logins++;
          if (route.request().postDataJSON().keyCode === 'bad-test-key') {
            return route.fulfill({ status: 401, json: { error: 'Неверный тестовый ключ' } });
          }
          return route.fulfill({ json: { token: 'test-token-only', companyName: 'Тестовый продавец', warehouseName: 'Тестовый склад' } });
        }
        assert.equal(route.request().headers().authorization, 'Bearer test-token-only');
        if (url.pathname.endsWith('/profile')) return route.fulfill({ json: { id: 'test', name: 'Тестовый продавец' } });
        if (url.pathname.endsWith('/catalog')) return route.fulfill({ json: { products: [] } });
        if (url.pathname.endsWith('/stock')) return route.fulfill({ json: [] });
        throw Error('Unexpected API path: ' + url.pathname);
      });
      await page.goto('http://argus.test/client_access.html' + suffix);
      await page.locator('#loginName').fill('Тест');
      await page.locator('#loginKey').fill('bad-test-key');
      await page.locator('#loginSubmit').click();
      await page.getByText('Неверный тестовый ключ', { exact: true }).waitFor();
      assert.equal(await page.locator('#loginSubmit').isEnabled(), true);
      await page.locator('#loginKey').fill('valid-test-key');
      await page.locator('#loginSubmit').click();
      if (expectBug) {
        await page.waitForFunction(() => localStorage.getItem('argus_token') === 'test-token-only');
        assert.equal(await page.locator('#loginScreen').isVisible(), true);
        assert.equal(await page.locator('#loginSubmit').isDisabled(), true);
        assert.equal(documents, 1);
        await page.reload();
      }
      await page.locator('#productGroups').waitFor();
      assert.equal(await page.locator('#loginScreen').isVisible(), false);
      assert.equal(await page.locator('#companyName').textContent(), 'Тестовый продавец');
      assert.equal(documents, 2);
      assert.equal(logins, 2); // One rejected attempt, one successful attempt.
      assert.equal(new URL(page.url()).hash, '#products');
      if (!expectBug) {
        await page.locator('#logoutButton').click();
        await page.locator('#loginScreen').waitFor();
        assert.equal(await page.evaluate(() => localStorage.getItem('argus_token')), null);
        assert.equal(await page.locator('#app').isVisible(), false);
        assert.equal(documents, 3);
        await page.locator('#loginName').fill('Повторный вход');
        await page.locator('#loginKey').fill('valid-test-key');
        await page.locator('#loginSubmit').click();
        await page.locator('#productGroups').waitFor();
        assert.equal(documents, 4);
        assert.equal(logins, 3);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(expectBug ? 'REPRODUCED: login sticks until manual reload, on all three canonical URLs' :
      'PASS: form login, logout and re-login work without manual reload; plain URL, #products, #orders; failed login stays retryable');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
