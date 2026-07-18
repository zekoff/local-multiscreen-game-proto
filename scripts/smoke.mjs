// Smoke test against the Node (LAN-mode) transport: boots the real server at
// 10x game speed and runs the shared bot crew through a full mission.
// Exits 0 on a completed mission, 1 on any failure or timeout.

import { runBotCrew, spawnServer } from './lib/crew.mjs';

const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;

try {
  const { killTree } = await spawnServer(
    'npx',
    ['tsx', 'src/server-node.ts'],
    { env: { PORT: String(PORT), GAME_SPEED: '10' }, readyPattern: /Bridge server ready/ },
  );

  // Explicit missionId exercises the mission-selection path over the wire.
  // Seed pinned: smoke is a deterministic TRANSPORT regression test, not a
  // balance probe (that's npm run lab). The 10x wire bots act only every
  // ~2.5 sim-seconds, so a random hard seed can legitimately sink them.
  const debrief = await runBotCrew(BASE, { missionId: 'gen:europa', seed: 1003 });
  console.log(`debrief reached: ${debrief.outcome} — ${debrief.grade} (${debrief.score}/100)`);
  console.log(`mission: ${debrief.missionId} seed=${debrief.seed}`);
  console.log(`stats: ${JSON.stringify(debrief.stats)}`);
  if (debrief.outcome !== 'arrived') throw new Error('bot crew should have arrived but went adrift');
  if (!debrief.missionId.startsWith('gen:europa')) throw new Error(`wrong mission ran: ${debrief.missionId}`);
  console.log('SMOKE PASS');
  killTree();
  process.exit(0);
} catch (e) {
  console.error(`SMOKE FAIL: ${e.message}`);
  process.exit(1);
}
