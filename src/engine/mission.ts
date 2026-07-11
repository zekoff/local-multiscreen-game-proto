// Mission definitions: the data schema that describes everything tunable
// about a mission run. Authored missions are TypeScript modules exporting a
// MissionDef (type-checked authoring); procedurally generated missions build
// one from GenParams + a seed (src/engine/mission-gen.ts). The Game engine
// consumes a MissionDef and knows nothing about where it came from.

import type { Range } from './rng.js';

export type SystemId = 'engines' | 'shields' | 'weapons' | 'sensors';

export interface MissionDef {
  id: string;              // stable identifier ('supply-run', 'gen:standard:12345')
  name: string;            // shown to players
  briefing: string;        // one-paragraph setup shown in the lobby / log
  arrivalName: string;     // destination, used in HUD labels and narrative
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
  | { type: 'setMaxAsteroids'; value: number };

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
}
