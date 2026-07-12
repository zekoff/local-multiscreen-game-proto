# 12 — Crew Chief Expansion Pass: Session Debrief (2026-07-12)

A single large iteration pass implementing a batch of proposals from
`docs/design/11`, driven by Playtest 2 (the owner's three children) and the
directive that **thematic/narrative resonance is the most important next step**.
All work is on branch `expansion-crew-chief` — committed, pushed, and deployed,
but **NOT merged**. This is an exploratory swing the owner may or may not keep.

## Headline

The game gains a **fourth crew station — the Crew Chief** — with a tractor
beam/cargo hold and a damage-control crew board; a **typed-contact + sensor
identification system** that makes "confirm before you fire" a real crew ritual;
a **cinematic dialogue state** for competing objectives; five new missions
(one flagship); topology (steer-around obstacles, off-screen fallback); a
**portable-widget architecture** for re-arranging console functions later; and
a raft of console quality-of-life features straight from the playtest notes.

## What shipped, by area

### New console: Crew Chief (`crewchief.html`)
An exclusive 4th crew seat (bot-fillable). Home of:
- **Tractor beam + cargo hold** (P#1): latch a detected pod/salvage, reel it
  into a hold. Latching needs tractor power (Engineering) and the helm holding
  the contact's line, and **blocks the laser while latched** (shared emitter —
  a real Weapons↔Crew-Chief negotiation). Cargo mass drags maneuverability
  (P#23); jettison to recover it.
- **Damage-control crew board** (P#6): a small roster of crew tokens assigned to
  fires / boarders / breaches. Pure allocation under scarcity — the lite-RTS
  idea was assessed and **rejected** for pillar-3 (strategy-over-reflex) fit.
- Built entirely on the new **portable widget** abstraction (see below).

### Contact types + sensor rework (P#3)
- Contacts now carry a `kind` (`rock`/`pod`/`mineral`/`ghost`), mission-scriptable
  via a generic `spawnContact` event.
- **Detection vs identification split.** Detection (a blip on the scope) reaches
  a little further than before; identification (the true kind) needs a tighter
  range or a sensor pulse. **Rocks self-identify at detection** (inert/obvious,
  so no combat penalty); pods/minerals/ghosts stay `UNKNOWN` until close or
  pulsed — so an `UNKNOWN` is precisely "not a confirmed rock, possibly a pod."
  That's the don't-shoot discipline. Shooting a confirmed pod = heavy score
  penalty + debrief shame.
- Main screen reveals a pod's beacon up close (`visualKind`, proximity-based)
  even while the scope still reads `UNKNOWN` — the captain's eyes OR
  engineering's sensors, exactly the cooperation P#3 wanted.

### Competing objectives + cinematic (P#4)
- A `cinematic` event freezes the whole sim server-side and shows a dialogue
  card on the main screen; the crew reads it, the captain narrates (no captain
  console — the choice is executed with crew verbs).
- `spawnDivert` opens a secondary destination on a bearing; the helm swinging
  onto it answers the call (costs a little progress, pays score/fiction).

### Solar flare + blackout (P#5, P#18)
- `solarFlare` announces then strikes: raised systems take stress (shields-up
  trips, laser charge dumps) unless the crew assumes a safe posture.
- `viewImpaired` blacks out the forward view (flare / permanent ion storm) —
  the crew flies on sensors alone.

### Topology (forward-biased, per owner's choice)
- Large `spawnObstacle` hazards the helm must steer AROUND (inverted gate).
- Off-screen objective **chevron** points back to the destination/divert when a
  hard turn or warp pushes it out of view — the requested fallback, and a lever
  that makes Emergency Warp's disorientation land harder.

### Existing-console features (all from the playtest notes)
- **Weapons**: SNAPSHOT governor (fire at 40%, small rocks only) — directly
  addresses "weapons is all waiting" (Jack). Scope now colours contacts by kind
  and refuses to fire on a confirmed pod. "Raise Shields" renamed **"Deflector
  Screen"** to end the nomenclature collision with Engineering's shield *power*.
- **Engineering**: the tractor is a 5th powered system in the pool (7→8); power
  **presets** (save/load, P#11).
- **Helm**: **course-hold** trim (P#12); obstacle/divert steering readouts.
- **Captain HUD**: THREAT row now counts only *identified rocks* (playtest ask —
  an all-seeing HUD undercut the captain's spotting job); surfaces flares,
  emergencies, tow status, and diverts as callouts.
- **Dock-approach emphasis**: the distance/clock readouts pulse as you close in
  (the "ending felt abrupt" note); cinematic beats smooth the arrival.

### Missions
- **Authored (new):** `lifeboat-run` (flagship — pods+wreckage+ghosts, confirm &
  tow, never shoot), `first-contact` (thematics-amplified puzzle), `salvage-claim`
  (timed `salvaged` outcome + cargo mass + obstacles), `deadline-kepler`
  (failure clock → `expired` outcome), `blackout-approach` (sensors-only + flare).
- **Audit:** `first-flight` + `supply-run` kept. `kepler-rescue` **removed** —
  fully superseded by `deadline-kepler` (same station/premise, now with the real
  clock). `mined-corridor` **kept** — still the only pure-combat debris gauntlet.
- **Procedural:** four new objective templates (rescue-tow, salvage, obstacle,
  shipboard emergency) fold the new mechanics into generated runs.

### Audio (owner approved the direction)
- New SFX: tractor hum/latch, cargo stow/jettison, fire + boarders alarms, solar
  flare surge — routed to the Crew Chief (deck sounds) and the main screen (ship-
  wide). **Ready-room ambient** bed on every console while in the lobby.

### Architecture: portable widgets (new principle)
- `public/js/widget.js` — a widget owns its DOM/render/events/label and a page
  is a layout list. Because the server broadcasts full state to every seat, a
  display widget moves between consoles for free; an action widget moves once its
  target seat is authorized for the action kind. Documented in
  `architecture.md` and `CLAUDE.md`. Migrate-lightly: Crew Chief + shared
  display widgets are built on it; helm/eng/weapons left hand-wired for now.

## Verification

All green on branch:
- `npm run typecheck` (Node + Worker) — clean.
- `npm run checks` — **27 engine assertions** (16 original + 11 new: governor
  threshold, tractor power-gate + fire-block, detection-vs-ID split, cargo-mass
  turn penalty, course-hold, pod-shooting penalty).
- `npm run smoke` (Node) + `npm run smoke:cf` (Workers) — both arrive with the
  new 4-console bot crew.
- `npm run lab` — full sweep, no stalls; balance holds (see below).
- Headless page-boot (Playwright): all five pages load, join, launch, run, and
  render with zero page/console errors.

## Balance (from `npm run lab`)

- **All-bot floor holds:** supply-run `auto` ~50% arrival, gen:long `auto` ~10%,
  mined-corridor `auto` ~50% — the intended "barely / doesn't quite scrape."
- **Skilled crews on-target:** supply-run 90, first-flight 96, most new missions
  85–98 for `skilled`/`full4`.
- The 5th power system + 4th seat did **not** destabilize the baseline missions.
- New non-binary outcomes fire correctly: `deadline-kepler` arrives with a helm,
  `expired` without one; `salvage-claim` always closes `salvaged`.
- **Regression caught + fixed:** the first ID-split implementation made weapons
  hold fire on `UNKNOWN` too long and lost `mined-corridor` on `smoke:cf`; fixed
  by having rocks self-identify at detection range (a design improvement that
  keeps the pod tension intact).

## Watch items / assumptions for the owner

1. **Salvage/tow balance is human-shaped.** Bots tow poorly on purpose (towing
   needs a helm holding the line for the chief), so `salvage-claim` bot scores
   are low (~40s). This wants a real-crew playtest to tune, like the audio did —
   don't read the bot numbers as the human experience.
2. **Tractor as a 5th power channel** is the main balance perturbation. It's
   holding, but it adds to Engineering's juggling; watch that the engineer
   doesn't feel overloaded on intense. Fallback (tractor borrows Weapons power)
   is documented in `game.ts` if it needs backing out.
3. **`deadline-kepler` is punishing without a helm** (1h-eng / 1h-weap `expire`).
   That's a legitimate difficulty signal, not a bug — but confirm it feels fair.
4. **mined-corridor** was kept; if you'd rather prune it, it's one line in
   `mission-registry.ts`.
5. **Crew Chief has no difficulty-scaled burden yet** — its per-seat difficulty
   currently only affects auto-assist timing indirectly. If you want the
   chill/intense knob to change the chief's workload, that's a small follow-up.
6. **Nomenclature:** "Deflector Screen" (weapons) vs "Shield Power" (eng) — check
   this reads clearly to a fresh crew.

## Design-direction note

This pass added a fourth crew station and a new "portable widgets" architecture
principle, and leaned hard into thematic systems (rescue, salvage, first contact,
blackout). If you want the **GAME_DESIGN_DIRECTION.md** to reflect any of that
(e.g. the crew-size model now being "4 consoles + captain", or the scrappy-vs-
elite framing decision), that's yours to update — I did not touch it. See
`docs/design/13-thematic-enhancements.md` for the framing options to choose from.
