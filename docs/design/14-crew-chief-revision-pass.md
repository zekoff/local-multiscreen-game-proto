# 14 — Crew Chief Revision Pass: Session Debrief (2026-07-12)

A large, phased revision of the Crew Chief expansion, driven by the owner's
Playtest-2 notes (`~/The Library/2 - Workspace/Bridge Crew/2026-07-12 Bridge
Crew Playtest.md`) and a batch of directed UX / Gameplay / Thematic changes.
Delivered on branch `expansion-crew-chief` (draft PR #7) across ten committed,
individually-verified phases. **Committed + pushed, NOT merged** — the owner
decides merge-vs-discard.

Framing decision locked this pass: **Option 2 — elite flagship officers.**

## What shipped, by phase

0. **Foundations.** Difficulty collapsed from chill/normal/intense to two
   settings — **Cruise** (0.6, lighter) and **Officer** (1.0, the balance
   target). Text selection disabled everywhere (it's a control panel).
1. **Tractor → Weapons emitter.** Removed the tractor as a dedicated 5th power
   system (pool 8→7); its reel now draws **Weapons** power, and the **tow
   command moved to the Weapons console** (the gunner's own "tow or shoot?"
   call — no longer blocked by another seat). Forgiving arc alignment (closer =
   faster reel); reel progress persists across releases.
2. **Crew Chief redesign.** From a thin damage-control board to a real deck-ops
   console: passive **system wear/trim** upkeep, **committed crew** on deploy
   posts (add-only, diminishing returns), a **hull-repair bay**, and richer
   **typed emergencies** (fire = hull DoT, breach = anomaly glitch, boarders =
   phantom sensor blips, leak = trim wobble). **Optional seat, no CPU chief in
   the fiction** — automated systems handle it when unmanned; a *connected*
   chief widens the score (competent lifts, negligent drags, absent is neutral).
3. **Three-threshold identification.** Contacts resolve no-HUD → trackable
   `???-NNN` (number only) → identified `CLASS-NNN`. Rocks no longer self-ID at
   detection, so the don't-shoot puzzle is real for every kind and the captain
   reads silhouettes before the sensors letter a contact.
4. **Weapons scope → forward arc.** 360° radar replaced by a forward fan mapped
   to the viewscreen FOV (contacts by real bearing). Scroll-through fixed.
   Snapshot ticks on the gauge; snapshot now cracks **most** rocks — only
   genuinely large ones survive, and the scope hides size so only the **captain**
   can call the big ones.
5. **Main-screen feel.** Parallax nebula depth; a reusable **notification /
   red-alert framework** (ongoing effects, upcoming events); **mission-end
   fades** (win→white, loss→black, destruction→red→black); no red flash on a
   missed gate; softer slipstream; a bigger alpha-blue **deflector arc** that
   shrinks with charge; **COLLISION** banner + heavier shake; per-contact
   **shrinking range ring** (distance cue); no perfect convergence; captured
   salvage animates to the cargo bay, passed-by contacts fade; **velocity** on
   the HUD; dimmer blackout; ion crackle; clearer obstacle-collision read.
6. **Widget de-dup.** Cross-console status duplicates removed (vitals/power live
   on the main screen); inline power readouts where they bite (weapon power on
   the bank, shield power on the deflector, engine power on the helm), with
   NO-POWER calls. Also fixed a Phase-1 miss (engineering still listed tractor).
7. **Ready-room / GO-poll.** New lobby protocol in **both transports**: per-seat
   `ready` + GO-poll (button reports GO until all manned seats are ready, then
   launches), a **Systems Checkout** semi-transparent ready room previewing the
   console, **Leave Console** (release the seat), landing-page **grey-out** of
   taken consoles, and soft ready-room beeps.
8. **Pacing retune (1× kept).** Wider speed tiers (SLOW crawls = strategic
   response time, FAST bears down hard) and smaller rock sizes (snapshot is the
   smart default). Re-baselined at Officer — skilled crews on-target, all-bot
   floor back to "barely arrives".
9. **Thematic (elite flagship).** Officer name chips (console headers +
   main-screen HUD); elite Sector-Command **debrief sign-off + consequence
   beats**; **hailing channel** (via the cinematic) + red-alert; **voice of the
   ship** computer lines (deterministic); faint **distant traffic**; **First
   Contact** rebuilt around the now-real don't-shoot puzzle.
10. **CPU / debug / tests.** Debug **crew-skill slider** (0–100% bot quality for
    solo playtesting), a **spawn dropdown + single button**, and a **Free Flight
    (debug range)** mission (no ambient spawns). Bot policies + engine
    auto-assist updated throughout. Checks expanded 16 → **33**.

## Verification

- `npm run typecheck` (Node + Worker), `npm run checks` (**33** assertions),
  `npm run smoke` (Node) + `npm run smoke:cf` (Workers), `npm run lab` — all
  green; lab re-baselined (skilled 92–100, all-bot floor "barely arrives").
- Headless (Playwright): all consoles + main screen load, launch, and run with
  **zero** console errors; the scope arc, deck board, mission visuals, GO-poll
  flow, and officer chips were confirmed visually.

## Balance snapshot (Officer, `npm run lab`)

- supply-run: skilled 98, auto 33% (barely). mined-corridor: skilled 92, auto
  50%. first-flight (intro): auto 100%/83. lifeboat: skilled 100, auto 100%/47.
- **1h-chief now materially helps** (arrives 100% at 69–89 vs all-auto ~34) —
  the redesigned Crew Chief pays off, the P1/P2 "nothing to do" fix landing.

## Watch items / assumptions for the owner

1. **Crew Chief wear is human-shaped.** Wear only accrues with a human chief
   aboard; a present-but-idle chief is deliberately *worse* than none (the
   incompetent-chief downside). Confirm this reads as intended, not punishing.
2. **All-bot floor** drifted soft mid-pass and was re-tightened via pacing
   (Phase 8), not difficulty — re-check after any further tuning.
3. **Officer names** show on 3 HUD rows (helm/eng/wep); the Crew Chief has no
   HUD row, so its officer name shows only on its own console header.
4. **Free Flight** appears in the normal mission catalog (labeled "debug
   range"); prune from the lobby list if you don't want players to see it.
5. **First Contact** leans on the crew spending its one pulse; without a human
   engineer the bot may not pulse optimally — a real-crew playtest will tell.

## Still open — the ARCHITECTURAL pass (deferred by owner)

These were explicitly held back and remain open work:
- **Full widget portability**: convert helm/engineering/weapons to the
  `public/js/widget.js` abstraction (only Crew Chief + tow are widgetized; the
  others got targeted de-dup edits this pass).
- **Edge-device performance** pass (keep the sim + canvas light on phones).
- **Persistence** (`docs/design/07`) — and with it **T7** (ranks/commendations)
  and the scrappy→flagship **campaign arc**; the debrief consequence beats +
  ship-fund line are already shaped to feed it.
- **First-Contact-style branching** as a general mission mechanic (conditional
  cinematic beats keyed on run state), and the **sun-shields** set piece (T5)
  as a flare/blackout-reskinned mission.
- Sensor-blackout "manual weapons mode" and enemy ships / target health /
  heavy-vs-snapshot damage (backlog, pairs with menu P#2).

## Design-direction note

This pass locked **Option 2 (elite flagship)** and made the crew model **4
consoles + captain** with the Crew Chief now an OPTIONAL fourth station. Please
update **`GAME_DESIGN_DIRECTION.md`** to record: the elite-flagship tone, the
4-consoles-plus-captain crew model, the optional-Crew-Chief principle, and the
Cruise/Officer engagement settings. (I did not edit that file — it's yours.)

---

## Post-playtest batch 2 (2026-07-12, same branch/PR #7)

A second directed batch of fixes from the owner's playtest of the ten-phase
pass above. All on `expansion-crew-chief`; typecheck / 33 checks / smoke /
smoke:cf all green, lab re-swept (see balance note below).

**Gameplay (engine).**
- **Two asteroid classes.** Rocks are now discrete **small** (snapshot-killable)
  vs **large** (~22%, snapshot-proof); `SNAPSHOT_MAX_SIZE` sits cleanly between
  the bands. Large read as a deeper/bigger silhouette on the main screen.
- **Strike geometry.** A rock now STRIKES unless the helm steered it out to the
  screen edge — `|alignment - bearing|` past a per-class clear window
  (`STRIKE_CLEAR_SMALL/LARGE`, large wider) is a clean miss (feeds the long-dead
  `stats.dodged`). Bearings only reach ±78, so an un-steered rock always hits:
  the ship is struck across most of the viewscreen, and dodging is a hard,
  course-bleeding fallback to weapons/shields. The main-screen asteroid render
  was reworked to place rocks by `(bearing - alignment)` throughout (no funnel
  to center), so strikes spread and a dodged rock visibly slides off the flank.
- **Bots: optimal at 100%, default 60%.** `crewSkill` now **pivots at 0.6** —
  0.6 reproduces the shipped survival-net baseline (so smoke/lab are unchanged),
  and 1.0 plays *optimally* (no fire delay, active gate-chasing + throttle ease,
  fast breaker resets, snapshotting small rocks). Debug slider defaults to 60%.
- **Bot tow safety.** The auto gunner only auto-tows a **confirmed rescue pod**
  now (salvage/ore is a human call); `setTractorLatch` also requires an
  identified pod/mineral. Fixes "CPU latched ore before it was identified."
- **Fire emergency** lasts longer (`FIRE_CLEAR_DIVISOR`).

**Readouts / feel.**
- Range rings only appear on **acquired** contacts; **ghosts** show on the
  weapons scope but not the main screen (new `phantom` serialize flag).
- Log/toasts trimmed: no weapons-mode cycling, no per-contact acquire/ID lines
  (except **rescue-pod** ID), no Crew-Chief trim spam, and **no Crew-Chief
  callouts when the seat is unmanned** (mission briefings de-referenced too).
- Slipstream/gate rings now interpolate depth between ticks (no per-tick pop).
- Environmental notices moved **below** the captain HUD; asteroid speed text
  removed (the range ring carries closing rate).
- **Debris field** got an in-space visual (tumbling rocks + pings) and a clear
  red hull-stress flash; the generic COLLISION banner is now reserved for heavy
  strikes.
- Crew-Chief deck board shows the **drift impact** (e.g. "−6% recharge"); the
  squirt-gun weapons icon swapped for 🎯.
- Weapons **fire button disables to "TRACTOR BEAM ENGAGED"** while latched.
- Weapons-scope font sharpened (Phaser `Text.setResolution`).
- **Ready room is now a top banner** — the console is live/interactive while
  waiting (was a blocking overlay); GO-poll + tutorial button retained.
- **Debrief** simplified: short generic narrative, qualitative grade on its own
  line with a **labeled** score, **SHIP DESTROYED** as the grade on a loss,
  breakers-tripped line removed.

**Audio.** Now **verified on a real device — the mix/feel is good** (the docs'
"code-verified / not heard" caveats are cleared).

**Balance note (lab).** Skilled crews stay on-target (96–100) and the supply-run
all-bot floor still "barely arrives" (~30%, low hull). `mined-corridor` auto
drifted up (~50%→~80%) but average per-rock damage is ~unchanged by the
two-class split, so this reads as seed-boundary noise on a marginal mission, not
the designated floor — flagged for the owner to confirm at playtest. Helm turn
authority was intentionally left untouched; if the new strike geometry makes
dodging feel impossible, tune the clear windows (or turn authority) then.

**Still owner's to do:** update `GAME_DESIGN_DIRECTION.md` (above) — unchanged by
this batch.
