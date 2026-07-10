# Cloud Migration Plan

Directive for moving the authoritative game server to the cloud. Written
2026-07-09 as the outcome of a hosting analysis; intended to be consumed by
Claude Code when implementing. Read `docs/architecture.md` first for the
current system.

## Requirements (decided, not open questions)

1. The server moves to cloud hosting; **LAN self-hosting must keep working**
   from the same codebase (it's free resilience and the offline fallback).
2. The deployment must serve **an arbitrary number of concurrent games** —
   not infinite, but scalable from the beginning. A hard one-instance cap is
   **rejected**. The architecture must not need a redesign to go past one
   node.
3. Prototype-stage cost and operational burden: small, CLI-drivable,
   Claude-Code-operable.

## What already scales (do not break these properties)

The current design is accidentally well-positioned for horizontal scaling
because rooms are fully independent:

- `Game` instances share **no state** with each other — no cross-room reads,
  no global mutable state in the engine.
- The engine (`src/game.ts`) is transport-free; it doesn't know WebSockets
  exist.
- Clients are stateless renderers; a reconnect needs only the next full
  state snapshot. There is no session state outside the room.
- The wire protocol identifies everything by room code + seat + playerId.

**Standing rule for all future work:** never introduce cross-room state or
engine↔transport coupling. Every scaling path below depends on rooms staying
independently relocatable.

## The one real architectural problem: room affinity

All clients of room X must reach the process that owns room X's memory and
tick loop. With one instance this is trivial; with N instances something must
route `room code → owning instance`. That routing is the entire scaling
problem for this system. Three ways to solve it:

### Path A — Vertical headroom (what one node can do)
Napkin math per room: 4Hz tick over ~1KB state, ≤6 sockets, ~1.5KB snapshot
to each → CPU is negligible; **egress bandwidth is the first bottleneck**
(~300 kbps per room → hundreds of rooms per typical small instance, more with
snapshot-size or tick-rate optimizations). One modest node genuinely covers
hundreds of concurrent games. This is headroom, not a scaling strategy — but
it means multi-instance is not urgent, only *unblocked*.

### Path B — Multi-instance Node with a room directory (keeps current stack)
- A shared directory (Redis) maps room code → instance.
- Room creation registers ownership; joins look up the owner.
- Routing options: Fly.io's `fly-replay` header (an instance that doesn't own
  the room tells Fly's proxy to replay the connection to the right machine),
  or a thin gateway.
- Costs: you now operate Redis + routing logic + instance lifecycle. All
  plumbing you own.

### Path C — Cloudflare Durable Objects (platform-native room affinity) ✅ chosen
A Durable Object *is* the room-affinity primitive: one globally-addressable
single-threaded object per room, reached by name (`idFromName(roomCode)`),
scaled and routed by the platform automatically. Jackbox-style room games are
the canonical DO use case.

- Room = one DO holding its `Game` instance and its WebSockets.
- Routing, directory, and uniqueness of room codes come for free from
  name-based addressing — Path B's Redis + replay plumbing simply doesn't
  exist.
- Per-object SQLite storage makes mission-in-progress persistence across
  deploys easy later (fixes the "deploys kill live games" caveat, which is
  otherwise accepted for now).
- Free tier covers prototype usage; paid usage is duration-based and small.
- **The cost:** the transport layer is a rewrite. Workers runtime is not
  Node — Express and the `ws` package are replaced by Workers fetch routing
  (or Hono) and the DO WebSocket API. `src/server.ts` (~200 lines) is
  rewritten; **`src/game.ts` ports unchanged** — it's dependency-free
  TypeScript. Clients are untouched except the items in Phase 1.
- Dev loop: `wrangler dev` (local, works on both dev machines), `wrangler
  deploy`. Fully CLI-drivable.

**Decision: Path C (Cloudflare Durable Objects) is the target.** Path B is
the fallback if DO constraints prove unacceptable in practice. Path A's
headroom argument means there is no urgency spike — sequencing below is
sane, not rushed.

**LAN mode under Path C:** the current Node server (`src/server.ts`) is kept
as the LAN-mode host. This is viable *only if* the shared pieces stay
runtime-agnostic: the engine, the wire protocol, and the client code must not
depend on Node or Workers specifics. The transport layer is the only thing
that forks.

## New considerations vs. local hosting (unchanged by the scaling decision)

1. **TLS/WSS** — https pages cannot open `ws://`; clients must pick the
   scheme from `location.protocol`.
2. **Join URLs** — `lanIp()` is meaningless in the cloud; derive the join/QR
   URL from the request `Host` (+ `X-Forwarded-Proto`), with a `PUBLIC_URL`
   env override. (Also fixes Chromebook/Crostini local testing.)
3. **Public exposure** — room codes become the only access control. Add:
   cap on total rooms, cap on clients per room, rate limit on room creation,
   per-socket message size + rate caps.
4. **Deploy = restart** — in-memory games die on deploy. Accepted for the
   prototype; DO storage is the later fix (see Phase 3).
5. **Latency** — 20–80ms instead of LAN ~2ms; irrelevant at a 4Hz tick with
   no client prediction. Choose a nearby region/keep DOs defaulting to
   first-access location.
6. **Co-located pillar** — cloud hosting *helps* it in practice (venue Wi-Fi
   client isolation, phones on cellular) and enables remote crews; LAN mode
   remains the offline fallback.

## Phase 0 — Manual account prep (human tasks, not Claude's)

One-time setup the developer does before Claude Code can deploy:

1. **Create a Cloudflare account** (free) at dash.cloudflare.com and verify
   the email. The Workers free plan includes SQLite-backed Durable Objects —
   no credit card or paid plan needed for prototype-scale playtesting.
   Workers Paid (~$5/mo) is the escape hatch if free-tier limits are hit.
2. **Note the Account ID** (visible in the dashboard sidebar / Workers
   overview). Non-secret; it goes in `wrangler.toml` and can be committed.
3. **Auth for Claude Code** — either:
   - *Scoped API token (recommended for agent workflows):* dashboard → My
     Profile → API Tokens → create from the **"Edit Cloudflare Workers"**
     template. Export it in the shell profile on both dev machines:
     `export CLOUDFLARE_API_TOKEN=...` (never commit it). Wrangler picks it
     up automatically; revocable and least-privilege.
   - *Interactive OAuth (simpler, per-machine):* run `wrangler login` in a
     terminal (in a Claude Code session: `! npx wrangler login`). Opens a
     browser; on Crostini, paste the printed URL into Chrome manually.
4. **Pick a workers.dev subdomain** when prompted on first deploy. The app
   will live at `https://<app>.<subdomain>.workers.dev` with TLS included —
   no custom domain or DNS migration required.

Not needed: a custom domain, moving any DNS to Cloudflare, or CI/GitHub
integration (Claude Code deploys via `wrangler deploy`; CI can come later).

Claude Code handles the rest: `wrangler` as a devDependency (`npx wrangler`),
`wrangler.toml`, verifying auth with `wrangler whoami`, local dev via
`wrangler dev`, and log tailing via `wrangler tail`.

## Implementation phases

Each phase leaves the repo working (`npm run typecheck` + `npm run smoke`
must pass; smoke must run against the LAN-mode server throughout).

### Phase 1 — Platform-neutral prep ✅ done 2026-07-09
- [x] `net.js`: derive socket scheme from `location.protocol` (wss on https);
      room code also rides in the WS URL (`/ws?room=`) so a routing layer can
      pick the owner before any message is exchanged.
- [x] Join/QR URL from request `Host` + `X-Forwarded-Proto`, with
      `PUBLIC_URL` env override (`requestOrigin()` in `src/server-node.ts`).
      QR moved fully client-side (`public/js/vendor/qrcode-generator.mjs`,
      vendored ESM build) — no server-side image generation in any runtime.
- [x] Idle rooms don't tick: interval runs only while clients are connected
      or a mission is active; separate 60s GC sweeper deletes abandoned rooms.
- [x] Abuse guards: MAX_ROOMS 200, MAX_CLIENTS_PER_ROOM 16, 10 room
      creations/min/IP, 4KB max message, 60 msgs/sec/socket. (The per-IP
      creation limit is Node-only; Worker isolates don't share memory —
      use Cloudflare WAF rate-limiting rules if it matters later.)
- [x] `/healthz` endpoint (both transports).
- [x] Graceful SIGTERM: broadcast restart event, close sockets, exit.

### Phase 2 — Durable Objects transport ✅ done 2026-07-09
- [x] Engine extracted to `src/engine/game.ts` (runtime-agnostic, zero
      imports), consumed by `src/server-node.ts` (LAN mode) and the Worker.
- [x] Worker entry `src/worker/index.ts`: room API, `/healthz`, `/ws?room=`
      upgrade forwarding via `idFromName(code)`; static pages served by
      Workers Assets (`[assets]` in wrangler.toml). Room-code claim protocol:
      Worker asks the DO to `/create`; 409 = live collision, retry new code.
- [x] `RoomObject` DO (`src/worker/room-object.ts`): owns one `Game` + its
      WebSockets + tick loop; identical wire protocol to the Node transport;
      same abuse caps; room code persisted in DO storage (survives eviction;
      mission state does not — Phase 3).
- [x] `wrangler.toml` (SQLite DO migration, assets, observability) + scripts:
      `dev:cf`, `deploy`, `smoke:cf`; dual typecheck configs
      (tsconfig.json for Node, tsconfig.worker.json for Workers types).
- [x] Verified: `npm run smoke` (Node transport) and `npm run smoke:cf`
      (bot crew vs `wrangler dev`) both pass with identical mission profiles.

### Phase 3 — Later, when justified (explicitly out of scope now)
- Mission-in-progress persistence in DO storage (survive deploys).
- Snapshot-size/tick-rate optimization if room counts make egress matter.
- Observability: room count, active games, socket counts.

## Acceptance criteria for "migrated"

- A phone on cellular and a laptop on home Wi-Fi can join the same game via
  the public URL with TLS, QR code included.
- Two simultaneous games run without interference (they already do locally;
  verify in cloud).
- `npm run smoke` still passes against LAN mode; the CF smoke variant passes
  against `wrangler dev`.
- Killing and redeploying the Worker breaks only in-progress games (known,
  accepted), not the ability to start new ones.
