# local-multiscreen-game-proto

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

## Development

```bash
npm run dev        # server with auto-reload
npm run typecheck  # TypeScript check of src/
npm run smoke      # headless bot crew plays a full mission at 10x speed
```

Environment knobs: `PORT` (default 3000), `GAME_SPEED` (simulated-time
multiplier, used by the smoke test), `TICK_MS` (server tick, default 250).

## Layout

- `src/game.ts` — authoritative game engine (state machine, mission logic)
- `src/server.ts` — HTTP static hosting + room API + WebSocket transport
- `public/` — zero-install browser clients (join page, three stations, main screen)
- `scripts/smoke.mjs` — end-to-end bot-crew regression test
