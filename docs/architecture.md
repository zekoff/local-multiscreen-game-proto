# Code Architecture

How the prototype is put together. For *why* it's shaped this way, see the
design assessment in [`docs/design/`](design/00-overview.md) — this document
describes what is actually implemented.

The codebase is **one runtime-agnostic engine behind two interchangeable
transports**: a Node/Express/ws server for LAN mode, and a Cloudflare
Workers transport (one Durable Object per room) for the cloud deployment.
Both speak the identical wire protocol and share every line of game and
mission logic; only the transport layer forks. See
[`cloud-migration.md`](cloud-migration.md) for the full migration design and
scaling rationale.

## Runtime topology

```
                         ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐
                            src/engine/game.ts + mission*.ts
                         │  (runtime-agnostic; zero imports)  │
                         └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘
                              ▲                          ▲
                    consumed by                consumed by
                              │                          │
        ┌─────────────────────────────┐   ┌─────────────────────────────────┐
        │ Node transport (LAN mode)   │   │ Cloudflare Workers transport    │
        │ src/server-node.ts          │   │ src/worker/index.ts (router)    │
        │ Express: static, room API,  │   │  + src/worker/room-object.ts    │
        │ ws room registry, one Game  │   │ One Durable Object per room     │
        │ + tick interval per room    │   │ (idFromName(code)) owns the     │
        │                             │   │ Game, sockets, and tick         │
        └─────────────────────────────┘   └─────────────────────────────────┘
                        ▲                                  ▲
                        └────────── same wire protocol ────┘
                                          │
                        ┌─────────────┬──┴──────────┬──────────────┐
                        ▼             ▼              ▼              ▼
                  phone: helm   phone: eng.    phone: weapons  TV/laptop:
                    .html         .html            .html       mainscreen
```

All player devices are thin browser clients — LAN or cloud. There is no
client-side prediction, no P2P, and no build step for the clients; every
device renders whatever state the server (either transport) last pushed.

## Authoritative state flow

The single most important invariant: **all game state lives in one `Game`
instance per room; clients are stateless renderers.**

1. A client sends a small **action** (`{type:'action', action:{kind:'fire'}}`).
2. The transport validates it against the sender's seat and mutates `Game`.
3. A fixed 250ms tick (`TICK_MS`, `GAME_SPEED` multiplies `dt` for fast test
   runs) advances the simulation (drift, asteroid countdowns, regen, spawns,
   breaker trips, scripted mission events, end conditions).
4. After every tick the **full serialized state** is broadcast to every
   client in the room. State is small (~1–2 KB JSON), so there is no
   diffing — full snapshots keep clients trivially simple and make
   reconnection free: the next snapshot after rejoining is always complete.

Clients never compute game outcomes locally; they render the latest snapshot
and echo user input as actions. This is why a phone can lock, drop Wi-Fi,
rejoin, and be fully current one tick later, on either transport.

## Game engine (`src/engine/game.ts`)

A single `Game` class per room, with **no dependencies on the network layer
or runtime** — no Node APIs, no Workers APIs, `onEvent` is an injected
callback for broadcasting log lines. This separation is what lets both
transports share it unmodified and lets the smoke tests exercise mission
logic without a browser.

- **Phases** — `lobby → active → debrief → lobby`. `start(missionDef, seed)`
  resets all mission state; `restartToLobby()` keeps seats so the same crew
  can re-run.
- **Seats** — each crew seat tracks `{playerId, name, connected, difficulty}`.
  - *Reconnection:* seats are keyed by a sticky `playerId`. A disconnect marks
    the seat `connected: false` but keeps the reservation; the same `playerId`
    rejoining resumes it. A different player may claim a seat only while it is
    unoccupied or its holder is disconnected.
  - *Auto-assist:* any seat without a connected human is played by simple
    engine-internal logic each tick (helm holds 80% throttle and re-centers;
    engineering resets breakers after 6s; weapons raises shields and engages
    contacts inside its reaction range with a chance to miss — deliberately
    mediocre, not optimal, so a crewed seat is always meaningfully better).
    This makes any subset of stations playable.
- **Actions** — validated per seat in `action(seat, a)`; a helm client cannot
  send engineering actions. Auto-assist uses the same internal code paths as
  human actions (e.g. `fire()`), so behavior is identical.
- **Interdependence** (the coordination engine): speed = throttle × effective
  engine power × course alignment (further reduced while shields are raised —
  a real power-triage tradeoff); shield regen and weapon charge scale with
  their power allocation; engineering has 6 units across three systems (max 4
  each), and tripped breakers halve a system until reset. No station can
  succeed alone by design.
- **Difficulty** — per-seat `chill/normal/intense` multiplies that station's
  burden only: helm → drift rate, engineering → breaker trip rate, weapons →
  asteroid spawn rate. Chosen at join time; it's a parameter, not a separate
  code path. The same "parameter, not code path" rule applies to mission
  tuning (below).
- **Non-binary outcomes** — `finish()` composes a 0–100 score from hull (55%),
  time vs. par (25%), and defensive performance (20%), mapped to five
  narrative grades. A destroyed ship still scores partial credit from
  distance covered. The debrief is self-contained (mission, seed, crew
  composition, stats, telemetry) — see `Debrief`/`Telemetry` in `game.ts`.
- **Serialization** — `serialize()` produces the complete client-facing
  snapshot with rounded floats (including percentage-normalized display
  values, e.g. shield strength is tracked internally in absolute points but
  serialized as a 0–100 % of its cap). Anything a client renders must be
  here; adding a mechanic means extending `action()` + `tick()` +
  `serialize()` together.

## Missions are data (`src/engine/mission.ts`, `mission-gen.ts`, `mission-registry.ts`)

The engine consumes a `MissionDef` — pacing ranges (spawn rate, impact
timing, damage, breaker frequency), global scales (drift, speed), and a
timeline of scripted one-shot `ScriptedEvent`s (spawn a burst, trip a
breaker, change the spawn rate, force a calm stretch, log a beat) keyed to a
time or progress mark. The engine itself knows nothing about where a
`MissionDef` came from.

- **Authored missions** (`src/engine/missions/*.ts`) — hand-tuned TypeScript
  modules exporting a `MissionDef` each (`supply-run`, `mined-corridor`,
  `kepler-rescue`), registered in `mission-registry.ts`.
- **Procedural generator** (`mission-gen.ts`) — `generateMission(GenParams)`
  deterministically builds a `MissionDef` from a length/intensity preset plus
  a seed; the registry exposes fixed presets (`gen:short/standard/long`) to
  the lobby.
- **`mission-registry.ts`** is the single place a transport resolves a start
  request (`resolveMissionStart(missionId, seed)`) into a `{def, seed}` pair,
  and the source of the lobby catalog (`missionCatalog()`). Unknown/missing
  ids fall back to the default mission.
- Every run is reproducible from `(missionId, seed)` — the run's own RNG
  (`this.rng` in `game.ts`) is the only source of gameplay randomness;
  nothing uses `Math.random`. This is what makes the mission lab (below)
  and bug repro both possible. See `docs/missions.md` for the authoring
  guide.

## Node transport (`src/server-node.ts`) — LAN mode

- **Room registry** — `Map<code, Room>`; a `Room` is `{code, game, clients,
  interval}`. Rooms are created by `POST /api/rooms`, deleted after 10
  minutes with no clients. Codes are 4 chars from an ambiguity-free alphabet
  (no 0/O/1/I/L) for easy phone entry. The tick interval only runs while the
  room has clients or an active mission — idle rooms don't tick.
- **Join API** — `GET /api/room-info?code=` returns the join URL, derived
  from the request `Host` (`PUBLIC_URL` env overrides it, e.g. behind a
  reverse proxy). QR is generated **client-side** from that URL
  (`public/js/vendor/qrcode-generator.mjs`) — no server-side image
  generation on either transport.
- **WebSocket protocol** (path `/ws`) — messages are JSON with a `type`
  field:
  - client → server: `join {room, seat, name, difficulty, playerId}`,
    `start {missionId?, seed?}`, `restart`, `action {action}`
  - server → client: `joined {seat, code, state}`, `state {state}`,
    `event {text}`, `error {message}`
- **Seat exclusivity** — crew seats (`helm`, `engineering`, `weapons`) allow
  one occupant; `main` is view-only and unlimited (TV + a laptop both work).
- **Heartbeat** — server pings every 30s and terminates unresponsive sockets
  so a dead phone's seat flips to auto-assist instead of hanging.
- **Abuse guards** — room/client/message-rate caps (see
  `cloud-migration.md` Phase 1); the per-IP room-creation limit is Node-only
  since it needs shared in-process memory.
- **Time scaling** — `GAME_SPEED` multiplies the per-tick `dt`; the smoke
  test uses this to play a full mission in seconds instead of minutes.
- **`/healthz`** and graceful `SIGTERM` (broadcast a restart event, close
  sockets, exit) for process-manager-friendly deploys.

## Cloudflare Workers transport (`src/worker/`) — cloud deployment

- **`index.ts`** — stateless router. Static assets are served by the
  platform before this code runs (Workers Assets, `[assets]` in
  `wrangler.toml`). Handles `/healthz`, `POST /api/rooms` (picks a random
  4-char code, asks the owning Durable Object to `/create` it, retries on a
  rare collision), `GET /api/room-info`, and forwards `/ws?room=` upgrades
  to the owning DO.
- **`room-object.ts`** — `RoomObject`, one Durable Object per room, addressed
  by `env.ROOMS.idFromName(code)`. The platform guarantees every request for
  a code reaches the same single-threaded object — that's the room-affinity
  primitive the game needs, with no directory or routing layer to operate.
  Owns one `Game` instance, its WebSockets, and its tick loop (`setInterval`
  equivalent via the DO alarm/timer); mirrors the Node transport's protocol
  and abuse caps exactly. The room *code* is persisted in DO storage (so it
  survives eviction); mission *state* is not yet (Phase 3 in
  `cloud-migration.md` — a deploy or eviction currently restarts a room to a
  fresh lobby, a known and accepted prototype-stage gap).
- **Dev loop** — `wrangler dev` (script: `npm run dev:cf`), deploy via
  `npm run deploy` (needs `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`).
- **Why this and not a multi-instance Node fleet** — a Durable Object *is*
  the room-affinity primitive Jackbox-style games need; Path B (Node +
  Redis room directory) was considered and rejected as plumbing the platform
  already provides. Full tradeoff writeup in `cloud-migration.md`.

## Clients (`public/`)

Plain HTML + ES modules, served statically by both transports, zero build
step.

- **`js/net.js`** — `Net` class: WebSocket client with capped exponential
  backoff reconnection, picking `ws://`/`wss://` from `location.protocol` (so
  it works unmodified against either transport). Generates a sticky
  `playerId` in `sessionStorage` (per-tab, so one device can hold multiple
  seats in multiple tabs while a reload in a tab resumes its seat).
- **`js/station.js`** — `initStation({seat, render})`: shared shell for the
  three crew pages. Owns URL-param parsing, the connection dot, lobby and
  debrief overlays, event toasts, and launch/return buttons. Each station
  page supplies only its `render(state)` and its control wiring.
- **Station pages** (`helm.html`, `engineering.html`, `weapons.html`) —
  self-contained page + inline module each; controls send actions, `render`
  reflects the latest snapshot. One deliberate pattern: sliders track a
  local "dragging" flag so server echoes don't fight the player's finger.
- **`mainscreen.html` + `js/mainscreen.js`** — view-only seat. Canvas
  starfield (star speed tracks actual ship speed), asteroid blobs whose size
  reflects time-to-impact, the ship's log, HUD bars, mission-select lobby,
  client-side QR, and the full debrief stats grid.
- **`index.html`** — landing page for both flows: *host* (create room →
  become main screen) and *player* (code + name + difficulty → station
  page). The QR link lands here with `?room=` prefilled.

## Testing

There is no unit-test runner yet; these are the regression suite, and both
must pass before a change is considered done (plus `npm run typecheck`):

- **`npm run smoke`** (`scripts/smoke.mjs`) — boots the real Node transport
  at 10x game speed, connects a bot crew over real WebSockets (all four
  seats, `scripts/lib/crew.mjs` + `policies.mjs`), launches, and plays a
  competent full mission. Asserts the debrief is reached with an `arrived`
  outcome. Exercises the actual production code path — server boot, room
  creation, joins, the full action vocabulary, mission completion.
- **`npm run smoke:cf`** (`scripts/smoke-cf.mjs`) — the same bot crew against
  `wrangler dev` (local workerd), verifying the Workers transport produces
  identical mission behavior over the identical wire protocol.
- **`npm run lab`** (`scripts/mission-lab.ts`) — in-process balance harness:
  sweeps every mission × three crew profiles (skilled/novice/auto bots) ×
  seeded runs, no server or sockets involved, drives the engine directly.
  Prints an aggregate table and writes raw per-run records (debrief +
  telemetry) to `reports/` for balance analysis (see
  `docs/design/08-mission-balance-baseline.md`).

Because `runBotCrew()` (`scripts/lib/crew.mjs`) only needs a base URL, the
same harness can also point at a live deployment for a one-off cloud
verification — not part of the regular suite, but useful to confirm
multi-room isolation and TLS/join-URL behavior against production rather
than only `wrangler dev`.

## Extension points

- **New mechanic on an existing station** — extend `action()` + `tick()` +
  `serialize()` in `src/engine/game.ts`, then render/wire it in that
  station's page. If the mechanic needs per-mission tuning, add the knob to
  `MissionDef` (`mission.ts`) rather than hardcoding a constant.
- **New station** — add the seat to `SeatId`, give it actions and
  auto-assist in `game.ts`, copy a station page as a template, add a button
  on `index.html`. Remember: both transports must keep speaking the same
  wire protocol, so a new action kind needs no transport-side changes (the
  transports pass `action` through unchanged) but a new message *type* would
  need updating in both `server-node.ts` and `room-object.ts`.
- **New mission** — add a `MissionDef` module under `src/engine/missions/`
  and register it in `mission-registry.ts` (see `docs/missions.md`), or add a
  new generator preset. Re-run `npm run lab` and compare against the
  baseline before calling it tuned.
