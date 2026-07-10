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
export type SeatId = 'helm' | 'engineering' | 'weapons' | 'main';
export type Difficulty = 'chill' | 'normal' | 'intense';
export type { SystemId } from './mission.js';

// Difficulty multiplies the burden a station must handle (drift rate for helm,
// breaker trip rate for engineering, asteroid spawn rate for weapons).
const DIFF_MULT: Record<Difficulty, number> = { chill: 0.6, normal: 1, intense: 1.5 };

const SYSTEMS: SystemId[] = ['engines', 'shields', 'weapons'];

// Ship-constant tuning (mission-independent; per-mission knobs live in MissionDef).
const POWER_TOTAL = 6;      // total power units engineering can allocate
const POWER_MAX = 4;        // max units a single system can hold
const FIRE_COST = 35;       // weapon charge consumed per shot
const EVASIVE_COOLDOWN = 18; // seconds between evasive maneuvers
// Auto-weapons is a survival net for an abandoned seat, not an optimal
// gunner: it waits for a contact to be genuinely close, then still whiffs
// some shots. Keeps the weapons seat meaningfully better than empty.
const AUTO_WEAPONS_REACT_RANGE = 8;  // seconds-to-impact before auto-turret engages
const AUTO_WEAPONS_MISS_CHANCE = 0.2; // fraction of auto shots that go wide
// Raised shields draw off the drive: a real power-triage tradeoff instead of
// a free defensive toggle.
const SHIELD_ENGINE_PENALTY = 0.85;
// Shields are tracked internally in absolute points (0..SHIELD_MAX) and
// serialized to clients as a 0-100 percentage of that cap, so the UI meter
// keeps reading as a plain percentage regardless of the cap's value. A lower
// cap and slower regen mean a shield can actually be worn down by a burst,
// rather than always sitting near full between sparse hits.
const SHIELD_MAX = 35;
const SHIELD_REGEN_PER_POWER = 0.25; // shield points/s per allocated power unit (was 0.5)

export interface Asteroid {
  id: number;
  label: string;    // human-readable callsign, e.g. "AST-042"
  impactIn: number; // seconds until impact
  dmg: number;      // damage dealt on impact
}

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
  evasivesUsed: number;
  powerChanges: number;
  breakerDowntime: number; // system-seconds spent tripped
  shieldUptime: number;    // seconds with shields raised
  hullDamageTaken: number;
  impactLog: { t: number; dmg: number; hullDmg: number }[];
  avgAlignment: number;    // mean |alignment| over the run (helm load)
  avgThrottle: number;
}

export interface Debrief {
  outcome: 'arrived' | 'adrift';
  grade: string;
  score: number;
  narrative: string;
  missionId: string;
  missionName: string;
  seed: number;           // (missionId, seed) reproduces the run's randomness
  stats: {
    time: number;
    hull: number;
    destroyed: number;
    impacts: number;
    dodged: number;
    breakersTripped: number;
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
  power: Record<SystemId, number> = { engines: 2, shields: 2, weapons: 2 };
  breakers: Record<SystemId, number | null> = { engines: null, shields: null, weapons: null }; // trip age in seconds, null = ok
  throttle = 0;          // 0..100
  alignment = 0;         // -100..100, 0 = on course
  speed = 0;             // derived, progress units per second
  charge = 100;          // weapon charge 0..100
  targetId: number | null = null;
  evasiveCd = 0;         // seconds until evasive is ready
  asteroids: Asteroid[] = [];
  debrief: Debrief | null = null;

  private nextAsteroidId = 1;
  private spawnTimer = 10;
  private breakerTimer = 22;
  private spawnRateMult = 1;  // scripted 'spawnRate' actions replace this
  private calmUntil = 0;      // missionTime before which ambient spawns pause
  private firedEvents = new Set<string>(); // scripted events that already ran
  private driftBias = 0;      // slow persistent drift the helm must fight
  private driftBiasTimer = 0;
  private stats = { destroyed: 0, impacts: 0, dodged: 0, breakersTripped: 0 };
  private tel: Telemetry = freshTelemetry();
  private alignAbsSum = 0;
  private throttleSum = 0;
  private telSamples = 0;
  private log: { t: number; text: string }[] = [];

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
  start(def: MissionDef, seed?: number) {
    if (this.phase === 'active') return;
    this.mission = def;
    this.runSeed = seed ?? randomSeed();
    this.rng = mulberry32(this.runSeed);
    // Reset all mission state for a fresh run.
    this.phase = 'active';
    this.missionTime = 0;
    this.progress = 0;
    this.hull = 100;
    this.shieldRaised = false;
    this.shieldStrength = SHIELD_MAX;
    this.power = { engines: 2, shields: 2, weapons: 2 };
    this.breakers = { engines: null, shields: null, weapons: null };
    this.throttle = 0;
    this.alignment = 0;
    this.charge = 100;
    this.targetId = null;
    this.evasiveCd = 0;
    this.asteroids = [];
    this.debrief = null;
    this.spawnTimer = range(this.rng, def.spawnEvery);
    this.breakerTimer = range(this.rng, def.breakerEvery);
    this.spawnRateMult = 1;
    this.calmUntil = 0;
    this.firedEvents = new Set();
    this.driftBias = 0;
    this.driftBiasTimer = 0;
    this.stats = { destroyed: 0, impacts: 0, dodged: 0, breakersTripped: 0 };
    this.tel = freshTelemetry();
    this.alignAbsSum = 0;
    this.throttleSum = 0;
    this.telSamples = 0;
    this.log = [];
    this.event(`Mission start: ${def.name}. Godspeed.`);
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
    // Each action kind is only honored from the seat that owns it.
    if (seat === 'helm') {
      if (a.kind === 'throttle' && typeof a.value === 'number') {
        this.throttle = Math.max(0, Math.min(100, a.value));
      } else if (a.kind === 'nudge' && (a.dir === -1 || a.dir === 1)) {
        this.alignment = clamp(this.alignment + 10 * (a.dir as number), -100, 100);
      } else if (a.kind === 'evasive') {
        this.doEvasive();
      }
    } else if (seat === 'engineering') {
      if (a.kind === 'power' && SYSTEMS.includes(a.system as SystemId) && (a.delta === -1 || a.delta === 1)) {
        this.adjustPower(a.system as SystemId, a.delta as number);
      } else if (a.kind === 'resetBreaker' && SYSTEMS.includes(a.system as SystemId)) {
        this.resetBreaker(a.system as SystemId);
      }
    } else if (seat === 'weapons') {
      if (a.kind === 'target' && typeof a.id === 'number') {
        if (this.asteroids.some((x) => x.id === a.id)) this.targetId = a.id as number;
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

  private doEvasive() {
    if (this.evasiveCd > 0) return;
    // Evasive clears anything about to hit, but throws the ship off course.
    const dodged = this.asteroids.filter((a) => a.impactIn <= 5);
    this.asteroids = this.asteroids.filter((a) => a.impactIn > 5);
    this.stats.dodged += dodged.length;
    this.tel.evasivesUsed++;
    this.alignment = clamp(this.alignment + sign(this.rng() - 0.5) * (20 + this.rng() * 20), -100, 100);
    this.evasiveCd = EVASIVE_COOLDOWN;
    this.event(dodged.length > 0 ? `Evasive maneuver! Dodged ${dodged.length} asteroid(s).` : 'Evasive maneuver — nothing in close range.');
  }

  private fire() {
    if (this.charge < FIRE_COST) return;
    const target = this.asteroids.find((a) => a.id === this.targetId);
    if (!target) return;
    this.charge -= FIRE_COST;
    this.tel.shotsFired++;
    this.asteroids = this.asteroids.filter((a) => a.id !== target.id);
    this.targetId = null;
    this.stats.destroyed++;
    this.event(`Direct hit! ${target.label} destroyed.`);
  }

  // Effective power for a system: allocated units, halved while its breaker is tripped.
  private eff(system: SystemId): number {
    return this.power[system] * (this.breakers[system] !== null ? 0.5 : 1);
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
    }
  }

  private spawnAsteroid(impactIn: { min: number; max: number }, dmg: { min: number; max: number }) {
    const id = this.nextAsteroidId++;
    const a: Asteroid = {
      id,
      label: `AST-${String(id).padStart(3, '0')}`,
      impactIn: range(this.rng, impactIn),
      dmg: Math.round(range(this.rng, dmg)),
    };
    this.asteroids.push(a);
    this.tel.asteroidsSpawned++;
    this.event(`Sensor contact: asteroid ${a.label} inbound.`);
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
    const m = this.mission;
    this.missionTime += dt;
    this.evasiveCd = Math.max(0, this.evasiveCd - dt);

    // Course drift: a slowly-changing bias plus jitter, scaled by the
    // mission's drift pressure and the helm seat's difficulty.
    const driftScale = m.driftScale * this.diff('helm');
    this.driftBiasTimer -= dt;
    if (this.driftBiasTimer <= 0) {
      this.driftBias = (this.rng() * 2 - 1) * 2.5 * driftScale;
      this.driftBiasTimer = 6 + this.rng() * 8;
    }
    this.alignment = clamp(this.alignment + (this.driftBias + (this.rng() * 2 - 1) * 2.0) * dt, -100, 100);

    // Auto-helm: hold throttle and gently steer back on course.
    if (this.auto('helm')) {
      this.throttle = 80;
      const correction = Math.min(Math.abs(this.alignment), 8 * dt);
      this.alignment -= sign(this.alignment) * correction;
    }

    // Speed derives from throttle, effective engine power, course alignment,
    // and the mission's speed scale (longer trips = lower scale).
    const alignFactor = 1 - 0.6 * Math.min(1, Math.abs(this.alignment) / 100);
    const shieldPenalty = this.shieldRaised ? SHIELD_ENGINE_PENALTY : 1;
    this.speed = (this.throttle / 100) * (0.15 + 0.45 * (this.eff('engines') / POWER_MAX) * shieldPenalty) * alignFactor * m.speedScale;
    this.progress = Math.min(100, this.progress + this.speed * dt);

    // Shield regen and weapon charge scale with their allocated power.
    this.shieldStrength = Math.min(SHIELD_MAX, this.shieldStrength + SHIELD_REGEN_PER_POWER * this.eff('shields') * dt);
    this.charge = Math.min(100, this.charge + 2.5 * this.eff('weapons') * dt);

    // Telemetry accumulation (station-load measurements).
    if (this.shieldRaised) this.tel.shieldUptime += dt;
    for (const s of SYSTEMS) if (this.breakers[s] !== null) this.tel.breakerDowntime += dt;
    this.alignAbsSum += Math.abs(this.alignment);
    this.throttleSum += this.throttle;
    this.telSamples++;

    // Age tripped breakers; auto-engineering resets them after a delay.
    for (const s of SYSTEMS) {
      if (this.breakers[s] !== null) {
        this.breakers[s]! += dt;
        if (this.auto('engineering') && this.breakers[s]! > 6) this.resetBreaker(s);
      }
    }

    // Auto-weapons: keep shields up, but only engage once a contact is close
    // (reaction latency) and sometimes miss (accuracy penalty) — an unmanned
    // seat survives, it doesn't perform like a crewed one.
    if (this.auto('weapons')) {
      this.shieldRaised = true;
      const closest = this.asteroids.length > 0
        ? [...this.asteroids].sort((a, b) => a.impactIn - b.impactIn)[0]
        : null;
      if (closest && closest.impactIn <= AUTO_WEAPONS_REACT_RANGE && this.charge >= FIRE_COST) {
        this.targetId = closest.id;
        if (this.rng() < AUTO_WEAPONS_MISS_CHANCE) {
          // Shot goes wide: charge is spent but the target survives.
          this.charge -= FIRE_COST;
          this.tel.shotsFired++;
          this.targetId = null;
          this.event(`Auto-turret shot goes wide — ${closest.label} still inbound!`);
        } else {
          this.fire();
        }
      }
    }

    // Scripted set pieces fire on time/progress marks.
    this.runScriptedEvents();

    // Advance asteroids and apply impacts.
    for (const a of this.asteroids) a.impactIn -= dt;
    const hits = this.asteroids.filter((a) => a.impactIn <= 0);
    this.asteroids = this.asteroids.filter((a) => a.impactIn > 0);
    for (const hit of hits) this.applyImpact(hit);
    if (this.targetId !== null && !this.asteroids.some((a) => a.id === this.targetId)) {
      this.targetId = null;
    }

    // Ambient spawning: rate scaled by weapons difficulty and scripted rate
    // multipliers, suppressed entirely during scripted calm stretches.
    this.spawnTimer -= dt;
    if (
      this.spawnTimer <= 0 &&
      this.asteroids.length < m.maxAsteroids &&
      this.missionTime >= this.calmUntil
    ) {
      this.spawnAsteroid(m.impactIn, m.asteroidDmg);
      this.spawnTimer = range(this.rng, m.spawnEvery) / (this.diff('weapons') * this.spawnRateMult);
    }

    // Trip breakers periodically, rate scaled by engineering difficulty.
    this.breakerTimer -= dt;
    if (this.breakerTimer <= 0) {
      this.tripBreaker();
      this.breakerTimer = range(this.rng, m.breakerEvery) / this.diff('engineering');
    }

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
    this.tel.impactLog.push({ t: Math.round(this.missionTime), dmg: a.dmg, hullDmg: Math.round(remaining) });
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
    const { destroyed, impacts, dodged } = this.stats;
    if (outcome === 'adrift') {
      // Even a lost ship gets partial credit for distance covered.
      score = Math.round(this.progress * 0.25);
      narrative = 'Hull breach critical. The crew was recovered by a tow ship two days later — the cargo was not.';
    } else {
      const timeScore = clamp(1.4 - this.missionTime / m.parTime, 0, 1);
      const shotsAtUs = destroyed + impacts + dodged;
      const defense = shotsAtUs === 0 ? 1 : destroyed / shotsAtUs;
      score = Math.round(0.55 * this.hull + 25 * timeScore + 20 * defense);
      narrative =
        score >= 85 ? `A flawless run. ${m.arrivalName} dock crews applaud as you glide in.`
        : score >= 70 ? 'Solid work. Some scorch marks, but the cargo is intact and morale is high.'
        : score >= 50 ? 'Mission accomplished — though the ship will spend a week in drydock.'
        : score >= 30 ? 'You made it, barely. The insurance adjusters would like a word.'
        : 'The ship limps into dock, venting atmosphere. Nobody claps.';
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
    this.debrief = {
      outcome,
      grade,
      score,
      narrative,
      missionId: m.id,
      missionName: m.name,
      seed: this.runSeed,
      stats: {
        time: Math.round(this.missionTime),
        hull: Math.round(this.hull),
        destroyed,
        impacts,
        dodged,
        breakersTripped: this.stats.breakersTripped,
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

  private event(text: string) {
    this.log.push({ t: Math.round(this.missionTime), text });
    if (this.log.length > 10) this.log.shift();
    this.onEvent(text);
  }

  // Snapshot sent to every client after each tick. Floats are rounded to keep
  // the payload small and rendering stable.
  serialize() {
    return {
      phase: this.phase,
      mission: this.mission
        ? { id: this.mission.id, name: this.mission.name, arrivalName: this.mission.arrivalName, briefing: this.mission.briefing }
        : null,
      missionTime: Math.round(this.missionTime),
      progress: round1(this.progress),
      hull: Math.round(this.hull),
      // strength is a % of SHIELD_MAX, not an absolute point count — the UI
      // meter has always just rendered this as a 0-100 bar width.
      shields: { raised: this.shieldRaised, strength: Math.round((this.shieldStrength / SHIELD_MAX) * 100) },
      power: this.power,
      breakers: {
        engines: this.breakers.engines !== null,
        shields: this.breakers.shields !== null,
        weapons: this.breakers.weapons !== null,
      },
      throttle: Math.round(this.throttle),
      alignment: round1(this.alignment),
      speed: round1(this.speed * 100), // display units
      charge: Math.round(this.charge),
      fireCost: FIRE_COST,
      targetId: this.targetId,
      evasiveReadyIn: round1(this.evasiveCd),
      asteroids: this.asteroids.map((a) => ({ id: a.id, label: a.label, impactIn: round1(a.impactIn), dmg: a.dmg })),
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
    evasivesUsed: 0,
    powerChanges: 0,
    breakerDowntime: 0,
    shieldUptime: 0,
    hullDamageTaken: 0,
    impactLog: [],
    avgAlignment: 0,
    avgThrottle: 0,
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
