// Main screen: shared viewscreen (canvas starfield + asteroid warnings) plus
// the room-visible HUD, lobby join instructions, and full debrief stats.

import { initStation, fmtTime } from '/js/station.js';

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
    document.getElementById('qr').src = info.qrDataUrl;
    document.getElementById('join-url').textContent = info.joinUrl;
  })
  .catch(() => {});

initStation({
  seat: 'main',
  render(state) {
    latest = state;
    // HUD bars.
    document.getElementById('hull-bar').style.width = `${state.hull}%`;
    document.getElementById('shield-bar').style.width = `${state.shields.strength}%`;
    document.getElementById('shield-state').textContent = state.shields.raised ? '(raised)' : '(down)';
    document.getElementById('progress-bar').style.width = `${state.progress}%`;
    document.getElementById('clock').textContent = fmtTime(state.missionTime);
    // Ship's log from the authoritative state (survives reconnects).
    logEl.innerHTML = state.log.map((l) => `<div>[${fmtTime(l.t)}] ${l.text}</div>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
    // Debrief stats grid.
    if (state.phase === 'debrief' && state.debrief) {
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

// Stars live in a normalized space and stream right-to-left at ship speed.
const STAR_COUNT = 140;
const stars = Array.from({ length: STAR_COUNT }, () => ({
  x: Math.random(),
  y: Math.random(),
  depth: 0.3 + Math.random() * 0.7, // parallax factor and brightness
}));

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

  // Star speed tracks the ship's actual velocity (idle drift when in lobby).
  const shipSpeed = latest && latest.phase === 'active' ? latest.speed : 5;
  for (const s of stars) {
    s.x -= (0.01 + shipSpeed * 0.004) * s.depth * dt;
    if (s.x < 0) { s.x = 1; s.y = Math.random(); }
    const size = s.depth * 2.2 * devicePixelRatio;
    ctx.fillStyle = `rgba(207, 224, 255, ${0.25 + s.depth * 0.6})`;
    ctx.fillRect(s.x * w, s.y * h, size, size);
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
    // Station Epsilon grows on the horizon as progress approaches 100.
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
      ctx.fillText('STATION EPSILON', w * 0.85, h * 0.3 - r - 8 * devicePixelRatio);
    }
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
