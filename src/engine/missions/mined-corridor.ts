// A slower, wave-structured mission: sparse ambient hazards punctuated by
// scripted mine clusters, a deceptive calm stretch, and a dense final
// approach. Shows off the scripted-event system — the tension comes from
// authored set pieces, not ambient pressure.

import type { MissionDef } from '../mission.js';

export const minedCorridor: MissionDef = {
  id: 'mined-corridor',
  name: 'The Mined Corridor',
  briefing:
    'The direct route to Depot Tycho was seeded with proximity mines during ' +
    'the blockade. Sweepers cleared a lane — mostly. Fly it slow and stay sharp.',
  arrivalName: 'Depot Tycho',
  kind: 'authored',
  parTime: 320,
  spawnEvery: { min: 14, max: 22 },       // quiet between the waves
  impactIn: { min: 14, max: 22 },
  asteroidDmg: { min: 8, max: 14 },       // mines are numerous but small
  maxAsteroids: 6,                        // waves need headroom over ambient
  breakerEvery: { min: 20, max: 32 },
  driftScale: 1,
  speedScale: 0.85,                        // longer trip than the baseline
  events: [
    {
      id: 'first-field',
      at: { progress: 18 },
      actions: [
        { type: 'log', text: 'Sensors: mine cluster ahead — brace!' },
        { type: 'spawnAsteroids', count: 3, impactIn: { min: 10, max: 15 }, dmg: { min: 8, max: 12 } },
      ],
    },
    {
      id: 'false-calm',
      at: { progress: 42 },
      actions: [
        { type: 'log', text: 'The lane opens up. Too quiet.' },
        { type: 'calm', seconds: 25 },
      ],
    },
    {
      id: 'second-field',
      at: { progress: 58 },
      actions: [
        { type: 'log', text: 'Contact! Drifting mines, all quadrants!' },
        { type: 'spawnAsteroids', count: 4, impactIn: { min: 10, max: 16 }, dmg: { min: 8, max: 14 } },
        { type: 'tripBreaker' },
      ],
    },
    {
      id: 'final-gauntlet',
      at: { progress: 78 },
      actions: [
        { type: 'log', text: 'Final approach to Tycho — the sweepers never got this far.' },
        { type: 'spawnRate', multiplier: 1.7 },
      ],
    },
  ],
};
