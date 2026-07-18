// Shared HUD-chrome overlay for the main-screen viewscreen. This is the "clean
// graphics" layer the design wants kept crisp and IDENTICAL regardless of which
// space renderer is active — so it lives OUTSIDE the renderers, owned by the
// shell, layered on top of whichever space view (Canvas 2D or Phaser) is mounted.
// It draws only the clean chrome: the forward reticle, the off-screen objective
// chevron, the environmental/RED-ALERT notification banners, and the COLLISION
// call. Cinematic feedback (flashes, shield arc, glitch, vignette) is NOT here —
// that stays per-renderer so the Phaser view can make it prettier.
//
// It reads the shared model (snapshot + interpolated alignment) and effects
// (the collision-banner scalar, aged by the active renderer's advance()); it
// never calls advance() itself, so it can't double-decay.

import { getLatest, displayAlignment } from '/js/main-view/model.js';
import { fx } from '/js/main-view/effects.js';

export function mountHudOverlay({ container }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'view-canvas hud-overlay';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const captainHud = document.getElementById('captain-hud');

  let rafId = 0;
  let running = false;

  function resize() {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
  }
  window.addEventListener('resize', resize);

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

  // Off-screen objective chevron: when the destination (or an open divert) slides
  // off the edge because the helm turned hard, an arrow on the screen edge points
  // back to it — the crew's fallback to get back on track.
  function drawOffscreenChevron(latest, w, h, dpr) {
    const align = displayAlignment();
    const targets = [];
    // Destination sits at bearing 0 (straight ahead); its screen x follows yaw.
    targets.push({ x: w / 2 + (-align / 100) * (w * 0.5), label: (latest.mission?.arrivalName || 'DEST').toUpperCase(), color: latest.mission?.destination?.color || '#7ddb9a' });
    if (latest.divert && !latest.divert.takenBy) {
      targets.push({ x: w / 2 + ((latest.divert.bearing - align) / 100) * (w * 0.5), label: latest.divert.name.toUpperCase(), color: '#ffb347' });
    }
    for (const tg of targets) {
      if (tg.x >= 0 && tg.x <= w) continue; // on-screen; no chevron needed
      const right = tg.x > w;
      const ex = right ? w - 22 * dpr : 22 * dpr;
      const ey = h * 0.4;
      const dir = right ? 1 : -1;
      ctx.save();
      ctx.fillStyle = tg.color;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(ex + dir * 14 * dpr, ey);
      ctx.lineTo(ex - dir * 10 * dpr, ey - 12 * dpr);
      ctx.lineTo(ex - dir * 10 * dpr, ey + 12 * dpr);
      ctx.closePath(); ctx.fill();
      ctx.font = `${11 * dpr}px monospace`;
      ctx.textAlign = right ? 'right' : 'left';
      ctx.fillText(`${tg.label} ▸`, right ? ex - 16 * dpr : ex + 16 * dpr, ey - 18 * dpr);
      ctx.restore();
    }
  }

  // --- Notification framework: big, translucent banners for ongoing effects
  // (asteroid field, ion storm, debris, blackout), upcoming events (solar flare
  // in Ns), and a pulsing RED ALERT. One place feeds off the serialized flags. ---
  function activeNotices(s) {
    const n = [];
    if (s.hull !== undefined && s.hull < 25) n.push({ text: 'RED ALERT', tone: 'alert', big: true });
    if (s.flareIn > 0) n.push({ text: `SOLAR FLARE IN ${Math.ceil(s.flareIn)}s — SAFE POSTURE`, tone: 'warn' });
    if (s.viewImpaired) n.push({ text: 'FORWARD VIEW LOST — FLY ON SENSORS', tone: 'warn' });
    if (s.ionStormIn > 0) n.push({ text: 'ION STORM — SENSORS DEGRADED', tone: 'warn' });
    if (s.debrisIn > 0) n.push({ text: 'DEBRIS FIELD — EASE THROTTLE', tone: 'warn' });
    const inbound = (s.asteroids || []).filter((a) => a.targetable && (a.kind === 'rock' || a.kind === 'unknown')).length;
    if (inbound >= 3) n.push({ text: 'ASTEROID FIELD', tone: 'warn' });
    return n;
  }
  function drawNotifications(latest, w, h, dpr) {
    const notices = activeNotices(latest);
    if (!notices.length) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Start the banner stack BELOW the captain HUD (a DOM overlay pinned to the
    // top of the viewscreen) so ongoing environmental notices aren't hidden
    // behind it. Track the HUD's measured height; fall back to 12% before layout.
    const hudBottom = captainHud && !captainHud.classList.contains('hidden') && captainHud.offsetHeight
      ? (captainHud.offsetTop + captainHud.offsetHeight + 14) * dpr
      : h * 0.12;
    let y = Math.max(h * 0.12, hudBottom);
    for (const nt of notices) {
      const pulse = nt.tone === 'alert' ? 0.55 + 0.45 * Math.sin(performance.now() / 250) : 0.75;
      const size = (nt.big ? 34 : 17) * dpr;
      ctx.font = `700 ${size}px system-ui, sans-serif`;
      ctx.fillStyle = nt.tone === 'alert' ? `rgba(255,70,70,${pulse})` : `rgba(255,190,90,${pulse})`;
      ctx.fillText(nt.text, w / 2, y);
      y += size * 1.3;
    }
    ctx.textBaseline = 'alphabetic';
    // Pulsing red edge bars reinforce a red-alert state.
    if (notices.some((n) => n.tone === 'alert')) {
      const p = 0.10 + 0.10 * Math.sin(performance.now() / 250);
      ctx.fillStyle = `rgba(255,0,0,${p})`;
      ctx.fillRect(0, 0, w, h * 0.05);
      ctx.fillRect(0, h * 0.95, w, h * 0.05);
    }
  }

  // Brief centered COLLISION call after a hull strike (magnitude aged by the
  // active renderer's effects.advance()).
  function drawCollisionBanner(w, h, dpr) {
    if (fx.collisionBanner <= 0) return;
    ctx.textAlign = 'center';
    ctx.font = `800 ${46 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = `rgba(255,80,80,${Math.min(1, fx.collisionBanner)})`;
    ctx.fillText('COLLISION', w / 2, h * 0.5);
  }

  function frame() {
    if (canvas.width === 0 || canvas.clientWidth * devicePixelRatio !== canvas.width) resize();
    const w = canvas.width, h = canvas.height, dpr = devicePixelRatio;
    ctx.clearRect(0, 0, w, h);
    const latest = getLatest();
    if (latest && latest.phase === 'active') {
      drawReticle(w, h, dpr);
      // Off-screen arrow: skip while fully blacked out (nothing to point at).
      if (!latest.viewImpaired) drawOffscreenChevron(latest, w, h, dpr);
      drawNotifications(latest, w, h, dpr);
    }
    drawCollisionBanner(w, h, dpr);
    rafId = requestAnimationFrame(frame);
  }

  return {
    mount() {
      if (running) return;
      running = true;
      resize();
      rafId = requestAnimationFrame(frame);
    },
    resize,
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      canvas.remove();
    },
  };
}
