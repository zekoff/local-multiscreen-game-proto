// Engine regression checks: fast, deterministic, in-process assertions on
// mechanics contracts that playtests have flagged as suspect. Unlike the lab
// (statistical balance sweeps) these are exact physics checks on a quiet
// sandbox mission with no spawns, drift, or ambient breaker trips.
//
//   npm run checks
//
// Current suite: the laser-recharge contract (playtest report: "laser seems to
// recharge very slowly at the end of the game" — these checks pin the rate to
// power × LASER_CHARGE_RATE, prove it is independent of mission time, halves
// under a tripped breaker, and fully recovers after a reset).

import { Game, type SystemId } from '../src/engine/game.js';
import { pacingFor, type MissionDef } from '../src/engine/mission.js';

const TICK = 0.25; // matches the live server tick

// A dead-calm mission: nothing spawns, nothing trips, no drift — pure physics.
const SANDBOX: MissionDef = {
  id: 'sandbox',
  name: 'Checks Sandbox',
  briefing: 'test',
  arrivalName: 'Nowhere',
  kind: 'authored',
  ...pacingFor(180),
  spawnEvery: { min: 99999, max: 99999 },
  impactIn: { min: 99999, max: 99999 },
  asteroidDmg: { min: 0, max: 0 },
  maxAsteroids: 0,
  breakerEvery: { min: 99999, max: 99999 },
  gateEvery: { min: 99999, max: 99999 },
  driftScale: 0,
  events: [],
};

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
}

function freshGame(): Game {
  const game = new Game();
  game.onEvent = () => {};
  // Man every crew seat so no auto-assist interferes with the measurement
  // (auto-eng would reallocate power, auto-weapons would manage shields).
  for (const seat of ['helm', 'engineering', 'weapons'] as const) {
    game.join(seat, `chk-${seat}`, `chk-${seat}`, 'normal');
  }
  game.start(SANDBOX, 42);
  return game;
}

function tickFor(game: Game, seconds: number) {
  for (let i = 0; i < Math.round(seconds / TICK); i++) game.tick(TICK);
}

// Drain the recharge meter directly (test-harness access to a private field —
// the legitimate drain path needs a targetable asteroid, which the sandbox
// deliberately has none of), then measure how much charge returns in `secs`.
function measureRecharge(game: Game, secs: number): number {
  (game as any).charge = 0;
  tickFor(game, secs);
  return game.serialize().charge as number;
}

// --- 1. The 7-point pool is fully spent by the default split, engines lead ---
{
  const game = freshGame();
  const power = game.serialize().power as Record<SystemId, number>;
  const total = power.engines + power.shields + power.weapons + power.sensors;
  check('default power split spends the full 7-point pool', total === 7, `total=${total}`);
  check('default split leads with engines=3', power.engines === 3, `engines=${power.engines}`);
}

// --- 2. Recharge slope = LASER_CHARGE_RATE × weapons power (default 2 ⇒ 14/s) ---
{
  const game = freshGame();
  const got = measureRecharge(game, 4); // expect 7 × 2 × 4s = 56
  check('recharge ≈ 56 over 4s at weapons=2', Math.abs(got - 56) <= 3, `got=${got}`);
}

// --- 3. Rate is independent of mission time (the "slow at end of game" report) ---
{
  const game = freshGame();
  tickFor(game, 150); // deep into the mission clock
  const got = measureRecharge(game, 4);
  check('recharge unchanged after 150s of mission time', Math.abs(got - 56) <= 3, `got=${got}`);
}

// --- 4. Tripped weapons breaker halves the rate (×0.5, not ×0) ---
{
  const game = freshGame();
  (game as any).tripBreaker('weapons'); // test-harness access: force the trip deterministically
  check('breaker reads tripped in serialize()', game.serialize().breakers.weapons === true, 'not tripped');
  const got = measureRecharge(game, 4); // expect 7 × 2 × 0.5 × 4s = 28
  check('recharge ≈ 28 over 4s with weapons breaker tripped', Math.abs(got - 28) <= 3, `got=${got}`);
}

// --- 5. Rate fully recovers after the engineer resets the breaker ---
{
  const game = freshGame();
  (game as any).tripBreaker('weapons');
  tickFor(game, 2); // let it sit tripped a while first
  game.action('engineering', { kind: 'resetBreaker', system: 'weapons' });
  check('breaker clears after resetBreaker action', game.serialize().breakers.weapons === false, 'still tripped');
  const got = measureRecharge(game, 4);
  check('recharge back to ≈ 56 over 4s after reset', Math.abs(got - 56) <= 3, `got=${got}`);
}

// --- 6. More weapon power ⇒ proportionally faster recharge (2 → 4 doubles it) ---
{
  const game = freshGame();
  // Shift two pips from engines (3) onto weapons (2 → 4) via real actions.
  game.action('engineering', { kind: 'power', system: 'engines', delta: -1 });
  game.action('engineering', { kind: 'power', system: 'weapons', delta: 1 });
  game.action('engineering', { kind: 'power', system: 'engines', delta: -1 });
  game.action('engineering', { kind: 'power', system: 'weapons', delta: 1 });
  const power = game.serialize().power as Record<SystemId, number>;
  check('power actions land (weapons=4)', power.weapons === 4, `weapons=${power.weapons}`);
  const got = measureRecharge(game, 2); // expect 7 × 4 × 2s = 56
  check('recharge ≈ 56 over 2s at weapons=4', Math.abs(got - 56) <= 4, `got=${got}`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll engine checks passed.');
