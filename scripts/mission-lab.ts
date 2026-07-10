// Mission lab: in-process balance harness. Runs every mission against three
// crew baselines (skilled bots, novice bots, unmanned auto-assist) across a
// sweep of fixed seeds, driving the engine directly — no server, no sockets —
// so a full sweep takes seconds. Prints an aggregate table and writes the raw
// per-run records (debrief + telemetry) to reports/ for deeper analysis.
//
//   npm run lab                 # default sweep (10 seeds per cell)
//   LAB_RUNS=30 npm run lab     # bigger sample
//   LAB_MISSIONS=supply-run npm run lab   # restrict to specific mission ids
//
// Interpreting results: 'skilled' is the ceiling a coordinated crew can hit,
// 'auto' approximates a distracted/first-time table (auto-assist is
// deliberately mediocre), and 'novice' sits between. A well-tuned mission
// should be comfortably winnable for 'skilled', survivable-but-scarred for
// 'novice', and rough for 'auto'.

import fs from 'node:fs';
import path from 'node:path';
import { Game, type SeatId, type Debrief } from '../src/engine/game.js';
import { resolveMissionStart, missionCatalog } from '../src/engine/mission-registry.js';
import { mulberry32 } from '../src/engine/rng.js';
// @ts-ignore - plain JS module shared with the WebSocket smoke bots
import { makeCrew } from './lib/policies.mjs';

const TICK = 0.25; // matches the live server tick
const RUNS = Number(process.env.LAB_RUNS || 10);
const CREW_SEATS: SeatId[] = ['helm', 'engineering', 'weapons'];
const PROFILES = ['skilled', 'novice', 'auto'] as const;
type Profile = (typeof PROFILES)[number];

const missionIds = process.env.LAB_MISSIONS
  ? process.env.LAB_MISSIONS.split(',').map((s) => s.trim())
  : missionCatalog().map((c) => c.id);

interface RunRecord {
  missionId: string;
  profile: Profile;
  seed: number;
  completed: boolean; // false = stalled out (never reached debrief)
  debrief: Debrief | null;
}

function runOnce(missionId: string, profile: Profile, seed: number): RunRecord {
  const game = new Game();
  game.onEvent = () => {}; // no listeners in the lab
  // 'auto' leaves all seats unmanned so the engine's auto-assist plays;
  // other profiles claim the crew seats like human players would.
  if (profile !== 'auto') {
    for (const seat of CREW_SEATS) game.join(seat, `lab-${seat}`, `lab-${seat}`, 'normal');
  }
  // Policy randomness is seeded too, so a (mission, profile, seed) cell is
  // fully reproducible.
  const crew = makeCrew(profile === 'auto' ? 'skilled' : profile, mulberry32(seed ^ 0x5eed));

  const { def } = resolveMissionStart(missionId, seed);
  game.start(def, seed);

  // Hard cap well past any legitimate finish, to catch stalls (e.g. a
  // mission that can never reach 100 progress).
  const maxTicks = Math.ceil((def.parTime * 5) / TICK);
  for (let i = 0; i < maxTicks && game.phase === 'active'; i++) {
    if (profile !== 'auto') {
      const state = game.serialize();
      for (const seat of CREW_SEATS) {
        for (const action of crew[seat](state)) game.action(seat, action);
      }
    }
    game.tick(TICK);
  }
  return { missionId, profile, seed, completed: game.phase === 'debrief', debrief: game.debrief };
}

// --- Sweep ---

const records: RunRecord[] = [];
for (const missionId of missionIds) {
  for (const profile of PROFILES) {
    for (let i = 0; i < RUNS; i++) {
      records.push(runOnce(missionId, profile, 1000 + i));
    }
  }
}

// --- Aggregate table ---

const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const pct = (x: number) => `${Math.round(x * 100)}%`;

console.log(`\nMission lab: ${RUNS} seeded runs per cell (tick ${TICK}s)\n`);
console.log('| mission | crew | arrived | avg score | avg hull | avg time | impacts | spawned |');
console.log('|---|---|---|---|---|---|---|---|');
for (const missionId of missionIds) {
  for (const profile of PROFILES) {
    const cell = records.filter((r) => r.missionId === missionId && r.profile === profile);
    const done = cell.filter((r) => r.debrief !== null).map((r) => r.debrief!);
    const arrived = done.filter((d) => d.outcome === 'arrived');
    console.log(
      `| ${missionId} | ${profile} | ${pct(arrived.length / Math.max(1, cell.length))} ` +
      `| ${Math.round(avg(done.map((d) => d.score)))} ` +
      `| ${Math.round(avg(done.map((d) => d.stats.hull)))} ` +
      `| ${Math.round(avg(arrived.map((d) => d.stats.time)))}s ` +
      `| ${avg(done.map((d) => d.stats.impacts)).toFixed(1)} ` +
      `| ${avg(done.map((d) => d.telemetry.asteroidsSpawned)).toFixed(1)} |`,
    );
  }
}

// Stalls are a red flag (mission unwinnable or engine bug) — surface loudly.
const stalls = records.filter((r) => !r.completed);
if (stalls.length > 0) {
  console.log(`\n⚠ ${stalls.length} run(s) STALLED (never reached debrief):`);
  for (const s of stalls) console.log(`  ${s.missionId} / ${s.profile} / seed ${s.seed}`);
  process.exitCode = 1;
}

// --- Raw records for deeper analysis ---

const outDir = path.join(process.cwd(), 'reports');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `mission-lab-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(outFile, JSON.stringify({ tick: TICK, runsPerCell: RUNS, records }, null, 2));
console.log(`\nraw records: ${outFile}`);
