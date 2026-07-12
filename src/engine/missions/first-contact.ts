// First Contact (P#27) — a thematics-amplified mission (dialogue over
// mechanics). An unknown formation approaches: sensor ghosts, a lone craft that
// reads like a rescue pod (an envoy), and one genuine threat, all mixed. The
// crew has ONE pulse and one chance to NOT start a war — read the scene, hold
// fire on the envoy, and only engage the real hostile. Short, tense, almost a
// puzzle. Leans hard on the cinematic freeze + the don't-shoot identification.

import { pacingFor, type MissionDef } from '../mission.js';

export const firstContact: MissionDef = {
  id: 'first-contact',
  name: 'First Contact',
  briefing:
    'An unknown formation has crossed into the Verge and is closing on your ' +
    'position. Command wants answers, not a war. Read the contacts, hold your ' +
    'fire, and do not shoot first unless you are certain.',
  arrivalName: 'the Verge boundary',
  rating: 'veteran',
  destination: { kind: 'planet', color: '#b58cff' },
  kind: 'authored',
  ...pacingFor(140),
  spawnEvery: { min: 30, max: 40 }, // almost no ambient — the set pieces ARE the mission
  impactIn: { min: 20, max: 26 },
  asteroidDmg: { min: 12, max: 20 },
  maxAsteroids: 2,
  breakerEvery: { min: 60, max: 90 },
  driftScale: 0.9,
  holdCapacity: 3,
  crewTokens: 4,
  events: [
    { id: 'open', at: { time: 1 }, actions: [
      { type: 'cinematic', title: 'Contact', seconds: 7, lines: [
        'Three returns bloom on the long-range scope, holding formation. No transponder. No hail.',
        'Command\'s order is one line: do not fire first.',
        'Engineering — you have ONE sensor pulse. Spend it when it counts.',
      ] },
    ] },
    // The formation resolves into ghosts, an envoy (reads as a pod), and one
    // real hostile. At low sensor power they're indistinguishable.
    { id: 'formation', at: { progress: 25 }, actions: [
      { type: 'log', text: 'The formation breaks toward you — designations unconfirmed.' },
      { type: 'spawnContact', kind: 'ghost' },
      { type: 'spawnContact', kind: 'pod', impactIn: { min: 20, max: 24 } },
      { type: 'spawnContact', kind: 'ghost' },
      { type: 'spawnContact', kind: 'rock', impactIn: { min: 22, max: 26 } },
    ] },
    { id: 'envoy-beat', at: { progress: 45 }, actions: [
      { type: 'cinematic', title: 'A craft, not a rock', seconds: 6, lines: [
        'One contact is running lights in a pattern — an envoy, unarmed, coming to talk.',
        'The others read wrong. One of them is charging something.',
        'Confirm before anyone touches the trigger.',
      ] },
    ] },
    { id: 'the-threat', at: { progress: 60 }, actions: [
      { type: 'log', text: 'One return accelerates hard on an attack line — THAT is the hostile.' },
      { type: 'spawnContact', kind: 'rock', impactIn: { min: 10, max: 14 }, count: 1 },
    ] },
    { id: 'resolve', at: { progress: 85 }, actions: [
      { type: 'cinematic', title: 'Standing down', seconds: 6, lines: [
        'The envoy holds its course, unharmed. A hail finally comes through — in kind.',
        'Whatever this was, it was not a war. Not today.',
      ] },
    ] },
  ],
};
