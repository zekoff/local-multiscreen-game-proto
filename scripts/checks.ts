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
    game.join(seat, `chk-${seat}`, `chk-${seat}`, 'officer');
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
  check('default split funds weapons=2 (laser + tractor share it)', power.weapons === 2, `weapons=${power.weapons}`);
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

// --- 7. Difficulty knobs measurably change each console's burden ---
// Each seat's chill/intense multiplier must move the thing that seat manages:
// helm = course drift, engineering = breaker trips per hull hit, weapons =
// asteroid spawn pressure. Same seed both sides, so the comparison is exact.

function gameWithSeat(def: MissionDef, seat: 'helm' | 'engineering' | 'weapons', difficulty: 'cruise' | 'officer'): Game {
  const game = new Game();
  game.onEvent = () => {};
  for (const s of ['helm', 'engineering', 'weapons'] as const) {
    game.join(s, `chk-${s}`, `chk-${s}`, s === seat ? difficulty : 'officer');
  }
  game.start(def, 42);
  return game;
}

{
  // Helm: drift pressure scales with the helm seat's difficulty (Cruise 0.6 vs
  // Officer 1.0 — a 1.67x span).
  const driftDef: MissionDef = { ...SANDBOX, driftScale: 1 };
  const drift = (d: 'cruise' | 'officer') => {
    const game = gameWithSeat(driftDef, 'helm', d);
    tickFor(game, 60);
    return Math.abs(game.serialize().alignment as number);
  };
  const cruise = drift('cruise');
  const officer = drift('officer');
  check('helm difficulty scales course drift', officer > cruise && officer >= cruise * 1.5, `cruise=${cruise} officer=${officer}`);
}

{
  // Engineering: breaker trips per hull hit scale with the eng seat's
  // difficulty (Cruise ~60% of hits, Officer every hit).
  const trips = (d: 'cruise' | 'officer') => {
    const game = gameWithSeat(SANDBOX, 'engineering', d) as any;
    for (let i = 0; i < 20; i++) {
      game.applyImpact({ id: 900 + i, designation: 900 + i, dmg: 0.5, impactIn: 0, size: 1, speed: 1, bearing: 0, revealed: true });
      for (const s of ['engines', 'shields', 'weapons', 'sensors']) game.resetBreaker(s);
    }
    return game.stats.breakersTripped as number;
  };
  const cruise = trips('cruise');
  const officer = trips('officer');
  check('eng difficulty scales impact breaker trips', cruise <= 17 && officer >= 19 && officer > cruise, `cruise=${cruise}/20 hits, officer=${officer}/20 hits`);
}

{
  // Weapons: ambient spawn pressure scales with the weapons seat's difficulty.
  const spawnDef: MissionDef = {
    ...SANDBOX,
    spawnEvery: { min: 8, max: 8 },
    impactIn: { min: 99999, max: 99999 }, // never actually arrive
    maxAsteroids: 999,
  };
  const spawned = (d: 'cruise' | 'officer') => {
    const game = gameWithSeat(spawnDef, 'weapons', d) as any;
    tickFor(game, 100);
    return game.tel.asteroidsSpawned as number;
  };
  const cruise = spawned('cruise');
  const officer = spawned('officer');
  check('weapons difficulty scales spawn pressure', officer >= cruise * 1.5 && officer > cruise, `cruise=${cruise} officer=${officer}`);
}

// --- 8. Target lock is lost when the contact falls below sensor resolution ---
// Acquire a rock near the edge of passive range, then pull the sensor power
// point: range shrinks under the contact and the lock must clear.
{
  const game = freshGame() as any;
  // Default sensors=1 -> detection range 10+2 = 12s. Hand-place a rock at 11.5s
  // (targetable now, but only just — dropping a sensor point pulls range under it).
  game.asteroids.push({
    id: 501, designation: 501, kind: 'rock', impactIn: 11.5, dmg: 5, size: 1, speed: 1, mass: 0,
    revealed: false, identified: true, announced: true, bearing: 0,
  });
  game.action('weapons', { kind: 'target', id: 501 });
  check('edge contact locks at sensors=1 (range 12s)', game.serialize().targetId === 501, `targetId=${game.serialize().targetId}`);
  // Drop sensors 1 -> 0: range 10s < 11.5s, the contact fades, lock must drop.
  game.action('engineering', { kind: 'power', system: 'sensors', delta: -1 });
  game.tick(0.25);
  const after = game.serialize();
  check('lock clears when sensor range shrinks under the contact', after.targetId === null, `targetId=${after.targetId}`);
  check('faded contact is no longer targetable', after.asteroids.find((a: any) => a.id === 501)?.targetable === false, '');
}

// --- 9. Weapons governor (P#10): SNAPSHOT fires at 40% but only cracks small
// contacts; a big rock shrugs it off (charge spent, contact survives). ---
{
  const game = freshGame() as any;
  game.action('weapons', { kind: 'governor', mode: 'snapshot' });
  game.charge = 45;
  game.asteroids.push({ id: 610, designation: 610, kind: 'rock', impactIn: 5, dmg: 5, size: 0.8, speed: 1, mass: 0, revealed: true, identified: true, announced: true, bearing: 0 });
  game.action('weapons', { kind: 'target', id: 610 });
  game.action('weapons', { kind: 'fire' });
  check('snapshot at 40% destroys a small rock', !game.asteroids.some((a: any) => a.id === 610), 'small rock survived');

  const g2 = freshGame() as any;
  g2.action('weapons', { kind: 'governor', mode: 'snapshot' });
  g2.charge = 45;
  g2.asteroids.push({ id: 611, designation: 611, kind: 'rock', impactIn: 5, dmg: 5, size: 1.5, speed: 1, mass: 0, revealed: true, identified: true, announced: true, bearing: 0 });
  g2.action('weapons', { kind: 'target', id: 611 });
  g2.action('weapons', { kind: 'fire' });
  check('snapshot glances off a big rock (survives, charge spent)', g2.asteroids.some((a: any) => a.id === 611) && g2.charge === 0, `present=${g2.asteroids.some((a: any) => a.id === 611)} charge=${g2.charge}`);
}

// --- 10. Firing is blocked while the tractor beam is latched (shared emitter) ---
{
  const game = freshGame() as any;
  game.charge = 100;
  game.tractorLatched = true;
  game.asteroids.push({ id: 620, designation: 620, kind: 'rock', impactIn: 5, dmg: 5, size: 1, speed: 1, mass: 0, revealed: true, identified: true, announced: true, bearing: 0 });
  game.action('weapons', { kind: 'target', id: 620 });
  game.action('weapons', { kind: 'fire' });
  check('cannot fire while tractor latched', game.asteroids.some((a: any) => a.id === 620) && game.charge === 100, `present=${game.asteroids.some((a: any) => a.id === 620)} charge=${game.charge}`);
}

// --- 11. Detection vs identification split: a pod detected at low sensor power
// reads UNKNOWN; a pulse resolves it. ---
{
  const game = freshGame() as any;
  // sensors=1: detection range 12s, ID range 5+3 = 8s. Place a pod at 10s:
  // detected (blip) but NOT identified.
  game.spawnContact('pod', { min: 10, max: 10 }, { min: 0, max: 0 });
  game.tick(0.25);
  const s1 = game.serialize();
  const blip = s1.asteroids.find((a: any) => a.impactIn >= 9);
  check('pod detected but UNKNOWN at low sensor power', !!blip && blip.targetable === true && blip.kind === 'unknown', `blip=${JSON.stringify(blip)}`);
  game.action('engineering', { kind: 'sensorPulse' });
  game.tick(0.25);
  const s2 = game.serialize();
  const idd = s2.asteroids.find((a: any) => a.id === blip.id);
  check('sensor pulse identifies the pod', !!idd && idd.kind === 'pod' && idd.identified === true, `idd=${JSON.stringify(idd)}`);
}

// --- 12. Cargo mass drags maneuverability (P#23): a full hold turns less per nudge ---
{
  const light = freshGame() as any;
  light.throttle = 0;
  const a0 = light.serialize().alignment;
  light.action('helm', { kind: 'nudge', dir: 1 });
  const lightTurn = Math.abs((light.serialize().alignment as number) - a0);

  const heavy = freshGame() as any;
  heavy.throttle = 0;
  for (let i = 0; i < heavy.serialize().holdCapacity; i++) heavy.cargo.push({ id: i + 1, label: 'ORE', kind: 'mineral', mass: 2, value: 2 });
  const b0 = heavy.serialize().alignment;
  heavy.action('helm', { kind: 'nudge', dir: 1 });
  const heavyTurn = Math.abs((heavy.serialize().alignment as number) - b0);
  check('a laden hold reduces turn authority', heavyTurn < lightTurn * 0.8, `light=${lightTurn.toFixed(2)} heavy=${heavyTurn.toFixed(2)}`);
}

// --- 13. Course-hold (P#12) eases a crewed helm back on course; manual steering releases it ---
{
  const game = freshGame() as any;
  game.alignment = 40;
  game.action('helm', { kind: 'hold', on: true });
  tickFor(game, 4);
  const held = Math.abs(game.serialize().alignment as number);
  check('course-hold eases the ship back toward course', held < 40, `|align|=${held.toFixed(1)}`);
  game.action('helm', { kind: 'nudge', dir: 1 });
  check('manual steering disengages course-hold', game.serialize().courseHold === false, 'still held');
}

// --- 14. Shooting a rescue pod is penalized (the don't-shoot invariant) ---
{
  const game = freshGame() as any;
  game.charge = 100;
  game.asteroids.push({ id: 630, designation: 642, kind: 'pod', impactIn: 5, dmg: 0, size: 0.8, speed: 1, mass: 1, revealed: true, identified: true, announced: true, bearing: 0 });
  game.action('weapons', { kind: 'target', id: 630 });
  game.action('weapons', { kind: 'fire' });
  check('firing on a pod removes it and records the shame stat', !game.asteroids.some((a: any) => a.id === 630) && game.podsDestroyed === 1, `podsDestroyed=${game.podsDestroyed}`);
}

// --- 15. Tractor needs WEAPONS power (shared emitter): at 0 weapons power, no
// latch. The tow controls are now the weapons seat's. ---
{
  const game = freshGame() as any;
  // Drop WEAPONS power to 0 so eff('weapons') = 0 < TRACTOR_MIN_POWER.
  game.action('engineering', { kind: 'power', system: 'weapons', delta: -1 });
  game.action('engineering', { kind: 'power', system: 'weapons', delta: -1 });
  game.spawnContact('mineral', { min: 6, max: 6 }, { min: 0, max: 0 });
  game.action('engineering', { kind: 'sensorPulse' }); // identify it
  game.tick(0.25);
  const ore = game.serialize().asteroids.find((a: any) => a.kind === 'mineral');
  game.alignment = ore ? ore.bearing : 0;
  game.action('weapons', { kind: 'tractorTarget', id: ore?.id });
  game.action('weapons', { kind: 'tractorLatch', on: true });
  check('tractor will not latch without power', game.serialize().tractor.latched === false, 'latched with no power');
}

// --- 16. Crew Chief: committed maintenance crew trim a worn system down ---
{
  const game = new Game();
  game.onEvent = () => {};
  for (const s of ['helm', 'engineering', 'weapons', 'crewchief'] as const) {
    game.join(s, `chk-${s}`, `chk-${s}`, 'officer');
  }
  game.start(SANDBOX, 42);
  const g = game as any;
  g.wear.engines = 0.4;
  game.action('crewchief', { kind: 'assignCrew', post: 'maint:engines' });
  tickFor(game, 5);
  check('committed crew trim system wear down', g.wear.engines < 0.4, `after=${g.wear.engines}`);
}

// --- 17. No chief aboard: automated upkeep holds all wear at zero ---
{
  const game = new Game();
  game.onEvent = () => {};
  for (const s of ['helm', 'engineering', 'weapons'] as const) { // crewchief UNMANNED
    game.join(s, `chk-${s}`, `chk-${s}`, 'officer');
  }
  game.start(SANDBOX, 42);
  const g = game as any;
  tickFor(game, 30);
  const maxWear = Math.max(...['engines', 'shields', 'weapons', 'sensors'].map((s) => g.wear[s]));
  check('automated upkeep holds wear at zero with no chief', maxWear === 0, `maxWear=${maxWear}`);
}

// --- 18. Crew Chief: the repair bay restores hull ---
{
  const game = new Game();
  game.onEvent = () => {};
  for (const s of ['helm', 'engineering', 'weapons', 'crewchief'] as const) {
    game.join(s, `chk-${s}`, `chk-${s}`, 'officer');
  }
  game.start(SANDBOX, 42);
  const g = game as any;
  g.hull = 60;
  game.action('crewchief', { kind: 'assignCrew', post: 'repair' });
  tickFor(game, 4);
  check('repair bay restores hull', g.hull > 60, `hull=${g.hull}`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll engine checks passed.');
