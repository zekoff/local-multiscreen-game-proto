# Mission Balance Baseline (2026-07-09)

> **Superseded (2026-07-11).** This is the *original* baseline and the problem
> statement it identified ("everything is too easy — even an unmanned ship wins
> flawlessly"). Both waves of the pre-playtest pass acted on the recommendations
> below and **that problem is now resolved**: skilled ~72-79, novice ~64-69, and
> **auto (unmanned) now fails 30-50% of the time** on the harder missions with
> its hull gutted. For the current balance picture, per-console load, and the
> next round of proposals, see `docs/console-complexity-analysis.md` and the
> wave-2 section of `docs/pre-playtest-improvements-recap.md`. The table and
> analysis below are kept as the historical starting point.

First mission-lab sweep after the mission framework landed. 10 seeded runs
per cell, all normal difficulty, tick 250ms. Raw records in `reports/`
(regenerate anytime with `npm run lab`).

| mission | crew | arrived | avg score | avg hull | avg time | impacts | spawned |
|---|---|---|---|---|---|---|---|
| supply-run | skilled | 100% | 84 | 100 | 274s | 0.0 | 20.9 |
| supply-run | novice | 100% | 77 | 100 | 345s | 0.0 | 26.5 |
| supply-run | auto | 100% | 77 | 100 | 342s | 0.0 | 26.3 |
| mined-corridor | skilled | 100% | 85 | 100 | 323s | 0.0 | 26.0 |
| mined-corridor | novice | 100% | 77 | 100 | 409s | 2.3 | 31.3 |
| mined-corridor | auto | 100% | 78 | 100 | 404s | 0.1 | 31.2 |
| kepler-rescue | skilled | 100% | 78 | 100 | 220s | 0.0 | 22.1 |
| kepler-rescue | novice | 100% | 75 | 100 | 280s | 0.0 | 28.4 |
| kepler-rescue | auto | 100% | 75 | 100 | 278s | 0.0 | 28.3 |
| gen:short | skilled | 100% | 81 | 100 | 211s | 0.0 | 19.4 |
| gen:standard | skilled | 100% | 84 | 100 | 275s | 0.1 | 24.6 |
| gen:long | skilled | 100% | 84 | 100 | 381s | 0.0 | 35.6 |

(novice/auto rows for generated presets follow the same pattern as authored
missions; full table in the reports JSON.)

## Findings

1. **Everything is too easy.** 100% arrival everywhere, ~100 hull almost
   everywhere — even a fully **unmanned** ship (auto) cruises through every
   mission undamaged. The current game presents no real threat, which means
   human crews are, mechanically speaking, only improving the *time* score.
2. **The score spread is almost entirely time.** Skilled crews beat novice
   crews by ~7 points, all of it from finishing faster. Damage, defense, and
   survival — the drama — contribute nothing because nothing ever connects.
3. **Root cause: auto-weapons is too strong relative to spawn pressure.**
   The auto-assist (and the skilled bot it mirrors) one-shots the most urgent
   contact the moment charge is available; with default power (2 units →
   6.25 charge/s → a shot every ~5.6s) it comfortably outpaces every
   mission's spawn rate. `mined-corridor`'s wave bursts are the only thing
   that ever lands hits (novice: 2.3 impacts) — evidence the *scripted burst*
   mechanism is the right pressure tool.
4. **Caveat: bots are not humans.** Bots never panic, never mistarget, and
   never argue about power allocation. Real crews will take hits these bots
   don't. The lab bounds difficulty; it doesn't replace playtests. But
   "unmanned ship wins flawlessly" is a bound that's clearly wrong.

## Recommended knob changes (not yet applied — decide together)

Ordered by expected impact; re-run the lab after each:

1. **Weaken auto-weapons specifically**: add reaction latency and an accuracy
   penalty to the auto-assist (e.g. fires only when a contact is <8s out,
   20% miss chance). Auto-assist should keep an abandoned seat *alive*, not
   *optimal* — that's also what makes seating a human at weapons matter.
2. **Raise burst pressure, not ambient pressure**: more/denser scripted
   `spawnAsteroids` bursts (2-4 simultaneous contacts overwhelm the one-shot-
   per-5.6s fire rate and force evasive/shield play). Ambient spawn-rate
   increases mostly just add busywork.
3. **Make shields a real decision**: shield regen currently makes raised
   shields nearly free. Consider: shields drain slowly while raised, or
   raised shields reduce engine output by ~15% — creating the power-triage
   conversations the design wants.
4. **Then re-baseline**: target ≈ skilled 90-100% arrival / 75-90 hull,
   novice 70-90% arrival / visible scarring, auto 30-60% arrival on the
   baseline mission and worse on kepler-rescue.

---

## Re-baseline: gameplay-overhaul pass (2026-07-11)

This supersedes the numeric targets above. The overhaul made mission length a
`MissionDef` parameter (`targetSeconds`, via `pacingFor()` in `mission.ts`,
`SPEED_CALIB = 325`) and retuned the mechanics. Current constants of note
(`src/engine/game.ts` unless noted):

- Laser: `LASER_CHARGE_RATE = 7` (halved — ~2x slower refire per weapon-power).
- Breakers: a tripped system is **fully offline** (`eff() → 0`, was ×0.5).
- Sensors: `SENSOR_BASE = 8`, `SENSOR_PER_POWER = 2` (per-point range nerfed
  from 10/4; 2 power ≈ 12s ≈ 60% scope radius).
- Nav gates: `GATE_BASE_WINDOW/ENGINE_WINDOW = 12/18` (tighter),
  `GATE_REACH = {8,13}` (faster), speed-coupled approach
  (`GATE_CLOSE_BASE/SPEED = 0.5/2.0`), and a `GATE_SLIPSTREAM_MULT/SECS =
  1.6/4` speed burst replacing the old flat progress bump.
- Auto-assist (bots): `AUTO_WEAPONS_REACT_RANGE = 7`,
  `AUTO_WEAPONS_MISS_CHANCE = 0.38`, `AUTO_HELM_THROTTLE = 70`,
  `AUTO_HELM_CORRECTION = 5`, `AUTO_ENG_RESET_AGE = 9`.

Length model: `targetSeconds` → `speedScale = 325/targetSeconds`,
`parTime = round(1.35 * targetSeconds)`. Ambient hazard pacing is intentionally
**not** length-scaled (per-minute intensity stays constant; a longer mission
just runs longer with more total events). Authored: supply-run 180, kepler 150,
mined-corridor 260; gen short/standard/long 180/240/300.

Lab targets now met (`npm run lab`, 10 seeds/cell):

- **skilled**: ~100% arrival, hull ~55-85, time within ~10-20s of target
  (supply 183s/180, kepler 159/150, gen:long 301/300 — the 3-min→5-min span).
- **novice**: 10-80% arrival, visibly scarred.
- **auto (all-bot)**: loses — 0% on most missions, scraping in at 1-3 hull on
  the two easiest.
- **one human + 3 bots** (new mixed lab scenarios): a human at **weapons**
  wins ~70-80% with low hull (15-35) on standard-length missions; a human at
  helm or engineering mostly can't overcome bot weapons — weapons is the
  survival-critical console by design.

Per-console + captain-coordination metrics are in `telemetry.perConsole`
(sim-report only) and shown in the lab's second table.
