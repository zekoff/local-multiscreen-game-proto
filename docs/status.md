# Project Status snaphot

This file should contain only the most recent status of the project -- usually the last major prompt with completed work.

## Latest: `assist` rename + weapons scope off Phaser (2026-07-19, after the split below)

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
