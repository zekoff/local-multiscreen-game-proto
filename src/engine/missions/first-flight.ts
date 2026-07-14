// First Flight: the introductory mission. A gentle, scripted opening (one
// asteroid at t=20, one nav ring at t=40) hands each station its core loop
// one beat at a time, then ambient spawning takes over with a difficulty ramp
// that CAPS BELOW the standard missions: the concurrent-asteroid ceiling
// climbs 1 -> 2 -> 3 via setMaxAsteroids events, and 3-at-once is only
// possible in the final third. Damage, drift, and trip rates all sit well
// under supply-run's baseline.

import { pacingFor, type MissionDef } from '../mission.js';

export const firstFlight: MissionDef = {
  id: 'first-flight',
  name: 'First Flight: Shakedown Cruise',
  briefing:
    'Fresh out of the yard and fresh out of the academy — this crew has never ' +
    'flown together. Run the shakedown lane to Meridian Relay, learn your ' +
    'consoles, and bring her home without scratching the paint.',
  arrivalName: 'Meridian Relay',
  rating: 'training',
  destination: { kind: 'station', color: '#9fe8b8' }, // grows on the viewscreen approach
  kind: 'authored',
  ...pacingFor(150), // short: a first crew should taste the whole loop quickly
  spawnEvery: { min: 18, max: 28 },  // sparse ambient traffic, one thing at a time
  impactIn: { min: 18, max: 26 },    // ambient rocks spawn near the detection edge (~21s at the default 2 sensor power)
  asteroidDmg: { min: 6, max: 12 },  // training rocks: they sting, they don't maul
  maxAsteroids: 3,                   // absolute ceiling; the ramp below climbs up to it
  breakerEvery: { min: 40, max: 60 },// ambient trips are rare — impacts teach that lesson
  gateEvery: { min: 35, max: 50 },   // rings stay occasional after the scripted first one
  driftScale: 0.6,                   // gentle course pressure for a learning helm
  events: [
    {
      id: 'departure',
      at: { time: 0 },
      actions: [
        // Quiet first stretch: nothing ambient until the scripted beats land.
        { type: 'calm', seconds: 55 },
        { type: 'setMaxAsteroids', value: 1 },
        { type: 'log', text: 'Dock clamps released. Easy out of the yard — throttle up when ready, helm.' },
      ],
    },
    {
      id: 'first-rock',
      at: { time: 20 },
      actions: [
        { type: 'log', text: 'Traffic control flags a stray rock drifting into the lane. Sensors, weapons — your show.' },
        { type: 'spawnAsteroids', count: 1, impactIn: { min: 20, max: 20 }, dmg: { min: 6, max: 9 } },
      ],
    },
    {
      id: 'first-ring',
      at: { time: 40 },
      actions: [
        { type: 'log', text: 'A slipstream ring is open off our bow. Ease the throttle and swing onto the approach, helm.' },
        { type: 'spawnGate' },
      ],
    },
    {
      id: 'ramp-two',
      at: { progress: 40 },
      actions: [
        { type: 'log', text: 'Leaving the patrolled lane. Expect real traffic from here.' },
        { type: 'setMaxAsteroids', value: 2 },
      ],
    },
    {
      id: 'ramp-three',
      at: { progress: 66 },
      actions: [
        // Final third: the only stretch where 3 rocks can share the sky.
        { type: 'log', text: 'Last leg to Meridian — the lane gets busy near the relay. Stay coordinated.' },
        { type: 'setMaxAsteroids', value: 3 },
        { type: 'spawnRate', multiplier: 1.15 },
      ],
    },
    {
      id: 'arrival-visual',
      at: { progress: 90 },
      actions: [
        { type: 'log', text: 'Meridian Relay on visual. Not bad for a first run.' },
      ],
    },
  ],
};
