// Procedural audio for the bridge: everything is synthesized with the Web
// Audio API so there are no asset files to ship (matches the zero-build, no-CDN
// client). One module, used per device (see the routing in each page):
//   - the MAIN SCREEN runs the music bed + ship-wide SFX only (explosions,
//     hull impacts, the warp whoosh). Music plays here and nowhere else.
//   - each CONSOLE plays its own local SFX: weapons hears the laser + target
//     lock + fire-ready; engineering hears sensor contacts/pulses + the breaker
//     trip/arm/tick/restore + power clicks; helm hears steering + gate chimes.
//
// The music is a 3-phase build driven by `setIntensity` (0..1), which the main
// screen derives from *time* (build over ~180s, then hold/pad for longer
// missions):
//   ambient (I<0.33)  -> drone pad + slow noise sweeps ("deep space")
//   +melody (I<0.66)  -> a sequenced lead arpeggio fades in over the pad
//   +beat   (I>=0.66) -> a driving kick/snare/hat groove + bass ramps to full
// Browsers block audio until a user gesture, so callers must invoke resume()
// from a click/tap/keydown.

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let intensity = 0;      // 0..1, set by the caller (e.g. mission progress)
  let musicOn = false;
  let schedTimer = null;
  let step = 0;           // 16th-note index within the current bar
  let nextStepTime = 0;
  const pad = [];         // persistent pad oscillator chain
  let noiseBuf = null;

  // --- Tracks: three sparse-ambient beds sharing the same 3-phase build.
  // One is chosen at random per mission (startMusic), so back-to-back runs
  // don't sound identical. Each defines tempo, a chord-root cycle, and a set
  // of melody patterns (root multiples per eighth) the scheduler rotates
  // through — the rotation + rest bars + beat breakdowns are what keep a
  // single track from feeling like one repeating loop.
  const TRACKS = [
    { // "Drift" — the original bed: slow A-minor-ish wander.
      tempo: 96,
      roots: [110.0, 87.31, 130.81, 98.0], // A2, F2, C3, G2
      leadType: 'triangle',
      patterns: [
        [4, 4.8, 6, 4.8, 5.33, 4, 3, 4],
        [6, 4.8, 4, 3, 4, 4.8, 6, 8],
        [4, 3, 4.8, 6, 4.8, 4, 4.8, 3],
      ],
    },
    { // "Ember" — lower, slower, warmer; G-minor-ish.
      tempo: 82,
      roots: [98.0, 73.42, 116.54, 87.31], // G2, D2, Bb2, F2
      leadType: 'sine',
      patterns: [
        [3, 4, 4.8, 4, 6, 4.8, 4, 3],
        [4, 4.8, 4, 3.56, 3, 3.56, 4, 4.8],
        [6, 4.8, 4.27, 4, 4.27, 4.8, 6, 4],
      ],
    },
    { // "Aurora" — brighter and a touch quicker; B-minor-ish lift.
      tempo: 104,
      roots: [123.47, 92.5, 146.83, 110.0], // B2, F#2, D3, A2
      leadType: 'triangle',
      patterns: [
        [4, 6, 4.8, 6, 8, 6, 4.8, 4],
        [4.8, 4, 6, 4.8, 4, 3.56, 4, 4.8],
        [6, 8, 6, 4.8, 6, 4.8, 4, 4.8],
      ],
    },
    { // "Halcyon" — mid-tempo, E-minor-ish, patient and open.
      tempo: 90,
      roots: [82.41, 65.41, 98.0, 73.42], // E2, C2, G2, D2
      leadType: 'sine',
      patterns: [
        [4, 4.8, 6, 8, 6, 4.8, 4, 3],
        [3, 4, 4.8, 4, 3.56, 4, 4.8, 6],
        [6, 4.8, 4, 4.8, 6, 8, 6, 4.8],
      ],
    },
    { // "Meridian" — the slowest and lowest; D-minor deep-haul drift.
      tempo: 76,
      roots: [73.42, 58.27, 87.31, 65.41], // D2, Bb1, F2, C2
      leadType: 'triangle',
      patterns: [
        [4, 3, 4, 4.8, 4, 3.56, 3, 4],
        [4.8, 4, 3.56, 3, 3.56, 4, 4.8, 4],
        [6, 4.8, 4, 3.56, 4, 4.8, 6, 4.8],
      ],
    },
  ];
  let track = TRACKS[0];
  let stepDur = (60 / track.tempo) / 4;   // seconds per 16th note (per-track tempo)
  let chordIdx = 0;
  let barIdx = 0;                         // bar counter driving the variation logic
  let patternIdx = 0;                     // which melody pattern this stretch uses
  // 3-phase build thresholds (on the 0..1 intensity the main screen drives
  // from mission time): ambient -> +melody -> +beat.
  const MELODY_IN = 0.33;                 // intensity at which the melody starts
  const BEAT_IN = 0.66;                   // intensity at which the beat starts

  let failed = false;
  function ensure() {
    if (ctx || failed) return;
    // Audio is a nice-to-have: if the platform blocks or lacks Web Audio, fail
    // silently so nothing here can ever disrupt rendering or gameplay.
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { failed = true; return; }
    try {
      ctx = new AC();
    } catch {
      failed = true;
      return;
    }
    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.0; // faded in when music starts
    musicGain.connect(master);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.9;
    sfxGain.connect(master);
    // Reusable white-noise buffer for percussion and whooshes.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function resume() {
    ensure();
    if (ctx.state === 'suspended') ctx.resume();
  }

  function setIntensity(v) {
    intensity = Math.max(0, Math.min(1, v));
  }

  // --- Music bed ---

  function buildPad() {
    // A three-voice drone (root, fifth, octave) through a lowpass whose cutoff
    // tracks intensity and drifts with a slow LFO — the "ambient space" bed.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 6;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    filter.connect(gain);
    gain.connect(musicGain);

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    const voices = [];
    for (const [mult, type, level] of [[1, 'sine', 0.5], [1.5, 'triangle', 0.28], [2, 'sine', 0.2]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      const og = ctx.createGain();
      og.gain.value = level;
      osc.connect(og);
      og.connect(filter);
      osc.start();
      voices.push({ osc, mult });
    }
    pad.push({ filter, voices, lfo });
    setChord(0);
  }

  function setChord(idx) {
    chordIdx = idx % track.roots.length;
    const root = track.roots[chordIdx];
    const now = ctx.currentTime;
    for (const p of pad) {
      for (const v of p.voices) {
        v.osc.frequency.setTargetAtTime(root * v.mult, now, 1.5); // glide between chords
      }
      // Open the filter as intensity rises.
      p.filter.frequency.setTargetAtTime(350 + intensity * 1600, now, 2);
    }
  }

  function startMusic() {
    ensure();
    if (!ctx || musicOn) return;
    musicOn = true;
    // A fresh mission gets a randomly-drawn track (cosmetic only — gameplay
    // randomness stays on the seeded server RNG; the bed is presentation).
    track = TRACKS[Math.floor(Math.random() * TRACKS.length)];
    stepDur = (60 / track.tempo) / 4;
    barIdx = 0;
    patternIdx = Math.floor(Math.random() * track.patterns.length);
    if (pad.length === 0) buildPad();
    setChord(0);
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setTargetAtTime(0.9, ctx.currentTime, 2); // fade in
    step = 0;
    nextStepTime = ctx.currentTime + 0.1;
    schedTimer = setInterval(scheduler, 25);
  }

  function stopMusic() {
    if (!musicOn) return;
    musicOn = false;
    if (schedTimer) clearInterval(schedTimer);
    schedTimer = null;
    if (musicGain) musicGain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.6); // fade out
  }

  // Lookahead scheduler: queues percussion a little ahead of the clock so the
  // rhythm stays tight regardless of setInterval jitter.
  function scheduler() {
    if (!musicOn) return;
    while (nextStepTime < ctx.currentTime + 0.12) {
      scheduleStep(step, nextStepTime);
      nextStepTime += stepDur;
      step = (step + 1) % 16;
      if (step === 0) {
        barIdx++;
        // Rotate the melody pattern every couple of bars, with an occasional
        // random jump — the anti-repetition lever.
        if (barIdx % 2 === 0) {
          patternIdx = Math.random() < 0.3
            ? Math.floor(Math.random() * track.patterns.length)
            : (patternIdx + 1) % track.patterns.length;
        }
      }
      if (step % 8 === 0) {
        // Harmony mostly walks the cycle, occasionally skipping a chord so
        // the progression doesn't become a metronome of its own.
        setChord(chordIdx + (Math.random() < 0.15 ? 2 : 1));
      }
      // Occasional slow noise sweep ("deep space") — now in every phase, a
      // touch rarer once the beat is in so the end doesn't get crowded.
      if (step === 0 && Math.random() < (intensity < BEAT_IN ? 0.25 : 0.12)) sweep();
    }
  }

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  // The 3-phase build. `intensity` (0..1, driven by mission time) gates each
  // layer: pad drone always, melody arpeggio from MELODY_IN, driving beat from
  // BEAT_IN (ramping to full across the final phase).
  function scheduleStep(s, t) {
    const I = intensity;
    // Every 4th bar the melody rests (the pad + texture carry it) — space is
    // what keeps a sparse bed from turning into a loop.
    const restBar = barIdx % 4 === 3;
    // Every 8th bar the beat breaks down to hat + bass only, then re-enters.
    const breakdownBar = barIdx % 8 === 7;
    // Melody: a lead arpeggio that fades in for the middle phase and stays.
    if (I >= MELODY_IN && !restBar) {
      const mv = clamp01((I - MELODY_IN) / 0.3) * 0.16;
      if (s % 2 === 0) {
        const pattern = track.patterns[patternIdx];
        const note = pattern[(s / 2) % pattern.length];
        // Small chance to drop a note an octave for contour variety.
        const mult = Math.random() < 0.12 ? note / 2 : note;
        lead(t, track.roots[chordIdx] * mult, mv);
      }
    }
    // Beat: enters for the final phase, deliberately restrained — the pulse
    // should push, not pound (playtest: the old end-phase beat was too
    // strong). Gains are roughly half the first pass, the double-kick only
    // appears near full intensity, and breakdown bars pull it out entirely.
    if (I >= BEAT_IN) {
      const b = clamp01((I - BEAT_IN) / (1 - BEAT_IN)); // 0..1 across the beat phase
      if (!breakdownBar) {
        if (s === 0 || s === 8 || (b > 0.75 && s === 12)) kick(t, 0.32 + b * 0.2);
        if (b > 0.35 && (s === 4 || s === 12)) snare(t, 0.14 + b * 0.16);
      }
      if (s % 4 === 0) hat(t, 0.1 + b * 0.12);
      if (b > 0.7 && s % 4 === 2) hat(t, 0.05 + b * 0.07);
      if (s === 0 || s === 8) bass(t, track.roots[chordIdx] / 2, 0.24 + b * 0.2);
    }
  }

  // Lead-synth note for the melody arpeggio (soft triangle through a lowpass).
  function lead(t, freq, g) {
    if (!ctx || g <= 0.001) return;
    const o = ctx.createOscillator();
    const gain = ctx.createGain();
    o.type = track.leadType; // per-track lead voice
    o.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2600;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(g, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    o.connect(lp); lp.connect(gain); gain.connect(musicGain);
    o.start(t); o.stop(t + 0.36);
  }

  // Slow band-swept noise swell — the ambient "deep space" texture under the pad.
  function sweep() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(200, t);
    bp.frequency.exponentialRampToValueAtTime(1100, t + 3);
    bp.frequency.exponentialRampToValueAtTime(200, t + 6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 2);
    g.gain.linearRampToValueAtTime(0, t + 6);
    src.connect(bp); bp.connect(g); g.connect(musicGain);
    src.start(t); src.stop(t + 6.1);
  }

  function kick(t, g) {
    const o = ctx.createOscillator();
    const gain = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    gain.gain.setValueAtTime(g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(gain); gain.connect(musicGain);
    o.start(t); o.stop(t + 0.22);
  }

  function snare(t, g) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    src.connect(bp); bp.connect(gain); gain.connect(musicGain);
    src.start(t); src.stop(t + 0.15);
  }

  function hat(t, g) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(hp); hp.connect(gain); gain.connect(musicGain);
    src.start(t); src.stop(t + 0.05);
  }

  function bass(t, freq, g) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(g, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(gain); gain.connect(musicGain);
    o.start(t); o.stop(t + 0.3);
  }

  // --- SFX (one-shots) ---

  function now() { return ctx ? ctx.currentTime : 0; }

  // Big asteroid explosion: filtered noise blast + a low body thump.
  function explosion() {
    if (!ctx) return;
    const t = now();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    src.connect(lp); lp.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t + 0.46);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    og.gain.setValueAtTime(0.7, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(og); og.connect(sfxGain);
    o.start(t); o.stop(t + 0.36);
  }

  // Hull/shield impact: heavier and lower when it hurts the hull.
  function impact(heavy) {
    if (!ctx) return;
    const t = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(heavy ? 120 : 220, t);
    o.frequency.exponentialRampToValueAtTime(heavy ? 38 : 90, t + 0.25);
    g.gain.setValueAtTime(heavy ? 0.9 : 0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (heavy ? 0.4 : 0.2));
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + (heavy ? 0.42 : 0.22));
    if (heavy) { // add a metallic crunch
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 900;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.5, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      src.connect(bp); bp.connect(ng); ng.connect(sfxGain);
      src.start(t); src.stop(t + 0.21);
    }
  }

  // Short phaser zap for each shot (kept quiet — it fires a lot).
  function laser() {
    if (!ctx) return;
    const t = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.14);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + 0.17);
  }

  // Rising two-note chime for a clean gate pass; a duller thud for a miss.
  function gatePass() { twoNote(523.25, 783.99, 0.3); }
  function gateMiss() { twoNote(196, 155.56, 0.28); }
  function twoNote(f1, f2, vol) {
    if (!ctx) return;
    const t = now();
    for (const [f, dt] of [[f1, 0], [f2, 0.09]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(vol, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.22);
      o.connect(g); g.connect(sfxGain);
      o.start(t + dt); o.stop(t + dt + 0.24);
    }
  }

  // Console-local SFX.
  function breakerTrip() { // harsh descending buzz — something broke
    if (!ctx) return;
    const t = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.25);
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + 0.31);
  }

  function breakerReset() { // clean confirming blip — power restored
    if (!ctx) return;
    const t = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(400, t);
    o.frequency.exponentialRampToValueAtTime(760, t + 0.1);
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + 0.17);
  }

  // Emergency Warp: a big downward whoosh + sub boom (the ship tears away).
  function warp() {
    if (!ctx) return;
    const t = now();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    src.connect(lp); lp.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t + 0.66);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    og.gain.setValueAtTime(0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(og); og.connect(sfxGain);
    o.start(t); o.stop(t + 0.56);
  }

  // Active sensor pulse: a clean rising sonar-style ping.
  function sensorPulse() {
    if (!ctx) return;
    const t = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(500, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.25);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + 0.42);
  }

  function shield(up) { // filtered-noise whoosh, pitch up when raising
    if (!ctx) return;
    const t = now();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(up ? 300 : 1200, t);
    bp.frequency.exponentialRampToValueAtTime(up ? 1400 : 250, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(bp); bp.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t + 0.36);
  }

  // A short pure blip used by several console SFX: freq f0->f1 over `dur`.
  function blip(f0, f1, vol, dur, type = 'sine') {
    if (!ctx) return;
    const t = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // Weapons: crisp two-blip lock when a contact is acquired.
  function targetLock() { blip(880, 1320, 0.18, 0.06); blip(1320, 1320, 0.14, 0.05); }
  // Weapons: soft rising chime when the laser finishes recharging (ready to fire).
  function fireReady() { blip(520, 780, 0.16, 0.12, 'triangle'); }
  // Engineering: quick sonar-ish ping when a contact resolves on sensors (not
  // the big pulse sweep — a small, frequent detection tick).
  function sensorContact() { blip(760, 1180, 0.14, 0.1); }
  // Engineering: mechanical "chunk" when a tripped breaker's slider is armed.
  function breakerArm() {
    if (!ctx) return;
    const t = now();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(lp); lp.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t + 0.13);
    blip(160, 90, 0.25, 0.1, 'square');
  }
  // Engineering: short click for each of the three restore taps.
  function breakerTick() { blip(600, 600, 0.18, 0.04, 'square'); }
  // Engineering: tiny tick when a power point is reallocated.
  function powerClick() { blip(440, 520, 0.1, 0.05, 'square'); }
  // Helm: subtle blip per steering nudge (fires every tick while a button is held).
  function nudgeTick() { blip(300, 360, 0.06, 0.04, 'square'); }
  // Helm: short servo confirmation when the throttle setpoint is committed —
  // pitch tracks the commanded % so up and down read differently.
  function throttleSet(pct) {
    const f = 180 + (Math.max(0, Math.min(100, pct)) / 100) * 240;
    blip(f * 0.8, f, 0.14, 0.09, 'triangle');
  }
  // Helm: heavy mechanical engage clunk the moment WARP is pressed (the big
  // ship-wide whoosh follows from the fx stream on the next snapshot).
  function warpEngage() { blip(140, 70, 0.3, 0.12, 'square'); }
  // Weapons: dry trigger click on FIRE (the laser zap follows from fx).
  function trigger() { blip(900, 700, 0.12, 0.03, 'square'); }
  // Weapons: tiny tick when a blip is tapped (the lock chime confirms later).
  function tapTick() { blip(660, 720, 0.08, 0.03); }
  // Ready room: soft random console beep/boop — idle-bridge atmosphere.
  function readyBeep() {
    const f = 300 + Math.random() * 900;
    blip(f, f * (0.8 + Math.random() * 0.5), 0.05, 0.05 + Math.random() * 0.06, Math.random() < 0.5 ? 'sine' : 'triangle');
  }

  // Ion storm front: a crackling static wash (engineering + main screen).
  function ionStorm() {
    if (!ctx) return;
    const t = now();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(2400, t);
    bp.frequency.exponentialRampToValueAtTime(600, t + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.28, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    src.connect(bp); bp.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t + 1.55);
    // A couple of electrical crackle ticks on top of the wash.
    blip(1800, 900, 0.12, 0.05, 'square');
    setTimeout(() => blip(2200, 1100, 0.1, 0.05, 'square'), 180);
  }

  // --- Crew Chief SFX ---
  // Tractor latch: a rising electromagnetic hum that settles (the beam grabs).
  function tractorBeam() {
    if (!ctx) return;
    const t = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(230, t + 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(lp); lp.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + 0.72);
  }
  // Cargo stowed: a solid mechanical clunk into the hold.
  function stow() {
    if (!ctx) return;
    const t = now();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    src.connect(lp); lp.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t + 0.15);
    blip(120, 70, 0.28, 0.12, 'square');
  }
  // Cargo jettisoned: an airy whoosh out the bay.
  function jettison() {
    if (!ctx) return;
    const t = now();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    src.connect(bp); bp.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t + 0.48);
  }
  // Shipboard fire alarm: an urgent two-tone klaxon.
  function fireAlarm() { blip(720, 520, 0.2, 0.18, 'square'); setTimeout(() => blip(720, 520, 0.2, 0.18, 'square'), 220); }
  // Boarders alarm: a lower, harsher pulse.
  function boardersAlarm() { blip(300, 300, 0.22, 0.22, 'sawtooth'); setTimeout(() => blip(240, 240, 0.2, 0.2, 'sawtooth'), 260); }
  // Solar flare strike: a bright surge sweep (ship-wide, main screen).
  function flare() {
    if (!ctx) return;
    const t = now();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.setValueAtTime(400, t);
    hp.frequency.exponentialRampToValueAtTime(3000, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    src.connect(hp); hp.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t + 0.95);
    blip(300, 1400, 0.16, 0.5, 'sine');
  }

  // --- Ready-room ambient bed (lobby only) ---
  // A soft looping drone with slow noise breath — the "waiting on the bridge"
  // atmosphere before launch. Distinct from the mission music (main screen).
  // Idempotent start/stop so a console can call it every snapshot by phase.
  let ambientNodes = null;
  function startAmbient() {
    ensure();
    if (!ctx || ambientNodes) return;
    const t = now();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 1.5); // gentle fade-in
    g.connect(sfxGain);
    // A low two-voice drone.
    const oscs = [];
    for (const [f, type, lvl] of [[70, 'sine', 0.5], [105, 'triangle', 0.22]]) {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = lvl;
      o.connect(og); og.connect(g); o.start(t);
      oscs.push(o);
    }
    // A slow band-swept noise "breath" under the drone.
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.5; bp.frequency.value = 500;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const lfoG = ctx.createGain(); lfoG.gain.value = 300;
    lfo.connect(lfoG); lfoG.connect(bp.frequency); lfo.start(t);
    const ng = ctx.createGain(); ng.gain.value = 0.05;
    src.connect(bp); bp.connect(ng); ng.connect(g); src.start(t);
    ambientNodes = { g, oscs, src, lfo };
  }
  function stopAmbient() {
    if (!ambientNodes) return;
    const { g, oscs, src, lfo } = ambientNodes;
    const t = now();
    try {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, 0.4);
      for (const o of oscs) o.stop(t + 1.2);
      src.stop(t + 1.2); lfo.stop(t + 1.2);
    } catch { /* nodes already stopped */ }
    ambientNodes = null;
  }

  // Debris field entered: a low gravel rumble (helm + main screen).
  function debris() {
    if (!ctx) return;
    const t = now();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    src.connect(lp); lp.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t + 1.65);
  }

  return {
    resume,
    setIntensity,
    startMusic,
    stopMusic,
    explosion,
    impact,
    laser,
    gatePass,
    gateMiss,
    breakerTrip,
    breakerReset,
    warp,
    sensorPulse,
    sensorContact,
    targetLock,
    fireReady,
    breakerArm,
    breakerTick,
    powerClick,
    nudgeTick,
    throttleSet,
    warpEngage,
    trigger,
    tapTick,
    readyBeep,
    ionStorm,
    debris,
    tractorBeam,
    stow,
    jettison,
    fireAlarm,
    boardersAlarm,
    flare,
    startAmbient,
    stopAmbient,
    shieldUp: () => shield(true),
    shieldDown: () => shield(false),
  };
}
