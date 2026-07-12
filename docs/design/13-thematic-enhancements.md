# 13 — Thematic Enhancement Proposals (2026-07-12)

For owner refinement. Two parts: **(A)** a menu of major thematic/UX changes to
pick from, and **(B)** overarching framing options for the crew's identity — your
"are we a scrappy crew or elite flagship officers?" question, made concrete.

Selection bias throughout: the playtest verdict was that **mechanics are fine;
theme is the next step**, and that the fiction is what the kids latched onto
(they named their ship "Artemis XXVI" unprompted). These favor cheap, pervasive
fiction over new mechanics.

---

## A. Major thematic / UX changes

Ranked roughly by impact-per-effort.

**T1. A named, persistent crew & ship identity (cheap, high impact).**
The kids invented "Artemis XXVI" and it mattered to them. Lean in: persistent
ship name + crest/colour chosen once, remembered across runs; optional officer
names per seat shown on the main-screen HUD and spoken in the log ("Helm, hard
to port"). Ties directly into the parked persistence work (`docs/design/07`).

**T2. A framing wrapper around every mission (cheap).**
Each mission already has a briefing; add a consistent **who-sent-us / why /
what's-at-stake** header and a one-line **sign-off** on the debrief ("Sector
Command logs the run"). Makes a session feel like a tour of duty, not a series
of levels. The cinematic state (built this pass) is the delivery vehicle.

**T3. Diegetic captain's chair (medium).**
The captain has no console by design, but the main screen is theirs. Give it a
touch more chair-side fiction: a hailing channel that opens on story beats
(text-to-fiction, not real audio), a "Captain's standing orders" strip they can
cycle (formalizes callouts — this is P#13 territory), and a red-alert state that
visibly changes the bridge (HUD tint, alert klaxon) when things go bad.

**T4. Aftermath & consequence (medium).**
Outcomes are non-binary but currently end at a score. Add short **consequence
beats**: rescued pods send a thank-you on the next run's lobby; a shot pod
follows the crew (a somber line); salvage banked funds a visible "ship fund."
Turns individual missions into a story with memory. Needs the persistence layer.

**T5. Environmental storytelling on the viewscreen (medium).**
The nebula/destination art is already seeded per mission. Push it: derelicts
with readable silhouettes, distant traffic, a sun you must raise sun-shields
against (Elizabeth & Emma Cate both independently invented this — it's basically
the flare/blackout pair reskinned as "the sun blazes the hull, screen up, track
on sensors"). High thematic payoff, reuses systems built this pass.

**T6. Voice of the ship (cheap-medium).**
A light computer-voice persona in the log ("Reactor at 60 percent." "Life
support nominal.") gives the ship character without new mechanics. Text only;
pairs with the existing captain's-log narration.

**T7. Ranks, commendations, a wall (medium, needs persistence).**
Debrief grades become **commendations** that accrue; a crew "service record"
the family can look at between sessions. Kids respond to collections (Jack asked
for "super hard mode" content); this is the meta-progression that rewards it
without pay-to-win — difficulty stays a parameter (`docs/design/07` invariant).

---

## B. Framing: who is this crew?

Your open question. Three coherent options; each is a *tone*, applied through
mission briefings, destinations, the ship's fittings, and the debrief voice —
**not** new mechanics (per-role difficulty and the systems stay identical). Pick
one, blend, or let it be a **campaign arc** (start scrappy, earn the flagship).

### Option 1 — Scrappy independent crew (salvage & rescue outfit)
- **Feel:** a lived-in hauler; you take the jobs nobody else will. Improvisation,
  duct tape, a hold full of other people's cargo.
- **Fits:** the current missions (supply run, lifeboat, salvage claim) already
  read this way; tractor/cargo economics are native; "we punch above our weight."
- **Voice:** wry, working-class, first-name basis. Debrief: "Not pretty. Paid,
  though."
- **Best if:** you want warmth, stakes-are-personal, and the salvage/rescue loop
  to be the heart.

### Option 2 — Elite flagship officers (a prestige vessel)
- **Feel:** the best crew on the best ship; discipline, protocol, high-stakes
  diplomacy. First Contact is *your* kind of mission.
- **Fits:** the cinematic/first-contact content; a cleaner, brighter bridge
  aesthetic; formal callouts ("Aye, Captain").
- **Voice:** measured, professional, ceremonious. Debrief: "Exemplary conduct,
  logged with distinction."
- **Best if:** you want gravitas, ceremony, and the captain role to feel like
  command of something important.

### Option 3 — Frontier patrol / guardians of the Verge
- **Feel:** a small ship holding a big, lawless border. Part rescue, part police,
  part explorer. Between scrappy and elite.
- **Fits:** everything — rescue, salvage, first-contact, and future raider (P#2)
  content all sit naturally in a frontier beat.
- **Voice:** earnest, self-reliant, a little heroic. Debrief: "The Verge holds
  another day."
- **Best if:** you want the widest mission variety to feel coherent under one
  banner (recommended if you're unsure — it accommodates the most content).

### The campaign-arc option (my suggestion to consider)
Start the crew **scrappy** (Option 1) and let the fiction *earn* the flagship
(Option 2) across a career — the debrief consequences (T4) and commendations
(T7) become the vehicle. This makes the scrappy-vs-elite question a **journey**
rather than a fork, and gives the persistence layer a narrative spine.

---

## What this pass already gives you toward the above

- The **cinematic state** (T2, T3, T5 delivery).
- **Rescue / salvage / first-contact** content (all three framings' set pieces).
- **viewImpaired / flare** = the sun-shields mechanic the kids invented (T5).
- Non-binary **outcomes** ready to carry consequence (T4) once persistence lands.

The cheapest high-impact next step, consistent with the playtest, is **T1 + T2**
(names + mission framing) under whichever banner in **B** you choose — little
code, large felt difference, and it sets up the persistence work already parked
in `docs/design/07`.
