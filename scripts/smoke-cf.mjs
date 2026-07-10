// Smoke test against the Cloudflare Workers transport: boots `wrangler dev`
// (local workerd, no network/auth needed) at 10x game speed and runs the
// same bot crew as the Node smoke test. Exits 0 on a completed mission.

import { runBotCrew, spawnServer } from './lib/crew.mjs';

const PORT = 3124;
const BASE = `http://127.0.0.1:${PORT}`;

try {
  const { killTree } = await spawnServer(
    'npx',
    ['wrangler', 'dev', '--port', String(PORT), '--var', 'GAME_SPEED:10'],
    // wrangler colorizes output, so ANSI escapes may sit between words —
    // match just the stable "Ready on" prefix.
    { readyPattern: /Ready on/i, startTimeoutMs: 120_000 },
  );

  const debrief = await runBotCrew(BASE);
  console.log(`debrief reached: ${debrief.outcome} — ${debrief.grade} (${debrief.score}/100)`);
  console.log(`stats: ${JSON.stringify(debrief.stats)}`);
  if (debrief.outcome !== 'arrived') throw new Error('bot crew should have arrived but went adrift');
  console.log('SMOKE-CF PASS');
  killTree();
  process.exit(0);
} catch (e) {
  console.error(`SMOKE-CF FAIL: ${e.message}`);
  process.exit(1);
}
