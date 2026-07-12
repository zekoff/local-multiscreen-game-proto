# Project Status Snapshot

Last updated: 2026-07-12 — the **Crew Chief expansion pass** on branch
`expansion-crew-chief` (a large batch from `docs/design/11`, driven by Playtest
2). Committed / pushed / **deployed but NOT merged** — an exploratory swing the
owner may keep or discard. Full detail:
`docs/design/12-expansion-session-debrief.md`. This file is the "resume here"
note — read it with `CLAUDE.md` at the start of a session.

**Next up (owner decisions):** (1) **playtest the expansion branch** with a real
crew — especially the new Crew Chief console (tractor/cargo, damage control),
the don't-shoot / rescue loop, and whether Engineering feels overloaded by the
5th power channel; (2) decide whether to **merge** the branch; (3) pick a
**framing** from `docs/design/13-thematic-enhancements.md` (scrappy vs elite vs
frontier vs campaign-arc); (4) the owner's flagged **next** proposals are P#2
(raider), P#7 (gravity well), P#16 (contact tagging).

## Latest: Crew Chief expansion pass (2026-07-12, branch `expansion-crew-chief`)

New **4th crew console (Crew Chief)** with tractor beam + cargo hold and a
damage-control crew board; **typed contacts** (rock/pod/mineral/ghost) with a
detection-vs-identification sensor split (the don't-shoot ritual); a **cinematic
soft-pause** state for competing objectives; **five new missions** (flagship
`lifeboat-run`, plus `first-contact`, `salvage-claim`, `deadline-kepler`,
`blackout-approach`); topology (steer-around obstacles + off-screen chevron);
solar flare + blackout; weapons **governor** (snapshot@40%), power **presets**,
helm **course-hold**; deflector-screen rename; acquired-only threat HUD. New
**portable-widget architecture** (`public/js/widget.js`) — Crew Chief is built on
it. Power pool 7→8 (tractor is the 5th system). Two new non-binary outcomes
(`salvaged`, `expired`). All green: typecheck, 27 checks, smoke, smoke:cf, lab
(no stalls, floor holds), headless page-boot. `kepler-rescue` removed
(superseded by `deadline-kepler`). Watch items + assumptions in doc 12.

## Latest: polish + expansion-menu pass (2026-07-11, same branch/PR #6)

Third owner-directed pass on the branch. Highlights:
- **Feel**: snapshot interpolation for alignment (held turns and slipstream
  rings glide, no jump-then-smooth); slipstream streaks centered on ship
  heading; polygonal tumbling asteroids; captain HUD rebuilt as a wrapping
  grid (nothing truncates at TV widths); debug panel bottom-left.
- **Consoles**: outlined fixed-height breaker boxes (OK text centered),
  30px pips, thick sliders with 34px thumbs; graphical SVG tutorials with
  plain-language prose; captain's log on every debrief (auto-scrolls on the
  main screen); random contact callsigns (KOR-97 style).
- **Config**: mission speed (0.75/1/1.25×) in the ready room; difficulty
  rating shown per mission in the picker; parsec distance readout
  (mission-configurable; countdown kind supported for future fail clocks).
- **Engine**: target lock drops when a contact falls below sensor
  resolution (checks assert it); 16 total checks green.
- **Audio**: five tracks (added Halcyon, Meridian); throttle servo, warp
  engage clunk, trigger click, scope tap tick. STILL not heard on device.
- **Menu**: docs/design/11-gameplay-expansion-menu.md — 27 numbered
  proposals (challenges/counters, widgets, missions) for owner selection.

## Previous: follow-up implementation pass (2026-07-11, same branch/PR #6)

Owner-directed follow-up implementing report proposals 1/2/5 + polish:

- **Difficulty at launch (P5)**: per-console chill/normal/intense selectors
  in the main-screen lobby ("crew default" leaves join-URL choices alone);
  every knob verified real per console (`npm run checks` asserts helm drift,
  eng trips-per-hit — impact trips now scale with eng difficulty — and
  weapons spawn pressure).
- **New obstacles (P2)**: **ion storm** (halves sensor range; counter =
  sensor power / pulse) and **debris field** (running hot scours the hull;
  counter = throttle <40%). Scripted EventActions, authored uses (kepler,
  mined-corridor), gen templates, per-console warnings, bot counters.
- **Captain tools (P1)**: HUD THREAT row (closest rocks, converge warning,
  hazards) + NAV row (next ring bearing/countdown); debrief Crew Performance
  panel (per-console telemetry) + full **Captain's Log** written out.
- **Music**: three tracks (Drift/Ember/Aurora) drawn at random per mission;
  end-phase beat ~halved with breakdown bars; pattern rotation/rest bars
  kill the loopiness. Still needs a real-device listen.
- **Graphics pass**: nebula depth wash (seeded per mission), slipstream
  streaks + 2.4× star rush, shield bow-arc + blue soak shimmer vs red hull
  vignette, ion-storm interference, debris motes, scope blip halos, panel
  accent hairlines; overlays scroll (Launch was off-screen at 720p — fixed).
- **Console tutorials**: "?" on every crew console; readable from the lobby.
- Balance targets re-verified (supply auto 60%/hull 18 barely arrives;
  first-flight 100% for all; orderings intact; skilled on target).

## Previous: post-playtest revision (2026-07-11, after the first human playtests)

Full report: `docs/design/10-revision-playtest-report.md`; design-direction
audit: `docs/design/09-design-direction-audit.md`. Highlights:

- **Bug verdicts**: laser "slow recharge" was the full-offline breaker rule
  (reverted to ×0.5; `npm run checks` pins the recharge contract); scope taps
  fixed (scene-level 36px hit test); every station control is now optimistic
  via `public/js/optimistic.js` (instant paint, 3-snapshot revert);
  destruction shows **SHIP LOST** (debrief.outcome finally read by clients).
- **Breakers**: impacts trip breakers (shielded hits don't); ambient trips
  ~50% rarer; equal-height breaker UI; hollow pips for tripped-but-allocated.
- **Power**: pool 7 (was 6), default `{e3 s1 w2 sen1}`; `SPEED_CALIB` 325→260.
- **CPU crew**: no miss chance — deliberate 1-2s fire delay (human engineer
  visibly helps a bot gunner); volley-only shields; 4s breaker resets; weak
  gate chasing. Balance: all-bot crew barely arrives on supply-run (60-70%,
  hull ~16); hard missions still defeat it; 2 humans + bot gunner beat any
  1-human crew (weapons-linchpin softened).
- **New intro mission** `first-flight` (rock t=20, ring t=40, cap ramp 1→2→3
  via new `spawnGate`/`setMaxAsteroids` event actions); ambient spawns ≥18s
  (beyond max sensor range), star-sized until sensors could see them.
- **Thematic**: optional ship naming at launch (log/header/debrief + debrief
  record); mission story beats; TV-scale captain HUD bar; smaller toasts.
- **Toolchain**: `npm run checks`; fixed skilled-eng lab policy (was losing
  to the bot crew); `2h-helm-eng` scenario; `chargeIdlePct` metric.
- **Owner attention**: watch items + assumptions + ranked proposals are in
  the report (§audit watch items, §assumptions, §proposals).

## Previous pass: gameplay overhaul (2026-07-11)

A large tuning + UX pass on top of the pre-playtest work. All of it typechecks,
passes `npm run smoke`/`smoke:cf`, sweeps clean in `npm run lab`, and renders
error-free under the `/run` headless driver. Committed on branch
`gameplay-overhaul`, deployed, and since merged to `main` (PR #5).


- **Mission length is now a parameter.** `MissionDef.targetSeconds` (via
  `pacingFor()` in `mission.ts`, `SPEED_CALIB=325`) derives `speedScale` +
  `parTime`; a well-executed run lands near it. Authored missions:
  supply-run 180s (the 3-min baseline), kepler 150s, mined-corridor 260s;
  gen presets short/standard/long = 180/240/300s. Lab confirms skilled crews
  arrive on target (3 min → 5 min preserved).
- **Balance:** laser recharge halved (`LASER_CHARGE_RATE 14→7`); tripped
  breakers are **fully offline** (`eff→0`, was ×0.5); sensor per-point range
  nerfed (`SENSOR_BASE/PER_POWER 10/4 → 8/2`); nav gates faster, tighter, and
  speed-coupled with a **slipstream** reward (see the `GATE_*` block in
  `game.ts`); asteroids carry a lateral `bearing`.
- **Bots:** auto-assist weakened (`AUTO_WEAPONS_*`, `AUTO_HELM_*`,
  `AUTO_ENG_RESET_AGE`). Lab target met: an all-bot crew loses; one human at
  **weapons** carries a bot crew to a low-hull win (helm/eng humans can't
  overcome bot weapons — weapons is the survival linchpin).
- **UX:** crew-station toasts moved to the bottom, translucent + click-through;
  main-screen toasts larger on the right; hold-to-steer helm; two-step breaker
  restore (slider → 3 taps) with the system reading offline; optimistic
  weapons-scope target tap; asteroids small/grey-brown with threat rings,
  drifting to center; debug panel off-center.
- **Audio:** rebuilt into a time-driven 3-phase build (ambient → +melody →
  +driving beat) over 180s, held for longer missions; SFX routed per device
  (music main-screen only; laser→weapons; sensor pings→engineering; gate
  chimes→helm) via `public/js/fx-audio.js`; many new SFX.
- **Metrics:** per-console + a captain-coordination **proxy** in
  `telemetry.perConsole` (sim-report only), surfaced as a second table in
  `npm run lab` alongside new mixed one-human scenarios.
- **Docs:** the optimistic-intent overlay pattern + difficulty assessment is in
  `architecture.md` (answer to "can stations feel instant?": yes for
  selection/toggle controls, no general prediction engine).
- **Open:** audio is code+render verified but **not heard** (headless is
  silent — needs a real-device listen). Branch merged to `main` in PR #5
  after the first human playtests.

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

1. **Human playtesting — first rounds DONE (solo + two-human, 2026-07-11).** The
   feedback drove the post-playtest revision pass above; next: playtest the
   revision (esp. first-flight with a fresh crew, CPU feel, optimistic UI).
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
