// Shared boilerplate for mounting a Phaser scene as one widget inside an
// otherwise-DOM station page (see docs/design/06 — Phaser is a widget, not a
// page rewrite; the DOM shell in station.js keeps owning lobby/debrief/
// reconnect overlays). Keeps every station's mount code identical: capped
// frame rate and low-power GPU mode for phone battery life, transparent
// background so the station's existing panel styling shows through, and a
// pause when the tab is hidden so a backgrounded phone doesn't keep
// rendering.

import Phaser from '/js/vendor/phaser.esm.min.js';

// parentId: id of the DOM element to mount into.
// width/height: fixed logical scene size; Phaser.Scale.FIT scales it to the
//   parent element's CSS size (set via CSS, e.g. aspect-ratio + max-width).
// scene: a Phaser.Scene subclass (not an instance).
export function mountPhaser({ parentId, width, height, scene }) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: parentId,
    width,
    height,
    transparent: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    fps: { target: 30, forceSetTimeOut: true },
    powerPreference: 'low-power',
    banner: false,
    // Let vertical page scroll pass THROUGH the canvas: by default Phaser sets
    // touch-action:none and preventDefaults touch events, so a scroll that
    // begins on the scope froze the whole console. capture:false stops the
    // preventDefault; touch-action:pan-y (set on the canvas below) lets the
    // browser scroll vertically while horizontal taps still register as targets.
    input: { touch: { capture: false } },
    callbacks: {
      postBoot: (g) => { if (g.canvas) g.canvas.style.touchAction = 'pan-y'; },
    },
    scene,
  });

  // Stop rendering while the tab/app is backgrounded (battery + correctness:
  // a paused scene can't drift out of sync with a snapshot it isn't seeing).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.loop.sleep();
    else game.loop.wake();
  });

  return game;
}
