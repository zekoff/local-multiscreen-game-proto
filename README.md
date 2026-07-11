# bridge-crew

Prototype of a co-located, multi-device cooperative spaceship bridge game.
Each player crews a station from their own phone/tablet/laptop browser; an
optional main screen (TV or laptop) shows the shared viewscreen and join code.
Design docs live in [`docs/design/`](docs/design/00-overview.md).

## Run it

```bash
npm install
npm start          # server on http://0.0.0.0:3000
```

1. Open the printed LAN URL on the device that will be the **main screen**
   (TV browser or a laptop) and click **Create New Ship**.
2. Other players scan the QR code (or type the LAN URL) on their phones,
   enter the 4-letter ship code, pick a station and a difficulty, and join.
3. Anyone can press **Launch Mission** from the lobby.

Stations: **Helm** (throttle, course alignment, evasive maneuvers),
**Engineering** (power distribution, breakers), **Weapons** (targeting,
phasers, shields). A **Commander** plays with no device at all — they watch
the main screen and give orders. Unmanned stations run on a basic auto-assist,
so any subset is playable (open extra tabs to test solo).

The mission: escort a supply run through an asteroid belt to Station Epsilon.
Outcomes are non-binary — a scored debrief grades the run from *Legendary* to
*Barely Survived*, and even a lost ship earns partial credit.

## Cloud hosting (Cloudflare Workers)

The same game deploys to Cloudflare Workers with one Durable Object per room
(see `docs/cloud-migration.md`):

```bash
npm run dev:cf     # run the cloud transport locally (wrangler dev)
npm run deploy     # deploy to Cloudflare (needs CLOUDFLARE_API_TOKEN)
```

LAN mode (`npm start`) keeps working from the same codebase and is the
offline fallback.

## Development

```bash
npm run dev        # LAN server with auto-reload
npm run typecheck  # TypeScript check (Node + Worker configs)
npm run smoke      # bot crew plays a full mission vs the Node transport at 10x
npm run smoke:cf   # same bot crew vs the Workers transport (wrangler dev)
```

Environment knobs: `PORT` (default 3000), `GAME_SPEED` (simulated-time
multiplier, used by the smoke tests), `TICK_MS` (server tick, default 250),
`PUBLIC_URL` (override for player-facing join URLs).

## Layout

- `src/engine/game.ts` — authoritative game engine (runtime-agnostic; shared
  by both transports)
- `src/server-node.ts` — LAN-mode transport: static hosting + room API +
  WebSockets
- `src/worker/` — cloud transport: Worker router + one Durable Object per room
- `public/` — zero-install browser clients (join page, three stations, main screen)
- `scripts/` — end-to-end bot-crew regression tests for both transports
