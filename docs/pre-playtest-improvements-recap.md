# Pre-Playtest Improvements — Change Recap

Date: 2026-07-10. Scope: the usability fixes (#1–5) from
`docs/playtest-visual-notes.md`, the main-screen vision work (#6), and the new
audio + gameplay mechanics requested for playtest readiness. Nothing here is
committed or deployed yet — this is for review.

**Status: all green.** `npm run typecheck`, `npm run smoke` (Node),
`npm run smoke:cf` (Workers), and `npm run lab` all pass. Every page loads with
zero console/page errors. Verified by driving real headless-browser sessions
(screenshots captured).

---

## 1. Usability fixes (client-only, no engine changes)

1. **Toasts no longer bury content.** Moved to the top-right corner (out of the
   center column), capped at 3 (oldest drops), and **suppressed entirely while
   a lobby/debrief overlay is up** — the end-of-mission event burst can't cover
   the debrief anymore. (`station.js`, `style.css`)
2. **Semantic meter colors.** Hull/shields/charge are now colored by value
   (green ≥60, amber ≥30, red <30; charge is blue while charging, green when
   ready) via a shared `setHealthBar`/`setChargeBar` — so the same reading is
   the same color on every station, instead of each station's accent (shields
   were red on weapons, orange on engineering, green on main). (`station.js`,
   all station pages)
3. **Debrief grade colored by score.** A near-failure now reads red, a strong
   run green — previously every grade used the positive accent color.
   (`station.js` — confirmed: "Barely Survived — 10/100" renders red.)
4. **Main-screen HUD log no longer clips** below the viewport (bounded HUD
   height + `min-height:0` flex fix; log scrolls in place). (`style.css`)
5. **Healthy breakers aren't styled as danger.** OK breakers are neutral;
   red + a pulse is reserved for a tripped breaker. (`engineering.html`,
   `style.css`)

## 2. New gameplay mechanics (engine)

All in `src/engine/game.ts`; missions stay data-driven.

- **Laser cooldown.** The phaser now recharges 4s between shots
  (`fireReadyIn` in state; weapons UI shows "RECHARGING (Ns)"). This creates
  windows where an inbound rock *can't* be shot down and must be tanked.
- **Shields are a managed resource.** They now **recharge only while lowered**
  and **bleed while raised**. You raise them around a threat (especially while
  the phaser is cooling down) and lower them to recharge and go faster —
  instead of the old set-once-and-forget toggle. Cap/rates tuned so a burst can
  wear them through to the hull.
- **Fly-through nav gates.** Periodic gates the helm lines up on. Passing needs
  `|alignment|` within a window; the helm gets a live "pass window" band on its
  alignment track and a gate readout ("lined up ✓ / steer to center").
- **Engine-power risk/reward coupling (as requested).** The gate pass window
  **widens with engine power** (more thrust authority → easier to aim), *but*
  running the engines hot makes **asteroids close faster** (less time to shoot
  them → more hits). Verified in isolation: at a fixed off-center line, engines
  1→4 flips gate passing from **0% → 100%**, while asteroid impacts rise
  **0.3 → 2.1** per run. Both halves hold.
- **Debrief now scores navigation** (fraction of gates flown clean) and reports
  "Nav gates cleared N/M". Score weights rebalanced to
  `0.5·hull + 20·time + 15·defense + 15·nav` (was `0.55·hull + 25·time +
  20·defense`).
- **Transient effects stream (`fx`).** The engine emits one-shot
  laser/explosion/impact/gate effects each tick, delivered in that tick's
  broadcast and cleared by the transport (`clearFx()` in both Node and Worker).
  Drives all the visuals and audio below. Bounded so the in-process lab can't
  accumulate it.

Bot policies (`scripts/lib/policies.mjs`) updated so a skilled crew actively
manages shields and respects the cooldown — the smoke test still arrives.

## 3. Main-screen viewscreen overhaul

`public/js/mainscreen.js` (rewritten render loop), `mainscreen.html`,
`style.css`.

- **Approaching destination.** A themed body grows on the horizon as progress
  climbs — a rendered **space station** for Supply Run (Station Epsilon), via a
  new optional `destination` field on the mission data (focused on one mission
  for now; others get a simple marker). Grows quadratically so it reads as
  "far, then rushing up on arrival."
- **Course yaw.** The whole scene (starfield + destination + gates) banks with
  the helm's `alignment` — a positive drift swings the view as if the nose is
  yawing to correct — against a **fixed forward reticle**, so "centered under
  the crosshair" reads as on-course. Starfield vanishing point moves with it.
- **Captain's tactical HUD.** A top-left overlay showing per-station status
  (HELM course/throttle, ENG power split + tripped breakers in red, WEP
  shields/charge/cooldown) so a screen-less commander can see, e.g., "weapons
  is tripped — engineering, pump it." Confirmed showing red alerts live.
- **Screen shake** on asteroid impact (heavier for hull hits than shield
  absorbs).
- **Laser strike + explosion + miss.** Every shot draws a beam from the ship;
  a hit pops an explosion (fireball + debris sparks), a miss sails wide with a
  puff.
- **Nav gates** render as rings that grow toward the viewer as they close (you
  fly *through* them), with a pass/miss screen flash.
- Aesthetic polish: asteroid glow, station beacon blink, gate chevrons.

## 4. Audio (procedural, no asset files)

New `public/js/audio.js` — everything synthesized with Web Audio (keeps the
zero-build/no-CDN client). Starts on first user gesture (browser autoplay
policy).

- **Music bed (main screen):** an ambient drone that **builds with mission
  progress** — the filter opens, a bass pulse enters, and percussion grows from
  a soft kick to a full kick/snare/hat groove as the run goes on.
- **Ship-wide SFX (main screen):** asteroid explosions, hull/shield impacts,
  laser fire, gate pass/miss chimes.
- **Console-local SFX:** engineering hears its own **breakers trip/reset**;
  weapons hears its **shields raise/lower**.
- Hardened to fail silently if a platform blocks Web Audio — it can never
  disrupt rendering or gameplay.

## Balance snapshot (`npm run lab`, 10 seeds/cell)

Healthy skill gradient after the changes: **skilled 82–88, novice 72–82,
auto 69–78** avg score across all missions; no stalls. Auto crews now take more
impacts on the harder missions (shields/cooldown bite). Arrival is still 100%
everywhere — that's the **pre-existing, explicitly-parked** balance gap from
`docs/design/08`, not a regression from this work; the new mechanics are the
levers to close it later if you want to.

## Known limitations / for your review

- **Audio was not heard, only code-verified.** Headless Chromium has no audio
  output; I confirmed the pages throw no errors and that Web Audio primitives
  run, but the **actual mix/feel needs a listen on a real device** — please
  sanity-check levels and taste.
- **Balance of the new mechanics is first-pass.** Cooldown (4s), shield
  drain/regen rates, gate window/frequency, and `SPEED_RISK` are all tunable
  constants near the top of `game.ts`; I tuned for "skilled arrives, auto
  struggles more" but haven't done a full sweep-driven pass.
- **Score reweighting shifts the debrief baseline** in `docs/design/08` — worth
  a refresh there if you keep these weights.
- Not committed, not deployed. Two temp files remain untracked and intended to
  keep: `docs/playtest-visual-notes.md`, `docs/pre-playtest-improvements-recap.md`.

## Files touched

Engine: `game.ts`, `mission.ts`, `missions/supply-run.ts`. Transports:
`server-node.ts`, `worker/room-object.ts`. Bots: `scripts/lib/policies.mjs`.
Client: `mainscreen.html/.js`, `helm.html`, `weapons.html`, `engineering.html`,
`station.js`, `css/style.css`, new `js/audio.js`.
