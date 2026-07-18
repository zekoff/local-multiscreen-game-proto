// Mission registry: the single place transports resolve a mission start
// request into a MissionDef. Also produces the catalog the lobby shows players.
//
// The selectable set is intentionally small: Europa Salvage Loop (the default —
// a fixed-shape procedural salvage/rescue run), the Shakedown Cruise (the
// authored intro mission), and Free Flight (the debug/sandbox range). Other
// authored missions and the generic gen:* presets were retired.

import type { MissionDef, CatalogEntry } from './mission.js';
import { generateEuropaSalvageLoop } from './mission-gen.js';
import { randomSeed } from './rng.js';
import { firstFlight } from './missions/first-flight.js';
import { freeFlight } from './missions/free-flight.js';

const AUTHORED: MissionDef[] = [
  firstFlight, // "Shakedown Cruise" — the intro mission a new crew should see
  freeFlight,  // debug/sandbox range (no ambient spawns) — launch with debug on
];

// Special generated mission with a dedicated generator (not a static def).
// Europa Salvage Loop is a fixed-shape procedural TYPE (see mission-gen).
const EUROPA_ID = 'gen:europa';

// Europa is the default: used when no mission id is given (and by the smoke
// tests). The lobby also lists it first, so the picker defaults to it.
export const DEFAULT_MISSION_ID = EUROPA_ID;

// What the lobby lists. Sent to clients in the 'joined' message.
export function missionCatalog(): CatalogEntry[] {
  return [
    { id: EUROPA_ID, name: 'Europa Salvage Loop', description: 'A 5-minute salvage run: clear rocks, tractor in drifting salvage, answer a distress beacon. New timing every run.', kind: 'generated' as const, rating: 'standard' },
    ...AUTHORED.map((m) => ({ id: m.id, name: m.name, description: m.briefing, kind: m.kind, rating: m.rating ?? 'standard' })),
  ];
}

// Resolve a start request. Unknown/missing ids fall back to the default mission
// (Europa) rather than erroring — a stale client can always launch something.
// `seed` fixes the run's randomness (tests, replays); omitted = fresh seed.
export function resolveMissionStart(missionId?: string, seed?: number): { def: MissionDef; seed: number } {
  const runSeed = seed ?? randomSeed();
  const authored = missionId ? AUTHORED.find((m) => m.id === missionId) : undefined;
  if (authored) return { def: authored, seed: runSeed };
  // Europa (explicit) OR anything unknown/missing → the default Europa loop.
  return { def: generateEuropaSalvageLoop(runSeed), seed: runSeed };
}
