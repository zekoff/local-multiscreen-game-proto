// A short, hot mission: high pace from the first minute, an engineering
// crisis at the midpoint, and a tight par time. Designed to stress the
// engineering and weapons stations and reward decisive power calls.

import type { MissionDef } from '../mission.js';

export const keplerRescue: MissionDef = {
  id: 'kepler-rescue',
  name: 'Rescue at Kepler Post',
  briefing:
    'Research Post Kepler broke apart in a rockslide swarm and their escape ' +
    'pod life support is failing. Burn hard, take the hits, get there fast.',
  arrivalName: 'Kepler Post',
  kind: 'authored',
  parTime: 170,
  spawnEvery: { min: 7, max: 12 },
  impactIn: { min: 12, max: 18 },
  asteroidDmg: { min: 8, max: 16 },
  maxAsteroids: 5,
  breakerEvery: { min: 14, max: 24 },
  driftScale: 1.2,                         // debris wake keeps shoving you off course
  speedScale: 1.25,                        // short trip, if you keep the engines fed
  events: [
    {
      id: 'distress-call',
      at: { time: 5 },
      actions: [
        { type: 'log', text: 'Kepler Post: "...pod air at 20%... please hurry..."' },
      ],
    },
    {
      id: 'midpoint-cascade',
      at: { progress: 50 },
      actions: [
        { type: 'log', text: 'Debris strike aft! Electrical cascade across the grid!' },
        { type: 'tripBreaker', system: 'engines' },
        { type: 'tripBreaker', system: 'weapons' },
      ],
    },
    {
      id: 'arrival-visual',
      at: { progress: 90 },
      actions: [
        { type: 'log', text: 'Visual on the escape pod. Almost there.' },
      ],
    },
  ],
};
