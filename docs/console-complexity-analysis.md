# Console Complexity & Interplay Analysis

Date: 2026-07-11, after the wave-2 flight-model / sensors / warp / asteroid
changes. Purpose: gauge how much each station has to *do* and *think about*,
map the cross-console dependencies, and propose balance adjustments before the
human playtest. This is a design-load analysis, not a verdict — the real signal
comes from watching people play.

## Method & the big caveat

Two sources:

1. **Quantitative floor** — ran the skilled bot crew through every mission
   (8 seeds each), counting *meaningful* inputs per console (no-op repeats
   filtered) and the rate of events each console must react to.
2. **Qualitative** — the factors each console must hold in mind at once, and
   the dependency graph between them.

**The caveat that dominates the numbers:** the bots don't chase nav gates,
don't juggle the 4-way power budget, don't manage sensor power, and never warp.
So the measured inputs/min are a **floor**, and they *understate helm and
(especially) engineering* — the two consoles whose new depth is optional-but-
impactful. A real crew does more.

## Measured load (skilled bots, inputs/min = human floor)

| mission | helm | eng | weapons | contacts/min | breakers/min | gates/min |
|---|---|---|---|---|---|---|
| supply-run | 12.9 | 2.3 | 17.7 | 7.9 | 2.3 | 1.7 |
| mined-corridor | 13.4 | 2.4 | 14.4 | 6.7 | 2.4 | 1.7 |
| kepler-rescue | 17.6 | 3.5 | 21.9 | 9.5 | 3.5 | 1.6 |
| gen:short | 13.7 | 2.6 | 16.8 | 7.7 | 2.6 | 1.7 |
| gen:standard | 15.5 | 2.7 | 19.1 | 8.5 | 2.7 | 1.7 |
| gen:long | 15.2 | 2.8 | 19.7 | 8.7 | 2.8 | 1.7 |

Reading it: **weapons is the mechanical hotspot** (highest input rate, driven by
~7–10 contact resolutions/min it must target + shoot, plus shield toggles).
**kepler-rescue is the busiest mission** across the board (it's the hot one).
Engineering's 2–3/min is *only breaker resets* — its real load is thinking, not
tapping (below).

## Cognitive load — factors held at once (ranked)

1. **Engineering — highest thinking load, lowest tap rate.** Now a 4-way power
   triage over a 6-unit budget, where every unit is a live tradeoff:
   - engines → speed **and** turn authority (helm) **and** faster asteroid
     closing (a cost to weapons)
   - weapons → laser refire speed
   - shields → shield regen rate
   - sensors → how early weapons can target (their effective reaction time)
   …plus resetting up to 4 breakers, timing the one-shot sensor pulse, and a
   full re-power after an Emergency Warp. The APM is low but the *decision*
   density is the highest on the bridge.
2. **Weapons — highest tap load + real prioritization.** Targetable-gated
   contacts, laser recharge timing, and shields-as-a-resource (raise around
   threats, drop to recharge/gain speed). Because the scope now shows *only
   names*, weapons **depends on the captain** for threat priority.
3. **Helm — a genuine tension, understated by the bots.** Stay near course 0 for
   speed vs. divert to a gate's 45–88° bearing for the bonus; and to turn onto a
   gate you must ease the throttle or beg engineering for engine power. Plus the
   Emergency Warp go/no-go. A gate-chasing human is far busier than the 13–18
   ipm floor.
4. **Captain (no device) — now a real seat.** Reads the main-screen threat data
   (speed/threat colors that the gunner *can't* see), calls target priorities to
   weapons, watches the captain HUD for who's in trouble, and orders power
   shifts ("more sensors," "pump weapons"). The wave-1 captain was a spectator;
   this one has a job.

## Interplay map (who depends on whom)

- **Engineering → everyone.** Power split is the ship's master dial: engines
  (helm speed+turn), weapons (refire), shields (regen), sensors (weapons'
  detection window). A tripped breaker on any of these visibly degrades that
  console.
- **Helm ↔ Weapons (tension).** Running the engines hot for speed/turning makes
  asteroids close *faster*, shrinking weapons' shoot window. Helm chasing rings
  (wants engine power + speed) can actively make weapons' job harder — a real,
  legible conflict the captain arbitrates.
- **Captain → Weapons (new comms channel).** Threat data is on the main screen
  only; the gunner sees names and positions but not speed/threat. Prioritization
  is now a spoken hand-off.
- **Engineering ↔ Weapons.** Sensor power sets the shoot window; weapons power
  sets refire; a sensors/weapons breaker cripples the gunner.
- **Emergency Warp = a coordinated recovery.** One helm press dumps the whole
  ship into a hole (no power, 4 tripped breakers, no shields/laser, off course)
  — engineering re-powers and resets while helm re-establishes course and
  weapons rebuilds charge. A deliberate "everyone reacts together" beat.

Net: the dependency graph got denser and more *directional* (engineering feeds
the others; helm and weapons now trade off through the shared physics). That's
good for a co-op bridge game — it manufactures the cross-talk that makes the
table fun — but it raises the floor for a first-time crew.

## Balance & design observations / proposals

Ordered by how much I'd want to resolve them before/around the playtest.

1. **Weapons may be over-loaded for a first-timer, and it's captain-dependent.**
   It's the busiest console *and* it lost its own threat data. A crew with no
   engaged captain will fly half-blind on prioritization.
   *Proposal:* keep the captain hand-off as the intended design, but add a
   **fallback minimal threat tint on the scope blips** (color by speed) so a
   captain-less crew isn't lost. Cheap; preserves the captain's value when
   present. Decide at playtest.
2. **Unmanned/short-handed crews are now genuinely punished** (auto 50–70%
   arrival). Great for motivating a full crew, but a **solo tester** poking at
   one station will get wrecked.
   *Proposal:* consider a "practice/chill" default that softens sensor gating +
   damage, or bump auto-sensor range, so one person can explore without dying.
3. **Do players bother with nav gates?** They're now off-course and cost speed;
   the reward is only +2 each (cap +8).
   *Proposal:* watch whether anyone chases them. If ignored, either raise the
   reward (charge/slipstream) or make the occasional gate feel worth the
   diversion. Easy knob (`GATE_*` constants).
4. **Damage swinginess.** Big+fast rocks can hit for ~20+; the shield cap is 35,
   so two big hits in a burst punch through. Intended pressure, but watch for
   feels-bad spikes.
   *Proposal:* if hull feels random in playtest, cap single-hit damage or widen
   the shield cap slightly.
5. **Engineering discoverability.** The station's depth is invisible if a new
   player leaves power at default and never touches sensors. The `det Ns`
   read-out helps, but the sensor→weapons link is a learned connection.
   *Proposal:* watch whether engineers touch sensors unprompted; if not,
   consider a first-mission prompt or a clearer "contacts resolving late" cue.
6. **Emergency Warp downside is severe** (dead in the water while re-powering).
   Correct for a last resort, but confirm it doesn't feel like self-sabotage.
   `WARP_COOLDOWN`/`WARP_HULL_DMG` are the knobs.

## Tunable constants (all at the top of `src/engine/game.ts`)

`LASER_CHARGE_RATE`, `WARP_*`, `BASE_TURN`, `SENSOR_BASE`/`SENSOR_PER_POWER`/
`SENSOR_PULSE_COOLDOWN`, `GATE_*`, `SPEED_RISK`, `BURST_CHANCE`, and the
per-rock size/speed ranges in `spawnAsteroid`. The default power split
(2/1/2/1) is set in `start()`.
