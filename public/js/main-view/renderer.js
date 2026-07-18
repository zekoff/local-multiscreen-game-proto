// The space-view renderer interface. Two implementations satisfy it —
// canvas-renderer.js (the original Canvas 2D pipeline, the baseline) and
// phaser-renderer.js (the Phaser 4 port) — and the shell (mainscreen.js) drives
// whichever is selected through exactly these methods. Keeping the contract
// tiny is what lets the two be swapped live for an apples-to-apples comparison.
//
// A renderer is created by a factory `createXRenderer({ container, audio })`
// and returns an object with:
//
//   mount()      Start rendering into the container (begins the frame loop /
//                boots the scene). Idempotent-safe to call once after create.
//   resize()     Re-read the container size (also polled internally each frame).
//   destroy()    Stop the loop / tear down the scene and remove its canvas, so
//                the other renderer can take over the same container.
//
// Both renderers read the shared model.js (snapshot + interpolators + geometry)
// and effects.js (fx buffers + scalars) every frame — state flows in through
// those shared modules, NOT through per-frame arguments, so the shell only has
// to set model.setLatest(state) and call effects.consume(...) once per tick.
//
// This file is documentation only; there is nothing to import. It exists so the
// contract lives in one obvious place next to the implementations.

export {};
