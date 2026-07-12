import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';
const { code } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json();
const browser = await chromium.launch();
const errors = [];
const main = await browser.newPage({ viewport: { width: 1280, height: 720 } });
main.on('pageerror', (e) => errors.push(e.message));
main.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await main.goto(`${BASE}/mainscreen.html?room=${code}`);
await main.waitForTimeout(900);
await main.check('#debug-toggle');
await main.selectOption('#mission-select', 'supply-run');
await main.click('#launch-btn');
await main.waitForTimeout(1500);
await main.click('#debug-panel button[data-speed="4"]');
for (let i = 0; i < 4; i++) await main.click('#debug-panel button[data-act="spawnAsteroid"]');
await main.waitForTimeout(6000);
await main.screenshot({ path: '/tmp/final-active.png' });
let ended = false;
for (let i = 0; i < 120 && !ended; i++) {
  await main.waitForTimeout(1000);
  ended = await main.$eval('#debrief-overlay', (el) => !el.classList.contains('hidden')).catch(() => false);
}
let scrollOk = false;
if (ended) {
  const st0 = await main.$eval('#debrief-log', (el) => el.scrollTop);
  await main.waitForTimeout(5000);
  const st1 = await main.$eval('#debrief-log', (el) => el.scrollTop);
  const scrollable = await main.$eval('#debrief-log', (el) => el.scrollHeight > el.clientHeight);
  scrollOk = !scrollable || st1 > st0;
  console.log('autoscroll:', scrollOk, `(${st0} -> ${st1}, scrollable=${scrollable})`);
  await main.screenshot({ path: '/tmp/final-debrief.png' });
}
console.log('errors:', errors.length, errors.slice(0, 4));
await browser.close();
process.exit(ended && scrollOk && errors.length === 0 ? 0 : 1);
