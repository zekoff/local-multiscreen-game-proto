# 10 — Post-Playtest Revision Report (2026-07-11)

The three-phase revision pass, run end-to-end in one session: (1) a fresh
audit against `GAME_DESIGN_DIRECTION.md`, (2) the post-playtest fix list,
(3) simulated playtest iterations, tuning, and this report. Every work
package passed the full verification ladder (`typecheck`, `checks` [new],
`smoke`, `smoke:cf`, `lab`, headless browser drives) before its commit.

## Phase 1 — Design-direction audit

Full findings: `docs/design/09-design-direction-audit.md`. Headline: **no
major architecture disconnects** — missions-as-data, difficulty-as-parameter,
runtime-agnostic engine, independent rooms, and non-binary outcomes all hold.
Experience-level gaps found were the same ones the playtest surfaced, all
addressed in Phase 2. Nothing required pausing the run.

**Watch items left for the owner** (no action taken):
1. **Music phase 3 ("driving beat") vs "sparse, ambient" guidance** — still
   needs a real-device listen; capping the build at phase 2 is a one-line
   change if it fights the aesthetic.
2. **Engine hum** — in the design's diegetic list, deliberately not added
   (playtest praised sparseness).
3. **Weapons stress ceiling** — highest-stress seat; watch whether it
   excludes lower-skill players in future playtests.

## Phase 2 — the fix list

### Bug verdicts

| Report | Verdict |
|---|---|
| "Laser recharges very slowly late in the game" | **Not an engine bug — root cause found and removed.** New `npm run checks` proves the rate is exactly `7 × weapon power`/s, independent of mission time, and recovers cleanly after a breaker reset. The felt slowness was the (since-reverted) full-offline breaker rule: a tripped weapons breaker halted recharge entirely, and late-game Emergency Warps trip every breaker at once. Tripped now = ×0.5, and the regression check pins the contract. |
| "Scope taps sporadically don't register" | **Confirmed and fixed.** The hit target was a fixed 16px circle on a moving sprite in a phone-downscaled scene. Replaced with a scene-level nearest-blip-within-36px hit test + larger blips. Verified headless: taps acquire reliably. |
| "Delay between station action and visual response" | **Confirmed and fixed.** Only the target tap was optimistic. A shared intent overlay (`public/js/optimistic.js`) now makes every station control land visually at tap time (shields, fire, power pips, breaker restore, throttle echo, warp, nudge ack); server rejections revert silently within 3 snapshots. 9/9 headless assertions. |
| "Destroyed ship shows a win screen" | **Confirmed and fixed.** `debrief.outcome` was serialized but never read by any client. Destruction now shows a red **SHIP LOST** header on every page; arrival keeps the standard debrief. |

### Changes, briefly

- **Breakers**: tripped = ×0.5 (not offline); hull-damaging impacts trip a
  random breaker (shield-absorbed hits don't — good shield play spares the
  engineer); ambient random trips ~50% rarer; equal-height breaker widgets
  (no panel reflow); allocated pips on a tripped system render hollow.
- **Power**: pool 6 → 7, default split `{engines 3, shields 1, weapons 2,
  sensors 1}` (the "extra engine point"); per-system cap stays 4.
- **CPU crew**: no miss chance — every auto shot lands after a deliberate
  seeded 1-2s pause (so a human engineer pumping weapon power visibly helps a
  bot gunner); shields raise only for 2+ rocks within 5s, drop 3s after
  clear; breakers reset in 4s; helm makes a weak (3°/s) attempt at slipstream
  rings — near-heading rings are catchable, far ones aren't.
- **Intro mission — "First Flight: Shakedown Cruise"**: scripted rock at
  t=20s, guaranteed ring at t=40s (new `spawnGate` event action), then
  procedural with the concurrent-rock cap ramping 1 → 2 → 3 (new
  `setMaxAsteroids` event action; 3-at-once only in the final third). Gentle
  damage/drift; tops the lobby list. Framed as the crew's first day aboard.
- **Sensors/viewscreen**: ambient rocks spawn ≥18s out (beyond the 16s max
  passive sensor range) and render star-sized until inside sensor reach —
  the captain has to spot them; a pulse still reveals everything.
- **Main screen**: captain HUD is now a TV-readable bar across the top
  (tripped systems flagged ×½); toasts slightly smaller.
- **Thematic resonance** (from the new playtest feedback): optional ship
  naming at launch — the name flows into the log, the main-screen header,
  and debrief narratives, and is stored in the debrief record (future career
  history). Mission story beats added so the *why* stays present mid-run.

## Phase 3 — simulated playtest iterations

Five iterations: (1) post-rebalance sweep, (2) toolchain-fix sweep,
(3) recalibration sweep, (4) 20-seed confirmation, (5) full-UI headless
playtest (4 pages, first-flight to debrief, zero console errors).

**Iteration findings and actions:**
- *Iter 1*: rebalanced CPU met "barely arrives" on supply-run — but the lab's
  own skilled-**engineer** bot underperformed the all-auto crew (38% vs 100%
  arrival). Root cause: a stale 6-point combat split that starved engines
  almost permanently. Fixed the policy (7-point splits, calmer triage) —
  a toolchain fix, not an engine fix.
- *Iter 2*: orderings restored everywhere. New finding: skilled runs landed
  ~20% **under** `targetSeconds` — the 7th power point outdated the pacing
  calibration. `SPEED_CALIB` 325 → 260.
- *Iter 3+4*: exit criteria met and confirmed at 20 seeds.

**Final balance (20-seed confirmation, key rows):**

| mission | crew | arrived | score | hull | time (target) |
|---|---|---|---|---|---|
| first-flight | novice | 100% | 86 | 100 | 152s (150) |
| first-flight | auto | 100% | 79 | 92 | 173s |
| supply-run | skilled | 100% | 87 | 90 | **183s (180)** |
| supply-run | auto | **60%** | 31 | **16** | 215s |
| supply-run | 1h-helm/eng/weap | 75-90% | 46-49 | 26-48 | — |
| supply-run | 2h-helm-eng | 95% | 55 | 40 | 192s |
| kepler-rescue | auto | 40% | 24 | 6 | — |
| gen:long | auto | 0-20% | ~20 | ~0 | — |

- **"CPU-only crew barely makes it to the station"**: met — 60-70% arrival
  with hull ~16 on the baseline; hard missions still defeat bots.
- **Weapons-linchpin softened**: two humans with a *bot* gunner (95%, score
  55) now beat any single-human crew — helm/eng play registers in outcomes.
- **Skilled pacing on target** across all missions (183/180, 240/240,
  254/260, 307/300).
- **First-flight is strictly the easiest** for every profile — even a fully
  AFK human crew survives it (barely), which is right for a tutorial.

**Toolchain improvements** (owner item "improve the ability to simulate"):
new `npm run checks` (deterministic mechanics contracts); fixed + modernized
the skilled-engineer policy; new `2h-helm-eng` lab scenario; new
`chargeIdlePct` weapons metric (share of the mission the laser sat fully
charged — reads as "the trigger, not the recharge, is the bottleneck").

**Known toolchain artifact** (not a game bug): the over-the-wire smoke bots
miss nearly all gates because they run at `GAME_SPEED=10` — 2-3 decisions per
gate approach. The in-process lab (real tick cadence) is the balance
reference; smoke remains the transport regression test.

## Assumptions made mid-run (flagged for review)

1. **Scripted set-piece bursts** were raised to 12-16s spawn distance (not
   ≥18s like ambient) — full compliance would defang authored "sudden wave"
   emergencies. Say the word and I'll push them out too.
2. **"One more engine allocation point"** was implemented as pool 6 → 7 with
   the default split gaining the point on engines (per your plan answer);
   the engines *cap* stays 4.
3. **Tripped-pip visual**: hollow accent outline reads "allocated, half
   effect". The label says HALF POWER (matching the ×0.5 revert) rather than
   the requested "not functioning", since the revert made half-functioning
   the truth.
4. **AFK-manned seats** still get no auto-assist (unchanged semantics) — the
   full-UI playtest surfaced how punishing that is outside the intro. See
   proposal #4.

## Proposed future improvements (ranked)

1. **Captain's console upgrades (main screen)** — the playtest says
   communication *is* the game; give the captain more to call: a projected
   threat timeline ("two rocks converge in ~15s"), gate countdowns on the
   HUD bar, and a post-run "orders vs outcomes" debrief panel from the
   existing coordination telemetry.
2. **Mission variety beyond asteroids** — the engine's event system now
   supports scripted gates/caps; add 1-2 new incidental-obstacle *types*
   (ion storm that degrades sensors; a convoy escort that must stay within
   range) to break the shoot-the-rock monoculture. Each is `action()` +
   `tick()` + `serialize()` + a MissionDef knob.
3. **Science/Comms half-console** — a fourth crew role for larger groups,
   built as view-plus-one-verb (e.g. scanning a contact reveals its
   composition/weak point, buffing the next laser hit) so it stays vital but
   low-dexterity — fits pillar 1 and the varied-skill mandate.
4. **AFK grace** — if a *connected* seat sends no action for ~20s mid-crisis,
   fade in auto-assist (with a station toast saying so). Protects real living
   rooms from the bathroom break; parameter-shaped, not a new code path.
5. **Difficulty presets surfaced at launch** — per-seat chill/normal/intense
   exists but is buried in the join URL; a lobby row on the main screen would
   make the varied-skill-crew pillar visible to the party.
6. **Persistence Phase A** (`docs/design/07`) — the debrief record is already
   self-contained (now including ship name); a simple career log (KV per
   crew) is a weekend-sized step.
7. **Mission-in-progress DO storage** (`docs/cloud-migration.md` Phase 3) —
   deploys still reset live games to lobby.

## GAME_DESIGN_DIRECTION.md updates to consider (owner-maintained)

- The captain section could name the **ship's identity** (naming ritual) as
  part of the shared fiction — it's now in the game.
- If "sparse, ambient music" is meant strictly, consider stating whether a
  late-mission rhythmic build is inside or outside that guidance (watch
  item #1).
- The pillars could make explicit that the CPU fills empty seats *slowly
  rather than incompetently* — it's now a design-relevant property (human
  support visibly helps a bot seat).

## Verification at ship time

`npm run typecheck` ✓ · `npm run checks` 10/10 ✓ · `npm run smoke` ✓ ·
`npm run smoke:cf` ✓ · `npm run lab` clean (no stalls) ✓ · headless UI
drives: WP5 9/9, WP6 8/8, ship-name flow, full-UI playtest — all ✓, zero
console errors on any page.
