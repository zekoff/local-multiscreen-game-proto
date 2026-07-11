# Project Status Snapshot

Last updated: 2026-07-11 (two-wave pre-playtest pass + sim-debug controls — all
deployed and merged to `main`). This file is the "resume here" note — read it
with `CLAUDE.md` at the start of a session.

## Where things stand

- **Live deployment**: https://bridge-crew.zekoff.workers.dev (Cloudflare
  Workers + one Durable Object per room). LAN mode (`npm start`) runs the same
  codebase. Both waves below are deployed and merged to `main`.
- **What's playable**: a 3-station bridge crew (helm / engineering / weapons) +
  main screen with QR join + a screen-less commander; 3 authored missions + 3
  procedural presets from the main-screen lobby; per-seat difficulty;
  reconnection; non-binary scored debriefs with telemetry. On top of that, a
  large **pre-playtest pass** (2026-07-10/11) added, across two waves:
  - **Usability**: corner/capped/overlay-suppressed toasts, semantic
    hull/shield/charge colors shared across stations, score-colored debrief
    grade, non-clipping HUD log, neutral healthy-breaker styling.
  - **Main-screen viewscreen**: forward starfield that banks with the helm's
    course, an approaching themed destination (station for Supply Run), a
    captain's per-station + system tactical HUD, screen shake, and
    laser/explosion/warp/pulse effects.
  - **Flight model**: engine power buys speed **and** maneuverability; high
    throttle makes turns sluggish; nav gates sit off-course (a bearing the helm
    must swing onto).
  - **Weapons**: laser is a recharge meter (no fixed cooldown/battery — refire
    speed set by weapon power); shields are a managed resource (recharge only
    while lowered, bleed while raised).
  - **Engineering**: a fourth powered system — **sensors** — that gates when a
    contact becomes targetable on the weapons scope; plus a long-cooldown
    **sensor pulse** that reveals every contact at once.
  - **Helm**: **Emergency Warp** (replaces Evasive) — jumps clear of all
    threats but scatters the ship (all power unallocated, every breaker tripped,
    shields/laser dropped, thrown off course, throttle cut, minor hull damage).
  - **Asteroids**: occasional 2-3 rock clusters; per-rock size & speed drive
    damage and closing rate; main screen shows small/dim/unlabeled contacts
    until sensors resolve them, then name + speed + color-coded threat (the
    scope shows only the name, so the captain calls priorities).
  - **Audio**: procedural Web-Audio music bed (builds with progress) + ship-wide
    and console-local SFX. No asset files. Fails silently if unsupported.
  - **Sim-debug controls** (opt-in via an "Expose sim-debug controls" checkbox
    in main-screen game setup): pause / dilate simulation speed (0–4×) and
    spawn an asteroid or a nav ring on demand. Controllable from the main
    screen overlay and from a new non-exclusive **Sim Supervisor** seat/page
    (`supervisor.html`, joinable from the landing page). Built to extend — a
    new debug option is one `case` in `debugAction()` + one button in
    `js/debug-panel.js`. `debug` and `timeScale` are per-run (set at launch).
- **All green**: `npm run typecheck`, `npm run smoke` (Node), `npm run smoke:cf`
  (Workers), `npm run lab` (balance sweep). Every page loads error-free
  (verified by headless-browser driving via the `/run` skill).

## The decision queue (things deliberately left open)

1. **Human playtest — the actual near-term goal, still not done.** The whole
   pre-playtest pass exists to make the game communicate its vision and hold up
   with real people. Nothing here has been played by humans yet. This is next.
2. **Audio is code-verified, not heard.** Headless has no sound output; the
   mix/feel needs a listen on a real device — check levels and taste.
3. **Balance of the new mechanics is first-pass.** Tunable constants are all at
   the top of `src/engine/game.ts` (laser recharge, warp cost, turn authority,
   sensor range/pulse, gate window/bearing, speed-risk, burst chance) and the
   default power split (2/1/2/1) in `start()`. The old 100%-auto-arrival gap
   (`docs/design/08`) is now **closed** as a side effect (auto 50-70% on hard
   missions). Per-console load, interplay, and ranked balance proposals live in
   `docs/console-complexity-analysis.md`.
4. **Later-stage items, still parked**: persistence for users/crews/ships
   (`docs/design/07`, invariants already held in code), mission-in-progress DO
   storage survival across deploys (`docs/cloud-migration.md` Phase 3 — a deploy
   still resets an in-progress game to a fresh lobby).

## Operational notes

- Cloudflare credentials: exported in `~/.bashrc` on this machine. Deploy =
  `npm run deploy` (only when the owner says so). Right after a deploy, the very
  first room created can hit a not-yet-swapped DO and behave stale — transient,
  self-resolving; create a new room.
- Browser-driven UI verification is a skill: `.claude/skills/run/` (invoke
  `/run`). Playwright is a devDependency; the Chromium binary is a one-time
  `npx playwright install chromium` per machine. There's no `chromium-cli`
  wrapper — the skill writes a one-off `.mjs` driver run from the repo root.
- The owner's dev machines: System76 Lemur Pro (primary) and a Chromebook with
  Crostini (use `localhost`, not the container IP).
- Workflow: Claude implements + verifies (smokes/lab must pass, and UI changes
  are driven against a real headless browser); the owner explicitly says
  "commit and push" / "deploy" / "merge" at milestones.

## Doc map

- `CLAUDE.md` — commands, architecture short version, extension rules
- `docs/architecture.md` — implemented dual-transport / mission-as-data layout
- `docs/cloud-migration.md` — dual-transport design, phases (0-2 done, 3 parked)
- `docs/missions.md` — mission authoring/testing guide
- `docs/design/00-overview.md` — index of all design docs (01-08)
- `docs/design/06-phaser-stations.md` — Phaser station plan (weapons scope built)
- `docs/design/08-mission-balance-baseline.md` — the *original* baseline; now
  superseded — see below
- `docs/pre-playtest-improvements-recap.md` — full changelog of the two-wave
  pre-playtest pass (wave 1 + wave 2)
- `docs/console-complexity-analysis.md` — current per-console load, interplay
  map, and balance proposals
- `docs/playtest-visual-notes.md` — the visual audit that kicked off the pass
