// Free Flight — a debug/sandbox range. Nothing spawns on its own: the pilot
// just flies (light drift keeps the helm honest) and the sim-supervisor drops
// contacts, gates, and hazards on demand via the debug spawn dropdown. 180s.
// Launch with debug enabled to expose the spawn controls.

import { pacingFor, type MissionDef } from '../mission.js';

export const freeFlight: MissionDef = {
  id: 'free-flight',
  name: 'Free Flight (debug range)',
  briefing:
    'Debug range: nothing spawns on its own. Fly the ship, then use the ' +
    'sim-debug spawn dropdown to drop rocks, pods, salvage, ghosts, gates, ' +
    'obstacles, fires, boarders, or a solar flare exactly when you want them.',
  arrivalName: 'the test range',
  rating: 'standard',
  destination: { kind: 'planet', color: '#7d8db3' },
  kind: 'authored',
  ...pacingFor(180),
  spawnEvery: { min: 99999, max: 99999 }, // no ambient spawns — everything is manual
  impactIn: { min: 20, max: 26 },         // used by a debug-spawned rock
  asteroidDmg: { min: 10, max: 18 },
  maxAsteroids: 40,                       // headroom for spamming the spawn button
  breakerEvery: { min: 99999, max: 99999 },
  gateEvery: { min: 99999, max: 99999 },
  driftScale: 0.8,                        // a little drift so the helm isn't idle
  holdCapacity: 4,
  crewTokens: 4,
  events: [],
};
