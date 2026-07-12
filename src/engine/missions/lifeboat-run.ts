// The Lifeboat Run (P#24) — the flagship mission for the Crew Chief pass. A
// convoy broke up in a debris field, scattering rescue pods among wreckage and
// sensor ghosts that all read identical at low sensor power. The crew must
// DETECT contacts (sensors), CONFIRM which are pods (the captain's eyes on the
// viewscreen OR engineering buying sensor margin / a pulse), TOW them aboard
// (tractor + a steady helm), and — above all — NEVER fire on a pod. The full
// don't-shoot + tractor showcase. Neutral framing (works scrappy OR flagship).

import { pacingFor, type MissionDef } from '../mission.js';

export const lifeboatRun: MissionDef = {
  id: 'lifeboat-run',
  name: 'The Lifeboat Run',
  briefing:
    'The transport Meridian broke apart in a debris field and her lifeboats ' +
    'scattered among the wreckage. Find the pods, confirm every contact before ' +
    'you fire, and bring the survivors aboard. Do not shoot a pod.',
  arrivalName: 'the rally point',
  rating: 'veteran',
  destination: { kind: 'station', color: '#7ddb9a' },
  kind: 'authored',
  ...pacingFor(230),
  // Rocks are rarer here — the danger is mis-identification, not volume.
  spawnEvery: { min: 16, max: 26 },
  impactIn: { min: 18, max: 26 },
  asteroidDmg: { min: 10, max: 18 },
  maxAsteroids: 3,
  breakerEvery: { min: 40, max: 60 },
  driftScale: 1,
  holdCapacity: 5,
  crewTokens: 4,
  events: [
    {
      id: 'intro',
      at: { time: 1 },
      actions: [
        { type: 'cinematic', title: 'Distress field ahead', seconds: 7, lines: [
          'The Meridian\'s wreckage tumbles across your path — and somewhere in it, her lifeboats.',
          'Sensors will show contacts, but at range a pod looks just like a rock or a sensor ghost.',
          'Crew Chief on the tractor, Weapons hold fire until a contact is CONFIRMED. Bring them home.',
        ] },
      ],
    },
    // First scattering: a pod, a chunk of salvage, and a decoy ghost, plus a
    // real rock so the crew can't just tow everything blind.
    { id: 'scatter-1', at: { progress: 18 }, actions: [
      { type: 'log', text: 'Contacts in the wreckage — confirm before you fire.' },
      { type: 'spawnContact', kind: 'pod', impactIn: { min: 16, max: 20 } },
      { type: 'spawnContact', kind: 'ghost' },
      { type: 'spawnContact', kind: 'mineral' },
      { type: 'spawnContact', kind: 'rock', impactIn: { min: 14, max: 18 } },
    ] },
    { id: 'debris', at: { progress: 30 }, actions: [
      { type: 'log', text: 'Into the debris proper — ease the throttle or the hull scours.' },
      { type: 'debrisField', seconds: 22 },
    ] },
    { id: 'scatter-2', at: { progress: 45 }, actions: [
      { type: 'spawnContact', kind: 'pod', count: 2, impactIn: { min: 18, max: 24 } },
      { type: 'spawnContact', kind: 'ghost' },
      { type: 'spawnContact', kind: 'rock', impactIn: { min: 12, max: 16 } },
    ] },
    // A hull spark starts a small fire — the Crew Chief has to split attention.
    { id: 'fire', at: { progress: 58 }, actions: [
      { type: 'startEmergency', kind: 'fire', severity: 1 },
    ] },
    { id: 'scatter-3', at: { progress: 70 }, actions: [
      { type: 'spawnContact', kind: 'pod', impactIn: { min: 16, max: 20 } },
      { type: 'spawnContact', kind: 'mineral' },
      { type: 'spawnContact', kind: 'rock', count: 2, impactIn: { min: 12, max: 16 } },
    ] },
    { id: 'arrival', at: { progress: 90 }, actions: [
      { type: 'log', text: 'Rally point ahead. Every pod aboard is a life saved — good crew.' },
    ] },
  ],
};
