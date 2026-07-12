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
await main.selectOption('#mission-select', 'mined-corridor');
await main.click('#launch-btn');
await main.waitForTimeout(1200);
await main.click('#debug-panel button[data-speed="4"]');
let sawDebris = false, ended = false;
for (let i = 0; i < 150 && !sawDebris && !ended; i++) {
  await main.waitForTimeout(400);
  const thr = (await main.$eval('#cap-threat .cap-val', (el) => el.textContent).catch(() => '')) || '';
  if (/DEBRIS/.test(thr)) sawDebris = true;
  ended = await main.$eval('#debrief-overlay', (el) => !el.classList.contains('hidden')).catch(() => false);
}
if (sawDebris) {
  await main.waitForTimeout(600);
  await main.screenshot({ path: '/tmp/gfx-debris.png' });
}
console.log('debris seen:', sawDebris, 'ended early:', ended);
console.log('errors:', errors.length, errors.slice(0, 4));
await browser.close();
process.exit(sawDebris && errors.length === 0 ? 0 : 1);
