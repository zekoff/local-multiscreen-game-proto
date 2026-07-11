// Mission lab: in-process balance harness. Runs every mission against a set of
// crew scenarios across a sweep of fixed seeds, driving the engine directly —
// no server, no sockets — so a full sweep takes seconds. Prints an outcomes
// table and a per-console effectiveness table, and writes the raw per-run
// records (debrief + telemetry) to reports/ for deeper analysis.
//
//   npm run lab                 # default sweep (10 seeds per cell)
//   LAB_RUNS=30 npm run lab     # bigger sample
//   LAB_MISSIONS=supply-run npm run lab   # restrict to specific mission ids
//
// Scenarios:
//   skilled - a fully-crewed, coordinated table (the ceiling)
//   novice  - a fully-crewed but sloppy table (the difficulty floor for humans)
//   auto    - all seats unmanned; the engine's (deliberately mediocre)
//             auto-assist plays every station. Balance target: this LOSES.
//   1h-helm / 1h-eng / 1h-weap - one skilled human at that console, auto-assist
//             on the other two. Balance target: this WINS, but with the hull
//             low — a single good operator can carry a bot crew, barely.

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

// A seat is either driven by a named policy ('skilled'/'novice') or left
// unmanned ('auto'), in which case the engine's auto-assist plays it.
type SeatMode = 'skilled' | 'novice' | 'auto';
interface Scenario {
  name: string;
  seats: Record<SeatId, SeatMode>;
}
const SCENARIOS: Scenario[] = [
  { name: 'skilled', seats: { helm: 'skilled', engineering: 'skilled', weapons: 'skilled', main: 'auto', supervisor: 'auto' } },
  { name: 'novice', seats: { helm: 'novice', engineering: 'novice', weapons: 'novice', main: 'auto', supervisor: 'auto' } },
  { name: 'auto', seats: { helm: 'auto', engineering: 'auto', weapons: 'auto', main: 'auto', supervisor: 'auto' } },
  { name: '1h-helm', seats: { helm: 'skilled', engineering: 'auto', weapons: 'auto', main: 'auto', supervisor: 'auto' } },
  { name: '1h-eng', seats: { helm: 'auto', engineering: 'skilled', weapons: 'auto', main: 'auto', supervisor: 'auto' } },
  { name: '1h-weap', seats: { helm: 'auto', engineering: 'auto', weapons: 'skilled', main: 'auto', supervisor: 'auto' } },
];

const missionIds = process.env.LAB_MISSIONS
  ? process.env.LAB_MISSIONS.split(',').map((s) => s.trim())
  : missionCatalog().map((c) => c.id);

interface RunRecord {
  missionId: string;
  scenario: string;
  seed: number;
  completed: boolean; // false = stalled out (never reached debrief)
  debrief: Debrief | null;
}

function runOnce(missionId: string, scenario: Scenario, seed: number): RunRecord {
  const game = new Game();
  game.onEvent = () => {}; // no listeners in the lab
  // Manned seats join like human players would; 'auto' seats stay unmanned so
  // the engine's auto-assist plays them.
  const manned = CREW_SEATS.filter((s) => scenario.seats[s] !== 'auto');
  for (const seat of manned) game.join(seat, `lab-${seat}`, `lab-${seat}`, 'normal');
  // One crew per policy flavour used this run (seeded, so the cell is
  // reproducible). We only ever call the policy for a manned seat.
  const crews: Partial<Record<SeatMode, ReturnType<typeof makeCrew>>> = {};
  for (const seat of manned) {
    const mode = scenario.seats[seat];
    if (!crews[mode]) crews[mode] = makeCrew(mode, mulberry32(seed ^ 0x5eed));
  }

  const { def } = resolveMissionStart(missionId, seed);
  game.start(def, seed);

  // Hard cap well past any legitimate finish, to catch stalls (e.g. a
  // mission that can never reach 100 progress).
  const maxTicks = Math.ceil((def.parTime * 5) / TICK);
  for (let i = 0; i < maxTicks && game.phase === 'active'; i++) {
    if (manned.length > 0) {
      const state = game.serialize();
      for (const seat of manned) {
        const crew = crews[scenario.seats[seat]]!;
        for (const action of crew[seat](state)) game.action(seat, action);
      }
    }
    game.tick(TICK);
  }
  return { missionId, scenario: scenario.name, seed, completed: game.phase === 'debrief', debrief: game.debrief };
}

// --- Sweep ---

const records: RunRecord[] = [];
for (const missionId of missionIds) {
  for (const scenario of SCENARIOS) {
    for (let i = 0; i < RUNS; i++) {
      records.push(runOnce(missionId, scenario, 1000 + i));
    }
  }
}

// --- Aggregate tables ---

const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const cellOf = (missionId: string, scenario: string) =>
  records.filter((r) => r.missionId === missionId && r.scenario === scenario);

console.log(`\nMission lab: ${RUNS} seeded runs per cell (tick ${TICK}s)\n`);

// Outcomes table.
console.log('| mission | crew | arrived | avg score | avg hull | avg time | impacts | spawned |');
console.log('|---|---|---|---|---|---|---|---|');
for (const missionId of missionIds) {
  for (const scenario of SCENARIOS) {
    const cell = cellOf(missionId, scenario.name);
    const done = cell.filter((r) => r.debrief !== null).map((r) => r.debrief!);
    const arrived = done.filter((d) => d.outcome === 'arrived');
    console.log(
      `| ${missionId} | ${scenario.name} | ${pct(arrived.length / Math.max(1, cell.length))} ` +
      `| ${Math.round(avg(done.map((d) => d.score)))} ` +
      `| ${Math.round(avg(done.map((d) => d.stats.hull)))} ` +
      `| ${Math.round(avg(arrived.map((d) => d.stats.time)))}s ` +
      `| ${avg(done.map((d) => d.stats.impacts)).toFixed(1)} ` +
      `| ${avg(done.map((d) => d.telemetry.asteroidsSpawned)).toFixed(1)} |`,
    );
  }
}

// Per-console effectiveness table (from telemetry.perConsole). Only 'skilled'
// and the three single-human scenarios are shown — these are where a console's
// effectiveness read is meaningful. Captain coord is the crew-coordination
// proxy (defense + gate discipline + fast target hand-offs).
console.log('\nPer-console effectiveness (arrived runs):\n');
console.log('| mission | crew | helm gate% | helm on-course | weap hit% | weap acquire(s) | eng power-util | captain coord |');
console.log('|---|---|---|---|---|---|---|---|');
const METRIC_SCENARIOS = ['skilled', '1h-helm', '1h-eng', '1h-weap'];
for (const missionId of missionIds) {
  for (const scenarioName of METRIC_SCENARIOS) {
    const done = cellOf(missionId, scenarioName)
      .filter((r) => r.debrief && r.debrief.outcome === 'arrived')
      .map((r) => r.debrief!.telemetry.perConsole);
    if (done.length === 0) {
      console.log(`| ${missionId} | ${scenarioName} | — | — | — | — | — | — |`);
      continue;
    }
    console.log(
      `| ${missionId} | ${scenarioName} ` +
      `| ${pct(avg(done.map((c) => c.helm.gatePassRate)))} ` +
      `| ${pct(avg(done.map((c) => c.helm.onCoursePct)))} ` +
      `| ${pct(avg(done.map((c) => c.weapons.hitRate)))} ` +
      `| ${avg(done.map((c) => c.weapons.avgAcquireLatency)).toFixed(1)} ` +
      `| ${pct(avg(done.map((c) => c.engineering.avgPowerUtil)))} ` +
      `| ${avg(done.map((c) => c.captain.coordinationScore)).toFixed(2)} |`,
    );
  }
}

// Stalls are a red flag (mission unwinnable or engine bug) — surface loudly.
const stalls = records.filter((r) => !r.completed);
if (stalls.length > 0) {
  console.log(`\n⚠ ${stalls.length} run(s) STALLED (never reached debrief):`);
  for (const s of stalls) console.log(`  ${s.missionId} / ${s.scenario} / seed ${s.seed}`);
  process.exitCode = 1;
}

// --- Raw records for deeper analysis ---

const outDir = path.join(process.cwd(), 'reports');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `mission-lab-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(outFile, JSON.stringify({ tick: TICK, runsPerCell: RUNS, records }, null, 2));
console.log(`\nraw records: ${outFile}`);
