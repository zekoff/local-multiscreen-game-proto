// Main screen shell: the shared, renderer-agnostic half of the viewscreen page.
// It owns the WebSocket/net wiring, the room-visible DOM HUD, the captain's
// tactical readout, the cinematic dialogue overlay, lobby join info, the full
// debrief, and the music/ambient bed. The SPACE VIEW itself is delegated to a
// swappable renderer (Canvas 2D today, Phaser as the port) mounted into the
// #viewscreen container — see main-view/renderer.js for the contract. This
// shell only feeds the shared model (snapshot + interpolators) and effects (fx
// stream) each tick; the active renderer reads those and draws.

import { initStation, fmtTime, setHealthBar } from '/js/station.js';
import { qrcode } from '/js/vendor/qrcode-generator.mjs';
import { createAudio } from '/js/audio.js';
import { readyRoomAmbient } from '/js/fx-audio.js';
import { mountDebugPanel } from '/js/debug-panel.js';
import { setLatest, getLatest, onAlignmentSnapshot, onGatesSnapshot } from '/js/main-view/model.js';
import { consume as consumeFx, detectFades } from '/js/main-view/effects.js';
import { createCanvasRenderer } from '/js/main-view/canvas-renderer.js';
import { mountHudOverlay } from '/js/main-view/hud-overlay.js';
import { mountToggle } from '/js/main-view/renderer-toggle.js';

// The music builds over this many seconds, then holds — so a 3-minute run
// climaxes right at the end and a longer run stays at full for the extra time
// (the "build over ~3 min, pad out to 5" arc).
const MUSIC_BUILD_SECONDS = 180;

const logEl = document.getElementById('log');
const captainHud = document.getElementById('captain-hud');

// The main screen carries the music bed + ship-wide SFX. Browsers block audio
// until a user gesture, so resume on the first interaction (the Launch click
// counts). startMusic()/stopMusic() follow the mission phase.
const audio = createAudio();
let musicRunning = false;
for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(ev, () => audio.resume(), { once: false });
}

// --- Space-view renderer: swappable Canvas 2D <-> Phaser, chosen by the
// ?renderer flag (default canvas) and flippable live via the corner toggle for
// an apples-to-apples comparison. The Phaser bundle (~1.3 MB) is loaded ONLY in
// Phaser mode via dynamic import, so canvas mode's load cost is unchanged. The
// shared HUD overlay + the DOM overlays stay put across a switch — only the
// space view changes. ---
const viewscreen = document.getElementById('viewscreen');
let rendererKind = new URLSearchParams(location.search).get('renderer') === 'phaser' ? 'phaser' : 'canvas';
let renderer = null;

async function mountRenderer(kind) {
  if (renderer) { renderer.destroy(); renderer = null; }
  if (kind === 'phaser') {
    const { createPhaserRenderer } = await import('/js/main-view/phaser-renderer.js');
    renderer = createPhaserRenderer({ container: viewscreen, audio });
  } else {
    renderer = createCanvasRenderer({ container: viewscreen, audio });
  }
  renderer.mount();
  rendererKind = kind;
  // Persist the choice in the URL so a reload keeps the same renderer.
  const u = new URL(location.href);
  if (kind === 'phaser') u.searchParams.set('renderer', 'phaser'); else u.searchParams.delete('renderer');
  history.replaceState(null, '', u);
}

// The clean HUD chrome (reticle/chevron/banners) is a shared overlay above the
// space view, identical in both modes; mount it once and leave it across swaps.
mountHudOverlay({ container: viewscreen }).mount();
mountToggle({ container: viewscreen, getKind: () => rendererKind, onSwitch: mountRenderer });
mountRenderer(rendererKind);

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

let debugPanel; // assigned after initStation returns the Net instance
let debriefShownSeed = null; // guards one-time debrief population per run
let debriefScrollRaf = 0;    // the captain's-log auto-scroll animation handle
const net = initStation({
  seat: 'main',
  // Launch carries the selected mission and whether to expose sim-debug controls.
  startPayload: () => {
    // Per-seat difficulty overrides: only send seats the party explicitly
    // set — "crew default" leaves each player's own join-time choice alone.
    const difficulties = {};
    for (const seat of ['helm', 'engineering', 'weapons', 'crewchief']) {
      const v = document.getElementById(`diff-${seat}`).value;
      if (v) difficulties[seat] = v;
    }
    return {
      type: 'start',
      missionId: missionSelect.value || undefined,
      debug: document.getElementById('debug-toggle').checked,
      // Crew-chosen ship name (optional fiction; engine sanitizes/limits it).
      shipName: document.getElementById('ship-name').value.trim() || undefined,
      difficulties: Object.keys(difficulties).length ? difficulties : undefined,
      // Ready-room mission speed (real-time multiplier; engine clamps).
      pace: Number(document.getElementById('pace-select').value) || 1,
    };
  },
  onJoined(msg) {
    catalog = msg.catalog || [];
    // Each mission shows its difficulty rating right in the picker.
    missionSelect.innerHTML = catalog
      .map((c) => `<option value="${c.id}">${c.name} — ${c.rating}</option>`)
      .join('');
    showMissionDesc();
  },
  render(state) {
    consumeFx(state, audio); // must run before we overwrite the model's `latest`
    // Animate out contacts that vanished since the last snapshot (needs the
    // PREVIOUS snapshot's asteroids), then store the new one.
    detectFades(getLatest()?.asteroids, state);
    setLatest(state);
    // Feed the alignment + gate-depth interpolators (smooth turning AND smooth
    // ring approach between the 250ms snapshots).
    if (state.phase === 'active') { onAlignmentSnapshot(state.alignment); onGatesSnapshot(state.gates); }
    // Music follows the phase; the build is driven by *time*, not progress, so
    // the ambient->melody->beat arc lands over ~MUSIC_BUILD_SECONDS and then
    // holds at full for the remainder of a longer mission.
    if (state.phase === 'active') {
      if (!musicRunning) { audio.startMusic(); musicRunning = true; }
      const buildOver = Math.min(state.missionLength || MUSIC_BUILD_SECONDS, MUSIC_BUILD_SECONDS);
      audio.setIntensity(Math.min(1, state.missionTime / buildOver));
    } else if (musicRunning) {
      audio.stopMusic();
      musicRunning = false;
    }
    // Soft ready-room ambient bed while the crew is in the lobby (stops on launch).
    readyRoomAmbient(audio, state.phase);
    // HUD bars (hull/shields colored by value; progress keeps the accent).
    setHealthBar(document.getElementById('hull-bar'), state.hull);
    setHealthBar(document.getElementById('shield-bar'), state.shields.strength);
    document.getElementById('shield-state').textContent = state.shields.raised ? '(raised)' : '(down)';
    document.getElementById('progress-bar').style.width = `${state.progress}%`;
    if (state.mission && state.readout) {
      // Mission-configurable readout: parsecs count down to 0 at dock;
      // countdown missions show time left on the failure clock instead.
      const r = state.readout;
      document.getElementById('progress-label').textContent =
        r.label || (r.kind === 'countdown' ? 'Time Remaining' : `Distance to ${state.mission.arrivalName}`);
      document.getElementById('readout-val').textContent =
        r.kind === 'countdown' ? fmtTime(r.remaining) : `${r.remaining.toFixed(1)} ${r.unit}`;
    }
    // Header carries the crew's ship name once one is set (fiction beat #1).
    document.querySelector('header h1').textContent =
      state.shipName ? `${state.shipName} — Main Screen` : 'USS Prototype — Main Screen';
    document.getElementById('clock').textContent = fmtTime(state.missionTime);
    logEl.innerHTML = state.log.map((l) => `<div>[${fmtTime(l.t)}] ${l.text}</div>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
    updateCaptainHud(state);
    updateCinematic(state);
    // Dock-approach emphasis (playtest: the ending felt abrupt) — when the
    // destination is close, highlight the distance/clock readout so the room
    // feels the arrival building instead of it just ending.
    const nearDock = state.phase === 'active' && state.progress >= 85;
    document.getElementById('readout-val').classList.toggle('docking', nearDock);
    document.getElementById('clock').classList.toggle('docking', nearDock);
    // Sim-debug overlay: only when this run was launched with debug enabled.
    // Pinned bottom-LEFT, riding just above the HUD strip so it never covers
    // the hull/shield cells.
    const debugEl = document.getElementById('debug-panel');
    debugEl.classList.toggle('hidden', !(state.debug && state.phase === 'active'));
    const hudEl = document.querySelector('.hud');
    if (hudEl) debugEl.style.bottom = `${hudEl.offsetHeight + 10}px`;
    if (debugPanel) debugPanel.update(state);
    // Debrief: populate ONCE per run (innerHTML rewrites reset the log's
    // scroll position, which the auto-scroller owns during the debrief).
    if (state.phase !== 'debrief') debriefShownSeed = null;
    if (state.phase === 'debrief' && state.debrief && state.debrief.seed !== debriefShownSeed) {
      debriefShownSeed = state.debrief.seed;
      triggerEndFade(state.debrief); // cinematic fade: win→white, loss→black, destroyed→red→black
      // Title, qualitative result, and narrative for the whole room. Destruction
      // reads as SHIP LOST (red); otherwise the grade colors by score band.
      const lost = state.debrief.outcome === 'adrift';
      const title = document.getElementById('debrief-title');
      title.textContent = lost ? 'SHIP LOST' : 'Mission Debrief';
      title.style.color = lost ? '#ff6f6f' : '';
      const band = state.debrief.score >= 70 ? '#6ad39a' : state.debrief.score >= 40 ? '#ffb347' : '#ff6f6f';
      const gradeEl = document.getElementById('debrief-grade');
      // Qualitative on its own line; the numeric score labeled below it.
      gradeEl.innerHTML =
        `<div>${state.debrief.grade}</div>` +
        `<div class="label" style="margin-top:0.25rem; font-size:1rem;">Score: ${state.debrief.score} / 100</div>`;
      gradeEl.style.color = lost ? '#ff6f6f' : band;
      document.getElementById('debrief-narrative').textContent = state.debrief.narrative;
      document.getElementById('debrief-mission').textContent =
        `${state.debrief.missionName} (seed ${state.debrief.seed})`;
      const s = state.debrief.stats;
      // Breakers-tripped intentionally omitted (too granular for the debrief).
      document.getElementById('debrief-stats').innerHTML = `
        <div class="label">Mission time</div><div>${fmtTime(s.time)}</div>
        <div class="label">Hull remaining</div><div>${s.hull}%</div>
        <div class="label">Asteroids destroyed</div><div>${s.destroyed}</div>
        <div class="label">Impacts taken</div><div>${s.impacts}</div>
        <div class="label">Nav gates cleared</div><div>${s.gatesPassed}/${s.gatesPassed + s.gatesMissed}</div>`;
      // Crew performance: per-console telemetry so the table talk can be
      // about what each station did, not just the ship total.
      const pc = state.debrief.telemetry?.perConsole;
      if (pc) {
        const pctf = (x) => `${Math.round((x || 0) * 100)}%`;
        document.getElementById('debrief-crew').innerHTML = `
          <div class="label">Helm — rings / on course</div><div>${pctf(pc.helm.gatePassRate)} · ${pctf(pc.helm.onCoursePct)}</div>
          <div class="label">Weapons — hits / acquire</div><div>${pctf(pc.weapons.hitRate)} · ${(pc.weapons.avgAcquireLatency || 0).toFixed(1)}s</div>
          <div class="label">Engineering — power used / downtime</div><div>${pctf(pc.engineering.avgPowerUtil)} · ${Math.round(pc.engineering.breakerDowntime || 0)}s</div>
          <div class="label">Crew coordination</div><div>${pctf(pc.captain.coordinationScore)}</div>`;
      }
      // The full captain's log, written out for review — and read aloud by a
      // slow auto-scroll so the room can relive the run from the couch.
      const dl = document.getElementById('debrief-log');
      dl.innerHTML = (state.debrief.log || []).map((l) => `<div>[${fmtTime(l.t)}] ${l.text}</div>`).join('');
      dl.scrollTop = 0;
      cancelAnimationFrame(debriefScrollRaf);
      let lastScrollTs = performance.now() + 1800; // hold the top a beat first
      let scrollPos = 0; // accumulate here: sub-pixel scrollTop writes truncate
      const scrollStep = (ts) => {
        if (getLatest()?.phase !== 'debrief') return;
        if (ts > lastScrollTs) {
          scrollPos += (ts - lastScrollTs) * 0.022; // ~22px/s reading pace
          dl.scrollTop = scrollPos;
          lastScrollTs = ts;
        }
        if (dl.scrollTop + dl.clientHeight < dl.scrollHeight - 1) {
          debriefScrollRaf = requestAnimationFrame(scrollStep);
        }
      };
      debriefScrollRaf = requestAnimationFrame(scrollStep);
    }
  },
});

// Mount the sim-debug controls (hidden until a debug run is active).
debugPanel = mountDebugPanel(document.getElementById('debug-panel'), net);

// --- Captain's tactical readout: a one-glance status per station ---
const OFFICER_POP = { helm: '#5bd6ff', engineering: '#ffb347', weapons: '#ff6f6f' };
function updateCaptainHud(state) {
  captainHud.classList.toggle('hidden', state.phase !== 'active');
  if (state.phase !== 'active') return;
  // Officer name chips (T1): a small console-pop dot + name on each crew row, so
  // the captain (and the room) sees who's on each station. Kept small.
  for (const [seatId, rowId, label] of [['helm', 'cap-helm', 'HELM'], ['engineering', 'cap-eng', 'ENG'], ['weapons', 'cap-wep', 'WEP']]) {
    const el = document.querySelector(`#${rowId} .cap-name`);
    if (!el) continue;
    const s = state.seats[seatId];
    const who = s && s.connected && s.name ? s.name : '';
    el.innerHTML = who ? `<span style="color:${OFFICER_POP[seatId]}">■</span> ${label} · ${who}` : label;
  }
  const off = Math.abs(state.alignment);
  const dir = state.alignment > 0 ? 'STBD' : 'PORT';
  const vel = `vel ${(state.speed ?? 0).toFixed(1)}`;
  setCapRow('cap-helm',
    (off < 12 ? `on course · thr ${state.throttle}%` : `${off.toFixed(0)}° ${dir} · thr ${state.throttle}%`) + ` · ${vel}`,
    off > 45 ? 'alert' : off > 20 ? 'warn' : '');
  const tripped = ['engines', 'shields', 'weapons', 'sensors'].filter((s) => state.breakers[s]);
  const p = state.power;
  const towing = state.tractor && state.tractor.latched;
  setCapRow('cap-eng',
    `pwr e${p.engines} s${p.shields} w${p.weapons} sen${p.sensors} · det ${Math.round(state.sensorRange)}s`
      + (towing ? ' · TOWING' : '')
      + (tripped.length ? ` · ${tripped.join(',')} TRIPPED ×½` : ''), // tripped = running at half power
    tripped.length ? 'alert' : '');
  const sh = state.shields.raised ? `screen ${state.shields.strength}%` : 'screen DOWN';
  const laser = towing ? 'laser LOCKED (tow)' : state.charge >= 100 ? 'laser READY' : `laser ${state.charge}%`;
  setCapRow('cap-wep', `${sh} · ${laser}`,
    (state.shields.raised && state.shields.strength < 25) ? 'warn' : '');
  // THREAT row: only contacts the crew has actually IDENTIFIED as rocks (the
  // playtest ask — an all-seeing HUD undercuts the captain's job of spotting
  // unresolved contacts out the window). Unknown/pod contacts are deliberately
  // NOT listed here. Environmental hazards + shipboard emergencies + an open
  // divert are the other "what to call next" items.
  const inbound = state.asteroids
    .filter((a) => a.identified && a.kind === 'rock')
    .sort((a, b) => a.impactIn - b.impactIn);
  const soon = inbound.filter((a) => a.impactIn <= 15).length;
  const parts = inbound.slice(0, 3).map((a) => `${a.label} ${Math.ceil(a.impactIn)}s`);
  if (soon >= 2) parts.unshift(`${soon} CONVERGE ≤15s`);
  const emg = state.emergencies || [];
  const unmanned = emg.filter((e) => e.assigned === 0);
  for (const e of emg.slice(0, 2)) parts.unshift(e.label.toUpperCase().replace(' — ', ' '));
  if (state.flareIn !== null && state.flareIn !== undefined) parts.unshift(`FLARE ${Math.ceil(state.flareIn)}s — SAFE POSTURE`);
  if (state.ionStormIn > 0) parts.push(`ION STORM ${Math.ceil(state.ionStormIn)}s`);
  if (state.debrisIn > 0) parts.push(`DEBRIS ${Math.ceil(state.debrisIn)}s`);
  if (state.viewImpaired) parts.push('VIEW DARK — SENSORS ONLY');
  const thr = parts.length ? parts.join(' · ') : 'clear';
  setCapRow('cap-threat', thr,
    unmanned.length > 0 || state.flareIn > 0 || (inbound[0] && inbound[0].impactIn <= 6) || soon >= 2 ? 'alert'
      : inbound.length > 0 || emg.length > 0 || state.debrisIn > 0 || state.ionStormIn > 0 || state.viewImpaired ? 'warn' : '');
  // NAV row: an open divert or a looming obstacle takes precedence (both are
  // steering decisions), else the next slipstream ring.
  const obstacles = state.obstacles || [];
  const ob = obstacles.length ? obstacles.reduce((a, b) => (a.reachIn < b.reachIn ? a : b)) : null;
  const divert = state.divert && !state.divert.takenBy ? state.divert : null;
  const gates = state.gates || [];
  const ring = gates.length ? gates.reduce((a, b) => (a.reachIn < b.reachIn ? a : b)) : null;
  if (ob) {
    setCapRow('cap-nav', `OBSTACLE ${ob.label} · steer OFF ${ob.bearing > 0 ? 'STBD' : 'PORT'} · ${Math.ceil(ob.reachIn)}s`, 'alert');
  } else if (divert) {
    setCapRow('cap-nav', `DIVERT ${divert.name} · ${divert.bearing > 0 ? 'STBD' : 'PORT'} · ${Math.ceil(divert.endsIn)}s`, 'warn');
  } else {
    setCapRow('cap-nav',
      ring ? `${ring.label} · ${ring.bearing > 0 ? 'STBD' : 'PORT'} ${Math.abs(ring.bearing)}° · ${Math.ceil(ring.reachIn)}s` : 'no ring',
      ring && ring.reachIn <= 5 ? 'warn' : '');
  }
}
function setCapRow(id, text, cls) {
  const row = document.getElementById(id);
  row.querySelector('.cap-val').textContent = text;
  row.classList.remove('warn', 'alert');
  if (cls) row.classList.add(cls);
}

// Cinematic dialogue overlay (P#4): the server freezes the sim while
// state.cinematic is set; we show the title + lines over the frozen scene.
let cinematicSig = null;
function updateCinematic(state) {
  const overlay = document.getElementById('cinematic-overlay');
  const c = state.cinematic;
  overlay.classList.toggle('hidden', !c);
  if (!c) { cinematicSig = null; return; }
  const sig = c.title + '|' + c.lines.join('|');
  if (sig === cinematicSig) return; // avoid rebuilding every frame
  cinematicSig = sig;
  document.getElementById('cinematic-title').textContent = c.title;
  document.getElementById('cinematic-lines').innerHTML = c.lines.map((l) => `<p>${l}</p>`).join('');
}

// Mission-end cinematic fade (DOM layer above the debrief overlay): win fades
// from white, a loss from black, a destroyed ship flashes red then goes to black
// — then the layer fades out to reveal the debrief underneath.
function triggerEndFade(debrief) {
  const el = document.getElementById('end-fade');
  if (!el) return;
  const destroyed = debrief.outcome === 'adrift';
  const win = !destroyed && debrief.score >= 50;
  el.style.transition = 'none';
  el.style.background = destroyed ? '#5a0000' : win ? '#ffffff' : '#000000';
  el.style.opacity = '1';
  requestAnimationFrame(() => {
    el.style.transition = 'opacity 1.6s ease, background-color 0.8s ease';
    if (destroyed) el.style.background = '#000000'; // red → black
    el.style.opacity = '0';
  });
}
