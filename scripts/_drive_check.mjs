import { spawnServer } from './lib/crew.mjs';
import { chromium } from 'playwright';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOT = '/tmp/claude-1000/-home-zekoff-bridge-crew/1626e343-31aa-4667-85a2-565c9453d6c2/scratchpad';
const port = 3161, base = `http://127.0.0.1:${port}`;
const { killTree } = await spawnServer('npx', ['tsx', 'src/server-node.ts'],
  { env: { PORT: String(port), GAME_SPEED: '4' }, readyPattern: /Bridge server ready/ });
let browser; const errors = [];
try {
  const room = JSON.parse(await (await fetch(`${base}/api/rooms`, { method: 'POST' })).text()).code;
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
  const eng = await ctx.newPage();
  eng.on('pageerror', (e) => errors.push('eng ' + String(e?.message || e)));
  await eng.goto(`${base}/engineering.html?room=${room}`);
  const main = await ctx.newPage();
  await main.goto(`${base}/mainscreen.html?room=${room}`);
  await sleep(800); await main.selectOption('#mission-select', 'gen:europa').catch(()=>{});
  await main.click('#launch-btn', { force: true });
  await sleep(3500);
  const engScroll = await eng.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight + 2);
  console.log('engineering phone scrolls:', engScroll);
  await eng.screenshot({ path: `${SHOT}/chk-eng-phone.png` });
  // Salvage silhouette: bump mainscreen to desktop, spawn salvage far via nothing —
  // just screenshot early Europa (salvage drifts at ~9s via salv-1 @45/4x≈11s).
  await main.setViewportSize({ width: 1100, height: 680 });
  await sleep(9000);
  await main.screenshot({ path: `${SHOT}/chk-salvage.png` });
  console.log('errors:', errors.length, JSON.stringify(errors));
} finally { try { await browser?.close(); } catch {} try { killTree(); } catch {} }
process.exit(0);
