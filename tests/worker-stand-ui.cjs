// Opt-in, isolated local stand only. Reads synthetic fixture; never prints login credentials.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.ARGUS_PLAYWRIGHT_MODULE || '../mobile/node_modules/playwright');
const fixturePath = process.env.ARGUS_WORKER_FIXTURE;
if (!fixturePath) throw new Error('Set ARGUS_WORKER_FIXTURE to an isolated synthetic stand fixture.');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const base = process.env.ARGUS_WORKER_WEB || 'http://127.0.0.1:8733';
if (!fixture.synthetic || !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.baseUrl) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('Only an explicitly synthetic loopback stand is allowed.');
const out = path.join(path.dirname(fixturePath), 'ui-checks'); fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    if (host !== '127.0.0.1') { external.push(host); return route.abort(); }
    return route.continue();
  });
  try {
    await page.goto(base + '/login.html');
    for (const width of [375, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(out, 'login-' + width + '.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('#key').fill(fixture.keyCode);
    await page.locator('#loginButton').click();
    await page.waitForURL('**/loader.html');
    await page.locator('#homeBody').getByText('Приёмка товара', { exact: true }).click();
    await page.getByText(fixture.invoice.number, { exact: true }).first().click();
    await page.getByRole('button', { name: /Начать приёмку|Продолжить/ }).first().click();
    if(await page.locator('#startGoBtn').isVisible()) await page.locator('#startGoBtn').click();
    await page.waitForFunction(() => document.querySelector('#workerCellScan')?.offsetParent !== null);
    const target = await page.evaluate(() => {
      const item = currentInvoice.items[currentItemIndex];
      return { id: item.id, qty: recvLeft(item) === null ? Number(item.declared_qty) : recvLeft(item), received: recvLeft(item) !== null };
    });
    const firstQty = target.qty;
    assert.ok(firstQty >= 4, 'Fixture must support four partial placement steps');
    const amounts = [1, 1, 1, firstQty - 3];
    for (let index = 0; index < 4; index++) {
      const width = [375, 390, 768, 1440][index];
      await page.setViewportSize({ width, height: 900 });
      await page.locator('#workerScanInput').fill(fixture.cells[index].qr);
      await page.locator('#workerScanInput').press('Enter');
      await page.locator('#placeQty').fill(String(amounts[index]));
      await page.locator('#placeQty').dispatchEvent('input');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Receiving overflow at ' + width);
      for(const selector of ['.phone','#workerStatus','#workerCellScan','#workerScanInput','#confirmBtn','#placeQty']){
        const rect = await page.locator(selector).boundingBox();
        assert.ok(rect && rect.x >= -1 && rect.x + rect.width <= width + 1, selector + ' fits viewport at ' + width);
      }
      await page.evaluate(() => document.querySelector('#taskScreen .task-body')?.scrollTo(0,0));
      await page.screenshot({ path: path.join(out, 'receiving-' + width + '.png'), fullPage: true });
      const response = page.waitForResponse(r => new URL(r.url()).pathname === (index || target.received ? '/api/receiving/items/' + target.id + '/place' : '/api/receiving') && r.request().method() === 'POST');
      await page.locator('#confirmBtn').click();
      const saved = await response;
      assert.ok(saved.ok(), 'Placement accepted at ' + width + ': ' + saved.status());
      await page.waitForFunction(() => document.querySelector('#doneScreen.show') || !document.querySelector('#confirmBtn').textContent.includes('Сохраняю'));
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log('PASS: local login, four QR-confirmed placement steps, 375/390/768/1440; no external network.');
  } catch (error) {
    await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
    console.error(error.stack);
    console.error('Browser errors:', JSON.stringify(errors));
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
