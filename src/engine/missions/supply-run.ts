// The baseline mission — identical tuning to the original hardcoded
// prototype mission, now expressed as data. Pure ambient pacing, no scripted
// set pieces; this is the calibration reference for all other missions.

import type { MissionDef } from '../mission.js';

export const supplyRun: MissionDef = {
  id: 'supply-run',
  name: 'Supply Run to Station Epsilon',
  briefing:
    'Station Epsilon is low on medical supplies and the relief corridor runs ' +
    'through the edge of an asteroid belt. Get the cargo there in one piece.',
  arrivalName: 'Station Epsilon',
  kind: 'authored',
  parTime: 260,
  spawnEvery: { min: 9, max: 16 },
  impactIn: { min: 14, max: 22 },
  asteroidDmg: { min: 10, max: 20 },
  maxAsteroids: 4,
  breakerEvery: { min: 18, max: 30 },
  driftScale: 1,
  speedScale: 1,
  events: [],
};
