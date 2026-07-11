// Main screen: the shared viewscreen. A forward-facing starfield that banks
// with the helm's course, a themed destination that grows on the horizon as
// the mission progresses, inbound asteroids, fly-through nav gates, and
// one-shot effects (laser fire, explosions, screen shake) driven by the
// server's transient `fx` stream. Plus the room-visible HUD, a captain's
// tactical readout, lobby join info, and the full debrief.

import { initStation, fmtTime, setHealthBar } from '/js/station.js';
import { qrcode } from '/js/vendor/qrcode-generator.mjs';
import { createAudio } from '/js/audio.js';

const canvas = document.getElementById('viewscreen');
const ctx = canvas.getContext('2d');
const logEl = document.getElementById('log');
const captainHud = document.getElementById('captain-hud');

let latest = null; // most recent server state, consumed by the render loop

// The main screen carries the music bed + ship-wide SFX. Browsers block audio
// until a user gesture, so resume on the first interaction (the Launch click
// counts). startMusic()/stopMusic() follow the mission phase.
const audio = createAudio();
let musicRunning = false;
for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(ev, () => audio.resume(), { once: false });
}

// --- Join info (QR + URL) for the lobby overlay ---
const room = new URLSearchParams(location.search).get('room')?.toUpperCase() || '';
document.getElementById('big-code').textContent = room;
fetch(`/api/room-info?code=${room}`)
  .then((r) => r.json())
  .then((info) => {
    const qr = qrcode(0, 'M');
    qr.addData(info.joinUrl);
    qr.make();
    document.getElementById('qr').src = qr.createDataURL(6, 4);
    document.getElementById('join-url').textContent = info.joinUrl;
  })
  .catch(() => {});

// Mission picker state (populated from the join message's catalog).
const missionSelect = document.getElementById('mission-select');
const missionDesc = document.getElementById('mission-desc');
let catalog = [];

function showMissionDesc() {
  const entry = catalog.find((c) => c.id === missionSelect.value);
  missionDesc.textContent = entry ? entry.description : '';
}
missionSelect.addEventListener('change', showMissionDesc);

initStation({
  seat: 'main',
  startPayload: () => ({ type: 'start', missionId: missionSelect.value || undefined }),
  onJoined(msg) {
    catalog = msg.catalog || [];
    missionSelect.innerHTML = catalog
      .map((c) => `<option value="${c.id}">${c.name}</option>`)
      .join('');
    showMissionDesc();
  },
  render(state) {
    consumeFx(state); // must run before we overwrite `latest`
    latest = state;
    // Music follows the phase; intensity grows with mission progress so the
    // bed builds (percussion in, filter opens) as the run goes on.
    if (state.phase === 'active') {
      if (!musicRunning) { audio.startMusic(); musicRunning = true; }
      audio.setIntensity(0.12 + 0.85 * (state.progress / 100));
    } else if (musicRunning) {
      audio.stopMusic();
      musicRunning = false;
    }
    // HUD bars (hull/shields colored by value; progress keeps the accent).
    setHealthBar(document.getElementById('hull-bar'), state.hull);
    setHealthBar(document.getElementById('shield-bar'), state.shields.strength);
    document.getElementById('shield-state').textContent = state.shields.raised ? '(raised)' : '(down)';
    document.getElementById('progress-bar').style.width = `${state.progress}%`;
    if (state.mission) {
      document.getElementById('progress-label').textContent = `Distance to ${state.mission.arrivalName}`;
    }
    document.getElementById('clock').textContent = fmtTime(state.missionTime);
    logEl.innerHTML = state.log.map((l) => `<div>[${fmtTime(l.t)}] ${l.text}</div>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
    updateCaptainHud(state);
    // Debrief stats grid.
    if (state.phase === 'debrief' && state.debrief) {
      document.getElementById('debrief-mission').textContent =
        `${state.debrief.missionName} (seed ${state.debrief.seed})`;
      const s = state.debrief.stats;
      document.getElementById('debrief-stats').innerHTML = `
        <div class="label">Mission time</div><div>${fmtTime(s.time)}</div>
        <div class="label">Hull remaining</div><div>${s.hull}%</div>
        <div class="label">Asteroids destroyed</div><div>${s.destroyed}</div>
        <div class="label">Impacts taken</div><div>${s.impacts}</div>
        <div class="label">Nav gates cleared</div><div>${s.gatesPassed}/${s.gatesPassed + s.gatesMissed}</div>
        <div class="label">Breakers tripped</div><div>${s.breakersTripped}</div>`;
    }
  },
});

// --- Captain's tactical readout: a one-glance status per station ---
function updateCaptainHud(state) {
  captainHud.classList.toggle('hidden', state.phase !== 'active');
  if (state.phase !== 'active') return;
  const off = Math.abs(state.alignment);
  const dir = state.alignment > 0 ? 'STBD' : 'PORT';
  setCapRow('cap-helm',
    off < 12 ? `on course · thr ${state.throttle}%` : `${off.toFixed(0)}° ${dir} · thr ${state.throttle}%`,
    off > 45 ? 'alert' : off > 20 ? 'warn' : '');
  const tripped = ['engines', 'shields', 'weapons', 'sensors'].filter((s) => state.breakers[s]);
  const p = state.power;
  setCapRow('cap-eng',
    `pwr e${p.engines} s${p.shields} w${p.weapons} sen${p.sensors} · det ${Math.round(state.sensorRange)}s`
      + (tripped.length ? ` · ${tripped.join(',')} TRIPPED` : ''),
    tripped.length ? 'alert' : '');
  const sh = state.shields.raised ? `shields ${state.shields.strength}%` : 'shields DOWN';
  const laser = state.charge >= 100 ? 'laser READY' : `laser ${state.charge}%`;
  setCapRow('cap-wep', `${sh} · ${laser}`,
    (state.shields.raised && state.shields.strength < 25) ? 'warn' : '');
}
function setCapRow(id, text, cls) {
  const row = document.getElementById(id);
  row.querySelector('.cap-val').textContent = text;
  row.classList.remove('warn', 'alert');
  if (cls) row.classList.add(cls);
}

// --- One-shot effects (fx) from the server, plus screen shake / flashes ---
const lasers = [];      // { id, hit, life }
const explosions = [];  // { id, life, max }
const gateFx = [];      // { passed, life }
let shake = 0;
let warpFlash = 0;      // white full-screen flash on an Emergency Warp
let pulseFlash = 0;     // cyan flash on an active sensor pulse

function consumeFx(state) {
  for (const e of state.fx || []) {
    if (e.kind === 'laser') { lasers.push({ id: e.targetId, hit: e.hit, life: 0.28 }); audio.laser(); }
    else if (e.kind === 'explosion') { explosions.push({ id: e.id, life: 0.55, max: 0.55 }); audio.explosion(); }
    else if (e.kind === 'impact') { shake = Math.min(30, shake + (e.absorbed ? 6 : 11 + e.hullDmg * 0.6)); audio.impact(!e.absorbed); }
    else if (e.kind === 'gate') { gateFx.push({ passed: e.passed, life: 0.5 }); if (e.passed) { shake = Math.min(shake + 3, 30); audio.gatePass(); } else audio.gateMiss(); }
    else if (e.kind === 'warp') { shake = 30; warpFlash = 0.7; audio.warp(); }
    else if (e.kind === 'sensorPulse') { pulseFlash = 0.45; audio.sensorPulse(); }
  }
}

// --- Starfield (forward-facing perspective; see original for the math) ---
const STAR_COUNT = 150;
const STAR_FAR_Z = 1;
const STAR_NEAR_Z = 0.02;
function resetStar(s) {
  s.x = (Math.random() - 0.5) * 2.4;
  s.y = (Math.random() - 0.5) * 2.4;
  s.z = STAR_FAR_Z;
}
const stars = Array.from({ length: STAR_COUNT }, () => {
  const s = { x: 0, y: 0, z: 0 };
  resetStar(s);
  s.z = STAR_NEAR_Z + Math.random() * (STAR_FAR_Z - STAR_NEAR_Z);
  return s;
});

function resize() {
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
}
window.addEventListener('resize', resize);

// Deterministic screen position for an asteroid id (stable so it doesn't jump),
// in unyawed base coords; the caller adds the current yaw offset.
function asteroidBasePos(id, w, h) {
  return {
    x: (0.15 + ((id * 0.618) % 0.7)) * w,
    y: (0.2 + ((id * 0.377) % 0.55)) * h,
  };
}

let yaw = 0; // smoothed course bank, -1..1
let lastTs = performance.now();
function frame(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;
  if (canvas.width === 0 || canvas.clientWidth * devicePixelRatio !== canvas.width) resize();

  const w = canvas.width;
  const h = canvas.height;
  const dpr = devicePixelRatio;

  // Smooth the bank toward the ship's current course error (alignment). A
  // positive alignment (drifting starboard) swings the view so the world
  // slides to port — as if the nose is yawing to correct.
  const targetYaw = latest && latest.phase === 'active' ? Math.max(-1, Math.min(1, latest.alignment / 100)) : 0;
  yaw += (targetYaw - yaw) * Math.min(1, dt * 3);
  const yawPx = -yaw * w * 0.16;

  ctx.save();
  // Screen shake: jitter the whole scene, decaying each frame.
  if (shake > 0.2) {
    ctx.translate((Math.random() - 0.5) * shake * dpr, (Math.random() - 0.5) * shake * dpr);
    shake *= 0.88;
  } else shake = 0;
  // Subtle bank rotation on top of the parallax shift.
  ctx.translate(w / 2, h / 2);
  ctx.rotate(yaw * 0.04);
  ctx.translate(-w / 2, -h / 2);

  ctx.fillStyle = '#05070d';
  ctx.fillRect(-w, -h, w * 3, h * 3);

  const cx = w / 2 + yawPx;
  const cy = h / 2;
  const projScale = Math.min(w, h) * 0.5;
  const shipSpeed = latest && latest.phase === 'active' ? latest.speed : 5;

  // Starfield streaks toward the (yawed) vanishing point.
  for (const s of stars) {
    s.z -= (0.07 + shipSpeed * 0.0055) * dt;
    if (s.z <= STAR_NEAR_Z) resetStar(s);
    const px = cx + (s.x / s.z) * projScale;
    const py = cy + (s.y / s.z) * projScale;
    if (px < -w || px > w * 2 || py < -h || py > h * 2) continue;
    const closeness = 1 - (s.z - STAR_NEAR_Z) / (STAR_FAR_Z - STAR_NEAR_Z);
    const size = (0.5 + closeness * 2.5) * dpr;
    ctx.fillStyle = `rgba(207, 224, 255, ${0.2 + closeness * 0.7})`;
    ctx.fillRect(px, py, size, size);
  }

  if (latest && latest.phase === 'active') {
    drawDestination(w, h, cx, dpr);
    drawGates(w, h, cy, dpr);
    drawAsteroids(w, h, yawPx, dpr);
    drawLasers(w, h, yawPx, dt, dpr);
    drawExplosions(w, h, yawPx, dt, dpr);
  }

  ctx.restore();

  // Forward reticle in fixed screen space (the ship's heading): the world
  // banks behind it, so "centered under the crosshair" reads as on-course.
  if (latest && latest.phase === 'active') drawReticle(w, h, dpr);
  drawGateFlash(w, h, dt);
  drawFlashes(w, h, dt);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// The mission destination growing on the horizon as progress climbs.
function drawDestination(w, h, cx, dpr) {
  const progress = latest.progress;
  const dest = latest.mission?.destination;
  const px = cx;              // sits at the (yawed) vanishing point
  const py = h * 0.4;
  const grow = Math.min(1, progress / 100);
  const r = (6 + grow * grow * 90) * dpr; // accelerates as you close in
  const color = dest?.color || '#7ddb9a';
  const name = (latest.mission?.arrivalName || 'DESTINATION').toUpperCase();

  if (dest?.kind === 'station') drawStation(px, py, r, color, dpr);
  else if (dest?.kind === 'planet') drawPlanet(px, py, r, color);
  else { // generic marker for missions without a themed destination
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
  }
  if (r > 10 * dpr) {
    ctx.fillStyle = color;
    ctx.font = `${12 * dpr}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(name, px, py - r - 8 * dpr);
  }
}

function drawStation(x, y, r, color, dpr) {
  ctx.save();
  ctx.translate(x, y);
  // Glow.
  const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.8);
  g.addColorStop(0, hexA(color, 0.25));
  g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2); ctx.fill();
  // Habitat ring (an ellipse, tilted).
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, r * 0.09);
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Central hub.
  ctx.fillStyle = '#0e1626';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Docking spar + a blinking beacon.
  ctx.beginPath(); ctx.moveTo(0, -r * 0.34); ctx.lineTo(0, -r * 0.7); ctx.stroke();
  const blink = (Math.sin(performance.now() / 300) + 1) / 2;
  ctx.fillStyle = hexA('#ff5c5c', 0.4 + blink * 0.6);
  ctx.beginPath(); ctx.arc(0, -r * 0.7, Math.max(1.5, r * 0.06), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawPlanet(x, y, r, color) {
  ctx.save();
  ctx.translate(x, y);
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, color);
  g.addColorStop(1, '#0a1018');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = hexA(color, 0.5);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 0, r * 1.5, r * 0.3, -0.4, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// Fly-through nav gates: rings that grow toward the viewer as they close. Each
// gate sits at its bearing offset from the ship's current heading, so it drifts
// under the reticle only when the helm has steered onto that bearing.
function drawGates(w, h, cy, dpr) {
  const GATE_MAX_REACH = 19;
  for (const gate of latest.gates || []) {
    const t = Math.max(0, Math.min(1, 1 - gate.reachIn / GATE_MAX_REACH)); // 0 far .. 1 here
    const r = (14 + t * t * Math.min(w, h) * 0.7);
    // Screen x from how far the ship's alignment is off the gate's bearing.
    const cx = w / 2 + ((gate.bearing - latest.alignment) / 100) * (w * 0.5);
    const lined = Math.abs(latest.alignment - gate.bearing) <= 30;
    const color = lined ? '#8fd6ff' : '#ffb347';
    ctx.strokeStyle = hexA(color, 0.35 + t * 0.5);
    ctx.lineWidth = (2 + t * 3) * dpr;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.82, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Approach chevrons at the cardinal points.
    ctx.fillStyle = hexA(color, 0.5 + t * 0.4);
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const gx = cx + Math.cos(a) * r;
      const gy = cy + Math.sin(a) * r * 0.82;
      ctx.beginPath(); ctx.arc(gx, gy, 2.5 * dpr, 0, Math.PI * 2); ctx.fill();
    }
    if (t < 0.5) {
      ctx.fillStyle = hexA(color, 0.9);
      ctx.font = `${11 * dpr}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`${gate.label} ${Math.ceil(gate.reachIn)}s`, cx, cy - r * 0.82 - 6 * dpr);
    }
  }
}

function drawAsteroids(w, h, yawPx, dpr) {
  for (const a of latest.asteroids) {
    const closeness = Math.max(0, 1 - a.impactIn / 25);
    const size = a.size ?? 1;
    const base = asteroidBasePos(a.id, w, h);
    const px = base.x + yawPx;
    const py = base.y;
    // Small on spawn, growing as it nears; bigger rocks are visibly larger even
    // far out (the captain's early-spot cue). Tint is a muted rocky brown that
    // only warms slightly as it closes — no loud red until it's resolved.
    const r = (2.5 + closeness * 24) * (0.7 + 0.5 * size) * dpr;
    const glow = ctx.createRadialGradient(px, py, r * 0.2, px, py, r * 1.6);
    glow.addColorStop(0, `rgba(150, 120, 95, ${0.12 + closeness * 0.18})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(px, py, r * 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${120 + closeness * 60}, ${104 - closeness * 24}, 92, 0.9)`;
    ctx.fill();

    // Unresolved contacts stay an unlabeled dot — the captain must spot them and
    // call for more sensor power. Once targetable, show name + speed + a
    // color-coded threat read (data lives here, not on the weapons scope).
    if (!a.targetable) continue;
    const targeted = a.id === latest.targetId;
    if (targeted) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
    }
    const spd = a.speed ?? 1;
    const speedTag = spd >= 1.15 ? 'FAST' : spd >= 0.95 ? 'MED' : 'SLOW';
    // Threat: fast or imminent = red, moderate = amber, else yellow-green.
    const threat = (spd >= 1.15 || a.impactIn < 6) ? '#ff5c5c'
      : (spd >= 0.95 || a.impactIn < 12) ? '#ffb347' : '#e0d24c';
    ctx.fillStyle = threat;
    ctx.font = `${12 * dpr}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`${a.label} ${speedTag} ${Math.ceil(a.impactIn)}s`, px, py - r - 6 * dpr);
  }
}

// Laser beams fired from the ship's cannons to the (former) contact position.
function drawLasers(w, h, yawPx, dt, dpr) {
  const originY = h * 0.98;
  for (let i = lasers.length - 1; i >= 0; i--) {
    const l = lasers[i];
    const base = asteroidBasePos(l.id, w, h);
    let tx = base.x + yawPx;
    const ty = base.y;
    if (!l.hit) tx += (l.id % 2 ? 1 : -1) * 40 * dpr; // a miss sails wide
    const alpha = Math.max(0, l.life / 0.28);
    const originX = w / 2 + (l.id % 2 ? 22 : -22) * dpr;
    ctx.strokeStyle = l.hit ? `rgba(255, 90, 90, ${alpha})` : `rgba(255, 180, 120, ${alpha * 0.8})`;
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath(); ctx.moveTo(originX, originY); ctx.lineTo(tx, ty); ctx.stroke();
    if (!l.hit && l.life < 0.14) { // little "miss" puff where it whiffs past
      ctx.fillStyle = `rgba(255, 180, 120, ${alpha})`;
      ctx.beginPath(); ctx.arc(tx, ty, 4 * dpr, 0, Math.PI * 2); ctx.fill();
    }
    l.life -= dt;
    if (l.life <= 0) lasers.splice(i, 1);
  }
}

function drawExplosions(w, h, yawPx, dt, dpr) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i];
    const base = asteroidBasePos(e.id, w, h);
    const px = base.x + yawPx;
    const py = base.y;
    const t = 1 - e.life / e.max; // 0..1
    const r = (8 + t * 46) * dpr;
    const alpha = 1 - t;
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(255, 240, 190, ${alpha})`);
    g.addColorStop(0.4, `rgba(255, 150, 60, ${alpha * 0.9})`);
    g.addColorStop(1, `rgba(255, 60, 40, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    // A few debris sparks.
    ctx.strokeStyle = `rgba(255, 200, 120, ${alpha})`;
    ctx.lineWidth = 1.5 * dpr;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + e.id;
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(a) * r * 0.5, py + Math.sin(a) * r * 0.5);
      ctx.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
      ctx.stroke();
    }
    e.life -= dt;
    if (e.life <= 0) explosions.splice(i, 1);
  }
}

// Fixed forward crosshair (screen space) marking the ship's heading.
function drawReticle(w, h, dpr) {
  const cx = w / 2;
  const cy = h / 2;
  const s = 16 * dpr;
  const gap = 7 * dpr;
  ctx.strokeStyle = 'rgba(125, 219, 154, 0.35)';
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy); ctx.lineTo(cx - gap, cy);
  ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + s, cy);
  ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy - gap);
  ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + s);
  ctx.stroke();
}

// Emergency Warp (white) and sensor-pulse (cyan) full-screen flashes.
function drawFlashes(w, h, dt) {
  if (warpFlash > 0) {
    ctx.fillStyle = `rgba(230, 240, 255, ${Math.min(0.85, warpFlash)})`;
    ctx.fillRect(0, 0, w, h);
    warpFlash = Math.max(0, warpFlash - dt * 1.6);
  }
  if (pulseFlash > 0) {
    ctx.fillStyle = `rgba(143, 214, 255, ${pulseFlash * 0.5})`;
    ctx.fillRect(0, 0, w, h);
    pulseFlash = Math.max(0, pulseFlash - dt * 1.2);
  }
}

// Brief full-screen tint when a gate is passed (green) or missed (red).
function drawGateFlash(w, h, dt) {
  for (let i = gateFx.length - 1; i >= 0; i--) {
    const f = gateFx[i];
    const alpha = (f.life / 0.5) * 0.18;
    ctx.fillStyle = f.passed ? `rgba(125, 219, 154, ${alpha})` : `rgba(255, 92, 92, ${alpha})`;
    ctx.fillRect(0, 0, w, h);
    f.life -= dt;
    if (f.life <= 0) gateFx.splice(i, 1);
  }
}

// #rrggbb + alpha -> rgba() string.
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
