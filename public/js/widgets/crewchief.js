// Crew Chief console widgets: the tractor/cargo rig and the damage-control crew
// board. Built on the portable widget abstraction (widget.js) so they can be
// re-homed on another console later by moving them between layout arrays.

import { defineWidget, el } from '../widget.js';

const KIND_ICON = { pod: '🛟', mineral: '⛏', rock: '☄', ghost: '❓', unknown: '·' };

// --- Tractor beam: aim at a detected pod/mineral, latch, and reel it into the
// hold. Latching needs tractor power (Engineering) and the helm lined up on the
// contact — and blocks the laser while engaged (shared emitter). ---
export const tractorBeam = defineWidget({
  id: 'tractor-beam',
  label: 'Tractor Beam',
  hint: 'Latch a pod/salvage and hold the line — the laser is offline while latched.',
  mount({ root, net, intents, audio }) {
    const status = el('div', 'tractor-status');
    const reelWrap = el('div', 'meter cool');
    const reelFill = el('div');
    reelWrap.appendChild(reelFill);
    const list = el('div', 'tractor-candidates');
    const latchBtn = el('button', 'primary', 'Latch Beam');
    latchBtn.style.width = '100%';
    root.append(status, reelWrap, list, latchBtn);

    let latched = false;
    let selectedId = null;

    latchBtn.addEventListener('click', () => {
      if (latched) {
        net.action({ kind: 'tractorLatch', on: false });
        audio && audio.throttleSet && audio.throttleSet();
      } else {
        net.action({ kind: 'tractorLatch', on: true });
        audio && audio.warpEngage && audio.warpEngage();
      }
    });

    // Select a candidate to aim at (does not latch — a separate deliberate step).
    list.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-id]');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      net.action({ kind: 'tractorTarget', id });
      intents && intents.set('tractor-target', id, (s) => s.tractor && s.tractor.targetId === id);
      selectedId = id;
      paintSelection();
    });

    function paintSelection() {
      for (const b of list.querySelectorAll('button[data-id]')) {
        b.classList.toggle('selected', Number(b.dataset.id) === selectedId);
      }
    }

    return {
      render(state) {
        const t = state.tractor || { power: 0, latched: false, reel: 0, targetId: null, range: 9 };
        latched = t.latched;
        selectedId = intents && intents.get('tractor-target') !== undefined ? intents.get('tractor-target') : t.targetId;
        const powered = t.power >= 1;
        status.innerHTML = powered
          ? `Beam power <b style="color:var(--accent)">${t.power.toFixed(1)}</b> · range ${t.range}s`
          : `<b style="color:var(--bad)">NO TRACTOR POWER</b> — ask Engineering`;

        reelWrap.style.display = latched ? '' : 'none';
        reelFill.style.width = `${Math.round((t.reel || 0) * 100)}%`;

        // Candidate list: identified pods/minerals in range (state flags them).
        const cands = (state.asteroids || []).filter((a) => a.tractorable);
        if (latched) {
          list.innerHTML = '';
          const held = (state.asteroids || []).find((a) => a.id === t.targetId);
          const held2 = held ? `${KIND_ICON[held.kind] || '·'} ${held.label}` : 'contact';
          list.appendChild(el('div', 'label', `Reeling in ${held2} — HOLD THE LINE, HELM`));
          latchBtn.textContent = 'Release Beam';
          latchBtn.classList.remove('primary');
          latchBtn.classList.add('danger');
        } else {
          latchBtn.textContent = 'Latch Beam';
          latchBtn.classList.add('primary');
          latchBtn.classList.remove('danger');
          latchBtn.disabled = !powered || selectedId === null;
          // Rebuild candidate buttons.
          const ids = cands.map((c) => c.id).join(',');
          if (list.dataset.ids !== ids) {
            list.dataset.ids = ids;
            list.innerHTML = '';
            if (cands.length === 0) {
              list.appendChild(el('div', 'label', 'No pods or salvage in tractor range.'));
            } else {
              for (const c of cands) {
                const b = el('button', 'target-btn');
                b.dataset.id = c.id;
                b.innerHTML = `<span>${KIND_ICON[c.kind] || '·'} ${c.label}</span><span class="eta">${c.impactIn.toFixed(0)}s · m${c.mass}</span>`;
                list.appendChild(b);
              }
            }
          }
          paintSelection();
        }
      },
    };
  },
});

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
