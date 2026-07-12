// Mission definitions: the data schema that describes everything tunable
// about a mission run. Authored missions are TypeScript modules exporting a
// MissionDef (type-checked authoring); procedurally generated missions build
// one from GenParams + a seed (src/engine/mission-gen.ts). The Game engine
// consumes a MissionDef and knows nothing about where it came from.

import type { Range } from './rng.js';

export type SystemId = 'engines' | 'shields' | 'weapons' | 'sensors' | 'tractor';

// Contact classification. Sensors resolve a contact's true kind only at
// sufficient power/range (see identification split in game.ts); until then a
// contact reads as UNKNOWN. Kinds are mission-scriptable via 'spawnContact'.
//   rock    — the classic hazard: shoot it or eat the impact.
//   pod     — a civilian/rescue contact: DO NOT FIRE (penalty). Tractorable.
//   mineral — inert salvage: no threat, tractor it aboard for score.
//   ghost   — a sensor false-positive: vanishes once correctly identified.
export type ContactKind = 'rock' | 'pod' | 'mineral' | 'ghost';

// A shipboard emergency the Crew Chief resolves by assigning crew (damage
// control). Purely allocation under scarcity — see the crew-assignment board.
export type EmergencyKind = 'fire' | 'boarders' | 'breach';

// What the progress readout shows the crew: a decreasing physical distance
// (docks at 0) or a countdown toward mission failure (an escape pod losing
// power, a convoy window closing). Distance-in-parsecs is the default,
// derived from targetSeconds when a mission doesn't set its own.
export interface MissionReadout {
  kind: 'distance' | 'countdown';
  unit: string;   // display unit, e.g. 'pc'
  total: number;  // parsecs at launch, or seconds on the failure clock
  label?: string; // optional display label ("Distance to <arrival>" default)
}

export interface MissionDef {
  id: string;              // stable identifier ('supply-run', 'gen:standard:12345')
  name: string;            // shown to players
  briefing: string;        // one-paragraph setup shown in the lobby / log
  arrivalName: string;     // destination, used in HUD labels and narrative
  // Lobby difficulty rating shown in the mission picker
  // ('training' | 'standard' | 'veteran' | 'hard' — free text).
  rating?: string;
  // Progress readout config (see MissionReadout; parsecs-distance default).
  readout?: MissionReadout;
  // Optional themed body the main screen renders growing on the horizon as
  // progress climbs (a station or planet). Missions without it get a plain
  // marker. Focused on one mission for now (see supply-run).
  destination?: { kind: 'station' | 'planet'; color: string };
  kind: 'authored' | 'generated';
  // Target duration (seconds) of a *well-executed* run. This is the single
  // mission-length knob: speedScale and parTime are derived from it (see
  // pacingFor) so a clean crew arrives in roughly this long. 180 = the 3-minute
  // baseline; up to ~300 for a longer haul. Not exposed in player setup — it's
  // a per-mission definition value.
  targetSeconds: number;
  parTime: number;         // seconds; the debrief time score is relative to this (derived from targetSeconds)

  // Ambient hazard pacing (per-seat difficulty multipliers apply on top).
  spawnEvery: Range;       // seconds between ambient asteroid spawns
  impactIn: Range;         // seconds from detection to impact
  asteroidDmg: Range;      // damage per impact
  maxAsteroids: number;    // concurrent cap
  breakerEvery: Range;     // seconds between breaker trips
  gateEvery?: Range;       // seconds between nav gates (optional; default 25-40)

  // Global scales relative to the baseline mission (1 = baseline).
  driftScale: number;      // helm course-drift pressure
  speedScale: number;      // ship velocity (lower = effectively longer trip)

  // --- Crew Chief / cargo / damage-control knobs (all optional; sensible
  // defaults let existing missions ignore them entirely). ---
  holdCapacity?: number;   // cargo hold slots (default 4); 0 disables the tractor console fiction
  crewTokens?: number;     // damage-control crew available to assign (default 4)
  // Salvage target for a 'salvaged'-outcome mission (P#23): banking this many
  // cargo units by the deadline is a clean run. Presence flips scoring to the
  // salvage model in finish().
  salvageGoal?: number;
  // Mission fails (non-binary 'expired' outcome) if the countdown readout hits
  // zero before arrival — pairs with readout.kind 'countdown' (P#21 clock).
  failOnCountdown?: boolean;

  // Authored timeline: set pieces that fire once at a time or progress mark.
  events: ScriptedEvent[];
}

// Derive the velocity scale and par time from a target well-executed duration,
// so authored and generated missions share one length model. Calibrated against
// the engine's peak progress rate (~0.6 * speedScale /s) with the real losses a
// clean run still takes (gate detours, turns) folded into SPEED_CALIB — tuned
// against `npm run lab` so a `skilled` crew arrives near targetSeconds.
// parTime sits above the well-executed time so the debrief time score has slack.
// Recalibrated 325 -> 260 after the 7-point power pool (default engines 3):
// the faster baseline ship was landing skilled runs ~20% under targetSeconds.
export const SPEED_CALIB = 260;
export function pacingFor(targetSeconds: number): { targetSeconds: number; speedScale: number; parTime: number } {
  return {
    targetSeconds,
    speedScale: SPEED_CALIB / targetSeconds,
    parTime: Math.round(targetSeconds * 1.35),
  };
}

// A scripted event fires once when mission time (seconds) or progress
// (0..100) reaches its trigger — whichever field is present; if both are
// present, either reaching its mark fires the event.
export interface ScriptedEvent {
  id: string;
  at: { time?: number; progress?: number };
  actions: EventAction[];
}

export type EventAction =
  // Narrative beat: appears in the ship's log and as a toast on stations.
  | { type: 'log'; text: string }
  // A burst of asteroids on top of ambient spawning (impact/dmg override
  // the mission's ambient ranges when given).
  | { type: 'spawnAsteroids'; count: number; impactIn?: Range; dmg?: Range }
  // Trip a breaker now; omit `system` to let the engine pick a powered one.
  | { type: 'tripBreaker'; system?: SystemId }
  // Multiply the ambient spawn rate from this point on (stacks by replacing:
  // last value wins). >1 = more frequent spawns.
  | { type: 'spawnRate'; multiplier: number }
  // Suppress ambient spawning for a stretch (scripted quiet before a storm).
  | { type: 'calm'; seconds: number }
  // Spawn a nav gate right now (scripted set piece — e.g. an intro mission's
  // first guaranteed ring), in addition to the ambient gateEvery cadence.
  | { type: 'spawnGate' }
  // Override the mission's concurrent-asteroid cap from this point on (last
  // value wins) — lets a mission ramp its ceiling over time, e.g. an intro
  // that starts at 1 and only allows 3 in the final stretch.
  | { type: 'setMaxAsteroids'; value: number }
  // Ion storm: halves passive sensor range for the duration — engineering
  // pressure (compensate with sensor power, or punch through with a pulse).
  | { type: 'ionStorm'; seconds: number }
  // Debris field: running hot scours the hull for the duration — helm
  // pressure (ease the throttle through it; a slow crawl is free).
  | { type: 'debrisField'; seconds: number }
  // Spawn a typed contact (pod / mineral / ghost / rock). The workhorse for
  // don't-shoot and salvage missions — kind is resolved on the scope only when
  // sensors are strong/close enough (see identification split). `count` spawns
  // a small cluster of that kind.
  | { type: 'spawnContact'; kind: ContactKind; count?: number; impactIn?: Range }
  // Spawn a large obstacle the helm must steer AROUND (not through): holding
  // the ship on its bearing when it arrives means a heavy collision. The
  // topology set piece (forward-biased model).
  | { type: 'spawnObstacle'; label?: string; reachIn?: Range; dmg?: number }
  // Competing-objective fork (P#4): open a secondary destination on a bearing
  // the helm may choose to divert onto (holding its bearing as the clock runs
  // banks the divert reward). Ignoring it costs nothing but the bonus.
  | { type: 'spawnDivert'; name: string; seconds: number; reward?: number }
  // Cinematic beat (P#4): freeze the sim and show dialogue on the main screen
  // for `seconds` (crew reads it, captain narrates). Non-interactive; a paired
  // spawnDivert/log usually follows so the crew acts once threats resume.
  | { type: 'cinematic'; title: string; lines: string[]; seconds?: number }
  // Solar flare / EMP front (P#5): announced now, strikes after `inSeconds`.
  // On impact, RAISED systems take stress (shields-up trips the shield breaker;
  // a charged laser dumps). Counter = safe posture (shields down, hold fire).
  | { type: 'solarFlare'; inSeconds: number }
  // Black out the forward view (P#5/P#18): the crew must fly on sensors alone.
  | { type: 'setViewImpaired'; on: boolean }
  // Start a shipboard emergency for the Crew Chief's damage-control board (P#6).
  | { type: 'startEmergency'; kind: EmergencyKind; severity?: number };

// Parameters for the procedural generator: small enough to expose in a UI,
// expressive enough to change how a run feels.
export interface GenParams {
  length: 'short' | 'standard' | 'long';
  intensity: number; // 0..1: scales hazard frequency, damage, and drift
  seed: number;      // reproducible generation AND run randomness
}

// Catalog entry: what transports send clients so a lobby can list options.
export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  kind: 'authored' | 'generated';
  rating: string; // lobby difficulty tag ('training' / 'standard' / ...)
}
