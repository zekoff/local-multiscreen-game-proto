// Blackout Approach (P#18) — the sensors-only mission. The final third of the
// run crosses a charged nebula that blinds the forward view: the main screen
// goes dark and the crew must fly on the weapons scope and engineering's sensor
// readouts alone. A solar flare mid-crossing forces a safe-posture call
// (shields down, hold fire) or it surges the systems. The whole crew plays
// against instinct — this is Emma Cate's "can't see out the window, track with
// sensors" made real.

import { pacingFor, type MissionDef } from '../mission.js';

export const blackoutApproach: MissionDef = {
  id: 'blackout-approach',
  name: 'Blackout Approach',
  briefing:
    'The approach to Harlow runs through a charged nebula that blinds forward ' +
    'optics. You will fly the last stretch on sensors alone. Keep the scope ' +
    'clear, mind the flare, and trust your instruments.',
  arrivalName: 'Harlow Depot',
  rating: 'hard',
  destination: { kind: 'station', color: '#8fd6ff' },
  kind: 'authored',
  ...pacingFor(190),
  spawnEvery: { min: 10, max: 17 },
  impactIn: { min: 16, max: 24 },
  asteroidDmg: { min: 12, max: 20 },
  maxAsteroids: 4,
  breakerEvery: { min: 30, max: 46 },
  driftScale: 1.05,
  holdCapacity: 4,
  crewTokens: 4,
  events: [
    { id: 'open', at: { progress: 10 }, actions: [
      { type: 'log', text: 'Nebula boundary ahead — optics will fail on the far side. Warm up the sensors.' },
    ] },
    // Enter the blackout for the final third: forward view lost, fly on sensors.
    { id: 'blackout', at: { progress: 62 }, actions: [
      { type: 'cinematic', title: 'Into the dark', seconds: 5, lines: [
        'The viewscreen whites out, then goes black. You are blind up here now.',
        'Weapons, Engineering — the scope is your eyes. Captain, call what the instruments call.',
      ] },
      { type: 'setViewImpaired', on: true },
      { type: 'ionStorm', seconds: 60 },
    ] },
    { id: 'flare', at: { progress: 72 }, actions: [
      { type: 'log', text: 'Flare wash building in the nebula — brace for a surge.' },
      { type: 'solarFlare', inSeconds: 12 },
    ] },
    { id: 'swarm', at: { progress: 80 }, actions: [
      { type: 'spawnAsteroids', count: 3, impactIn: { min: 10, max: 15 }, dmg: { min: 12, max: 18 } },
    ] },
    { id: 'clear', at: { progress: 94 }, actions: [
      { type: 'log', text: 'Breaking clear of the nebula — optics returning. Harlow dead ahead.' },
      { type: 'setViewImpaired', on: false },
    ] },
  ],
};
