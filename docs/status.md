# Project Status snaphot

This file should contain only the most recent status of the project -- usually the last major prompt with completed work.

## Most recent: main screen ported to Phaser 4 (2026-07-18)

The main-screen viewscreen was ported from raw Canvas 2D to a **Phaser 4 scene**
and, after a successful deployed playtest, the Canvas renderer was **retired** —
Phaser is now the sole renderer. Structure:

- `public/js/mainscreen.js` is the DOM/net shell (captain HUD, ship HUD + log,
  lobby/QR, debrief, music). The space view is `js/main-view/phaser-renderer.js`
  (a Phaser scene) reading a shared `js/main-view/{model,effects}.js` layer; the
  clean HUD chrome (reticle, banners) is a 2D overlay on top
  (`js/main-view/hud-overlay.js`).
- The scene uses **CC0 sprites** (Kenney: meteors, station, satellite, planets,
  particle textures) under `public/assets/space/` — **main-screen only**, loaded
  with `js/vendor/phaser.esm.min.js`. Provenance in `public/assets/CREDITS.md`.
- The scene renders at device pixel ratio (crisp text/sprites), with a camera
  Glow filter + vignette for the cinematic look, additive glow effects, an
  arrival dolly-to-station cinematic, and speed-reactive starfield trails.

Client-only change (main is a view-only seat) — no engine/transport/protocol
changes for the port itself. Deployed to Cloudflare.

Note: `CLAUDE.md`'s "zero-build static clients / no asset files" line now has a
main-screen carve-out (Phaser bundle + CC0 sprites); the audio stays procedural.
