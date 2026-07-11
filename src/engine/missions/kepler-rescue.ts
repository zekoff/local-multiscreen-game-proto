// A short, hot mission: high pace from the first minute, an engineering
// crisis at the midpoint, and a tight par time. Designed to stress the
// engineering and weapons stations and reward decisive power calls.

import { pacingFor, type MissionDef } from '../mission.js';

export const keplerRescue: MissionDef = {
  id: 'kepler-rescue',
  name: 'Rescue at Kepler Post',
  briefing:
    'Research Post Kepler broke apart in a rockslide swarm and their escape ' +
    'pod life support is failing. Burn hard, take the hits, get there fast.',
  arrivalName: 'Kepler Post',
  kind: 'authored',
  ...pacingFor(150),                       // short, hot dash — arrive fast if you keep the engines fed
  spawnEvery: { min: 7, max: 12 },
  impactIn: { min: 18, max: 24 }, // ambient rocks spawn beyond max sensor range (16s): seen dim on screen before sensors resolve them
  asteroidDmg: { min: 8, max: 16 },
  maxAsteroids: 5,
  breakerEvery: { min: 21, max: 36 }, // widened +50%: impacts now trip breakers, ambient trips are the exception
  driftScale: 1.2,                         // debris wake keeps shoving you off course
  events: [
    {
      id: 'distress-call',
      at: { time: 5 },
      actions: [
        { type: 'log', text: 'Kepler Post: "...pod air at 20%... please hurry..."' },
      ],
    },
    {
      id: 'ion-front',
      at: { progress: 30 },
      actions: [
        { type: 'log', text: 'The storm that broke Kepler Post is still radiating — ion front dead ahead.' },
        { type: 'ionStorm', seconds: 25 },
      ],
    },
    {
      id: 'midpoint-cascade',
      at: { progress: 50 },
      actions: [
        { type: 'log', text: 'Debris strike aft! Electrical cascade across the grid!' },
        { type: 'tripBreaker', system: 'engines' },
        { type: 'tripBreaker', system: 'weapons' },
        { type: 'spawnAsteroids', count: 3, impactIn: { min: 12, max: 16 }, dmg: { min: 10, max: 16 } },
      ],
    },
    {
      id: 'rockslide-swarm',
      at: { progress: 72 },
      actions: [
        { type: 'log', text: 'The rockslide that hit Kepler is still spreading — swarm inbound!' },
        { type: 'spawnAsteroids', count: 3, impactIn: { min: 12, max: 16 }, dmg: { min: 8, max: 14 } },
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
