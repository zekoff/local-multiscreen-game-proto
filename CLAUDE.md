# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
engine**. Full detail in `docs/architecture.md` and `docs/cloud-migration.md`.

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
  `MissionDef` — pacing ranges, scales, and scripted one-shot events.
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
  `js/net.js` (reconnecting WS client), `js/station.js` (shared shell), one
  HTML page per station, `mainscreen.html`/`js/mainscreen.js` (canvas
  viewscreen + client-side QR from `js/vendor/qrcode-generator.mjs`).
- Rooms are fully independent by design — no cross-room state, ever. That
  invariant is what lets Durable Objects scale rooms horizontally.

## Rules that matter when extending

- Adding a mechanic means touching all three of: `action()` (input),
  `tick()` (simulation), and `serialize()` (client visibility) in
  `src/game.ts` — clients can only render what `serialize()` exposes.
- Actions are validated per seat; never let one station's client mutate
  another station's controls.
- Per-role difficulty must stay a *parameter* (multiplier), not a separate
  code path; that's a core design pillar (see `docs/design/02-architecture.md`).
  The same rule applies to mission tuning (MissionDef knobs) and, later,
  persistent-ship upgrades (see `docs/design/07-persistence.md`).
- Mission outcomes are non-binary by design — don't collapse the debrief
  scoring to win/lose.
- The debrief record must stay self-contained (mission, seed, crew
  composition, stats, telemetry) — it is the future persistent career-history
  row (`docs/design/07-persistence.md`).
- Balance changes should be justified with `npm run lab` output; the current
  baseline and known issues live in `docs/design/08-mission-balance-baseline.md`.
- Keep gameplay randomness on the seeded per-run RNG (`this.rng` in game.ts),
  never `Math.random` — reproducibility from (missionId, seed) is a feature.
- Reconnection is a first-class requirement: any new client page must go
  through `Net`/`initStation` (or preserve their sticky-`playerId` behavior)
  so phones that drop Wi-Fi can resume their seat mid-mission.
- Clients are intentionally build-free ES modules; don't introduce a bundler
  for the prototype without a deliberate decision.
