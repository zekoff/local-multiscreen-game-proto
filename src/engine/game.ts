// Core game engine: authoritative mission state for one ship (one room).
// A transport (Node server or Cloudflare Durable Object) owns one Game
// instance per room, ticks it at a fixed rate, and broadcasts the serialized
// state to all connected clients after each tick.
//
// The engine is runtime-agnostic: engine-internal imports only, no transport
// or platform knowledge. Missions arrive as data (MissionDef) — see
// mission-registry.ts for how start requests resolve.

import type { MissionDef, EventAction, SystemId } from './mission.js';
import { mulberry32, range, randomSeed, type Rng } from './rng.js';

export type Phase = 'lobby' | 'active' | 'debrief';
// 'main' and 'supervisor' are non-crew, view-only seats (multiple allowed);
// 'supervisor' is the debug/sim-control role. Crew seats are the other three.
export type SeatId = 'helm' | 'engineering' | 'weapons' | 'main' | 'supervisor';
export type Difficulty = 'chill' | 'normal' | 'intense';
export type { SystemId } from './mission.js';

// Difficulty multiplies the burden a station must handle (drift rate for helm,
// breaker trip rate for engineering, asteroid spawn rate for weapons).
const DIFF_MULT: Record<Difficulty, number> = { chill: 0.6, normal: 1, intense: 1.5 };

// Sensors is a fourth engineering-powered system (not a separate crew seat):
// it sets how far out an asteroid becomes targetable on the weapons scope.
const SYSTEMS: SystemId[] = ['engines', 'shields', 'weapons', 'sensors'];

// Ship-constant tuning (mission-independent; per-mission knobs live in MissionDef).
// Pool raised 6 -> 7 post-playtest ("one more engine allocation point"): the
// extra unit lands on engines in the default split. Per-system cap stays 4, so
// speed/turn normalization (eff/POWER_MAX) is untouched.
const POWER_TOTAL = 7;      // total power units engineering can allocate
const POWER_MAX = 4;        // max units a single system can hold

// Laser: no battery bank and no fixed cooldown. `charge` (0-100) is simply the
// recharge meter — firing empties it and it refills at a rate set by weapon
// power, so the "cooldown" is emergent (higher weapon power = faster refire).
// Halved from the first pass so the laser feels like a deliberate, recharging
// weapon rather than a rapid-fire turret — refire is now ~2x slower per power.
const LASER_CHARGE_RATE = 7; // charge points/s per allocated weapon power unit

// Emergency Warp: a drastic escape that jumps the ship elsewhere, scattering
// its systems (see doWarp). Long cooldown so it's a last resort, not a rhythm.
const WARP_COOLDOWN = 25;
const WARP_HULL_DMG = 8;
const WARP_CALM = 5;                       // seconds of spawn pause after a jump
const WARP_OFFCOURSE = { min: 65, max: 95 }; // how far off course the jump throws the helm

// Maneuverability: a nudge's turn authority scales UP with engine power and
// DOWN with throttle — so you turn hard by feeding the engines and/or easing
// off the throttle (the "slow down to catch a ring" dynamic).
const BASE_TURN = 12;

// |alignment| at or under this counts as "on course" for helm effectiveness.
const ON_COURSE_THRESHOLD = 15;

// Auto-assist is a survival net for an abandoned seat, not a competent crew
// member. Post-playtest rebalance: the CPU is SLOW rather than INCOMPETENT —
// no dice-roll misses, just deliberate reaction lag. A full bot crew should
// barely scrape to the station; a human at any console beats the bot at it
// (and a human ENGINEER now genuinely helps a bot gunner: pumping weapon
// power shortens the recharge wait, which the CPU can actually use).
const AUTO_WEAPONS_REACT_RANGE = 7;  // seconds-to-impact before auto-turret engages
// Deliberate pause between "charged + target acquired" and pulling the
// trigger (replaces the old 38% miss chance — every shot now lands, the cost
// is time). Seeded per shot via this.rng.
const AUTO_WEAPONS_FIRE_DELAY = { min: 1, max: 2 };
// Auto shield doctrine: raise only when a real volley is incoming (more than
// one rock inside the threat window), drop a beat after the sky is clear.
const AUTO_SHIELD_THREAT_WINDOW = 5; // seconds-to-impact that counts as "incoming"
const AUTO_SHIELD_THREAT_COUNT = 2;  // rocks inside the window before shields go up
const AUTO_SHIELD_LINGER = 3;        // seconds shields stay up after the last contact clears
const AUTO_HELM_THROTTLE = 70;       // auto-helm cruises easy, not fast
const AUTO_HELM_CORRECTION = 5;      // course-correction authority per second
// Auto-helm makes a POOR attempt at slipstream rings: it swings toward the
// gate bearing, but with so little turn authority that only a ring that
// spawned near the current heading is actually catchable.
const AUTO_HELM_GATE_STEP = 3;       // degrees/second toward a gate's bearing
const AUTO_ENG_RESET_AGE = 4;        // seconds a breaker stays tripped before auto-eng restores it (was 9 — impacts trip breakers now, so the bot engineer keeps up)

// Sensors: detection range in seconds-to-impact. An asteroid is only targetable
// on the weapons scope once its impactIn drops to within this range, which
// grows with sensor power. A pulse (below) overrides it for a one-shot reveal.
// Nerfed from 10/4: the complaint was that each sensor point added too much
// reach (2 power hit ~18s, nearly the scope edge, since the scope maps
// impactIn/20 to the rim). Halving the per-point value to 2 puts 2 power at
// ~12s (~60% radius) — a clear investment curve — while a slightly lower base
// keeps the field readable enough for the (now 2x slower) laser to work.
const SENSOR_BASE = 8;          // detection range (s) at zero sensor power
const SENSOR_PER_POWER = 2;     // extra range (s) per effective sensor power unit
const SENSOR_PULSE_COOLDOWN = 80; // long cooldown => ~1-2 pulses per mission

// Raised shields draw off the drive: a real power-triage tradeoff instead of
// a free defensive toggle.
const SHIELD_ENGINE_PENALTY = 0.85;
// Shields are a managed resource, not a set-and-forget toggle. Tracked
// internally in absolute points (0..SHIELD_MAX) and serialized as a 0-100 %.
// They only recharge while LOWERED, and slowly bleed while RAISED, so keeping
// them up costs charge you can't get back until you drop them — you raise
// them around a threat (especially while the phaser is on cooldown) and lower
// them to recharge and go faster. The cap is low enough that a burst can wear
// them through to the hull.
const SHIELD_MAX = 35;
const SHIELD_REGEN_PER_POWER = 1.0;  // points/s per allocated power unit, only while lowered
const SHIELD_DRAIN_PER_SEC = 1.0;    // points/s bled while raised (idle upkeep)

// --- Nav gates: fly-through targets the helm lines up on. The pass window
// widens with engine power (thrust authority makes the ship easier to aim),
// but running the engines hot also makes asteroids close faster (see
// closeRate) — the deliberate risk/reward the design calls for.
// Narrowed from 18/26: gates are harder to thread now (tighter tolerance), but
// pay off far more (a slipstream burst — see GATE_SLIPSTREAM_*), so hitting one
// is a real win rather than a small tax.
const GATE_BASE_WINDOW = 12;       // |alignment - bearing| tolerance at minimum engine power
const GATE_ENGINE_WINDOW = 18;     // extra tolerance at full engine power
const GATE_CHARGE_REWARD = 20;     // laser recharge granted for a clean pass
// A clean pass no longer just adds a flat progress bump — it opens a short
// slipstream that multiplies ship speed for a few seconds, so the ground gained
// exceeds what staying on course would have covered in the same window.
const GATE_SLIPSTREAM_MULT = 1.6;  // speed multiplier while the slipstream is open
const GATE_SLIPSTREAM_SECS = 4;    // how long a pass keeps the slipstream open
const GATE_REACH: { min: number; max: number } = { min: 8, max: 13 }; // seconds to reach a gate
// Gates appear well off the current course: the helm must actively swing the
// ship onto the gate's bearing (turning hard => ease throttle / feed engines).
const GATE_BEARING = { min: 45, max: 88 };
const MAX_GATES = 2;               // concurrent gates ahead
// How much running hot (throttle x engine power) shortens the time asteroids
// take to close — the cost of the speed that makes gates easy.
const SPEED_RISK = 0.6;
// Gate approach is coupled *strongly* to ship speed (throttle x engine power):
// running hot makes a ring rush in (little time to line up), easing the
// throttle lets it drift in slowly (buying time to swing onto the bearing).
// This is the "slow down to catch the ring" lever, sharper than the asteroid
// closeRate. gateCloseRate() spans ~0.5 (idle) .. ~2.5 (full hot).
const GATE_CLOSE_BASE = 0.5;
const GATE_CLOSE_SPEED = 2.0;

// Chance an ambient spawn arrives as a short 2-3 rock cluster instead of a
// single contact, so it isn't always one-at-a-time with long gaps.
const BURST_CHANCE = 0.32;

// Narrative captain's-log tuning (see narrate()). Windows/thresholds that
// decide when the ship's log comments on the action.
const NARRATE_KILL_WINDOW = 12;    // s — window for counting a kill cluster
const NARRATE_KILL_COUNT = 4;      // kills within the window to remark on it
const NARRATE_DMG_WINDOW = 8;      // s — window for a damage burst
const NARRATE_DMG_THRESHOLD = 30;  // hull damage within the window to warn on it
const NARRATE_NOTE_COOLDOWN = 20;  // s — min gap between repeats of the same beat
const NARRATE_CONSOLE_EVERY = 45;  // s — min gap between console-effectiveness notes

// Each rock spawns with a lateral bearing (like a gate's), port or starboard,
// so the main screen can place it off-axis and slide it with the helm's
// steering — then drift it toward the vanishing point as it closes. Purely
// positional (does not affect damage or time-to-impact).
const ASTEROID_BEARING = { min: 12, max: 78 };

export interface Asteroid {
  id: number;
  label: string;    // human-readable callsign, e.g. "AST-042"
  impactIn: number; // seconds until impact
  dmg: number;      // damage dealt on impact (derived from size & speed)
  size: number;     // 0.6..1.6 visual/hitbox scale — bigger is easier to spot early
  speed: number;    // 0.7..1.5 closing-rate multiplier — faster shortens the window
  revealed: boolean;  // a sensor pulse forced this one targetable regardless of range
  announced: boolean; // the "sensor contact" event has fired (on detection, not spawn)
  bearing: number;    // -100..100 lateral offset for main-screen placement (port/starboard)
}

// A nav gate the ship flies through. Steering into it (low |alignment| when it
// arrives) scores a pass; the pass window widens with engine power, so a
// well-powered ship is easier to line up — at the cost of the extra asteroid
// risk that speed brings (see the impact-closing coupling in tick()).
export interface Gate {
  id: number;
  label: string;
  reachIn: number;  // seconds until the ship reaches the gate plane
  bearing: number;  // target alignment to fly through it (well off the 0 course line)
}

// One-shot visual/audio effects emitted during a tick and delivered in the
// very next state broadcast, then cleared (transport calls clearFx()). Purely
// cosmetic — clients render a laser/explosion/shake/sound; losing one is
// harmless. Positions are derived client-side from the stable asteroid/gate id.
export type Effect =
  | { kind: 'laser'; targetId: number; hit: boolean }
  | { kind: 'explosion'; id: number }
  | { kind: 'impact'; hullDmg: number; absorbed: boolean }
  | { kind: 'gate'; id: number; passed: boolean }
  | { kind: 'warp' }          // Emergency Warp jump (big shake/flash + sound)
  | { kind: 'sensorPulse' }   // active sensor sweep (expanding ring on the scope)
  | { kind: 'sensorContact' }; // a contact just resolved on sensors (engineering ping)

interface SeatState {
  playerId: string | null; // sticky id so a dropped client can resume its seat
  name: string;
  connected: boolean;
  difficulty: Difficulty;
}

// Per-run measurements for mission balancing (see docs/missions.md). Summed
// during the run, summarized into the debrief, and consumed raw by the
// mission-lab harness.
export interface Telemetry {
  asteroidsSpawned: number;
  shotsFired: number;
  powerChanges: number;
  breakerDowntime: number; // system-seconds spent tripped
  shieldUptime: number;    // seconds with shields raised
  hullDamageTaken: number;
  impactLog: { t: number; dmg: number; hullDmg: number }[];
  avgAlignment: number;    // mean |alignment| over the run (helm load)
  avgThrottle: number;
  gatesPassed: number;
  gatesMissed: number;
  warpsUsed: number;
  pulsesUsed: number;
  // Per-console effectiveness + a captain-direction proxy. Sim-report only
  // (surfaced in the mission-lab table, not the player-facing debrief). The
  // captain has no device, so its numbers are a *proxy* read off crew
  // coordination outcomes — see finish() for how each is derived.
  perConsole: ConsoleMetrics;
}

export interface ConsoleMetrics {
  helm: { gatePassRate: number; avgAlignmentError: number; onCoursePct: number };
  weapons: { hitRate: number; avgAcquireLatency: number; neutralizedPct: number; chargeIdlePct: number };
  engineering: { avgPowerUtil: number; breakerDowntime: number };
  // Captain proxy: coordinationScore is a 0..1 composite of the crew outcomes a
  // good caller drives — defense, gate discipline, and fast target hand-offs.
  captain: { coordinationScore: number; avgAcquireLatency: number; gatePassRate: number; defense: number };
}

export interface Debrief {
  outcome: 'arrived' | 'adrift';
  grade: string;
  score: number;
  narrative: string;
  missionId: string;
  missionName: string;
  shipName: string;       // crew-chosen ship name ('' if unnamed) — career-history fiction
  seed: number;           // (missionId, seed) reproduces the run's randomness
  stats: {
    time: number;
    hull: number;
    destroyed: number;
    impacts: number;
    dodged: number;
    breakersTripped: number;
    gatesPassed: number;
    gatesMissed: number;
    warpsUsed: number;
    pulsesUsed: number;
  };
  telemetry: Telemetry;
  crew: Record<string, { difficulty: Difficulty; human: boolean }>;
}

// Actions are small role-scoped commands sent by clients over the socket.
export interface Action {
  kind: string;
  [k: string]: unknown;
}

export class Game {
  phase: Phase = 'lobby';
  seats: Record<SeatId, SeatState>;
  // Called whenever a human-readable event happens (impacts, breakers, etc.).
  onEvent: (text: string) => void = () => {};

  // --- Mission definition & run randomness (set by start()) ---
  mission: MissionDef | null = null;
  private runSeed = 0;
  private rng: Rng = mulberry32(1);

  // --- Mission state (reset by start()) ---
  missionTime = 0;
  progress = 0;          // 0..100, distance to destination
  hull = 100;
  shieldRaised = false;
  shieldStrength = SHIELD_MAX; // absolute points, 0..SHIELD_MAX (serialized as a %)
  power: Record<SystemId, number> = { engines: 2, shields: 1, weapons: 2, sensors: 1 };
  breakers: Record<SystemId, number | null> = { engines: null, shields: null, weapons: null, sensors: null }; // trip age in seconds, null = ok
  throttle = 0;          // 0..100
  alignment = 0;         // -100..100, 0 = on course
  speed = 0;             // derived, progress units per second
  charge = 100;          // laser recharge meter 0..100 (100 = ready to fire)
  targetId: number | null = null;
  warpCd = 0;            // seconds until Emergency Warp is ready
  sensorPulseCd = 0;     // seconds until the active sensor pulse is ready
  gateBoostTimer = 0;    // seconds of open slipstream remaining after a clean gate pass
  // Debug/sim-supervisor controls (opt-in per run via the launch payload).
  debug = false;         // whether debug controls are exposed for this run
  timeScale = 1;         // simulation speed multiplier (0 = paused)
  asteroids: Asteroid[] = [];
  gates: Gate[] = [];
  fx: Effect[] = [];     // one-shot effects for this broadcast (see clearFx)
  debrief: Debrief | null = null;

  private nextAsteroidId = 1;
  private nextGateId = 1;
  private gateTimer = 30;
  private spawnTimer = 10;
  private breakerTimer = 22;
  private spawnRateMult = 1;  // scripted 'spawnRate' actions replace this
  private calmUntil = 0;      // missionTime before which ambient spawns pause
  private maxAsteroidsOverride: number | null = null; // scripted 'setMaxAsteroids' (null = use MissionDef)
  private autoFireAt: number | null = null;        // missionTime when the auto-turret's deliberate shot lands
  private autoShieldClearAt: number | null = null; // missionTime when auto shields drop after the sky clears
  private shipName = ''; // optional crew-chosen ship name (fiction only, set at launch)
  private firedEvents = new Set<string>(); // scripted events that already ran
  private driftBias = 0;      // slow persistent drift the helm must fight
  private driftBiasTimer = 0;
  private stats = { destroyed: 0, impacts: 0, dodged: 0, breakersTripped: 0, gatesPassed: 0, gatesMissed: 0, warpsUsed: 0, pulsesUsed: 0 };
  private tel: Telemetry = freshTelemetry();
  private alignAbsSum = 0;
  private throttleSum = 0;
  private telSamples = 0;
  private chargeFullTime = 0; // seconds the laser sat at 100% (unused firepower - a weapons-console pacing metric)
  private log: { t: number; text: string }[] = [];

  // --- Narrative log state (see narrate()): rolling windows the ship's log
  // watches to comment on the run as it happens.
  private killTimes: number[] = [];        // missionTime of recent kills (kill-cluster detection)
  private damageWindow: { t: number; dmg: number }[] = []; // recent hull hits (damage-burst detection)
  private narratedHalfway = false;         // the one-shot midpoint assessment
  private lastKillNote = -999;             // throttle for kill-cluster lines
  private lastDamageNote = -999;           // throttle for damage-burst lines
  private lastConsoleNote = 0;             // throttle for occasional console-effectiveness notes

  // --- Per-console effectiveness accumulators (sim-report telemetry, task 5) ---
  private onCourseTime = 0;                // seconds spent roughly on course (helm)
  private targetableSince = new Map<number, number>(); // asteroid id -> missionTime it first became targetable
  private acquireLatencies: number[] = []; // seconds from targetable -> weapons acquired (captain/weapons coordination)
  private threatsNeutralized = 0;          // contacts destroyed before impact (weapons)
  private powerUtilSum = 0;                // sum of effective (non-tripped) power each sample (engineering)

  constructor() {
    // All seats start empty; unmanned crew seats get a basic auto-assist so
    // any subset of stations is playable.
    this.seats = Object.fromEntries(
      (['helm', 'engineering', 'weapons', 'main'] as SeatId[]).map((s) => [
        s,
        { playerId: null, name: '', connected: false, difficulty: 'normal' as Difficulty },
      ]),
    ) as Record<SeatId, SeatState>;
  }

  // --- Seat management ---

  join(seat: SeatId, playerId: string, name: string, difficulty: Difficulty): { ok: boolean; error?: string } {
    const s = this.seats[seat];
    // Reject if a *different* connected player holds the seat; the same
    // playerId reclaiming its seat is the reconnection path.
    if (s.connected && s.playerId && s.playerId !== playerId) {
      return { ok: false, error: `${seat} station is already crewed` };
    }
    const resuming = s.playerId === playerId;
    s.playerId = playerId;
    s.name = name || s.name || seat;
    s.connected = true;
    if (DIFF_MULT[difficulty]) s.difficulty = difficulty;
    this.event(resuming ? `${s.name} reconnected to ${seat}` : `${s.name} took the ${seat} station`);
    return { ok: true };
  }

  disconnect(seat: SeatId, playerId: string) {
    const s = this.seats[seat];
    // Keep the seat reserved for this playerId so they can rejoin mid-mission.
    if (s.playerId === playerId) {
      s.connected = false;
      this.event(`${s.name} lost contact (${seat} on auto)`);
    }
  }

  // A crew seat runs on auto-assist whenever no human is connected to it.
  private auto(seat: SeatId): boolean {
    return !this.seats[seat].connected;
  }

  private diff(seat: SeatId): number {
    return DIFF_MULT[this.seats[seat].difficulty];
  }

  // --- Phase transitions ---

  // Begin a mission run. The transport resolves the MissionDef (registry or
  // generator) and passes the run seed so (missionId, seed) reproduces the
  // run's randomness exactly.
  start(
    def: MissionDef,
    seed?: number,
    debug = false,
    shipName = '',
    difficulties?: Partial<Record<SeatId, Difficulty>>,
  ) {
    if (this.phase === 'active') return;
    this.mission = def;
    this.runSeed = seed ?? randomSeed();
    this.rng = mulberry32(this.runSeed);
    this.debug = debug;
    // The crew's ship name (optional, set at launch): pure fiction, zero
    // mechanics — it flavors the log, the main-screen header, and the debrief.
    this.shipName = shipName.trim().slice(0, 24);
    // Launch-time per-seat difficulty (the main-screen lobby surfaces this so
    // the whole party sees it). Only explicitly-chosen seats are overridden —
    // a player's own join-URL difficulty stands otherwise.
    if (difficulties) {
      for (const s of Object.keys(difficulties) as SeatId[]) {
        const d = difficulties[s];
        if (this.seats[s] && d && DIFF_MULT[d]) this.seats[s].difficulty = d;
      }
    }
    this.timeScale = 1;
    // Reset all mission state for a fresh run.
    this.phase = 'active';
    this.missionTime = 0;
    this.progress = 0;
    this.hull = 100;
    this.shieldRaised = false;
    this.shieldStrength = SHIELD_MAX;
    this.power = { engines: 3, shields: 1, weapons: 2, sensors: 1 }; // default split spends the full pool (7)
    this.breakers = { engines: null, shields: null, weapons: null, sensors: null };
    this.throttle = 0;
    this.alignment = 0;
    this.charge = 100;
    this.targetId = null;
    this.warpCd = 0;
    this.sensorPulseCd = 0;
    this.gateBoostTimer = 0;
    this.asteroids = [];
    this.gates = [];
    this.fx = [];
    this.nextGateId = 1;
    this.gateTimer = range(this.rng, def.gateEvery ?? { min: 25, max: 40 });
    this.debrief = null;
    this.spawnTimer = range(this.rng, def.spawnEvery);
    this.breakerTimer = range(this.rng, def.breakerEvery);
    this.spawnRateMult = 1;
    this.calmUntil = 0;
    this.maxAsteroidsOverride = null;
    this.autoFireAt = null;
    this.autoShieldClearAt = null;
    this.firedEvents = new Set();
    this.driftBias = 0;
    this.driftBiasTimer = 0;
    this.stats = { destroyed: 0, impacts: 0, dodged: 0, breakersTripped: 0, gatesPassed: 0, gatesMissed: 0, warpsUsed: 0, pulsesUsed: 0 };
    this.tel = freshTelemetry();
    this.alignAbsSum = 0;
    this.throttleSum = 0;
    this.telSamples = 0;
    this.chargeFullTime = 0;
    this.log = [];
    this.killTimes = [];
    this.damageWindow = [];
    this.narratedHalfway = false;
    this.lastKillNote = -999;
    this.lastDamageNote = -999;
    this.lastConsoleNote = 0;
    this.onCourseTime = 0;
    this.targetableSince = new Map();
    this.acquireLatencies = [];
    this.threatsNeutralized = 0;
    this.powerUtilSum = 0;
    this.event(this.shipName
      ? `Mission start: ${def.name}. The ${this.shipName} is underway — Godspeed.`
      : `Mission start: ${def.name}. Godspeed.`);
    this.event(def.briefing);
  }

  restartToLobby() {
    if (this.phase !== 'debrief') return;
    this.phase = 'lobby';
    this.event('Crew returned to ready room.');
  }

  // --- Player actions ---

  action(seat: SeatId, a: Action) {
    if (this.phase !== 'active') return;
    // Debug/sim-control actions come from the view-only main/supervisor seats
    // and only when debug was enabled for this run.
    if (seat === 'main' || seat === 'supervisor') {
      if (this.debug) this.debugAction(a);
      return;
    }
    // Each action kind is only honored from the seat that owns it.
    if (seat === 'helm') {
      if (a.kind === 'throttle' && typeof a.value === 'number') {
        this.throttle = Math.max(0, Math.min(100, a.value));
      } else if (a.kind === 'nudge' && (a.dir === -1 || a.dir === 1)) {
        // Turn authority scales with engine power and (inversely) throttle.
        this.alignment = clamp(this.alignment + this.turnStep() * (a.dir as number), -100, 100);
      } else if (a.kind === 'warp' || a.kind === 'evasive') {
        this.doWarp();
      }
    } else if (seat === 'engineering') {
      if (a.kind === 'power' && SYSTEMS.includes(a.system as SystemId) && (a.delta === -1 || a.delta === 1)) {
        this.adjustPower(a.system as SystemId, a.delta as number);
      } else if (a.kind === 'resetBreaker' && SYSTEMS.includes(a.system as SystemId)) {
        this.resetBreaker(a.system as SystemId);
      } else if (a.kind === 'sensorPulse') {
        this.doSensorPulse();
      }
    } else if (seat === 'weapons') {
      if (a.kind === 'target' && typeof a.id === 'number') {
        // Can only lock a contact the sensors have actually resolved.
        const t = this.asteroids.find((x) => x.id === a.id);
        if (t && this.targetable(t)) {
          this.targetId = a.id as number;
          this.recordAcquire(a.id as number);
        }
      } else if (a.kind === 'fire') {
        this.fire();
      } else if (a.kind === 'shields' && typeof a.raised === 'boolean') {
        this.shieldRaised = a.raised;
        this.event(this.shieldRaised ? 'Shields raised.' : 'Shields lowered.');
      }
    }
  }

  private adjustPower(system: SystemId, delta: number) {
    const total = SYSTEMS.reduce((sum, s) => sum + this.power[s], 0);
    const next = this.power[system] + delta;
    if (next < 0 || next > POWER_MAX) return;
    if (delta > 0 && total >= POWER_TOTAL) return; // no free units in the budget
    this.power[system] = next;
    this.tel.powerChanges++;
  }

  private resetBreaker(system: SystemId) {
    if (this.breakers[system] !== null) {
      this.breakers[system] = null;
      this.event(`Engineering reset the ${system} breaker.`);
    }
  }

  // Emergency Warp: a last-resort jump. Threats vanish (the ship is elsewhere),
  // but every system is scattered — breakers all trip, shields and the laser
  // drop, ALL power is unallocated (engineering must re-power from scratch), the
  // ship is thrown far off course with the throttle cut, and it takes a little
  // hull damage. Followed by a brief spawn lull.
  private doWarp() {
    if (this.warpCd > 0) return;
    this.asteroids = [];
    this.targetId = null;
    this.hull = Math.max(0, this.hull - WARP_HULL_DMG);
    for (const s of SYSTEMS) this.breakers[s] = 0;
    this.stats.breakersTripped += SYSTEMS.length;
    this.shieldRaised = false;
    this.shieldStrength = 0;
    this.charge = 0;
    this.power = { engines: 0, shields: 0, weapons: 0, sensors: 0 };
    this.alignment = clamp(sign(this.rng() - 0.5) * range(this.rng, WARP_OFFCOURSE), -100, 100);
    this.throttle = 0;
    this.calmUntil = this.missionTime + WARP_CALM;
    this.warpCd = WARP_COOLDOWN;
    this.stats.warpsUsed++;
    this.pushFx({ kind: 'warp' });
    this.event('EMERGENCY WARP! Systems scattered — re-establish power and course!');
  }

  // Active sensor pulse: light up every current contact (targetable regardless
  // of the passive sensor range) for one sweep. Long cooldown.
  private doSensorPulse() {
    if (this.sensorPulseCd > 0) return;
    for (const a of this.asteroids) a.revealed = true;
    this.sensorPulseCd = SENSOR_PULSE_COOLDOWN;
    this.stats.pulsesUsed++;
    this.pushFx({ kind: 'sensorPulse' });
    this.event('Active sensor pulse — all contacts lit up.');
  }

  // Debug/sim-supervisor actions (only reached when this.debug is set).
  private debugAction(a: Action) {
    if (a.kind === 'setTimeScale' && typeof a.value === 'number') {
      this.timeScale = clamp(a.value, 0, 4);
      this.event(this.timeScale === 0 ? '[debug] Simulation paused.' : `[debug] Simulation speed set to ${this.timeScale}x.`);
    } else if (a.kind === 'spawnAsteroid' && this.mission) {
      this.spawnAsteroid(this.mission.impactIn, this.mission.asteroidDmg);
      this.event('[debug] Spawned an asteroid.');
    } else if (a.kind === 'spawnGate') {
      this.spawnGate(); // emits its own "nav gate ahead" beat
    }
  }

  private fire() {
    if (this.charge < 100) return; // not fully recharged yet
    const target = this.asteroids.find((a) => a.id === this.targetId);
    if (!target || !this.targetable(target)) return;
    this.charge = 0; // firing empties the recharge meter; weapon power refills it
    this.tel.shotsFired++;
    this.asteroids = this.asteroids.filter((a) => a.id !== target.id);
    this.targetId = null;
    this.stats.destroyed++;
    // Narrative + weapons-effectiveness tracking: a contact killed before it
    // ever reached us counts as a neutralized threat, and feeds kill-cluster
    // detection in the captain's log.
    this.killTimes.push(this.missionTime);
    this.threatsNeutralized++;
    this.targetableSince.delete(target.id);
    // Laser then explosion — the main screen draws the beam to the contact and
    // pops it; the miss path (auto-turret) draws the beam with no explosion.
    this.pushFx({ kind: 'laser', targetId: target.id, hit: true });
    this.pushFx({ kind: 'explosion', id: target.id });
    this.event(`Direct hit! ${target.label} destroyed.`);
  }

  // Bounded effect buffer: cleared by the transport after each broadcast, but
  // capped so a consumer that never clears (the in-process lab) can't grow it.
  private pushFx(e: Effect) {
    this.fx.push(e);
    if (this.fx.length > 32) this.fx.shift();
  }

  // Called by the transport immediately after broadcasting a tick's state, so
  // effects emitted between ticks (player fire) still ride the next broadcast.
  clearFx() {
    if (this.fx.length > 0) this.fx = [];
  }

  // Effective power for a system: allocated units, HALVED while its breaker is
  // tripped — a tripped system limps at half effectiveness (reverted from the
  // full-offline experiment: playtest showed hard-zero felt like a dead console
  // rather than an urgent repair). Fractional eff is fine: every consumer is
  // continuous math (charge rate, turn authority, regen, ranges).
  private eff(system: SystemId): number {
    return this.power[system] * (this.breakers[system] !== null ? 0.5 : 1);
  }

  // Turn authority per nudge: rises with engine power, falls with throttle — so
  // hard turns need the engines fed and/or the throttle eased back.
  private turnStep(): number {
    const engineFactor = 0.4 + 0.6 * (this.eff('engines') / POWER_MAX);
    const throttleFactor = 1.3 - 0.9 * (this.throttle / 100);
    return BASE_TURN * engineFactor * throttleFactor;
  }

  // Passive sensor detection range (seconds-to-impact), grows with sensor power.
  private sensorRange(): number {
    return SENSOR_BASE + SENSOR_PER_POWER * this.eff('sensors');
  }

  // A contact is targetable once it's within passive sensor range, or after a
  // pulse has revealed it.
  private targetable(a: Asteroid): boolean {
    return a.revealed || a.impactIn <= this.sensorRange();
  }

  // How fast hazards (asteroids, gates) close, relative to real time. Running
  // the engines hot (high throttle x engine power) closes them faster, cutting
  // reaction time — the risk that pays for the wider gate window high power buys.
  private closeRate(): number {
    return 1 + SPEED_RISK * (this.throttle / 100) * (this.eff('engines') / POWER_MAX);
  }

  // How fast nav gates rush in, coupled *strongly* to ship speed (throttle x
  // engine power). Running hot (~1.0 speed factor) makes a ring close at ~2.5x,
  // easing the throttle drops it toward ~0.5x — the "slow down to catch the
  // ring" lever the design leans on, sharper than the asteroid closeRate.
  private gateCloseRate(): number {
    const speedFactor = (this.throttle / 100) * (this.eff('engines') / POWER_MAX);
    return GATE_CLOSE_BASE + GATE_CLOSE_SPEED * speedFactor;
  }

  private spawnGate() {
    const id = this.nextGateId++;
    // Bearing is well off the current course, and randomly to port or starboard,
    // so the helm has to actively swing onto it.
    const bearing = sign(this.rng() - 0.5) * range(this.rng, GATE_BEARING);
    const g: Gate = { id, label: `NAV-${String(id).padStart(2, '0')}`, reachIn: range(this.rng, GATE_REACH), bearing };
    this.gates.push(g);
    this.event(`Nav gate ${g.label} ahead, bearing ${bearing > 0 ? 'starboard' : 'port'} — swing onto the approach.`);
  }

  // A gate is reached: passing needs alignment near the gate's bearing, within a
  // window that widens with engine power. Passing rewards recharge + a boost.
  private evaluateGate(g: Gate) {
    const window = GATE_BASE_WINDOW + GATE_ENGINE_WINDOW * (this.eff('engines') / POWER_MAX);
    const passed = Math.abs(this.alignment - g.bearing) <= window;
    if (passed) {
      this.stats.gatesPassed++;
      this.charge = Math.min(100, this.charge + GATE_CHARGE_REWARD);
      // Open the slipstream: a few seconds of multiplied speed (applied in the
      // tick speed calc), worth more ground than staying on the straight line.
      this.gateBoostTimer = GATE_SLIPSTREAM_SECS;
      this.event(`Clean pass through ${g.label} — slipstream boost!`);
    } else {
      this.stats.gatesMissed++;
      this.event(`Missed ${g.label} — off the approach line.`);
    }
    this.pushFx({ kind: 'gate', id: g.id, passed });
  }

  // --- Scripted mission events ---

  private runScriptedEvents() {
    const m = this.mission!;
    for (const ev of m.events) {
      if (this.firedEvents.has(ev.id)) continue;
      const timeHit = ev.at.time !== undefined && this.missionTime >= ev.at.time;
      const progressHit = ev.at.progress !== undefined && this.progress >= ev.at.progress;
      if (!timeHit && !progressHit) continue;
      this.firedEvents.add(ev.id);
      for (const action of ev.actions) this.applyEventAction(action);
    }
  }

  private applyEventAction(action: EventAction) {
    const m = this.mission!;
    if (action.type === 'log') {
      this.event(action.text);
    } else if (action.type === 'spawnAsteroids') {
      for (let i = 0; i < action.count; i++) {
        this.spawnAsteroid(action.impactIn ?? m.impactIn, action.dmg ?? m.asteroidDmg);
      }
    } else if (action.type === 'tripBreaker') {
      this.tripBreaker(action.system);
    } else if (action.type === 'spawnRate') {
      this.spawnRateMult = action.multiplier;
    } else if (action.type === 'calm') {
      this.calmUntil = this.missionTime + action.seconds;
    } else if (action.type === 'spawnGate') {
      this.spawnGate();
    } else if (action.type === 'setMaxAsteroids') {
      this.maxAsteroidsOverride = action.value;
    }
  }

  // Concurrent-asteroid ceiling: the mission's cap unless a scripted
  // setMaxAsteroids event has overridden it (intro-style difficulty ramps).
  private maxAsteroids(): number {
    return this.maxAsteroidsOverride ?? this.mission!.maxAsteroids;
  }

  private spawnAsteroid(impactIn: { min: number; max: number }, dmg: { min: number; max: number }) {
    const id = this.nextAsteroidId++;
    // Size and speed vary per rock and together set its damage: a big, fast rock
    // hits hardest (but big = easy to spot early; fast = a shorter shoot window).
    const size = range(this.rng, { min: 0.6, max: 1.6 });
    const speed = range(this.rng, { min: 0.75, max: 1.35 });
    const baseDmg = range(this.rng, dmg);
    const dealt = Math.max(3, Math.round(baseDmg * (0.65 + 0.35 * size) * (0.7 + 0.3 * speed)));
    const a: Asteroid = {
      id,
      label: `AST-${String(id).padStart(3, '0')}`,
      impactIn: range(this.rng, impactIn),
      dmg: dealt,
      size,
      speed,
      revealed: false,
      announced: false,
      // Lateral placement for the main screen: off-axis to port or starboard.
      bearing: sign(this.rng() - 0.5) * range(this.rng, ASTEROID_BEARING),
    };
    this.asteroids.push(a);
    this.tel.asteroidsSpawned++;
    // No "sensor contact" toast yet — that fires when sensors resolve it (see
    // the detection check in tick); at spawn it's just an unlabeled dot ahead.
  }

  // Trip a specific breaker (scripted) or a random untripped one (ambient).
  private tripBreaker(system?: SystemId) {
    const candidates = system !== undefined && this.breakers[system] === null
      ? [system]
      : SYSTEMS.filter((s) => this.breakers[s] === null);
    if (candidates.length === 0) return;
    const victim = candidates[Math.floor(this.rng() * candidates.length)];
    this.breakers[victim] = 0;
    this.stats.breakersTripped++;
    this.event(`Breaker tripped: ${victim} at half power!`);
  }

  // --- Simulation tick (dt in seconds) ---

  tick(dt: number) {
    if (this.phase !== 'active' || !this.mission) return;
    // Debug time dilation: scale the whole simulation step (0 = paused). The
    // transport still ticks and broadcasts, so debug controls stay responsive.
    dt *= this.timeScale;
    if (dt === 0) return;
    const m = this.mission;
    this.missionTime += dt;
    this.warpCd = Math.max(0, this.warpCd - dt);
    this.sensorPulseCd = Math.max(0, this.sensorPulseCd - dt);

    // Course drift: a slowly-changing bias plus jitter, scaled by the
    // mission's drift pressure and the helm seat's difficulty.
    const driftScale = m.driftScale * this.diff('helm');
    this.driftBiasTimer -= dt;
    if (this.driftBiasTimer <= 0) {
      this.driftBias = (this.rng() * 2 - 1) * 2.5 * driftScale;
      this.driftBiasTimer = 6 + this.rng() * 8;
    }
    this.alignment = clamp(this.alignment + (this.driftBias + (this.rng() * 2 - 1) * 2.0) * dt, -100, 100);

    // Auto-helm: cruise at an easy throttle and weakly steer back on course. It
    // never chases nav gates (a human earns those slipstream rewards), so a bot
    // helm simply plods the straight line and drifts more than a crewed one.
    if (this.auto('helm')) {
      this.throttle = AUTO_HELM_THROTTLE;
      const gate = this.gates[0];
      if (gate) {
        // Poor slipstream attempt: crawl toward the ring's bearing. The step
        // is small enough that only near-heading rings are catchable — a
        // human helm still earns the far ones.
        const delta = gate.bearing - this.alignment;
        const step = Math.min(Math.abs(delta), AUTO_HELM_GATE_STEP * dt);
        this.alignment += sign(delta) * step;
      } else {
        // No rings up: ease back onto the course line.
        const correction = Math.min(Math.abs(this.alignment), AUTO_HELM_CORRECTION * dt);
        this.alignment -= sign(this.alignment) * correction;
      }
    }

    // Speed derives from throttle, effective engine power, course alignment,
    // and the mission's speed scale (longer trips = lower scale).
    const alignFactor = 1 - 0.6 * Math.min(1, Math.abs(this.alignment) / 100);
    const shieldPenalty = this.shieldRaised ? SHIELD_ENGINE_PENALTY : 1;
    // A clean gate pass opens a short slipstream that multiplies speed.
    this.gateBoostTimer = Math.max(0, this.gateBoostTimer - dt);
    const slipstream = this.gateBoostTimer > 0 ? GATE_SLIPSTREAM_MULT : 1;
    this.speed = (this.throttle / 100) * (0.15 + 0.45 * (this.eff('engines') / POWER_MAX) * shieldPenalty) * alignFactor * m.speedScale * slipstream;
    this.progress = Math.min(100, this.progress + this.speed * dt);

    // Shields: recharge (scaled by shield power) only while lowered; bleed a
    // fixed upkeep while raised. Weapon charge always scales with weapon power.
    if (this.shieldRaised) {
      this.shieldStrength = Math.max(0, this.shieldStrength - SHIELD_DRAIN_PER_SEC * dt);
    } else {
      this.shieldStrength = Math.min(SHIELD_MAX, this.shieldStrength + SHIELD_REGEN_PER_POWER * this.eff('shields') * dt);
    }
    // Laser recharge meter refills at a rate set by weapon power (100 = ready).
    this.charge = Math.min(100, this.charge + LASER_CHARGE_RATE * this.eff('weapons') * dt);
    // Track time spent sitting at full charge — unused firepower, surfaced as
    // the weapons console's chargeIdlePct in the per-console telemetry.
    if (this.charge >= 100) this.chargeFullTime += dt;

    // Telemetry accumulation (station-load measurements).
    if (this.shieldRaised) this.tel.shieldUptime += dt;
    for (const s of SYSTEMS) if (this.breakers[s] !== null) this.tel.breakerDowntime += dt;
    this.alignAbsSum += Math.abs(this.alignment);
    this.throttleSum += this.throttle;
    this.telSamples++;
    // Per-console effectiveness accumulators (sim-report metrics).
    if (Math.abs(this.alignment) <= ON_COURSE_THRESHOLD) this.onCourseTime += dt;
    this.powerUtilSum += SYSTEMS.reduce((sum, s) => sum + this.eff(s), 0);

    // Age tripped breakers; auto-engineering resets them after a delay.
    for (const s of SYSTEMS) {
      if (this.breakers[s] !== null) {
        this.breakers[s]! += dt;
        if (this.auto('engineering') && this.breakers[s]! > AUTO_ENG_RESET_AGE) this.resetBreaker(s);
      }
    }

    // Auto-engineering also re-allocates any unallocated power (e.g. after an
    // Emergency Warp zeroes it) toward a sensible default, so an unmanned
    // engineer can't leave the ship dead in the water.
    if (this.auto('engineering')) {
      const target: Record<SystemId, number> = { engines: 3, weapons: 2, shields: 1, sensors: 1 }; // mirrors the default split
      let spare = POWER_TOTAL - SYSTEMS.reduce((sum, s) => sum + this.power[s], 0);
      for (const s of SYSTEMS) {
        while (spare > 0 && this.power[s] < target[s]) { this.power[s]++; spare--; }
      }
    }

    // Auto-weapons: every shot lands, but only after a deliberate 1-2s pause
    // once the laser is charged and a target is in range — the CPU's cost is
    // TIME, not aim. A human engineer pumping weapon power shortens the wait
    // between shots, so the bot gunner visibly benefits from crew support.
    if (this.auto('weapons')) {
      // Only contacts the sensors have resolved can be engaged.
      const acquirable = this.asteroids.filter((a) => this.targetable(a));
      const closest = acquirable.length > 0
        ? [...acquirable].sort((a, b) => a.impactIn - b.impactIn)[0]
        : null;
      // Shield doctrine: raise only for a real volley (2+ rocks inside the
      // threat window); once the sky is clear of targetable contacts, keep
      // them up a linger beat, then drop to recharge.
      const imminent = acquirable.filter((a) => a.impactIn <= AUTO_SHIELD_THREAT_WINDOW).length;
      if (imminent >= AUTO_SHIELD_THREAT_COUNT) {
        this.shieldRaised = true;
        this.autoShieldClearAt = null; // threat live: cancel any pending drop
      } else if (acquirable.length === 0 && this.shieldRaised) {
        if (this.autoShieldClearAt === null) {
          this.autoShieldClearAt = this.missionTime + AUTO_SHIELD_LINGER;
        } else if (this.missionTime >= this.autoShieldClearAt) {
          this.shieldRaised = false;
          this.autoShieldClearAt = null;
        }
      } else {
        // Contacts remain (but no volley): hold the current shield state.
        this.autoShieldClearAt = null;
      }
      // Deliberate fire: once (charged && target in range) first holds, roll
      // the pause, then pull the trigger when the clock reaches it. Any break
      // in the condition (target destroyed/impacted, charge gone) re-arms it.
      if (closest && closest.impactIn <= AUTO_WEAPONS_REACT_RANGE && this.charge >= 100) {
        this.targetId = closest.id;
        this.recordAcquire(closest.id);
        if (this.autoFireAt === null) {
          this.autoFireAt = this.missionTime + range(this.rng, AUTO_WEAPONS_FIRE_DELAY);
        } else if (this.missionTime >= this.autoFireAt) {
          this.fire();
          this.autoFireAt = null;
        }
      } else {
        this.autoFireAt = null;
      }
    }

    // Scripted set pieces fire on time/progress marks.
    this.runScriptedEvents();

    // Advance asteroids (and gates) at the speed-scaled closing rate, times each
    // rock's own speed. Faster ship and faster rocks arrive sooner => less time.
    const closeRate = this.closeRate();
    for (const a of this.asteroids) a.impactIn -= dt * closeRate * a.speed;
    // Detection edge: announce a contact the first time sensors resolve it.
    // Record when it became targetable (for contact->acquire latency) and emit a
    // sensorContact fx so engineering — not the main screen — plays the ping.
    for (const a of this.asteroids) {
      if (!a.announced && this.targetable(a)) {
        a.announced = true;
        this.targetableSince.set(a.id, this.missionTime);
        this.pushFx({ kind: 'sensorContact' });
        this.event(`Sensor contact: asteroid ${a.label} acquired.`);
      }
    }
    const hits = this.asteroids.filter((a) => a.impactIn <= 0);
    this.asteroids = this.asteroids.filter((a) => a.impactIn > 0);
    for (const hit of hits) this.applyImpact(hit);
    if (this.targetId !== null && !this.asteroids.some((a) => a.id === this.targetId)) {
      this.targetId = null;
    }

    // Advance nav gates (on their own speed-coupled rate) and evaluate the ones
    // the ship reaches this tick. Easing the throttle slows their approach,
    // buying time to swing onto the bearing.
    const gateClose = this.gateCloseRate();
    for (const g of this.gates) g.reachIn -= dt * gateClose;
    const reached = this.gates.filter((g) => g.reachIn <= 0);
    this.gates = this.gates.filter((g) => g.reachIn > 0);
    for (const g of reached) this.evaluateGate(g);

    // Ambient spawning: rate scaled by weapons difficulty and scripted rate
    // multipliers, suppressed entirely during scripted calm stretches.
    this.spawnTimer -= dt;
    if (
      this.spawnTimer <= 0 &&
      this.asteroids.length < this.maxAsteroids() &&
      this.missionTime >= this.calmUntil
    ) {
      // Usually one rock, but sometimes a 2-3 cluster arrives in short order so
      // it isn't always one-at-a-time. Cluster rocks are staggered slightly and
      // still respect the concurrent cap.
      const burst = this.rng() < BURST_CHANCE ? (this.rng() < 0.4 ? 3 : 2) : 1;
      for (let i = 0; i < burst && this.asteroids.length < this.maxAsteroids(); i++) {
        this.spawnAsteroid(m.impactIn, m.asteroidDmg);
        if (i > 0) this.asteroids[this.asteroids.length - 1].impactIn -= i * range(this.rng, { min: 0.5, max: 2 });
      }
      this.spawnTimer = range(this.rng, m.spawnEvery) / (this.diff('weapons') * this.spawnRateMult);
    }

    // Trip breakers periodically, rate scaled by engineering difficulty.
    this.breakerTimer -= dt;
    if (this.breakerTimer <= 0) {
      this.tripBreaker();
      this.breakerTimer = range(this.rng, m.breakerEvery) / this.diff('engineering');
    }

    // Spawn nav gates periodically (rate scaled by helm difficulty — more gates
    // is more steering load), capped so the field ahead never floods.
    this.gateTimer -= dt;
    if (this.gateTimer <= 0 && this.gates.length < MAX_GATES) {
      this.spawnGate();
      this.gateTimer = range(this.rng, m.gateEvery ?? { min: 25, max: 40 }) / this.diff('helm');
    }

    // Narrative captain's log: comment on how the run is going.
    this.narrate();

    // End conditions.
    if (this.hull <= 0) this.finish('adrift');
    else if (this.progress >= 100) this.finish('arrived');
  }

  private applyImpact(a: Asteroid) {
    let remaining = a.dmg;
    // Raised shields soak damage first; the overflow hits the hull.
    if (this.shieldRaised && this.shieldStrength > 0) {
      const absorbed = Math.min(this.shieldStrength, remaining);
      this.shieldStrength -= absorbed;
      remaining -= absorbed;
    }
    this.hull = Math.max(0, this.hull - remaining);
    this.stats.impacts++;
    this.tel.hullDamageTaken += remaining;
    // Feed the captain's-log damage-burst detector (only real hull damage).
    if (remaining > 0) this.damageWindow.push({ t: this.missionTime, dmg: Math.round(remaining) });
    // A hull-damaging strike jolts a breaker loose — impacts, not the ambient
    // timer, are now the main source of engineering emergencies. Hits fully
    // absorbed by shields do NOT trip anything: good shield play spares the
    // engineer. The chance scales with the ENGINEERING seat's difficulty so
    // the knob really changes that console's workload: chill ~60% of hull
    // hits trip one, normal always trips one, intense always trips one and
    // half the time jolts a second loose.
    if (remaining > 0) {
      const engDiff = this.diff('engineering'); // 0.6 / 1 / 1.5
      if (this.rng() < Math.min(1, engDiff)) this.tripBreaker();
      if (engDiff > 1 && this.rng() < engDiff - 1) this.tripBreaker();
    }
    this.targetableSince.delete(a.id);
    this.tel.impactLog.push({ t: Math.round(this.missionTime), dmg: a.dmg, hullDmg: Math.round(remaining) });
    // Screen shake + sound scale off this on the main screen; absorbed hits get
    // a lighter shield-clang, hull hits a heavier jolt.
    this.pushFx({ kind: 'impact', hullDmg: Math.round(remaining), absorbed: remaining <= 0 });
    this.event(
      remaining > 0
        ? `IMPACT: ${a.label} hit the hull for ${Math.round(remaining)} damage!`
        : `${a.label} absorbed by shields.`,
    );
  }

  // Non-binary mission resolution: a score composed from hull, time, and
  // defensive performance maps to one of several narrative outcomes.
  private finish(outcome: 'arrived' | 'adrift') {
    const m = this.mission!;
    let score: number;
    let narrative: string;
    const { destroyed, impacts, dodged, gatesPassed, gatesMissed, warpsUsed, pulsesUsed } = this.stats;
    // Fiction hook: reference the crew's named ship where the story allows.
    const ship = this.shipName ? `the ${this.shipName}` : 'the ship';
    if (outcome === 'adrift') {
      // Even a lost ship gets partial credit for distance covered.
      score = Math.round(this.progress * 0.25);
      narrative = `Hull breach critical. ${ship.charAt(0).toUpperCase() + ship.slice(1)} went dark ${Math.round(this.progress)}% of the way to ${m.arrivalName}; a tow ship recovered the crew two days later. The cargo was not so lucky.`;
    } else {
      const timeScore = clamp(1.4 - this.missionTime / m.parTime, 0, 1);
      const shotsAtUs = destroyed + impacts + dodged;
      const defense = shotsAtUs === 0 ? 1 : destroyed / shotsAtUs;
      // Core score from surviving, arriving on time, and shooting well. Nav
      // gates are OFF the direct course (chasing them costs speed), so they're
      // an optional bonus (up to +8) rather than a tax you owe for existing.
      const base = 0.55 * this.hull + 22 * timeScore + 18 * defense;
      const gateBonus = Math.min(8, gatesPassed * 2);
      score = Math.min(100, Math.round(base + gateBonus));
      narrative =
        score >= 85 ? `A flawless run. ${m.arrivalName} dock crews applaud as ${ship} glides in.`
        : score >= 70 ? 'Solid work. Some scorch marks, but the cargo is intact and morale is high.'
        : score >= 50 ? `Mission accomplished — though ${ship} will spend a week in drydock.`
        : score >= 30 ? 'You made it, barely. The insurance adjusters would like a word.'
        : `${ship.charAt(0).toUpperCase() + ship.slice(1)} limps into dock, venting atmosphere. Nobody claps.`;
    }
    const grade =
      score >= 85 ? 'Legendary Run' :
      score >= 70 ? 'Commendable' :
      score >= 50 ? 'Mission Accomplished' :
      score >= 30 ? 'Pyrrhic Success' : 'Barely Survived';
    // Finalize telemetry averages.
    this.tel.avgAlignment = this.telSamples > 0 ? round1(this.alignAbsSum / this.telSamples) : 0;
    this.tel.avgThrottle = this.telSamples > 0 ? Math.round(this.throttleSum / this.telSamples) : 0;
    this.tel.breakerDowntime = round1(this.tel.breakerDowntime);
    this.tel.shieldUptime = round1(this.tel.shieldUptime);
    this.tel.hullDamageTaken = Math.round(this.tel.hullDamageTaken);
    this.tel.gatesPassed = this.stats.gatesPassed;
    this.tel.gatesMissed = this.stats.gatesMissed;
    this.tel.warpsUsed = this.stats.warpsUsed;
    this.tel.pulsesUsed = this.stats.pulsesUsed;
    // --- Per-console effectiveness + captain proxy (sim-report metrics) ---
    const gatesSeen = this.stats.gatesPassed + this.stats.gatesMissed;
    const gatePassRate = gatesSeen > 0 ? round2(this.stats.gatesPassed / gatesSeen) : 0;
    const shotsAtUs = this.stats.destroyed + this.stats.impacts;
    const defense = shotsAtUs === 0 ? 1 : round2(this.stats.destroyed / shotsAtUs);
    const hitRate = this.tel.shotsFired > 0 ? round2(this.stats.destroyed / this.tel.shotsFired) : 0;
    const neutralizedPct = shotsAtUs === 0 ? 1 : round2(this.threatsNeutralized / shotsAtUs);
    const avgAcquireLatency = this.acquireLatencies.length > 0
      ? round1(this.acquireLatencies.reduce((s, v) => s + v, 0) / this.acquireLatencies.length)
      : 0;
    const onCoursePct = this.missionTime > 0 ? round2(this.onCourseTime / this.missionTime) : 0;
    const avgPowerUtil = this.telSamples > 0 ? round2(this.powerUtilSum / this.telSamples / POWER_TOTAL) : 0;
    // Captain coordination: the crew outcomes a good caller drives — defense,
    // gate discipline, and how fast contacts get handed to weapons (a low
    // latency, normalized against a ~6s "slow" reference, reads as tight comms).
    const latencyScore = clamp(1 - avgAcquireLatency / 6, 0, 1);
    const coordinationScore = round2(0.45 * defense + 0.30 * gatePassRate + 0.25 * latencyScore);
    this.tel.perConsole = {
      helm: { gatePassRate, avgAlignmentError: this.tel.avgAlignment, onCoursePct },
      weapons: { hitRate, avgAcquireLatency, neutralizedPct, chargeIdlePct: this.missionTime > 0 ? round2(this.chargeFullTime / this.missionTime) : 0 },
      engineering: { avgPowerUtil, breakerDowntime: this.tel.breakerDowntime },
      captain: { coordinationScore, avgAcquireLatency, gatePassRate, defense },
    };
    this.debrief = {
      outcome,
      grade,
      score,
      narrative,
      missionId: m.id,
      missionName: m.name,
      shipName: this.shipName,
      seed: this.runSeed,
      stats: {
        time: Math.round(this.missionTime),
        hull: Math.round(this.hull),
        destroyed,
        impacts,
        dodged,
        breakersTripped: this.stats.breakersTripped,
        gatesPassed,
        gatesMissed,
        warpsUsed,
        pulsesUsed,
      },
      telemetry: this.tel,
      // Which seats were human-crewed and at what difficulty — needed to
      // interpret balance data (and, later, for persistent crew records).
      crew: Object.fromEntries(
        (['helm', 'engineering', 'weapons'] as SeatId[]).map((s) => [
          s,
          { difficulty: this.seats[s].difficulty, human: this.seats[s].playerId !== null },
        ]),
      ),
    };
    this.phase = 'debrief';
    this.event(outcome === 'arrived' ? `Docking complete at ${m.arrivalName}.` : 'The ship goes dark, adrift in the belt.');
  }

  // Log an event. It always enters the ship's rolling log (serialized, shown in
  // the main-screen HUD). `toast` controls whether it *also* fires onEvent — the
  // transient station toast. Ambient narrative beats pass toast:false so the
  // captain's log reads as a story without spamming crew screens with popups.
  private event(text: string, toast = true) {
    this.log.push({ t: Math.round(this.missionTime), text });
    if (this.log.length > 10) this.log.shift();
    if (toast) this.onEvent(text);
  }

  // Narrative captain's log: watches rolling windows and comments on the run as
  // it unfolds (kill clusters, damage bursts, a midpoint assessment, occasional
  // console effectiveness). Most lines are log-only (toast:false) so they read
  // as a story; only the genuine warnings pop a toast. Called each tick.
  private narrate() {
    const now = this.missionTime;
    // Kill cluster: several rocks destroyed in a short window.
    this.killTimes = this.killTimes.filter((t) => now - t <= NARRATE_KILL_WINDOW);
    if (this.killTimes.length >= NARRATE_KILL_COUNT && now - this.lastKillNote > NARRATE_NOTE_COOLDOWN) {
      this.lastKillNote = now;
      this.event(`Weapons clearing the field — ${this.killTimes.length} contacts down in seconds.`, false);
    }
    // Damage burst: heavy hull loss over a short window (a genuine warning => toast).
    this.damageWindow = this.damageWindow.filter((d) => now - d.t <= NARRATE_DMG_WINDOW);
    const recentDmg = this.damageWindow.reduce((sum, d) => sum + d.dmg, 0);
    if (recentDmg >= NARRATE_DMG_THRESHOLD && now - this.lastDamageNote > NARRATE_NOTE_COOLDOWN) {
      this.lastDamageNote = now;
      this.event(`Hull integrity falling fast — ${recentDmg} damage in a heartbeat!`, true);
    }
    // One-shot midpoint assessment, keyed off how the run is actually going.
    if (!this.narratedHalfway && this.progress >= 50) {
      this.narratedHalfway = true;
      const shotsAtUs = this.stats.destroyed + this.stats.impacts;
      const defense = shotsAtUs === 0 ? 1 : this.stats.destroyed / shotsAtUs;
      const assess =
        this.hull >= 75 && defense >= 0.7 ? 'Halfway home and barely a scratch — the crew is dialed in.'
        : this.hull >= 45 ? 'Halfway home. Taking some hits, but holding together.'
        : 'Halfway home and the hull is a mess — we need to tighten up or we won\'t make it.';
      this.event(assess, true);
    }
    // Occasional console-effectiveness note (RNG-gated, throttled, log-only).
    if (now - this.lastConsoleNote > NARRATE_CONSOLE_EVERY && this.rng() < 0.5) {
      this.lastConsoleNote = now;
      this.event(this.consoleNote(), false);
    }
  }

  // Record how long a contact sat resolved-but-unengaged before weapons locked
  // it — the core captain/weapons coordination signal. Only the first lock per
  // contact counts (delete on record so retargets don't double-count).
  private recordAcquire(id: number) {
    const since = this.targetableSince.get(id);
    if (since !== undefined) {
      this.acquireLatencies.push(this.missionTime - since);
      this.targetableSince.delete(id);
    }
  }

  // Pick a short observation about how one console is performing right now.
  private consoleNote(): string {
    const gatesSeen = this.stats.gatesPassed + this.stats.gatesMissed;
    const shots = this.tel.shotsFired;
    const anyTripped = SYSTEMS.some((s) => this.breakers[s] !== null);
    const options: string[] = [];
    if (gatesSeen >= 2) {
      options.push(this.stats.gatesPassed / gatesSeen >= 0.6
        ? 'Helm is threading the nav gates cleanly — good hands on the stick.'
        : 'Helm keeps missing the nav approaches — ease the throttle to buy time on the rings.');
    }
    if (shots >= 3) {
      options.push(this.stats.destroyed / Math.max(1, shots) >= 0.6
        ? 'Weapons is making shots count — most contacts never reach us.'
        : 'Weapons is burning charge on wide shots — steady the aim.');
    }
    options.push(anyTripped
      ? 'Engineering scrambling — a breaker is down and that system is dark.'
      : 'Engineering keeping the grid steady — power holding across the board.');
    return options[Math.floor(this.rng() * options.length)];
  }

  // Snapshot sent to every client after each tick. Floats are rounded to keep
  // the payload small and rendering stable.
  serialize() {
    return {
      phase: this.phase,
      mission: this.mission
        ? { id: this.mission.id, name: this.mission.name, arrivalName: this.mission.arrivalName, briefing: this.mission.briefing, destination: this.mission.destination ?? null }
        : null,
      shipName: this.shipName,
      missionTime: Math.round(this.missionTime),
      // Target duration of a well-executed run (seconds) — drives the music
      // build arc on the main screen (build over ~180s, then hold/pad longer).
      missionLength: this.mission?.targetSeconds ?? 180,
      progress: round1(this.progress),
      hull: Math.round(this.hull),
      // strength is a % of SHIELD_MAX, not an absolute point count — the UI
      // meter has always just rendered this as a 0-100 bar width.
      shields: { raised: this.shieldRaised, strength: Math.round((this.shieldStrength / SHIELD_MAX) * 100) },
      power: this.power,
      breakers: Object.fromEntries(SYSTEMS.map((s) => [s, this.breakers[s] !== null])) as Record<SystemId, boolean>,
      throttle: Math.round(this.throttle),
      alignment: round1(this.alignment),
      speed: round1(this.speed * 100), // display units
      debug: this.debug,
      timeScale: this.timeScale,
      // charge is the laser recharge meter (100 = ready to fire).
      charge: Math.round(this.charge),
      targetId: this.targetId,
      warpReadyIn: round1(this.warpCd),
      // Passive sensor range in seconds; sensor pulse readiness for engineering.
      sensorRange: round1(this.sensorRange()),
      sensorPulseReadyIn: round1(this.sensorPulseCd),
      // Contacts carry size/speed (for main-screen threat read-out) and whether
      // sensors have resolved them yet (targetable on the weapons scope).
      asteroids: this.asteroids.map((a) => ({
        id: a.id, label: a.label, impactIn: round1(a.impactIn), dmg: a.dmg,
        size: round1(a.size), speed: round1(a.speed), targetable: this.targetable(a),
        bearing: Math.round(a.bearing),
      })),
      gates: this.gates.map((g) => ({ id: g.id, label: g.label, reachIn: round1(g.reachIn), bearing: Math.round(g.bearing) })),
      fx: this.fx,
      seats: Object.fromEntries(
        (Object.keys(this.seats) as SeatId[]).map((s) => [
          s,
          {
            name: this.seats[s].name,
            connected: this.seats[s].connected,
            claimed: this.seats[s].playerId !== null,
            difficulty: this.seats[s].difficulty,
          },
        ]),
      ),
      log: this.log,
      debrief: this.debrief,
    };
  }
}

// --- small helpers ---
function freshTelemetry(): Telemetry {
  return {
    asteroidsSpawned: 0,
    shotsFired: 0,
    powerChanges: 0,
    breakerDowntime: 0,
    shieldUptime: 0,
    hullDamageTaken: 0,
    impactLog: [],
    avgAlignment: 0,
    avgThrottle: 0,
    gatesPassed: 0,
    gatesMissed: 0,
    warpsUsed: 0,
    pulsesUsed: 0,
    perConsole: {
      helm: { gatePassRate: 0, avgAlignmentError: 0, onCoursePct: 0 },
      weapons: { hitRate: 0, avgAcquireLatency: 0, neutralizedPct: 0, chargeIdlePct: 0 },
      engineering: { avgPowerUtil: 0, breakerDowntime: 0 },
      captain: { coordinationScore: 0, avgAcquireLatency: 0, gatePassRate: 0, defense: 0 },
    },
  };
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function sign(v: number): number {
  return v < 0 ? -1 : 1;
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
