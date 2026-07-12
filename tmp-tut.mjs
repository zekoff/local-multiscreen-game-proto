import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';
const { code } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json();
const browser = await chromium.launch();
const errors = [];
for (const [p, shot] of [['helm.html', '/tmp/tut-helm.png'], ['engineering.html', '/tmp/tut-eng.png'], ['weapons.html', '/tmp/tut-weap.png']]) {
  const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
  page.on('pageerror', (e) => errors.push(`${p}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${p}: ${m.text()}`); });
  await page.goto(`${BASE}/${p}?room=${code}&name=t`);
  await page.waitForTimeout(800);
  await page.click('#help-btn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot });
  await page.close();
}
console.log('errors:', errors.length, errors.slice(0, 3));
await browser.close();
process.exit(errors.length ? 1 : 0);
