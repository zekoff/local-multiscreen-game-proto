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
npm start          # run the server (port 3000, binds 0.0.0.0 for LAN play)
npm run dev        # server with auto-reload (tsx watch)
npm run typecheck  # tsc --noEmit over src/
npm run smoke      # end-to-end test: headless bot crew plays a full mission at 10x speed
node --check public/js/<file>.js   # syntax-check client JS (no build step exists)
```

There is no unit-test runner yet; `npm run smoke` is the regression test. Run
`npm run typecheck` and `npm run smoke` before considering a change done.
Env knobs: `PORT`, `TICK_MS` (server tick, default 250ms), `GAME_SPEED`
(simulated-time multiplier — how the smoke test runs fast).

## Architecture (the short version)

Authoritative-server, thin-client. Full detail in `docs/architecture.md`.

- **All game state lives in the server's `Game` instance** (`src/game.ts`);
  browser clients are stateless renderers. Clients send small `action`
  messages; the server ticks the simulation every 250ms and broadcasts the
  **complete** serialized state (no diffs) to every client in the room.
- `src/server.ts` — Express static hosting + room API (`POST /api/rooms`,
  `GET /api/room-info` for the QR/join URL) + the WebSocket endpoint (`/ws`).
  One `Game` + one tick interval per room.
- `src/game.ts` — game engine, deliberately network-free (server injects an
  `onEvent` callback). Phases: `lobby → active → debrief`. Seats reconnect via
  sticky `playerId`; unmanned seats run server-side auto-assist through the
  same code paths as human actions.
- `public/` — zero-build static clients. `js/net.js` (reconnecting WS client),
  `js/station.js` (shared shell: overlays, toasts, join wiring), one HTML page
  per station, `mainscreen.html`/`js/mainscreen.js` (canvas viewscreen).

## Rules that matter when extending

- Adding a mechanic means touching all three of: `action()` (input),
  `tick()` (simulation), and `serialize()` (client visibility) in
  `src/game.ts` — clients can only render what `serialize()` exposes.
- Actions are validated per seat; never let one station's client mutate
  another station's controls.
- Per-role difficulty must stay a *parameter* (multiplier), not a separate
  code path; that's a core design pillar (see `docs/design/02-architecture.md`).
- Mission outcomes are non-binary by design — don't collapse the debrief
  scoring to win/lose.
- Reconnection is a first-class requirement: any new client page must go
  through `Net`/`initStation` (or preserve their sticky-`playerId` behavior)
  so phones that drop Wi-Fi can resume their seat mid-mission.
- Clients are intentionally build-free ES modules; don't introduce a bundler
  for the prototype without a deliberate decision.
