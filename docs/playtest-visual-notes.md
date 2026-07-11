# Pre-Playtest Visual Notes

Captured 2026-07-10 by driving the LAN build with headless Chromium
(Playwright) across all four surfaces — join page, lobby, active mission
(normal + fast-time for density), and debrief. Intent is **usability and
communicating the vision to early playtesters, not polish.** Findings are
ordered by how much they hurt a first playtest.

Screenshots live in the session scratchpad (not committed).

## P0 — Breaks a readable playtest

### 1. Toasts overlap the content they should announce
`#toasts` is anchored `top: 3.4rem`, centered, `z-index: 20` — above the
`z-index: 10` phase overlays — and stacks with no cap. Consequences seen on
every surface:
- **Lobby:** the "join" toasts ("Ripley took the helm station"…) cover the
  "AWAITING CREW" title and the top of the QR code.
- **Active:** the first panel's header is hidden behind the toast on every
  station (Velocity/Distance on helm, Power Distribution + spare count on
  engineering, Sensor Contacts on weapons).
- **Debrief (worst):** the end-of-mission event burst stacks ~14 toasts on
  top of the entire debrief result, making the scored outcome unreadable for
  several seconds — exactly the screen a playtester should absorb.

Directions: cap simultaneous toasts (e.g. 3, drop oldest); move them out of
the center content column (corner) or below the header; suppress/collapse
them while an overlay is visible, or raise overlay z-index above toasts.

## P1 — Usability / at-a-glance reading

### 2. Meter colors are per-station accent, not semantic
Meter fills use each station's `--accent`, so the **same value reads as a
different color per screen**: shields are red on weapons, orange on
engineering, green on the main screen; the phaser charge bar is red. Red for
a *full/ready* charge or *healthy* shields fights the red = danger
convention, and there's no shared color language between a player's phone and
the shared screen. Suggest: drive shared vitals (hull, shields, charge) by
value with good/warn/bad, and reserve accent for station chrome.

### 3. Debrief grade/score color ignores the score
"Barely Survived — 15/100" renders in the positive accent color (green on
main, blue on helm). A near-failure looks like a win. Color the grade by
score band.

### 4. Main-screen HUD log clips below the viewport
The Ship's Log cell grows past the bottom edge at 1280×720; the last line is
cut off. The log has `max-height: 9em` but the HUD row isn't height-bounded
against the viewport. On a real TV this will clip. Cap/scroll within a fixed
HUD height.

### 5. Healthy breakers look like danger buttons
The two "OK" breakers use the dim red-bordered `.danger` styling; only the
text distinguishes them from the tripped one. A neutral/green resting state
with red reserved for TRIPPED reads faster under load.

## P2 — Communicating the vision (worth a little, not polish)

### 6. The viewscreen under-delivers the "asteroid field" fantasy
Missions spawn asteroids sequentially, so the shared screen is mostly empty
starfield with a single flat red circle at a time — even during "Drifting
mines, all quadrants!". No ship, reticle, or framing element; the only depth
cue is the circle's size. This is the room's shared "wow" surface. A little
density (more concurrent contacts), a motion/approach cue, and a framing
element would sell "we're flying a ship through a hazard" without full art.

### 7. Crew stations have large unused vertical space / thin context
Helm, engineering, and weapons leave a big empty region at the bottom on a
phone. Helm in particular: velocity has no unit; the course-alignment track
is a thin line whose "good zone" (center tick) is subtle and gives no cue for
how far off or which way to correct beyond the marker's position. The empty
space could carry a clearer alignment read or a mirrored hull/shields status
so each seat has shared situational awareness.

### 8. Debrief on crew phones is sparse
Crew stations show only grade + narrative; the stats grid is main-screen
only. A player reviewing their own phone gets little. Could mirror a few
key/role-relevant stats.
