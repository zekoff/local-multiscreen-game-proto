// Core game engine: authoritative mission state for one ship (one room).
// The server owns one Game instance per room, ticks it at a fixed rate, and
// broadcasts the serialized state to all connected clients after each tick.

export type Phase = 'lobby' | 'active' | 'debrief';
export type SeatId = 'helm' | 'engineering' | 'weapons' | 'main';
export type SystemId = 'engines' | 'shields' | 'weapons';
export type Difficulty = 'chill' | 'normal' | 'intense';

// Difficulty multiplies the burden a station must handle (drift rate for helm,
// breaker trip rate for engineering, asteroid spawn rate for weapons).
const DIFF_MULT: Record<Difficulty, number> = { chill: 0.6, normal: 1, intense: 1.5 };

// Crew seats that map to actual control stations (main screen is view-only).
const CREW_SEATS: SeatId[] = ['helm', 'engineering', 'weapons'];
const SYSTEMS: SystemId[] = ['engines', 'shields', 'weapons'];

// Tuning constants for the prototype mission ("Supply Run to Station Epsilon").
const POWER_TOTAL = 6;      // total power units engineering can allocate
const POWER_MAX = 4;        // max units a single system can hold
const FIRE_COST = 35;       // weapon charge consumed per shot
const EVASIVE_COOLDOWN = 18; // seconds between evasive maneuvers
const MAX_ASTEROIDS = 4;    // concurrent asteroid cap
const PAR_TIME = 260;       // seconds; used for the debrief time score

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

export interface Debrief {
  outcome: 'arrived' | 'adrift';
  grade: string;
  score: number;
  narrative: string;
  stats: {
    time: number;
    hull: number;
    destroyed: number;
    impacts: number;
    dodged: number;
    breakersTripped: number;
  };
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

  // --- Mission state (reset by start()) ---
  missionTime = 0;
  progress = 0;          // 0..100, distance to Station Epsilon
  hull = 100;
  shieldRaised = false;
  shieldStrength = 100;
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
  private driftBias = 0;      // slow persistent drift the helm must fight
  private driftBiasTimer = 0;
  private stats = { destroyed: 0, impacts: 0, dodged: 0, breakersTripped: 0 };
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

  start() {
    if (this.phase === 'active') return;
    // Reset all mission state for a fresh run.
    this.phase = 'active';
    this.missionTime = 0;
    this.progress = 0;
    this.hull = 100;
    this.shieldRaised = false;
    this.shieldStrength = 100;
    this.power = { engines: 2, shields: 2, weapons: 2 };
    this.breakers = { engines: null, shields: null, weapons: null };
    this.throttle = 0;
    this.alignment = 0;
    this.charge = 100;
    this.targetId = null;
    this.evasiveCd = 0;
    this.asteroids = [];
    this.debrief = null;
    this.spawnTimer = 10;
    this.breakerTimer = 22;
    this.driftBias = 0;
    this.driftBiasTimer = 0;
    this.stats = { destroyed: 0, impacts: 0, dodged: 0, breakersTripped: 0 };
    this.log = [];
    this.event('Mission start: supply run to Station Epsilon. Godspeed.');
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
    this.alignment = clamp(this.alignment + sign(Math.random() - 0.5) * (20 + Math.random() * 20), -100, 100);
    this.evasiveCd = EVASIVE_COOLDOWN;
    this.event(dodged.length > 0 ? `Evasive maneuver! Dodged ${dodged.length} asteroid(s).` : 'Evasive maneuver — nothing in close range.');
  }

  private fire() {
    if (this.charge < FIRE_COST) return;
    const target = this.asteroids.find((a) => a.id === this.targetId);
    if (!target) return;
    this.charge -= FIRE_COST;
    this.asteroids = this.asteroids.filter((a) => a.id !== target.id);
    this.targetId = null;
    this.stats.destroyed++;
    this.event(`Direct hit! ${target.label} destroyed.`);
  }

  // Effective power for a system: allocated units, halved while its breaker is tripped.
  private eff(system: SystemId): number {
    return this.power[system] * (this.breakers[system] !== null ? 0.5 : 1);
  }

  // --- Simulation tick (dt in seconds) ---

  tick(dt: number) {
    if (this.phase !== 'active') return;
    this.missionTime += dt;
    this.evasiveCd = Math.max(0, this.evasiveCd - dt);

    // Course drift: a slowly-changing bias plus jitter, scaled by helm difficulty.
    this.driftBiasTimer -= dt;
    if (this.driftBiasTimer <= 0) {
      this.driftBias = (Math.random() * 2 - 1) * 2.5 * this.diff('helm');
      this.driftBiasTimer = 6 + Math.random() * 8;
    }
    this.alignment = clamp(this.alignment + (this.driftBias + (Math.random() * 2 - 1) * 2.0) * dt, -100, 100);

    // Auto-helm: hold throttle and gently steer back on course.
    if (this.auto('helm')) {
      this.throttle = 80;
      const correction = Math.min(Math.abs(this.alignment), 8 * dt);
      this.alignment -= sign(this.alignment) * correction;
    }

    // Speed derives from throttle, effective engine power, and course alignment.
    const alignFactor = 1 - 0.6 * Math.min(1, Math.abs(this.alignment) / 100);
    this.speed = (this.throttle / 100) * (0.15 + 0.45 * (this.eff('engines') / POWER_MAX)) * alignFactor;
    this.progress = Math.min(100, this.progress + this.speed * dt);

    // Shield regen and weapon charge scale with their allocated power.
    this.shieldStrength = Math.min(100, this.shieldStrength + 0.5 * this.eff('shields') * dt);
    this.charge = Math.min(100, this.charge + 2.5 * this.eff('weapons') * dt);

    // Age tripped breakers; auto-engineering resets them after a delay.
    for (const s of SYSTEMS) {
      if (this.breakers[s] !== null) {
        this.breakers[s]! += dt;
        if (this.auto('engineering') && this.breakers[s]! > 6) this.resetBreaker(s);
      }
    }

    // Auto-weapons: keep shields up and shoot the most urgent asteroid.
    if (this.auto('weapons')) {
      this.shieldRaised = true;
      if (this.charge >= FIRE_COST && this.asteroids.length > 0) {
        this.targetId = [...this.asteroids].sort((a, b) => a.impactIn - b.impactIn)[0].id;
        this.fire();
      }
    }

    // Advance asteroids and apply impacts.
    for (const a of this.asteroids) a.impactIn -= dt;
    const hits = this.asteroids.filter((a) => a.impactIn <= 0);
    this.asteroids = this.asteroids.filter((a) => a.impactIn > 0);
    for (const hit of hits) this.applyImpact(hit);
    if (this.targetId !== null && !this.asteroids.some((a) => a.id === this.targetId)) {
      this.targetId = null;
    }

    // Spawn new asteroids, rate scaled by weapons difficulty.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.asteroids.length < MAX_ASTEROIDS) {
      const id = this.nextAsteroidId++;
      this.asteroids.push({
        id,
        label: `AST-${String(id).padStart(3, '0')}`,
        impactIn: 14 + Math.random() * 8,
        dmg: Math.round(10 + Math.random() * 10),
      });
      this.event(`Sensor contact: asteroid ${this.asteroids[this.asteroids.length - 1].label} inbound.`);
      this.spawnTimer = (9 + Math.random() * 7) / this.diff('weapons');
    }

    // Trip breakers periodically, rate scaled by engineering difficulty.
    this.breakerTimer -= dt;
    if (this.breakerTimer <= 0) {
      const ok = SYSTEMS.filter((s) => this.breakers[s] === null);
      if (ok.length > 0) {
        const victim = ok[Math.floor(Math.random() * ok.length)];
        this.breakers[victim] = 0;
        this.stats.breakersTripped++;
        this.event(`Breaker tripped: ${victim} at half power!`);
      }
      this.breakerTimer = (18 + Math.random() * 12) / this.diff('engineering');
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
    this.event(
      remaining > 0
        ? `IMPACT: ${a.label} hit the hull for ${Math.round(remaining)} damage!`
        : `${a.label} absorbed by shields.`,
    );
  }

  // Non-binary mission resolution: a score composed from hull, time, and
  // defensive performance maps to one of several narrative outcomes.
  private finish(outcome: 'arrived' | 'adrift') {
    let score: number;
    let narrative: string;
    const { destroyed, impacts, dodged } = this.stats;
    if (outcome === 'adrift') {
      // Even a lost ship gets partial credit for distance covered.
      score = Math.round(this.progress * 0.25);
      narrative = 'Hull breach critical. The crew was recovered by a tow ship two days later — the cargo was not.';
    } else {
      const timeScore = clamp(1.4 - this.missionTime / PAR_TIME, 0, 1);
      const shotsAtUs = destroyed + impacts + dodged;
      const defense = shotsAtUs === 0 ? 1 : destroyed / shotsAtUs;
      score = Math.round(0.55 * this.hull + 25 * timeScore + 20 * defense);
      narrative =
        score >= 85 ? 'A flawless run. Station Epsilon dock crews applaud as you glide in.'
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
    this.debrief = {
      outcome,
      grade,
      score,
      narrative,
      stats: {
        time: Math.round(this.missionTime),
        hull: Math.round(this.hull),
        destroyed,
        impacts,
        dodged,
        breakersTripped: this.stats.breakersTripped,
      },
    };
    this.phase = 'debrief';
    this.event(outcome === 'arrived' ? 'Docking complete at Station Epsilon.' : 'The ship goes dark, adrift in the belt.');
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
      missionTime: Math.round(this.missionTime),
      progress: round1(this.progress),
      hull: Math.round(this.hull),
      shields: { raised: this.shieldRaised, strength: Math.round(this.shieldStrength) },
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
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function sign(v: number): number {
  return v < 0 ? -1 : 1;
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
