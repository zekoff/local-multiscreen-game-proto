# CPU crew (auto-assist) — effectiveness findings & improvement backlog

Recorded from an Europa study run **2026-07-18**. These are **not yet implemented**
— a backlog of ways to make the unmanned-seat auto-assist ("CPU crew") more
effective, ranked by measured impact. The auto-assist is deliberately mediocre by
design (empty seats should let a mission *be completable*, not played optimally),
so any change here is a tuning decision, not a bug fix.

## Method

In-process Europa runs (`gen:europa`), **crewSkill = 1.0** (auto-assist at its
ceiling), 16 seeds per crew config. `skilled` seats are policy-bots; the rest run
the engine auto-assist. Crew Chief is frozen, so it's always auto.

| config | arrive% | score | hull | destroyed | impacts | gatePass | salvage | pods | coord |
|---|---|---|---|---|---|---|---|---|---|
| **all-auto** (pure CPU) | 94% | 52 | 58 | 53.7 | 5.8 | 75% | **2.6** | 0.9 | 63% |
| 1h-helm | 94% | 53 | 57 | 38.2 | 6.8 | 100% | 1.3 | 0.4 | 68% |
| 1h-eng | 100% | 66 | 79 | 55.8 | 2.6 | 71% | 2.8 | 0.9 | 64% |
| **1h-weap** | 100% | **86** | **93** | 60.6 | 2.4 | 65% | **9.4** | 0.4 | 69% |
| 2h-helm-weap | 100% | 86 | 92 | 44.1 | 2.7 | 100% | 6.4 | 0.4 | 79% |
| 2h-helm-eng | 100% | 73 | 85 | 38.9 | 2.6 | 100% | 2.3 | 0.8 | 72% |
| full3-human | 100% | 76 | 97 | 43.3 | 0.8 | 100% | 2.6 | 0.1 | 84% |

## What the numbers say

- Even at 100% effectiveness the **pure CPU crew only scores ~52** (arrives 94%,
  hull 58, impacts 5.8) — it survives but doesn't thrive. Working as designed.
- **Weapons is the CPU's weakest console by far.** A skilled human gunner
  (`1h-weap`) lifts score 52→86, hull 58→93, and **salvage 2.6→9.4**.
- **The auto-gunner barely tows salvage** — the single biggest score gap on a
  salvage-scored mission. By design it only auto-tows *confirmed rescue pods*, never
  ore ("a human judgment call").
- **The auto-engineer is a real drag.** `1h-eng` cut impacts 5.8→2.6 and lifted hull
  58→79 — the CPU engineer under-powers systems and is slow on breakers.
- **A skilled helm alone doesn't help survival on this mission** (`1h-helm`: more
  impacts, fewer kills) — chasing slipstream rings speeds the ship and steals the
  gunner's time. Helm quality helps coordination, not hull, on a combat/salvage loop.

## Improvement backlog (ranked)

1. **Let the auto-gunner tractor identified SALVAGE, not just pods.**
   Highest impact (≈+7 salvage on Europa). Mirror the existing pod auto-tow: when
   the sky is clear of imminent rock threats and the hold has room, latch an
   *identified* mineral in the tractor arc. (`game.ts` auto-weapons block,
   ~`:1662-1676` — currently gated to `kind === 'pod'` only.) Note: this softens a
   deliberate human-cooperation hook; keep it slow/opportunistic so a human gunner
   still out-salvages the bot.
2. **Smarter auto-engineer power + breakers.** Shift power toward weapons/shields
   under active threat, ease it back when clear; restore tripped breakers faster.
   (auto-engineering reallocator ~`game.ts:1596-1602`; `AUTO_ENG_RESET_AGE`.)
3. **Tighter auto-gunner threat clearing.** Prioritize soonest-impact contacts and
   fire snapshots on small rocks to clear volleys faster (cuts impacts 5.8→~2.4).
   (auto-weapons fire/target selection ~`game.ts:1600-1660`.)
4. **Context-aware auto-helm.** On combat/salvage loops (no salvage/nav objective
   pressure), hold a steady course and feed engines instead of gate-chasing, so the
   gunner gets firing time. On nav-scored missions, keep chasing rings.
   (auto-helm ~`game.ts:1503-1540`.)
5. **Auto Damage Control.** With Crew Chief frozen, nobody auto-heals. Have the
   auto-engineer engage the new hull-breach seal (`sealing`) when hull < 50% and no
   imminent threat, so the CPU crew can claw back from the brink on its own.
   (new field `this.sealing`; auto-engineering block.)

## Re-running the study

The one-off harness was deleted after the run; `npm run lab` (with
`LAB_MISSIONS=gen:europa`) sweeps the same configs, though at the *default*
crewSkill rather than 1.0. To reproduce the 100% numbers, set `game.crewSkill = 1`
after `game.start(...)` in an in-process loop (see git history for the throwaway
`scripts/_europa_test.ts`).
