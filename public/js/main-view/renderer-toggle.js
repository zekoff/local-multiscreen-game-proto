// A small corner button on the main screen to flip the space-view renderer live
// (Canvas 2D <-> Phaser) without editing the URL — the fastest way to compare
// the two back-to-back during a playtest. It only drives the switch; the shell
// owns the actual mount/destroy and URL update (see mainscreen.js).

const LABELS = { canvas: 'Renderer: Canvas ▸ Phaser', phaser: 'Renderer: Phaser ▸ Canvas' };

// onSwitch(nextKind) performs the swap and resolves when done; getKind() returns
// the currently-active renderer kind.
export function mountToggle({ container, getKind, onSwitch }) {
  const btn = document.createElement('button');
  btn.className = 'renderer-toggle';
  btn.type = 'button';
  const sync = () => { btn.textContent = LABELS[getKind()] || 'Renderer'; };
  sync();
  btn.addEventListener('click', async () => {
    const next = getKind() === 'phaser' ? 'canvas' : 'phaser';
    btn.disabled = true;
    try { await onSwitch(next); } finally { btn.disabled = false; sync(); }
  });
  container.appendChild(btn);
  return { sync, destroy() { btn.remove(); } };
}
