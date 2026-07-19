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
//   intents      - optional; an optimistic-intent store (js/optimistic.js).
//                  Reconciled against every snapshot BEFORE render(state), so
//                  pages can paint commanded values instantly and let the
//                  authoritative state take over when it confirms.
export function initStation({ seat, render, onJoined, startPayload, intents, onToast }) {
  const params = new URLSearchParams(location.search);
  const room = (params.get('room') || '').toUpperCase();
  const name = params.get('name') || '';
  const difficulty = params.get('d') || 'officer';
  if (!room) {
    location.href = '/'; // no room code: back to the join page
    return null;
  }

  const roomCodeEl = document.querySelector('.room-code');
  roomCodeEl.textContent = room;
  clickToCopy(roomCodeEl, () => room); // tap the header code to copy it
  const connDot = document.querySelector('.conn-dot');
  const lobbyOverlay = document.getElementById('lobby-overlay');
  const debriefOverlay = document.getElementById('debrief-overlay');
  const toasts = document.getElementById('toasts');

  const CREW = ['helm', 'engineering', 'weapons', 'crewchief'];
  const isCrew = CREW.includes(seat);
  let latest = null; // most recent snapshot (for the GO-poll launch-button logic)

  // Officer name on the console header (T1): "Weapons — Emma Cate".
  if (isCrew && name) {
    const h = document.querySelector('header h1');
    if (h) h.textContent = `${h.textContent} — ${name}`;
  }

  // Crew consoles get a "Leave Console" button (back out to role-select, freeing
  // the seat) added to the lobby overlay — the main screen keeps its own lobby.
  let leaveBtn = null;
  if (isCrew && lobbyOverlay) {
    leaveBtn = document.createElement('button');
    leaveBtn.id = 'leave-btn';
    leaveBtn.textContent = '← Leave Console';
    leaveBtn.style.marginTop = '0.6rem';
    lobbyOverlay.appendChild(leaveBtn);
    leaveBtn.addEventListener('click', () => {
      net.send({ type: 'leaveSeat' });
      location.href = `/?room=${room}`; // back to the landing page, code prefilled
    });
  }

  let lastDebriefSeed = null; // populate the debrief log once per run (keeps scroll position)
  const MAX_TOASTS = 3; // keep the corner stack short; drop the oldest beyond this
  function toast(text) {
    // Hand the toast to any console-local listener (e.g. a tactical-log widget)
    // before it fades from the corner.
    try { onToast?.(text); } catch { /* a listener must never break toasts */ }
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    toasts.appendChild(el);
    // Cap the visible stack so a burst of events (e.g. mission end) can't grow
    // an unbounded column down the screen.
    while (toasts.children.length > MAX_TOASTS) toasts.firstChild.remove();
    setTimeout(() => el.remove(), 4200);
  }

  // --- Navigation guards -----------------------------------------------------
  // A station is a physical console for the length of a mission, and the two
  // easiest ways to accidentally abandon one mid-fight are a stray right-click
  // (or long-press on a phone, which is the same gesture) and the browser's Back
  // button / back-swipe. Leaving drops the seat to auto-assist and makes the
  // crew's problem everyone's problem, so both are refused here.
  //
  // Programmatic navigation still works: the error handler and the missing-room
  // redirect both set location.href, which popstate trapping doesn't touch. To
  // actually leave, close the tab — or use the in-page debrief button.
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  // Seed a history entry to swallow, then re-seed it on every attempt so Back
  // never has anywhere to go.
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', () => {
    history.pushState(null, '', location.href);
    toast('Back is disabled at a station — close the tab to leave.');
  });

  function renderPhase(state) {
    latest = state;
    // The ready-room banner (crew consoles) pins to the top and pushes the
    // console down via body padding; clear that padding whenever we're NOT in
    // the crew lobby so the console fills the screen normally.
    if (!(state.phase === 'lobby' && isCrew)) document.body.style.paddingTop = '';
    // Lobby: show a waiting overlay with a launch button.
    lobbyOverlay.classList.toggle('hidden', state.phase !== 'lobby');
    if (state.phase === 'lobby') {
      // Roster with GO-poll status: GO ready, STBY standing by, AUTO (unmanned).
      const crewed = CREW
        .map((s) => {
          const seatS = state.seats[s];
          const diff = seatS.difficulty && seatS.difficulty !== 'officer' ? ` (${seatS.difficulty})` : '';
          const tick = seatS.connected ? (seatS.ready ? 'GO' : 'STBY') : 'AUTO';
          return `[${tick}] ${s}: ${seatS.connected ? seatS.name : 'auto'}${diff}`;
        })
        .join(' · ');
      document.getElementById('lobby-crew').innerHTML = crewed;
      // Crew consoles run the GO-poll; the button reports GO until everyone is
      // ready, then becomes the launch. The main screen keeps its own launch.
      const launchBtn = document.getElementById('launch-btn');
      const title = lobbyOverlay.querySelector('h2');
      if (isCrew && launchBtn) {
        lobbyOverlay.classList.add('checkout');
        if (title) title.textContent = 'Systems Checkout';
        const myReady = state.seats[seat]?.ready;
        if (state.allReady) {
          launchBtn.textContent = 'LAUNCH MISSION';
          launchBtn.classList.add('primary');
        } else {
          launchBtn.textContent = myReady ? '✓ GO — stand down' : 'Report GO';
          launchBtn.classList.toggle('primary', !myReady);
        }
        // Offset the console by the banner's measured height so no control hides
        // behind it (the banner wraps to more rows on narrow phones).
        requestAnimationFrame(() => {
          if (latest && latest.phase === 'lobby') document.body.style.paddingTop = `${lobbyOverlay.offsetHeight}px`;
        });
      }
    }
    // Debrief: show outcome summary.
    debriefOverlay.classList.toggle('hidden', state.phase !== 'debrief');
    if (state.phase === 'debrief' && state.debrief) {
      // Destruction must not read like an arrival: the header keys off the
      // outcome ('adrift' = hull gone / ship lost) so the one binary the
      // fiction demands is unmistakable. Scores stay non-binary below it.
      const title = document.getElementById('debrief-title');
      if (title) {
        const lost = state.debrief.outcome === 'adrift';
        title.textContent = lost ? 'SHIP LOST' : 'Mission Debrief';
        title.style.color = lost ? 'var(--bad)' : '';
      }
      const grade = document.getElementById('debrief-grade');
      // Qualitative result on its own line; the numeric score labeled below it.
      const lost = state.debrief.outcome === 'adrift';
      grade.innerHTML =
        `<div>${state.debrief.grade}</div>` +
        `<div class="label" style="margin-top:0.25rem; font-size:0.95rem;">Score: ${state.debrief.score} / 100</div>`;
      // Color the qualitative line by score band (red if the ship was lost) so a
      // near-failure doesn't read as a win.
      grade.style.color = lost ? 'var(--bad)' : scoreColor(state.debrief.score);
      document.getElementById('debrief-narrative').textContent = state.debrief.narrative;
      // Captain's log for review (populated once per run so a player's scroll
      // position isn't reset by each snapshot).
      const dlog = document.getElementById('debrief-log');
      if (dlog && state.debrief.seed !== lastDebriefSeed) {
        lastDebriefSeed = state.debrief.seed;
        dlog.innerHTML = (state.debrief.log || [])
          .map((l) => `<div>[${fmtTime(l.t)}] ${l.text}</div>`)
          .join('');
      }
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
        intents?.reconcile(state); // expire/confirm optimistic values first
        renderPhase(state);
        render(state);
      },
      onJoined: (msg) => onJoined?.(msg),
      // Route toasts by audience: a crew console shows only notices addressed to
      // ITS seat; a view seat (main screen / supervisor) shows the crew-wide
      // ('crew') notices. This keeps console chatter on its console and the shared
      // awareness on the shared screen. (Older servers send no `to` → 'crew'.)
      onEvent: (text, to) => { if (isCrew ? to === seat : to === 'crew') toast(text); },
      onError: (message) => {
        alert(message);
        location.href = '/';
      },
      onStatus: (status) => connDot.classList.toggle('ok', status === 'connected'),
    },
  });

  // Launch button. For a crew console it runs the GO-poll: toggle this seat's
  // ready until everyone is GO, then it launches. The main screen (no crew seat)
  // always launches directly with its mission-select payload.
  document.getElementById('launch-btn').addEventListener('click', () => {
    if (isCrew && latest && latest.phase === 'lobby' && !latest.allReady) {
      net.send({ type: 'setReady', on: !latest.seats[seat]?.ready });
    } else {
      net.send(startPayload ? startPayload() : { type: 'start' });
    }
  });
  document.getElementById('return-btn').addEventListener('click', () => net.send({ type: 'restart' }));

  net.connect();
  return net;
}

// Console tutorial: a small "?" in the header opens a brief what-this-console-
// does overlay. Content is supplied per page; the overlay sits above the
// lobby/debrief overlays so a waiting player can read it before launch.
export function mountHelp({ title, lines, diagram = '' }) {
  const header = document.querySelector('header');
  const btn = document.createElement('button');
  btn.id = 'help-btn';
  btn.textContent = '?';
  btn.setAttribute('aria-label', 'Console tutorial');
  header.insertBefore(btn, header.querySelector('.room-code'));

  const overlay = document.createElement('div');
  overlay.className = 'overlay hidden help-overlay';
  // `diagram` is an inline SVG schematic of the console's controls, so a new
  // player waiting in the lobby can SEE what they're about to operate.
  overlay.innerHTML = `
    <h2>${title}</h2>
    ${diagram ? `<div class="help-diagram">${diagram}</div>` : ''}
    <ul class="help-list">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
    <button class="primary" id="help-close">Back to console</button>`;
  document.body.appendChild(overlay);

  btn.addEventListener('click', () => overlay.classList.remove('hidden'));
  overlay.querySelector('#help-close').addEventListener('click', () => overlay.classList.add('hidden'));
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

// Make an element copy text to the clipboard on click (vs highlight-and-copy),
// with a brief visual ack. `getText` returns the string to copy; defaults to the
// element's own text. Used for the room code and the lobby join link.
export function clickToCopy(el, getText) {
  if (!el) return;
  el.classList.add('copyable');
  if (!el.title) el.title = 'Click to copy';
  el.addEventListener('click', async () => {
    const text = (getText ? getText() : el.textContent || '').trim();
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else { // http/insecure-context fallback
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } finally { ta.remove(); }
      }
      el.classList.add('copied');
      setTimeout(() => el.classList.remove('copied'), 1000);
    } catch { /* clipboard blocked — nothing to do */ }
  });
}
