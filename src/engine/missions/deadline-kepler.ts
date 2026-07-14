// Deadline at Kepler (P#21) — the failure-clock showcase, and the successor to
// the old kepler-rescue (same premise, now with a real countdown and rescue
// mechanics). Kepler Station's life support is failing; reach it before the
// clock hits zero. Arrive in time = 'arrived'; run out of time short of the
// dock = 'expired' (a distinct third outcome — the crew did what they could,
// but the window closed). Rescue pods adrift on the route are a bonus if the
// Crew Chief can tow them without costing the crew the deadline.

import { pacingFor, type MissionDef } from '../mission.js';

export const deadlineKepler: MissionDef = {
  id: 'deadline-kepler',
  name: 'Deadline at Kepler',
  briefing:
    "Kepler Station's reactor is scrammed and life support is on batteries. " +
    'You have one window to reach them before it fails. Fly hard, keep the ' +
    'hull together, and pull aboard any survivors adrift on the way — if the ' +
    'clock allows.',
  arrivalName: 'Kepler Station',
  rating: 'hard',
  destination: { kind: 'station', color: '#ff8f6f' },
  kind: 'authored',
  ...pacingFor(135), // a clean run docks with a little to spare on the clock
  spawnEvery: { min: 10, max: 17 },
  impactIn: { min: 16, max: 24 },
  asteroidDmg: { min: 12, max: 20 },
  maxAsteroids: 4,
  breakerEvery: { min: 30, max: 46 },
  driftScale: 1.1,
  holdCapacity: 4,
  crewTokens: 4,
  // Failure clock: 155s to dock. If it hits zero before arrival, 'expired'.
  readout: { kind: 'countdown', unit: 's', total: 155, label: 'Life support' },
  failOnCountdown: true,
  events: [
    { id: 'open', at: { time: 1 }, actions: [
      { type: 'cinematic', title: 'Life support: 2:35', seconds: 6, lines: [
        "Kepler's on batteries. Two and a half minutes of air for a hundred and forty souls.",
        'This is a race. Helm, everything the engines will give you. Weapons, tractor any survivors you can — if we have the seconds.',
      ] },
    ] },
    { id: 'ion', at: { progress: 25 }, actions: [
      { type: 'ionStorm', seconds: 22 },
    ] },
    { id: 'survivors', at: { progress: 40 }, actions: [
      { type: 'log', text: 'Escape pods adrift from an earlier evac — survivors aboard.' },
      { type: 'spawnContact', kind: 'pod', count: 2, impactIn: { min: 16, max: 22 } },
    ] },
    { id: 'cascade', at: { progress: 55 }, actions: [
      { type: 'log', text: 'Debris cloud from the station venting — rocks incoming!' },
      { type: 'spawnAsteroids', count: 3, impactIn: { min: 10, max: 15 }, dmg: { min: 12, max: 18 } },
      { type: 'tripBreaker' },
    ] },
    { id: 'fire', at: { progress: 68 }, actions: [
      { type: 'startEmergency', kind: 'fire', severity: 1 },
    ] },
    { id: 'final', at: { progress: 85 }, actions: [
      { type: 'log', text: 'Kepler in sight — do NOT slow down. Bring her in!' },
    ] },
  ],
};
