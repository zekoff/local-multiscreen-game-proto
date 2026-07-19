// Live "flavor" console chrome for large screens. These widgets are decorative
// in that they never send actions, but they show REAL data: rolling sparkline
// graphs of a station's own live values, sensible system readouts, a
// cross-console bridge-status panel fed from real seat state, and a tactical log
// of the console's own toasts interleaved with periodic flavor lines. They live
// in `.large-only` cells, so they cost nothing on a phone and fill a big screen.

// A rolling sparkline bound to an <svg class="deco-graph"> that contains one or
// more <polyline> children (one line each). Returns push(v0, v1, …) — feed one
// new sample per line, in the SVG's polyline order.
export function spark(svg, { max = 48, lo = 0, hi = 100 } = {}) {
  const lines = [...svg.querySelectorAll('polyline')];
  const hist = lines.map(() => []);
  const W = 120, H = 44;
  const norm = (v) => H - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (H - 4) - 2;
  return (...vals) => {
    vals.forEach((v, i) => { if (i >= hist.length) return; hist[i].push(v); if (hist[i].length > max) hist[i].shift(); });
    hist.forEach((h, i) => {
      if (!lines[i] || h.length < 2) return;
      const step = W / (h.length - 1);
      lines[i].setAttribute('points', h.map((v, k) => `${(k * step).toFixed(1)},${norm(v).toFixed(1)}`).join(' '));
    });
  };
}

// A decorative synthetic signal for graph lines that model no real console
// datum — they still need to look alive, each with its own character. This is
// pure client chrome (never gameplay), so Math.random is fine here — it is NOT
// the seeded engine RNG. Call the returned fn once per render; it returns a
// value clamped to [lo, hi].
//   wave   — smooth rhythmic sine
//   wave2  — two summed sines, a slow beat
//   jitter — jumps a lot (fresh random level every sample)
//   walk   — random walk, wanders smoothly
//   pulse  — mostly low with occasional sharp spikes that decay
//   saw    — sawtooth ramp
export function makeSignal(kind, { base = 50, amp = 30, period = 10, lo = 0, hi = 100 } = {}) {
  let t = Math.random() * 1000; // random phase so lines don't move in lockstep
  let v = base;                 // running value for walk/pulse kinds
  const clamp = (x) => Math.max(lo, Math.min(hi, x));
  const TAU = Math.PI * 2;
  return (dt = 0.25) => {
    t += dt;
    switch (kind) {
      case 'wave': return clamp(base + amp * Math.sin((t / period) * TAU));
      case 'wave2': return clamp(base + amp * (0.7 * Math.sin((t / period) * TAU) + 0.3 * Math.sin((t / (period * 0.31)) * TAU)));
      case 'jitter': return clamp(base + (Math.random() - 0.5) * amp * 2);
      case 'walk': v = clamp(v + (Math.random() - 0.5) * amp * 0.4); return v;
      case 'pulse': v = Math.max(lo, v - amp * 0.12); if (Math.random() < 0.05) v = clamp(base + amp); return v;
      case 'saw': return lo + ((t / period) % 1) * (hi - lo);
      default: return base;
    }
  };
}

const SEAT_META = {
  helm: { label: 'Helm', color: '#6fa8ff' },
  engineering: { label: 'Engineering', color: '#ffb347' },
  weapons: { label: 'Weapons', color: '#ff6f6f' },
};

// Cross-console bridge status painted from real seat + ship state. Any console
// can show it, so "a widget reporting on other consoles" shows realistic data.
// `activeSeat` is highlighted in its accent.
export function renderCrew(el, state, activeSeat) {
  const seats = state.seats || {};
  const power = state.power || { engines: 0, shields: 0, weapons: 0, sensors: 0 };
  const rows = ['helm', 'engineering', 'weapons'].map((s) => {
    const seat = seats[s] || {};
    const manned = !!seat.connected;
    const dot = activeSeat === s ? SEAT_META[s].color : (manned ? '#6ad39a' : '#7d8db3');
    let metric;
    if (s === 'helm') metric = Math.abs(state.alignment ?? 0) < 12 ? `on course · thr ${state.throttle ?? 0}%` : `${Math.abs(state.alignment).toFixed(0)}° ${state.alignment > 0 ? 'stbd' : 'port'}`;
    else if (s === 'engineering') metric = `pwr e${power.engines} s${power.shields} w${power.weapons} sen${power.sensors}`;
    else metric = `${(state.charge ?? 0) >= 100 ? 'laser ready' : `laser ${state.charge ?? 0}%`}${state.shields?.raised ? ' · screen up' : ''}`;
    return `<div><span class="dot" style="background:${dot}"></span>${SEAT_META[s].label} <span style="color:var(--dim)">— ${metric}${manned ? '' : ' (auto)'}</span></div>`;
  });
  const hull = state.hull ?? 100;
  const alert = hull < 25 ? '<b style="color:var(--bad)">RED ALERT</b>'
    : hull < 55 ? '<b style="color:var(--warn)">CONDITION AMBER</b>'
      : '<b style="color:var(--good)">CONDITION GREEN</b>';
  el.innerHTML = rows.join('') + `<div class="deco-stat" style="margin-top:0.35rem"><span>hull ${Math.round(hull)}% · alert</span>${alert}</div>`;
}

// A rolling tactical log: the console's REAL toasts (fed via push) interleaved
// with periodic ambient flavor lines so the log breathes even on a quiet watch.
export function tacticalLog(el, flavorLines = []) {
  const lines = [];
  const MAX = 6;
  let flavorIdx = 0;
  let lastFlavorAt = -99;
  function paint() {
    el.innerHTML = lines.map((l) => `<div style="${l.hot ? 'color:var(--text)' : ''}">› ${l.text}</div>`).join('');
  }
  function add(text, hot) { lines.push({ text, hot }); while (lines.length > MAX) lines.shift(); paint(); }
  // Seed with a couple ambient lines so it isn't empty at mission start.
  for (const f of flavorLines.slice(0, 3)) add(f, false);
  return {
    push: (text) => add(text, true),
    // Call each tick with the mission time; emits an ambient line every ~16s.
    tick: (missionTime) => {
      if (!flavorLines.length) return;
      if (missionTime - lastFlavorAt > 16) { lastFlavorAt = missionTime; add(flavorLines[flavorIdx++ % flavorLines.length], false); }
    },
  };
}
