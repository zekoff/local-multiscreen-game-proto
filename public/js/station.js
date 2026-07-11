// Common shell for crew station pages (helm / engineering / weapons).
// Handles: URL params, header status, lobby & debrief overlays, event toasts,
// and wiring the Net client. Each station page supplies a render(state)
// callback for its own controls.

import { Net } from './net.js';

// Options:
//   seat         - which station this page is
//   render       - render(state) called on every state push
//   onJoined     - optional; receives the full 'joined' message (mission
//                  catalog, seat confirmation) — the main screen uses this
//                  to build its mission picker
//   startPayload - optional; () => message object sent by the Launch button
//                  (defaults to a plain start; the main screen adds missionId)
export function initStation({ seat, render, onJoined, startPayload }) {
  const params = new URLSearchParams(location.search);
  const room = (params.get('room') || '').toUpperCase();
  const name = params.get('name') || '';
  const difficulty = params.get('d') || 'normal';
  if (!room) {
    location.href = '/'; // no room code: back to the join page
    return null;
  }

  document.querySelector('.room-code').textContent = room;
  const connDot = document.querySelector('.conn-dot');
  const lobbyOverlay = document.getElementById('lobby-overlay');
  const debriefOverlay = document.getElementById('debrief-overlay');
  const toasts = document.getElementById('toasts');

  const MAX_TOASTS = 3; // keep the corner stack short; drop the oldest beyond this
  function toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    toasts.appendChild(el);
    // Cap the visible stack so a burst of events (e.g. mission end) can't grow
    // an unbounded column down the screen.
    while (toasts.children.length > MAX_TOASTS) toasts.firstChild.remove();
    setTimeout(() => el.remove(), 4200);
  }

  function renderPhase(state) {
    // Lobby: show a waiting overlay with a launch button.
    lobbyOverlay.classList.toggle('hidden', state.phase !== 'lobby');
    if (state.phase === 'lobby') {
      const crewed = ['helm', 'engineering', 'weapons']
        .map((s) => `${s}: ${state.seats[s].connected ? state.seats[s].name : 'auto'}`)
        .join(' · ');
      document.getElementById('lobby-crew').textContent = crewed;
    }
    // Debrief: show outcome summary.
    debriefOverlay.classList.toggle('hidden', state.phase !== 'debrief');
    if (state.phase === 'debrief' && state.debrief) {
      const grade = document.getElementById('debrief-grade');
      grade.textContent = `${state.debrief.grade} — ${state.debrief.score}/100`;
      // Color the grade by score band so a near-failure doesn't read as a win.
      grade.style.color = scoreColor(state.debrief.score);
      document.getElementById('debrief-narrative').textContent = state.debrief.narrative;
    }
    // Suppress the toast corner while a full-screen overlay is up, so the
    // end-of-mission event burst can't bury the debrief (or the lobby QR).
    toasts.classList.toggle('suppressed', state.phase !== 'active');
  }

  const net = new Net({
    room,
    seat,
    name,
    difficulty,
    handlers: {
      onState: (state) => {
        renderPhase(state);
        render(state);
      },
      onJoined: (msg) => onJoined?.(msg),
      onEvent: toast,
      onError: (message) => {
        alert(message);
        location.href = '/';
      },
      onStatus: (status) => connDot.classList.toggle('ok', status === 'connected'),
    },
  });

  // Anyone can launch from the lobby; the debrief return button too.
  document.getElementById('launch-btn').addEventListener('click', () =>
    net.send(startPayload ? startPayload() : { type: 'start' }));
  document.getElementById('return-btn').addEventListener('click', () => net.send({ type: 'restart' }));

  net.connect();
  return net;
}

// Format seconds as m:ss for mission clocks and countdowns.
export function fmtTime(s) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// --- Shared meter coloring (so hull/shields/charge mean the same color on
// every station instead of each station's accent). barEl is the inner fill
// div; its parent is the .meter container that carries the color class. ---
function paintMeter(barEl, pct, cls) {
  barEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  const meter = barEl.parentElement;
  if (!meter) return;
  meter.classList.remove('good', 'warn', 'bad', 'cool');
  meter.classList.add(cls);
}

// Health meters (hull, shields): green healthy, amber low, red critical.
export function setHealthBar(barEl, pct) {
  paintMeter(barEl, pct, pct >= 60 ? 'good' : pct >= 30 ? 'warn' : 'bad');
}

// Charge / readiness meters: cool blue while charging, green when ready to use.
export function setChargeBar(barEl, pct, ready) {
  paintMeter(barEl, pct, ready ? 'good' : 'cool');
}

// Score band color, shared by the debrief grade on every station.
export function scoreColor(score) {
  return score >= 70 ? 'var(--good)' : score >= 40 ? 'var(--warn)' : 'var(--bad)';
}
