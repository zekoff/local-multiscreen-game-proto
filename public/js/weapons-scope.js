// Weapons targeting scope: a Canvas2D instrument showing a forward ARC out the
// front window (not a 360° radar). The ship sits at the bottom; contacts fan
// across the arc by their real lateral BEARING (port ↔ starboard) — the same
// bearing the main-screen viewscreen uses, so the scope and the window agree on
// where a contact is — and travel DOWN the arc toward the ship as impactIn
// counts down. Two arcs mark the sensor bands: the DETECTION arc (a contact
// appears when it crosses inside) and the tighter ID arc (a contact is
// identified — class letters — once inside). The scope only reads the latest
// snapshot (setState) and reports taps through onTarget — "state in, actions out".
//
// This was a Phaser scene until the Canvas2D port. It draws arcs, dots, and
// short labels: no physics, textures, tweens, or asset loading, so the engine
// bought nothing and cost the weapons console (usually a phone) a 1.4 MB
// download. Drawing is IMMEDIATE MODE — every frame is painted from the latest
// snapshot, so there are no retained blip objects to create, update, and destroy
// as contacts come and go. The only state kept between frames is the optimistic
// target (which is what makes a tap feel instant) and the sweep/pulse timers.

import { mountCanvas2D } from '/js/canvas-station.js';

const MAX_RANGE_S = 28;   // impactIn (seconds) mapped to the outer edge of the arc (tracks max sensor detection, ~27s at full sensor power)
const URGENT_S = 6;       // close-contact threshold (threat color)
const ARC_HALF_DEG = 78;  // half-angle of the forward fan (~156° total ≈ viewscreen FOV)
// Blip/tap sizes are authored against this reference height and scaled to the
// panel's real size, so the scope feels identical whether it's rendering into a
// phone cell or a wide desktop one. (Phaser got this free by drawing at a fixed
// size and upscaling; drawing at true size means doing it explicitly.)
const REF_HEIGHT = 200;
// The scope draws into a 9:5 viewport letterboxed inside whatever box the panel
// gives it. The old Phaser mount got this from Scale.FIT (a fixed 360x200 scene
// scaled to fit), and it is not merely cosmetic: the fan is a ~156° forward arc
// standing in for the viewscreen's FOV, so a near-square box would render a fan
// shaped nothing like the window it represents.
const ASPECT = 9 / 5;
const TAP_RADIUS = 40;    // how far a tap can land from a blip and still select it
const BLIP_RADIUS = 10;   // base blip dot size

const COLOR_ACCENT = '#ff6f6f'; // weapons station accent (--accent in style.css)
const COLOR_DIM = '#7d8db3';
const COLOR_BAD = '#ff5c5c';
const COLOR_TARGETED = '#ffffff';
const COLOR_RING = '#263353';
// Identified-contact colors: a rescue pod reads green (do NOT shoot), salvage
// amber, a sensor ghost faint purple. UNKNOWN contacts stay dim until resolved.
const COLOR_POD = '#4cd97b';
const COLOR_MINERAL = '#ffb347';
const COLOR_GHOST = '#8a7ad0';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class WeaponsScope {
  constructor() {
    this.latestState = null;
    this.onTarget = null; // set by the page: (asteroidId) => void
    // Optimistic targeting: a tap paints the blip as acquired IMMEDIATELY
    // (before the ~250ms server round-trip), then reconciles against the next
    // few snapshots — cleared once the server confirms, or dropped if it never
    // does (e.g. the contact wasn't actually targetable). Visual only; the
    // authoritative target still comes from the server's targetId.
    this.optimisticTargetId = null;
    this.optimisticSnap = 0;
    this.snapCount = 0;
    this.sweepT = 0;   // 0..1 oscillating sweep across the fan
    this.pulseT = -1;  // <0 = idle; 0..1 = expanding
    this.host = null;
    // Geometry, recomputed each frame from the canvas size.
    this.geo = { ox: 0, oy: 0, radius: 0, scale: 1 };
    this.arcHalf = ARC_HALF_DEG * (Math.PI / 180);
    this.up = -Math.PI / 2; // boresight (straight up) in screen angle
  }

  mount(el) {
    this.host = mountCanvas2D(el, {
      draw: (ctx, w, h, dt) => this.draw(ctx, w, h, dt),
      onTap: (x, y) => this.handleTap(x, y),
    });
    return this;
  }

  destroy() {
    this.host?.destroy();
    this.host = null;
  }

  // Kick off the expanding sensor-pulse animation (engineering fired a pulse).
  pulse() {
    this.pulseT = 0;
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

  // Fit a 9:5 viewport inside the canvas box and center it, then put the origin
  // (the ship) at the bottom-center of THAT viewport; the fan opens upward.
  computeGeometry(w, h) {
    const vw = w / h > ASPECT ? h * ASPECT : w;
    const vh = vw / ASPECT;
    const offX = (w - vw) / 2;
    const offY = (h - vh) / 2;
    this.geo.ox = offX + vw / 2;
    this.geo.oy = offY + vh - 10;
    this.geo.radius = vh - 22;         // fan reaches nearly to the top
    this.geo.scale = vh / REF_HEIGHT;  // blip/tap sizes track the viewport size
  }

  // Where a contact sits on the fan: real lateral bearing (-100..100) → angle
  // across the fan; impactIn → distance up it (far = top, near ship = bottom).
  // Matches the window, which is the point of the whole layout.
  blipPos(a) {
    const { ox, oy, radius } = this.geo;
    const bearing = clamp((a.bearing ?? 0) / 100, -1, 1);
    const angle = this.up + bearing * this.arcHalf;
    const dist = radius * clamp(a.impactIn / MAX_RANGE_S, 0, 1);
    return { x: ox + Math.cos(angle) * dist, y: oy + Math.sin(angle) * dist };
  }

  // Stroke an arc sector at a given radius across the forward fan.
  strokeFanArc(ctx, r, color, alpha, lineWidth) {
    const { ox, oy } = this.geo;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(ox, oy, Math.max(0, r), this.up - this.arcHalf, this.up + this.arcHalf);
    ctx.stroke();
    ctx.restore();
  }

  line(ctx, x1, y1, x2, y2, color, alpha, lineWidth) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  draw(ctx, w, h, dt) {
    this.computeGeometry(w, h);
    this.drawRings(ctx);
    this.drawRange(ctx);
    this.drawSweep(ctx, dt);
    this.drawPulse(ctx, dt);
    this.drawBlips(ctx);
    this.drawShip(ctx);
  }

  drawRings(ctx) {
    const { ox, oy, radius } = this.geo;
    // A few range arcs for depth read + the two fan edges + the boresight.
    for (let i = 1; i <= 3; i++) this.strokeFanArc(ctx, (radius * i) / 3, COLOR_RING, 1, 1);
    for (const s of [-1, 1]) {
      const a = this.up + s * this.arcHalf;
      this.line(ctx, ox, oy, ox + Math.cos(a) * radius, oy + Math.sin(a) * radius, COLOR_RING, 1, 1);
    }
    this.line(ctx, ox, oy, ox, oy - radius, COLOR_RING, 0.6, 1); // boresight
  }

  // The live sensor bands: the DETECTION arc (contacts appear inside it) and the
  // tighter ID arc (contacts are identified inside it). Both scale with sensor
  // power, so a well-powered ship resolves contacts earlier (wider arcs).
  drawRange(ctx) {
    const s = this.latestState;
    if (!s || s.sensorRange === undefined) return;
    const { radius } = this.geo;
    this.strokeFanArc(ctx, radius * Math.min(1, s.sensorRange / MAX_RANGE_S), COLOR_ACCENT, 0.35, 1.5);
    if (s.idRange !== undefined) {
      this.strokeFanArc(ctx, radius * Math.min(1, s.idRange / MAX_RANGE_S), COLOR_TARGETED, 0.3, 1.5);
    }
  }

  // Decorative sweep: a radial line oscillating across the fan (not a full spin).
  drawSweep(ctx, dt) {
    const { ox, oy, radius } = this.geo;
    this.sweepT = (this.sweepT + dt * 0.0004) % 1;
    const a = this.up + Math.sin(this.sweepT * Math.PI * 2) * this.arcHalf;
    this.line(ctx, ox, oy, ox + Math.cos(a) * radius, oy + Math.sin(a) * radius, COLOR_ACCENT, 0.25, 2);
  }

  // Expanding arc for an active sensor pulse.
  drawPulse(ctx, dt) {
    if (this.pulseT < 0) return;
    this.pulseT += dt / 700;
    if (this.pulseT >= 1) { this.pulseT = -1; return; }
    this.strokeFanArc(ctx, this.geo.radius * this.pulseT, COLOR_ACCENT, 1 - this.pulseT, 3);
  }

  // The ship: a small chevron at the origin pointing forward.
  drawShip(ctx) {
    const { ox, oy } = this.geo;
    ctx.save();
    ctx.fillStyle = COLOR_ACCENT;
    ctx.beginPath();
    ctx.moveTo(ox - 7, oy);
    ctx.lineTo(ox + 7, oy);
    ctx.lineTo(ox, oy - 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawBlips(ctx) {
    if (!this.latestState) return;
    const s = this.geo.scale;
    const r = BLIP_RADIUS * s;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `${Math.round(11 * s)}px monospace`;
    // Only render contacts the sensors have resolved (targetable); rocks outside
    // passive range stay invisible until they close in or a pulse reveals them.
    for (const a of this.latestState.asteroids) {
      if (!a.targetable) continue;
      const { x, y } = this.blipPos(a);
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

      // Soft halo behind the dot: gives blips a clean radar-glow read without
      // adding any UI clutter (it inherits the dot's threat color).
      ctx.globalAlpha = targeted ? 0.22 : 0.12;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r * (targeted ? 2.4 : 2), 0, Math.PI * 2);
      ctx.fill();

      // Every contact reads the SAME size on the scope — it's target ID only. The
      // gunner cannot tell a big rock (needs a full shot) from a small one (a
      // snapshot cracks it); only the captain sees size on the viewscreen and
      // calls it. That's the whole point of the snapshot/size cooperation.
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, targeted ? r + 2 * s : r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = targeted ? 3 : 2;
      ctx.stroke();

      // Label is the contact NAME only — threat/speed data lives on the main
      // screen so the captain (not the gunner) reads and calls out priorities.
      const tag = kind === 'pod' ? ' POD' : kind === 'mineral' ? ' ORE' : kind === 'unknown' ? ' ?' : '';
      ctx.fillStyle = kind === 'pod' ? COLOR_POD : urgent ? COLOR_BAD : COLOR_DIM;
      ctx.fillText(a.label + tag, x, y + 15 * s);
    }
    ctx.restore();
  }

  // Nearest blip within TAP_RADIUS wins the tap (ties go to the closer one).
  // Positions are recomputed from the latest snapshot at tap time.
  handleTap(px, py) {
    if (!this.onTarget || !this.latestState) return;
    let bestId = null;
    let bestD = Infinity;
    for (const a of this.latestState.asteroids) {
      if (!a.targetable) continue;
      const { x, y } = this.blipPos(a);
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) { bestD = d; bestId = a.id; }
    }
    if (bestId === null || bestD > TAP_RADIUS * this.geo.scale) return;
    // Paint this blip acquired right now; the next frame reads optimisticTargetId
    // so the ring turns white before the server replies.
    this.optimisticTargetId = bestId;
    this.optimisticSnap = this.snapCount;
    this.onTarget(bestId);
  }
}
