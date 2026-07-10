# Code Architecture

How the prototype is put together. For *why* it's shaped this way, see the
design assessment in [`docs/design/`](design/00-overview.md) — this document
describes what is actually implemented.

> **2026-07-09 update:** the codebase now has two interchangeable transports
> over one shared engine: the original Node/Express/ws server (LAN mode, now
> `src/server-node.ts`, engine at `src/engine/game.ts`) and a Cloudflare
> Workers transport (`src/worker/`) with one Durable Object per room. The
> sections below describe the Node transport; the DO transport mirrors its
> behavior and wire protocol exactly (same messages, same seat rules, same
> abuse caps), with platform routing replacing the in-process room map — see
> [`cloud-migration.md`](cloud-migration.md) for the full design and the
> scaling rationale. File paths in prose below predate the restructure:
> read `src/game.ts` as `src/engine/game.ts` and `src/server.ts` as
> `src/server-node.ts`.

## Runtime topology

```
                ┌────────────────────────────────────────────┐
                │  Node.js server (src/server.ts)            │
                │                                            │
   HTTP ───────▶│  Express: static /public, room API, QR     │
                │                                            │
   WebSocket ──▶│  Room registry ── one Game per room        │
   (/ws)        │       │                                    │
                │       └─ tick every 250ms ──▶ broadcast    │
                └────────────────────────────────────────────┘
                        ▲                ▲               ▲
                   join/actions     join/actions    view-only
                        │                │               │
                  ┌───────────┐   ┌────────────┐   ┌───────────┐
                  │ phone:    │   │ phone:     │   │ TV/laptop:│
                  │ helm.html │   │ weapons…   │   │ mainscreen│
                  └───────────┘   └────────────┘   └───────────┘
```

One server process hosts everything: static client pages, a two-endpoint REST
API, and the realtime socket. All player devices are thin browser clients on
the same LAN. There is no client-side prediction, no P2P, and no build step
for the clients — every device renders whatever state the server last pushed.

## Authoritative state flow

The single most important invariant: **all game state lives in the server's
`Game` instance; clients are stateless renderers.**

1. A client sends a small **action** (`{type:'action', action:{kind:'fire'}}`).
2. The server validates it against the sender's seat and mutates `Game`.
3. A fixed 250ms tick (`TICK_MS`) advances the simulation (drift, asteroid
   countdowns, regen, spawns, breaker trips, end conditions).
4. After every tick the **full serialized state** is broadcast to every client
   in the room. State is small (~1–2 KB JSON), so there is no diffing — full
   snapshots keep clients trivially simple and make reconnection free: the
   next snapshot after rejoining is always complete.

Clients never compute game outcomes locally; they render the latest snapshot
and echo user input as actions. This is why a phone can lock, drop Wi-Fi,
rejoin, and be fully current one tick later.

## Server (`src/server.ts`)

- **Room registry** — `Map<code, Room>`; a `Room` is `{code, game, clients,
  interval}`. Rooms are created by `POST /api/rooms`, deleted after 10 minutes
  with no clients. Codes are 4 chars from an ambiguity-free alphabet (no
  0/O/1/I/L) for easy phone entry.
- **Join API** — `GET /api/room-info?code=` returns the LAN join URL (built
  from the first non-internal IPv4) and a QR code as a data URL (`qrcode`
  package). The main screen displays both in its lobby.
- **WebSocket protocol** (path `/ws`) — messages are JSON with a `type` field:
  - client → server: `join {room, seat, name, difficulty, playerId}`,
    `start`, `restart`, `action {action}`
  - server → client: `joined {seat, code, state}`, `state {state}`,
    `event {text}`, `error {message}`
- **Seat exclusivity** — crew seats (`helm`, `engineering`, `weapons`) allow
  one occupant; `main` is view-only and unlimited (TV + a laptop both work).
- **Heartbeat** — server pings every 30s and terminates unresponsive sockets
  so a dead phone's seat flips to auto-assist instead of hanging.
- **Time scaling** — `GAME_SPEED` multiplies the per-tick `dt`; the smoke test
  uses this to play a full mission in ~30 real seconds.

## Game engine (`src/game.ts`)

A single `Game` class per room, with no dependencies on the network layer
(the server injects an `onEvent` callback for broadcasting log lines). This
separation is what lets the smoke test and any future unit tests exercise
mission logic without a browser.

- **Phases** — `lobby → active → debrief → lobby`. `start()` resets all
  mission state; `restartToLobby()` keeps seats so the same crew can re-run.
- **Seats** — each crew seat tracks `{playerId, name, connected, difficulty}`.
  - *Reconnection:* seats are keyed by a sticky `playerId`. A disconnect marks
    the seat `connected: false` but keeps the reservation; the same `playerId`
    rejoining resumes it. A different player may claim a seat only while it is
    unoccupied or its holder is disconnected.
  - *Auto-assist:* any seat without a connected human is played by simple
    server-side logic each tick (helm holds 80% throttle and re-centers,
    engineering resets breakers after 6s, weapons keeps shields up and shoots
    the most urgent contact). This makes any subset of stations playable.
- **Actions** — validated per seat in `action(seat, a)`; a helm client cannot
  send engineering actions. Auto-assist uses the same internal code paths as
  human actions (e.g. `fire()`), so behavior is identical.
- **Interdependence** (the coordination engine): speed = throttle × effective
  engine power × course alignment; shield regen and weapon charge scale with
  their power allocation; engineering has 6 units across three systems (max 4
  each), and tripped breakers halve a system until reset. No station can
  succeed alone by design.
- **Difficulty** — per-seat `chill/normal/intense` multiplies that station's
  burden only: helm → drift rate, engineering → breaker trip rate, weapons →
  asteroid spawn rate. Chosen at join time; it's a parameter, not a separate
  code path.
- **Non-binary outcomes** — `finish()` composes a 0–100 score from hull (55%),
  time vs. par (25%), and defensive performance (20%), mapped to five narrative
  grades. A destroyed ship still scores partial credit from distance covered.
- **Serialization** — `serialize()` produces the complete client-facing
  snapshot with rounded floats. Anything a client renders must be here; adding
  a mechanic means extending both `tick()`/`action()` and `serialize()`.

## Clients (`public/`)

Plain HTML + ES modules, served statically, zero build step.

- **`js/net.js`** — `Net` class: WebSocket client with capped exponential
  backoff reconnection. Generates a sticky `playerId` in `sessionStorage`
  (per-tab, so one device can hold multiple seats in multiple tabs while a
  reload in a tab resumes its seat).
- **`js/station.js`** — `initStation({seat, render})`: shared shell for the
  three crew pages. Owns URL-param parsing, the connection dot, lobby and
  debrief overlays, event toasts, and launch/return buttons. Each station page
  supplies only its `render(state)` and its control wiring.
- **Station pages** (`helm.html`, `engineering.html`, `weapons.html`) —
  self-contained page + inline module each; controls send actions, `render`
  reflects the latest snapshot. One deliberate pattern: sliders track a
  local "dragging" flag so server echoes don't fight the player's finger.
- **`mainscreen.html` + `js/mainscreen.js`** — view-only seat. Canvas
  starfield (star speed tracks actual ship speed), asteroid blobs whose size
  reflects time-to-impact, the ship's log, HUD bars, lobby QR, and the full
  debrief stats grid.
- **`index.html`** — landing page for both flows: *host* (create room → become
  main screen) and *player* (code + name + difficulty → station page). The QR
  link lands here with `?room=` prefilled.

## Testing (`scripts/smoke.mjs`)

End-to-end regression: boots the real server with `GAME_SPEED=10`, connects a
bot crew over real WebSockets (all four seats), launches, and plays a
competent full mission. Asserts the debrief is reached with an `arrived`
outcome. This exercises the actual production code path — server boot, room
creation, joins, the full action vocabulary, and mission completion — in ~30s.

## Extension points

- **New mechanic on an existing station** — extend `action()` + `tick()` +
  `serialize()` in `game.ts`, then render/wire it in that station's page.
- **New station** — add the seat to `SeatId`/`CREW_SEATS`, give it actions and
  auto-assist in `game.ts`, copy a station page as a template, add a button on
  `index.html`.
- **Missions as data** — mission parameters (par time, spawn rates, tuning
  constants) are currently constants at the top of `game.ts`; the intended next
  step per the design docs is extracting them into data-driven mission
  definitions rather than multiplying hardcoded variants.
