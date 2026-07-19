# Project Status snaphot

This file should contain only the most recent status of the project -- usually the last major prompt with completed work.

## Most recent: engineering DC + power polish, deco graphs, debug/hazard fixes (2026-07-18)

All items below are **committed, pushed, and deployed** to Cloudflare (LAN + Worker
transports share the engine, so both carry the engine/debug changes; the rest are
static client files).

**Engineering console (`public/engineering.html`, `css/style.css`):**
- **Power rows have a fixed footprint** — each system row is a fixed height, so a
  system's normal layout exactly matches its tripped-breaker layout; the panel no
  longer reflows/jumps when a breaker trips. The restore control (label + slide-arm
  + tap) is compacted to fit the shared height.
- **Damage Control widget rebuilt**: slide-to-arm → a **"Deploy Nanites" toggle**;
  the **"Hold to Seal Breach"** button is large and fills the remaining space; the
  **nanite-bond bar sits above** the button (a thumb from below no longer covers it);
  layout is fixed so nothing jumps (disabled/STANDBY greys in place). The hold
  **captures the pointer** so small finger drift within/just past the button doesn't
  reset it (matches helm steering). After each bond completes, the **Deploy toggle
  auto-untoggles** — the engineer re-deploys per breach seal (deliberate re-engagement).

**Decorative console graphs (`public/js/deco.js` + the three console pages):**
- Each console's graph now carries **multiple traces**. **Real console data is drawn
  thick** (helm: heading + throttle; engineering: bus load + drive/sensor draw;
  weapons: charge + emitter power); **synthetic flavor lines are drawn thin** via a
  new `makeSignal()` generator (`wave`/`wave2`/`jitter`/`walk`/`pulse`/`saw` — each a
  distinct variation character; client-only chrome, so `Math.random`, never the
  engine RNG). A compact color **legend** names every line.
- Graph panels **fill their whole area** (flex column: title → legend → graph →
  readouts; polylines use `non-scaling-stroke`). This is **desktop-only** — graph
  panels stay `display:none` on a phone (the flex rule lives in the desktop media
  query so it can't override the phone hide and crush the functional widgets).

**Engine / debug (`src/engine/game.ts`, `mission-gen.ts`, `debug-panel.js`):**
- **Solar flare frozen** — removed from Europa procgen and the debug panel; it
  doesn't fire correctly yet. Engine executor left intact but uninvoked.
- **Europa hazards**: **3 per run**, drawn at random **with repeats allowed** from a
  pool of ion storm / debris field / ghost swarm / blackout (was 4 distinct incl.
  solar flare).
- **Debug spawner distance**: all debug contacts (rock/pod/mineral/ghost) now spawn
  at the mission's `impactIn` band — debug salvage no longer appears closer than a
  debug rock, matching real play (where procgen salvage already uses `m.impactIn`).
- **Debug mission picker tag removed**: Free Flight (debug range) has a blank `rating`,
  and the picker omits the "— rating" tag (and its dash) when a mission leaves it blank.

**Verification:** `npm run typecheck` + `npm run smoke` pass; changes spot-checked
headless (Playwright) — DC deploy/hold/seal + drift-survival + auto-untoggle, uniform
power-row footprint, phone no-scroll with graph panels hidden, desktop graphs filling
+ all lines drawing, hazard variety, picker text.

Missions: Europa (default), Shakedown Cruise, Free Flight (debug). Crew Chief frozen (WIP).
