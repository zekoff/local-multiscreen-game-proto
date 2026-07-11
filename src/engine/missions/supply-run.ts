// The baseline mission — identical ambient tuning to the original hardcoded
// prototype mission, now expressed as data, plus two scripted belt-crossing
// bursts (added during the 2026-07 balance pass — ambient pacing alone let
// an unmanned ship clear this mission untouched).

import { pacingFor, type MissionDef } from '../mission.js';

export const supplyRun: MissionDef = {
  id: 'supply-run',
  name: 'Supply Run to Station Epsilon',
  briefing:
    'Station Epsilon is low on medical supplies and the relief corridor runs ' +
    'through the edge of an asteroid belt. Get the cargo there in one piece.',
  arrivalName: 'Station Epsilon',
  destination: { kind: 'station', color: '#8fd6ff' }, // grows on the viewscreen approach
  kind: 'authored',
  ...pacingFor(180), // the 3-minute baseline: targetSeconds + derived speedScale/parTime
  spawnEvery: { min: 9, max: 16 },
  impactIn: { min: 14, max: 22 },
  asteroidDmg: { min: 10, max: 20 },
  maxAsteroids: 4,
  breakerEvery: { min: 18, max: 30 },
  driftScale: 1,
  events: [
    {
      id: 'belt-cluster',
      at: { progress: 35 },
      actions: [
        { type: 'log', text: 'The belt narrows here — cluster of rocks dead ahead!' },
        { type: 'spawnAsteroids', count: 3, impactIn: { min: 8, max: 13 }, dmg: { min: 10, max: 16 } },
      ],
    },
    {
      id: 'final-scatter',
      at: { progress: 75 },
      actions: [
        { type: 'log', text: 'Scatter field on final approach to Epsilon — stay sharp.' },
        { type: 'spawnAsteroids', count: 3, impactIn: { min: 8, max: 13 }, dmg: { min: 10, max: 16 } },
      ],
    },
  ],
};
