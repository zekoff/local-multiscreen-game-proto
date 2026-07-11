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
   pressure; per-seat difficulty multipliers stack on top of it, preserving the
   design pillar that player difficulty is a parameter, not a code path.
   `asteroidDmg` is a *base* magnitude — each rock rolls a size (0.6-1.6) and
   speed (0.75-1.35) that scale its actual damage and closing rate, and ~1/3 of
   ambient spawns arrive as a 2-3 rock cluster.
3. **Scripted events** — an authored timeline of one-shot set pieces that fire
   at a mission-time or progress mark:
   - `log` — narrative beat in the ship's log + station toasts
   - `spawnAsteroids` — a burst on top of ambient spawning
   - `tripBreaker` — engineering crisis (specific system or random)
   - `spawnRate` — change ambient spawn pressure from this point on
   - `calm` — suppress ambient spawns for a stretch (quiet-before-the-storm)

New event action types are added in `mission.ts` (the `EventAction` union)
and `game.ts` (`applyEventAction`) — two places, type-checked.

## Authoring a mission

1. Copy an existing file in `src/engine/missions/` (e.g. `mined-corridor.ts`
   for a scripted mission, `supply-run.ts` for a purely ambient one).
2. Give it a unique `id` and register it in `mission-registry.ts` (add to
   `AUTHORED`).
3. Balance-check it: `LAB_MISSIONS=<your-id> LAB_RUNS=20 npm run lab`.
   See "reading lab output" below for what good looks like.
4. `npm run typecheck && npm run smoke` — the schema is type-checked, and the
   smoke test confirms nothing regressed.

The three shipped missions are deliberately different shapes:
`supply-run` (pure ambient baseline — also the calibration reference),
`mined-corridor` (wave-structured, event-driven), `kepler-rescue` (short,
hot, engineering-crisis midpoint).

## Procedural missions

`generateMission(params)` in `mission-gen.ts` builds a `MissionDef` from
`GenParams` — `length` (short/standard/long), `intensity` (0..1), and `seed`.
Same params + seed = the identical mission (name, destination, set pieces,
pacing), so generated missions are shareable and testable like authored ones.
The lobby exposes three presets (`gen:short`, `gen:standard`, `gen:long`);
a fuller mission-setup UI can expose `GenParams` directly later.

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

Note: **sensors** (a fourth engineering-powered system) gate when a contact
becomes *targetable* on the weapons scope — low sensor power means contacts
resolve late and the shoot window shrinks. Nav **gates** sit off the direct
course (a bearing the helm must swing onto). **Emergency Warp** (helm) clears
all threats but scatters the ship's systems. See the wave-2 section of
`docs/pre-playtest-improvements-recap.md` for the full mechanics.

## The mission lab (`npm run lab`)

In-process balance harness: runs every mission (or `LAB_MISSIONS=id,id`)
against three crew baselines across fixed seeds (`LAB_RUNS`, default 10),
driving the engine directly — a full sweep takes seconds. Bot policies live
in `scripts/lib/policies.mjs` and are shared with the network smoke tests, so
lab results and wire-level tests can't drift apart.

Crew baselines:
- **skilled** — coordinated-crew ceiling
- **novice** — slow, sloppy reactions; probes the difficulty floor
- **auto** — no humans at all; the engine's auto-assist plays

Reading the output: a well-tuned mission should be comfortably winnable for
`skilled`, survivable-but-scarred for `novice`, and rough for `auto`. As of the
pre-playtest pass this is the actual shape (auto now fails 30-50% on hard
missions) — `docs/design/08-mission-balance-baseline.md` records the earlier
"everything's too easy" problem and how it was closed;
`docs/console-complexity-analysis.md` has the current numbers.

Raw per-run records (debrief + full telemetry) land in `reports/`
(gitignored); the printed table is the summary view.
