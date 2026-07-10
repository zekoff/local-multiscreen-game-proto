// Mission registry: the single place transports resolve a mission start
// request into a MissionDef. Authored missions register here; generated
// missions resolve through preset GenParams. Also produces the catalog the
// lobby shows players.

import type { MissionDef, CatalogEntry, GenParams } from './mission.js';
import { generateMission } from './mission-gen.js';
import { randomSeed } from './rng.js';
import { supplyRun } from './missions/supply-run.js';
import { minedCorridor } from './missions/mined-corridor.js';
import { keplerRescue } from './missions/kepler-rescue.js';

const AUTHORED: MissionDef[] = [supplyRun, minedCorridor, keplerRescue];

// Generator presets exposed in the lobby. Intensity is fixed per preset for
// now; a fuller mission-setup UI can expose GenParams directly later.
const GEN_PRESETS: Record<string, { name: string; description: string; params: Omit<GenParams, 'seed'> }> = {
  'gen:short': {
    name: 'Generated: Short Hop',
    description: 'A quick generated run (~3 min). New route every time.',
    params: { length: 'short', intensity: 0.5 },
  },
  'gen:standard': {
    name: 'Generated: Standard Run',
    description: 'A full-length generated mission (~5 min).',
    params: { length: 'standard', intensity: 0.55 },
  },
  'gen:long': {
    name: 'Generated: Deep Haul',
    description: 'A long, grinding generated voyage (~7 min).',
    params: { length: 'long', intensity: 0.6 },
  },
};

export const DEFAULT_MISSION_ID = supplyRun.id;

// What the lobby lists. Sent to clients in the 'joined' message.
export function missionCatalog(): CatalogEntry[] {
  return [
    ...AUTHORED.map((m) => ({ id: m.id, name: m.name, description: m.briefing, kind: m.kind })),
    ...Object.entries(GEN_PRESETS).map(([id, p]) => ({ id, name: p.name, description: p.description, kind: 'generated' as const })),
  ];
}

// Resolve a start request. Unknown/missing ids fall back to the default
// mission rather than erroring — a stale client can always launch something.
// `seed` fixes the run's randomness (tests, replays); omitted = fresh seed.
export function resolveMissionStart(missionId?: string, seed?: number): { def: MissionDef; seed: number } {
  const runSeed = seed ?? randomSeed();
  const preset = missionId ? GEN_PRESETS[missionId] : undefined;
  if (preset) {
    return { def: generateMission({ ...preset.params, seed: runSeed }), seed: runSeed };
  }
  const authored = AUTHORED.find((m) => m.id === missionId);
  return { def: authored ?? supplyRun, seed: runSeed };
}
