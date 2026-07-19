// Live "flavor" console chrome for large screens. These widgets are decorative
// in that they never send actions, but they show REAL data: rolling sparkline
// graphs of a station's own live values, sensible system readouts, a
// cross-console bridge-status panel fed from real seat state, and a tactical log
// of the console's own toasts interleaved with periodic flavor lines. They live
// in `.large-only` cells, so they cost nothing on a phone and fill a big screen.

// A rolling sparkline bound to an <svg class="deco-graph"> that contains one or
// two <polyline> children. Returns push(v0, v1?) to feed a new sample per line.
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
