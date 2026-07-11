// Weapons radar scope: a Phaser scene that replaces the plain button-list of
// sensor contacts with a spatial display — asteroids converge toward the
// ship at the center as impactIn counts down; tap a contact to target it.
// The scene only ever reads the latest state snapshot (via setState) and
// reports taps through onTarget — it never talks to the network directly,
// same "state in, actions out" contract every other station follows.
//
// The server doesn't model bearing (asteroids are a flat list with no
// angle), so each contact gets a stable synthetic bearing derived from its
// id — consistent for the contact's whole lifetime, spread out using the
// golden angle so simultaneous spawns don't overlap.

import Phaser from '/js/vendor/phaser.esm.min.js';

const MAX_RANGE_S = 20; // impactIn (seconds) mapped to the outer ring
const URGENT_S = 6;     // matches the .eta.urgent threshold in the old list UI

const COLOR_ACCENT = 0xff6f6f; // weapons station accent (--accent in style.css)
const COLOR_DIM = 0x7d8db3;
const COLOR_BAD = 0xff5c5c;
const COLOR_TARGETED = 0xffffff;
const COLOR_RING = 0x263353;

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
    this.cx = width / 2;
    this.cy = height / 2;
    this.radius = Math.min(width, height) / 2 - 14;

    this.ringsGfx = this.add.graphics();
    this.drawRings();

    this.rangeGfx = this.add.graphics(); // passive sensor-range ring
    this.sweepGfx = this.add.graphics();
    this.pulseGfx = this.add.graphics(); // expanding active-pulse ring
    this.sweepAngle = 0;
    this.pulseT = -1; // <0 = idle; 0..1 = expanding

    this.add.circle(this.cx, this.cy, 6, COLOR_ACCENT); // the ship, dead center
  }

  // Kick off the expanding sensor-pulse animation (engineering fired a pulse).
  pulse() {
    this.pulseT = 0;
  }

  drawRings() {
    const g = this.ringsGfx;
    g.clear();
    g.lineStyle(1, COLOR_RING, 1);
    for (let i = 1; i <= 3; i++) g.strokeCircle(this.cx, this.cy, (this.radius * i) / 3);
    g.lineBetween(this.cx - this.radius, this.cy, this.cx + this.radius, this.cy);
    g.lineBetween(this.cx, this.cy - this.radius, this.cx, this.cy + this.radius);
  }

  update(_time, delta) {
    // Decorative sweep — not tied to real data, just sells the "radar" read.
    this.sweepAngle += delta * 0.0007;
    const g = this.sweepGfx;
    g.clear();
    g.lineStyle(2, COLOR_ACCENT, 0.3);
    const x2 = this.cx + Math.cos(this.sweepAngle) * this.radius;
    const y2 = this.cy + Math.sin(this.sweepAngle) * this.radius;
    g.lineBetween(this.cx, this.cy, x2, y2);

    this.drawRange();
    this.drawPulse(delta);
    this.syncBlips();
  }

  // Ring showing how far out the passive sensors currently resolve contacts:
  // a rock is invisible until it crosses inside this radius.
  drawRange() {
    const g = this.rangeGfx;
    g.clear();
    const s = this.latestState;
    if (!s || s.sensorRange === undefined) return;
    const rr = this.radius * Math.min(1, s.sensorRange / MAX_RANGE_S);
    g.lineStyle(1.5, COLOR_ACCENT, 0.35);
    g.strokeCircle(this.cx, this.cy, rr);
  }

  // Expanding ring for an active sensor pulse.
  drawPulse(delta) {
    const g = this.pulseGfx;
    g.clear();
    if (this.pulseT < 0) return;
    this.pulseT += delta / 700;
    if (this.pulseT >= 1) { this.pulseT = -1; return; }
    const r = this.radius * this.pulseT;
    g.lineStyle(3, COLOR_ACCENT, 1 - this.pulseT);
    g.strokeCircle(this.cx, this.cy, r);
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

  bearingFor(id) {
    return ((id * 137.508) % 360) * (Math.PI / 180); // golden-angle spread
  }

  makeBlip(id) {
    const dot = this.add.circle(0, 0, 8, COLOR_DIM).setStrokeStyle(2, COLOR_DIM);
    // Label is the contact NAME only — threat/speed data lives on the main
    // screen so the captain (not the gunner) reads and calls out priorities.
    const label = this.add
      .text(0, 13, '', { fontSize: '10px', color: '#7d8db3', fontFamily: 'monospace' })
      .setOrigin(0.5, 0);
    const container = this.add.container(this.cx, this.cy, [dot, label]);
    dot.setInteractive({ useHandCursor: true, hitArea: new Phaser.Geom.Circle(0, 0, 16), hitAreaCallback: Phaser.Geom.Circle.Contains });
    dot.on('pointerdown', () => {
      // Paint this blip acquired right now; the next frame's updateBlip reads
      // optimisticTargetId so the ring turns white before the server replies.
      this.optimisticTargetId = id;
      this.optimisticSnap = this.snapCount;
      this.onTarget?.(id);
    });
    return { container, dot, label };
  }

  updateBlip(blip, a) {
    const bearing = this.bearingFor(a.id);
    const t = Phaser.Math.Clamp(a.impactIn / MAX_RANGE_S, 0, 1);
    const r = this.radius * t; // closer to center = closer to impact
    blip.container.setPosition(this.cx + Math.cos(bearing) * r, this.cy + Math.sin(bearing) * r);

    const urgent = a.impactIn <= URGENT_S;
    // Targeted if the server says so OR we optimistically locked it on tap.
    const targeted = a.id === this.latestState.targetId || a.id === this.optimisticTargetId;
    const color = targeted ? COLOR_TARGETED : urgent ? COLOR_BAD : COLOR_DIM;
    blip.dot.setFillStyle(color);
    blip.dot.setStrokeStyle(targeted ? 3 : 2, color);
    // Bigger rocks read as bigger blips (the captain's early-spot cue too).
    blip.dot.setRadius((targeted ? 10 : 8) * (0.8 + 0.35 * (a.size ?? 1)));
    blip.label.setText(a.label);
    blip.label.setColor(urgent ? '#ff5c5c' : '#7d8db3');
  }
}
