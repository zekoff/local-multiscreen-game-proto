// Procedural audio for the bridge: everything is synthesized with the Web
// Audio API so there are no asset files to ship (matches the zero-build, no-CDN
// client). One module, used two ways:
//   - the main screen runs the music bed + ship-wide SFX (explosions, impacts,
//     gate passes, laser fire heard across the bridge)
//   - each console plays only its own local SFX (breaker trip/reset, shields)
//
// Music is an ambient drone that grows: as intensity climbs (mission progress)
// the filter opens, a bass pulse comes in, and percussion builds from a soft
// kick to a full kick/snare/hat pattern. Browsers block audio until a user
// gesture, so callers must invoke resume() from a click/tap/keydown.

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

  const TEMPO = 96;                       // BPM
  const STEP = (60 / TEMPO) / 4;          // seconds per 16th note
  // A slow minor-ish progression the drone cycles through (root frequencies).
  const ROOTS = [110.0, 87.31, 130.81, 98.0]; // A2, F2, C3, G2
  let chordIdx = 0;

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
    chordIdx = idx % ROOTS.length;
    const root = ROOTS[chordIdx];
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
    if (pad.length === 0) buildPad();
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
      nextStepTime += STEP;
      step = (step + 1) % 16;
      if (step % 8 === 0) setChord(chordIdx + 1); // advance harmony every half-bar
    }
  }

  // Percussion pattern grows with intensity: soft kick -> kick+hats -> full
  // kick/snare/hat groove.
  function scheduleStep(s, t) {
    const I = intensity;
    if (I < 0.12) return; // very early: drone only
    // Kick on the downbeats; add the off-beats once things heat up.
    if (s === 0 || s === 8 || (I > 0.6 && (s === 4 || s === 12))) kick(t, 0.6 + I * 0.5);
    // Snare backbeat once we're past the midpoint.
    if (I > 0.5 && (s === 4 || s === 12)) snare(t, 0.3 + I * 0.4);
    // Hats: 8ths as intensity builds, 16ths near the climax.
    if (I > 0.3 && s % 4 === 0) hat(t, 0.15 + I * 0.2);
    if (I > 0.7 && s % 2 === 1) hat(t, 0.08 + I * 0.12);
    // Bass pulse follows the kick in the mid range.
    if (I > 0.35 && (s === 0 || s === 8)) bass(t, ROOTS[chordIdx] / 2, 0.3 + I * 0.3);
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
    shieldUp: () => shield(true),
    shieldDown: () => shield(false),
  };
}
