// Transient-effect model for the main-screen space view. The server's one-shot
// `fx` stream (laser fire, explosions, impacts, gate passes, warps, sensor
// pulses, ion storms, anomalies) is consumed here into a set of buffers and
// decaying scalars that the Phaser renderer reads. The renderer calls
// advance(dt) once per frame to age it; the draw code is a pure reader. (Kept as
// its own module — separate from the scene — so effect timing lives in one place
// and the fx consumption is testable without a GPU.)

import { playFxAudio } from '/js/fx-audio.js';
import { astPos } from '/js/main-view/model.js';

// One-shot effect buffers (aged/spliced by advance).
export const lasers = [];      // { id, hit, life }
export const explosions = [];  // { id, life, max }
export const gateFx = [];      // { passed, life }
export const fadeCargo = [];   // captured contacts animating down toward the cargo bay
export const fadeAway = [];    // contacts that drifted past — fade out instead of vanishing

// Decaying scalar flashes/shake. Kept as properties of one object so both
// renderers share them by reference (a bare module-level `let` cannot be).
export const fx = {
  shake: 0,        // screen shake magnitude
  warpFlash: 0,    // white full-screen flash on an Emergency Warp
  pulseFlash: 0,   // cyan flash on an active sensor pulse
  shieldFlash: 0,  // cool blue edge shimmer when the shields soak a hit
  stormFlash: 0,   // brief wash when an ion storm front arrives
  collisionBanner: 0, // brief centered COLLISION banner on a heavy strike
  hullFlash: 0,    // brief red edge flash on any unabsorbed hull hit (incl. debris)
  glitch: 0,       // main-screen instability flicker (hull breach anomaly)
};

// The main screen renders EVERY effect visually, but only plays the ship-wide
// sounds (explosion/impact/warp). The laser is heard at weapons, gate chimes at
// helm, sensor pings at engineering — see each station's playFxAudio call.
const MAIN_AUDIO_KINDS = new Set(['explosion', 'impact', 'warp', 'ionStorm', 'debris']);

// Consume one snapshot's fx stream into the buffers/scalars, and play the
// ship-wide SFX. Called once per server tick, before the snapshot is stored.
export function consume(state, audio) {
  for (const e of state.fx || []) {
    if (e.kind === 'laser') { lasers.push({ id: e.targetId, hit: e.hit, life: 0.28 }); }
    else if (e.kind === 'explosion') { explosions.push({ id: e.id, life: 0.55, max: 0.55 }); }
    else if (e.kind === 'impact') {
      if (e.absorbed) {
        fx.shake = Math.min(40, fx.shake + 6);
        // A soaked hit shimmers blue at the edges — the shield doing its job.
        fx.shieldFlash = 0.5;
      } else {
        // Any unabsorbed hit flashes the hull red (scaled by damage) so even a
        // small debris-scour tick reads as "we're taking hull damage."
        fx.shake = Math.min(40, fx.shake + 8 + e.hullDmg * 0.7);
        fx.hullFlash = Math.min(1, fx.hullFlash + 0.35 + e.hullDmg * 0.03);
        // Reserve the big centered COLLISION banner for a genuinely heavy strike
        // (an obstacle / large rock), not the steady small debris ticks.
        if (e.hullDmg >= 10) fx.collisionBanner = 1;
      }
    }
    else if (e.kind === 'gate') { gateFx.push({ passed: e.passed, life: 0.5 }); if (e.passed) fx.shake = Math.min(fx.shake + 3, 40); }
    else if (e.kind === 'warp') { fx.shake = 34; fx.warpFlash = 0.7; }
    else if (e.kind === 'sensorPulse') { fx.pulseFlash = 0.45; }
    else if (e.kind === 'ionStorm') { fx.stormFlash = 0.6; }
    else if (e.kind === 'anomaly') { fx.glitch = Math.min(1, fx.glitch + 0.7); } // hull-breach instability
  }
  playFxAudio(state.fx, audio, MAIN_AUDIO_KINDS);
}

// Detect contacts that vanished since the previous snapshot and start their
// exit animation: a captured pod/salvage slides down toward the cargo bay;
// anything else that drifted past fades its silhouette in place. Reads the
// last-drawn positions cache (model.astPos) populated by the renderer each frame.
export function detectFades(prevAsteroids, state) {
  if (!prevAsteroids) return;
  const nowIds = new Set(state.asteroids.map((a) => a.id));
  const exploded = new Set((state.fx || []).filter((e) => e.kind === 'explosion').map((e) => e.id));
  const stowed = (state.fx || []).some((e) => e.kind === 'stow');
  for (const a of prevAsteroids) {
    if (nowIds.has(a.id) || exploded.has(a.id)) continue; // still here, or blew up (own fx)
    const p = astPos.get(a.id);
    if (!p) continue;
    const isPod = a.kind === 'pod' || a.visualKind === 'pod';
    const isMineral = a.kind === 'mineral' || a.visualKind === 'mineral';
    if (stowed && (isPod || isMineral)) fadeCargo.push({ x: p.x, y: p.y, t: 0, kind: isPod ? 'pod' : 'mineral' });
    // Drifted past: fade its real silhouette in place (see drawFades) — a rock
    // polygon, or the pod/mineral body — instead of an expanding puff.
    else fadeAway.push({ x: p.x, y: p.y, r: p.r, id: a.id, kind: isPod ? 'pod' : isMineral ? 'mineral' : 'rock', t: 0 });
  }
}

// Age every buffer and scalar by one frame. Called once per frame by the
// renderer — the single place effect timing is advanced.
export function advance(dt) {
  // Screen shake decays multiplicatively (frame-paced), snapping to 0 when tiny.
  if (fx.shake > 0.2) fx.shake *= 0.88; else fx.shake = 0;
  fx.warpFlash = Math.max(0, fx.warpFlash - dt * 1.6);
  fx.pulseFlash = Math.max(0, fx.pulseFlash - dt * 1.2);
  fx.shieldFlash = Math.max(0, fx.shieldFlash - dt * 1.4);
  fx.stormFlash = Math.max(0, fx.stormFlash - dt * 0.9);
  fx.hullFlash = Math.max(0, fx.hullFlash - dt * 1.8);
  fx.collisionBanner = Math.max(0, fx.collisionBanner - dt * 1.6);
  fx.glitch = Math.max(0, fx.glitch - dt * 1.2);

  for (let i = lasers.length - 1; i >= 0; i--) { lasers[i].life -= dt; if (lasers[i].life <= 0) lasers.splice(i, 1); }
  for (let i = explosions.length - 1; i >= 0; i--) { explosions[i].life -= dt; if (explosions[i].life <= 0) explosions.splice(i, 1); }
  for (let i = gateFx.length - 1; i >= 0; i--) { gateFx[i].life -= dt; if (gateFx[i].life <= 0) gateFx.splice(i, 1); }
  for (let i = fadeAway.length - 1; i >= 0; i--) { fadeAway[i].t += dt / 0.6; if (fadeAway[i].t >= 1) fadeAway.splice(i, 1); }
  for (let i = fadeCargo.length - 1; i >= 0; i--) { fadeCargo[i].t += dt / 0.9; if (fadeCargo[i].t >= 1) fadeCargo.splice(i, 1); }
}
