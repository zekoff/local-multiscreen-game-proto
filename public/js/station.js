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

  function toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    toasts.appendChild(el);
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
      document.getElementById('debrief-grade').textContent = `${state.debrief.grade} — ${state.debrief.score}/100`;
      document.getElementById('debrief-narrative').textContent = state.debrief.narrative;
    }
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
