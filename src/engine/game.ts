// Core game engine: authoritative mission state for one ship (one room).
// A transport (Node server or Cloudflare Durable Object) owns one Game
// instance per room, ticks it at a fixed rate, and broadcasts the serialized
// state to all connected clients after each tick.
//
// The engine is runtime-agnostic: engine-internal imports only, no transport
// or platform knowledge. Missions arrive as data (MissionDef) — see
// mission-registry.ts for how start requests resolve.

import type { MissionDef, EventAction, SystemId, ContactKind, EmergencyKind } from './mission.js';
import { mulberry32, range, randomSeed, type Rng } from './rng.js';

export type Phase = 'lobby' | 'active' | 'debrief';
// 'main' and 'supervisor' are non-crew, view-only seats (multiple allowed);
// 'supervisor' is the debug/sim-control role. Crew seats are the other four
// (helm/engineering/weapons/crewchief).
export type SeatId = 'helm' | 'engineering' | 'weapons' | 'crewchief' | 'main' | 'supervisor';
// Two engagement settings. 'officer' is the default and the balance target
// (formerly 'normal'); 'cruise' is the lighter workload (formerly 'chill').
// The old three-state chill/normal/intense collapsed to these two — Cruise may
// later also drop widgets on some consoles (deferred forward work).
export type Difficulty = 'cruise' | 'officer';
export type { SystemId } from './mission.js';

// The crew seats that hold an exclusive station, run auto-assist when unmanned,
// and appear in the debrief crew record. Kept as one list so seat-shaped loops
// (construction, crew map) don't re-hardcode the four names.
const CREW_SEATS: SeatId[] = ['helm', 'engineering', 'weapons', 'crewchief'];

// Difficulty multiplies the burden a station must handle (drift rate for helm,
// breaker trip rate for engineering, asteroid spawn rate for weapons). Officer
// is the 1.0 baseline everything is tuned against; Cruise lightens the load.
const DIFF_MULT: Record<Difficulty, number> = { cruise: 0.6, officer: 1 };

// Powered systems (allocated by engineering from the shared pool). Sensors and
// tractor are engineering-powered but *operated* from other consoles (weapons
// scope; Crew Chief) — power is one console's job, use is another's, which is
// the cooperation the design leans on. Nearly all system-shaped logic keys off
// this array, so adding a member propagates through power/breakers/serialize.
const SYSTEMS: SystemId[] = ['engines', 'shields', 'weapons', 'sensors'];

// Ship-constant tuning (mission-independent; per-mission knobs live in MissionDef).
// Pool raised 6 -> 7 post-playtest ("one more engine allocation point"): the
// extra unit lands on engines in the default split. Per-system cap stays 4, so
// speed/turn normalization (eff/POWER_MAX) is untouched.
// Tractor was briefly a fifth powered system (pool 8) but that added an odd,
// exploitable channel (always dump weapons/pump tractor while towing). It's now
// folded back into WEAPONS power (shared emitter), so the pool returns to 7 over
// the original four systems.
const POWER_TOTAL = 7;      // total power units engineering can allocate
const POWER_MAX = 4;        // max units a single system can hold

// Laser: no battery bank and no fixed cooldown. `charge` (0-100) is simply the
// recharge meter — firing empties it and it refills at a rate set by weapon
// power, so the "cooldown" is emergent (higher weapon power = faster refire).
// Halved from the first pass so the laser feels like a deliberate, recharging
// weapon rather than a rapid-fire turret — refire is now ~2x slower per power.
const LASER_CHARGE_RATE = 7; // charge points/s per allocated weapon power unit

// Weapons governor (P#10): SNAPSHOT lets the gunner fire early at partial charge
// for a weak shot that only kills SMALL rocks — trading firepower for a shorter
// wait (addresses the "weapons is all waiting" playtest note). Threshold 40%.
const SNAPSHOT_CHARGE = 40;    // minimum charge to fire a snapshot
// A snapshot cracks MOST rocks (size ≤ this); only genuinely LARGE rocks shrug
// it off. Rocks range 0.6–1.6, so ~the top ~30% survive a partial charge and
// need a full STANDARD shot. Crucially the scope can't show size (all blips
// read the same) — only the captain, watching the viewscreen silhouettes, can
// call "that one's too big for a snapshot." That's the cooperation.
const SNAPSHOT_MAX_SIZE = 1.3;

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

// Debris field (scripted obstacle): pulverized rock that scours the hull
// while the ship runs hot. No damage at or under the safe throttle; the
// scrape scales quadratically above it, so full throttle through a field is
// a real mistake while a cautious crawl is free — a helm judgment call.
const DEBRIS_SAFE_THROTTLE = 40;
const DEBRIS_DPS = 2.2; // hull/s at full throttle inside a field

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
// Detection vs identification split (post-playtest sensor rework): sensors now
// do two jobs at two ranges. DETECTION (a blip appears on the scope, targetable)
// reaches a little further than before even at low power — so the field is
// never empty. IDENTIFICATION (the blip's true kind resolves: rock vs pod vs
// mineral vs ghost) needs the contact CLOSER, and that ID range grows faster
// with sensor power. Low power => you see UNKNOWN blips but can't tell a rescue
// pod from a rock; a pulse forces a full ID. This is the interplay the
// don't-shoot / salvage missions are built on.
const SENSOR_BASE = 10;         // detection range (s) at zero sensor power (was 8: a touch more reach low)
const SENSOR_PER_POWER = 2;     // extra detection range (s) per effective sensor power unit
const SENSOR_ID_BASE = 5;       // identification range (s) at zero sensor power (well inside detection)
const SENSOR_ID_PER_POWER = 3;  // extra ID range (s) per sensor power — ID scales harder than detection
const SENSOR_PULSE_COOLDOWN = 80; // long cooldown => ~1-2 pulses per mission

// --- Tractor beam / cargo hold. The tractor shares the WEAPONS emitter: the
// Weapons console aims and latches it (own agency — no other seat gates it),
// engineering's WEAPONS power drives the reel, and firing the laser is blocked
// while latched (the gunner's own "tow or shoot?" call). Latch onto a DETECTED
// non-hostile contact (pod / mineral) within tractor range; the ship reels it
// into the hold over REEL_SECS. Alignment is forgiving: the latch holds anywhere
// within a wide ARC of the contact's bearing (helm can swing back and forth),
// and the reel goes FASTER the more closely the helm is lined up. Reel progress
// PERSISTS across releases (a partial pull isn't wasted) — it only bleeds away
// slowly while unlatched, and the contact is lost if it drifts past the ship.
const TRACTOR_RANGE = 9;            // seconds-to-impact within which a contact can be latched
const TRACTOR_ARC = 60;             // |alignment - contact bearing| within which the latch holds (wide/forgiving)
const TRACTOR_REEL_SECS = 6;        // base seconds to reel a latched contact into the hold (at perfect alignment)
const TRACTOR_MIN_POWER = 1;        // effective WEAPONS power needed to hold a latch at all
const TRACTOR_REEL_DECAY = 0.06;    // reel progress bled off per second while unlatched (slow — brief drops are cheap)
const HOLD_CAPACITY_DEFAULT = 4;    // cargo hold slots when a mission doesn't set holdCapacity
// Cargo mass drags on maneuverability: a full hold cuts turn authority by up to
// this fraction (P#23 — heavier = less nimble). Linear in used-slots/capacity.
const CARGO_TURN_PENALTY = 0.45;

// --- Crew Chief deck operations (OPTIONAL console). A roster of crew tokens the
// chief COMMITS to deploy posts: per-system maintenance (trim out drifting
// wear), a hull-repair bay, and shipboard emergencies. Committed crew stay on a
// post until the job is done (add-only — you can't yank a hand mid-job); adding
// more hands finishes faster but with DIMINISHING RETURNS. When no human chief
// is aboard, automated systems hold trim and resolve emergencies on their own
// (no CPU chief in the fiction) — so the chief is pure upside range: a competent
// one lifts the score, a negligent one drags it, an absent one is neutral.
const CREW_TOKENS_DEFAULT = 4;      // deck crew when a mission doesn't set crewTokens
const EMERGENCY_DPS = 2.0;          // hull/s an unattended fire/breach inflicts (scaled by severity)
const EMERGENCY_CLEAR_PER_CREW = 0.9; // base clear progress/s for one hand (diminishing beyond that)
const FIRE_ON_IMPACT_CHANCE = 0.16; // chance a hull-damaging impact ignites a fire (automated systems handle it if no chief)
// System wear (trim). Drifts up slowly ONLY while a human chief is aboard (else
// automated upkeep holds it at zero); crew on a maintenance post trim it back
// down. Bounded and gentle — a fully-worn system limps a little, never dies.
const WEAR_RATE = 0.008;            // wear/s a system accrues untended (chief aboard)
const WEAR_MAX = 0.6;               // wear cap (bounds the eff penalty)
const WEAR_EFF_PENALTY = 0.15;      // effective-power loss at wear=1 (so at the 0.6 cap, ~9%)
const TRIM_PER_CREW = 0.09;         // wear removed/s by one hand on a maintenance post
const FAULT_EVERY = { min: 22, max: 40 }; // ambient minor-fault cadence (bumps a system out of trim) while a chief is aboard
const FAULT_WEAR = 0.35;            // wear a minor fault adds to a random system
const HULL_REPAIR_PER_CREW = 1.1;   // hull/s restored by one hand in the repair bay
const REPAIR_SHIFT = 12;            // seconds a repair detail works before the crew cycle off

// Diminishing returns for stacking crew on one job: 1 hand = 1.0x, each extra
// adds 0.55x (so 2 = 1.55x, 3 = 2.1x) — more is faster, but never linearly.
function dim(n: number): number { return n <= 0 ? 0 : 1 + 0.55 * (n - 1); }

// --- Solar flare / EMP front (P#5). Announced, then strikes: raised systems
// take stress on impact unless the crew is in a safe posture.
const FLARE_SHIELD_DUMP = true;     // shields-up at flare strike trips the shield breaker
const FLARE_CHARGE_DUMP = 0.6;      // fraction of laser charge lost if charged at strike

// --- Large obstacle (topology, forward-biased). Like a gate inverted: holding
// the ship ON the obstacle's bearing when it arrives is a heavy collision; the
// helm must steer OFF that bearing to pass it safely.
const OBSTACLE_CLEAR_WINDOW = 22;   // |alignment - bearing| needed to clear (steer at least this far off it)
const OBSTACLE_DMG_DEFAULT = 26;    // hull damage for plowing straight into one

// Proximity (seconds-to-impact) within which a contact is close enough to see
// out the window on the MAIN SCREEN regardless of sensor identification — this
// is what lets the captain visually spot a rescue pod's beacon before sensors
// classify it (drives serialize().asteroids[].visualKind, not the weapons scope).
const VISUAL_RANGE = 7;

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

// Sensor class prefix, revealed only once a contact is IDENTIFIED (inside the
// ID ring). Until then a detected contact reads "???-NNN" (number only); at ID
// it becomes "<CLASS>-NNN" — same number, so "???-314" resolves to "AST-314".
const CLASS_PREFIX: Record<ContactKind, string> = { rock: 'AST', pod: 'POD', mineral: 'ORE', ghost: 'ANOM' };

export interface Asteroid {
  id: number;
  designation: number; // stable 3-digit sensor tag (NNN); shown as ???-NNN then CLASS-NNN
  kind: ContactKind; // rock / pod / mineral / ghost (resolved on the scope at ID range)
  impactIn: number; // seconds until impact (for non-rocks, "seconds until it drifts past")
  dmg: number;      // damage dealt on impact (derived from size & speed; 0 for non-hazards)
  size: number;     // 0.6..1.6 visual/hitbox scale — bigger is easier to spot early
  speed: number;    // 0.7..1.5 closing-rate multiplier — faster shortens the window
  mass: number;     // cargo mass this contact adds to the hold if tractored aboard
  revealed: boolean;  // a sensor pulse forced this one fully resolved regardless of range
  identified: boolean; // sensors have resolved the true kind (else it reads UNKNOWN)
  announced: boolean; // the "sensor contact" event has fired (on detection, not spawn)
  bearing: number;    // -100..100 lateral offset for main-screen placement (port/starboard)
}

// A large obstacle the helm steers AROUND (see OBSTACLE_CLEAR_WINDOW). Advances
// like a gate but rewards being OFF its bearing rather than on it.
export interface Obstacle {
  id: number;
  label: string;
  reachIn: number;  // seconds until the ship reaches its plane
  bearing: number;  // the lateral line the obstacle sits on — steer clear of it
  dmg: number;      // hull damage for hitting it head-on
}

// One unit of cargo in the hold (tractored aboard). mass drags maneuverability;
// value scores on a salvage mission.
export interface CargoItem {
  id: number;
  label: string;
  kind: ContactKind; // 'pod' (rescued) or 'mineral' (salvage)
  mass: number;
  value: number;
}

// A shipboard emergency on the Crew Chief's damage-control board. Cleared by
// assigning crew; unattended, it does harm each tick.
export interface Emergency {
  id: number;
  kind: EmergencyKind;
  label: string;      // e.g. "Fire — Deck 3"
  severity: number;   // scales harm-per-second and clear effort
  progress: number;   // 0..1 toward cleared
  assigned: number;   // crew tokens currently working it
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
  | { kind: 'sensorContact' } // a contact just resolved on sensors (engineering ping)
  | { kind: 'ionStorm' }      // ion storm front hits (engineering static + viewscreen wash)
  | { kind: 'debris' }        // debris field entered (helm rumble + viewscreen specks)
  | { kind: 'tractorBeam'; targetId: number } // tractor latched onto a contact (Crew Chief hum + beam)
  | { kind: 'stow' }          // cargo reeled into the hold (Crew Chief clunk)
  | { kind: 'jettison' }      // cargo jettisoned (Crew Chief whoosh)
  | { kind: 'flare' }         // solar flare strike (ship-wide surge + white-out)
  | { kind: 'fire' }          // shipboard fire ignited (Crew Chief alarm)
  | { kind: 'boarders' }      // boarders detected (Crew Chief alarm)
  | { kind: 'anomaly' }       // hull breach / instability (main-screen glitch flicker)
  | { kind: 'obstacle'; id: number; hit: boolean } // large obstacle passed (clear) or struck
  | { kind: 'divert' };       // divert objective opened/taken (main-screen ping)

interface SeatState {
  playerId: string | null; // sticky id so a dropped client can resume its seat
  name: string;
  connected: boolean;
  difficulty: Difficulty;
  ready: boolean;          // GO-poll: this seat has signalled ready to launch (lobby only)
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
  // Crew Chief: how well cargo was recovered and emergencies handled.
  crewchief: { cargoRecovered: number; podsRescued: number; emergencyDowntime: number; hullRepaired: number; upkeep: number; manned: boolean };
  // Captain proxy: coordinationScore is a 0..1 composite of the crew outcomes a
  // good caller drives — defense, gate discipline, and fast target hand-offs.
  captain: { coordinationScore: number; avgAcquireLatency: number; gatePassRate: number; defense: number };
}

// Non-binary outcomes. 'arrived' (docked) and 'adrift' (hull lost) are the
// originals; 'salvaged' closes a timed salvage run (score = cargo banked) and
// 'expired' closes a failure-clock run that ran out of time (a distinct third
// result — e.g. a rescue pod that went dark — NOT a binary loss).
export type Outcome = 'arrived' | 'adrift' | 'salvaged' | 'expired';

export interface Debrief {
  outcome: Outcome;
  grade: string;
  score: number;
  narrative: string;
  missionId: string;
  missionName: string;
  shipName: string;       // crew-chosen ship name ('' if unnamed) — career-history fiction
  log: { t: number; text: string }[]; // the full captain's log, for debrief review
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
    cargoRecovered: number; // cargo units reeled aboard (salvage + rescue)
    podsRescued: number;    // rescue pods recovered
    podsDestroyed: number;  // rescue pods shot (the shame stat)
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
  obstacles: Obstacle[] = [];    // large steer-around hazards (topology)
  fx: Effect[] = [];     // one-shot effects for this broadcast (see clearFx)
  debrief: Debrief | null = null;

  // --- Weapons governor (P#10): STANDARD fires at full charge for full damage;
  // SNAPSHOT fires at >=40% for a weak shot that only kills small rocks — trading
  // the wait for reduced firepower, so the gunner has agency over pacing.
  governor: 'standard' | 'snapshot' = 'standard';

  // --- Helm course-hold (P#12): weak auto-centering the helm can toggle to
  // look up during quiet stretches. Disengages on manual input; never chases gates.
  courseHold = false;

  // --- Engineering power preset (P#11): one saved power split the engineer can
  // stash ("save") and re-apply in one tap ("load"). null until first saved.
  private savedPreset: Record<SystemId, number> | null = null;

  // --- Crew Chief: tractor beam + cargo hold ---
  tractorTargetId: number | null = null; // contact the beam is aimed at
  tractorLatched = false;                // beam is actively holding the target
  private tractorReel = 0;               // 0..1 progress reeling the latched contact aboard
  cargo: CargoItem[] = [];               // contents of the hold
  private holdCapacity = HOLD_CAPACITY_DEFAULT;
  private nextCargoId = 1;

  // --- Crew Chief: deck operations (posts + emergencies) ---
  crewTokens = CREW_TOKENS_DEFAULT;      // total crew available to commit
  emergencies: Emergency[] = [];
  private nextEmergencyId = 1;
  private emergencyDowntime = 0;         // emergency-seconds left unattended (crewchief metric)
  // System wear (trim) 0..1 per system; committed maintenance crew trim it down.
  wear: Record<SystemId, number> = { engines: 0, shields: 0, weapons: 0, sensors: 0 };
  private maintCrew: Record<SystemId, number> = { engines: 0, shields: 0, weapons: 0, sensors: 0 };
  private repairCrew = 0;                // hands committed to the hull-repair bay
  private repairShift = 0;              // seconds left on the current repair detail
  private faultTimer = 0;               // countdown to the next ambient minor fault
  // Chief scoring: whether a human chief ever crewed the run, and a running
  // upkeep-quality integral (time-average of how well systems were kept in trim).
  private chiefManned = false;
  private chiefUpkeepSum = 0;
  private chiefActiveTime = 0;
  private hullRepaired = 0;             // total hull restored by the repair bay (metric)

  // --- Cinematic / competing-objective state (P#4) ---
  cinematic: { title: string; lines: string[] } | null = null;
  private cinematicRemaining = 0;        // seconds of cinematic freeze left (whole sim paused)
  divert: { name: string; bearing: number; reward: number; endsAt: number; taken: boolean } | null = null;

  // --- Environmental view / flare state (P#5, P#18) ---
  viewImpaired = false;                  // forward view blacked out (fly on sensors)
  private flareAt: number | null = null; // missionTime the announced solar flare strikes

  // --- Salvage / rescue tallies (drive salvaged-outcome scoring + the debrief) ---
  private cargoRecovered = 0;
  private podsRescued = 0;
  private podsDestroyed = 0;

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
  // Timed environmental obstacles (scripted via mission events):
  private ionStormUntil = 0;   // while active, sensor range is halved (engineering pressure)
  private debrisUntil = 0;     // while active, running hot scrapes the hull (helm pressure)
  private debrisTickTimer = 0; // paces the scrape feedback (fx/log) while in debris
  private fullLog: { t: number; text: string }[] = []; // complete captain's log (debrief review)
  private usedDesignations = new Set<number>(); // contact callsigns already issued this run
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
      ([...CREW_SEATS, 'main'] as SeatId[]).map((s) => [
        s,
        { playerId: null, name: '', connected: false, difficulty: 'officer' as Difficulty, ready: false },
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
      s.ready = false;
      this.event(`${s.name} lost contact (${seat} on auto)`);
    }
  }

  // --- GO-poll / ready-room (lobby only) ---

  // Toggle a crew seat's ready flag (its own player only, in the lobby).
  setReady(seat: SeatId, playerId: string, on: boolean) {
    if (this.phase !== 'lobby') return;
    const s = this.seats[seat];
    if (s.playerId !== playerId || !s.connected) return;
    s.ready = on;
    this.event(on ? `${s.name} reports ${seat} GO for launch.` : `${s.name} stands ${seat} down.`);
  }

  // Release a seat back to the room (its own player backing out to role-select).
  // Only in the lobby; the seat is freed for anyone (name/ready cleared).
  leaveSeat(seat: SeatId, playerId: string) {
    if (this.phase !== 'lobby') return;
    const s = this.seats[seat];
    if (s.playerId !== playerId) return;
    this.event(`${s.name || seat} released the ${seat} station.`);
    s.playerId = null;
    s.name = '';
    s.connected = false;
    s.ready = false;
  }

  // GO-poll result: every MANNED crew seat is ready (and there's at least one).
  allReady(): boolean {
    const manned = CREW_SEATS.filter((s) => this.seats[s].connected);
    return manned.length > 0 && manned.every((s) => this.seats[s].ready);
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
    pace = 1,
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
    // Mission pace (ready-room setting): a real-time multiplier on the whole
    // simulation. Slower = more thinking time (accessibility), faster = a
    // tighter session; sim-relative balance is untouched. Debug speed
    // controls still override it live when debug is enabled.
    this.timeScale = Math.max(0.5, Math.min(1.5, pace || 1));
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
    this.obstacles = [];
    this.fx = [];
    this.nextGateId = 1;
    // Crew Chief / cinematic / topology fresh state.
    this.governor = 'standard';
    this.courseHold = false;
    this.tractorTargetId = null;
    this.tractorLatched = false;
    this.tractorReel = 0;
    this.cargo = [];
    this.nextCargoId = 1;
    this.holdCapacity = def.holdCapacity ?? HOLD_CAPACITY_DEFAULT;
    this.crewTokens = def.crewTokens ?? CREW_TOKENS_DEFAULT;
    this.emergencies = [];
    this.nextEmergencyId = 1;
    this.emergencyDowntime = 0;
    this.wear = { engines: 0, shields: 0, weapons: 0, sensors: 0 };
    this.maintCrew = { engines: 0, shields: 0, weapons: 0, sensors: 0 };
    this.repairCrew = 0;
    this.repairShift = 0;
    this.faultTimer = range(this.rng, FAULT_EVERY);
    this.chiefManned = false;
    this.chiefUpkeepSum = 0;
    this.chiefActiveTime = 0;
    this.hullRepaired = 0;
    this.savedPreset = null;
    this.cinematic = null;
    this.cinematicRemaining = 0;
    this.divert = null;
    this.viewImpaired = false;
    this.flareAt = null;
    this.cargoRecovered = 0;
    this.podsRescued = 0;
    this.podsDestroyed = 0;
    this.gateTimer = range(this.rng, def.gateEvery ?? { min: 25, max: 40 });
    this.debrief = null;
    this.spawnTimer = range(this.rng, def.spawnEvery);
    this.breakerTimer = range(this.rng, def.breakerEvery);
    this.spawnRateMult = 1;
    this.calmUntil = 0;
    this.maxAsteroidsOverride = null;
    this.autoFireAt = null;
    this.autoShieldClearAt = null;
    this.ionStormUntil = 0;
    this.debrisUntil = 0;
    this.debrisTickTimer = 0;
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
    this.fullLog = [];
    this.usedDesignations.clear();
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
    // Fresh GO-poll for the next run; seats + ship name persist so the crew can
    // re-pick consoles from the ready room without re-entering everything.
    for (const s of CREW_SEATS) this.seats[s].ready = false;
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
        // Turn authority scales with engine power and (inversely) throttle, and
        // is dragged down by a heavy cargo hold (see turnStep). Manual steering
        // disengages course-hold (the pilot has the stick).
        this.courseHold = false;
        this.alignment = clamp(this.alignment + this.turnStep() * (a.dir as number), -100, 100);
      } else if (a.kind === 'warp' || a.kind === 'evasive') {
        this.doWarp();
      } else if (a.kind === 'hold' && typeof a.on === 'boolean') {
        this.courseHold = a.on;
        this.event(this.courseHold ? 'Course-hold engaged.' : 'Course-hold released.');
      }
    } else if (seat === 'engineering') {
      if (a.kind === 'power' && SYSTEMS.includes(a.system as SystemId) && (a.delta === -1 || a.delta === 1)) {
        this.adjustPower(a.system as SystemId, a.delta as number);
      } else if (a.kind === 'resetBreaker' && SYSTEMS.includes(a.system as SystemId)) {
        this.resetBreaker(a.system as SystemId);
      } else if (a.kind === 'sensorPulse') {
        this.doSensorPulse();
      } else if (a.kind === 'savePreset') {
        this.savedPreset = { ...this.power };
        this.event('Power preset saved.');
      } else if (a.kind === 'loadPreset') {
        this.loadPreset();
      }
    } else if (seat === 'weapons') {
      if (a.kind === 'target' && typeof a.id === 'number') {
        // Can only lock a contact the sensors have actually detected.
        const t = this.asteroids.find((x) => x.id === a.id);
        if (t && this.targetable(t)) {
          this.targetId = a.id as number;
          this.recordAcquire(a.id as number);
        }
      } else if (a.kind === 'fire') {
        this.fire();
      } else if (a.kind === 'shields' && typeof a.raised === 'boolean') {
        this.shieldRaised = a.raised;
        // Renamed the crew-facing verb to "deflector screen" so it stops
        // colliding with engineering's "shield power" callout (playtest note).
        this.event(this.shieldRaised ? 'Deflector screen up.' : 'Deflector screen down.');
      } else if (a.kind === 'governor' && (a.mode === 'standard' || a.mode === 'snapshot')) {
        this.governor = a.mode;
        this.event(a.mode === 'snapshot' ? 'Weapons: SNAPSHOT — quick shots, small contacts only.' : 'Weapons: STANDARD — full-power shots.');
      } else if (a.kind === 'tractorTarget' && (typeof a.id === 'number' || a.id === null)) {
        // The tractor shares the weapons emitter — the gunner aims and latches
        // it (and forfeits firing while it's engaged). Their call, not a gate.
        this.setTractorTarget(a.id as number | null);
      } else if (a.kind === 'tractorLatch' && typeof a.on === 'boolean') {
        this.setTractorLatch(a.on);
      }
    } else if (seat === 'crewchief') {
      if (a.kind === 'jettison' && typeof a.id === 'number') {
        this.jettison(a.id as number);
      } else if (a.kind === 'assignCrew' && typeof a.post === 'string') {
        this.assignCrew(a.post as string);
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
    // A warp jump also drops any tractor latch and scatters the hold's contents
    // stay put — but the beam breaks (the ship is somewhere else now).
    this.tractorLatched = false;
    this.tractorTargetId = null;
    this.tractorReel = 0;
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
    // A pulse both detects AND identifies every contact for one sweep — ghosts
    // resolve (and get culled in the next tick's ID pass), pods and minerals
    // light up with their true kind so the crew can act with certainty.
    for (const a of this.asteroids) { a.revealed = true; a.identified = true; }
    this.sensorPulseCd = SENSOR_PULSE_COOLDOWN;
    this.stats.pulsesUsed++;
    this.pushFx({ kind: 'sensorPulse' });
    this.event('Active sensor pulse — all contacts lit up.');
  }

  // Re-apply the saved power preset (P#11), respecting the pool + per-system cap.
  private loadPreset() {
    if (!this.savedPreset) { this.event('No power preset saved yet.'); return; }
    const total = SYSTEMS.reduce((sum, s) => sum + clamp(this.savedPreset![s] ?? 0, 0, POWER_MAX), 0);
    if (total > POWER_TOTAL) return; // saved split no longer fits the pool (defensive)
    for (const s of SYSTEMS) this.power[s] = clamp(this.savedPreset[s] ?? 0, 0, POWER_MAX);
    this.tel.powerChanges++;
    this.event('Power preset loaded.');
  }

  // --- Crew Chief: tractor beam + cargo hold ---

  // Aim the beam at a contact (or clear the aim). Doesn't latch — that's a
  // separate deliberate step so a pull is always a decision.
  private setTractorTarget(id: number | null) {
    if (id === null) { this.tractorTargetId = null; this.tractorLatched = false; this.tractorReel = 0; return; }
    const t = this.asteroids.find((a) => a.id === id);
    if (!t || !this.targetable(t)) return;
    // Switching to a DIFFERENT contact discards any partial pull; re-aiming the
    // same contact keeps its progress (the persistent partial-reel ring).
    if (id !== this.tractorTargetId) this.tractorReel = 0;
    this.tractorTargetId = id;
  }

  // Engage/release the latch. Latching needs weapons power (shared emitter), a
  // targeted contact in range within the forgiving arc, and hold space. Releasing
  // KEEPS the reel progress (it bleeds off slowly while unlatched — a re-latch
  // resumes the pull). The tick maintains the latch (breaks it only if the helm
  // swings fully outside the arc or the contact drifts out of range).
  private setTractorLatch(on: boolean) {
    if (!on) {
      if (this.tractorLatched) this.event('Tractor beam released — hold the pull, we can re-latch.');
      this.tractorLatched = false;
      return;
    }
    if (this.cargo.length >= this.holdCapacity) { this.event('Cargo hold full — jettison to make room.'); return; }
    if (this.eff('weapons') < TRACTOR_MIN_POWER) { this.event('Tractor beam has no power — Engineering must feed WEAPONS.'); return; }
    const t = this.tractorTargetId !== null ? this.asteroids.find((a) => a.id === this.tractorTargetId) : null;
    if (!t || !this.targetable(t) || t.impactIn > TRACTOR_RANGE) { this.event('No contact in tractor range.'); return; }
    if (Math.abs(this.alignment - t.bearing) > TRACTOR_ARC) { this.event('Contact is outside the tractor arc — bring the bow around.'); return; }
    this.tractorLatched = true;
    this.pushFx({ kind: 'tractorBeam', targetId: t.id });
    this.event(`Tractor beam latched onto ${this.label(t)} — reeling it in. Helm, hold this line.`);
  }

  // Dump one item from the hold (recovers maneuverability; forfeits its value).
  private jettison(id: number) {
    const item = this.cargo.find((c) => c.id === id);
    if (!item) return;
    this.cargo = this.cargo.filter((c) => c.id !== id);
    this.pushFx({ kind: 'jettison' });
    this.event(`Jettisoned ${item.label} — hold lightened.`);
  }

  // Move a crew hand onto/off an emergency (bounded by roster + free hands).
  // Commit a free hand to a deploy post. ADD-ONLY: once a crew member is on a
  // job they stay until it's done (no yanking mid-task — commitment is the point).
  // Posts: 'maint:<system>' (trim wear), 'repair' (hull bay), or an emergency id.
  private assignCrew(post: string) {
    if (this.freeCrew() <= 0) return;
    if (post.startsWith('maint:')) {
      const s = post.slice(6) as SystemId;
      if (SYSTEMS.includes(s) && this.wear[s] > 0) this.maintCrew[s]++;
    } else if (post === 'repair') {
      if (this.hull < 100) { if (this.repairCrew === 0) this.repairShift = REPAIR_SHIFT; this.repairCrew++; }
    } else {
      const e = this.emergencies.find((x) => x.id === Number(post));
      if (e) e.assigned++;
    }
  }

  private assignedCrew(): number {
    const onEmergencies = this.emergencies.reduce((sum, e) => sum + e.assigned, 0);
    const onMaint = SYSTEMS.reduce((sum, s) => sum + this.maintCrew[s], 0);
    return onEmergencies + onMaint + this.repairCrew;
  }
  private freeCrew(): number {
    return Math.max(0, this.crewTokens - this.assignedCrew());
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
    // The laser and the tractor share an emitter: you can't fire while the beam
    // is latched (the weapons↔crewchief negotiation — "drop the pod or hold?").
    if (this.tractorLatched) {
      this.event('Cannot fire — tractor beam engaged. Release the latch to free the emitter.', false);
      return;
    }
    // Charge gate depends on the governor: STANDARD needs a full meter for a
    // full-power shot; SNAPSHOT fires at >=40% for a weak shot.
    const snapshot = this.governor === 'snapshot';
    const needed = snapshot ? SNAPSHOT_CHARGE : 100;
    if (this.charge < needed) return;
    const target = this.asteroids.find((a) => a.id === this.targetId);
    if (!target || !this.targetable(target)) return;
    this.charge = 0; // firing empties the recharge meter; weapon power refills it
    this.tel.shotsFired++;
    this.recordAcquire(target.id);
    // A snapshot only cracks small contacts; a big rock shrugs it off (the shot
    // lands, the charge is spent, the contact survives — the governor tradeoff).
    if (snapshot && target.size > SNAPSHOT_MAX_SIZE) {
      this.pushFx({ kind: 'laser', targetId: target.id, hit: false });
      this.event(`Snapshot glanced off ${this.label(target)} — too big for a partial charge.`);
      return;
    }
    // Ghosts are sensor false-positives: the shot passes through empty space.
    if (target.kind === 'ghost') {
      this.asteroids = this.asteroids.filter((a) => a.id !== target.id);
      this.targetId = null;
      this.targetableSince.delete(target.id);
      this.pushFx({ kind: 'laser', targetId: target.id, hit: false });
      this.event(`Fired on ${this.label(target)} — nothing there. Sensor ghost.`);
      return;
    }
    // Destroy the contact.
    this.asteroids = this.asteroids.filter((a) => a.id !== target.id);
    this.targetId = null;
    this.targetableSince.delete(target.id);
    this.pushFx({ kind: 'laser', targetId: target.id, hit: true });
    this.pushFx({ kind: 'explosion', id: target.id });
    if (target.kind === 'pod') {
      // The shame path: a rescue pod destroyed. Heavy scoring penalty in finish.
      this.podsDestroyed++;
      this.event(`WE FIRED ON A RESCUE POD — ${this.label(target)} lost with all hands. Confirm contacts before firing!`, true);
      return;
    }
    if (target.kind === 'mineral') {
      // Blasting salvage just wastes it (no score) — a soft mistake.
      this.event(`Vaporized ${this.label(target)} — that was salvage, not a threat.`);
      return;
    }
    // A rock killed before it reached us: a neutralized threat + kill-cluster feed.
    this.stats.destroyed++;
    this.killTimes.push(this.missionTime);
    this.threatsNeutralized++;
    this.event(`Direct hit! ${this.label(target)} destroyed.`);
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
    const breaker = this.breakers[system] !== null ? 0.5 : 1;
    // Wear lightly derates a system (gentle — the Crew Chief keeps it trimmed).
    const trim = 1 - WEAR_EFF_PENALTY * this.wear[system];
    return this.power[system] * breaker * trim;
  }

  // Turn authority per nudge: rises with engine power, falls with throttle — so
  // hard turns need the engines fed and/or the throttle eased back.
  private turnStep(): number {
    const engineFactor = 0.4 + 0.6 * (this.eff('engines') / POWER_MAX);
    const throttleFactor = 1.3 - 0.9 * (this.throttle / 100);
    return BASE_TURN * engineFactor * throttleFactor * this.cargoTurnFactor();
  }

  // Maneuverability drag from a laden hold (P#23): an empty hold is 1.0, a full
  // hold cuts turn authority by CARGO_TURN_PENALTY. Jettisoning restores it.
  private cargoTurnFactor(): number {
    if (this.holdCapacity <= 0) return 1;
    const load = Math.min(1, this.cargoMass() / this.holdCapacity);
    return 1 - CARGO_TURN_PENALTY * load;
  }

  private cargoMass(): number {
    return this.cargo.reduce((sum, c) => sum + c.mass, 0);
  }

  // Passive sensor detection range (seconds-to-impact), grows with sensor power.
  // An active ion storm halves it — engineering can partially compensate with
  // more sensor power, or punch through entirely with a pulse.
  private sensorRange(): number {
    const base = SENSOR_BASE + SENSOR_PER_POWER * this.eff('sensors');
    return this.missionTime < this.ionStormUntil ? base * 0.5 : base;
  }

  // Identification range: the tighter band inside which sensors resolve a
  // contact's true KIND (rock vs pod vs mineral vs ghost). Scales harder with
  // sensor power than detection, so buying sensor power mostly buys earlier IDs.
  private idRange(): number {
    const base = SENSOR_ID_BASE + SENSOR_ID_PER_POWER * this.eff('sensors');
    return this.missionTime < this.ionStormUntil ? base * 0.5 : base;
  }

  // Detected: a blip is on the scope (targetable/lockable) — within detection
  // range or pulse-revealed. Note a contact can be DETECTED but not yet
  // IDENTIFIED: you see it, you can even shoot it, but you don't know what it is.
  private targetable(a: Asteroid): boolean {
    return a.revealed || a.impactIn <= this.sensorRange();
  }

  // Whether sensors currently resolve this contact's true kind (drives ID edge).
  // The THREE-threshold model: beyond detection range = no HUD (captain's eyes
  // only); inside detection but outside the tighter ID range = tracked as a
  // number-only "???-NNN" (targetable, kind UNKNOWN); inside the ID range (or
  // pulse-revealed) = fully identified with its class letters. EVERY kind —
  // rocks included — must enter the ID ring to resolve, so the captain reads
  // silhouettes out the window and calls the type before the sensors letter it.
  private resolvesId(a: Asteroid): boolean {
    if (a.revealed) return true;
    return a.impactIn <= this.idRange();
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
    } else if (action.type === 'ionStorm') {
      this.ionStormUntil = this.missionTime + action.seconds;
      this.pushFx({ kind: 'ionStorm' });
      this.event('ION STORM FRONT — sensor returns degraded. More sensor power or a pulse will cut through.');
    } else if (action.type === 'debrisField') {
      this.debrisUntil = this.missionTime + action.seconds;
      this.debrisTickTimer = 0;
      this.pushFx({ kind: 'debris' });
      this.event('DEBRIS FIELD — pulverized rock in the lane. Ease the throttle or it will scour the hull.');
    } else if (action.type === 'spawnContact') {
      const n = Math.max(1, action.count ?? 1);
      for (let i = 0; i < n; i++) this.spawnContact(action.kind, action.impactIn ?? m.impactIn, m.asteroidDmg);
    } else if (action.type === 'spawnObstacle') {
      this.spawnObstacle(action.label, action.reachIn ?? { min: 10, max: 15 }, action.dmg ?? OBSTACLE_DMG_DEFAULT);
    } else if (action.type === 'spawnDivert') {
      const bearing = sign(this.rng() - 0.5) * range(this.rng, { min: 55, max: 85 });
      this.divert = { name: action.name, bearing, reward: action.reward ?? 12, endsAt: this.missionTime + action.seconds, taken: false };
      this.pushFx({ kind: 'divert' });
      this.event(`Distress call from ${action.name}, bearing ${bearing > 0 ? 'starboard' : 'port'} — divert or press on? Helm's call.`);
    } else if (action.type === 'cinematic') {
      this.cinematic = { title: action.title, lines: action.lines };
      this.cinematicRemaining = action.seconds ?? 6;
    } else if (action.type === 'solarFlare') {
      this.flareAt = this.missionTime + action.inSeconds;
      this.event(`SOLAR FLARE inbound — impact in ${Math.round(action.inSeconds)}s. Safe posture: shields DOWN, hold fire.`);
    } else if (action.type === 'setViewImpaired') {
      this.viewImpaired = action.on;
      this.event(action.on ? 'Forward view lost — fly on sensors.' : 'Forward view restored.');
    } else if (action.type === 'startEmergency') {
      this.startEmergency(action.kind, action.severity ?? 1);
    }
  }

  // Concurrent-asteroid ceiling: the mission's cap unless a scripted
  // setMaxAsteroids event has overridden it (intro-style difficulty ramps).
  private maxAsteroids(): number {
    return this.maxAsteroidsOverride ?? this.mission!.maxAsteroids;
  }

  // The crew-facing progress readout (mission-configurable; see MissionReadout).
  // Default: a parsec distance derived from mission length, reaching 0 at dock.
  private readout() {
    if (!this.mission) return null;
    const r = this.mission.readout
      ?? { kind: 'distance' as const, unit: 'pc', total: Math.max(4, Math.round(this.mission.targetSeconds / 15)) };
    const remaining = r.kind === 'distance'
      ? r.total * (1 - this.progress / 100)
      : Math.max(0, r.total - this.missionTime);
    return { kind: r.kind, unit: r.unit, label: r.label ?? null, total: r.total, remaining: round1(Math.max(0, remaining)) };
  }

  // A unique 3-digit sensor designation (the NNN). Kind-neutral by construction:
  // the class prefix is only attached at identification, so a detected-but-
  // unresolved contact can never leak its kind through the tag. Seeded + a
  // per-run used-set keeps them reproducible and unique.
  private contactDesignation(): number {
    for (let tries = 0; tries < 80; tries++) {
      const n = 100 + Math.floor(this.rng() * 900); // 100..999
      if (!this.usedDesignations.has(n)) { this.usedDesignations.add(n); return n; }
    }
    return this.nextAsteroidId + 100; // pathological fallback: guaranteed unique
  }

  // The display tag for a contact: "???-NNN" until identified, then "CLASS-NNN"
  // (same number). Used everywhere a contact is named — logs, scope, HUD — so the
  // kind never leaks before the sensors resolve it.
  private label(a: Asteroid): string {
    return `${a.identified ? CLASS_PREFIX[a.kind] : '???'}-${a.designation}`;
  }

  private spawnAsteroid(impactIn: { min: number; max: number }, dmg: { min: number; max: number }) {
    this.spawnContact('rock', impactIn, dmg);
  }

  // The general contact spawner. Rocks are hazards (impact damage); pods,
  // minerals, and ghosts are non-hazards (no impact damage) that read as UNKNOWN
  // until sensors resolve them. Pods/minerals are tractorable (carry cargo mass
  // + value); ghosts vanish on identification.
  private spawnContact(kind: ContactKind, impactIn: { min: number; max: number }, dmg: { min: number; max: number }) {
    const id = this.nextAsteroidId++;
    // Size and speed vary per contact and together set a rock's damage: a big,
    // fast rock hits hardest (but big = easy to spot early; fast = short window).
    const size = kind === 'pod'
      ? range(this.rng, { min: 0.7, max: 1.0 })   // pods read as small, tidy blips
      : range(this.rng, { min: 0.6, max: 1.6 });
    const speed = range(this.rng, { min: 0.75, max: 1.35 });
    const baseDmg = range(this.rng, dmg);
    const dealt = kind === 'rock'
      ? Math.max(3, Math.round(baseDmg * (0.65 + 0.35 * size) * (0.7 + 0.3 * speed)))
      : 0; // non-rocks don't damage the hull on contact — they just drift past
    const mass = kind === 'pod' ? 1 : kind === 'mineral' ? range(this.rng, { min: 1, max: 2 }) : 0;
    const a: Asteroid = {
      id,
      designation: this.contactDesignation(),
      kind,
      impactIn: range(this.rng, impactIn),
      dmg: dealt,
      size,
      speed,
      mass: Math.round(mass),
      revealed: false,
      identified: false,
      announced: false,
      // Lateral placement for the main screen: off-axis to port or starboard.
      bearing: sign(this.rng() - 0.5) * range(this.rng, ASTEROID_BEARING),
    };
    this.asteroids.push(a);
    if (kind === 'rock') this.tel.asteroidsSpawned++;
    // No "sensor contact" toast yet — that fires when sensors detect it (see
    // the detection check in tick); at spawn it's just an unlabeled dot ahead.
  }

  private spawnObstacle(label: string | undefined, reachIn: { min: number; max: number }, dmg: number) {
    const id = this.nextGateId++; // shares the gate id space (both are nav-plane features)
    const bearing = sign(this.rng() - 0.5) * range(this.rng, GATE_BEARING);
    const ob: Obstacle = { id, label: label ?? `HAZ-${String(id).padStart(2, '0')}`, reachIn: range(this.rng, reachIn), bearing, dmg };
    this.obstacles.push(ob);
    this.event(`LARGE OBSTACLE ${ob.label} dead ahead, bearing ${bearing > 0 ? 'starboard' : 'port'} — steer clear of it!`);
  }

  private startEmergency(kind: EmergencyKind, severity = 1) {
    const id = this.nextEmergencyId++;
    const deck = 1 + Math.floor(this.rng() * 4);
    const label = kind === 'fire' ? `Fire — Deck ${deck}`
      : kind === 'boarders' ? `Boarders — Deck ${deck}`
      : kind === 'leak' ? `Coolant leak — Deck ${deck}`
      : `Hull breach — Deck ${deck}`;
    this.emergencies.push({ id, kind, label, severity, progress: 0, assigned: 0 });
    this.pushFx({ kind: kind === 'boarders' ? 'boarders' : 'fire' });
    this.event(`EMERGENCY — ${label}. Crew Chief, assign hands to it!`, true);
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
    // Cinematic freeze (P#4): while a dialogue beat plays on the main screen the
    // whole sim is paused — threats, timers, and the mission clock all hold — so
    // the crew can read it. The broadcast still goes out so the overlay shows.
    if (this.cinematic) {
      this.cinematicRemaining -= dt;
      if (this.cinematicRemaining <= 0) this.cinematic = null;
      return;
    }
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
      // The bot helm eases off in a debris field — sluggishly, to 45 (still a
      // hair above the safe line), so it survives the field but pays a little.
      this.throttle = this.missionTime < this.debrisUntil ? 45 : AUTO_HELM_THROTTLE;
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
    } else if (this.courseHold) {
      // Course-hold (P#12): a crewed helm's optional trim. Weak auto-centering
      // (half the bot's authority) so the pilot can look up on a quiet stretch —
      // but it NEVER chases gates/divert bearings (those are the pilot's to earn),
      // and manual steering disengages it (see the nudge action).
      const correction = Math.min(Math.abs(this.alignment), (AUTO_HELM_CORRECTION * 0.5) * dt);
      this.alignment -= sign(this.alignment) * correction;
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
      const target: Record<SystemId, number> = { engines: 3, weapons: 2, shields: 1, sensors: 1 }; // mirrors the default split (sums to 7)
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
      // Only detected ROCKS are engaged — the cautious bot never fires on pods,
      // minerals, or ghosts (that safety is the important invariant on rescue /
      // salvage missions; a human gunner is the one who must confirm and choose).
      const acquirable = this.asteroids.filter((a) => this.targetable(a) && a.kind === 'rock');
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
      // Opportunistic tow (the tractor shares this emitter now): when there's
      // nothing to shoot, latch a clearly-identified pod/mineral inside the arc —
      // and drop the latch the instant a rock needs the laser.
      const rockThreat = !!closest && closest.impactIn <= AUTO_WEAPONS_REACT_RANGE;
      if (this.tractorLatched && rockThreat) {
        this.setTractorLatch(false); // free the emitter to defend
      } else if (!this.tractorLatched && !rockThreat && this.cargo.length < this.holdCapacity && this.eff('weapons') >= TRACTOR_MIN_POWER) {
        const cand = this.asteroids.find((a) =>
          (a.kind === 'pod' || a.kind === 'mineral') && a.identified &&
          a.impactIn <= TRACTOR_RANGE && Math.abs(this.alignment - a.bearing) <= TRACTOR_ARC);
        if (cand) { this.tractorTargetId = cand.id; this.setTractorLatch(true); }
      }
    }

    // No auto Crew Chief in the fiction: when the seat is unmanned, automated
    // systems hold trim and resolve emergencies (handled in updateChief below).

    // Scripted set pieces fire on time/progress marks.
    this.runScriptedEvents();

    // Advance asteroids (and gates) at the speed-scaled closing rate, times each
    // rock's own speed. Faster ship and faster rocks arrive sooner => less time.
    const closeRate = this.closeRate();
    // A latched contact is held by the beam — it stops closing while we reel it.
    for (const a of this.asteroids) {
      if (this.tractorLatched && a.id === this.tractorTargetId) continue;
      a.impactIn -= dt * closeRate * a.speed;
    }
    // Detection edge: announce a contact the first time sensors DETECT it (still
    // UNKNOWN at this point). Record the time for contact->acquire latency and
    // ping engineering. Wording is kind-neutral until identification resolves.
    for (const a of this.asteroids) {
      if (!a.announced && this.targetable(a)) {
        a.announced = true;
        this.targetableSince.set(a.id, this.missionTime);
        this.pushFx({ kind: 'sensorContact' });
        this.event(`Sensor contact ${this.label(a)} — designation unconfirmed.`);
      }
    }
    // Identification edge: the first time sensors resolve a contact's true kind,
    // flip `identified` and speak the resolution. Ghosts resolve to nothing and
    // are culled; pods get an explicit DO-NOT-FIRE call.
    for (const a of this.asteroids) {
      if (!a.identified && this.resolvesId(a)) {
        a.identified = true;
        if (a.kind === 'pod') this.event(`ID: ${this.label(a)} is a RESCUE POD — do NOT fire. Crew Chief, tractor it aboard.`, true);
        else if (a.kind === 'mineral') this.event(`ID: ${this.label(a)} is salvage — tractor it if you can.`, false);
        else if (a.kind === 'ghost') this.event(`${this.label(a)} resolved as a sensor ghost — nothing there.`, false);
      }
    }
    // Cull identified ghosts (false positives that have resolved).
    this.asteroids = this.asteroids.filter((a) => !(a.kind === 'ghost' && a.identified));

    // Reel a latched contact into the hold (Crew Chief) — faster with more
    // tractor power and any crew assigned to the hold work is folded in via power.
    this.updateTractor(dt);

    // Contacts that reach the ship: rocks strike the hull; non-rocks (pods /
    // minerals we failed to tractor) drift past and are lost.
    const arrived = this.asteroids.filter((a) => a.impactIn <= 0);
    this.asteroids = this.asteroids.filter((a) => a.impactIn > 0);
    for (const c of arrived) {
      if (c.kind === 'rock') this.applyImpact(c);
      else this.contactLost(c);
    }
    if (this.targetId !== null && !this.asteroids.some((a) => a.id === this.targetId)) {
      this.targetId = null;
    }
    if (this.tractorTargetId !== null && !this.asteroids.some((a) => a.id === this.tractorTargetId)) {
      this.tractorTargetId = null;
      this.tractorLatched = false;
      this.tractorReel = 0;
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

    // Timed environmental obstacles. Debris: scrape the hull while running
    // hot (quadratic above the safe throttle), with paced feedback so the
    // room hears/sees the mistake without toast spam. Both obstacles announce
    // once when they clear (the *Until fields are zeroed as the announcement).
    if (this.missionTime < this.debrisUntil && this.throttle > DEBRIS_SAFE_THROTTLE) {
      const hot = (this.throttle - DEBRIS_SAFE_THROTTLE) / (100 - DEBRIS_SAFE_THROTTLE);
      const dps = DEBRIS_DPS * hot * hot;
      this.hull = Math.max(0, this.hull - dps * dt);
      this.tel.hullDamageTaken += dps * dt;
      this.debrisTickTimer -= dt;
      if (this.debrisTickTimer <= 0) {
        this.debrisTickTimer = 3;
        this.pushFx({ kind: 'impact', hullDmg: Math.max(1, Math.round(dps * 3)), absorbed: false });
        this.event('Debris scouring the hull — ease the throttle!', false);
      }
    }
    if (this.ionStormUntil > 0 && this.missionTime >= this.ionStormUntil) {
      this.ionStormUntil = 0;
      this.event('Ion storm front has passed — sensor returns clearing.');
    }
    // Target-lock upkeep: if the locked contact slips back below sensor
    // resolution (sensor power dropped, ion storm rolled in), the lock is
    // lost — weapons can't hold a firing solution on a contact the ship can
    // no longer resolve. (A missing contact means it died/hit; clear quietly.)
    if (this.targetId !== null) {
      const locked = this.asteroids.find((a) => a.id === this.targetId);
      if (!locked) this.targetId = null;
      else if (!this.targetable(locked)) {
        this.targetId = null;
        this.event(`Target lock lost — ${this.label(locked)} faded below sensor resolution.`);
      }
    }
    if (this.debrisUntil > 0 && this.missionTime >= this.debrisUntil) {
      this.debrisUntil = 0;
      this.event('Clear of the debris field. Resume speed.');
    }

    // Crew Chief / topology / flare sim steps.
    this.updateChief(dt);
    this.updateFlare();
    this.updateObstacles(dt);
    this.updateDivert();

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
    if (this.hull <= 0) { this.finish('adrift'); return; }
    if (this.progress >= 100) { this.finish('arrived'); return; }
    // Timed missions end when a countdown readout hits zero. A salvage run
    // (salvageGoal set) closes as 'salvaged' — score is what you banked. A
    // failure-clock run (failOnCountdown) closes as 'expired' — the window shut.
    if ((m.salvageGoal !== undefined || m.failOnCountdown) && m.readout?.kind === 'countdown') {
      const left = m.readout.total - this.missionTime;
      if (left <= 0) this.finish(m.salvageGoal !== undefined ? 'salvaged' : 'expired');
    }
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
    // the knob really changes that console's workload: Cruise ~60% of hull
    // hits trip one, Officer always trips one.
    if (remaining > 0) {
      const engDiff = this.diff('engineering'); // 0.6 (cruise) / 1 (officer)
      if (this.rng() < Math.min(1, engDiff)) this.tripBreaker();
      // A hard hull hit can ignite a fire — the Crew Chief's problem if crewed,
      // otherwise automated suppression handles it (softer, slower) in updateChief.
      if (this.rng() < FIRE_ON_IMPACT_CHANCE) this.startEmergency('fire', 1);
    }
    this.targetableSince.delete(a.id);
    this.tel.impactLog.push({ t: Math.round(this.missionTime), dmg: a.dmg, hullDmg: Math.round(remaining) });
    // Screen shake + sound scale off this on the main screen; absorbed hits get
    // a lighter shield-clang, hull hits a heavier jolt.
    this.pushFx({ kind: 'impact', hullDmg: Math.round(remaining), absorbed: remaining <= 0 });
    this.event(
      remaining > 0
        ? `IMPACT: ${this.label(a)} hit the hull for ${Math.round(remaining)} damage!`
        : `${this.label(a)} absorbed by shields.`,
    );
  }

  // Maintain the tractor. While latched, reel the held contact aboard (faster
  // with weapons power AND with closer helm alignment). While UNLATCHED but still
  // aimed at a contact with partial progress, the reel bleeds off slowly (the
  // pull isn't lost the instant the beam drops — the helm can swing away and back).
  private updateTractor(dt: number) {
    const t = this.tractorTargetId !== null ? this.asteroids.find((a) => a.id === this.tractorTargetId) : null;
    if (!t) { this.tractorLatched = false; this.tractorReel = 0; return; }

    if (!this.tractorLatched) {
      // Not holding: let a partial pull decay. If it's fully bled off, drop the
      // aim so the widget stops showing a dead ring.
      if (this.tractorReel > 0) {
        this.tractorReel = Math.max(0, this.tractorReel - TRACTOR_REEL_DECAY * dt);
        if (this.tractorReel === 0) this.tractorTargetId = null;
      }
      return;
    }

    // Latched: break only on lost power or the bow swinging fully outside the arc
    // (progress is preserved for a re-latch — no punitive reset).
    if (this.eff('weapons') < TRACTOR_MIN_POWER) {
      this.event('Tractor beam lost power — latch dropped (Engineering, feed WEAPONS).');
      this.tractorLatched = false; return;
    }
    const offset = Math.abs(this.alignment - t.bearing);
    if (offset > TRACTOR_ARC) {
      this.event(`Latch on ${this.label(t)} slipped — bow swung outside the arc. Progress held.`);
      this.tractorLatched = false; return;
    }
    // Reel rate scales with effective weapons power (0.4x at 1 power .. 1x at max)
    // AND with alignment closeness within the arc (perfectly lined up = full rate,
    // edge of arc = 0.4x). Closer aim => faster pull, so the helm still matters.
    const powerRate = 0.4 + 0.6 * (this.eff('weapons') / POWER_MAX);
    const alignRate = 0.4 + 0.6 * (1 - offset / TRACTOR_ARC);
    this.tractorReel += (dt / TRACTOR_REEL_SECS) * powerRate * alignRate;
    if (this.tractorReel >= 1) this.stowContact(t);
  }

  // A reeled contact enters the hold as cargo (rescued pod or salvage) and the
  // latch releases, freeing the beam (and the laser) for the next call.
  private stowContact(t: Asteroid) {
    this.asteroids = this.asteroids.filter((a) => a.id !== t.id);
    this.targetableSince.delete(t.id);
    const value = t.kind === 'pod' ? 3 : Math.max(1, t.mass); // rescued lives score highest
    this.cargo.push({ id: this.nextCargoId++, label: this.label(t), kind: t.kind, mass: Math.max(1, t.mass), value });
    this.cargoRecovered++;
    if (t.kind === 'pod') this.podsRescued++;
    this.tractorLatched = false;
    this.tractorTargetId = null;
    this.tractorReel = 0;
    this.pushFx({ kind: 'stow' });
    this.event(t.kind === 'pod'
      ? `${this.label(t)} aboard — survivors recovered. Well done.`
      : `${this.label(t)} secured in the hold.`);
  }

  // A non-rock contact we never tractored has drifted past — lost (no score).
  private contactLost(c: Asteroid) {
    this.targetableSince.delete(c.id);
    if (c.kind === 'pod') this.event(`${this.label(c)} drifted out of range — the pod is lost.`, true);
    else if (c.kind === 'mineral') this.event(`${this.label(c)} drifted past — salvage lost.`, false);
  }

  // Crew Chief deck operations. Runs every tick. With a human chief aboard,
  // systems drift out of trim (crew trim them back), ambient faults appear, the
  // repair bay heals hull, and emergencies need committed hands. With NO chief,
  // automated systems hold trim at spec and resolve emergencies on their own —
  // no CPU chief in the fiction, just softer outcomes than a good human gets.
  private updateChief(dt: number) {
    const chief = this.seats.crewchief.connected;
    if (chief) {
      this.chiefManned = true;
      // Trim: maintained systems recover; untended ones drift up to the cap.
      for (const s of SYSTEMS) {
        if (this.maintCrew[s] > 0) {
          this.wear[s] = Math.max(0, this.wear[s] - TRIM_PER_CREW * dim(this.maintCrew[s]) * dt);
          if (this.wear[s] === 0) { this.maintCrew[s] = 0; this.event(`${s} trimmed to spec — crew freed.`); }
        } else {
          this.wear[s] = Math.min(WEAR_MAX, this.wear[s] + WEAR_RATE * dt);
        }
      }
      // Ambient minor fault: nudges a random system out of trim (steady work,
      // the answer to "the chief had nothing to do").
      this.faultTimer -= dt;
      if (this.faultTimer <= 0) {
        this.faultTimer = range(this.rng, FAULT_EVERY);
        const s = SYSTEMS[Math.floor(this.rng() * SYSTEMS.length)];
        this.wear[s] = Math.min(WEAR_MAX, this.wear[s] + FAULT_WEAR);
        this.event(`${s} drifting out of trim — Crew Chief, send a hand.`);
      }
      // Repair bay: a committed detail restores hull for a shift, then cycles off.
      if (this.repairCrew > 0) {
        this.repairShift -= dt;
        const before = this.hull;
        this.hull = Math.min(100, this.hull + HULL_REPAIR_PER_CREW * dim(this.repairCrew) * dt);
        this.hullRepaired += this.hull - before;
        if (this.hull >= 100 || this.repairShift <= 0) { this.repairCrew = 0; this.event('Repair detail secured.'); }
      }
      // Upkeep-quality integral for scoring (1 = perfectly trimmed, 0 = fully worn).
      const avgWear = SYSTEMS.reduce((sum, k) => sum + this.wear[k], 0) / SYSTEMS.length;
      this.chiefUpkeepSum += (1 - avgWear / WEAR_MAX) * dt;
      this.chiefActiveTime += dt;
    } else {
      // Automated upkeep: hold trim at spec, no manual posts.
      for (const s of SYSTEMS) { this.wear[s] = 0; this.maintCrew[s] = 0; }
      this.repairCrew = 0;
    }
    this.updateEmergencies(dt, chief);
  }

  // Emergencies. A human chief must commit hands (harm accrues while unattended);
  // with no chief, automated systems resolve them slowly at reduced harm.
  private updateEmergencies(dt: number, chief: boolean) {
    if (this.emergencies.length === 0) return;
    for (const e of this.emergencies) {
      if (chief) {
        if (e.assigned > 0) {
          e.progress += (EMERGENCY_CLEAR_PER_CREW * dim(e.assigned) * dt) / (2 + e.severity);
        } else {
          this.applyEmergencyHarm(e, dt);
          this.emergencyDowntime += dt;
        }
      } else {
        // Automated systems: self-resolve at ~0.7 of one hand, softened harm.
        e.progress += (EMERGENCY_CLEAR_PER_CREW * 0.7 * dt) / (2 + e.severity);
        this.applyEmergencyHarm(e, dt * 0.5);
      }
    }
    const cleared = this.emergencies.filter((e) => e.progress >= 1);
    this.emergencies = this.emergencies.filter((e) => e.progress < 1);
    for (const e of cleared) {
      this.event(chief ? `${e.label} — handled. Crew freed up.` : `${e.label} — automated systems resolved it.`, true);
    }
  }

  // Each emergency KIND maps to a different consequence (kept non-punishing):
  //  fire   — hull damage over time
  //  breach — smaller hull DoT + a main-screen instability glitch
  //  boarders — trips breakers + throws phantom contacts onto sensors
  //  leak   — coolant loss wobbles a system out of trim (temporary power dip)
  private applyEmergencyHarm(e: Emergency, dt: number) {
    if (e.kind === 'fire') {
      const dps = EMERGENCY_DPS * e.severity;
      this.hull = Math.max(0, this.hull - dps * dt); this.tel.hullDamageTaken += dps * dt;
    } else if (e.kind === 'breach') {
      const dps = EMERGENCY_DPS * 0.6 * e.severity;
      this.hull = Math.max(0, this.hull - dps * dt); this.tel.hullDamageTaken += dps * dt;
      if (this.rng() < 0.6 * dt) this.pushFx({ kind: 'anomaly' });
    } else if (e.kind === 'boarders') {
      if (this.rng() < 0.10 * e.severity * dt) this.tripBreaker();
      if (this.rng() < 0.06 * dt) this.spawnPhantom(); // odd blip on sensors
    } else if (e.kind === 'leak') {
      const s = SYSTEMS[Math.floor(this.rng() * SYSTEMS.length)];
      this.wear[s] = Math.min(WEAR_MAX, this.wear[s] + 0.25 * e.severity * dt);
    }
  }

  // A short-lived ghost blip thrown up by boarders (sensor spoofing) — reads as
  // an UNKNOWN contact, resolves to nothing at ID range, then is culled.
  private spawnPhantom() {
    this.spawnContact('ghost', { min: 10, max: 16 }, { min: 0, max: 0 });
  }

  // Solar flare: when the announced strike time arrives, stress raised systems.
  private updateFlare() {
    if (this.flareAt === null || this.missionTime < this.flareAt) return;
    this.flareAt = null;
    this.pushFx({ kind: 'flare' });
    let stung = false;
    if (FLARE_SHIELD_DUMP && this.shieldRaised) {
      this.shieldRaised = false;
      this.shieldStrength = 0;
      if (this.breakers.shields === null) { this.breakers.shields = 0; this.stats.breakersTripped++; }
      stung = true;
    }
    if (this.charge >= 100 * FLARE_CHARGE_DUMP) {
      this.charge = Math.max(0, this.charge - 100 * FLARE_CHARGE_DUMP);
      stung = true;
    }
    this.event(stung
      ? 'FLARE STRIKE — systems surged! Should have been in safe posture.'
      : 'Flare strike — clean. Safe posture held. Well called.');
  }

  // Advance large obstacles; a reached obstacle is a heavy hit unless the helm
  // steered clear of its bearing (the inverse of a gate).
  private updateObstacles(dt: number) {
    if (this.obstacles.length === 0) return;
    const gateClose = this.gateCloseRate();
    for (const ob of this.obstacles) ob.reachIn -= dt * gateClose;
    const reached = this.obstacles.filter((ob) => ob.reachIn <= 0);
    this.obstacles = this.obstacles.filter((ob) => ob.reachIn > 0);
    for (const ob of reached) {
      const cleared = Math.abs(this.alignment - ob.bearing) >= OBSTACLE_CLEAR_WINDOW;
      if (cleared) {
        this.pushFx({ kind: 'obstacle', id: ob.id, hit: false });
        this.event(`Cleared ${ob.label} — good steering.`);
      } else {
        this.hull = Math.max(0, this.hull - ob.dmg);
        this.tel.hullDamageTaken += ob.dmg;
        this.stats.impacts++;
        this.pushFx({ kind: 'obstacle', id: ob.id, hit: true });
        this.pushFx({ kind: 'impact', hullDmg: ob.dmg, absorbed: false });
        this.event(`COLLISION — plowed into ${ob.label} for ${ob.dmg} damage!`, true);
      }
    }
  }

  // Divert objective: holding the ship on the divert bearing as the clock runs
  // banks the reward; letting it expire (or steering away) forfeits the bonus.
  private updateDivert() {
    if (!this.divert || this.divert.taken) return;
    // "Taken" the moment the helm is roughly on the divert bearing — the crew
    // committed to the rescue/side-objective.
    if (Math.abs(this.alignment - this.divert.bearing) <= OBSTACLE_CLEAR_WINDOW) {
      this.divert.taken = true;
      this.progress = Math.max(0, this.progress - 4); // a divert costs a little ground
      this.pushFx({ kind: 'divert' });
      this.event(`Diverting to ${this.divert.name} — the crew answers the call.`, true);
    } else if (this.missionTime >= this.divert.endsAt) {
      this.event(`${this.divert.name} out of reach — we pressed on.`, false);
      this.divert = null;
    }
  }

  // Non-binary mission resolution: a score composed from hull, time, and
  // defensive performance maps to one of several narrative outcomes.
  private finish(outcome: Outcome) {
    const m = this.mission!;
    let score: number;
    let narrative: string;
    const { destroyed, impacts, dodged, gatesPassed, gatesMissed, warpsUsed, pulsesUsed } = this.stats;
    // Fiction hook: reference the crew's named ship where the story allows.
    const ship = this.shipName ? `the ${this.shipName}` : 'the ship';
    // Cross-outcome modifiers. Shooting rescue pods is the cardinal sin (heavy
    // penalty + shame line); recovering pods/salvage pays back. Kept as additive
    // components so scoring stays non-binary across every outcome.
    const podPenalty = this.podsDestroyed * 22;
    const rescueBonus = this.podsRescued * 6;
    const shame = this.podsDestroyed > 0
      ? ` ${this.podsDestroyed} rescue pod${this.podsDestroyed > 1 ? 's were' : ' was'} lost to our own guns — that will follow this crew.`
      : '';
    if (outcome === 'adrift') {
      // Even a lost ship gets partial credit for distance covered.
      score = Math.round(this.progress * 0.25) + rescueBonus;
      narrative = `Hull breach critical. ${ship.charAt(0).toUpperCase() + ship.slice(1)} went dark ${Math.round(this.progress)}% of the way to ${m.arrivalName}; a tow ship recovered the crew two days later.${shame}`;
    } else if (outcome === 'salvaged') {
      // Timed salvage run (P#23): score is what you banked against the goal.
      const banked = this.cargo.reduce((s, c) => s + c.value, 0);
      const goal = Math.max(1, m.salvageGoal ?? 6);
      const salvageScore = clamp(banked / goal, 0, 1.2);
      score = Math.min(100, Math.round(30 * salvageScore + 0.35 * this.hull + rescueBonus));
      narrative =
        salvageScore >= 1 ? `The hold is full — ${banked} units banked before the window closed. A clean haul for ${ship}.${shame}`
        : salvageScore >= 0.6 ? `A decent haul — ${banked} units aboard when time ran out.${shame}`
        : `Thin pickings: only ${banked} units recovered before the window shut.${shame}`;
    } else if (outcome === 'expired') {
      // Failure-clock run (P#21): the window shut before arrival. A distinct
      // third result — the crew did what they could, but the clock beat them.
      score = Math.round(this.progress * 0.35) + rescueBonus;
      narrative = `The clock ran out ${Math.round(this.progress)}% of the way to ${m.arrivalName}. ${this.podsRescued > 0 ? `${this.podsRescued} soul${this.podsRescued > 1 ? 's' : ''} aboard, at least.` : 'What we came for slipped away.'}${shame}`;
    } else {
      const timeScore = clamp(1.4 - this.missionTime / m.parTime, 0, 1);
      const shotsAtUs = destroyed + impacts + dodged;
      const defense = shotsAtUs === 0 ? 1 : destroyed / shotsAtUs;
      // Core score from surviving, arriving on time, and shooting well. Nav
      // gates are OFF the direct course (chasing them costs speed), so they're
      // an optional bonus (up to +8) rather than a tax you owe for existing.
      const base = 0.55 * this.hull + 22 * timeScore + 18 * defense;
      const gateBonus = Math.min(8, gatesPassed * 2);
      score = Math.min(100, Math.round(base + gateBonus + rescueBonus));
      narrative =
        score >= 85 ? `A flawless run. ${m.arrivalName} dock crews applaud as ${ship} glides in.${shame}`
        : score >= 70 ? `Solid work. Some scorch marks, but the cargo is intact and morale is high.${shame}`
        : score >= 50 ? `Mission accomplished — though ${ship} will spend a week in drydock.${shame}`
        : score >= 30 ? `You made it, barely. The insurance adjusters would like a word.${shame}`
        : `${ship.charAt(0).toUpperCase() + ship.slice(1)} limps into dock, venting atmosphere. Nobody claps.${shame}`;
    }
    // Crew Chief effect (only when a HUMAN chief crewed the run): a competent
    // chief — systems kept in trim, emergencies handled fast, hull patched —
    // widens the ceiling; a negligent one drags it down. An ABSENT chief is
    // neutral (automated baseline), so the console is pure upside range, never a
    // penalty for the missing seat.
    let chiefTerm = 0;
    if (this.chiefManned) {
      const upkeep = this.chiefActiveTime > 0 ? clamp(this.chiefUpkeepSum / this.chiefActiveTime, 0, 1) : 1;
      const response = clamp(1 - this.emergencyDowntime / 18, 0, 1);
      const quality = 0.6 * upkeep + 0.4 * response;
      chiefTerm = Math.round(12 * quality - 4); // -4 (negligent) .. +8 (excellent)
    }
    // Apply the pod-shooting penalty and the chief term across every outcome, clamp.
    score = Math.max(0, Math.min(100, score - podPenalty + chiefTerm));
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
      crewchief: {
        cargoRecovered: this.cargoRecovered, podsRescued: this.podsRescued,
        emergencyDowntime: round1(this.emergencyDowntime), hullRepaired: round1(this.hullRepaired),
        upkeep: this.chiefActiveTime > 0 ? round2(clamp(this.chiefUpkeepSum / this.chiefActiveTime, 0, 1)) : 1,
        manned: this.chiefManned,
      },
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
      log: [...this.fullLog],
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
        cargoRecovered: this.cargoRecovered,
        podsRescued: this.podsRescued,
        podsDestroyed: this.podsDestroyed,
      },
      telemetry: this.tel,
      // Which seats were human-crewed and at what difficulty — needed to
      // interpret balance data (and, later, for persistent crew records).
      crew: Object.fromEntries(
        CREW_SEATS.map((s) => [
          s,
          { difficulty: this.seats[s].difficulty, human: this.seats[s].playerId !== null },
        ]),
      ),
    };
    this.phase = 'debrief';
    const closer =
      outcome === 'arrived' ? `Docking complete at ${m.arrivalName}.`
      : outcome === 'salvaged' ? 'Salvage window closed — securing the hold.'
      : outcome === 'expired' ? 'The window has closed. Bringing her home.'
      : 'The ship goes dark, adrift in the belt.';
    this.event(closer);
  }

  // Log an event. It always enters the ship's rolling log (serialized, shown in
  // the main-screen HUD). `toast` controls whether it *also* fires onEvent — the
  // transient station toast. Ambient narrative beats pass toast:false so the
  // captain's log reads as a story without spamming crew screens with popups.
  private event(text: string, toast = true) {
    this.log.push({ t: Math.round(this.missionTime), text });
    if (this.log.length > 10) this.log.shift();
    // Full captain's log for the debrief review (the live `log` is a rolling
    // 10-line window; this keeps the whole story, sanely capped).
    this.fullLog.push({ t: Math.round(this.missionTime), text });
    if (this.fullLog.length > 250) this.fullLog.shift();
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
      allReady: this.allReady(), // GO-poll: every manned crew seat is ready
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
      idRange: round1(this.idRange()), // inner ring: contacts inside it are IDENTIFIED (class letters)
      sensorPulseReadyIn: round1(this.sensorPulseCd),
      // Environmental obstacles: seconds remaining (0 = inactive). Engineering
      // renders the storm warning, helm the debris warning, main screen both.
      ionStormIn: round1(Math.max(0, this.ionStormUntil - this.missionTime)),
      debrisIn: round1(Math.max(0, this.debrisUntil - this.missionTime)),
      // Slipstream open (post-gate speed boost) — drives the viewscreen streaks.
      slipstream: this.gateBoostTimer > 0,
      // Weapons governor mode + helm course-hold (self-documenting console state).
      governor: this.governor,
      courseHold: this.courseHold,
      // Crew Chief: tractor + hold + damage-control board.
      tractor: {
        power: this.eff('weapons'),
        targetId: this.tractorTargetId,
        latched: this.tractorLatched,
        reel: round2(this.tractorReel),
        range: TRACTOR_RANGE,
      },
      cargo: this.cargo.map((c) => ({ id: c.id, label: c.label, kind: c.kind, mass: c.mass, value: c.value })),
      holdCapacity: this.holdCapacity,
      cargoMass: this.cargoMass(),
      crew: { total: this.crewTokens, free: this.freeCrew() },
      emergencies: this.emergencies.map((e) => ({
        id: e.id, kind: e.kind, label: e.label, severity: e.severity,
        progress: round2(e.progress), assigned: e.assigned,
      })),
      // Crew Chief deck ops: per-system trim posts, the hull-repair bay, and
      // whether a human chief is aboard (the console shows automated status if not).
      chief: {
        manned: this.seats.crewchief.connected,
        maint: SYSTEMS.map((s) => ({ system: s, wear: round2(this.wear[s]), crew: this.maintCrew[s] })),
        repair: { crew: this.repairCrew, active: this.repairCrew > 0, hull: Math.round(this.hull) },
      },
      // Large steer-around obstacles (topology).
      obstacles: this.obstacles.map((o) => ({ id: o.id, label: o.label, reachIn: round1(o.reachIn), bearing: Math.round(o.bearing), clearWindow: OBSTACLE_CLEAR_WINDOW })),
      // Competing-objective divert + cinematic + flare/blackout.
      divert: this.divert ? { name: this.divert.name, bearing: Math.round(this.divert.bearing), takenBy: this.divert.taken, endsIn: round1(Math.max(0, this.divert.endsAt - this.missionTime)) } : null,
      cinematic: this.cinematic,
      flareIn: this.flareAt !== null ? round1(Math.max(0, this.flareAt - this.missionTime)) : null,
      viewImpaired: this.viewImpaired,
      // Progress readout: what the distance line on main screen + helm shows.
      // Distance counts down to 0 at dock (parsecs by default); countdown
      // missions show seconds left on a failure clock instead.
      readout: this.readout(),
      // Contacts carry size/speed (for main-screen threat read-out) and whether
      // sensors have resolved them yet (targetable on the weapons scope).
      // Contacts. `targetable` = detected (lockable). `identified` gates the
      // true kind: the client shows UNKNOWN until sensors resolve it, so weapons
      // can see a blip it can't yet classify — the confirm-before-you-fire ritual.
      // `tractorable` is a convenience flag for the Crew Chief (a pod/mineral in
      // range the beam could latch).
      asteroids: this.asteroids.map((a) => ({
        id: a.id, label: this.label(a), impactIn: round1(a.impactIn), dmg: a.dmg,
        size: round1(a.size), speed: round1(a.speed), targetable: this.targetable(a),
        // `kind` is the SENSOR-resolved classification (UNKNOWN until identified)
        // — the weapons scope uses it. `visualKind` reveals the true kind once a
        // contact is close enough to see out the window (proximity, NOT sensors)
        // — the MAIN SCREEN uses it, so the captain can spot a rescue pod's
        // beacon up close even while the scope still reads UNKNOWN. That's the
        // don't-shoot cooperation: the captain's eyes OR engineering's sensors.
        kind: a.identified ? a.kind : 'unknown',
        visualKind: a.impactIn <= VISUAL_RANGE ? a.kind : 'unknown',
        identified: a.identified, mass: a.mass,
        tractorable: a.identified && (a.kind === 'pod' || a.kind === 'mineral') && a.impactIn <= TRACTOR_RANGE,
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
            ready: this.seats[s].ready,
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
      crewchief: { cargoRecovered: 0, podsRescued: 0, emergencyDowntime: 0, hullRepaired: 0, upkeep: 1, manned: false },
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
