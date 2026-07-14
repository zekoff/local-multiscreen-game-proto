# Console Complexity & Interplay Analysis

Date: 2026-07-13, on the `worktree-expansion-crew-chief` branch, after the
merge-prep pass (breaker-into-power-row, sensor range +50%, E2/S1/W2/Sen2
default, Crew Chief frozen for playtest, Europa Salvage Loop). Purpose: gauge how
much each station has to *do* and *think about*, map the cross-console
dependencies, and note balance shifts. This is a design-load analysis, not a
verdict — the real signal comes from watching people play.

## The current bridge (4 crew consoles + a captain)

- **Helm** — throttle, hold-to-steer alignment, nav-gate/slipstream chasing,
  course-hold trim, Emergency Warp. Holds the tow line steady when Weapons is
  towing.
- **Engineering** — the 7-point power grid across Engines / Shields / Weapons /
  Sensors (max 4 each), breaker restores (now inline on each power row), the
  sensor pulse, power presets. Lowest tap rate, highest decision density.
- **Weapons** — target lock (forward-arc scope), laser recharge + governor
  (standard vs snapshot), the deflector screen (shields as a managed resource),
  **and the tractor beam** (shares the laser emitter — you can't fire while
  latched). The mechanical hotspot.
- **Crew Chief** — deck-ops: commit crew to trim system wear, patch the hull,
  fight typed emergencies. **Frozen (WIP) for the current playtest** — it lags
  the other consoles in fun/usability and is disabled in the lobby (re-enable
  with `?debug`). Analyzed here for completeness; automated systems cover the
  deck when it's unmanned, so its absence is neutral, never a penalty.
- **Captain** (no device) — reads the main-screen threat data the gunner can't
  see, calls target priorities, watches who's in trouble, and orders power
  shifts. A real seat, not a spectator.

## Measured signal (skilled bot crew, from `npm run lab`)

The lab reports per-console *effectiveness*, not raw inputs/min. Representative
skilled-crew rows:

| mission | weap hit% | weap acquire(s) | weap chg-idle | helm gate% | helm on-course | eng power-util | cargo | captain coord |
|---|---|---|---|---|---|---|---|---|
| supply-run | 100% | 2.1 | 33% | 100% | 78% | 99% | 0.0 | 0.91 |
| mined-corridor | 100% | 2.7 | 46% | 100% | 77% | 99% | 0.0 | 0.88 |
| first-contact | 100% | 1.4 | 74% | ~100% | 81% | 99% | 0.5 | 0.93 |
| gen:europa | 100% | 2.9 | 33% | ~100% | 82% | 99% | 2.8 | 0.86 |

Reading it: **weapons stays the mechanical hotspot** — low acquire latency and
low charge-idle mean it's firing near-continuously; on salvage runs (Europa) it
*also* works the tractor, so its load is highest there. **Engineering's
power-util pins near 100%** (the pool is always fully committed), which is why
its depth is in *decisions*, not taps. Helm on-course ~78-82% reflects the
constant tension between staying on the fast line and diverting for slipstreams.

## Cognitive load — factors held at once (ranked)

1. **Engineering — highest thinking load, lowest tap rate.** A 4-way triage over
   a 7-unit pool where every unit is a live tradeoff: engines (helm speed +
   turn), weapons (laser refire **and** the tractor's power floor), sensors (how
   early Weapons can detect *and* identify — now reaching ~21s at the default 2
   points, ~27s maxed), shields (regen). Plus inline breaker restores, the
   one-shot pulse, and a full re-power after an Emergency Warp.
2. **Weapons — highest tap load + real prioritization + a mode/emitter choice.**
   Targetable-gated contacts, recharge timing, standard-vs-snapshot governor,
   shields-as-resource, and the tractor (which forfeits the laser while latched).
   Because the scope shows *only names and a POD/ORE/? tag*, Weapons depends on
   the captain (or the main-screen pod beacon) for threat priority.
3. **Helm — a genuine tension, understated by bots.** Course-0 speed vs a gate's
   off-axis bearing for the slipstream; to turn onto a gate you ease throttle or
   ask Engineering for engine power. Now also holds the bow steady while Weapons
   tows (the bot helm favors the tractor target over slipstream chasing).
4. **Captain — a real coordination seat.** Threat colours, pod beacons, and the
   HUD live on the shared screen only; prioritization is a spoken hand-off.
5. **Crew Chief (frozen) — allocation-under-scarcity, but thin.** Commit-hands-
   to-posts with diminishing returns is a clean idea, but in play it reads as
   upkeep bookkeeping more than a fun loop, and it doesn't surface on the crew
   HUD. Deferred until it earns its seat (see the Library TODO's Crew Chief
   group).

## Interplay map (who depends on whom)

- **Engineering → everyone.** Power is the master dial: engines (helm), weapons
  (refire + tractor floor), sensors (Weapons' detect/ID window), shields (regen).
  A tripped breaker visibly halves that system until restored.
- **Weapons ↔ Helm (tow tension, new).** Latching the tractor forfeits the laser
  and asks Helm to hold a line — so towing salvage means trusting the rest of the
  crew to keep the sky clear. Running engines hot also closes asteroids faster,
  shrinking Weapons' window.
- **Captain / main screen → Weapons.** Pods now show their beacon on the main
  screen well before sensors ID them (POD_VISUAL_RANGE), so the captain's eyes
  are an *earlier* don't-shoot channel than Engineering's sensors — the confirm-
  before-fire ritual has two independent paths.
- **Engineering ↔ Weapons.** Sensor power sets the detect/ID window; weapons power
  sets refire *and* powers the tractor; a sensors/weapons breaker cripples both.
- **Emergency Warp = coordinated recovery.** One helm press scatters the ship;
  everyone reacts together.

Net: the graph is dense and directional (Engineering feeds everyone; Helm and
Weapons now trade off through both the shared physics *and* the tractor). Good
cross-talk for a co-op bridge — but it raises the floor for a first-time crew,
and the tow loop currently piles onto the already-busiest console.

## Balance & design observations

1. **All-bot floor dropped this pass.** The E3→E2 default slows the *empty* ship,
   lengthening auto runs and spawning more rocks than a bot gunner clears:
   supply-run / gen:standard all-bot arrival went ~30% → **0%**. Skilled and all
   single-human profiles are unaffected (skilled on-target; 1h-weapons still
   carries a bot crew to 100%). If the pure-bot floor matters, keep the *CPU*
   auto-engineer target at engines 3 while humans start at 2, or nudge
   `SPEED_CALIB`. Owner tuning call.
2. **Weapons is over-loaded on salvage runs.** Laser + shields + governor + tow on
   one console, and the playtest called for separating the tractor. Revisit once
   Crew Chief is unfrozen (the tractor could return to a dedicated seat).
3. **Sensor range +50%** gives more reaction time but shrinks the "spot the dim
   dot before sensors resolve it" window on missions whose ambient `impactIn`
   sits inside the new detection range (~21s default). Watch whether contacts now
   feel like they appear pre-resolved; if so, push ambient spawn distances out.
4. **Captain-dependence of Weapons** remains: no engaged captain = flying half-
   blind on priorities. The main-screen pod beacon helps for don't-shoot, but
   rock threat colour is still main-screen-only. A fallback scope tint is a cheap
   safety net if playtests show captain-less crews struggling.
5. **Crew Chief needs a rethink, not just polish** (frozen for now): make trim a
   per-system *bonus* rather than an ever-present penalty, put the chief on the
   crew HUD, and give it a loop worth a seat.

## Tunable constants (top of `src/engine/game.ts`)

`LASER_CHARGE_RATE`, `WARP_*`, `BASE_TURN`, `SENSOR_BASE`/`SENSOR_PER_POWER`/
`SENSOR_ID_BASE`/`SENSOR_ID_PER_POWER`/`SENSOR_PULSE_COOLDOWN`, `POD_VISUAL_RANGE`,
`GATE_*`, `SPEED_RISK`, `TRACTOR_*`, `STRIKE_CLEAR_*`, and the per-rock size/speed
ranges in `spawnContact`. The default power split (E2 S1 W2 Sen2) is in `start()`;
mission pace derives from each mission's `targetSeconds` via `SPEED_CALIB`.
