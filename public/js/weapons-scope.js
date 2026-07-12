// Weapons targeting scope: a Phaser scene showing a forward ARC out the front
// window (not a 360° radar). The ship sits at the bottom; contacts fan across
// the arc by their real lateral BEARING (port ↔ starboard) — the same bearing
// the main-screen viewscreen uses, so the scope and the window agree on where a
// contact is — and travel DOWN the arc toward the ship as impactIn counts down.
// Two arcs mark the sensor bands: the DETECTION arc (a contact appears when it
// crosses inside) and the tighter ID arc (a contact is identified — class
// letters — once inside). The scene only reads the latest snapshot (setState)
// and reports taps through onTarget — "state in, actions out".

import Phaser from '/js/vendor/phaser.esm.min.js';

const MAX_RANGE_S = 20;   // impactIn (seconds) mapped to the outer edge of the arc
const URGENT_S = 6;       // close-contact threshold (threat color)
const TAP_RADIUS = 40;    // scene px: how far a tap can land from a blip and still select it
const BLIP_RADIUS = 10;   // base blip dot size
const ARC_HALF_DEG = 78;  // half-angle of the forward fan (~156° total ≈ viewscreen FOV)

const COLOR_ACCENT = 0xff6f6f; // weapons station accent (--accent in style.css)
const COLOR_DIM = 0x7d8db3;
const COLOR_BAD = 0xff5c5c;
const COLOR_TARGETED = 0xffffff;
const COLOR_RING = 0x263353;
// Identified-contact colors: a rescue pod reads green (do NOT shoot), salvage
// amber, a sensor ghost faint purple. UNKNOWN contacts stay dim until resolved.
const COLOR_POD = 0x4cd97b;
const COLOR_MINERAL = 0xffb347;
const COLOR_GHOST = 0x8a7ad0;

export class WeaponsScopeScene extends Phaser.Scene {
  constructor() {
    super('weapons-scope');
    this.latestState = null;
    this.onTarget = null; // set by the page: (asteroidId) => void
    this.blips = new Map(); // asteroid id -> blip handles
    // Optimistic targeting: a tap paints the blip as acquired IMMEDIATELY
    // (before the ~250ms server round-trip), then reconciles against the next
    // few snapshots — cleared once the server confirms, or dropped if it never
    // does (e.g. the contact wasn't actually targetable). Visual only; the
    // authoritative target still comes from the server's targetId.
    this.optimisticTargetId = null;
    this.optimisticSnap = 0;
    this.snapCount = 0;
  }

  create() {
    const { width, height } = this.scale;
    // Origin = the ship, at the bottom-center; the fan opens upward (forward).
    this.ox = width / 2;
    this.oy = height - 10;
    this.radius = height - 22;                 // fan reaches nearly to the top
    this.arcHalf = ARC_HALF_DEG * (Math.PI / 180);
    this.up = -Math.PI / 2;                     // boresight (straight up) in screen angle

    // Scene-level tap handling: pick the nearest blip within TAP_RADIUS of
    // the pointer, resolved against current blip positions at tap time.
    this.input.on('pointerdown', (pointer) => this.handleTap(pointer));

    this.ringsGfx = this.add.graphics();
    this.drawRings();

    this.rangeGfx = this.add.graphics(); // live detection + ID band arcs
    this.sweepGfx = this.add.graphics();
    this.pulseGfx = this.add.graphics(); // expanding active-pulse arc
    this.sweepT = 0;                     // 0..1 oscillating sweep across the fan
    this.pulseT = -1;                    // <0 = idle; 0..1 = expanding

    // The ship: a small chevron at the origin pointing forward.
    const g = this.add.graphics();
    g.fillStyle(COLOR_ACCENT, 1);
    g.fillTriangle(this.ox - 7, this.oy, this.ox + 7, this.oy, this.ox, this.oy - 12);
  }

  // Kick off the expanding sensor-pulse animation (engineering fired a pulse).
  pulse() {
    this.pulseT = 0;
  }

  // Draw an arc sector at a given radius across the forward fan.
  strokeFanArc(g, r) {
    g.beginPath();
    g.arc(this.ox, this.oy, r, this.up - this.arcHalf, this.up + this.arcHalf, false);
    g.strokePath();
  }

  drawRings() {
    const g = this.ringsGfx;
    g.clear();
    g.lineStyle(1, COLOR_RING, 1);
    // A few range arcs for depth read + the two fan edges + the boresight.
    for (let i = 1; i <= 3; i++) this.strokeFanArc(g, (this.radius * i) / 3);
    for (const s of [-1, 1]) {
      const a = this.up + s * this.arcHalf;
      g.lineBetween(this.ox, this.oy, this.ox + Math.cos(a) * this.radius, this.oy + Math.sin(a) * this.radius);
    }
    g.lineStyle(1, COLOR_RING, 0.6);
    g.lineBetween(this.ox, this.oy, this.ox, this.oy - this.radius); // boresight
  }

  update(_time, delta) {
    // Decorative sweep: a radial line oscillating across the fan (not a full spin).
    this.sweepT = (this.sweepT + delta * 0.0004) % 1;
    const a = this.up + Math.sin(this.sweepT * Math.PI * 2) * this.arcHalf;
    const g = this.sweepGfx;
    g.clear();
    g.lineStyle(2, COLOR_ACCENT, 0.25);
    g.lineBetween(this.ox, this.oy, this.ox + Math.cos(a) * this.radius, this.oy + Math.sin(a) * this.radius);

    this.drawRange();
    this.drawPulse(delta);
    this.syncBlips();
  }

  // The live sensor bands: the DETECTION arc (contacts appear inside it) and the
  // tighter ID arc (contacts are identified inside it). Both scale with sensor
  // power, so a well-powered ship resolves contacts earlier (wider arcs).
  drawRange() {
    const g = this.rangeGfx;
    g.clear();
    const s = this.latestState;
    if (!s || s.sensorRange === undefined) return;
    g.lineStyle(1.5, COLOR_ACCENT, 0.35);
    this.strokeFanArc(g, this.radius * Math.min(1, s.sensorRange / MAX_RANGE_S));
    if (s.idRange !== undefined) {
      g.lineStyle(1.5, COLOR_TARGETED, 0.3); // inner ID arc
      this.strokeFanArc(g, this.radius * Math.min(1, s.idRange / MAX_RANGE_S));
    }
  }

  // Expanding arc for an active sensor pulse.
  drawPulse(delta) {
    const g = this.pulseGfx;
    g.clear();
    if (this.pulseT < 0) return;
    this.pulseT += delta / 700;
    if (this.pulseT >= 1) { this.pulseT = -1; return; }
    g.lineStyle(3, COLOR_ACCENT, 1 - this.pulseT);
    this.strokeFanArc(g, this.radius * this.pulseT);
  }

  // Called by the page every time a new server snapshot arrives.
  setState(state) {
    this.latestState = state;
    this.snapCount++;
    // Reconcile the optimistic target: clear it once the server confirms the
    // lock, or after a few snapshots if it never does (tap rejected/expired).
    if (this.optimisticTargetId !== null) {
      if (state.targetId === this.optimisticTargetId || this.snapCount - this.optimisticSnap >= 3) {
        this.optimisticTargetId = null;
      }
    }
  }

  syncBlips() {
    if (!this.latestState) return;
    const seen = new Set();
    // Only render contacts the sensors have resolved (targetable); rocks outside
    // passive range stay invisible until they close in or a pulse reveals them.
    for (const a of this.latestState.asteroids) {
      if (!a.targetable) continue;
      seen.add(a.id);
      let blip = this.blips.get(a.id);
      if (!blip) {
        blip = this.makeBlip(a.id);
        this.blips.set(a.id, blip);
      }
      this.updateBlip(blip, a);
    }
    // Drop blips for contacts that were destroyed, dodged, or hit.
    for (const [id, blip] of this.blips) {
      if (!seen.has(id)) {
        blip.container.destroy();
        this.blips.delete(id);
      }
    }
  }

  // Nearest blip within TAP_RADIUS wins the tap (ties go to the closer one).
  handleTap(pointer) {
    let bestId = null;
    let bestD = Infinity;
    for (const [id, blip] of this.blips) {
      const d = Phaser.Math.Distance.Between(pointer.x, pointer.y, blip.container.x, blip.container.y);
      if (d < bestD) { bestD = d; bestId = id; }
    }
    if (bestId === null || bestD > TAP_RADIUS) return;
    // Paint this blip acquired right now; the next frame's updateBlip reads
    // optimisticTargetId so the ring turns white before the server replies.
    this.optimisticTargetId = bestId;
    this.optimisticSnap = this.snapCount;
    this.onTarget?.(bestId);
  }

  makeBlip(id) {
    // Soft halo behind the dot: gives blips a clean radar-glow read without
    // adding any UI clutter (it inherits the dot's threat color each frame).
    const halo = this.add.circle(0, 0, BLIP_RADIUS * 2, COLOR_DIM, 0.14);
    const dot = this.add.circle(0, 0, BLIP_RADIUS, COLOR_DIM).setStrokeStyle(2, COLOR_DIM);
    // Label is the contact NAME only — threat/speed data lives on the main
    // screen so the captain (not the gunner) reads and calls out priorities.
    const label = this.add
      .text(0, 15, '', { fontSize: '10px', color: '#7d8db3', fontFamily: 'monospace' })
      .setOrigin(0.5, 0);
    const container = this.add.container(this.ox, this.oy, [halo, dot, label]);
    return { container, halo, dot, label };
  }

  updateBlip(blip, a) {
    // Real lateral bearing (-100..100) → angle across the forward fan; impactIn
    // → distance up the fan (far = top, near ship = bottom). Matches the window.
    const bearing = Phaser.Math.Clamp((a.bearing ?? 0) / 100, -1, 1);
    const angle = this.up + bearing * this.arcHalf;
    const t = Phaser.Math.Clamp(a.impactIn / MAX_RANGE_S, 0, 1);
    const dist = this.radius * t;
    blip.container.setPosition(this.ox + Math.cos(angle) * dist, this.oy + Math.sin(angle) * dist);

    const urgent = a.impactIn <= URGENT_S;
    // Targeted if the server says so OR we optimistically locked it on tap.
    const targeted = a.id === this.latestState.targetId || a.id === this.optimisticTargetId;
    // Identified kind drives color so the gunner can tell a rescue pod (green,
    // DON'T shoot) from a rock (red when urgent) at a glance — the sensor
    // gameplay routed to the scope. UNKNOWN contacts stay dim until resolved.
    const kind = a.identified ? a.kind : 'unknown';
    const kindColor = kind === 'pod' ? COLOR_POD
      : kind === 'mineral' ? COLOR_MINERAL
      : kind === 'ghost' ? COLOR_GHOST
      : kind === 'rock' ? (urgent ? COLOR_BAD : COLOR_ACCENT)
      : (urgent ? COLOR_BAD : COLOR_DIM); // unknown
    const color = targeted ? COLOR_TARGETED : kindColor;
    blip.dot.setFillStyle(color);
    blip.dot.setStrokeStyle(targeted ? 3 : 2, color);
    blip.halo.setFillStyle(color, targeted ? 0.22 : 0.12);
    // Every contact reads the SAME size on the scope — it's target ID only. The
    // gunner cannot tell a big rock (needs a full shot) from a small one (a
    // snapshot cracks it); only the captain sees size on the viewscreen and
    // calls it. That's the whole point of the snapshot/size cooperation.
    blip.halo.setRadius(BLIP_RADIUS * (targeted ? 2.4 : 2));
    blip.dot.setRadius(targeted ? BLIP_RADIUS + 2 : BLIP_RADIUS);
    // Label shows the name, plus a "POD"/"?" tag once the kind matters.
    const tag = kind === 'pod' ? ' ⛑' : kind === 'mineral' ? ' ⛏' : kind === 'unknown' ? ' ?' : '';
    blip.label.setText(a.label + tag);
    blip.label.setColor(kind === 'pod' ? '#4cd97b' : urgent ? '#ff5c5c' : '#7d8db3');
  }
}
