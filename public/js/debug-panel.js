// Shared debug / sim-supervisor controls: simulation speed (including pause)
// and one-off spawns. Wired to a Net instance; only meaningful when the run was
// launched with debug enabled (the server ignores these actions otherwise).
// Used by the main screen (overlay) and the supervisor page (inline panel).

const SPEEDS = [0, 0.25, 0.5, 1, 2, 4]; // 0 = pause

export function mountDebugPanel(container, net) {
  container.classList.add('debug-panel');
  container.innerHTML = `
    <div class="debug-title">Sim Debug</div>
    <div class="debug-row" id="debug-speeds"></div>
    <div class="debug-row">
      <button class="debug-btn" data-act="spawnAsteroid">+ Asteroid</button>
      <button class="debug-btn" data-act="spawnGate">+ Ring</button>
    </div>`;

  const speedsEl = container.querySelector('#debug-speeds');
  for (const s of SPEEDS) {
    const b = document.createElement('button');
    b.className = 'debug-btn speed';
    b.dataset.speed = String(s);
    b.textContent = s === 0 ? '❚❚' : `${s}×`;
    b.title = s === 0 ? 'Pause' : `${s}× speed`;
    speedsEl.appendChild(b);
  }

  // Speed presets set the simulation time scale (0 pauses it).
  speedsEl.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-speed]');
    if (b) net.action({ kind: 'setTimeScale', value: Number(b.dataset.speed) });
  });
  // Spawn buttons.
  container.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-act]');
    if (b) net.action({ kind: b.dataset.act });
  });

  return {
    // Reflect the live state: highlight the active speed, disable when not in a
    // running mission.
    update(state) {
      const active = state.phase === 'active';
      for (const b of container.querySelectorAll('.debug-btn')) b.disabled = !active;
      for (const b of speedsEl.querySelectorAll('button[data-speed]')) {
        b.classList.toggle('on', Number(b.dataset.speed) === state.timeScale);
      }
    },
  };
}
