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

### Responsiveness: the optimistic-intent overlay

Because a control's effect isn't visible until the next full-state broadcast,
an input can feel up to ~250ms laggy (a target tap, a shield toggle). The
architecture has **no client-side prediction** and deliberately keeps it that
way — but individual controls can still feel instant with a tiny, low-risk
pattern that does **not** touch the simulation:

> **Optimistic-intent overlay.** On input, store the *intended* value locally
> and let the renderer prefer it over the snapshot; on each incoming snapshot,
> reconcile — clear the local intent once the authoritative state matches, or
> expire it after ~2–3 snapshots if the server never confirms (the action was
> rejected). The authoritative state always wins; the overlay only front-runs
> the render by one round-trip.

This is now a shared client module: `public/js/optimistic.js`
(`createIntents()` — set/get/flash/reconcile), reconciled by `station.js`
before every render. Applied to the weapons scope target tap (the original
implementation, `optimisticTargetId` in `weapons-scope.js`), the shields
toggle, the FIRE meter drain, engineering's power pips and breaker restore,
and helm's throttle **setpoint echo** (the commanded %, never predicted
derived state) and warp button. Server rejections revert silently after 3
snapshots.

**Difficulty of extending this** depends entirely on the *kind* of action:

- **Idempotent selection actions** (target a contact, raise/lower shields,
  arm a control) — **trivial and safe.** The intent is a single value that the
  next snapshot either confirms or overrides; there is no accumulation to get
  wrong. This is the recommended, low-risk surface to keep improving.
- **Continuous / stateful actions** (throttle position, power allocation,
  laser charge, alignment) — **moderate effort and genuinely desync-prone.**
  Predicting these means locally re-running a slice of the simulation and
  reconciling divergence when the authoritative snapshot arrives (rollback,
  or smoothing toward truth). That is a real prediction/reconciliation engine
  with its own bug class (the client and server disagreeing about a number the
  player is actively changing). It is **not** justified for this prototype.

So: reach for the overlay for selection/toggle controls; do **not** build a
general prediction layer for continuous state without a deliberate decision.

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
    engine-internal logic each tick (helm holds 70% throttle, re-centers, and
    makes a weak attempt at nav rings; engineering resets breakers after ~4s;
    weapons never misses but fires only after a deliberate 1-2s pause once
    charged and in range, and raises shields only for a 2+ rock volley). The
    CPU is SLOW rather than incompetent: a full bot crew barely survives the
    baseline mission, and a human at any console is meaningfully better —
    including a human engineer, whose weapon-power pumping shortens the bot
    gunner's recharge wait. This makes any subset of stations playable.
- **Actions** — validated per seat in `action(seat, a)`; a helm client cannot
  send engineering actions. Auto-assist uses the same internal code paths as
  human actions (e.g. `fire()`), so behavior is identical.
- **Interdependence** (the coordination engine): engineering allocates **7
  power units across four systems** (engines, shields, weapons, **sensors**;
  max 4 each), and tripped breakers halve a system until reset. Breakers trip
  mainly when a rock hits the hull (fully-shielded hits don't trip anything);
  the ambient random-trip timer is a rarer background pressure. Each system is
  a live tradeoff:
  - *engines* → ship speed **and** turn authority (a nudge turns harder with
    more engine power and with lower throttle), but a faster ship makes
    asteroids close sooner;
  - *weapons* → laser recharge speed (the laser is a recharge meter, not a
    battery — firing empties it, weapon power refills it, ready at full);
  - *shields* → regen rate (shields recharge only while lowered, bleed while
    raised — a managed resource, and raising them also taxes engine output);
  - *sensors* → how early a contact becomes *targetable* on the weapons scope
    (low sensors ⇒ contacts resolve late ⇒ a shorter shoot window).
  Nav **gates** sit off the direct course (a bearing the helm must swing onto
  for a bonus), and **Emergency Warp** (helm) clears all threats but scatters
  every system. No station can succeed alone by design.
- **Difficulty** — per-seat `chill/normal/intense` multiplies that station's
  burden only: helm → drift rate + gate frequency, engineering → breaker trip
  rate, weapons → asteroid spawn rate. Chosen at join time; it's a parameter,
  not a separate code path. The same "parameter, not code path" rule applies to
  mission tuning (below).
- **Non-binary outcomes** — `finish()` composes a 0–100 score from hull (55%),
  time vs. par (~22%), and defensive performance (~18%), plus a small optional
  nav-gate bonus (up to +8), mapped to five narrative grades. A destroyed ship
  still scores partial credit from distance covered. The debrief is
  self-contained (mission, seed, crew composition, stats, telemetry) — see
  `Debrief`/`Telemetry` in `game.ts`.
- **Serialization** — `serialize()` produces the complete client-facing
  snapshot with rounded floats (including percentage-normalized display
  values, e.g. shield strength is tracked internally in absolute points but
  serialized as a 0–100 % of its cap). It also carries a transient `fx` array
  of one-shot effects (laser/explosion/impact/gate/warp/pulse) that both
  transports clear via `clearFx()` right after each broadcast — this drives the
  main-screen effects and the procedural audio. Anything a client renders must
  be here; adding a mechanic means extending `action()` + `tick()` +
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
  debrief overlays (with score-colored grade), event toasts (corner-anchored,
  capped, suppressed under overlays), launch/return buttons, and shared
  meter-coloring helpers (`setHealthBar`/`setChargeBar`). Each station page
  supplies only its `render(state)` and its control wiring.
- **Station pages** (`helm.html`, `engineering.html`, `weapons.html`) —
  self-contained page + inline module each; controls send actions, `render`
  reflects the latest snapshot. Helm has throttle + course/gate steering +
  Emergency Warp; engineering has 4-way power + breakers + sensors + pulse;
  weapons is the Phaser radar scope (`js/weapons-scope.js` mounted via
  `js/phaser-station.js`) + recharge/fire + shields. Sliders track a local
  "dragging" flag so server echoes don't fight the player's finger.
- **`mainscreen.html` + `js/mainscreen.js`** — view-only seat. Canvas
  viewscreen: forward starfield that banks with course, an approaching themed
  destination, off-course nav-gate rings, size/threat-coded asteroids
  (unlabeled until sensors resolve them), laser/explosion/warp/pulse effects
  and screen shake, a captain's per-station + system tactical HUD, the ship's
  log, semantic HUD bars, mission-select lobby, client-side QR, and the full
  debrief stats grid.
- **`js/audio.js`** — procedural Web-Audio module (no asset files): an ambient
  music bed that builds with mission progress, ship-wide SFX on the main screen
  (explosion/impact/laser/gate/warp/pulse), and console-local SFX on the
  consoles (breaker trip/reset, shields). Starts on the first user gesture;
  fails silently if the platform blocks Web Audio.
- **`supervisor.html` + `js/debug-panel.js`** — optional "Sim Supervisor"
  debug role (a view-only, non-exclusive seat). Shared debug controls — pause /
  dilate simulation speed (`setTimeScale`, 0 = pause) and spawn an asteroid /
  nav ring — mounted here and as a main-screen overlay. The controls only act
  when the run was launched with `debug` on (a game-setup checkbox); the engine
  gates them in `debugAction()` and scales the tick `dt` by `timeScale`.
- **`index.html`** — landing page for both flows: *host* (create room →
  become main screen) and *player* (code + name + difficulty → station
  page, incl. the Sim Supervisor). The QR link lands here with `?room=`
  prefilled.

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

## Portable widgets (Crew Chief expansion pass)

A standing architecture principle established in the Crew Chief pass: **console
functions are self-contained, portable widgets** so a station's controls can be
re-arranged between consoles later without re-architecting.

- A widget is defined with `defineWidget({ id, label?, hint?, mount(ctx) })`
  (`public/js/widget.js`); `mount(ctx)` builds its own DOM into `ctx.root` and
  returns `{ render(state), destroy?() }`. It owns its DOM (no shared element
  ids), its render slice, its event wiring, its edge-state, and its own
  travelling `label`. `mountWidgets(container, [...], ctx)` lays a list of
  widgets into a page and returns a host with `render(state)`.
- `ctx = { net, intents, audio, root, card, seat }`. A widget sends actions via
  `net.action(...)` and opts into optimistic paint via the shared `intents`
  store — exactly the same primitives the hand-written consoles use.
- **Why this is portable:** the server broadcasts the *complete* serialized
  state to every seat, so a display widget runs on any console with zero server
  change. An *action* widget additionally needs its host seat authorized for
  its action kind in `game.ts` `action()` — that server-side seat gate is the
  one coupling a widget carries with it. Relax it (allow two seats to send the
  same kind) for true free rearrangement of an action widget.
- **Reference:** `public/crewchief.html` is built entirely as a layout list of
  widgets (`public/js/widgets/crewchief.js` for tractor/cargo/damage-control,
  `public/js/widgets/common.js` for the portable ship-vitals / power-grid
  display widgets it shares). The existing helm/engineering/weapons pages were
  intentionally left hand-wired this pass (migrate-lightly): the abstraction is
  proven by the new console + the shared display widgets, and older widgets can
  be ported incrementally.

## Graphics approach (expanded for the Crew Chief pass)

The viewscreen stays stylized and low-clutter (design pillar), rendered on one
2D canvas from the interpolated `latest` snapshot (`public/js/mainscreen.js`).
New complexity is layered onto the existing draw pipeline rather than replacing
it:

- **Typed contacts.** Contacts carry two visibility fields. `kind` is the
  SENSOR-resolved classification (`UNKNOWN` until identified) — the weapons
  scope uses it. `visualKind` reveals the true kind once a contact is within
  `VISUAL_RANGE` seconds (proximity, not sensors) — the MAIN SCREEN uses it, so
  the captain can spot a rescue pod's blinking beacon out the window before the
  scope classifies it. That split is the visual half of the don't-shoot
  cooperation. Rocks render as tumbling grey polygons (unchanged); pods as green
  beacons with a DO-NOT-FIRE call; minerals as amber angular chunks.
- **Tractor beam** draws a shimmering line from the ship's bow to the latched
  contact with a reel-progress ring (`drawTractorBeam`).
- **Topology.** Large obstacles (`drawObstacles`) loom at a bearing like an
  inverted gate — red and pulsing while the ship is still aligned *into* one.
  When the destination or an open divert slides off the edge (hard turn / warp),
  an edge chevron points back to it (`drawOffscreenChevron`) — the crew's
  fallback to get back on track.
- **Blackout.** `viewImpaired` washes the world to near-black with faint static
  ("fly on sensors"); the reticle + HUD stay legible on top.
- **Cinematic.** A DOM overlay (`#cinematic-overlay`) composites dialogue over
  the frozen scene while the sim is soft-paused server-side (`state.cinematic`).
- **Colour discipline:** kinds have fixed semantic colours reused across the
  scope and the viewscreen (pod green, mineral amber, ghost faint purple, rock
  grey/threat-red). Threat is still communicated by rings, not body colour.
