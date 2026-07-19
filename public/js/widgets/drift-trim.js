// Drift Trim — a HELM widget, Officer mode only.
//
// The Officer counterpart to Cruise's Course Hold. The course carries a slow
// hidden bias that stands for 18-30s at a stretch; setting the trim against it
// cancels the bias, and the ship holds course hands-off until the bias next
// re-rolls. Course Hold grants that centering for free — this makes the pilot
// find it, which is the whole difference between the two modes here.
//
// The server never reports the signed bias, only a coarse residual bucket
// (trimmed / light / heavy), so the pilot hunts for the setting and can only see
// how close they are. Direction they infer from which way the ship is sliding.

import { defineWidget, el } from '../widget.js';

// How each residual bucket reads on the console.
const BUCKET = {
  trimmed: { text: 'TRIMMED', color: 'var(--good)', hint: 'Course is holding — the bias is cancelled.' },
  light: { text: 'LIGHT DRIFT', color: 'var(--warn)', hint: 'Close. One more notch should settle it.' },
  heavy: { text: 'HEAVY DRIFT', color: 'var(--bad)', hint: 'Ship is pulling — trim against the slide.' },
};

export const driftTrim = defineWidget({
  id: 'drift-trim',
  label: 'Drift Trim',
  hint: 'Trim against the pull until the residual reads TRIMMED. Re-trim when the course wanders again.',
  mount({ root, net, intents, audio }) {
    const readout = el('div', 'trim-readout');
    const scale = el('div', 'trim-scale');
    const fill = el('div', 'trim-fill');
    scale.appendChild(fill);
    const controls = el('div', 'row');
    const portBtn = el('button', '', '← Trim Port');
    const stbdBtn = el('button', '', 'Trim Stbd →');
    const centreBtn = el('button', 'trim-centre', 'Centre');
    controls.append(portBtn, stbdBtn);
    const status = el('div', 'label trim-status');
    root.append(readout, scale, controls, centreBtn, status);

    let value = 0;   // commanded notches
    let range = 12;  // notches either side, from the server

    // Send a new trim setting. Optimistic so the readout moves under the thumb
    // rather than waiting a tick — the server echoes the clamped value back.
    function setTrim(next) {
      const want = Math.max(-range, Math.min(range, next));
      if (want === value) return;
      value = want;
      net.action({ kind: 'trim', value: want });
      intents && intents.set('trim', want, (s) => s.trim && s.trim.value === want);
      audio && audio.nudgeTick && audio.nudgeTick();
      paint();
    }

    portBtn.addEventListener('click', () => setTrim(value - 1));
    stbdBtn.addEventListener('click', () => setTrim(value + 1));
    centreBtn.addEventListener('click', () => setTrim(0));

    let bucket = 'trimmed';
    function paint() {
      const b = BUCKET[bucket] || BUCKET.trimmed;
      readout.innerHTML = `<b style="color:${b.color}">${b.text}</b>`;
      status.textContent = b.hint;
      // The bar runs from -range to +range with centre at 50%; the fill grows
      // out from centre toward the trimmed side, so the setting reads at a glance.
      const pct = (value / range) * 50;
      fill.style.left = `${50 + Math.min(0, pct)}%`;
      fill.style.width = `${Math.abs(pct)}%`;
      fill.style.background = b.color;
      centreBtn.disabled = value === 0;
    }
    paint();

    return {
      render(state) {
        const t = state.trim || { value: 0, range: 12, residual: 'trimmed' };
        range = t.range || 12;
        // Prefer the optimistic value until the server echoes it back.
        const shown = intents && intents.get('trim') !== undefined ? intents.get('trim') : t.value;
        value = shown;
        bucket = t.residual || 'trimmed';
        paint();
      },
    };
  },
});
