// Comms — a HELM widget, Officer mode only.
//
// A second, HUMAN channel for the identify step that Engineering's sensors
// otherwise own. Sensors DETECT a contact well before they IDENTIFY it; inside
// that gap the helm can hail a blip. A rescue pod's distress beacon answers and
// the contact is identified for the whole crew; anything else returns silence —
// informative, but ambiguous between rock, ore, and sensor ghost.
//
// So comms positively IDs pods only, which is exactly its value: the helm can
// call "hold fire, that's a pod" before the sensor ID resolves, making the
// don't-shoot invariant a cooperative act rather than a rule the console enforces.
// Opening a channel takes a few seconds and ties the transmitter up afterwards,
// so it competes with steering for the pilot's attention.

import { defineWidget, el } from '../widget.js';

export const comms = defineWidget({
  id: 'comms',
  label: 'Comms',
  hint: 'Hail an unidentified contact. A rescue pod answers; anything else stays silent.',
  mount({ root, net, audio }) {
    const status = el('div', 'comms-status');
    const list = el('div', 'comms-candidates');
    const reply = el('div', 'comms-reply');
    root.append(status, list, reply);

    list.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-id]');
      if (!btn || btn.disabled) return;
      net.action({ kind: 'hail', id: Number(btn.dataset.id) });
      audio && audio.tapTick && audio.tapTick();
    });

    return {
      render(state) {
        const c = state.comms || { hailing: null, progress: 0, cooldownIn: 0, last: null };
        const contacts = state.asteroids || [];
        const busy = c.hailing !== null;
        const cooling = !busy && c.cooldownIn > 0;

        if (busy) {
          const t = contacts.find((a) => a.id === c.hailing);
          const pct = Math.round((c.progress || 0) * 100);
          status.innerHTML = `<b style="color:var(--accent)">HAILING ${t ? t.label : 'contact'}…</b> ${pct}%`;
        } else if (cooling) {
          status.innerHTML = `<span style="color:var(--dim)">Transmitter cycling — ${Math.ceil(c.cooldownIn)}s</span>`;
        } else {
          status.innerHTML = '<span style="color:var(--dim)">Channel open. Select a contact to hail.</span>';
        }

        // The last reply stays up so the pilot can read it after the fact — a
        // silence is a result worth keeping on screen, not just a missing answer.
        if (c.last) {
          reply.innerHTML = c.last.answered
            ? `<b style="color:var(--good)">${c.last.label}: RESCUE POD</b> — survivors aboard. Call hold-fire.`
            : `<span style="color:var(--dim)">${c.last.label}: no response — nobody aboard.</span>`;
        } else {
          reply.textContent = '';
        }

        // Hailable: acquired, but sensors haven't classified it yet. That gap is
        // the entire window this widget works inside, so once a contact resolves
        // it simply leaves the list.
        const cands = contacts
          .filter((a) => a.targetable && !a.identified)
          .sort((a, b) => a.impactIn - b.impactIn);
        const ids = cands.map((a) => a.id).join(',') + `|${busy || cooling}`;
        if (list.dataset.ids !== ids) {
          list.dataset.ids = ids;
          list.innerHTML = '';
          if (cands.length === 0) {
            list.appendChild(el('div', 'label', 'No unidentified contacts.'));
          } else {
            for (const a of cands) {
              const b = el('button', 'target-btn');
              b.dataset.id = a.id;
              b.disabled = busy || cooling;
              b.innerHTML = `<span>? ${a.label}</span><span class="eta">${a.impactIn.toFixed(0)}s</span>`;
              list.appendChild(b);
            }
          }
        }
      },
    };
  },
});
