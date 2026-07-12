// Salvage Claim (P#23) — a timed salvage run. A debris field is dense with
// mineral chunks and the clock is a hard window: bank as much salvage as you
// can before the claim expires. Every chunk towed aboard adds cargo MASS, so a
// full hold makes the helm sluggish — jettison low-value loads or eat the drag.
// Rival rocks (and a couple of large obstacles to steer around) keep it honest.
// The mission ENDS on the countdown (outcome 'salvaged'); score = value banked.

import { pacingFor, type MissionDef } from '../mission.js';

export const salvageClaim: MissionDef = {
  id: 'salvage-claim',
  name: 'Salvage Claim',
  briefing:
    'The Corasar drifted derelict and the salvage window is open to whoever ' +
    'gets there first. Fill the hold before the claim expires. Watch your ' +
    'maneuverability as the cargo stacks up — and mind the wreckage.',
  arrivalName: 'the claim',
  rating: 'veteran',
  // A slow ship (high targetSeconds) so it never simply "arrives" — the run is
  // defined by the salvage window, not by covering distance.
  ...pacingFor(420),
  destination: { kind: 'planet', color: '#ffb347' },
  kind: 'authored',
  spawnEvery: { min: 12, max: 20 },
  impactIn: { min: 16, max: 24 },
  asteroidDmg: { min: 10, max: 18 },
  maxAsteroids: 3,
  breakerEvery: { min: 40, max: 60 },
  driftScale: 1.05,
  holdCapacity: 6,
  crewTokens: 4,
  // Timed salvage: the readout is a countdown; when it hits zero the mission
  // closes as 'salvaged' with score = cargo value banked.
  readout: { kind: 'countdown', unit: 's', total: 160, label: 'Claim window' },
  salvageGoal: 10,
  events: [
    { id: 'open', at: { time: 1 }, actions: [
      { type: 'log', text: 'Claim window open — 160 seconds. Get the tractor working.' },
      { type: 'spawnContact', kind: 'mineral', count: 2, impactIn: { min: 14, max: 20 } },
    ] },
    { id: 'field-1', at: { time: 25 }, actions: [
      { type: 'debrisField', seconds: 30 },
      { type: 'spawnContact', kind: 'mineral', count: 2, impactIn: { min: 16, max: 22 } },
      { type: 'spawnContact', kind: 'rock', impactIn: { min: 12, max: 16 } },
    ] },
    { id: 'obstacle', at: { time: 55 }, actions: [
      { type: 'log', text: 'Big hull sections tumbling through the lane — steer around them.' },
      { type: 'spawnObstacle', label: 'HULK-1', reachIn: { min: 10, max: 14 }, dmg: 24 },
    ] },
    { id: 'field-2', at: { time: 80 }, actions: [
      { type: 'spawnContact', kind: 'mineral', count: 3, impactIn: { min: 16, max: 24 } },
      { type: 'spawnContact', kind: 'rock', count: 2, impactIn: { min: 12, max: 16 } },
    ] },
    { id: 'obstacle-2', at: { time: 110 }, actions: [
      { type: 'spawnObstacle', label: 'HULK-2', reachIn: { min: 9, max: 13 }, dmg: 26 },
    ] },
    { id: 'closing', at: { time: 140 }, actions: [
      { type: 'log', text: 'Window closing — grab what you can and secure the hold!' },
      { type: 'spawnContact', kind: 'mineral', count: 2, impactIn: { min: 12, max: 18 } },
    ] },
  ],
};
