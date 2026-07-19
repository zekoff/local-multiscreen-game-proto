# Project Status snaphot

This file should contain only the most recent status of the project -- usually the last major prompt with completed work.

## Most recent: consoles + main-screen polish pass (2026-07-18)

Building on the Phaser sole-renderer work, a large gameplay/visual/UX pass.

**Engine (`src/engine/`):**
- Rescue pods are announced **only at sensor-ID range** (removed the scripted
  pre-announce mission logs); sensor **ID band pulled in ~25%** (acquire band
  unchanged).
- Tractor beam is **independent of the laser** — tow AND fire at once (removed the
  fire() latch guard).
- Earlier in the pass: shield lower/raise doctrine fixes, CPU-helm priority
  (pods→salvage→rings→course), `mission.speedScale` serialized.

**Consoles (responsive, one-screen):** each `<main class="console">` fits a phone
with no scroll and, on a larger screen, grows the controls and reveals
**decorative-but-live chrome** (`public/js/deco.js`): rolling sparkline graphs of
real per-station data, sensible readouts, a **cross-console Bridge Status** from
real seat state, and a **tactical log** of the console's own toasts (via a new
`initStation` `onToast` hook) + ambient flavor. Functional and decorative widgets
are **interleaved** on large screens. Weapons: laser + tractor side by side,
tractor fills its cell, button differentiation (FIRE/STANDARD red, SNAPSHOT amber,
Latch teal). **Click-to-copy** on the room code + join link.

**Main screen (`phaser-renderer.js`):** procedural per-mission backdrop (sun,
ringed planet, comets, capital ships, buoys), target-lock brackets, muzzle flash +
impact sparks, warp jump-tunnel + improved slipstream, localized shield-hit ripple,
per-mission color grading, lens/barrel distortion, in-scene mission title card,
docking-lights polish, contact-sprite pooling. Star speed doubled at max, trails
trimmed. See `docs/mainscreen-visual-roadmap.md` for what's shipped vs remaining.

Missions: **Europa Salvage Loop (default), Shakedown Cruise, Free Flight** only.
Deployed to Cloudflare. `CLAUDE.md`'s "zero-build / no asset files" line carves out
the main screen (Phaser bundle + CC0 sprites); audio stays procedural.
