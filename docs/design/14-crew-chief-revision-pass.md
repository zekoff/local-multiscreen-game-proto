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
