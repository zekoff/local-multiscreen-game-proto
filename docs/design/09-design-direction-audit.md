# 09 — Design-Direction Audit (2026-07-11)

A fresh-eyes audit of the game as built against `GAME_DESIGN_DIRECTION.md`
(the authoritative player-experience guide), conducted at the start of the
post-playtest revision pass. Development history was context; the design
direction was the yardstick. First human playtest feedback (station stress
spread, communication centrality, approachability, sparse-sound-as-perk) is
treated as evidence.

**Verdict up front: no major architecture or design disconnects.** The
codebase's structural pillars — missions as data, per-role difficulty as a
parameter, runtime-agnostic engine, independent rooms, non-binary outcomes —
all hold in the implementation. The gaps found are experience-level, and
nearly all were independently identified by the playtest and are addressed in
this revision pass. Three watch items are flagged for the owner (§5).

## 1. Design pillars

### Pillar 1 — "Every player contributes; varied skill levels on one crew"

**Aligned, with one imbalance being corrected this pass.**

- Per-seat difficulty is a clean parameter (`DIFF_MULT` chill 0.6 / normal 1 /
  intense 1.5, game.ts:22) multiplying each station's burden — exactly the
  "multiplier, not a separate code path" rule. Holds.
- Auto-assist covers abandoned seats through the same action paths. Holds.
- **Imbalance (medium, addressed in this pass):** pre-revision lab data shows
  weapons is the survival linchpin — one human at weapons carries a bot crew,
  but a human at helm or engineering cannot overcome bot weapons. That means
  helm/eng players' contributions matter less to *survival* than the weapons
  player's, a soft pillar-1 violation. The CPU rebalance (no miss chance,
  deliberate fire delay that a human engineer can shorten by pumping weapon
  power) is designed to make helm/eng human play register in outcomes.
- Playtest stress spread (helm lowest, eng medium-high, weapons highest) is
  acceptable — "every player vital" doesn't require equal stress — but worth
  tracking so weapons stress doesn't become a skill floor.

### Pillar 2 — "Cooperation is essential"

**Strongly aligned.** Power triage couples engineering to every other seat;
sensors gate the weapons scope; the slow-down-to-catch-the-ring lever couples
helm throttle to engineering's engine power; shields trade against drive
speed. The playtest confirms the design intent landed: "effective
communication is important; the captain plays an important role." No changes
needed.

### Pillar 3 — "Strategy, situational awareness, console management over reflexes"

**Aligned in design; one implementation bug was undermining it (fixed this
pass).**

- Nav gates were examined as the most reflex-suspect mechanic. Judgment: the
  gate is a *planning* problem by design — `gateCloseRate()` spans 0.5–2.5×
  with ship speed (game.ts:610-613), so the intended counter to a hard ring is
  strategic (ease throttle, feed engines, coordinate with engineering), not
  faster thumbs. A hot-running crew that treats it as a reflex problem is
  experiencing the risk they chose. The pass window (12° + 18° × engine power)
  is generous when the strategic path is taken. **No constant changes
  recommended**; re-evaluate only if playtests report last-second-twitch
  frustration.
- **The scope tap-target bug is a pillar-3 violation as shipped**: a fixed
  16px hit circle on a moving blip in a FIT-downscaled scene makes target
  acquisition a dexterity test, which the design explicitly deprioritizes.
  Fixed this pass (scene-level nearest-blip hit testing).
- The 250ms perceived input latency also cuts against "console management"
  feel (a console that lags doesn't reward mastery). Fixed this pass
  (optimistic-intent layer).

## 2. Aesthetic guidance

- **Stylized, clean, futuristic** — holds (flat-color canvas viewscreen,
  procedural starfield, no photoreal assets, no greebles).
- **Detail/juice without clutter** — mostly holds; the two clutter sources
  found (oversized main-screen toasts, breaker-panel reflow when a breaker
  trips) are both on this pass's fix list.
- **Sparse, ambient music** — the music bed's phase 3 adds a *driving beat*
  after ~120s. This may exceed "sparse, ambient" — but the playtest called
  sparse sound a perk. *(Update 2026-07-12: audio has since been verified on a
  real device and the mix/feel is good — this watch item is closed.)*
- **Diegetic SFX** — good coverage: breaker trip/arm/tick/restore (the
  "breaker flipping" the design names), laser, gate chimes, sensor pings,
  warp, hull booms, per-device routing. **Gap (minor, note only): no engine
  hum**, which the design lists as an example. Deliberately not added this
  pass — the playtest praised the sparseness, and a continuous hum is the
  riskiest addition to that quality. Owner's call (§5).

## 3. Real-world user experience

Phones/tablets as consoles + shared TV main screen + QR join + screen-less
captain: implemented as designed. Reconnection is first-class. The captain
HUD existed but was sized for a monitor, not a living-room TV — legibility
fix is on this pass's list. The captain's information supply (per-station
HUD rows, resolved-contact labels on the viewscreen, scope showing names
only so the captain calls priorities) matches the "captain's console is the
main display" intent.

## 4. In-game structure

Missions with objectives + incidental obstacles, authored + procedural,
non-binary outcomes: all present. Two experience gaps, both already queued:

- **Outcome legibility:** `debrief.outcome` (`arrived`/`adrift`) is computed
  and serialized but no client reads it — destruction and triumphant arrival
  show identical debrief chrome. Non-binary scoring is a design pillar, but
  ship-lost vs ship-arrived is the one binary the fiction demands. Fixed this
  pass.
- **Thematic resonance (playtest's "important next step"):** briefings are
  two well-written sentences and debrief narratives are score-keyed flavor,
  but nothing characterizes the crew's ship or sustains the fiction
  mid-mission. Addressed this pass (ship naming, mission story beats, richer
  briefing framing).

## 5. Watch items for the owner (no action taken)

1. **Music phase 3 ("driving beat") vs "sparse, ambient" guidance** — RESOLVED
   (2026-07-12): verified on a real device, the mix is good. (If ever revisited,
   capping the build at phase 2 is a one-line change in `public/js/audio.js`.)
2. **Engine hum** — the design's diegetic list includes "engines humming";
   playtest praised sparseness. Add only if the fiction needs it.
3. **Weapons stress ceiling** — highest-stress seat today; if future playtests
   show it excluding lower-skill players, consider a chill-difficulty-specific
   assist (still parameter-shaped, e.g. wider auto-acquire) rather than a
   separate code path.

## 6. Minor items fixed without review during this pass

- `docs/architecture.md` auto-assist description drifted from code (said 80%
  throttle / 6s breaker resets; code was 70 / 9s) and its "tripped breakers
  halve a system" line was false while eff() zeroed tripped systems. Both
  corrected as part of this pass once the new auto-assist and ×0.5 values
  landed (single doc update, no churn).
- Stale trip message "at half power!" (game.ts) — becomes accurate again with
  the ×0.5 revert; wording verified in WP2.
