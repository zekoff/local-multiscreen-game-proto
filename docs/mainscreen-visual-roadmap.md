# Main-screen visual roadmap (proposed)

A backlog of graphical improvements for the Phaser viewscreen
(`public/js/main-view/phaser-renderer.js`), for the owner to prioritize. Nothing
here is committed work — it's a menu. All of it should respect the design
pillars: **stylized, clean, cinematic — chrome/juice yes, greebles/clutter no.**
The Phaser 4 Filter system (`camera.filters.internal` → `addGlow`, `addVignette`,
`addBlur`, `addColorMatrix`, `addBarrel`, `addDisplacement`, …) already in the
bundle is the main lever for most of the "effects" items.

## Effects

- **Engine/thruster glow** at the bow (bottom-center) that brightens and
  lengthens with throttle — reinforces the new speed read.
- **Muzzle flash** at the laser origin + **impact sparks** where a shot lands
  (particle burst using the `spark`/`flame` textures).
- **Localized shield-hit ripple**: instead of a full-screen blue wash, a bright
  arc flares at the point on the bow shield where a hit is absorbed.
- **Explosion shockwave / heat-haze ring** — an expanding thin ring + a brief
  `addDisplacement` distortion pulse on the fireball.
- **Warp-tunnel** streak on Emergency Warp: a radial star-streak tunnel that
  collapses to a white flash (elevates the current flat white flash).
- **Low-hull embers/smoke** drifting up across the viewport as ambient dread
  below ~25% hull.
- **Chromatic aberration / lens distortion** (`addColorMatrix` + `addBarrel`) at
  very high speed or heavy damage — subtle, momentary.
- **God-rays / volumetric glow** from the destination star or station.

## Space objects

- **Distant sun** with a soft lens flare, parallaxing slower than the nebula.
- **Capital ships / freighters** on scripted lanes — larger, detailed vessels
  crossing far off (a step up from the current dot traffic and the docking
  shuttles).
- **Comets / ice shards** with tails (fits Europa's icy theme).
- **Ringed planet / moon** backdrop as an alternate parallax layer.
- **Jump-gate / wormhole** object for warp beats.
- **Buoys / patrol drones** with blinking lights near the station.

## HUD (kept clean — these live in the hud-overlay, not the scene)

- **Target-lock brackets** that animate/snap onto the acquired contact.
- **Bearing/compass strip** along the top edge: tick marks for the destination,
  next gate, and identified threats by bearing.
- **Screen-edge threat arrows** for off-screen inbound rocks (like today's
  off-screen objective chevron, but for hazards).
- **Damage-direction indicator**: a brief red arc on the edge the hit came from.
- **Optional CRT/scanline vignette** toggle for a "viewscreen" texture.
- **Animated range-to-destination ticker** that counts down on final approach.

## Other

- **Dynamic camera**: a slow push-in when threat is high, a gentle idle sway on
  quiet stretches (subtle — must not induce motion sickness).
- **Per-mission color grading** via `addColorMatrix` — Europa cold blue, others
  warmer — for instant mood.
- **In-scene mission-intro title card** (mission name + briefing) rendered over
  the starfield before the lobby hands off.
- **Docking-sequence polish**: the station's lights power up / a bay door opens
  as the arrival dolly completes.
- **Performance**: pack the CC0 sprites into a texture atlas; pool contact
  sprites instead of create/destroy per contact; cap the device-pixel-ratio and
  particle counts on low-end GPUs.
