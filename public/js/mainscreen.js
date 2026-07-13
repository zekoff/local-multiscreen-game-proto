// Main screen: the shared viewscreen. A forward-facing starfield that banks
// with the helm's course, a themed destination that grows on the horizon as
// the mission progresses, inbound asteroids, fly-through nav gates, and
// one-shot effects (laser fire, explosions, screen shake) driven by the
// server's transient `fx` stream. Plus the room-visible HUD, a captain's
// tactical readout, lobby join info, and the full debrief.

import { initStation, fmtTime, setHealthBar } from '/js/station.js';
import { qrcode } from '/js/vendor/qrcode-generator.mjs';
import { createAudio } from '/js/audio.js';
import { playFxAudio, readyRoomAmbient } from '/js/fx-audio.js';
import { mountDebugPanel } from '/js/debug-panel.js';

// The music builds over this many seconds, then holds — so a 3-minute run
// climaxes right at the end and a longer run stays at full for the extra time
// (the "build over ~3 min, pad out to 5" arc).
const MUSIC_BUILD_SECONDS = 180;

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
    consumeFx(state); // must run before we overwrite `latest`
    // Animate out contacts that vanished since the last snapshot: a captured
    // pod/salvage slides down toward the cargo bay; anything else that drifted
    // past fades instead of popping out of existence.
    if (latest && latest.asteroids) {
      const nowIds = new Set(state.asteroids.map((a) => a.id));
      const exploded = new Set((state.fx || []).filter((e) => e.kind === 'explosion').map((e) => e.id));
      const stowed = (state.fx || []).some((e) => e.kind === 'stow');
      for (const a of latest.asteroids) {
        if (nowIds.has(a.id) || exploded.has(a.id)) continue; // still here, or blew up (own fx)
        const p = astPos.get(a.id);
        if (!p) continue;
        const salvage = a.kind === 'pod' || a.kind === 'mineral' || a.visualKind === 'pod' || a.visualKind === 'mineral';
        if (stowed && salvage) fadeCargo.push({ x: p.x, y: p.y, t: 0, kind: a.visualKind === 'pod' || a.kind === 'pod' ? 'pod' : 'mineral' });
        else fadeAway.push({ x: p.x, y: p.y, t: 0 });
      }
    }
    latest = state;
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
    if (state.phase !== 'debrief') { debriefShownSeed = null; endKind = ''; endFade = 0; }
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
        if (!latest || latest.phase !== 'debrief') return;
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

// --- One-shot effects (fx) from the server, plus screen shake / flashes ---
const lasers = [];      // { id, hit, life }
const explosions = [];  // { id, life, max }
const gateFx = [];      // { passed, life }
const fadeCargo = [];   // captured contacts animating down toward the cargo bay
const fadeAway = [];    // contacts that drifted past — fade out instead of vanishing
let shake = 0;
let warpFlash = 0;      // white full-screen flash on an Emergency Warp
let pulseFlash = 0;     // cyan flash on an active sensor pulse
let shieldFlash = 0;    // cool blue edge shimmer when the shields soak a hit
let stormFlash = 0;     // brief wash when an ion storm front arrives
let collisionBanner = 0;// brief centered COLLISION banner on a heavy strike
let hullFlash = 0;      // brief red edge flash on any unabsorbed hull hit (incl. debris)
let glitch = 0;         // main-screen instability flicker (hull breach anomaly)
let endFade = 0;        // mission-end transition progress (0..1), see endTransition
let endKind = '';       // 'win' | 'loss' | 'destroyed'
const prevCargoIds = new Set(); // to detect a newly-stowed contact (cargo animation)

// The main screen renders EVERY effect visually, but only plays the ship-wide
// sounds (explosion/impact/warp). The laser is heard at weapons, gate chimes at
// helm, sensor pings at engineering — see each station's playFxAudio call.
const MAIN_AUDIO_KINDS = new Set(['explosion', 'impact', 'warp', 'ionStorm', 'debris']);
function consumeFx(state) {
  for (const e of state.fx || []) {
    if (e.kind === 'laser') { lasers.push({ id: e.targetId, hit: e.hit, life: 0.28 }); }
    else if (e.kind === 'explosion') { explosions.push({ id: e.id, life: 0.55, max: 0.55 }); }
    else if (e.kind === 'impact') {
      if (e.absorbed) {
        shake = Math.min(40, shake + 6);
        // A soaked hit shimmers blue at the edges — the shield doing its job.
        shieldFlash = 0.5;
      } else {
        // Any unabsorbed hit flashes the hull red (scaled by damage) so even a
        // small debris-scour tick reads as "we're taking hull damage."
        shake = Math.min(40, shake + 8 + e.hullDmg * 0.7);
        hullFlash = Math.min(1, hullFlash + 0.35 + e.hullDmg * 0.03);
        // Reserve the big centered COLLISION banner for a genuinely heavy strike
        // (an obstacle / large rock), not the steady small debris ticks.
        if (e.hullDmg >= 10) collisionBanner = 1;
      }
    }
    else if (e.kind === 'gate') { gateFx.push({ passed: e.passed, life: 0.5 }); if (e.passed) shake = Math.min(shake + 3, 40); }
    else if (e.kind === 'warp') { shake = 34; warpFlash = 0.7; }
    else if (e.kind === 'sensorPulse') { pulseFlash = 0.45; }
    else if (e.kind === 'ionStorm') { stormFlash = 0.6; }
    else if (e.kind === 'anomaly') { glitch = Math.min(1, glitch + 0.7); } // hull-breach instability
  }
  playFxAudio(state.fx, audio, MAIN_AUDIO_KINDS);
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

// --- Nebula depth wash: 3 large, very faint color blobs behind the stars.
// Stable per mission (seeded from the mission id) so the sky has an identity
// without flickering; drifts at half-parallax for a sense of depth.
let nebulaBlobs = [];
let nebulaKey = '';
function nebulaFor(missionId) {
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

// --- Debris-field specks: brown motes streaming past while inside a field,
// faster when the ship runs hot (the visual argument for easing off).
const debrisSpecks = Array.from({ length: 80 }, () => ({ x: 0, y: 0, z: 0, a: 0, sp: 0, m: 1 }));
let debrisInit = false;

// Deterministic screen position for an asteroid id (stable so it doesn't jump),
// in unyawed base coords; the caller adds the current yaw offset.
function asteroidBasePos(id, w, h) {
  return {
    x: (0.15 + ((id * 0.618) % 0.7)) * w,
    y: (0.2 + ((id * 0.377) % 0.55)) * h,
  };
}

// Last drawn screen position per asteroid id, so a laser/explosion can point at
// where a rock WAS after it's been removed from the state (it's populated each
// frame by drawAsteroids). Cleared if it grows unreasonably (session restarts).
const astPos = new Map();

// Per-rock angular silhouette (classic-Asteroids style, but filled): a seeded
// ring of 9-12 vertices with jittered radii plus a slow spin. Cached per id so
// a rock keeps its shape for its whole approach.
const astShapes = new Map();
function astShapeFor(id) {
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
const STRIKE_VIS_EDGE = 94;

// Where an asteroid sits on screen this frame. Its lateral position tracks
// (bearing - the helm's alignment) throughout the approach — NOT a funnel to
// dead center — so rocks strike across most of the viewscreen and a rock the
// helm steers to the rim visibly slides off the flank (a clean miss), matching
// the server's strike geometry. It only foreshortens toward center at range
// (the depth of the lane), spreading to its true strike point as it closes.
function asteroidScreenPos(a, w, h, _yawPx) {
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
function cachedAstPos(id, w, h, yawPx) {
  const p = astPos.get(id);
  if (p) return p;
  const base = asteroidBasePos(id, w, h);
  return { x: base.x + yawPx, y: base.y };
}

// --- Snapshot interpolation for the ship's alignment ---
// The server steps alignment once per 250ms tick; rendering the raw value
// makes the world (and gate rings) jump-then-smooth under continuous turning.
// Instead we interpolate from the previously DISPLAYED value toward each new
// snapshot over one tick interval, which stays smooth through held turns.
let alignPrev = 0;
let alignCurr = 0;
let alignAt = 0;
function onAlignmentSnapshot(v) {
  alignPrev = displayAlignment();
  alignCurr = v;
  alignAt = performance.now();
}
function displayAlignment() {
  const t = Math.max(0, Math.min(1, (performance.now() - alignAt) / 280));
  return alignPrev + (alignCurr - alignPrev) * t;
}

// Per-gate reachIn (ring DEPTH) interpolation. The server steps reachIn once per
// 250ms tick, so the ring radius popped each tick even though its x already
// glided via displayAlignment. Ease each gate's depth from its last displayed
// value toward the new snapshot over one tick, keyed by gate id.
const gateReach = new Map(); // id -> { prev, curr, at }
function onGatesSnapshot(gates) {
  const now = performance.now();
  const seen = new Set();
  for (const g of gates || []) {
    seen.add(g.id);
    const prev = gateReach.has(g.id) ? displayGateReach(g.id, g.reachIn) : g.reachIn;
    gateReach.set(g.id, { prev, curr: g.reachIn, at: now });
  }
  for (const id of [...gateReach.keys()]) if (!seen.has(id)) gateReach.delete(id);
}
function displayGateReach(id, fallback) {
  const e = gateReach.get(id);
  if (!e) return fallback;
  const t = Math.max(0, Math.min(1, (performance.now() - e.at) / 280));
  return e.prev + (e.curr - e.prev) * t;
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

  // Bank the view with the interpolated alignment (see onAlignmentSnapshot):
  // the interpolation supplies tick-to-tick smoothness, so the easing here
  // just follows it briskly instead of doing the smoothing itself.
  const targetYaw = latest && latest.phase === 'active' ? Math.max(-1, Math.min(1, displayAlignment() / 100)) : 0;
  yaw += (targetYaw - yaw) * Math.min(1, dt * 8);
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
  const slipstream = !!(latest && latest.phase === 'active' && latest.slipstream);

  // Nebula wash behind everything: barely-there color, half-parallax drift.
  if (latest?.mission?.id) {
    const tNow = performance.now() / 1000;
    for (const b of nebulaFor(latest.mission.id)) {
      const bx = ((b.x + b.drift * tNow) % 1.2) * w + yawPx * b.depth;
      const by = b.y * h;
      const br = b.r * Math.min(w, h) * 1.6;
      const g = ctx.createRadialGradient(bx, by, br * 0.1, bx, by, br);
      g.addColorStop(0, `rgba(${b.c[0]}, ${b.c[1]}, ${b.c[2]}, ${b.a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Starfield streaks toward the (yawed) vanishing point. An open slipstream
  // more than doubles the apparent star rush — speed you can feel.
  for (const s of stars) {
    s.z -= (0.07 + shipSpeed * 0.0055) * (slipstream ? 2.4 : 1) * dt;
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
    drawDistantTraffic(w, h, yawPx, dpr); // T5: faint far vessels crossing the lane
    drawDestination(w, h, cx, dpr);
    drawGates(w, h, cy, dpr);
    drawObstacles(w, h, cy, dpr);
    drawAsteroids(w, h, yawPx, dpr);
    drawLasers(w, h, yawPx, dt, dpr);
    drawExplosions(w, h, yawPx, dt, dpr);
    if (latest.debrisIn > 0) drawDebris(w, h, cx, cy, projScale, dt, dpr);
    if (latest.ionStormIn > 0) drawIonStorm(w, h);
  }

  ctx.restore();

  // Blackout wash (flare / permanent ion storm): drawn over the world, but the
  // reticle + HUD stay legible on top so the crew can still fly on sensors.
  if (latest && latest.phase === 'active' && latest.viewImpaired) drawBlackout(w, h, dpr);

  // Slipstream streaks are drawn in FIXED screen space, centered on where the
  // ship is pointed (the reticle), not on the destination's vanishing point.
  if (latest && latest.phase === 'active' && slipstream) drawSlipstream(w, h, w / 2, h / 2, dpr);

  // Forward reticle in fixed screen space (the ship's heading): the world
  // banks behind it, so "centered under the crosshair" reads as on-course.
  if (latest && latest.phase === 'active') {
    drawReticle(w, h, dpr);
    drawShieldArc(w, h, dpr);
    drawHullVignette(w, h);
    drawDamageOverlay(w, h, dt);
    // Off-screen objective arrow (helm turned hard / diverted): the fallback to
    // get back on track. Skip while fully blacked out (nothing to point at).
    if (!latest.viewImpaired) drawOffscreenChevron(w, h, dpr);
  }
  drawGateFlash(w, h, dt);
  drawFlashes(w, h, dt);
  drawFades(w, h, dt, dpr);
  // Hull-breach instability flicker + centered COLLISION call on a strike.
  drawGlitch(w, h, dt);
  drawCollisionBanner(w, h, dt, dpr);
  // Big translucent notices for ongoing effects / upcoming events / red alert.
  if (latest && latest.phase === 'active') drawNotifications(w, h, dpr);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// T5 environmental storytelling: a few faint, far-off vessels crossing the lane
// (running lights blinking), seeded per mission so the Verge feels inhabited —
// pure backdrop, no mechanics. Drifts with the helm's yaw at low parallax.
let trafficLanes = [];
let trafficKey = '';
function trafficFor(missionId) {
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
function drawDistantTraffic(w, h, yawPx, dpr) {
  const tNow = performance.now() / 1000;
  for (const v of trafficFor(latest.mission?.id || 'x')) {
    const x = (((v.phase + v.speed * tNow) % 1) + 1) % 1 * w + yawPx * 0.25;
    const y = v.y * h;
    const blink = (Math.sin(tNow * 3 + v.phase * 9) + 1) / 2;
    ctx.fillStyle = `rgba(${v.col === '#9fb4e0' ? '159,180,224' : '200,168,130'},0.5)`;
    ctx.fillRect(x, y, 6 * dpr, 1.6 * dpr);           // tiny far hull
    ctx.fillStyle = `rgba(180,220,255,${0.25 + blink * 0.55})`;
    ctx.fillRect(x + (v.speed > 0 ? 6 * dpr : -1.5 * dpr), y - 0.5 * dpr, 1.5 * dpr, 1.5 * dpr); // running light
  }
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

// --- Notification framework: big, translucent banners for ongoing effects
// (asteroid field, ion storm, debris, blackout), upcoming events (solar flare
// in Ns), and a pulsing RED ALERT. One place feeds off the serialized flags. ---
function activeNotices(s) {
  const n = [];
  if (s.hull !== undefined && s.hull < 25) n.push({ text: '⚠ RED ALERT', tone: 'alert', big: true });
  if (s.flareIn > 0) n.push({ text: `☀ SOLAR FLARE IN ${Math.ceil(s.flareIn)}s — SAFE POSTURE`, tone: 'warn' });
  if (s.viewImpaired) n.push({ text: '◇ FORWARD VIEW LOST — FLY ON SENSORS', tone: 'warn' });
  if (s.ionStormIn > 0) n.push({ text: '≈ ION STORM — SENSORS DEGRADED', tone: 'warn' });
  if (s.debrisIn > 0) n.push({ text: '⋯ DEBRIS FIELD — EASE THROTTLE', tone: 'warn' });
  const inbound = (s.asteroids || []).filter((a) => a.targetable && (a.kind === 'rock' || a.kind === 'unknown')).length;
  if (inbound >= 3) n.push({ text: '☄ ASTEROID FIELD', tone: 'warn' });
  return n;
}
function drawNotifications(w, h, dpr) {
  const notices = activeNotices(latest);
  if (!notices.length) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  // Start the banner stack BELOW the captain HUD (a DOM overlay pinned to the
  // top of the viewscreen) so ongoing environmental notices aren't hidden behind
  // it. Track the HUD's measured height; fall back to 12% down before layout.
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

// Brief centered COLLISION call after a hull strike (with the heavier shake).
function drawCollisionBanner(w, h, dt, dpr) {
  if (collisionBanner <= 0) return;
  collisionBanner = Math.max(0, collisionBanner - dt * 1.6);
  ctx.textAlign = 'center';
  ctx.font = `800 ${46 * dpr}px system-ui, sans-serif`;
  ctx.fillStyle = `rgba(255,80,80,${Math.min(1, collisionBanner)})`;
  ctx.fillText('COLLISION', w / 2, h * 0.5);
}

// Contacts leaving the screen: passed-by ones fade in place; captured salvage
// slides down toward the cargo bay (bottom-center) and fades as it's stowed.
function drawFades(w, h, dt, dpr) {
  for (let i = fadeAway.length - 1; i >= 0; i--) {
    const f = fadeAway[i];
    f.t += dt / 0.6;
    if (f.t >= 1) { fadeAway.splice(i, 1); continue; }
    ctx.globalAlpha = (1 - f.t) * 0.5;
    ctx.fillStyle = 'rgba(150,140,122,1)';
    ctx.beginPath(); ctx.arc(f.x, f.y, (6 + f.t * 10) * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  const bayX = w / 2, bayY = h * 0.985;
  for (let i = fadeCargo.length - 1; i >= 0; i--) {
    const f = fadeCargo[i];
    f.t += dt / 0.9;
    if (f.t >= 1) { fadeCargo.splice(i, 1); continue; }
    const x = f.x + (bayX - f.x) * f.t;
    const y = f.y + (bayY - f.y) * f.t;
    ctx.globalAlpha = 1 - f.t * 0.7;
    ctx.fillStyle = f.kind === 'pod' ? '#4cd97b' : '#ffb347';
    ctx.beginPath(); ctx.arc(x, y, 7 * (1 - f.t * 0.5) * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// Hull-breach instability: horizontal CRT-tear bands that decay.
function drawGlitch(w, h, dt) {
  if (glitch <= 0) return;
  glitch = Math.max(0, glitch - dt * 1.2);
  for (let i = 0; i < 3; i++) {
    if (Math.random() > glitch) continue;
    const by = Math.random() * h;
    const bh = (4 + Math.random() * 18) * devicePixelRatio;
    ctx.fillStyle = `rgba(120,200,255,${0.05 + glitch * 0.12})`;
    ctx.fillRect(0, by, w, bh);
  }
}

// Raised shields: a faint energy arc over the bow (bottom of the viewscreen),
// its presence/brightness tracking the shield's remaining strength — the whole
// room can see the defense posture at a glance.
function drawShieldArc(w, h, dpr) {
  if (!latest.shields?.raised) return;
  const strength = (latest.shields.strength || 0) / 100;
  // A big blue bow over the front of the ship. Its angular COVERAGE shrinks as
  // the deflector drains — a strong screen wraps wide, a weak one is a sliver —
  // with a light alpha-blue fill under the rim.
  const cx = w / 2, cy = h * 1.18, rad = h * 0.62;
  const half = (0.16 + 0.30 * strength) * Math.PI; // half-span grows with charge
  const start = -Math.PI / 2 - half, end = -Math.PI / 2 + half;
  const alpha = 0.10 + strength * 0.22;
  ctx.save();
  // Filled wedge (fades in toward the rim).
  const g = ctx.createRadialGradient(cx, cy, rad * 0.55, cx, cy, rad);
  g.addColorStop(0, 'rgba(120,200,255,0)');
  g.addColorStop(1, `rgba(120,200,255,${alpha * 0.6})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, rad, start, end);
  ctx.closePath();
  ctx.fill();
  // Bright rim.
  ctx.strokeStyle = `rgba(150,215,255,${0.3 + strength * 0.45})`;
  ctx.lineWidth = 3 * dpr;
  ctx.beginPath(); ctx.arc(cx, cy, rad, start, end); ctx.stroke();
  ctx.restore();
}

// Low hull: a steady, subtle red edge vignette — ambient dread, not a strobe.
function drawHullVignette(w, h) {
  const hull = latest.hull ?? 100;
  if (hull >= 30) return;
  const a = ((30 - hull) / 30) * 0.22;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(255, 60, 60, ${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// Damage feedback: a brief red edge flash on each unabsorbed hull hit, and a
// sustained red pulse while the ship is scoured by a debris field at speed —
// both make "we're taking hull damage" unmistakable through the visuals alone.
function drawDamageOverlay(w, h, dt) {
  if (hullFlash > 0.001) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(255, 45, 45, ${hullFlash * 0.4})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    hullFlash = Math.max(0, hullFlash - dt * 1.8);
  }
  // Sustained debris scour: running hot (throttle above the safe line) inside a
  // field bleeds the hull, so the edges pulse red — "ease off the throttle."
  if (latest && latest.debrisIn > 0 && (latest.throttle || 0) > 40) {
    const pulse = 0.09 + 0.06 * Math.sin(performance.now() / 170);
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.40, w / 2, h / 2, Math.max(w, h) * 0.74);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(210, 70, 40, ${pulse})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

// Slipstream open: long additive streak lines radiating from the vanishing
// point — the gate reward made visible to the whole room.
function drawSlipstream(w, h, cx, cy, dpr) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + (performance.now() / 900) % (Math.PI * 2);
    const r0 = Math.min(w, h) * 0.12;
    const r1 = Math.min(w, h) * (0.5 + (i % 3) * 0.14);
    const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0 * 0.82;
    const x1 = cx + Math.cos(a) * r1, y1 = cy + Math.sin(a) * r1 * 0.82;
    // Softer + more transparent: a gradient stroke that fades to nothing at both
    // ends (no hard line caps), at roughly half the old opacity.
    const peak = 0.028 + (i % 3) * 0.016;
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, 'rgba(143,214,255,0)');
    grad.addColorStop(0.5, `rgba(163,222,255,${peak})`);
    grad.addColorStop(1, 'rgba(143,214,255,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = (1 + (i % 2)) * dpr;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.restore();
}

// Inside a debris field: a dense cloud of small tumbling rocks rushing past,
// faster when the throttle is hot, with occasional bright "pings" as fragments
// glance off the hull — the picture tells the helm why the hull is complaining
// (kept in the same visual language as the ion-storm / blackout effects).
function resetDebrisSpeck(s, deep) {
  s.x = (Math.random() - 0.5) * 2.6;
  s.y = (Math.random() - 0.5) * 2.6;
  s.z = deep ? STAR_NEAR_Z + Math.random() * (STAR_FAR_Z - STAR_NEAR_Z) : STAR_FAR_Z;
  s.a = Math.random() * Math.PI * 2;        // tumble angle
  s.sp = (Math.random() - 0.5) * 6;         // tumble speed
  s.m = 0.7 + Math.random() * 1.1;          // size multiplier
}
function drawDebris(w, h, cx, cy, projScale, dt, dpr) {
  if (!debrisInit) {
    for (const s of debrisSpecks) resetDebrisSpeck(s, true);
    debrisInit = true;
  }
  // Faster stream than the ambient mote field, and faster still at speed.
  const hot = 0.7 + ((latest.throttle || 0) / 100) * 2.0;
  const scouring = (latest.throttle || 0) > 40; // taking hull damage right now
  for (const s of debrisSpecks) {
    s.z -= 0.30 * hot * dt;
    s.a += s.sp * dt;
    if (s.z <= STAR_NEAR_Z) resetDebrisSpeck(s, false);
    const px = cx + (s.x / s.z) * projScale;
    const py = cy + (s.y / s.z) * projScale;
    if (px < -20 || px > w + 20 || py < -20 || py > h + 20) continue;
    const closeness = 1 - (s.z - STAR_NEAR_Z) / (STAR_FAR_Z - STAR_NEAR_Z);
    const size = (0.9 + closeness * 3.6) * s.m * dpr;
    // A little tumbling rock: a rotated quad rather than a flat square.
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(s.a);
    ctx.fillStyle = `rgba(150, 132, 108, ${0.22 + closeness * 0.55})`;
    ctx.fillRect(-size / 2, -size / 2, size, size * 0.72);
    ctx.restore();
    // Near, fast-moving fragments occasionally spark as they glance off — brighter
    // and more frequent while actually scouring the hull.
    if (closeness > 0.72 && Math.random() < (scouring ? 0.05 : 0.015)) {
      ctx.strokeStyle = `rgba(255, 224, 190, ${0.4 + closeness * 0.4})`;
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - (s.x / s.z) * projScale * 0.05, py - (s.y / s.z) * projScale * 0.05);
      ctx.stroke();
    }
  }
}

// Ion storm: a faint charged wash plus flickering horizontal interference
// bands — reads as instruments struggling, not screen damage.
function drawIonStorm(w, h) {
  ctx.fillStyle = 'rgba(120, 130, 235, 0.045)';
  ctx.fillRect(-w, -h, w * 3, h * 3);
  for (let i = 0; i < 3; i++) {
    if (Math.random() < 0.4) continue; // bands flicker in and out
    const y = Math.random() * h;
    const bh = (1 + Math.random() * 2);
    ctx.fillStyle = `rgba(150, 170, 255, ${0.03 + Math.random() * 0.05})`;
    ctx.fillRect(0, y, w, bh);
  }
  // Crackle: occasional jagged discharge arcs across the view (charged static).
  const dpr = devicePixelRatio;
  const arcs = Math.random() < 0.5 ? 1 : 0;
  for (let a = 0; a < arcs; a++) {
    ctx.strokeStyle = `rgba(180, 200, 255, ${0.18 + Math.random() * 0.25})`;
    ctx.lineWidth = 1.2 * dpr;
    let x = Math.random() * w, y = Math.random() * h * 0.3;
    ctx.beginPath(); ctx.moveTo(x, y);
    const steps = 5 + Math.floor(Math.random() * 5);
    for (let s = 0; s < steps; s++) {
      x += (Math.random() - 0.5) * 60 * dpr;
      y += (Math.random() * 40 + 10) * dpr;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

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
  // Interpolated alignment: rings glide as the ship swings instead of
  // jumping once per server tick.
  const align = displayAlignment();
  for (const gate of latest.gates || []) {
    // Interpolated depth: the ring closes smoothly between ticks, no per-tick pop.
    const reach = displayGateReach(gate.id, gate.reachIn);
    const t = Math.max(0, Math.min(1, 1 - reach / GATE_MAX_REACH)); // 0 far .. 1 here
    const r = (14 + t * t * Math.min(w, h) * 0.7);
    // Screen x from how far the ship's alignment is off the gate's bearing.
    const cx = w / 2 + ((gate.bearing - align) / 100) * (w * 0.5);
    const lined = Math.abs(align - gate.bearing) <= 30;
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
  if (astPos.size > 400) astPos.clear();
  for (const a of latest.asteroids) {
    // A phantom (boarders' sensor spoof) is a scope-only blip — nothing is out
    // the window, so the main screen never draws it. The weapons scope still does.
    if (a.phantom) continue;
    const { x: px, y: py, closeness } = asteroidScreenPos(a, w, h, yawPx);
    astPos.set(a.id, { x: px, y: py });
    const size = a.size ?? 1;
    // Two classes: LARGE rocks (snapshot-proof) resolve MUCH bigger and a deeper
    // brown; SMALL rocks stay modest. Both start dot-sized while far (the growth
    // curve keeps a fresh spawn a bare dot the captain has to SPOT), then diverge
    // as they close — only the growth term scales with class, so the far dot is
    // the same tiny size for both.
    const big = size > 1.2; // mirrors engine SNAPSHOT_MAX_SIZE
    const growth = Math.max(0, Math.min(1, 1 - a.impactIn / 16));
    // Objects about to strike loom larger (they fill more of the window).
    const nearBoost = 1 + Math.max(0, 5 - a.impactIn) * 0.14;
    const bloom = 26 * (big ? 2.0 : 1.0); // large hazards bloom ~2x on approach
    const r = (0.7 + Math.pow(growth, 1.25) * bloom) * (0.82 + 0.18 * size) * nearBoost * dpr;
    // Range ring: a faint distance cue that closes onto the body at contact.
    // Only drawn once the contact is ACQUIRED (targetable) — before that it's an
    // unresolved dot the captain must spot with the naked eye, no HUD.
    if (a.targetable) {
      const ringR = r + (34 * dpr + r * 0.8) * Math.min(1, a.impactIn / 16);
      ctx.strokeStyle = 'rgba(160,180,220,0.16)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.arc(px, py, ringR, 0, Math.PI * 2); ctx.stroke();
    }
    // visualKind reveals a pod/mineral up close (captain's naked eye) even while
    // the weapons scope still reads UNKNOWN — the don't-shoot cooperation hook.
    const vk = a.visualKind || 'unknown';
    if (vk === 'pod') { drawPodContact(px, py, r, a, dpr); continue; }
    if (vk === 'mineral') { drawMineralContact(px, py, r, a, dpr); continue; }
    // Body colour: large rocks are a deeper, darker brown; small a lighter
    // grey-brown. Threat is communicated by the ring, not the body.
    const bodyFill = big ? 'rgba(112, 92, 74, 0.94)' : 'rgba(150, 140, 122, 0.92)';
    const glowRgb = big ? '120, 96, 74' : '150, 140, 120';
    const glow = ctx.createRadialGradient(px, py, r * 0.2, px, py, r * 1.7);
    glow.addColorStop(0, `rgba(${glowRgb}, ${0.05 + growth * 0.15})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(px, py, r * 1.7, 0, Math.PI * 2); ctx.fill();
    // The rock body: an irregular filled polygon (per-id silhouette + slow
    // spin) instead of a flat circle — reads as a tumbling asteroid.
    const shape = astShapeFor(a.id);
    const rot = (performance.now() / 1000) * shape.spin;
    ctx.beginPath();
    shape.pts.forEach((p, i) => {
      const vx = px + Math.cos(p.a + rot) * r * p.m;
      const vy = py + Math.sin(p.a + rot) * r * p.m;
      i === 0 ? ctx.moveTo(vx, vy) : ctx.lineTo(vx, vy);
    });
    ctx.closePath();
    ctx.fillStyle = bodyFill;
    ctx.fill();

    // Unresolved contacts stay an unlabeled rock — the captain must spot them and
    // call for more sensor power. Once targetable, ring it in its threat colour;
    // the currently-locked target gets a brighter, thicker ring. Rocks only.
    if (!a.targetable || (a.kind !== 'rock' && a.kind !== 'unknown')) continue;
    const spd = a.speed ?? 1;
    // Threat colour: fast or imminent = red, moderate = amber, else yellow-green.
    const threat = (spd >= 1.15 || a.impactIn < 6) ? '#ff5c5c'
      : (spd >= 0.95 || a.impactIn < 12) ? '#ffb347' : '#e0d24c';
    const targeted = a.id === latest.targetId;
    ctx.strokeStyle = threat;
    ctx.globalAlpha = targeted ? 1 : 0.8;
    ctx.lineWidth = (targeted ? 3.5 : 2) * dpr;
    ctx.beginPath(); ctx.arc(px, py, r + (targeted ? 6 : 4) * dpr, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = threat;
    ctx.font = `${12 * dpr}px monospace`;
    ctx.textAlign = 'center';
    // No speed text — the range ring conveys closing rate for the captain to
    // synthesize. Label + the seconds-to-impact countdown only.
    ctx.fillText(`${a.label} ${Math.ceil(a.impactIn)}s`, px, py - r - 8 * dpr);
  }
  // A tractor beam from the ship to the latched contact (Crew Chief towing).
  drawTractorBeam(w, h, dpr);
}

// A rescue pod, up close: a distinct green hull with a blinking beacon and a
// clear DO-NOT-FIRE call — the captain's cue to stop Weapons before Sensors ID.
function drawPodContact(px, py, r, a, dpr) {
  const rr = Math.max(6 * dpr, r);
  const blink = (Math.sin(performance.now() / 220) + 1) / 2;
  const glow = ctx.createRadialGradient(px, py, rr * 0.2, px, py, rr * 2.1);
  glow.addColorStop(0, `rgba(76, 217, 123, ${0.18 + blink * 0.22})`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(px, py, rr * 2.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0e2016';
  ctx.strokeStyle = '#4cd97b';
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Beacon light.
  ctx.fillStyle = `rgba(150, 255, 190, ${0.4 + blink * 0.6})`;
  ctx.beginPath(); ctx.arc(px, py - rr * 0.5, Math.max(1.5, rr * 0.25), 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4cd97b';
  ctx.font = `${12 * dpr}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(`${a.label} — RESCUE POD`, px, py - rr - 8 * dpr);
  ctx.fillStyle = blink > 0.5 ? '#7dffb0' : '#4cd97b';
  ctx.fillText('DO NOT FIRE', px, py + rr + 16 * dpr);
}

// Salvage mineral chunk, up close: an amber angular body — tractor bait.
function drawMineralContact(px, py, r, a, dpr) {
  const rr = Math.max(5 * dpr, r);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate((performance.now() / 2600) % (Math.PI * 2));
  ctx.fillStyle = 'rgba(255, 179, 71, 0.85)';
  ctx.strokeStyle = '#ffcf87';
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const m = 0.7 + ((a.id * (i + 3)) % 5) / 10;
    const vx = Math.cos(ang) * rr * m, vy = Math.sin(ang) * rr * m;
    i === 0 ? ctx.moveTo(vx, vy) : ctx.lineTo(vx, vy);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#ffb347';
  ctx.font = `${11 * dpr}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(`${a.label} — SALVAGE`, px, py - rr - 8 * dpr);
}

// The tractor beam: a shimmering line from the ship's bow to the held contact.
function drawTractorBeam(w, h, dpr) {
  const t = latest.tractor;
  if (!t || !t.latched || t.targetId == null) return;
  const held = (latest.asteroids || []).find((a) => a.id === t.targetId);
  const p = held ? astPos.get(held.id) : null;
  if (!p) return;
  const ox = w / 2, oy = h * 0.98;
  const pulse = (Math.sin(performance.now() / 120) + 1) / 2;
  ctx.save();
  ctx.strokeStyle = `rgba(120, 235, 220, ${0.25 + pulse * 0.35})`;
  ctx.lineWidth = (5 + pulse * 5) * dpr;
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(p.x, p.y); ctx.stroke();
  ctx.strokeStyle = `rgba(200, 255, 250, ${0.4 + pulse * 0.4})`;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(p.x, p.y); ctx.stroke();
  // Reel progress ring around the contact.
  ctx.strokeStyle = 'rgba(120, 235, 220, 0.9)';
  ctx.lineWidth = 3 * dpr;
  ctx.beginPath(); ctx.arc(p.x, p.y, 16 * dpr, -Math.PI / 2, -Math.PI / 2 + (t.reel || 0) * Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// Large steer-around obstacles: a looming dark mass at its bearing offset. Red
// and pulsing when the ship is still aligned INTO it (collision course).
function drawObstacles(w, h, cy, dpr) {
  const align = displayAlignment();
  for (const ob of latest.obstacles || []) {
    const t = Math.max(0, Math.min(1, 1 - ob.reachIn / 20));
    const r = (24 + t * t * Math.min(w, h) * 0.9);
    const cx = w / 2 + ((ob.bearing - align) / 100) * (w * 0.5);
    const onCourseInto = Math.abs(align - ob.bearing) < (ob.clearWindow || 22);
    const pulse = (Math.sin(performance.now() / 160) + 1) / 2;
    const col = onCourseInto ? [255, 80, 80] : [150, 140, 130];
    const a = onCourseInto ? 0.5 + pulse * 0.4 : 0.4 + t * 0.3;
    const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a})`);
    g.addColorStop(0.7, `rgba(30,26,24,${0.85})`);
    g.addColorStop(1, 'rgba(10,8,8,0.2)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = onCourseInto ? `rgba(255,90,90,${0.7 + pulse * 0.3})` : 'rgba(120,110,100,0.6)';
    ctx.lineWidth = (2 + t * 2) * dpr;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = onCourseInto ? '#ff5c5c' : '#7ddb9a';
    ctx.font = `${12 * dpr}px monospace`;
    ctx.textAlign = 'center';
    // Make the collision read UNMISTAKABLE from the main screen (playtest: it was
    // only legible on the helm console) — call the collision AND which way to
    // steer to clear it, or confirm CLEAR when the bow is off it.
    const steer = ob.bearing > align ? 'STEER PORT ◀' : '▶ STEER STARBOARD';
    ctx.fillText(onCourseInto ? `⚠ ${ob.label} — COLLISION · ${steer}` : `${ob.label} — CLEAR`, cx, cy - r - 8 * dpr);
  }
}

// Off-screen objective chevron: when the destination (or an open divert) slides
// off the edge because the helm turned hard, an arrow on the screen edge points
// back to it — the crew's fallback to get back on track.
function drawOffscreenChevron(w, h, dpr) {
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

// Blackout: the forward view is lost (solar flare / heavy ion storm). Wash the
// world to near-black with faint static so the room must fly on sensors.
function drawBlackout(w, h, dpr) {
  ctx.save();
  // Dimmer than before (playtest: "can only see the faintest of objects") — the
  // crew flies almost entirely on sensors during a blackout.
  ctx.fillStyle = 'rgba(2, 3, 6, 0.975)';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(120,140,180,${Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2 * dpr, 2 * dpr);
  }
  ctx.fillStyle = 'rgba(180, 200, 255, 0.5)';
  ctx.font = `${16 * dpr}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('— FORWARD VIEW LOST — FLY ON SENSORS —', w / 2, h * 0.5);
  ctx.restore();
}

// Laser beams fired from the ship's cannons to the (former) contact position.
function drawLasers(w, h, yawPx, dt, dpr) {
  const originY = h * 0.98;
  for (let i = lasers.length - 1; i >= 0; i--) {
    const l = lasers[i];
    const p = cachedAstPos(l.id, w, h, yawPx);
    let tx = p.x;
    const ty = p.y;
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
    const p = cachedAstPos(e.id, w, h, yawPx);
    const px = p.x;
    const py = p.y;
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
  // Shield soak: a cool blue shimmer from the edges (distinct from hull red).
  if (shieldFlash > 0) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(120, 200, 255, ${shieldFlash * 0.5})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    shieldFlash = Math.max(0, shieldFlash - dt * 1.4);
  }
  // Ion storm front arriving: one brief charged wash.
  if (stormFlash > 0) {
    ctx.fillStyle = `rgba(140, 150, 255, ${stormFlash * 0.25})`;
    ctx.fillRect(0, 0, w, h);
    stormFlash = Math.max(0, stormFlash - dt * 0.9);
  }
}

// Brief green shimmer when a gate is PASSED. A missed gate gets NO flash — it's
// an opportunity lost, not a negative event; a red wash wrongly read as "damage".
function drawGateFlash(w, h, dt) {
  for (let i = gateFx.length - 1; i >= 0; i--) {
    const f = gateFx[i];
    if (f.passed) {
      const alpha = (f.life / 0.5) * 0.18;
      ctx.fillStyle = `rgba(125, 219, 154, ${alpha})`;
      ctx.fillRect(0, 0, w, h);
    }
    f.life -= dt;
    if (f.life <= 0) gateFx.splice(i, 1);
  }
}

// #rrggbb + alpha -> rgba() string.
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
