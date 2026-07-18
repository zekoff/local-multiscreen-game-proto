// Shared, renderer-agnostic "where is everything" model for the main-screen
// space view. Both the Canvas 2D renderer and the Phaser renderer import THIS
// so they place contacts, gates, and the destination identically and agree
// frame-for-frame on the interpolated camera — the port is an art change, not a
// geometry change. Nothing here touches a drawing context.

// --- Latest server snapshot -------------------------------------------------
// The active renderer reads this every frame; the shell sets it each tick.
let latest = null;
export function setLatest(s) { latest = s; }
export function getLatest() { return latest; }

// --- Snapshot interpolation for the ship's alignment ------------------------
// The server steps alignment once per 250ms tick; rendering the raw value makes
// the world (and gate rings) jump-then-smooth under continuous turning. Instead
// we interpolate from the previously DISPLAYED value toward each new snapshot
// over one tick interval, which stays smooth through held turns.
let alignPrev = 0;
let alignCurr = 0;
let alignAt = 0;
export function onAlignmentSnapshot(v) {
  alignPrev = displayAlignment();
  alignCurr = v;
  alignAt = performance.now();
}
export function displayAlignment() {
  const t = Math.max(0, Math.min(1, (performance.now() - alignAt) / 280));
  return alignPrev + (alignCurr - alignPrev) * t;
}

// Per-gate reachIn (ring DEPTH) interpolation. The server steps reachIn once per
// 250ms tick, so the ring radius popped each tick even though its x already
// glided via displayAlignment. Ease each gate's depth from its last displayed
// value toward the new snapshot over one tick, keyed by gate id.
const gateReach = new Map(); // id -> { prev, curr, at }
export function onGatesSnapshot(gates) {
  const now = performance.now();
  const seen = new Set();
  for (const g of gates || []) {
    seen.add(g.id);
    const prev = gateReach.has(g.id) ? displayGateReach(g.id, g.reachIn) : g.reachIn;
    gateReach.set(g.id, { prev, curr: g.reachIn, at: now });
  }
  for (const id of [...gateReach.keys()]) if (!seen.has(id)) gateReach.delete(id);
}
export function displayGateReach(id, fallback) {
  const e = gateReach.get(id);
  if (!e) return fallback;
  const t = Math.max(0, Math.min(1, (performance.now() - e.at) / 280));
  return e.prev + (e.curr - e.prev) * t;
}

// --- Nebula depth wash: 3 large, very faint color blobs behind the stars.
// Stable per mission (seeded from the mission id) so the sky has an identity
// without flickering; drifts at half-parallax for a sense of depth.
let nebulaBlobs = [];
let nebulaKey = '';
export function nebulaFor(missionId) {
  if (missionId === nebulaKey) return nebulaBlobs;
  nebulaKey = missionId;
  let hsh = 0;
  for (const c of missionId) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
  const rand = () => { hsh = (hsh * 1664525 + 1013904223) >>> 0; return hsh / 2 ** 32; };
  const palettes = [[96, 110, 200], [70, 140, 160], [140, 90, 170], [90, 130, 120], [150, 110, 90]];
  // More blobs at VARIED parallax depths (0.2 = far/barely moves .. 0.8 = near/
  // shifts more with the helm's steering) — layered depth reference points, not
  // just the destination, so the topology reads as you turn.
  nebulaBlobs = Array.from({ length: 5 }, () => ({
    x: 0.05 + rand() * 0.9, y: 0.06 + rand() * 0.7,
    r: 0.2 + rand() * 0.32,
    c: palettes[Math.floor(rand() * palettes.length)],
    a: 0.03 + rand() * 0.03,
    drift: (rand() - 0.5) * 0.004, // slow horizontal drift, fraction of width/s
    depth: 0.2 + rand() * 0.6,     // parallax factor vs the helm yaw
  }));
  return nebulaBlobs;
}

// --- Distant traffic: a few faint, far-off vessels crossing the lane (running
// lights blinking), seeded per mission so the Verge feels inhabited — pure
// backdrop, no mechanics. Drifts with the helm's yaw at low parallax.
let trafficLanes = [];
let trafficKey = '';
export function trafficFor(missionId) {
  if (missionId === trafficKey) return trafficLanes;
  trafficKey = missionId;
  let h = 0; for (const c of missionId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rand = () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 2 ** 32; };
  trafficLanes = Array.from({ length: 2 + Math.floor(rand() * 2) }, () => ({
    y: 0.16 + rand() * 0.4, speed: (0.006 + rand() * 0.01) * (rand() < 0.5 ? -1 : 1),
    phase: rand(), col: rand() < 0.5 ? '#9fb4e0' : '#c8a882',
  }));
  return trafficLanes;
}

// --- Contact placement ------------------------------------------------------
// Deterministic screen position for an asteroid id (stable so it doesn't jump),
// in unyawed base coords; the caller adds the current yaw offset.
export function asteroidBasePos(id, w, h) {
  return {
    x: (0.15 + ((id * 0.618) % 0.7)) * w,
    y: (0.2 + ((id * 0.377) % 0.55)) * h,
  };
}

// Last drawn screen position per asteroid id, so a laser/explosion can point at
// where a rock WAS after it's been removed from the state, and so drawFades can
// fade its silhouette in place. Populated each frame by the active renderer.
// Cleared if it grows unreasonably (session restarts).
export const astPos = new Map();

// Per-rock angular silhouette (classic-Asteroids style, but filled): a seeded
// ring of 9-12 vertices with jittered radii plus a slow spin. Cached per id so
// a rock keeps its shape for its whole approach.
export const astShapes = new Map();
export function astShapeFor(id) {
  let s = astShapes.get(id);
  if (s) return s;
  let seed = (id * 2654435761) >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const n = 9 + Math.floor(rand() * 4);
  const pts = Array.from({ length: n }, (_, i) => ({
    a: (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.35, // jittered angle
    m: 0.68 + rand() * 0.58,                          // jittered radius multiplier
  }));
  s = { pts, spin: (rand() - 0.5) * 0.8 }; // radians/sec, either direction
  astShapes.set(id, s);
  if (astShapes.size > 400) astShapes.clear();
  return s;
}

// Screen-edge scale for the strike geometry: mirrors the engine's
// STRIKE_CLEAR_LARGE so a rock at |bearing - alignment| = this sits at the
// viewscreen rim — i.e. "at the edge" reads as "misses the ship."
export const STRIKE_VIS_EDGE = 94;

// Where an asteroid sits on screen this frame. Its lateral position tracks
// (bearing - the helm's alignment) throughout the approach — NOT a funnel to
// dead center — so rocks strike across most of the viewscreen and a rock the
// helm steers to the rim visibly slides off the flank (a clean miss), matching
// the server's strike geometry. It only foreshortens toward center at range
// (the depth of the lane), spreading to its true strike point as it closes.
export function asteroidScreenPos(a, w, h, _yawPx) {
  const closeness = Math.max(0, Math.min(1, 1 - a.impactIn / 25));
  // Separation from the bow in engine bearing units, normalized so ±1 = the rim.
  const rel = ((a.bearing ?? 0) - displayAlignment()) / STRIKE_VIS_EDGE;
  const idH = (a.id * 0.377) % 1;           // stable vertical spread per rock
  const idOff = ((a.id * 0.618) % 1) - 0.5; // -0.5..0.5 stable per rock
  // Far rocks read a bit more central (foreshortened into the lane); as a rock
  // closes it spreads out to its full lateral strike point at the ship's plane.
  const spread = 0.5 * (0.55 + 0.45 * closeness); // ~0.275w far -> 0.5w at impact
  const x = w / 2 + rel * spread * w + idOff * w * 0.04;
  const farY = h * (0.30 + idH * 0.4);
  const strikeY = h / 2 + (idH - 0.5) * h * 0.14;
  const t = closeness * closeness;          // accelerate vertical convergence near impact
  return { x, y: farY + (strikeY - farY) * t, closeness };
}

// Screen position for an id that may already be gone from the state (laser /
// explosion), from the cache, falling back to the deterministic base position.
export function cachedAstPos(id, w, h, yawPx) {
  const p = astPos.get(id);
  if (p) return p;
  const base = asteroidBasePos(id, w, h);
  return { x: base.x + yawPx, y: base.y };
}
