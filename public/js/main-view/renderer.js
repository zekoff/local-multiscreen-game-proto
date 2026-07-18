// The space-view renderer mount contract, satisfied by phaser-renderer.js (the
// Phaser 4 scene). The shell (mainscreen.js) drives it through exactly these
// methods. (A Canvas 2D implementation existed during the port as a baseline for
// an apples-to-apples comparison; the Phaser renderer won and the canvas one was
// retired — the tiny contract is what made the swap clean.)
//
// A renderer is created by `createPhaserRenderer({ container, audio })` and
// returns an object with:
//
//   mount()      Boot the scene into the container. Called once after create.
//   resize()     Re-read the container size (also handled internally).
//   destroy()    Tear down the scene and remove its canvas.
//
// The renderer reads the shared model.js (snapshot + interpolators + geometry)
// and effects.js (fx buffers + scalars) every frame — state flows in through
// those shared modules, NOT through per-frame arguments, so the shell only has
// to set model.setLatest(state) and call effects.consume(...) once per tick.
//
// This file is documentation only; there is nothing to import.

export {};
