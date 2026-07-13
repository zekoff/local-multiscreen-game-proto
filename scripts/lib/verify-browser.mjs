// Headless browser verification harness for the LAN clients. Boots the real
// Node server (reusing scripts/lib/crew.mjs's spawnServer, exactly like the
// smoke test), opens a Chromium browser, hands both to a caller, and tears
// everything down afterward — collecting console errors from every page opened.
//
// WHY THIS EXISTS (sandbox gotchas that otherwise get re-derived every session):
//   1. Bash foreground `sleep` is BLOCKED in this sandbox (a wait-loop like
//      `until curl …; do sleep 0.5; done` dies with exit 144). And a server
//      backgrounded with `&` in one Bash tool call does NOT survive into the
//      next call. => Do the whole thing in ONE Node process and wait with Node
//      timers (setTimeout), never bash sleep — the same shape as scripts/smoke.mjs.
//   2. A driver .mjs must live INSIDE the repo tree. A bare `import 'playwright'`
//      resolves from the SCRIPT's own directory upward, NOT from cwd — a script
//      placed in /tmp throws ERR_MODULE_NOT_FOUND even when run from the repo.
//      Keep drivers under scripts/ (or the repo root) and this import resolves.
//   3. Spawning the server as a CHILD works (npx tsx …, via spawnServer); it's
//      the bash-level `&`/sleep pattern that fails, not child processes per se.
//
// Usage (put the driver under scripts/, run `node scripts/<driver>.mjs`, delete
// it when done):
//
//   import { withServerAndBrowser } from './lib/verify-browser.mjs';
//   await withServerAndBrowser(async ({ open, errors, sleep }) => {
//     const main = await open('mainscreen');   // opens /mainscreen.html?room=…
//     await open('weapons'); await open('crewchief');
//     await sleep(1000);
//     await main.click('#launch-btn', { force: true }); // leave lobby -> active
//     await sleep(14000);                                // let the sim run
//     await main.screenshot({ path: '/tmp/frame.png' });
//     console.log('console errors:', errors.length, JSON.stringify(errors, null, 2));
//   });
//   process.exit(0); // the server-tree teardown can otherwise surface a signal code

import { spawnServer } from './crew.mjs';
import { chromium } from 'playwright';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Boots server + browser, creates a room, and invokes
//   run({ base, room, browser, ctx, open, errors, sleep })
// `open(pageName)` opens `<pageName>.html?room=<room>` and registers console +
// pageerror capture into the shared `errors` array ([{ page, text }]).
// Everything is torn down on return or throw. Returns whatever `run` returns.
export async function withServerAndBrowser(run, {
  port = 3141, gameSpeed = '6', viewport = { width: 1100, height: 680 },
} = {}) {
  const base = `http://127.0.0.1:${port}`;
  const { killTree } = await spawnServer('npx', ['tsx', 'src/server-node.ts'], {
    env: { PORT: String(port), GAME_SPEED: String(gameSpeed) },
    readyPattern: /Bridge server ready/,
  });
  const errors = [];
  let browser;
  try {
    const room = JSON.parse(await (await fetch(`${base}/api/rooms`, { method: 'POST' })).text()).code;
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport });
    const open = async (pageName) => {
      const p = await ctx.newPage();
      p.on('console', (m) => { if (m.type() === 'error') errors.push({ page: pageName, text: m.text() }); });
      p.on('pageerror', (e) => errors.push({ page: pageName, text: 'PAGEERROR ' + String(e?.message || e) }));
      await p.goto(`${base}/${pageName}.html?room=${room}`);
      return p;
    };
    return await run({ base, room, browser, ctx, open, errors, sleep });
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
    try { killTree(); } catch { /* ignore */ }
  }
}
