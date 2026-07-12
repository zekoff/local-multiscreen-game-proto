// Portable DISPLAY widgets — pure state-in, no actions, so they run on ANY
// console with zero server change (the portability proof for the widget
// abstraction). Built on the shared meter helpers from station.js.

import { defineWidget, el } from '../widget.js';
import { setHealthBar, setChargeBar } from '../station.js';

const SYS_LABEL = { engines: 'ENG', shields: 'SHLD', weapons: 'WPN', sensors: 'SEN' };

// Ship vitals: hull / shields / laser charge as three semantic meters. This is
// the classic per-page vitals strip lifted into a portable unit — it originally
// lived hand-wired in each station's render(); now it travels as one widget.
export const shipVitals = defineWidget({
  id: 'ship-vitals',
  label: 'Ship Status',
  mount({ root }) {
    const rows = {};
    for (const [key, name] of [['hull', 'HULL'], ['shields', 'SHIELDS'], ['charge', 'LASER']]) {
      const wrap = el('div', 'vital-row');
      wrap.appendChild(el('span', 'label', name));
      const meter = el('div', 'meter');
      const fill = el('div');
      meter.appendChild(fill);
      wrap.appendChild(meter);
      root.appendChild(wrap);
      rows[key] = meter;
    }
    return {
      render(state) {
        setHealthBar(rows.hull, state.hull ?? 0);
        setHealthBar(rows.shields, state.shields ? state.shields.strength : 0);
        setChargeBar(rows.charge, state.charge ?? 0, (state.charge ?? 0) >= 100);
      },
    };
  },
});

// Power allocation readout: per-system pip counts, hollow when the breaker is
// tripped (mirrors engineering's own styling so the chief can read the grid at
// a glance without touching it).
export const powerStatus = defineWidget({
  id: 'power-status',
  label: 'Power Grid',
  hint: 'Engineering allocates — shown here for coordination.',
  mount({ root }) {
    const rows = {};
    for (const sys of ['engines', 'shields', 'weapons', 'sensors']) {
      const line = el('div', 'spread power-line');
      line.appendChild(el('span', 'label', SYS_LABEL[sys]));
      const val = el('span', 'readout');
      val.style.fontSize = '1.05rem';
      line.appendChild(val);
      root.appendChild(line);
      rows[sys] = val;
    }
    return {
      render(state) {
        const power = state.power || {};
        const breakers = state.breakers || {};
        for (const sys of Object.keys(rows)) {
          const n = power[sys] ?? 0;
          rows[sys].textContent = breakers[sys] ? `${n}⚠` : String(n);
          rows[sys].style.color = breakers[sys] ? 'var(--bad)' : 'var(--accent)';
        }
      },
    };
  },
});
