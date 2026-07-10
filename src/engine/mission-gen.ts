// Parameterized procedural mission generator. Given GenParams + a seed it
// deterministically produces a MissionDef: same params + seed = same mission,
// which makes generated missions replayable, shareable, and testable in the
// mission lab exactly like authored ones.

import { mulberry32, pick, int, type Rng } from './rng.js';
import type { MissionDef, GenParams, ScriptedEvent } from './mission.js';

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

// Length presets: progress is always 0..100, so trip duration is shaped by
// the speed scale, with par time matched to it.
const LENGTHS = {
  short: { parTime: 180, speedScale: 1.3 },
  standard: { parTime: 260, speedScale: 1.0 },
  long: { parTime: 370, speedScale: 0.72 },
} as const;

// Linear interpolation helper for intensity scaling.
const lerp = (lo: number, hi: number, t: number) => lo + (hi - lo) * t;

export function generateMission(params: GenParams): MissionDef {
  const rng = mulberry32(params.seed);
  const t = Math.max(0, Math.min(1, params.intensity));
  const len = LENGTHS[params.length];

  const dest = `${pick(rng, PLACE_TYPES)} ${pick(rng, PLACE_NAMES)}`;
  const name = pick(rng, TITLE_TEMPLATES)(dest);
  const briefing = pick(rng, BRIEFING_TEMPLATES)(dest);

  // Hazard pacing scales with intensity: at 0 it's gentler than the baseline
  // mission, at 1 it's meaningfully hotter (but still bot-survivable — see
  // the mission-lab baselines before pushing these outward).
  const spawnMid = lerp(16, 8, t);
  const dmgLo = Math.round(lerp(8, 12, t));
  const dmgHi = Math.round(lerp(14, 22, t));
  const breakerMid = lerp(30, 16, t);

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
        { type: 'spawnAsteroids', count: int(rng, 2, 3 + Math.round(t)), impactIn: { min: 10, max: 16 } },
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
    parTime: len.parTime,
    spawnEvery: { min: spawnMid * 0.75, max: spawnMid * 1.35 },
    impactIn: { min: lerp(16, 12, t), max: lerp(24, 18, t) },
    asteroidDmg: { min: dmgLo, max: dmgHi },
    maxAsteroids: 4 + Math.round(t * 2),
    breakerEvery: { min: breakerMid * 0.75, max: breakerMid * 1.35 },
    driftScale: lerp(0.8, 1.35, t),
    speedScale: len.speedScale,
    events,
  };
}
