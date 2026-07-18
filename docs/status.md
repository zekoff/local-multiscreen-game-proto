# Project Status snaphot

This file should contain only the most recent status of the project -- usually the last major prompt with completed work.

## Most recent: Phaser sole renderer + gameplay/visual pass (2026-07-18)

The main-screen viewscreen is a **Phaser 4 scene** and the Canvas 2D renderer has
been **retired** (Phaser is the only renderer). Committed to `main`.

**Rendering (`public/js/main-view/`):** `mainscreen.js` is the DOM/net shell;
the space view is `phaser-renderer.js` reading a shared `model.js` / `effects.js`
layer; clean HUD chrome (reticle, banners) is a 2D overlay (`hud-overlay.js`).
The scene renders at **device pixel ratio** (crisp text/sprites on hi-dpi), uses
**CC0 sprites** under `public/assets/space/` (main-screen only; `CREDITS.md`),
and has a camera Glow filter + vignette. Recent additions: arrival dolly-to-
station cinematic (fade to black under the debrief), speed-reactive starfield
with ghostly trails (stationary at throttle 0, ~3× at max), pod silhouette that
only turns green "RESCUE POD" once sensor-identified, tiny→large station growth,
docking traffic for station missions, intensified ion storm, wider asteroid size
spread, steady debris-scour rumble, shield arc gone at 0%.

**Engine (`src/engine/game.ts`):** shields lower immediately at 0% (human & auto)
and the auto doctrine drops them after a short linger whenever no live volley
(fixing "shields never lower while a field keeps spawning"), auto-raise gated
≥40% (human raise unrestricted). CPU helm priority: pods → salvage → rings →
course. `serialize().mission` gained `speedScale` for the starfield.

**Missions:** the selectable set is now just **Europa Salvage Loop (default),
Shakedown Cruise, Free Flight**; the other authored missions + gen presets were
removed. Smoke tests run `gen:europa` (both transports arrive, score 58,
deterministic). Lab sweeps the 3-mission catalog clean.

**Misc:** `public/favicon.svg` added + linked on all pages. A proposed backlog of
further graphical work lives in `docs/mainscreen-visual-roadmap.md`.

Note: `CLAUDE.md`'s "zero-build / no asset files" line now carves out the main
screen (Phaser bundle + CC0 sprites); audio stays procedural. Not yet deployed
this pass — deploy on the owner's word.
