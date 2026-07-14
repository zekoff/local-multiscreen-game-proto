// Crew Chief console widgets: the tractor/cargo rig and the damage-control crew
// board. Built on the portable widget abstraction (widget.js) so they can be
// re-homed on another console later by moving them between layout arrays.

import { defineWidget, el } from '../widget.js';

const KIND_ICON = { pod: 'POD', mineral: 'ORE', rock: 'ROCK', ghost: '?', unknown: '·' };

// (The tractor/tow control moved to the Weapons console — see widgets/tow.js.
// The Crew Chief keeps the cargo hold and the damage-control board below.)

// --- Cargo hold: what's aboard, the mass penalty to maneuverability, and a
// jettison control per item. ---
export const cargoHold = defineWidget({
  id: 'cargo-hold',
  label: 'Cargo Hold',
  hint: 'A heavy hold turns sluggishly — jettison to recover maneuverability.',
  mount({ root, net }) {
    const summary = el('div', 'spread');
    const cap = el('span', 'readout');
    cap.style.fontSize = '1.1rem';
    const maneuver = el('span', 'label');
    summary.append(cap, maneuver);
    const grid = el('div', 'cargo-grid');
    root.append(summary, grid);

    grid.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-jettison]');
      if (!btn) return;
      net.action({ kind: 'jettison', id: Number(btn.dataset.jettison) });
    });

    return {
      render(state) {
        const cargo = state.cargo || [];
        const capacity = state.holdCapacity ?? 4;
        cap.textContent = `${cargo.length} / ${capacity} slots`;
        // Maneuverability estimate mirrors the engine's CARGO_TURN_PENALTY (0.45).
        const load = capacity > 0 ? Math.min(1, (state.cargoMass || 0) / capacity) : 0;
        const pct = Math.round(45 * load);
        maneuver.textContent = pct > 0 ? `turn −${pct}%` : 'nimble';
        maneuver.style.color = pct >= 25 ? 'var(--bad)' : pct > 0 ? 'var(--warn)' : 'var(--dim)';
        const sig = cargo.map((c) => c.id).join(',');
        if (grid.dataset.sig === sig) return;
        grid.dataset.sig = sig;
        grid.innerHTML = '';
        for (const c of cargo) {
          const cell = el('div', 'cargo-cell');
          cell.innerHTML = `<span>${KIND_ICON[c.kind] || '·'} ${c.label}</span>`;
          const j = el('button', 'cargo-jettison', '⤴');
          j.dataset.jettison = c.id;
          j.title = 'Jettison';
          cell.appendChild(j);
          grid.appendChild(cell);
        }
        for (let i = cargo.length; i < capacity; i++) {
          grid.appendChild(el('div', 'cargo-cell empty', '·'));
        }
      },
    };
  },
});

// --- Deck Crew board: COMMIT a scarce roster of hands to deploy posts —
// per-system maintenance (trim out drifting wear), the hull-repair bay, and
// shipboard emergencies. Commitment is real: you can only ADD hands (no yanking
// mid-job); crew free themselves when the job is done. Stacking is faster but
// with diminishing returns. When no human chief is aboard, automated systems run
// the deck (the board shows an automated note instead of posts). ---
const SYS_NAME = { engines: 'Engines', shields: 'Shields', weapons: 'Weapons', sensors: 'Sensors' };
// What a system's drift actually costs (the effective-power derate), phrased in
// that system's own consumer so the chief sees the concrete impact, not just
// "drifting". Mirrors the engine WEAR_EFF_PENALTY (0.15 at full wear).
const SYS_DERATE = { engines: 'thrust', shields: 'regen', weapons: 'recharge', sensors: 'range' };
const WEAR_EFF_PENALTY = 0.15;

export const deckCrew = defineWidget({
  id: 'deck-crew',
  label: 'Deck Crew',
  hint: 'Commit hands to trim systems, patch the hull, and fight emergencies — they stay until the job is done. More hands = faster (diminishing returns).',
  mount({ root, net }) {
    const roster = el('div', 'crew-roster');
    const auto = el('div', 'label');        // automated note when no human chief
    const posts = el('div', 'deck-posts');  // maintenance + repair posts
    const list = el('div', 'emergency-list');
    root.append(roster, auto, posts, list);

    // One delegated handler: every "+ crew" button carries its post key.
    root.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-post]');
      if (!btn || btn.disabled) return;
      net.action({ kind: 'assignCrew', post: btn.dataset.post });
    });

    function postRow(icon, name, status, meterClass, fillPct, postKey, disabled) {
      const row = el('div', 'deck-post');
      row.innerHTML =
        `<div class="spread"><span>${icon} ${name}</span><span class="label">${status}</span></div>` +
        `<div class="meter ${meterClass}" style="margin:0.25rem 0"><div style="width:${fillPct}%"></div></div>`;
      const b = el('button', 'deck-add', '+ crew');
      b.dataset.post = postKey;
      b.disabled = disabled;
      row.appendChild(b);
      return row;
    }

    return {
      render(state) {
        const crew = state.crew || { total: 4, free: 4 };
        const chief = state.chief || { manned: true, maint: [], repair: { crew: 0, active: false, hull: 100 } };
        const canAdd = crew.free > 0;

        // Roster dots.
        const dots = Array.from({ length: crew.total }, (_, i) =>
          `<span class="crew-dot${i < crew.free ? ' free' : ''}"></span>`).join('');
        roster.innerHTML = `<span class="label">Crew</span> ${dots} <span class="label">${crew.free} free</span>`;

        // Automated note vs live posts.
        auto.textContent = chief.manned ? '' : 'Automated systems are maintaining the ship — a Crew Chief would do it better.';
        auto.style.display = chief.manned ? 'none' : '';
        posts.style.display = chief.manned ? '' : 'none';

        if (chief.manned) {
          posts.innerHTML = '';
          for (const p of chief.maint || []) {
            const worn = p.wear > 0.02;
            // The concrete cost of the drift: effective-power loss on this system,
            // shown in its own consumer (e.g. "-6% recharge") so it's actionable.
            const impact = Math.round(p.wear * WEAR_EFF_PENALTY * 100);
            const derate = `−${impact}% ${SYS_DERATE[p.system] || 'output'}`;
            const status = p.crew
              ? `${p.crew} on it · ${derate}`
              : (worn ? `drifting · ${derate}` : 'in trim');
            // wear serialized 0..0.6 (cap); show it as 0..100% of the cap.
            posts.appendChild(postRow('', SYS_NAME[p.system] || p.system, status,
              'warn', Math.round((p.wear / 0.6) * 100), 'maint:' + p.system, !canAdd || !worn));
          }
          const rep = chief.repair || { crew: 0, hull: 100 };
          const repStatus = rep.crew ? `${rep.crew} on it` : (rep.hull < 100 ? 'hull damaged' : 'hull full');
          posts.appendChild(postRow('', 'Hull Repair', repStatus, 'cool', rep.hull, 'repair', !canAdd || rep.hull >= 100));
        }

        // Emergencies (add-only; crew free themselves on resolve).
        const emg = state.emergencies || [];
        const sig = emg.map((e) => e.id + ':' + e.kind).join(',');
        if (list.dataset.sig !== sig) {
          list.dataset.sig = sig;
          list.innerHTML = '';
          if (emg.length === 0) list.appendChild(el('div', 'label', 'No active emergencies.'));
          for (const e of emg) {
            const card = el('div', 'emergency');
            card.dataset.id = e.id;
            card.innerHTML =
              `<div class="spread"><span class="emg-label">${e.label}</span><span class="emg-assigned"></span></div>` +
              `<div class="meter cool" style="margin:0.3rem 0"><div class="emg-bar"></div></div>`;
            const b = el('button', 'deck-add', '+ crew');
            b.dataset.post = String(e.id);
            card.appendChild(b);
            list.appendChild(card);
          }
        }
        for (const e of emg) {
          const card = list.querySelector(`.emergency[data-id="${e.id}"]`);
          if (!card) continue;
          card.querySelector('.emg-assigned').textContent = e.assigned ? `${e.assigned} on it` : (chief.manned ? 'unmanned!' : 'automated');
          card.querySelector('.emg-bar').style.width = `${Math.round((e.progress || 0) * 100)}%`;
          card.classList.toggle('unmanned', chief.manned && e.assigned === 0);
          const addBtn = card.querySelector('button[data-post]');
          if (addBtn) addBtn.disabled = !canAdd;
        }
      },
    };
  },
});
