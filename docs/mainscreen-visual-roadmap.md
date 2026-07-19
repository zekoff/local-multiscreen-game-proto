# Main-screen visual roadmap

Graphical improvements for the Phaser viewscreen (`public/js/main-view/phaser-renderer.js`).
Respect the design pillars: **stylized, clean, cinematic — chrome/juice yes,
greebles/clutter no.** The Phaser 4 Filter system (`camera.filters.internal` →
`addGlow`, `addVignette`, `addBarrel`, `addBlur`, `addColorMatrix`,
`addDisplacement`, …) is the lever for most effects.

## Shipped

- **Bloom/Glow + vignette** camera filters; additive-blend effect layers.
- **Muzzle flash** at the cannon + **radial impact sparks** on a laser hit.
- **Localized shield-hit ripple** on the bow arc at the incoming contact's bearing.
- **Emergency-warp jump tunnel** (radial streaks into the white-out) + a brighter
  **tunnelled slipstream** with a central glow.
- **Lens/barrel distortion** filter, modulated up with speed + hull damage
  (a lens/chromatic feel).
- **Procedural per-mission backdrop** (seeded, stable, far-away proportions):
  distant **sun** with a flare cross, optional **ringed planet/moon**, **comets**
  with tails, far **capital ships** with running lights, **buoys** near a station.
- **Target-lock brackets**: animated rotating corner brackets on the acquired contact.
- **Per-mission color grading** (Europa cold blue, planet destinations warmer).
- **In-scene mission-intro title card** (name + destination) fading in/out at start.
- **Docking-sequence polish**: the station's lights power up during the arrival dolly.
- **Speed-reactive starfield** with ghostly trails; **debris-scour rumble**;
  **intensified ion storm**; device-pixel-ratio crisp text/sprites.
- **Performance**: contact-sprite pooling; capped backdrop object counts; dpr capped at 2.

## Remaining ideas

- **Effects**: throttle-reactive engine/thruster glow at the bow; explosion
  shockwave ring + a brief displacement pulse; drifting embers/smoke at low hull;
  volumetric god-rays / a proper lens flare on the sun.
- **Space objects**: a dedicated jump-gate/wormhole object for warp beats; larger,
  detailed freighters (beyond the current far-off hulls); ice shards.
- **HUD** (would live in `hud-overlay.js`): a top bearing/compass strip
  (gates/destination/threats by bearing); screen-edge threat arrows for off-screen
  rocks; a damage-direction indicator; an optional CRT/scanline viewscreen texture.
- **Other**: a subtle dynamic camera (slow push-in on high threat, idle sway);
  a texture atlas for the CC0 sprites; per-GPU quality tiers.
