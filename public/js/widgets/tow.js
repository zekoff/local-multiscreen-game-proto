// Tractor / tow control — a WEAPONS console widget managed alongside the laser.
// The gunner aims and latches it, engineering's WEAPONS power drives the reel,
// and it runs INDEPENDENTLY of the laser (tow and fire at the same time). Reel
// progress persists across releases (partial ring), and alignment is forgiving —
// the helm can swing within a wide arc, closer = faster. Built on the portable
// widget abstraction so it can be re-homed later.
//
// The beam has NO distance limit: it reaches as far as sensors do, so this list
// shows every ACQUIRED contact — an approach board, not a menu that pops into
// existence. Rows that can't be latched yet are shown disabled with the reason,
// and go live the moment sensors resolve them. That matters most under Cruise,
// where the CPU owns the scope and this is the gunner's main contact readout.

import { defineWidget, el } from '../widget.js';

const KIND_ICON = { pod: 'POD', mineral: 'ORE', rock: 'ROCK', ghost: '?', unknown: '·' };

// Why a contact can't be latched right now (null = it can). The engine enforces
// all of this too — this is just the console explaining itself.
function blockReason(c) {
  if (!c.identified) return 'unidentified';
  if (c.kind !== 'pod' && c.kind !== 'mineral') return 'not towable';
  return null;
}

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
        const t = state.tractor || { power: 0, latched: false, reel: 0, targetId: null, arc: 60, offset: 0 };
        latched = t.latched;
        selectedId = intents && intents.get('tractor-target') !== undefined ? intents.get('tractor-target') : t.targetId;
        const powered = t.power >= 1;
        // The ARC is the constraint the gunner actually manages now (with the
        // helm) — there's no range to read out, so show the bow offset instead.
        const arc = t.arc || 60;
        const inArc = selectedId !== null && (t.offset || 0) <= arc;
        status.innerHTML = powered
          ? `Beam power <b style="color:var(--accent)">${t.power.toFixed(1)}</b>` + (selectedId !== null
              ? ` · bow ${t.offset || 0}° / ${arc}° <b style="color:${inArc ? 'var(--good)' : 'var(--bad)'}">${inArc ? 'IN ARC' : 'OUT OF ARC'}</b>`
              : ' · unlimited reach')
          : `<b style="color:var(--bad)">NO BEAM POWER</b> — ask Engineering for WEAPONS power`;

        // Show the reel ring whenever there's progress (latched OR a held partial
        // pull) — it persists across releases now.
        const reel = t.reel || 0;
        reelWrap.style.display = (latched || reel > 0) ? '' : 'none';
        reelFill.style.width = `${Math.round(reel * 100)}%`;

        // Candidate list: EVERY acquired contact, nearest first. Latchable ones
        // are live; the rest sit disabled with their reason.
        const cands = (state.asteroids || [])
          .filter((a) => a.targetable)
          .sort((a, b) => a.impactIn - b.impactIn);
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
          // Only a latchable selection can arm the button.
          const selected = cands.find((c) => c.id === selectedId);
          latchBtn.disabled = !powered || !selected || blockReason(selected) !== null;
          // Rebuild candidate buttons. The key carries each row's BLOCKED state
          // as well as its id — otherwise a row that becomes latchable (sensors
          // just resolved it) would keep its stale disabled rendering.
          const ids = cands.map((c) => `${c.id}:${blockReason(c) || 'ok'}`).join(',');
          if (list.dataset.ids !== ids) {
            list.dataset.ids = ids;
            list.innerHTML = '';
            if (cands.length === 0) {
              list.appendChild(el('div', 'label', 'No contacts on sensors.'));
            } else {
              for (const c of cands) {
                const why = blockReason(c);
                const b = el('button', 'target-btn');
                b.dataset.id = c.id;
                b.disabled = why !== null;
                // Blocked rows read out WHY instead of the mass they'd tow.
                const right = why ? why : `m${c.mass}`;
                b.innerHTML = `<span>${KIND_ICON[c.kind] || '·'} ${c.label}</span><span class="eta">${c.impactIn.toFixed(0)}s · ${right}</span>`;
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
