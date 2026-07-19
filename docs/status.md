# Project Status snaphot

This file should contain only the most recent status of the project -- usually the last major prompt with completed work.

## Latest: throttle bug, Europa re-timing, TV-scale labels, guards (2026-07-19)

**Throttle became un-settable mid-mission — FIXED (root cause found).** The helm
latched `draggingThrottle = true` on `pointerdown` and only cleared it on
`pointerup`. Any missed `pointerup` (released off the element, cancelled touch,
pointer stolen) latched it forever, and the slider then stopped syncing from
server state — showing a stale value while the ship ran at another. Because
dragging a range input back to the value it already displays fires **no `input`
event**, the pilot could no longer command that value at all; the throttle looked
dead. Replaced the boolean with a self-healing **timestamp** (`throttleTouchedAt`,
400ms grace) that no missed event can latch. The same never-latch treatment was
applied to `holdToSteer` (blur/visibilitychange/lostpointercapture), where a
missed release would have left the ship nudging forever.

**Europa re-timed: `SPEED_CALIB` 260 → 390.** The old constant was calibrated so
the LAB'S BOTS arrived near `targetSeconds`, but bots beeline while a human crew
stops to work salvage and line up tows. A real crew ran the 5-minute Europa in
~7.5 minutes. Worse than duration: Europa's scripted timeline ends near **t=288s**,
so the overrun was spent in unscripted ambient filler with the story already over.
Calibrating to the **human** ratio (~1.32× skilled-bot) puts arrival back where the
authored content ends. Lab: Europa skilled 341s → **231s** (⇒ ~305s human ≈ the
5-minute target), and weak crews now complete far more often (auto 20%→70%,
1h-helm 40%→70%) since there's less time to accumulate damage.
**Caveat:** this constant is global, so first-flight/free-flight also got ~1/3
shorter (first-flight skilled 137s → 90s). A single global constant can't be right
for every mission — the human/bot gap is mission-dependent (salvage missions stop
more). If the shakedown should keep its old length, it needs a per-mission speed
override rather than a different global.

**Main screen at living-room scale.** All viewscreen labels (and their offsets
from the sprites they annotate) now scale by `uiScale` = CSS width / 900, clamped
1.0–2.4 — a 1080p TV lands at ~2.1×. Matched in the HUD overlay's off-screen
objective chevron. *Known side effect:* clustered contacts overlap more than
before; the top HUD threat list remains the authoritative priority readout.

**Lobby hum removed from the main screen.** `readyRoomAmbient` takes
`{ drone: false }` there — that device drives the room's speakers and a continuous
bed under the pre-launch briefing is fatiguing. Sparse ready-beeps stay; consoles
(phones) keep the full bed.

**Navigation guards on every console.** `initStation` refuses the context menu
(and CSS kills the iOS long-press callout) and traps Back via
`pushState`/`popstate` re-push with an explanatory toast — leaving mid-mission
drops the seat to auto-assist. Programmatic redirects (error handler, missing
room) are unaffected.

## Earlier today: `assist` rename + weapons scope off Phaser

- **`aids` → `assist`** throughout: `AssistProfile`, `ASSIST`, `assist(seat)`,
  the serialized key `assist`, and the field `steerAssist`. Pure rename, no
  behavior change — smoke output is byte-identical on both transports.
- **The weapons scope is now Canvas2D** (`public/js/weapons-scope.js` +
  the new `public/js/canvas-station.js`); `js/phaser-station.js` is **deleted**,
  since the scope was its only consumer. The weapons console no longer downloads
  the **1.4 MB** Phaser bundle — verified by asserting no `phaser` request is made
  by `weapons.html` while `mainscreen.html` still makes one. Phaser remains the
  main-screen viewscreen renderer.
  - Drawing is immediate-mode, so the retained blip `Map`/create/destroy
    lifecycle is gone; the optimistic-target reconciliation is preserved exactly.
  - `canvas-station.js` carries over every responsibility the Phaser mount had:
    DPR-correct backing store (labels are now *sharper* — the old `setResolution`
    oversampling hack is gone), `ResizeObserver` (**required**: switching a seat to
    Cruise changes the weapons grid and resizes the panel live), a 30fps rAF cap
    paused on `visibilitychange`, and `touch-action: pan-y` so page scroll still
    passes through the canvas.
  - The scope draws into a **9:5 letterboxed viewport**, reproducing Phaser's
    `Scale.FIT`. Without this it filled the taller panel box and rendered the fan
    ~1.9× too large — the fan is a stand-in for the viewscreen FOV, so its shape
    is not cosmetic.

**Known issue found while testing (pre-existing, NOT from these changes):** a
player who joins *after* launch stamps their own join-URL difficulty over the
ready-room per-seat pick (`join()` in `game.ts`). This also means a mid-mission
**reconnect** resets that seat's difficulty, which conflicts with reconnection
being a first-class requirement. Not yet fixed.

## Most recent: Cruise/Officer console split, helm Drift Trim + Comms, unlimited tractor (2026-07-19)

Difficulty used to be one scalar (`DIFF_MULT`) that only scaled *event rates*, so
Cruise was "the same console, slower". It now changes **what each station
operates**, and Officer is free to be more demanding.

**The mechanism (`src/engine/game.ts`):** a single per-difficulty **`ASSIST` table**
declares every structural difference — `autoScope`, `powerTotal`, `powerFloor`,
`breakerPenalty`, `steerAssist`, `courseHold`, `driftTrim`, `comms`, the drift
profile, and the per-seat `rate` multipliers. `assist(seat)` reads it at the touch
points; there is deliberately **no `if (difficulty === 'cruise')` anywhere else**,
which is how this stays faithful to "difficulty is a parameter, not a code path".
The resolved profile is serialized under `assist`, so clients render the mode they're
playing instead of hard-coding rules the engine owns.

**Weapons / Cruise** — the CPU runs the scope (acquire + fire) at maximum
strength; `target`/`fire`/`governor` from that seat are ignored. The human keeps
the **deflector screen and tractor beam**. The old auto-weapons block was split
into `autoShieldDoctrine()` / `autoGunner(cs, over)` / `autoTow()` — **call order
is the shipped sequence and must stay that way** (re-ordering silently moves the
bot balance baseline). Console shows `SENSOR CONTACTS — AUTO-TRACK`, hides the
Phaser Bank, and stops taking scope taps.

**Engineering / Cruise** — pool of **8** with **one locked pip per system**
(greyed, `−` disabled at the floor), and a tripped breaker costs **no function**
(`breakerPenalty` 1 vs Officer's 0.5) — it still demands the reset gesture. Every
writer of `this.power` respects the floor, including the Emergency Warp scatter.
`avgPowerUtil` is normalized against the pool actually in play.

**Helm / Cruise** — unchanged: painted band, lock label, Course Hold.
**Helm / Officer** — loses all three, and gains two widgets (built with
`defineWidget`/`mountWidgets` per the portability rule):
- **Drift Trim** (`public/js/widgets/drift-trim.js`) — the earned counterpart to
  Course Hold. Officer's drift bias is **stronger and stands far longer**
  (amp 4.5, re-rolls every 18-30s vs Cruise's 2.5 / 6-14s); trimming against it
  nulls it and the ship holds hands-off until it re-rolls. The server reports only
  a **coarse residual bucket** (trimmed/light/heavy), never the signed bias.
- **Comms** (`public/js/widgets/comms.js`) — hail a detected-but-unidentified
  contact. A rescue pod's beacon answers (identifies it crew-wide, logged to the
  main screen); everything else is silence. **Positively IDs pods only**, which is
  the point: the helm can call "hold fire, that's a pod" before Engineering's
  sensors resolve it. ~3s to open, ~10s transmitter cooldown.

**Tractor beam — range limit removed.** `TRACTOR_RANGE` is gone; the beam reaches
as far as sensors do. The **arc** is now the sole spatial constraint, which keeps
the helm in the loop. The tow widget lists **every acquired contact** nearest
first, with un-latchable rows disabled and tagged (`unidentified` / `not towable`)
so it reads as an approach board; the status line shows bow offset vs. arc instead
of a range.

**Verification:** typecheck, `npm run smoke`, and `npm run smoke:cf` all pass and
the two transports agree exactly. Headless (Playwright) confirmed both modes on
every console at desktop and phone (zero overflow, zero console errors), the CPU
gunner clearing rocks unattended, Drift Trim converging the residual, and a real
Comms hail resolving a spawned pod while five non-pods returned silence.

**Smoke output moved (49 → 54) and that is expected** — the officer drift profile
and the tractor reach are deliberate baseline changes. Verified by bisection that
nothing else leaks into the officer path.

**Balance (`npm run lab`, Europa, before → after):** skilled 78 → 85, full4
78 → 85, auto 0% → 20% completion, 1h-helm 20% → 40%, 1h-eng 50% → 70%. Weak crews
finish more often (unlimited tractor reach makes salvage attainable).
**Open:** `2h-helm-eng` dropped 52 → 43 — possibly the stronger officer drift on a
helm-heavy crew, possibly seed noise. **The Cruise 8-unit pool is NOT lab-validated**
— the lab's bot crews all run Officer, so that number rests on design intent and
needs real play (or a new Cruise lab profile) to confirm.

Missions: Europa (default), Shakedown Cruise, Free Flight (debug). Crew Chief frozen (WIP).

---

# OPEN WORK (carried forward — read this before picking up new work)

Ordered roughly by how much they'd bite. Nothing here is in progress.

### 1. Join order clobbers per-seat difficulty (bug; affects reconnection)
`join()` in `src/engine/game.ts` does `if (ASSIST[difficulty]) s.difficulty = difficulty`,
so a player's own join-URL difficulty **overwrites the captain's ready-room pick**
whenever they join *after* launch. The serious half is reconnection: a phone that
drops Wi-Fi mid-mission and resumes its seat silently resets that seat's mode —
a Cruise player can come back as Officer (or vice versa) mid-fight. Reconnection
is a first-class requirement in this codebase, so this should be fixed properly:
the launch-time per-seat difficulty should win for the duration of a run, and a
resuming `playerId` should keep the seat's current mode rather than restamping it.
Found while verifying the Cruise/Officer split; **not caused by it** (the clobber
predates the split — it just had no visible consequence when difficulty was only a
rate multiplier).

### 2. `SPEED_CALIB` is global, but the human/bot gap is per-mission
The 260 → 390 recalibration fixed Europa (skilled 341s → 231s ⇒ ~305s human, on
its 5-minute target) but also shortened everything else: **first-flight skilled
137s → 90s**. A single global constant can't be correct for every mission, because
humans lose time to mission-specific work — a salvage loop means stopping to tow,
a shakedown doesn't. If the tutorial should keep its old length, add a **per-mission
speed override** rather than moving the global again.

### 3. Cruise's 8-unit power pool is not lab-validated
Every lab bot crew joins as Officer, so `npm run lab` never exercises the Cruise
profile at all. The 8-point pool (4 locked + 4 free) rests on design intent plus a
headless spot-check. Confirm with real play, or add a Cruise crew profile to the
lab so the sweep covers it.

### 4. Main-screen contact labels overlap when contacts cluster
Made more visible by the living-room label scale-up. The top HUD threat list is
still the authoritative priority readout, so this is cosmetic — but label
collision-avoidance (or hiding labels for tightly-packed contacts) would help the
captain read the field.

### 5. `2h-helm-eng` scored 52 → 43 in the Europa sweep
Noticed when the Cruise/Officer split landed; every other crew profile held or
improved. Plausibly the stronger Officer drift on a helm-heavy crew, plausibly
seed noise — never isolated. Worth a targeted sweep if helm difficulty gets
touched again.

### Deliberately frozen / deferred (not bugs)
- **Crew Chief** — frozen WIP, disabled in the lobby, re-enabled with `?debug`.
- **Solar flare** — removed from Europa procgen and the debug panel; the engine
  executor is intact but uninvoked (it doesn't fire correctly yet).
- **Maneuvering Burn** — the third proposed Officer helm widget (limited-charge
  lateral thruster burn); considered and explicitly deferred.
- **The weapons scope as a `defineWidget` widget** — it kept its class API through
  the Canvas2D port; converting it is a separate refactor.
