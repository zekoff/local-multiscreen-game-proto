// Shared debug / sim-supervisor controls: simulation speed (including pause), a
// CPU crew-skill slider (how well the auto-assist bots play — a solo-playtest
// aid), and an on-demand spawn dropdown. Wired to a Net instance; only meaningful
// when the run was launched with debug enabled (the server ignores otherwise).
// Used by the main screen (overlay) and the supervisor page (inline panel).

const SPEEDS = [0, 0.25, 0.5, 1, 2, 5]; // 0 = pause; 5× is the debug top speed
// Every procedurally-addable concept, grouped for the spawn dropdown. Each value
// maps to a case in game.ts debugSpawn() (which reuses the scripted-event
// executors so debug matches real play).
const SPAWN_GROUPS = [
  ['Contacts', [['rock', 'Rock'], ['pod', 'Rescue Pod'], ['mineral', 'Salvage'], ['ghost', 'Sensor Ghost']]],
  ['Navigation', [['gate', 'Nav Gate'], ['obstacle', 'Obstacle'], ['divert', 'Divert Beacon']]],
  ['Hazards', [['ionstorm', 'Ion Storm'], ['debris', 'Debris Field'], ['ghostswarm', 'Ghost Swarm'], ['blackout', 'Blackout (toggle)'], ['flare', 'Solar Flare']]],
  ['Emergencies', [['fire', 'Fire'], ['breach', 'Hull Breach'], ['boarders', 'Boarders'], ['leak', 'Coolant Leak']]],
  ['Test', [['damage', 'Hull −30% (test repair)'], ['heal', 'Hull +30%']]],
];

export function mountDebugPanel(container, net) {
  container.classList.add('debug-panel');
  container.innerHTML = `
    <div class="debug-title">Sim Debug</div>
    <div class="debug-row" id="debug-speeds"></div>
    <div class="debug-row">
      <span class="debug-lbl">CPU crew</span>
      <input type="range" id="debug-skill" min="0" max="100" step="5" value="70" class="debug-slider">
      <span id="debug-skill-val" class="debug-lbl">70%</span>
    </div>
    <div class="debug-row">
      <select id="debug-spawn-what" class="debug-select">
        ${SPAWN_GROUPS.map(([g, opts]) => `<optgroup label="${g}">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</optgroup>`).join('')}
      </select>
      <button class="debug-btn" id="debug-spawn-btn">Spawn</button>
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

  // CPU crew-skill slider → setCrewSkill (0..1).
  const skill = container.querySelector('#debug-skill');
  const skillVal = container.querySelector('#debug-skill-val');
  skill.addEventListener('input', () => {
    skillVal.textContent = `${skill.value}%`;
    net.action({ kind: 'setCrewSkill', value: Number(skill.value) / 100 });
  });

  // Spawn dropdown + single button → spawn the selected thing on demand.
  const what = container.querySelector('#debug-spawn-what');
  container.querySelector('#debug-spawn-btn').addEventListener('click', () => {
    net.action({ kind: 'spawn', what: what.value });
  });

  return {
    // Reflect the live state: highlight the active speed, disable when not in a
    // running mission, and keep the skill slider synced to the authoritative value.
    update(state) {
      const active = state.phase === 'active';
      for (const b of container.querySelectorAll('.debug-btn')) b.disabled = !active;
      what.disabled = !active;
      skill.disabled = !active;
      for (const b of speedsEl.querySelectorAll('button[data-speed]')) {
        b.classList.toggle('on', Number(b.dataset.speed) === state.timeScale);
      }
      if (typeof state.crewSkill === 'number' && document.activeElement !== skill) {
        const pct = Math.round(state.crewSkill * 100);
        skill.value = String(pct);
        skillVal.textContent = `${pct}%`;
      }
    },
  };
}
