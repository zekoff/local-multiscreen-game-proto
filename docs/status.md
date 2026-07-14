# Project Status snaphot

This file should contain only the most recent status of the project -- usually the last major prompt with completed work.

The game is in the middle of a significant expansion attempt including a new console, adjusted widgets at existing consoles, additional mission scripting framework, and user experience changes. This work is taking place in a large feature branch (`worktree-expansion-crew-chief`, draft PR #7). The branch starts from a known-good state which was playtested. The goal of this branch is to build on the game's foundation and prepare for the next group playtests.

## Most recent: merge-prep tidy pass (2026-07-13)

A tidy-up pass to get the branch mergeable, driven by the 2026-07-13 solo playtest. All changes typecheck, pass `npm run checks` (34 assertions incl. Europa), `npm run smoke` + `smoke:cf`, sweep clean in `npm run lab`, and render error-free under headless verification. **Committed prep only** (doc pruning); the feature work below is staged in the worktree, not yet committed.

- **Engineering**: power pips can no longer be pushed past the pool (client-side guard, no more "-1 spare" flash); breaker restore is now **inline on each power row** (replaces that row's controls when tripped — no separate Breakers panel); the `−` button moved to the left of each row.
- **Logging**: events now carry an audience — crew-wide notices show on the **main screen only**, console-specific chatter (gate calls → helm, target/tow/fire results → weapons, breaker/preset/pulse → engineering) shows **only on that console**. Several removed granular events reinstated as console-scoped toasts.
- **Main screen**: rescue **pods reveal their beacon silhouette earlier than rocks** (POD_VISUAL_RANGE) so the captain can ID them before sensors do; contacts that drift past now **fade their real silhouette in place** instead of a puff.
- **Sensors**: acquire/ID ranges **+50%** across the board (detection ~21s at the default 2 sensor power, ~27s maxed); the weapons scope rim widened to match.
- **Power**: default split is now **E2 S1 W2 Sen2** (start + CPU auto-engineer) — more sensors by default. **Balance note:** this slows the *empty* ship and dropped the all-bot floor on supply-run/gen:standard from ~30% to 0% (skilled + all 1-human crews unaffected). Owner tuning call — see `docs/console-complexity-analysis.md` §Balance.
- **CPU helm** holds the bow on a latched tractor target instead of chasing slipstreams.
- **New mission**: **Europa Salvage Loop** (`gen:europa`) — a 5-min standard procedural type: slipstreams, single/double rocks + 1-2 heavy 4-5 batches, drifting salvage, one slow lifeboat in a batch, ghosts, one ion storm / debris field / blackout; **no obstacles or Crew-Chief emergencies**. Scored on time / salvage banked / hull.
- **Crew Chief frozen (WIP)** in the lobby (disabled; `?debug` re-enables) — it lags the rest and is deferred; the rest of the branch is the merge target.
- **Polish**: main-screen join URL is selectable (copy/paste); decorative emoji reverted to clean text everywhere.

Unaddressed playtest feedback is captured in the Library TODO (`~/The Library/2 - Workspace/Bridge Crew/TODO.md`).
