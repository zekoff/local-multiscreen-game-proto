// Main screen: shared viewscreen (canvas starfield + asteroid warnings) plus
// the room-visible HUD, lobby join instructions, and full debrief stats.

import { initStation, fmtTime } from '/js/station.js';
import { qrcode } from '/js/vendor/qrcode-generator.mjs';

const canvas = document.getElementById('viewscreen');
const ctx = canvas.getContext('2d');
const logEl = document.getElementById('log');

let latest = null; // most recent server state, consumed by the render loop
const logLines = [];

// --- Join info (QR + URL) for the lobby overlay ---
const room = new URLSearchParams(location.search).get('room')?.toUpperCase() || '';
document.getElementById('big-code').textContent = room;
fetch(`/api/room-info?code=${room}`)
  .then((r) => r.json())
  .then((info) => {
    // QR is rendered client-side from the join URL; the server only needs to
    // know the public origin, which works identically for LAN and cloud.
    const qr = qrcode(0, 'M'); // type 0 = auto-size, medium error correction
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
  // The Launch button carries the selected mission (stations without a
  // picker send a plain start, which resolves to the default mission).
  startPayload: () => ({ type: 'start', missionId: missionSelect.value || undefined }),
  onJoined(msg) {
    catalog = msg.catalog || [];
    missionSelect.innerHTML = catalog
      .map((c) => `<option value="${c.id}">${c.name}</option>`)
      .join('');
    showMissionDesc();
  },
  render(state) {
    latest = state;
    // HUD bars.
    document.getElementById('hull-bar').style.width = `${state.hull}%`;
    document.getElementById('shield-bar').style.width = `${state.shields.strength}%`;
    document.getElementById('shield-state').textContent = state.shields.raised ? '(raised)' : '(down)';
    document.getElementById('progress-bar').style.width = `${state.progress}%`;
    if (state.mission) {
      document.getElementById('progress-label').textContent = `Distance to ${state.mission.arrivalName}`;
    }
    document.getElementById('clock').textContent = fmtTime(state.missionTime);
    // Ship's log from the authoritative state (survives reconnects).
    logEl.innerHTML = state.log.map((l) => `<div>[${fmtTime(l.t)}] ${l.text}</div>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
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
        <div class="label">Dodged</div><div>${s.dodged}</div>
        <div class="label">Breakers tripped</div><div>${s.breakersTripped}</div>`;
    }
  },
});

// --- Starfield / viewscreen rendering ---

// Stars sit in world space around a forward-facing viewpoint (x, y centered
// on 0) at some depth z ahead of the ship. As z shrinks each star is
// perspective-projected toward the screen center, so the whole field appears
// to radiate outward — as if flying straight through a bridge window rather
// than sliding sideways past it.
const STAR_COUNT = 140;
const STAR_FAR_Z = 1;
const STAR_NEAR_Z = 0.02;
function resetStar(s) {
  // Spread stars across a wide field so they don't all funnel through the
  // same point on-screen once projected.
  s.x = (Math.random() - 0.5) * 2.4;
  s.y = (Math.random() - 0.5) * 2.4;
  s.z = STAR_FAR_Z;
}
const stars = Array.from({ length: STAR_COUNT }, () => {
  const s = { x: 0, y: 0, z: 0 };
  resetStar(s);
  s.z = STAR_NEAR_Z + Math.random() * (STAR_FAR_Z - STAR_NEAR_Z); // stagger initial depths
  return s;
});

function resize() {
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
}
window.addEventListener('resize', resize);

let lastTs = performance.now();
function frame(ts) {
  const dt = Math.min(0.1, (ts - lastTs) / 1000);
  lastTs = ts;
  if (canvas.width === 0 || canvas.clientWidth * devicePixelRatio !== canvas.width) resize();

  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, w, h);

  // Closing speed tracks the ship's actual velocity (idle drift when in lobby).
  const shipSpeed = latest && latest.phase === 'active' ? latest.speed : 5;
  const cx = w / 2;
  const cy = h / 2;
  const projScale = Math.min(w, h) * 0.5;
  for (const s of stars) {
    s.z -= (0.07 + shipSpeed * 0.0055) * dt;
    if (s.z <= STAR_NEAR_Z) resetStar(s);
    const px = cx + (s.x / s.z) * projScale;
    const py = cy + (s.y / s.z) * projScale;
    // Off-screen (still far off to the side at this depth) — skip drawing.
    if (px < 0 || px > w || py < 0 || py > h) continue;
    // Nearer stars (small z) are bigger and brighter than distant ones.
    const closeness = 1 - (s.z - STAR_NEAR_Z) / (STAR_FAR_Z - STAR_NEAR_Z);
    const size = (0.5 + closeness * 2.5) * devicePixelRatio;
    ctx.fillStyle = `rgba(207, 224, 255, ${0.2 + closeness * 0.7})`;
    ctx.fillRect(px, py, size, size);
  }

  if (latest && latest.phase === 'active') {
    // Asteroids appear as approaching blobs; closer = bigger and more red.
    for (const a of latest.asteroids) {
      const closeness = Math.max(0, 1 - a.impactIn / 25); // 0 far .. 1 imminent
      // Deterministic pseudo-position per asteroid id so they don't jump around.
      const px = (0.15 + ((a.id * 0.618) % 0.7)) * w;
      const py = (0.2 + ((a.id * 0.377) % 0.55)) * h;
      const r = (6 + closeness * 34) * devicePixelRatio;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${140 + closeness * 100}, ${90 - closeness * 40}, 70, 0.9)`;
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `${12 * devicePixelRatio}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`${a.label} ${Math.ceil(a.impactIn)}s`, px, py - r - 6 * devicePixelRatio);
    }
    // The destination grows on the horizon as progress approaches 100.
    if (latest.progress > 70) {
      const grow = (latest.progress - 70) / 30;
      const r = grow * 40 * devicePixelRatio;
      ctx.beginPath();
      ctx.arc(w * 0.85, h * 0.3, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(125, 219, 154, 0.9)';
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.stroke();
      ctx.fillStyle = 'rgba(125, 219, 154, 0.9)';
      ctx.font = `${12 * devicePixelRatio}px monospace`;
      ctx.textAlign = 'center';
      const destination = (latest.mission?.arrivalName || 'DESTINATION').toUpperCase();
      ctx.fillText(destination, w * 0.85, h * 0.3 - r - 8 * devicePixelRatio);
    }
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
