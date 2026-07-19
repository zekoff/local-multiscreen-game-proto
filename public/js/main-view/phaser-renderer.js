// Phaser 4 space-view renderer — the main-screen viewscreen. Implements the
// renderer.js mount contract. Renders the game-legible elements (starfield,
// nebula, a growing destination, nav gates, obstacles, asteroids/pods/minerals,
// tractor beam, lasers, explosions, and the C-fx feedback) with CC0 sprites for
// solid bodies and additive glow for effects.
//
// It reads model.js (snapshot + interpolators + geometry) and effects.js (fx
// buffers + scalars), calling effects.advance(dt) once per frame. The scene runs
// at DEVICE pixels (backing store = container × dpr, CSS-downscaled) so text and
// sprites stay crisp on hi-dpi displays; `this.dpr` scales font sizes, line
// widths, and fixed pixel offsets.
//
// The clean HUD chrome (reticle, chevron, notification/COLLISION banners) is NOT
// drawn here — the hud-overlay owns it. A camera-wide Glow filter + vignette
// (Phaser 4 Filter system) give the cinematic bloom; additive blend layers carry
// the per-effect glow.

import Phaser from '/js/vendor/phaser.esm.min.js';
import {
  getLatest, displayAlignment, displayGateReach, nebulaFor, trafficFor,
  asteroidScreenPos, cachedAstPos, astShapeFor, astPos,
} from '/js/main-view/model.js';
import { fx, lasers, explosions, gateFx, fadeAway, fadeCargo, advance } from '/js/main-view/effects.js';

const ASSETS = '/assets/space';
const STAR_COUNT = 150;
const STAR_FAR_Z = 1;
const STAR_NEAR_Z = 0.02;
const ASTEROID_KEYS = ['ast_b1', 'ast_b2', 'ast_g1', 'ast_g2'];

// #rrggbb -> 0xRRGGBB int for Phaser tint/fill.
const hexInt = (hex) => parseInt(hex.slice(1), 16);

class SpaceScene extends Phaser.Scene {
  constructor() {
    super('space');
    this.yaw = 0;
    this.lastTs = 0;
    this.stars = [];
    this.debris = [];
    this.contacts = new Map();  // asteroid id -> { img, glow }
    this.texts = new Map();     // pooled labels: key -> Text
    this.usedTexts = new Set();
    this.nebulaImgs = [];
    this.nebulaKey = '';
    this.dpr = 1;
    // Arrival cinematic (client-driven): ramps 0->1 over ~2.5s once progress
    // crosses the threshold near a station/planet destination.
    this.arrivalStart = null;
    this.arrivalT = 0;
    this.stationPos = null;     // last-drawn station screen pos {x,y,r} (docking target)
    this.dockers = [];          // decorative ships docking into a background station
    this.dockTimer = 0;
    // Per-mission procedural backdrop (sun, ringed planet, capital ships,
    // comets, buoys), rebuilt when the mission changes; seeded for stability.
    this.backdropKey = '';
    this.backdrop = null;
    // In-scene mission title card (fades in/out once per run).
    this.titleFor = null;
    this.titleStart = null;
    // Localized shield-hit ripples { x, y, t } on the bow arc.
    this.shieldRipples = [];
    this.prevShieldFlash = 0;
    this.contactPool = [];      // reusable {img, glow} for contact pooling
    this.gradeColor = 0x000000; // per-mission color-grade tint
    this.gradeAlpha = 0;
  }

  preload() {
    this.load.image('ast_b1', `${ASSETS}/asteroid_brown_1.png`);
    this.load.image('ast_b2', `${ASSETS}/asteroid_brown_2.png`);
    this.load.image('ast_g1', `${ASSETS}/asteroid_grey_1.png`);
    this.load.image('ast_g2', `${ASSETS}/asteroid_grey_2.png`);
    this.load.image('station', `${ASSETS}/station.png`);
    this.load.image('pod', `${ASSETS}/pod.png`);
    this.load.image('mineral', `${ASSETS}/mineral.png`);
    this.load.image('planet0', `${ASSETS}/planet_0.png`);
    this.load.image('planet1', `${ASSETS}/planet_1.png`);
    this.load.image('planet2', `${ASSETS}/planet_2.png`);
    this.load.image('glow', `${ASSETS}/glow.png`);
    this.load.image('flame', `${ASSETS}/flame.png`);
    this.load.image('smoke', `${ASSETS}/smoke.png`);
    this.load.image('spark', `${ASSETS}/spark.png`);
    this.load.image('star', `${ASSETS}/star.png`);
    this.load.image('streak', `${ASSETS}/streak.png`);
    this.load.image('docker1', `${ASSETS}/docker_1.png`);
    this.load.image('docker2', `${ASSETS}/docker_2.png`);
  }

  create() {
    this.dpr = this.game.registry.get('dpr') || 1;
    this.cameras.main.setBackgroundColor('#05070d');
    this.applyCamera();

    // Graphics layers (immediate-mode, cleared+redrawn each frame), depth-ordered
    // to roughly match the canvas draw order. Additive layers give the glow read.
    this.gBack = this.add.graphics().setDepth(-2);   // procedural backdrop (sun/planet/ships/comets)
    this.gBackAdd = this.add.graphics().setDepth(-1).setBlendMode(Phaser.BlendModes.ADD); // sun glow / comet tails
    this.gStars = this.add.graphics().setDepth(0);
    this.gGates = this.add.graphics().setDepth(5);   // gates + obstacles (behind bodies)
    this.gRings = this.add.graphics().setDepth(14);  // range/threat rings + tractor + target brackets
    this.gAdd = this.add.graphics().setDepth(16).setBlendMode(Phaser.BlendModes.ADD); // lasers, slipstream, explosion glow, muzzle
    this.gWash = this.add.graphics().setDepth(30);   // full-screen flashes / vignette / shield arc / blackout / grade

    // Destination body (station/planet) with an additive glow behind it.
    this.destGlow = this.add.image(0, 0, 'glow').setDepth(6).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.destImg = this.add.image(0, 0, 'station').setDepth(7).setVisible(false);

    // In-scene mission title card (mission name + arrival), fades in/out at start.
    this.titleText = this.add.text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontStyle: '700', align: 'center' })
      .setOrigin(0.5, 0.5).setDepth(28).setResolution(Math.min(3, window.devicePixelRatio || 1)).setVisible(false);
    this.titleSub = this.add.text(0, 0, '', { fontFamily: 'monospace', align: 'center' })
      .setOrigin(0.5, 0.5).setDepth(28).setResolution(Math.min(3, window.devicePixelRatio || 1)).setVisible(false);

    // Starfield + debris in normalized perspective coords (same math as canvas).
    this.stars = Array.from({ length: STAR_COUNT }, () => this.resetStar({}, true));
    this.debris = Array.from({ length: 80 }, () => this.resetDebris({}, true));

    // Cinematic lift: a subtle camera-wide Glow (Phaser 4 Filter system) blooms
    // bright things — lasers, explosions, star cores, gate rings, the destination.
    // Plus a light vignette for a filmic frame. Wrapped defensively: if this
    // build's Filter API differs, the scene still renders (the additive blend
    // layers already carry a glow read).
    try {
      const cam = this.cameras.main;
      if (typeof cam.enableFilters === 'function') cam.enableFilters();
      const fl = cam.filters?.internal;
      if (fl?.addGlow) fl.addGlow(0xffffff, 1.1, 0, 1, false);
      // Subtle barrel/lens distortion (a viewport "port glass" curve) — modulated
      // up with speed and damage in update() for a lens/chromatic feel.
      if (fl?.addBarrel) this.barrel = fl.addBarrel(1.04);
      if (fl?.addVignette) fl.addVignette(0.5, 0.5, 0.9, 0.35);
    } catch { /* Filter API unavailable in this Phaser build — additive blend still glows */ }
  }

  // Zoom the camera by dpr so the scene authors in CSS px while the backing
  // store is device px (crisp). centerOn keeps the CSS-content (0..cssW) filling
  // the device-px viewport; baseScroll is the un-shaken scroll, added to by the
  // screen-shake jitter each frame.
  applyCamera() {
    const cam = this.cameras.main;
    cam.setZoom(this.dpr);
    const cssW = this.scale.width / this.dpr, cssH = this.scale.height / this.dpr;
    cam.centerOn(cssW / 2, cssH / 2);
    this.baseScrollX = cam.scrollX;
    this.baseScrollY = cam.scrollY;
    // LIVING-ROOM SCALE. This screen is read from a couch across the room, not
    // from a desk — the contact callouts the captain calls priorities from are
    // the most important text in the game, and at desk sizes they were simply
    // unreadable at TV distance. Every label (and its offset from the sprite it
    // annotates) is multiplied by this, so text and spacing grow together.
    // 900px CSS wide is the 1.0 reference (a laptop); a 1080p TV lands near 2.1x.
    this.uiScale = Math.max(1, Math.min(2.4, cssW / 900));
  }

  // Scale a label size or offset for viewing distance (see applyCamera).
  ui(n) {
    return n * (this.uiScale || 1);
  }

  onResize() {
    this.cameras.main.setBackgroundColor('#05070d');
    this.applyCamera();
  }

  // ---- pooled label text --------------------------------------------------
  beginTexts() { this.usedTexts.clear(); }
  label(key, str, x, y, colorHex, size, depth) {
    let t = this.texts.get(key);
    if (!t) {
      t = this.add.text(0, 0, '', { fontFamily: 'monospace' })
        .setOrigin(0.5, 0.5)
        .setResolution(Math.min(3, window.devicePixelRatio || 1));
      this.texts.set(key, t);
    }
    t.setFontSize(Math.round(this.ui(size))); // viewing-distance scale (applyCamera)
    t.setText(str);
    t.setColor(colorHex);
    t.setPosition(x, y);
    t.setDepth(depth);
    t.setVisible(true);
    this.usedTexts.add(key);
    return t;
  }
  endTexts() {
    for (const [key, t] of this.texts) if (!this.usedTexts.has(key)) t.setVisible(false);
  }

  resetStar(s, seed) {
    s.x = (Math.random() - 0.5) * 2.4;
    s.y = (Math.random() - 0.5) * 2.4;
    s.z = seed ? STAR_NEAR_Z + Math.random() * (STAR_FAR_Z - STAR_NEAR_Z) : STAR_FAR_Z;
    return s;
  }
  resetDebris(s, deep) {
    s.x = (Math.random() - 0.5) * 2.6;
    s.y = (Math.random() - 0.5) * 2.6;
    s.z = deep ? STAR_NEAR_Z + Math.random() * (STAR_FAR_Z - STAR_NEAR_Z) : STAR_FAR_Z;
    s.a = Math.random() * Math.PI * 2;
    s.sp = (Math.random() - 0.5) * 6;
    s.m = 0.7 + Math.random() * 1.1;
    return s;
  }

  update(time) {
    const dt = this.lastTs ? Math.min(0.05, (time - this.lastTs) / 1000) : 0;
    this.lastTs = time;
    advance(dt); // age shared fx buffers/scalars once per frame

    const latest = getLatest();
    const active = !!(latest && latest.phase === 'active');
    // Author in CSS px (the camera zoom of dpr renders it at device px).
    const w = this.scale.width / this.dpr, h = this.scale.height / this.dpr;

    // Arrival cinematic timer: start once progress crosses the threshold near a
    // themed destination; ramp over ~2.5s. Reset when a fresh run is underway.
    const dest = active ? latest.mission?.destination : null;
    if (active && dest && latest.progress >= 96 && this.arrivalStart === null) this.arrivalStart = time;
    if (active && latest.progress < 50) { this.arrivalStart = null; this.arrivalT = 0; }
    if (this.arrivalStart !== null) this.arrivalT = Math.min(1, (time - this.arrivalStart) / 2500);
    const arr = this.arrivalT;

    // Camera bank with the interpolated alignment; shake via camera scroll jitter
    // added to the base (zoom-centered) scroll. A steady low rumble while a debris
    // field scours the hull, on top of the fx impacts.
    const targetYaw = active ? Math.max(-1, Math.min(1, displayAlignment() / 100)) : 0;
    this.yaw += (targetYaw - this.yaw) * Math.min(1, dt * 8);
    this.cameras.main.setRotation(this.yaw * 0.04);
    const scouring = active && latest.debrisIn > 0 && (latest.throttle || 0) > 40;
    const shakeMag = Math.max(fx.shake, scouring ? 3 : 0);
    if (shakeMag > 0.2) {
      const s = shakeMag * 0.5;
      this.cameras.main.setScroll(this.baseScrollX + (Math.random() - 0.5) * s, this.baseScrollY + (Math.random() - 0.5) * s);
    } else {
      this.cameras.main.setScroll(this.baseScrollX, this.baseScrollY);
    }

    const cx = w / 2 - this.yaw * w * 0.16;
    const cy = h / 2;
    const projScale = Math.min(w, h) * 0.5;
    const yawPx = -this.yaw * w * 0.16;
    // Normalized ship speed (0 stationary .. ~1.6 slipstream) for the starfield:
    // speed maxes at 60*speedScale; slipstream (×1.6 in the engine) pushes past 1.
    const speed = active ? (latest.speed || 0) : 0;
    const maxSpeed = 60 * ((active && latest.mission?.speedScale) || 1);
    let normSpeed = maxSpeed > 0 ? Math.min(1.6, speed / maxSpeed) : 0;
    if (arr > 0) normSpeed = Math.max(normSpeed, 0.6 + arr); // rush the stars on arrival dolly
    const slipstream = !!(active && latest.slipstream);      // radial streak burst (drawSlipstream)

    this.gStars.clear();
    this.gGates.clear();
    this.gRings.clear();
    this.gAdd.clear();
    this.gWash.clear();
    this.gBack.clear();
    this.gBackAdd.clear();
    this.beginTexts();

    this.updateGrade(latest, active);            // per-mission color-grade tint
    this.updateBarrel(normSpeed, fx.hullFlash);  // lens distortion up with speed/damage
    if (this.gradeAlpha > 0) this.fullRect(this.gWash, this.gradeColor, this.gradeAlpha, w, h);
    this.drawBackdrop(latest, dt, w, h, yawPx, active); // procedural sun/planet/ships/comets/buoys
    this.drawNebula(latest, w, h, yawPx);
    this.drawStars(dt, cx, cy, projScale, normSpeed, w, h);

    if (active) {
      this.drawDistantTraffic(latest, w, h, yawPx);
      this.drawDestination(latest, w, h, cx, arr);
      this.drawGates(latest, w, h, cy);
      this.drawObstacles(latest, w, h, cy);
      this.syncContacts(latest, w, h, yawPx, time, arr);
      this.drawTractor(latest, w, h);
      this.drawLasers(w, h, yawPx);
      this.drawExplosions(dt, w, h, yawPx);
      if (latest.debrisIn > 0) this.drawDebris(latest, dt, cx, cy, projScale, w, h);
      if (latest.ionStormIn > 0) this.drawIonStorm(w, h);
    } else {
      this.clearContacts();
      this.stationPos = null;
    }
    this.updateDockers(dt, active, dest, w, h);
    this.drawFades(w, h, time);

    // C-fx feedback (fixed-screen washes + shield arc). Drawn on gWash (screen
    // space); these are allowed to differ from the canvas view — the point of the
    // port. Position in world coords compensating for camera scroll/rotation is
    // unnecessary here because a full-screen wash reads the same either way; we
    // oversize the rects so rotation never reveals an edge.
    if (active) {
      this.drawShieldArc(latest, w, h);
      this.drawHullVignette(latest, w, h);
      this.drawDamageOverlay(latest, w, h);
      if (latest.viewImpaired) this.drawBlackout(w, h);
      if (slipstream) this.drawSlipstream(w, h);
    }
    if (active) this.updateShieldRipples(latest, dt, w, h); // localized bow shield-hit ripples
    this.drawGateFlash(w, h);
    this.drawFlashes(w, h);
    this.drawWarpTunnel(w, h, cx, cy); // radial streak tunnel during an emergency warp
    this.drawTitleCard(latest, w, h, time, active); // in-scene mission intro card
    // Arrival cinematic: ramp the whole viewscreen to black as the ship dollies
    // into the station — kept drawing through the debrief hand-off so it stays
    // dark under the debrief overlay.
    if (arr > 0) this.fullRect(this.gWash, 0x000000, arr * arr, w, h);

    this.endTexts();
  }

  // Oversized rect helper so camera rotation/scroll never reveals an unfilled edge.
  fullRect(g, colorInt, alpha, w, h) {
    if (alpha <= 0) return;
    g.fillStyle(colorInt, alpha);
    g.fillRect(-w, -h, w * 3, h * 3);
  }

  // --- Per-mission color grade: a subtle full-screen tint (Europa cold blue, a
  // planet destination warmer) drawn as a low-alpha wash each frame. -------
  updateGrade(latest, active) {
    if (!active || !latest?.mission) { this.gradeAlpha = 0; return; }
    const id = latest.mission.id || '';
    const dest = latest.mission.destination;
    if (id.startsWith('gen:europa')) { this.gradeColor = 0x2a4a80; this.gradeAlpha = 0.11; }
    else if (dest?.kind === 'planet') { this.gradeColor = 0x7a5a2a; this.gradeAlpha = 0.06; }
    else { this.gradeColor = 0x2f4a72; this.gradeAlpha = 0.05; }
  }

  // Lens/barrel distortion: a touch more curve at speed, a brief punch on a hull
  // hit (a lens-shock / chromatic feel).
  updateBarrel(normSpeed, hullFlash) {
    if (!this.barrel) return;
    const amt = 1.03 + normSpeed * 0.05 + Math.min(0.12, hullFlash * 0.18);
    try { this.barrel.amount = amt; } catch { /* controller shape differs in this build */ }
  }

  // --- Procedural backdrop: a small coherent set of distant objects chosen +
  // placed per mission (seeded, stable), in reasonable far-away proportions. --
  seededScene(id) {
    let h = 2166136261 >>> 0;
    for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    const rand = () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 2 ** 32; };
    const cold = id.startsWith('gen:europa');
    const s = {};
    s.sun = { x: 0.1 + rand() * 0.8, y: 0.07 + rand() * 0.2, r: 9 + rand() * 7,
      col: cold ? [200, 224, 255] : [255, 236, 200], depth: 0.12 };
    if (rand() > 0.35) s.world = { x: 0.12 + rand() * 0.76, y: 0.12 + rand() * 0.28,
      r: 24 + rand() * 30, ringed: rand() > 0.45, key: `planet${Math.floor(rand() * 3)}`, depth: 0.22 };
    s.comets = Array.from({ length: Math.floor(rand() * 2.6) }, () => ({
      y: 0.1 + rand() * 0.5, speed: (0.02 + rand() * 0.03) * (rand() < 0.5 ? -1 : 1),
      phase: rand(), len: 26 + rand() * 34, col: cold ? [180, 220, 255] : [255, 230, 200] }));
    s.caps = Array.from({ length: Math.floor(rand() * 2.4) }, () => ({
      y: 0.14 + rand() * 0.38, speed: (0.008 + rand() * 0.012) * (rand() < 0.5 ? -1 : 1),
      phase: rand(), len: 30 + rand() * 24, col: ['#9fb4e0', '#c8a882', '#8fd6ff'][Math.floor(rand() * 3)] }));
    return s;
  }

  drawBackdrop(latest, dt, w, h, yawPx, active) {
    const id = active ? latest?.mission?.id : null;
    if (!id) { if (this.worldImg) this.worldImg.setVisible(false); return; }
    if (id !== this.backdropKey) { this.backdropKey = id; this.backdrop = this.seededScene(id); }
    const s = this.backdrop; if (!s) return;
    const g = this.gBack, ga = this.gBackAdd, tNow = performance.now() / 1000;
    const c3 = (a) => Phaser.Display.Color.GetColor(a[0], a[1], a[2]);

    // Sun: bright core + additive glow + faint flare cross.
    const sun = s.sun, sx = sun.x * w + yawPx * sun.depth, sy = sun.y * h, sc = c3(sun.col);
    ga.fillStyle(sc, 0.5); ga.fillCircle(sx, sy, sun.r * 0.8);
    ga.fillStyle(sc, 0.12); ga.fillCircle(sx, sy, sun.r * 3.2);
    ga.lineStyle(1, sc, 0.22);
    ga.lineBetween(sx - sun.r * 4, sy, sx + sun.r * 4, sy);
    ga.lineBetween(sx, sy - sun.r * 3, sx, sy + sun.r * 3);

    // A distant world (planet sprite) with an optional ring.
    if (s.world) {
      const wx = s.world.x * w + yawPx * s.world.depth, wy = s.world.y * h, r = s.world.r;
      if (!this.worldImg) this.worldImg = this.add.image(0, 0, s.world.key).setDepth(-2);
      this.worldImg.setTexture(s.world.key).setVisible(true).setPosition(wx, wy).setDisplaySize(r * 2, r * 2).setAlpha(0.85);
      if (s.world.ringed) { g.lineStyle(2, 0xb9c6e0, 0.45); g.strokeEllipse(wx, wy, r * 3, r * 0.8); }
    } else if (this.worldImg) this.worldImg.setVisible(false);

    // Comets: a bright head + additive tail drifting across.
    for (const cm of s.comets) {
      const x = (((cm.phase + cm.speed * tNow) % 1.2) + 1.2) % 1.2 * w, y = cm.y * h, dir = cm.speed > 0 ? -1 : 1;
      ga.lineStyle(1.5, c3(cm.col), 0.45);
      ga.lineBetween(x, y, x + dir * cm.len, y - cm.len * 0.14);
      ga.fillStyle(0xffffff, 0.8); ga.fillCircle(x, y, 1.6);
    }

    // Capital ships: elongated dark hulls with a running light, far off.
    for (const cap of s.caps) {
      const x = (((cap.phase + cap.speed * tNow) % 1) + 1) % 1 * w + yawPx * 0.18, y = cap.y * h;
      g.fillStyle(0x0e1626, 0.9); g.fillRect(x, y, cap.len, 4);
      g.fillStyle(hexInt(cap.col), 0.55); g.fillRect(x, y + 1, cap.len, 1.4);
      const blink = 0.4 + 0.6 * ((Math.sin(tNow * 2 + cap.phase * 7) + 1) / 2);
      ga.fillStyle(0xbfe0ff, blink); ga.fillRect(x + (cap.speed > 0 ? cap.len : -1.5), y, 1.6, 1.6);
    }

    // Buoys near a background station: a couple of blinking marker lights.
    if (this.stationPos && latest.mission?.destination?.kind === 'station') {
      const st = this.stationPos;
      for (let i = 0; i < 2; i++) {
        const a = tNow * 0.3 + i * Math.PI;
        const bx = st.x + Math.cos(a) * st.r * 2.4, by = st.y + Math.sin(a) * st.r * 1.2;
        const blink = (Math.sin(tNow * 3 + i * 2) + 1) / 2;
        ga.fillStyle(0x6ad39a, 0.3 + blink * 0.5); ga.fillCircle(bx, by, 1.5);
      }
    }
  }

  // Localized bow shield-hit ripple: on an ABSORBED impact (shieldFlash rising
  // edge) a bright ring expands on the shield arc at the nearest contact's bearing.
  updateShieldRipples(latest, dt, w, h) {
    if (fx.shieldFlash > this.prevShieldFlash + 0.2) {
      const near = (latest.asteroids || []).filter((a) => a.targetable).sort((a, b) => a.impactIn - b.impactIn)[0];
      const b = near ? Phaser.Math.Clamp((near.bearing - displayAlignment()) / 100, -1, 1) : 0;
      this.shieldRipples.push({ b, t: 0 });
      if (this.shieldRipples.length > 4) this.shieldRipples.shift();
    }
    this.prevShieldFlash = fx.shieldFlash;
    if (!latest.shields?.raised) { this.shieldRipples.length = 0; return; }
    const cxs = w / 2, cys = h * 1.18, rad = h * 0.62, g = this.gWash;
    for (let i = this.shieldRipples.length - 1; i >= 0; i--) {
      const rp = this.shieldRipples[i];
      rp.t += dt / 0.5;
      if (rp.t >= 1) { this.shieldRipples.splice(i, 1); continue; }
      const ang = -Math.PI / 2 + rp.b * 0.5 * Math.PI;
      const px = cxs + Math.cos(ang) * rad, py = cys + Math.sin(ang) * rad;
      g.lineStyle(2.5 * (1 - rp.t), 0xbfe4ff, (1 - rp.t) * 0.8);
      g.strokeCircle(px, py, 6 + rp.t * 34);
    }
  }

  // Emergency-warp jump tunnel: radial white streaks rush outward into the
  // white-out (drawn additively during warpFlash).
  drawWarpTunnel(w, h, cx, cy) {
    if (fx.warpFlash <= 0.02) return;
    const k = fx.warpFlash, g = this.gAdd, n = 26, now = performance.now() / 1000;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + now;
      const r0 = Math.min(w, h) * (0.05 + (1 - k) * 0.3);
      const r1 = r0 + Math.min(w, h) * 0.5 * k;
      g.lineStyle(1 + k * 2, 0xdfeeff, k * 0.7);
      g.lineBetween(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0, w / 2 + Math.cos(a) * r1, h / 2 + Math.sin(a) * r1);
    }
  }

  // In-scene mission intro title card: the mission name + destination fades in
  // then out over the first ~5s of a run.
  drawTitleCard(latest, w, h, time, active) {
    if (!active || !latest.mission) {
      this.titleFor = null; this.titleStart = null;
      this.titleText.setVisible(false); this.titleSub.setVisible(false);
      return;
    }
    if (this.titleFor !== latest.mission.id) {
      this.titleFor = latest.mission.id;
      this.titleStart = time;
      this.titleText.setText((latest.mission.name || 'MISSION').toUpperCase());
      this.titleSub.setText(latest.mission.arrivalName ? `→ ${latest.mission.arrivalName.toUpperCase()}` : '');
    }
    const e = (time - this.titleStart) / 1000;
    let a = 0;
    if (e < 0.8) a = e / 0.8; else if (e < 3.5) a = 1; else if (e < 5) a = 1 - (e - 3.5) / 1.5;
    const vis = a > 0.01;
    this.titleText.setVisible(vis).setAlpha(a).setPosition(w / 2, h * 0.42)
      .setFontSize(Math.round(Math.min(46, w * 0.06))).setColor('#eaf2ff');
    this.titleSub.setVisible(vis).setAlpha(a * 0.85).setPosition(w / 2, h * 0.42 + 34)
      .setFontSize(15).setColor('#8fb4e0');
  }

  drawNebula(latest, w, h, yawPx) {
    const id = latest?.mission?.id;
    if (!id) { for (const im of this.nebulaImgs) im.setVisible(false); return; }
    if (id !== this.nebulaKey) {
      this.nebulaKey = id;
      const blobs = nebulaFor(id);
      // (Re)build one additive glow sprite per nebula blob.
      for (const im of this.nebulaImgs) im.destroy();
      this.nebulaImgs = blobs.map(() => this.add.image(0, 0, 'glow')
        .setDepth(-1).setBlendMode(Phaser.BlendModes.ADD));
    }
    const blobs = nebulaFor(id);
    const tNow = performance.now() / 1000;
    blobs.forEach((b, i) => {
      const im = this.nebulaImgs[i];
      if (!im) return;
      const bx = ((b.x + b.drift * tNow) % 1.2) * w + yawPx * b.depth;
      const by = b.y * h;
      const br = b.r * Math.min(w, h) * 3.2;
      im.setPosition(bx, by).setDisplaySize(br, br)
        .setTint(Phaser.Display.Color.GetColor(b.c[0], b.c[1], b.c[2]))
        .setAlpha(b.a * 2.2).setVisible(true);
    });
  }

  // normSpeed: 0 = stationary (no star motion), 1 = max velocity, up to ~1.6 in a
  // slipstream. Star z-rate scales linearly with it, and each star grows a
  // ghostly motion trail whose length and alpha both climb with speed (alpha to
  // 1.0 at max), so "we're moving fast" reads at a glance.
  drawStars(dt, cx, cy, projScale, normSpeed, w, h) {
    const g = this.gStars;
    const rate = normSpeed * 0.4;             // z-decrease/sec — 0 at rest, doubled top speed
    // Trails cut ~a third from the old peak (length + opacity) so fast flight
    // still smears but reads cleaner.
    const trailLen = Math.min(0.30, normSpeed * 0.29);
    const trailA = Math.min(1, normSpeed) * 0.67;
    for (const s of this.stars) {
      s.z -= rate * dt;
      if (s.z <= STAR_NEAR_Z) this.resetStar(s, false);
      const px = cx + (s.x / s.z) * projScale;
      const py = cy + (s.y / s.z) * projScale;
      if (px < 0 || px > w || py < 0 || py > h) continue;
      const closeness = 1 - (s.z - STAR_NEAR_Z) / (STAR_FAR_Z - STAR_NEAR_Z);
      const size = 0.5 + closeness * 2.5;
      // Streak back toward the vanishing point (project at a deeper z); its length
      // grows with speed.
      if (normSpeed > 0.05) {
        const zb = Math.min(STAR_FAR_Z, s.z + trailLen * (0.4 + closeness));
        const bx = cx + (s.x / zb) * projScale;
        const by = cy + (s.y / zb) * projScale;
        g.lineStyle(Math.max(1, size * 0.8), 0xa8c4ff, (0.05 + closeness * 0.5) * trailA);
        g.lineBetween(bx, by, px, py);
      }
      g.fillStyle(0xcfe0ff, 0.2 + closeness * 0.7);
      g.fillRect(px - size / 2, py - size / 2, size, size);
    }
  }

  drawDistantTraffic(latest, w, h, yawPx) {
    const g = this.gGates;
    const tNow = performance.now() / 1000;
    for (const v of trafficFor(latest.mission?.id || 'x')) {
      const x = (((v.phase + v.speed * tNow) % 1) + 1) % 1 * w + yawPx * 0.25;
      const y = v.y * h;
      const blink = (Math.sin(tNow * 3 + v.phase * 9) + 1) / 2;
      // A bit bigger than a dot so distant traffic reads as vessels.
      g.fillStyle(v.col === '#9fb4e0' ? 0x9fb4e0 : 0xc8a882, 0.55);
      g.fillRect(x, y, 11, 2.6);
      g.fillStyle(0xb4dcff, 0.3 + blink * 0.55);
      g.fillRect(x + (v.speed > 0 ? 11 : -2.4), y - 0.6, 2.4, 2.4);
    }
  }

  drawDestination(latest, w, h, cx, arr) {
    const progress = latest.progress;
    const dest = latest.mission?.destination;
    const grow = Math.min(1, progress / 100);
    // Start as a speck (about a spawned star) and stay tiny until well into the
    // run — a steep growth curve — so the horizon body reads as genuinely distant.
    let r = 1.5 + Math.pow(grow, 2.6) * 96;
    // Arrival dolly: the ship rushes the station, so it swells fast and slides to
    // screen centre while everything fades to black (see the update() wash).
    const px = cx + (w / 2 - cx) * arr;
    const py = h * 0.4 + (h * 0.5 - h * 0.4) * arr;
    r *= 1 + arr * 5;
    const colorHex = dest?.color || '#7ddb9a';
    const name = (latest.mission?.arrivalName || 'DESTINATION').toUpperCase();

    // Additive glow halo behind the body (scales with the body, so a speck has a
    // speck-sized halo, not a big wash).
    this.destGlow.setVisible(true).setPosition(px, py).setDisplaySize(r * 4.2, r * 4.2)
      .setTint(hexInt(colorHex)).setAlpha(0.22);

    if (dest?.kind === 'planet') {
      // Seeded planet sprite per mission (full-color art, shown as-is).
      let hsh = 0; for (const c of (latest.mission.id || 'x')) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
      const key = `planet${hsh % 3}`;
      if (this.destImg.texture.key !== key) this.destImg.setTexture(key);
      this.destImg.clearTint();
      this.destImg.setVisible(true).setPosition(px, py).setDisplaySize(r * 2.4, r * 2.4).setRotation(0);
      this.stationPos = null;
    } else {
      // Station (or generic): the clean ringed station sprite, tinted the
      // mission's destination color, slowly rotating.
      if (this.destImg.texture.key !== 'station') this.destImg.setTexture('station');
      this.destImg.setTint(hexInt(colorHex));
      this.destImg.setVisible(true).setPosition(px, py).setDisplaySize(r * 2.6, r * 2.6)
        .setRotation((performance.now() / 6000) % (Math.PI * 2));
      // Docking approach: the station's lights power up as the ship arrives.
      if (arr > 0) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + performance.now() / 2000;
          this.gAdd.fillStyle(0xffe6a0, 0.25 + arr * 0.6);
          this.gAdd.fillCircle(px + Math.cos(a) * r * 0.9, py + Math.sin(a) * r * 0.45, 1.5 + arr * 2.5);
        }
      }
      // Remember where the station is so docking traffic can fly into it.
      this.stationPos = { x: px, y: py, r };
    }
    if (r > 10 && arr < 0.3) this.label('dest', name, px, py - r - this.ui(14), colorHex, 12, 8);
  }

  drawGates(latest, w, h, cy) {
    const GATE_MAX_REACH = 19;
    const align = displayAlignment();
    const g = this.gGates;
    for (const gate of latest.gates || []) {
      const reach = displayGateReach(gate.id, gate.reachIn);
      const t = Math.max(0, Math.min(1, 1 - reach / GATE_MAX_REACH));
      const r = 14 + t * t * Math.min(w, h) * 0.7;
      const cxg = w / 2 + ((gate.bearing - align) / 100) * (w * 0.5);
      const lined = Math.abs(align - gate.bearing) <= 30;
      const colorInt = lined ? 0x8fd6ff : 0xffb347;
      g.lineStyle(2 + t * 3, colorInt, 0.35 + t * 0.5);
      g.strokeEllipse(cxg, cy, r * 2, r * 2 * 0.82);
      g.fillStyle(colorInt, 0.5 + t * 0.4);
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        g.fillCircle(cxg + Math.cos(a) * r, cy + Math.sin(a) * r * 0.82, 2.5);
      }
      if (t < 0.5) {
        this.label(`gate${gate.id}`, `${gate.label} ${Math.ceil(gate.reachIn)}s`,
          cxg, cy - r * 0.82 - this.ui(12), lined ? '#8fd6ff' : '#ffb347', 11, 8);
      }
    }
  }

  drawObstacles(latest, w, h, cy) {
    const align = displayAlignment();
    const g = this.gGates;
    for (const ob of latest.obstacles || []) {
      const t = Math.max(0, Math.min(1, 1 - ob.reachIn / 20));
      const r = 24 + t * t * Math.min(w, h) * 0.9;
      const cxo = w / 2 + ((ob.bearing - align) / 100) * (w * 0.5);
      const into = Math.abs(align - ob.bearing) < (ob.clearWindow || 22);
      const pulse = (Math.sin(performance.now() / 160) + 1) / 2;
      const bodyInt = into ? 0x281a18 : 0x1e1a18;
      g.fillStyle(bodyInt, into ? 0.9 : 0.85);
      g.fillCircle(cxo, cy, r);
      g.lineStyle(2 + t * 2, into ? 0xff5a5a : 0x786e64, into ? 0.7 + pulse * 0.3 : 0.6);
      g.strokeCircle(cxo, cy, r);
      const steer = ob.bearing > align ? 'STEER PORT ◀' : '▶ STEER STARBOARD';
      this.label(`ob${ob.label}`, into ? `${ob.label} — COLLISION · ${steer}` : `${ob.label} — CLEAR`,
        cxo, cy - r - 12, into ? '#ff5c5c' : '#7ddb9a', 12, 20);
    }
  }

  syncContacts(latest, w, h, yawPx, time, arr) {
    if (astPos.size > 400) astPos.clear();
    const fadeA = 1 - arr;         // fade contacts out during the arrival dolly
    const showLabels = arr < 0.3;
    const seen = new Set();
    for (const a of latest.asteroids) {
      if (a.phantom) continue;
      const { x: px, y: py } = asteroidScreenPos(a, w, h, yawPx);
      const size = a.size ?? 1;
      const big = size > 1.2;
      const growth = Math.max(0, Math.min(1, 1 - a.impactIn / 16));
      const nearBoost = 1 + Math.max(0, 5 - a.impactIn) * 0.14;
      // Wider small<->large spread: big hazards bloom a bit bigger, small rocks
      // smaller. Base bloom nudged up so the MAX size of every target is a touch
      // larger.
      const bloom = 29 * (big ? 2.25 : 0.82);
      const r = (0.7 + Math.pow(growth, 1.25) * bloom) * (0.74 + 0.26 * size) * nearBoost;
      astPos.set(a.id, { x: px, y: py, r });
      seen.add(a.id);

      const vk = a.visualKind || 'unknown';
      let c = this.contacts.get(a.id);
      if (!c) {
        // Pool the sprite pair — reuse a hidden one when available (perf: avoids
        // create/destroy churn as contacts stream through).
        c = this.contactPool.pop();
        if (!c) {
          const glow = this.add.image(0, 0, 'glow').setDepth(9).setBlendMode(Phaser.BlendModes.ADD);
          const img = this.add.image(0, 0, ASTEROID_KEYS[a.id % 4]).setDepth(10);
          c = { img, glow };
        }
        this.contacts.set(a.id, c);
      }
      const shape = astShapeFor(a.id);
      c.img.setPosition(px, py).setVisible(true).setAlpha(fadeA);
      c.glow.setPosition(px, py).setVisible(true);
      // Target-lock brackets when Weapons has this contact acquired — animated
      // corner brackets that snap on and rotate slowly.
      if (a.id === latest.targetId && showLabels) this.drawBrackets(px, py, Math.max(r, 12) + 8, fadeA);

      if (vk === 'pod') {
        const rr = Math.max(14, r);
        c.img.setTexture('pod').setRotation(0).setAlpha(fadeA);
        if (a.identified) {
          // Resolved as a rescue pod: green highlight + the DO-NOT-FIRE call.
          const blink = (Math.sin(performance.now() / 220) + 1) / 2;
          c.img.setTint(0x4cd97b).setDisplaySize(rr * 2.2, rr * 2.2);
          c.glow.setTint(0x4cd97b).setDisplaySize(rr * 5, rr * 5).setAlpha((0.18 + blink * 0.22) * fadeA);
          if (showLabels) {
            this.label(`c${a.id}`, `${a.label} — RESCUE POD`, px, py - rr - this.ui(14), '#4cd97b', 12, 12);
            this.label(`c2${a.id}`, 'DO NOT FIRE', px, py + rr + this.ui(16), blink > 0.5 ? '#7dffb0' : '#4cd97b', 12, 12);
          }
        } else {
          // Visible pod SILHOUETTE, but not yet resolved — neutral, no green, no
          // "rescue pod" call (that waits for sensor ID range). Silhouette holds.
          c.img.setTint(0x9aa6b8).setDisplaySize(rr * 2.1, rr * 2.1);
          c.glow.setTint(0x9aa6b8).setDisplaySize(rr * 3.2, rr * 3.2).setAlpha(0.1 * fadeA);
        }
        continue;
      }
      if (vk === 'mineral') {
        // Salvage reads MID-SIZED — between a small and a large asteroid — so it's
        // easy to spot as tow-worthy (it's small-class in the engine, so scale up).
        const rr = Math.max(16, r * 1.8);
        c.img.setTexture('mineral').setTint(0xffb347).setDisplaySize(rr * 2, rr * 2)
          .setRotation((performance.now() / 2600) % (Math.PI * 2));
        c.glow.setTint(0xffb347).setDisplaySize(rr * 3.6, rr * 3.6).setAlpha((0.14 + growth * 0.14) * fadeA);
        if (showLabels) this.label(`c${a.id}`, `${a.label} — SALVAGE`, px, py - rr - this.ui(14), '#ffb347', 11, 12);
        continue;
      }

      // Rock: asteroid sprite (brown = large/deeper, grey = small), per-id spin.
      const key = ASTEROID_KEYS[(big ? 0 : 2) + (a.id % 2)];
      if (c.img.texture.key !== key) c.img.setTexture(key);
      c.img.clearTint();
      c.img.setDisplaySize(r * 2.2, r * 2.2)
        .setRotation((time / 1000) * shape.spin);
      // Keep the glow a tight rim, not a big wash — a large rock is a crisp
      // sprite, not a fuzzy disc.
      c.glow.setTint(big ? 0x78604a : 0x968c78).setDisplaySize(r * 2.2, r * 2.2)
        .setAlpha((0.08 + growth * 0.14) * fadeA);

      // Range ring (acquired) — faint distance cue.
      if (a.targetable && showLabels) {
        const ringR = r + (34 + r * 0.8) * Math.min(1, a.impactIn / 16);
        this.gRings.lineStyle(1, 0xa0b4dc, 0.16 * fadeA);
        this.gRings.strokeCircle(px, py, ringR);
      }
      // Threat ring + label (targetable rocks/unknowns only).
      if (a.targetable && showLabels && (a.kind === 'rock' || a.kind === 'unknown')) {
        const spd = a.speed ?? 1;
        const threatHex = (spd >= 1.15 || a.impactIn < 6) ? '#ff5c5c'
          : (spd >= 0.95 || a.impactIn < 12) ? '#ffb347' : '#e0d24c';
        const targeted = a.id === latest.targetId;
        this.gRings.lineStyle(targeted ? 3.5 : 2, hexInt(threatHex), (targeted ? 1 : 0.8) * fadeA);
        this.gRings.strokeCircle(px, py, r + (targeted ? 6 : 4));
        this.label(`c${a.id}`, `${a.label} ${Math.ceil(a.impactIn)}s`, px, py - r - this.ui(14), threatHex, 12, 12);
      }
    }
    for (const [id, c] of this.contacts) {
      if (!seen.has(id)) {
        c.img.setVisible(false); c.glow.setVisible(false);
        this.contacts.delete(id);
        this.contactPool.push(c);
        if (this.contactPool.length > 40) { const x = this.contactPool.shift(); x.img.destroy(); x.glow.destroy(); }
      }
    }
  }
  clearContacts() {
    for (const [, c] of this.contacts) { c.img.setVisible(false); c.glow.setVisible(false); this.contactPool.push(c); }
    this.contacts.clear();
  }

  // Animated target-lock corner brackets around an acquired contact.
  drawBrackets(x, y, r, alpha) {
    const g = this.gRings;
    const spin = performance.now() / 900;
    const arm = Math.max(6, r * 0.35);
    g.lineStyle(2, 0xffffff, 0.9 * alpha);
    for (let k = 0; k < 4; k++) {
      const a = spin + k * (Math.PI / 2) + Math.PI / 4;
      const cxk = x + Math.cos(a) * r, cyk = y + Math.sin(a) * r;
      // Two short arms forming an L at each corner, tangent-ish to the ring.
      g.lineBetween(cxk, cyk, cxk + Math.cos(a + Math.PI / 2) * arm, cyk + Math.sin(a + Math.PI / 2) * arm);
      g.lineBetween(cxk, cyk, cxk - Math.cos(a + Math.PI / 2) * arm, cyk - Math.sin(a + Math.PI / 2) * arm);
    }
  }

  // Decorative traffic for a background-station mission (e.g. Europa): small
  // ships enter from a screen edge and fly INTO the station, angled along their
  // travel and z-ordered behind it (depth 4 < station's 7), so they vanish into
  // it on arrival. Pure backdrop — no state, seeded off Math.random (cosmetic).
  updateDockers(dt, active, dest, w, h) {
    const st = this.stationPos;
    if (!active || dest?.kind !== 'station' || !st) {
      for (const d of this.dockers) d.img.destroy();
      this.dockers.length = 0;
      return;
    }
    this.dockTimer -= dt;
    if (this.dockTimer <= 0 && this.dockers.length < 3) {
      this.dockTimer = 4 + Math.random() * 5;
      const edge = Math.floor(Math.random() * 4);
      const sx = edge === 1 ? w + 12 : edge === 3 ? -12 : Math.random() * w;
      const sy = edge === 0 ? -12 : edge === 2 ? h * 0.72 : Math.random() * h * 0.6;
      const img = this.add.image(sx, sy, Math.random() < 0.5 ? 'docker1' : 'docker2')
        .setDepth(4).setTint(0xaebccc);
      this.dockers.push({ img, sx, sy, t: 0, dur: 6 + Math.random() * 5, size: 13 + Math.random() * 9 });
    }
    for (let i = this.dockers.length - 1; i >= 0; i--) {
      const d = this.dockers[i];
      d.t += dt / d.dur;
      if (d.t >= 1) { d.img.destroy(); this.dockers.splice(i, 1); continue; }
      const x = d.sx + (st.x - d.sx) * d.t;
      const y = d.sy + (st.y - d.sy) * d.t;
      const scale = 1 - 0.82 * d.t; // shrink as it nears the station (perspective)
      d.img.setPosition(x, y)
        .setDisplaySize(d.size * scale, d.size * scale * 0.6)
        .setAlpha(0.1 + 0.5 * (1 - d.t))
        .setRotation(Math.atan2(st.y - d.sy, st.x - d.sx));
    }
  }

  drawTractor(latest, w, h) {
    const t = latest.tractor;
    if (!t || !t.latched || t.targetId == null) return;
    const p = astPos.get(t.targetId);
    if (!p) return;
    const ox = w / 2, oy = h * 0.98;
    const pulse = (Math.sin(performance.now() / 120) + 1) / 2;
    this.gAdd.lineStyle(5 + pulse * 5, 0x78ebdc, 0.25 + pulse * 0.35);
    this.gAdd.lineBetween(ox, oy, p.x, p.y);
    this.gAdd.lineStyle(1.5, 0xc8fffa, 0.4 + pulse * 0.4);
    this.gAdd.lineBetween(ox, oy, p.x, p.y);
    this.gRings.lineStyle(3, 0x78ebdc, 0.9);
    this.gRings.beginPath();
    this.gRings.arc(p.x, p.y, 16, -Math.PI / 2, -Math.PI / 2 + (t.reel || 0) * Math.PI * 2);
    this.gRings.strokePath();
  }

  drawLasers(w, h, yawPx) {
    const originY = h * 0.98;
    const g = this.gAdd;
    for (const l of lasers) {
      const p = cachedAstPos(l.id, w, h, yawPx);
      let tx = p.x; const ty = p.y;
      if (!l.hit) tx += (l.id % 2 ? 1 : -1) * 40;
      const alpha = Math.max(0, l.life / 0.28);
      const fresh = l.life / 0.28; // 1 at fire -> 0
      const originX = w / 2 + (l.id % 2 ? 22 : -22);
      // Muzzle flash at the cannon — a bright additive burst, brightest at fire.
      g.fillStyle(0xffe0c0, alpha * 0.9);
      g.fillCircle(originX, originY, 3 + fresh * 9);
      // Beam.
      g.lineStyle(3.5, l.hit ? 0xff5a5a : 0xffb478, alpha);
      g.lineBetween(originX, originY, tx, ty);
      if (l.hit) {
        // Impact sparks at the hit point — a bright core + a radial spark burst.
        g.fillStyle(0xfff0d0, alpha);
        g.fillCircle(tx, ty, 3 + fresh * 4);
        g.lineStyle(1.5, 0xffd090, alpha * 0.9);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + l.id;
          const sr = 6 + (1 - fresh) * 14;
          g.lineBetween(tx, ty, tx + Math.cos(a) * sr, ty + Math.sin(a) * sr);
        }
      } else if (l.life < 0.14) {
        g.fillStyle(0xffb478, alpha);
        g.fillCircle(tx, ty, 4);
      }
    }
  }

  drawExplosions(dt, w, h, yawPx) {
    for (const e of explosions) {
      const p = cachedAstPos(e.id, w, h, yawPx);
      const t = 1 - e.life / e.max;
      const r = 8 + t * 46;
      const alpha = 1 - t;
      // Expanding additive fireball + a ring of spark lines (canvas parity).
      this.gAdd.fillStyle(0xffe0a0, alpha * 0.9);
      this.gAdd.fillCircle(p.x, p.y, r * 0.55);
      this.gAdd.fillStyle(0xff8a3c, alpha * 0.5);
      this.gAdd.fillCircle(p.x, p.y, r);
      this.gAdd.lineStyle(1.5, 0xffc878, alpha);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + e.id;
        this.gAdd.lineBetween(p.x + Math.cos(a) * r * 0.5, p.y + Math.sin(a) * r * 0.5,
          p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
      }
    }
  }

  drawDebris(latest, dt, cx, cy, projScale, w, h) {
    const g = this.gStars;
    const hot = 0.7 + ((latest.throttle || 0) / 100) * 2.0;
    for (const s of this.debris) {
      s.z -= 0.30 * hot * dt;
      s.a += s.sp * dt;
      if (s.z <= STAR_NEAR_Z) this.resetDebris(s, false);
      const px = cx + (s.x / s.z) * projScale;
      const py = cy + (s.y / s.z) * projScale;
      if (px < -20 || px > w + 20 || py < -20 || py > h + 20) continue;
      const closeness = 1 - (s.z - STAR_NEAR_Z) / (STAR_FAR_Z - STAR_NEAR_Z);
      const size = (0.9 + closeness * 3.6) * s.m;
      g.fillStyle(0x96846c, 0.22 + closeness * 0.55);
      g.fillRect(px - size / 2, py - size / 2, size, size * 0.72);
    }
  }

  drawIonStorm(w, h) {
    // Intensified: a heavier charged wash, denser flickering interference bands,
    // an occasional full-screen surge, and additive crackling discharge arcs.
    this.fullRect(this.gWash, 0x7882eb, 0.11, w, h);
    for (let i = 0; i < 6; i++) {
      if (Math.random() < 0.3) continue;
      const y = Math.random() * h;
      this.gWash.fillStyle(0x96aaff, 0.05 + Math.random() * 0.11);
      this.gWash.fillRect(0, y, w, 1 + Math.random() * 3);
    }
    if (Math.random() < 0.16) this.fullRect(this.gWash, 0xaab4ff, 0.06 + Math.random() * 0.07, w, h);
    const arcs = Math.random() < 0.6 ? 1 + (Math.random() < 0.4 ? 1 : 0) : 0;
    for (let a = 0; a < arcs; a++) {
      this.gAdd.lineStyle(1.4, 0xc8d4ff, 0.3 + Math.random() * 0.3);
      let x = Math.random() * w, y = Math.random() * h * 0.35;
      this.gAdd.beginPath();
      this.gAdd.moveTo(x, y);
      const steps = 5 + Math.floor(Math.random() * 5);
      for (let s = 0; s < steps; s++) { x += (Math.random() - 0.5) * 70; y += Math.random() * 45 + 12; this.gAdd.lineTo(x, y); }
      this.gAdd.strokePath();
    }
  }

  // Slipstream: a bright forward tunnel of streaks rushing outward from the
  // reticle, plus a soft central glow — the gate reward, felt.
  drawSlipstream(w, h) {
    const cx = w / 2, cy = h / 2, g = this.gAdd, now = performance.now() / 1000;
    const N = 16;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + (now * 0.5) % (Math.PI * 2);
      const r0 = Math.min(w, h) * (0.08 + (i % 3) * 0.02);
      const r1 = Math.min(w, h) * (0.42 + (i % 4) * 0.1);
      const peak = 0.09 + (i % 3) * 0.05;
      g.lineStyle(1 + (i % 2) * 1.5, 0xa3deff, peak);
      g.lineBetween(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.82,
        cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.82);
    }
    g.fillStyle(0x8fd6ff, 0.05);
    g.fillCircle(cx, cy, Math.min(w, h) * 0.13);
  }

  drawFades(w, h, time) {
    for (const f of fadeAway) {
      const alpha = 1 - f.t;
      const r = f.r || 8;
      if (f.kind === 'rock') {
        this.gRings.fillStyle(0x968c7a, 0.9 * alpha);
        this.gRings.fillCircle(f.x, f.y, r);
      } else {
        this.gRings.fillStyle(f.kind === 'pod' ? 0x4cd97b : 0xffb347, alpha);
        this.gRings.fillCircle(f.x, f.y, r);
      }
    }
    const bayX = w / 2, bayY = h * 0.985;
    for (const f of fadeCargo) {
      const x = f.x + (bayX - f.x) * f.t;
      const y = f.y + (bayY - f.y) * f.t;
      this.gRings.fillStyle(f.kind === 'pod' ? 0x4cd97b : 0xffb347, 1 - f.t * 0.7);
      this.gRings.fillCircle(x, y, 7 * (1 - f.t * 0.5));
    }
  }

  drawShieldArc(latest, w, h) {
    // No arc unless the deflector is actually up AND has charge — an exhausted
    // shield must not linger on screen.
    if (!latest.shields?.raised || (latest.shields.strength || 0) <= 0) return;
    const strength = (latest.shields.strength || 0) / 100;
    const cxs = w / 2, cys = h * 1.18, rad = h * 0.62;
    const half = (0.16 + 0.30 * strength) * Math.PI;
    const start = -Math.PI / 2 - half, end = -Math.PI / 2 + half;
    const g = this.gWash;
    g.lineStyle(3, 0x96d7ff, 0.3 + strength * 0.45);
    g.beginPath();
    g.arc(cxs, cys, rad, start, end);
    g.strokePath();
  }

  drawHullVignette(latest, w, h) {
    const hull = latest.hull ?? 100;
    if (hull >= 30) return;
    const a = ((30 - hull) / 30) * 0.16;
    this.fullRect(this.gWash, 0xff3c3c, a, w, h);
  }

  drawDamageOverlay(latest, w, h) {
    if (fx.hullFlash > 0.001) this.fullRect(this.gWash, 0xff2d2d, fx.hullFlash * 0.32, w, h);
    if (latest.debrisIn > 0 && (latest.throttle || 0) > 40) {
      const pulse = 0.07 + 0.05 * Math.sin(performance.now() / 170);
      this.fullRect(this.gWash, 0xd24628, pulse, w, h);
    }
  }

  drawBlackout(w, h) {
    this.fullRect(this.gWash, 0x020306, 0.975, w, h);
    this.label('blackout', '— FORWARD VIEW LOST — FLY ON SENSORS —', w / 2, h * 0.5, '#b4c8ff', 16, 31);
  }

  drawFlashes(w, h) {
    if (fx.warpFlash > 0) this.fullRect(this.gWash, 0xe6f0ff, Math.min(0.85, fx.warpFlash), w, h);
    if (fx.pulseFlash > 0) this.fullRect(this.gWash, 0x8fd6ff, fx.pulseFlash * 0.5, w, h);
    if (fx.shieldFlash > 0) this.fullRect(this.gWash, 0x78c8ff, fx.shieldFlash * 0.4, w, h);
    if (fx.stormFlash > 0) this.fullRect(this.gWash, 0x8c96ff, fx.stormFlash * 0.25, w, h);
  }

  drawGateFlash(w, h) {
    for (const f of gateFx) {
      if (f.passed) this.fullRect(this.gWash, 0x7ddb9a, (f.life / 0.5) * 0.18, w, h);
    }
  }
}

export function createPhaserRenderer({ container }) {
  let game = null;
  let vis = null;
  let ro = null;
  // Render at device pixel ratio (capped at 2 for perf) so text and sprites stay
  // crisp on hi-dpi displays: the WebGL backing store is container × dpr, the
  // canvas is CSS-downscaled back to the container, and the scene keeps authoring
  // in CSS px via a camera zoom of dpr (see SpaceScene.applyCamera). Phaser's
  // RESIZE mode renders at CSS px (blurry when the display upscales), so we drive
  // the size manually.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = () => Math.max(1, container.clientWidth);
  const cssH = () => Math.max(1, container.clientHeight);
  return {
    mount() {
      if (game) return;
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: container,
        scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
        width: cssW() * dpr,
        height: cssH() * dpr,
        powerPreference: 'high-performance',
        fps: { target: 60 },
        banner: false,
        scene: SpaceScene,
        callbacks: {
          postBoot: (gm) => { if (gm.canvas) gm.canvas.classList.add('phaser-canvas'); },
        },
      });
      game.registry.set('dpr', dpr);
      const fit = () => {
        if (!game) return;
        const w = cssW(), h = cssH();
        game.scale.resize(w * dpr, h * dpr); // backing store in device px
        if (game.canvas) { game.canvas.style.width = `${w}px`; game.canvas.style.height = `${h}px`; }
        game.scene.getScene('space')?.onResize?.();
      };
      ro = new ResizeObserver(fit);
      ro.observe(container);
      requestAnimationFrame(fit); // set CSS style + camera once laid out
      vis = () => {
        if (!game) return;
        if (document.hidden) game.loop.sleep(); else game.loop.wake();
      };
      document.addEventListener('visibilitychange', vis);
    },
    resize() { game?.scene.getScene('space')?.onResize?.(); },
    destroy() {
      if (vis) document.removeEventListener('visibilitychange', vis);
      if (ro) { ro.disconnect(); ro = null; }
      game?.destroy(true);
      game = null;
    },
  };
}
