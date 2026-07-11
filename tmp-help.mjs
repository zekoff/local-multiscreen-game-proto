import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';
const { code } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json();
const browser = await chromium.launch();
const errors = [];
let pass = 0, fail = 0;
for (const p of ['helm.html', 'engineering.html', 'weapons.html']) {
  const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
  page.on('pageerror', (e) => errors.push(`${p}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${p}: ${m.text()}`); });
  await page.goto(`${BASE}/${p}?room=${code}&name=tut`);
  await page.waitForTimeout(800);
  await page.click('#help-btn');
  const visible = await page.$eval('.help-overlay', (el) => !el.classList.contains('hidden'));
  const title = await page.textContent('.help-overlay h2');
  console.log(`${visible ? 'PASS' : 'FAIL'}  ${p}: "${title}"`);
  visible ? pass++ : fail++;
  if (p === 'engineering.html') await page.screenshot({ path: '/tmp/tutorial.png' });
  await page.click('#help-close');
  const hidden = await page.$eval('.help-overlay', (el) => el.classList.contains('hidden'));
  hidden ? pass++ : (fail++, console.log(`FAIL ${p}: overlay did not close`));
  await page.close();
}
console.log('errors:', errors.length, errors.slice(0, 3));
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
