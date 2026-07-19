# Mission Framework

Missions are data. The engine (`src/engine/game.ts`) consumes a `MissionDef`
and knows nothing about where it came from; authored missions and the
procedural generator both produce the same structure. This document is the
authoring and testing guide.

## The shape of a mission (`src/engine/mission.ts`)

A `MissionDef` has three layers:

1. **Identity & narrative** — `id`, `name`, `briefing`, `arrivalName`, and an
   optional `destination` (`{ kind: 'station' | 'planet', color }`) that the
   main screen grows on the horizon as progress climbs. These are what players
   see in the lobby, the ship's log, HUD labels, the viewscreen, and the
   debrief.
2. **Ambient pacing** — ranges (`spawnEvery`, `impactIn`, `asteroidDmg`,
   `breakerEvery`, optional `gateEvery`), caps (`maxAsteroids`), and scales
   (`driftScale`, `speedScale`, `parTime`). This is the mission's baseline
   pressure; per-seat difficulty stacks on top of it (the `rate` multipliers in
   the `ASSIST` table, `game.ts`), preserving the design pillar that player
   difficulty is a parameter, not a code path. Note that difficulty now also
   changes *which controls a console has* — also declared in that same table, so
   a mission never needs to know which mode a seat is on.
   **Mission length** is a single knob: `targetSeconds` (the duration of a
   well-executed run). Rather than hand-set `speedScale`/`parTime`, spread
   `pacingFor(targetSeconds)` (from `mission.ts`) into the def — it derives both
   (`speedScale = SPEED_CALIB / targetSeconds`, `parTime = 1.35 × targetSeconds`)
   so a clean crew arrives near `targetSeconds`. Ambient pacing is deliberately
   *not* length-scaled, so a longer mission keeps the same per-minute intensity
   and simply runs longer. Authored baselines: supply-run 180s (3 min),
   mined-corridor 260s; gen presets 180/240/300s; Europa Salvage Loop 300s.
   `asteroidDmg` is a *base* magnitude — each rock rolls a **discrete class**,
   small (~0.8, snapshot-killable) or large (~1.5, snapshot-proof, ~22% of rocks),
   plus a speed (0.75-1.35) that scales its damage and closing rate.
3. **Scripted events** — an authored timeline of one-shot set pieces that fire
   at a mission-time or progress mark:
   - `log` — narrative beat in the ship's log + station toasts
   - `spawnAsteroids` — a burst of rocks on top of ambient spawning
   - `spawnContact` — a **typed** contact (`rock`/`pod`/`mineral`/`ghost`): pods
     are rescue (don't-shoot, tow for score), minerals are inert salvage, ghosts
     are sensor false-positives. The workhorse for salvage/rescue/first-contact.
   - `tripBreaker` — engineering crisis (specific system or random)
   - `spawnRate` / `calm` / `setMaxAsteroids` — reshape ambient spawn pressure
   - `spawnGate` — a scripted nav gate (slipstream) on top of `gateEvery`
   - `ionStorm` (halves sensor range), `debrisField` (running hot scours the
     hull), `ghostSwarm` (phantom scope contacts — weapons pressure),
     `setViewImpaired` (black out the forward view) — environmental pressure.
     `solarFlare` (announced, then strikes raised systems) exists but is
     **frozen** (WIP — pulled from procgen and the debug panel until it fires
     correctly; the engine executor is intact but uninvoked).
   - `spawnObstacle` — a large steer-*around* hazard (topology)
   - `spawnDivert` / `cinematic` — a competing-objective fork / a soft-pause
     dialogue beat on the main screen
   - `startEmergency` — a Crew-Chief damage-control task (fire/boarders/breach/leak)

Optional MissionDef knobs for the salvage/rescue/Crew-Chief layer: `holdCapacity`,
`crewTokens`, `salvageGoal`, `failOnCountdown`, `readout` (distance vs countdown),
and `scoreModel: 'salvage'` (a distance-arrival run scored on hull + time +
salvage banked, e.g. Europa Salvage Loop). New event action types are added in
`mission.ts` (the `EventAction` union) and `game.ts` (`applyEventAction`) — two
places, type-checked.

## Authoring a mission

1. Copy an existing file in `src/engine/missions/` (e.g. `mined-corridor.ts`
   for a scripted mission, `supply-run.ts` for a purely ambient one).
2. Give it a unique `id` and register it in `mission-registry.ts` (add to
   `AUTHORED`).
3. Balance-check it: `LAB_MISSIONS=<your-id> LAB_RUNS=20 npm run lab`.
   See "reading lab output" below for what good looks like.
4. `npm run typecheck && npm run smoke` — the schema is type-checked, and the
   smoke test confirms nothing regressed.

The authored missions are deliberately different shapes: `first-flight` (intro),
`supply-run` (pure ambient baseline — also the calibration reference),
`mined-corridor` (wave-structured combat), plus the Crew-Chief-era set
(`lifeboat-run`, `deadline-kepler`, `salvage-claim`, `blackout-approach`,
`first-contact`) and `free-flight` (a debug sandbox). All are registered in
`mission-registry.ts` (`AUTHORED`).

## Procedural missions

`generateMission(params)` in `mission-gen.ts` builds a `MissionDef` from
`GenParams` — `length` (short/standard/long), `intensity` (0..1), and `seed`.
Same params + seed = the identical mission (name, destination, set pieces,
pacing), so generated missions are shareable and testable like authored ones.
The lobby exposes `gen:short` / `gen:standard` / `gen:long`, plus **Europa
Salvage Loop** (`gen:europa`) — a fixed-shape procedural *type* with its own
generator (`generateEuropaSalvageLoop`, resolved specially in
`resolveMissionStart`): slipstreams, heavy rock batches, drifting salvage, a slow
lifeboat, ghosts, and **3 hazards** drawn at random (repeats allowed) from a pool
of ion storm / debris field / ghost swarm / blackout, scored on time / salvage / hull.

## Reproducibility: (missionId, seed)

Every random draw during a run — spawn timing, damage rolls, drift, breaker
choices — goes through a seeded RNG (`rng.ts`). The debrief reports the seed;
`{type:'start', missionId, seed}` over the wire (or `resolveMissionStart` in
code) replays the same run. This is what makes bug reports and balance
comparisons meaningful.

## Telemetry: what every run records

The engine accumulates a `Telemetry` object per run (see `game.ts`), included
in the debrief and consumed raw by the mission lab:

- **Outcome quality**: `hullDamageTaken`, `impactLog` (when and how hard each
  hit landed — the mission's damage rhythm)
- **Station load**: `avgAlignment` (helm pressure), `powerChanges` and
  `breakerDowntime` (engineering pressure), `shotsFired` /
  `asteroidsSpawned` (weapons pressure), `shieldUptime`, `gatesPassed` /
  `gatesMissed` (nav gates), `warpsUsed`, `pulsesUsed`
- **Crew context**: which seats were human and their difficulty settings —
  without this, aggregate numbers are uninterpretable.
- **Per-console effectiveness** (`perConsole`, **sim-report only** — not shown
  on the player debrief): helm (gate pass rate, on-course %, alignment error),
  weapons (hit rate, contact→acquire latency, threats neutralized), engineering
  (power utilization, breaker downtime), and a **captain-coordination proxy**
  (the captain has no device, so it's read off crew outcomes — defense, gate
  discipline, and how fast contacts get handed to weapons). Surfaced as a second
  table in `npm run lab`.

Note: **sensors** (an engineering-powered system) gate a contact in two stages —
*detection* (targetable on the weapons scope) and *identification* (its true kind
resolves); low sensor power means contacts resolve late and the shoot window
shrinks. The tractor beam shares the **weapons** emitter (tow salvage/pods; no
firing while latched). Nav **gates** sit off the direct course (a bearing the helm
swings onto for a slipstream). **Emergency Warp** (helm) clears all threats but
scatters the ship's systems.

## The mission lab (`npm run lab`)

In-process balance harness: runs every mission (or `LAB_MISSIONS=id,id`)
against a set of crew scenarios across fixed seeds (`LAB_RUNS`, default 10),
driving the engine directly — a full sweep takes seconds. The scenarios are the
baselines (`skilled` / `novice` / `auto` / `full4`) plus single- and two-human
mixes (`1h-helm` / `1h-eng` / `1h-weap` / `1h-chief` / `2h-helm-eng` — the named
seats are skilled operators, the rest on auto-assist) that verify the bot-balance
target: an all-`auto` crew loses, and a single human can carry a bot crew. Bot
policies live in `scripts/lib/policies.mjs` and are shared with the network smoke
tests, so lab results and wire-level tests can't drift apart.

Crew baselines:
- **skilled** — coordinated-crew ceiling
- **novice** — slow, sloppy reactions; probes the difficulty floor
- **auto** — no humans at all; the engine's auto-assist plays

Reading the output: a well-tuned mission should be comfortably winnable for
`skilled`, survivable-but-scarred for `novice`, and rough for `auto`, with any
single human able to carry a bot crew. `docs/console-complexity-analysis.md` has
the current per-console load, interplay map, and known balance issues.

Raw per-run records (debrief + full telemetry) land in `reports/`
(gitignored); the printed table is the summary view.
