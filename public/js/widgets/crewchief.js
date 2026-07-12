// Crew Chief console widgets: the tractor/cargo rig and the damage-control crew
// board. Built on the portable widget abstraction (widget.js) so they can be
// re-homed on another console later by moving them between layout arrays.

import { defineWidget, el } from '../widget.js';

const KIND_ICON = { pod: '🛟', mineral: '⛏', rock: '☄', ghost: '❓', unknown: '·' };

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

// --- Damage-control crew board: assign a scarce roster of hands to shipboard
// emergencies. Pure allocation under scarcity (no twitch). ---
export const damageControl = defineWidget({
  id: 'damage-control',
  label: 'Damage Control',
  hint: 'Assign crew to fires, boarders, and breaches — unattended, they bleed the ship.',
  mount({ root, net }) {
    const roster = el('div', 'crew-roster');
    const list = el('div', 'emergency-list');
    root.append(roster, list);

    list.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-emg]');
      if (!btn) return;
      net.action({ kind: 'assignCrew', id: Number(btn.dataset.emg), delta: Number(btn.dataset.delta) });
    });

    return {
      render(state) {
        const crew = state.crew || { total: 4, free: 4 };
        const dots = Array.from({ length: crew.total }, (_, i) =>
          `<span class="crew-dot${i < crew.free ? ' free' : ''}"></span>`).join('');
        roster.innerHTML = `<span class="label">Crew</span> ${dots} <span class="label">${crew.free} free</span>`;

        const emg = state.emergencies || [];
        // Rebuild only when the set of emergencies changes; otherwise update in place.
        const sig = emg.map((e) => e.id).join(',');
        if (list.dataset.sig !== sig) {
          list.dataset.sig = sig;
          list.innerHTML = '';
          if (emg.length === 0) {
            list.appendChild(el('div', 'label', 'All stations nominal.'));
          }
          for (const e of emg) {
            const card = el('div', 'emergency');
            card.dataset.id = e.id;
            card.innerHTML = `
              <div class="spread"><span class="emg-label">${e.label}</span><span class="emg-assigned"></span></div>
              <div class="meter cool" style="margin:0.3rem 0"><div class="emg-bar"></div></div>
              <div class="row">
                <button data-emg="${e.id}" data-delta="-1" style="flex:0.4">−</button>
                <button data-emg="${e.id}" data-delta="1" style="flex:0.4">+ crew</button>
              </div>`;
            list.appendChild(card);
          }
        }
        for (const e of emg) {
          const card = list.querySelector(`.emergency[data-id="${e.id}"]`);
          if (!card) continue;
          card.querySelector('.emg-assigned').textContent = `${e.assigned} on it`;
          card.querySelector('.emg-bar').style.width = `${Math.round((e.progress || 0) * 100)}%`;
          card.classList.toggle('unmanned', e.assigned === 0);
        }
      },
    };
  },
});
