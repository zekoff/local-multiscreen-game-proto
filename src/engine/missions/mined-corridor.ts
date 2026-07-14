// A slower, wave-structured mission: sparse ambient hazards punctuated by
// scripted mine clusters, a deceptive calm stretch, and a dense final
// approach. Shows off the scripted-event system — the tension comes from
// authored set pieces, not ambient pressure.

import { pacingFor, type MissionDef } from '../mission.js';

export const minedCorridor: MissionDef = {
  id: 'mined-corridor',
  name: 'The Mined Corridor',
  briefing:
    'The direct route to Depot Tycho was seeded with proximity mines during ' +
    'the blockade. Sweepers cleared a lane — mostly. Fly it slow and stay sharp.',
  arrivalName: 'Depot Tycho',
  rating: 'veteran',
  kind: 'authored',
  ...pacingFor(260),                       // a longer, wave-structured haul
  spawnEvery: { min: 14, max: 22 },       // quiet between the waves
  impactIn: { min: 18, max: 26 }, // ambient rocks spawn near the detection edge (~21s at the default 2 sensor power): a low-sensor crew sees dim dots before sensors resolve them
  asteroidDmg: { min: 8, max: 14 },       // mines are numerous but small
  maxAsteroids: 6,                        // waves need headroom over ambient
  breakerEvery: { min: 30, max: 48 }, // widened +50%: impacts now trip breakers, ambient trips are the exception
  driftScale: 1,
  events: [
    {
      id: 'first-field',
      at: { progress: 18 },
      actions: [
        { type: 'log', text: 'Sensors: mine cluster ahead — brace!' },
        { type: 'spawnAsteroids', count: 4, impactIn: { min: 12, max: 16 }, dmg: { min: 8, max: 12 } },
      ],
    },
    {
      id: 'grinder-wake',
      at: { progress: 30 },
      actions: [
        { type: 'log', text: 'The sweepers ground the mines they caught to dust. The dust is still here.' },
        { type: 'debrisField', seconds: 22 },
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
        { type: 'spawnAsteroids', count: 6, impactIn: { min: 12, max: 16 }, dmg: { min: 8, max: 14 } },
        { type: 'tripBreaker' },
      ],
    },
    {
      id: 'arrival-visual',
      at: { progress: 92 },
      actions: [
        { type: 'log', text: "Depot Tycho's lights through the debris. The dockmaster owes this crew a drink." },
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
