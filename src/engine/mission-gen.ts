// Parameterized procedural mission generator. Given GenParams + a seed it
// deterministically produces a MissionDef: same params + seed = same mission,
// which makes generated missions replayable, shareable, and testable in the
// mission lab exactly like authored ones.

import { mulberry32, pick, int, type Rng } from './rng.js';
import { pacingFor, type MissionDef, type GenParams, type ScriptedEvent } from './mission.js';

// Name tables for generated destinations and mission titles.
const PLACE_TYPES = ['Station', 'Outpost', 'Relay', 'Depot', 'Beacon', 'Platform'];
const PLACE_NAMES = ['Kepler', 'Vesta', 'Cygnus', 'Tycho', 'Halley', 'Oberon', 'Lyra', 'Ceres', 'Draco', 'Miranda', 'Yuen', 'Aldrin'];
const TITLE_TEMPLATES = [
  (dest: string) => `Supply Run to ${dest}`,
  (dest: string) => `Patrol Sweep: ${dest}`,
  (dest: string) => `Priority Transit to ${dest}`,
  (dest: string) => `The Long Haul to ${dest}`,
];
const BRIEFING_TEMPLATES = [
  (dest: string) => `Command wants this cargo at ${dest} yesterday. The route crosses an uncharted debris field — expect trouble and keep talking to each other.`,
  (dest: string) => `${dest} went quiet after the last storm front. Get there, and don't become the second ship they have to send someone after.`,
  (dest: string) => `A routine run to ${dest}, according to the flight plan. The flight plan has been wrong before.`,
];

// Length presets, expressed as the target well-executed duration (seconds).
// speedScale and parTime are derived from these via pacingFor. Ambient hazard
// pacing is deliberately NOT scaled by length, so a longer mission keeps the
// same per-minute intensity and simply runs longer (more total events).
const LENGTHS = {
  short: 180,     // the 3-minute baseline
  standard: 240,  // ~4 minutes
  long: 300,      // ~5 minutes
} as const;

// Linear interpolation helper for intensity scaling.
const lerp = (lo: number, hi: number, t: number) => lo + (hi - lo) * t;

export function generateMission(params: GenParams): MissionDef {
  const rng = mulberry32(params.seed);
  const t = Math.max(0, Math.min(1, params.intensity));
  const pacing = pacingFor(LENGTHS[params.length]);

  const dest = `${pick(rng, PLACE_TYPES)} ${pick(rng, PLACE_NAMES)}`;
  const name = pick(rng, TITLE_TEMPLATES)(dest);
  const briefing = pick(rng, BRIEFING_TEMPLATES)(dest);

  // Hazard pacing scales with intensity: at 0 it's gentler than the baseline
  // mission, at 1 it's meaningfully hotter (but still bot-survivable — see
  // the mission-lab baselines before pushing these outward).
  const spawnMid = lerp(16, 8, t);
  const dmgLo = Math.round(lerp(8, 12, t));
  const dmgHi = Math.round(lerp(14, 22, t));
  const breakerMid = lerp(45, 24, t); // widened +50%: impacts now trip breakers, ambient trips are the exception

  // 2-4 set pieces at spaced-out progress marks, drawn from a small pool.
  const events: ScriptedEvent[] = [];
  const setPieces = int(rng, 2, 4);
  // Progress marks spread across the trip with jitter, avoiding the ends.
  const marks: number[] = [];
  for (let i = 0; i < setPieces; i++) {
    marks.push(Math.round(((i + 1) / (setPieces + 1)) * 80 + int(rng, -6, 6) + 8));
  }
  const pool: ((mark: number, i: number) => ScriptedEvent)[] = [
    (mark, i) => ({
      id: `gen-storm-${i}`,
      at: { progress: mark },
      actions: [
        { type: 'log', text: 'Debris storm ahead — multiple contacts inbound!' },
        { type: 'spawnAsteroids', count: int(rng, 3, 4 + Math.round(t)), impactIn: { min: 12, max: 16 } },
      ],
    }),
    (mark, i) => ({
      id: `gen-calm-${i}`,
      at: { progress: mark },
      actions: [
        { type: 'log', text: 'Clear skies for a stretch. Catch your breath.' },
        { type: 'calm', seconds: int(rng, 15, 30) },
      ],
    }),
    (mark, i) => ({
      id: `gen-cascade-${i}`,
      at: { progress: mark },
      actions: [
        { type: 'log', text: 'Power surge! Breakers tripping across the grid!' },
        { type: 'tripBreaker' },
        { type: 'tripBreaker' },
      ],
    }),
    (mark, i) => ({
      id: `gen-gauntlet-${i}`,
      at: { progress: Math.max(mark, 70) },
      actions: [
        { type: 'log', text: 'The field thickens on final approach...' },
        { type: 'spawnRate', multiplier: lerp(1.3, 1.8, t) },
      ],
    }),
    (mark, i) => ({
      id: `gen-ionstorm-${i}`,
      at: { progress: mark },
      actions: [
        { type: 'log', text: 'Charged particle front rolling across the lane — instruments hazy.' },
        { type: 'ionStorm', seconds: int(rng, 18, 28) },
      ],
    }),
    (mark, i) => ({
      id: `gen-debris-${i}`,
      at: { progress: mark },
      actions: [
        { type: 'log', text: 'Pulverized rock haze ahead — the fast way through costs paint and plating.' },
        { type: 'debrisField', seconds: int(rng, 15, 25) },
      ],
    }),
    // --- New objective set pieces (Crew Chief pass): tow, salvage, obstacle,
    // and a shipboard emergency. They fold the new mechanics into procedural
    // runs so a generated mission can call for the tractor and damage control. ---
    (mark, i) => ({
      id: `gen-rescue-${i}`,
      at: { progress: mark },
      actions: [
        // No pre-announce — the pod is only called out once sensors ID it.
        { type: 'spawnContact', kind: 'pod', impactIn: { min: 16, max: 22 } },
        { type: 'spawnContact', kind: 'ghost' },
      ],
    }),
    (mark, i) => ({
      id: `gen-salvage-${i}`,
      at: { progress: mark },
      actions: [
        { type: 'log', text: 'Mineral chunks drifting in the lane — free salvage if the Crew Chief can grab it.' },
        { type: 'spawnContact', kind: 'mineral', count: int(rng, 1, 2) },
      ],
    }),
    (mark, i) => ({
      id: `gen-obstacle-${i}`,
      at: { progress: mark },
      actions: [
        { type: 'log', text: 'Large derelict tumbling across the lane — steer clear of it.' },
        { type: 'spawnObstacle', reachIn: { min: 10, max: 14 }, dmg: 24 },
      ],
    }),
    (mark, i) => ({
      id: `gen-emergency-${i}`,
      at: { progress: mark },
      actions: [
        { type: 'startEmergency', kind: pick(rng, ['fire', 'boarders'] as const), severity: 1 },
      ],
    }),
  ];
  for (let i = 0; i < setPieces; i++) {
    events.push(pick(rng, pool)(marks[i], i));
  }

  return {
    id: `gen:${params.length}:${params.seed}`,
    name,
    briefing,
    arrivalName: dest,
    kind: 'generated',
    targetSeconds: pacing.targetSeconds,
    parTime: pacing.parTime,
    spawnEvery: { min: spawnMid * 0.75, max: spawnMid * 1.35 },
    impactIn: { min: lerp(20, 18, t), max: lerp(28, 24, t) }, // ambient spawns near the detection edge (~21s at default sensor power)
    asteroidDmg: { min: dmgLo, max: dmgHi },
    maxAsteroids: 4 + Math.round(t * 2),
    breakerEvery: { min: breakerMid * 0.75, max: breakerMid * 1.35 },
    driftScale: lerp(0.8, 1.35, t),
    speedScale: pacing.speedScale,
    events,
  };
}

// Europa Salvage Loop (gen:europa): a distinct procedural TYPE that mixes the
// branch's new content into one 5-minute standard-difficulty run. Every seed
// re-jitters the timing, but the SHAPE is fixed by design:
//   - slipstreams roll in ~every 45s (gateEvery);
//   - NO large steer-around obstacles and NO Crew-Chief emergencies;
//   - the field is single rocks + the odd double-tap, punctuated by 1-2 HEAVY
//     batches of 4-5 rocks fed in ~1.5s apart;
//   - salvage (minerals) drifts by in the quiet stretches, never during a batch;
//   - one slow lifeboat (pod) appears in the thick of a heavy batch;
//   - ghosts sprinkle in at ~1 per 8 rock spawns;
//   - exactly one ion storm, one debris field, and one forward-view blackout;
//   - scoring reports time-to-complete, salvage banked, and remaining hull.
export function generateEuropaSalvageLoop(seed: number): MissionDef {
  const rng = mulberry32(seed);
  const pacing = pacingFor(300); // 5 minutes, well-executed
  const jit = (base: number, j = 4) => Math.max(4, base + int(rng, -j, j));
  const events: ScriptedEvent[] = [];

  // A heavy batch: 4-5 rocks fed in one at a time, ~1.5s apart, arriving as a
  // tight cluster the gunner has to work through.
  const heavyBatch = (id: string, startAt: number) => {
    const n = int(rng, 4, 5);
    for (let k = 0; k < n; k++) {
      events.push({
        id: `${id}-${k}`,
        at: { time: startAt + k * 1.5 },
        actions: [{ type: 'spawnAsteroids', count: 1, impactIn: { min: 14, max: 20 }, dmg: { min: 10, max: 16 } }],
      });
    }
  };
  const doubleTap = (id: string, at: number) => events.push({
    id, at: { time: jit(at) },
    actions: [{ type: 'spawnAsteroids', count: 2, impactIn: { min: 16, max: 24 }, dmg: { min: 9, max: 15 } }],
  });
  const salvage = (id: string, at: number) => events.push({
    id, at: { time: jit(at) },
    actions: [
      { type: 'log', text: 'Salvage drifting in the lane — Weapons, tractor it in when the sky is clear.' },
      { type: 'spawnContact', kind: 'mineral', count: int(rng, 2, 3) },
    ],
  });
  const ghost = (id: string, at: number) => events.push({
    id, at: { time: jit(at) }, actions: [{ type: 'spawnContact', kind: 'ghost' }],
  });

  // --- The scripted timeline (base times; jit() spreads them per seed). ---
  events.push({ id: 'europa-start', at: { time: 1 }, actions: [{ type: 'log', text: 'On the Europa salvage loop. Clear the lane, grab what drifts by, bring it home in one piece.' }] });
  doubleTap('europa-dt-1', 25);
  salvage('europa-salv-1', 45);
  // More salvage across the quiet stretches (a salvage-heavy loop).
  salvage('europa-salv-4', 105);
  salvage('europa-salv-5', 200);
  salvage('europa-salv-6', 288);
  ghost('europa-ghost-1', 66);
  // A sensor-spoof swarm: phantom contacts flood the scope among the real rocks,
  // so Weapons must verify before spending a shot (sensor ID/pulse resolves them).
  events.push({ id: 'europa-ghostswarm', at: { time: jit(52, 5) }, actions: [
    { type: 'log', text: 'Sensor grid is ghosting — phantom returns all over the scope. Weapons, confirm a contact before you spend a shot on it.' },
    { type: 'ghostSwarm', seconds: int(rng, 22, 28) },
  ] });

  // Heavy batch #1 with the slow lifeboat in the middle of it.
  const batch1 = jit(90, 6);
  events.push({ id: 'europa-batch1-call', at: { time: batch1 - 2 }, actions: [{ type: 'log', text: 'Cluster inbound — multiple contacts, stand by to work the field!' }] });
  heavyBatch('europa-batch1', batch1);
  events.push({
    id: 'europa-lifeboat', at: { time: batch1 + 3 },
    actions: [
      // No pre-announce: the pod spawns as an unresolved contact — the captain
      // must spot the silhouette and sensors must ID it before it's called out
      // as a rescue pod (the engine fires that toast at ID range).
      { type: 'spawnContact', kind: 'pod', impactIn: { min: 30, max: 38 } }, // slow drift: plenty of time to tow
    ],
  });

  events.push({ id: 'europa-ion', at: { time: jit(122, 5) }, actions: [{ type: 'log', text: 'Charged particle front across the lane — sensors hazing. More sensor power or a pulse cuts through.' }, { type: 'ionStorm', seconds: int(rng, 18, 24) }] });
  doubleTap('europa-dt-2', 145);
  salvage('europa-salv-2', 158);
  ghost('europa-ghost-2', 172);
  events.push({ id: 'europa-debris', at: { time: jit(186, 5) }, actions: [{ type: 'log', text: 'Pulverized rock haze ahead — ease the throttle through it or it scours the hull.' }, { type: 'debrisField', seconds: int(rng, 16, 22) }] });

  // Heavy batch #2.
  const batch2 = jit(214, 6);
  events.push({ id: 'europa-batch2-call', at: { time: batch2 - 2 }, actions: [{ type: 'log', text: 'Second cluster inbound — here we go again!' }] });
  heavyBatch('europa-batch2', batch2);
  ghost('europa-ghost-3', 232);

  // A blackout: fly on sensors for a stretch, then the view returns.
  const blackoutAt = jit(240, 5);
  events.push({ id: 'europa-blackout-on', at: { time: blackoutAt }, actions: [{ type: 'log', text: 'Forward view lost — fly on the scope until it clears.' }, { type: 'setViewImpaired', on: true }] });
  events.push({ id: 'europa-blackout-off', at: { time: blackoutAt + int(rng, 14, 18) }, actions: [{ type: 'setViewImpaired', on: false }] });
  salvage('europa-salv-3', 262);
  ghost('europa-ghost-4', 275);

  return {
    id: `gen:europa:${seed}`,
    name: 'Europa Salvage Loop',
    briefing: 'A standing salvage run along the Europa lane: clear the rocks, tractor in what drifts by, and answer the odd distress beacon. Five minutes, no heroics — just bring the haul home intact.',
    arrivalName: 'Europa Relay',
    rating: 'standard',
    destination: { kind: 'station', color: '#7fd4ff' },
    kind: 'generated',
    targetSeconds: pacing.targetSeconds,
    parTime: pacing.parTime,
    // Steady single-rock cadence; heavy batches come from the scripted beats.
    spawnEvery: { min: 9, max: 15 },
    impactIn: { min: 18, max: 26 }, // near the detection edge at default sensor power
    asteroidDmg: { min: 9, max: 15 },
    maxAsteroids: 4,
    breakerEvery: { min: 30, max: 45 },
    gateEvery: { min: 40, max: 50 }, // ~1 slipstream / 45s
    driftScale: 1.0,
    speedScale: pacing.speedScale,
    holdCapacity: 6,
    salvageGoal: 8,
    scoreModel: 'salvage', // debrief reports time / salvage / hull
    events,
  };
}
