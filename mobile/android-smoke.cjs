// Run only against a debug emulator and the disposable local worker fixture.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
(async () => {
  const fixturePath = process.env.ARGUS_WORKER_FIXTURE_PATH;
  if (!fixturePath) throw new Error('Set ARGUS_WORKER_FIXTURE_PATH to a synthetic local fixture');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(fixture.synthetic, true);
  const browser = await chromium.connectOverCDP(process.env.ARGUS_ANDROID_CDP || 'http://127.0.0.1:9224');
  try {
    const page = browser.contexts()[0].pages()[0];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const config = await page.evaluate(() => window.ARGUS_WORKER_CONFIG);
    assert.equal(config.native, true);
    assert.equal(config.apiBase, 'http://10.0.2.2:3110');
    if (await page.locator('#workerLogin').count()) {
      await page.locator('#key').fill(fixture.keyCode);
      await page.locator('#loginButton').click();
    }
    await page.waitForURL('**/loader.html', { timeout: 15000 }).catch(async error => {
      const message = await page.locator('#loginError').textContent().catch(() => '');
      throw new Error(message || error.message);
    });
    await page.locator('#workerStatus').waitFor({ timeout: 15000 });
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, title: document.title }));
    assert.ok(layout.scrollWidth <= layout.width + 1, 'Unexpected horizontal page overflow');
    assert.deepEqual(errors, []);
    const out = path.resolve(__dirname, '../test-results');
    fs.mkdirSync(out, { recursive: true });
    await page.screenshot({ path: path.join(out, 'android-workspace.png'), fullPage: true });
    console.log(JSON.stringify({ passed: true, ...layout, consoleErrors: errors.length }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
