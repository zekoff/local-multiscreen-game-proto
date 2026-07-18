// Tractor / tow control — a WEAPONS console widget managed alongside the laser.
// The gunner aims and latches it, engineering's WEAPONS power drives the reel,
// and it runs INDEPENDENTLY of the laser (tow and fire at the same time). Reel
// progress persists across releases (partial ring), and alignment is forgiving —
// the helm can swing within a wide arc, closer = faster. Built on the portable
// widget abstraction so it can be re-homed later.

import { defineWidget, el } from '../widget.js';

const KIND_ICON = { pod: 'POD', mineral: 'ORE', rock: 'ROCK', ghost: '?', unknown: '·' };

export const towBeam = defineWidget({
  id: 'tow-beam',
  label: 'Tractor Beam',
  hint: 'Latch a pod/salvage and hold it in the arc. Runs independently — tow and fire at once.',
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
          : `<b style="color:var(--bad)">NO BEAM POWER</b> — ask Engineering for WEAPONS power`;

        // Show the reel ring whenever there's progress (latched OR a held partial
        // pull) — it persists across releases now.
        const reel = t.reel || 0;
        reelWrap.style.display = (latched || reel > 0) ? '' : 'none';
        reelFill.style.width = `${Math.round(reel * 100)}%`;

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
          latchBtn.textContent = reel > 0 ? 'Re-latch Beam' : 'Latch Beam';
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
