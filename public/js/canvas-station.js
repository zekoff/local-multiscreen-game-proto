// Shared boilerplate for mounting an immediate-mode Canvas2D instrument as one
// widget inside an otherwise-DOM station page. This replaces the Phaser mount
// helper for station instruments: the weapons scope draws arcs, dots, and short
// labels, which is Canvas2D work — pulling in a 1.4 MB game engine to do it cost
// every phone on the crew a large download for nothing. (The MAIN SCREEN still
// uses Phaser for the viewscreen, where the sprite/effect machinery earns it.)
//
// Every responsibility below was a real fix in the Phaser mount it replaces —
// none of them are optional:
//
//   - DPR-correct backing store. The canvas is sized to its CSS box times the
//     device pixel ratio and the context is pre-scaled, so all drawing code
//     works in CSS pixels and text renders sharp. (Phaser drew at a fixed
//     logical size and upscaled, which softened labels badly enough that the
//     old scope oversampled its text textures to compensate.)
//   - ResizeObserver. Phaser's Scale.FIT handled resize for free; Canvas2D does
//     not. This matters concretely here: switching a console into Cruise changes
//     its CSS grid, resizing the instrument panel live.
//   - Frame-rate cap + pause while the tab is hidden. Phone battery, and a
//     paused instrument can't drift out of sync with a snapshot it isn't seeing.
//   - touch-action: pan-y. Lets vertical page scroll pass THROUGH the canvas:
//     without it a scroll that begins on the instrument freezes the console,
//     while horizontal taps still register as input.

const TARGET_FPS = 30;

// el: the element to mount into (the canvas fills it).
// draw(ctx, width, height, dt): called each frame; width/height are CSS pixels.
// onTap(x, y): pointer press in CSS pixels relative to the canvas (optional).
// Returns { destroy() }.
export function mountCanvas2D(el, { draw, onTap }) {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'pan-y'; // see note above — page scroll must pass through
  el.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let width = 0, height = 0;

  // Match the backing store to the CSS box × DPR, then scale the context so all
  // drawing happens in CSS pixel coordinates.
  function resize() {
    const rect = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  const ro = new ResizeObserver(resize);
  ro.observe(el);

  const tap = (e) => {
    if (!onTap) return;
    const rect = canvas.getBoundingClientRect();
    onTap(e.clientX - rect.left, e.clientY - rect.top);
  };
  canvas.addEventListener('pointerdown', tap);

  // rAF loop, capped: rAF runs at display rate (often 60-120Hz), which is wasted
  // work for an instrument fed by a 250ms server tick.
  let raf = 0, last = performance.now(), acc = 0, running = true;
  const frame = (now) => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = now - last;
    last = now;
    acc += dt;
    const interval = 1000 / TARGET_FPS;
    if (acc < interval) return;
    acc = 0;
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height, dt);
  };
  raf = requestAnimationFrame(frame);

  const onVisibility = () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
    } else if (!running) {
      running = true;
      last = performance.now(); // don't hand the first waking frame a huge dt
      acc = 0;
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointerdown', tap);
      canvas.remove();
    },
  };
}
