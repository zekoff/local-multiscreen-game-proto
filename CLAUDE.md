# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **At the start of a session, read `docs/status.md`** — it's the canonical
> "resume here" snapshot (what's built/deployed, what's open, current
> decisions). This file (`CLAUDE.md`) covers the stable how-the-repo-works
> facts; `status.md` covers the moving current state.

## Project

A co-located, multi-device cooperative spaceship bridge game. Each player crews
a station (Helm, Engineering, Weapons) from their own phone/tablet/laptop
browser; an optional main screen shows the shared viewscreen and join QR code;
a Commander plays with no device at all. Design rationale lives in
`docs/design/`, implementation architecture in `docs/architecture.md`.

## Commands

```bash
npm start          # LAN-mode Node server (port 3000, binds 0.0.0.0)
npm run dev        # LAN server with auto-reload (tsx watch)
npm run dev:cf     # cloud transport locally (wrangler dev, local workerd)
npm run deploy     # wrangler deploy to Cloudflare (needs CLOUDFLARE_API_TOKEN)
npm run typecheck  # both configs: Node (tsconfig.json) + Worker (tsconfig.worker.json)
npm run smoke      # bot crew plays a full mission vs the Node transport at 10x
npm run smoke:cf   # same bot crew vs wrangler dev (Workers transport)
npm run lab        # in-process balance sweep: missions x crew profiles x seeds
node --check public/js/<file>.js   # syntax-check client JS (no build step exists)
```

There is no unit-test runner yet; the smoke tests are the regression suite.
Run `npm run typecheck`, `npm run smoke`, and (if transport/worker code
changed) `npm run smoke:cf` before considering a change done.
Env knobs: `PORT`, `TICK_MS` (tick, default 250ms), `GAME_SPEED`
(simulated-time multiplier — how smoke tests run fast), `PUBLIC_URL`
(override for player-facing join URLs). Cloudflare auth comes from
`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` in the environment.

## Architecture (the short version)

Authoritative-server, thin-client, **two interchangeable transports over one
engine**. Full detail in `docs/architecture.md` (which folds in the dual-transport
cloud-migration design; the standalone migration doc was pruned).

- **All game state lives in a `Game` instance** (`src/engine/game.ts`);
  browser clients are stateless renderers. Clients send small `action`
  messages; the server ticks the simulation every 250ms and broadcasts the
  **complete** serialized state (no diffs) to every client in the room.
- `src/engine/` — the engine. Runtime-agnostic (engine-internal imports only,
  no network/transport/platform knowledge; transports inject an `onEvent`
  callback); it must stay that way so both transports share it. Phases:
  `lobby → active → debrief`. Seats reconnect via sticky `playerId`; unmanned
  seats run auto-assist through the same code paths as human actions.
- **Missions are data** (`src/engine/mission.ts`): the engine consumes a
  `MissionDef` — pacing ranges, scales, and scripted one-shot events. Mission
  length is `targetSeconds` (the well-executed run time); `pacingFor()` derives
  `speedScale`/`parTime` from it (calibrated via `SPEED_CALIB`).
  Authored missions live in `src/engine/missions/`; the seeded procedural
  generator is `mission-gen.ts`; transports resolve start requests through
  `mission-registry.ts`. Every run is reproducible from (missionId, seed).
  Authoring/testing guide: `docs/missions.md`.
- `src/server-node.ts` — LAN-mode transport: Express static hosting + room
  API (`POST /api/rooms`, `GET /api/room-info`) + WebSocket endpoint (`/ws`).
  One `Game` + tick interval per room; idle rooms don't tick.
- `src/worker/` — cloud transport (Cloudflare Workers): `index.ts` routes the
  same API and forwards `/ws?room=` upgrades to `room-object.ts`, a Durable
  Object per room (addressed `idFromName(code)`) owning that room's `Game`,
  sockets, and tick. **Same wire protocol as the Node transport** — protocol
  changes must land in both, or clients break on one of them.
- `public/` — zero-build static clients served by both transports.
  `js/net.js` (reconnecting WS client), `js/station.js` (shared shell +
  meter/grade helpers + `clickToCopy`/`onToast`). Crew consoles use a responsive
  `<main class="console">` grid (CSS in `css/style.css`) that fits a phone with no
  scroll and, on a larger screen, grows controls + reveals `.large-only`
  **decorative-but-live** chrome from `js/deco.js` (multi-line rolling data
  graphs — real console data drawn thick, `makeSignal()` synthetic flavor lines
  drawn thin — a cross-console Bridge Status, and a tactical log of captured
  toasts; graph panels are desktop-only and never shown on a phone). One HTML
  page per station, `mainscreen.html`/
  `js/mainscreen.js` (the DOM/net shell: captain HUD, ship HUD, lobby/debrief,
  music, + client-side QR from `js/vendor/qrcode-generator.mjs`). The **viewscreen
  itself is a Phaser 4 scene** (`js/main-view/phaser-renderer.js`: starfield,
  nebula, destination, gates, asteroids/pods/minerals, laser/explosion/warp
  effects, arrival cinematic) reading a shared model/effects layer
  (`js/main-view/model.js`, `effects.js`); the clean HUD chrome (reticle, banners)
  is a thin 2D overlay on top (`js/main-view/hud-overlay.js`). The scene uses
  **CC0 sprites under `public/assets/space/`** (main-screen only; see
  `public/assets/CREDITS.md`) — so the "asset-free" note below is about *audio*,
  not the main screen, which loads `js/vendor/phaser.esm.min.js`. `js/audio.js` is
  a procedural Web-Audio music+SFX module (no audio asset files) —
  **music plays on the main screen only**;
  SFX are routed per device (laser→weapons, sensor pings→engineering, gate
  chimes→helm, ship-wide booms→main screen) via the `js/fx-audio.js` helper.
  `js/weapons-scope.js` is the Canvas2D radar scope mounted via
  `js/canvas-station.js` (immediate-mode; Phaser is main-screen only). `supervisor.html` is the optional "Sim Supervisor"
  debug role and `js/debug-panel.js` its shared controls.
- Seats: crew (`helm`/`engineering`/`weapons`/`crewchief`) are exclusive; `main`
  and `supervisor` are view-only, non-exclusive (multiple allowed, no game seat
  reserved). **Crew Chief is currently frozen (WIP)** — disabled in the lobby
  (`public/index.html`), re-enabled with a `?debug` landing-page param; its page
  and engine paths stay intact. Debug actions (pause/speed/spawn/crew-skill) come
  only from `main`/`supervisor` and only when the run was launched with `debug`
  enabled — see `debugAction()` in `game.ts` and the `VIEW_SEATS` list in both
  transports.
- Log events carry an **audience** (`onEvent(text, to)` where `to` is `'crew'` or
  a crew seat): crew-wide notices show on the **main screen only**, console-scoped
  chatter shows on **that console only**. The `to` field is part of the wire
  protocol — keep both transports and `js/net.js`/`js/station.js` in sync.
- Rooms are fully independent by design — no cross-room state, ever. That
  invariant is what lets Durable Objects scale rooms horizontally.

## Rules that matter when extending

- Adding a mechanic means touching all three of: `action()` (input),
  `tick()` (simulation), and `serialize()` (client visibility) in
  `src/engine/game.ts` — clients can only render what `serialize()` exposes.
- One-shot events (laser fire, explosions, impacts, gate/warp/pulse/sensor
  contact) go through the transient `fx` stream: push an `Effect` during a tick;
  both transports include it in the broadcast and call `clearFx()` after. It
  drives the main-screen visual effects and the per-device procedural audio
  (each page consumes only its own `fx` kinds via `public/js/fx-audio.js`).
- Actions are validated per seat; never let one station's client mutate
  another station's controls.
- Per-role difficulty must stay a *parameter*, not a separate code path; that's a
  core design pillar (see `docs/design/02-architecture.md`). Concretely: every
  Cruise-vs-Officer difference lives in the **`ASSIST` table** at the top of
  `game.ts` and is read through `assist(seat)` at the touch points — there is no
  `if (difficulty === 'cruise')` anywhere in the engine, and new mode differences
  must be added as a **field on that table**, never as a branch. The resolved
  profile is serialized under `assist` so clients render the mode rather than
  re-deriving its rules (engineering reads `powerTotal`/`powerFloor`/
  `breakerPenalty`; helm reads `steerAssist`/`courseHold`/`driftTrim`/`comms`;
  weapons reads `autoScope`). Cruise is not "the same console, slower" — it hands
  the weapons scope to the CPU, locks a power pip per system on a bigger pool, and
  makes tripped breakers cost no function. The same parameter rule applies to
  mission tuning (MissionDef knobs) and, later, persistent-ship upgrades
  (see `docs/design/07-persistence.md`).
- The auto-assist bots ARE the regression suite. `autoShieldDoctrine()` /
  `autoGunner(cs, over)` / `autoTow()` are called in that order from `tick()`;
  re-ordering them or letting them read bot quality off `this.crewSkill` instead
  of their arguments silently moves the balance baseline that smoke and lab are
  pinned to. `autoGunner` is the one a *manned* Cruise weapons seat also runs.
- Mission outcomes are non-binary by design — don't collapse the debrief
  scoring to win/lose.
- The debrief record must stay self-contained (mission, seed, crew
  composition, stats, telemetry) — it is the future persistent career-history
  row (`docs/design/07-persistence.md`).
- Balance changes should be justified with `npm run lab` output; the current
  per-console load, interplay map, and known balance issues live in
  `docs/console-complexity-analysis.md`.
- Keep gameplay randomness on the seeded per-run RNG (`this.rng` in game.ts),
  never `Math.random` — reproducibility from (missionId, seed) is a feature.
- **Never gate UI state-sync on a boolean that one event must clear.** A control
  that suppresses its server-state sync while the player is touching it (sliders,
  hold buttons, drag handles) must use a **self-healing timestamp**, not a
  `dragging = true/false` flag. A `pointerup` can go missing — released off the
  element, cancelled touch, pointer stolen — and a latched flag then freezes the
  control's sync *permanently*: it displays a stale value while the server holds
  another, and because a range input dragged back to the value it already shows
  fires no `input` event, the control becomes uncommandable. This shipped once
  (helm throttle) and nearly shipped twice (`holdToSteer` would have nudged
  forever). Also stop held-repeat timers on `blur`/`visibilitychange`.
- Reconnection is a first-class requirement: any new client page must go
  through `Net`/`initStation` (or preserve their sticky-`playerId` behavior)
  so phones that drop Wi-Fi can resume their seat mid-mission.
- Clients are intentionally build-free ES modules; don't introduce a bundler
  for the prototype without a deliberate decision.
- **Console functions are portable widgets.** New console controls should be
  authored as self-contained widgets via `public/js/widget.js`
  (`defineWidget`/`mountWidgets`): each owns its DOM, render slice, event wiring,
  edge-state, and its own travelling label. A console page is a *layout list* of
  widgets. This is what lets console functions be re-arranged between stations
  later without re-architecting — a display widget moves for free (the server
  broadcasts full state to every seat), an action widget moves once its target
  seat is authorized for that action kind in `game.ts` `action()`. See
  `docs/architecture.md` (widget portability). Crew Chief (`crewchief.html`) is
  built entirely this way as the reference.
