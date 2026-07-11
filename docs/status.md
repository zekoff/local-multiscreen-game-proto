# Project Status Snapshot

Last updated: 2026-07-10 (after weapons-scope deploy). This file is the
"resume here" note — read it with `CLAUDE.md` at the start of a session.

## Where things stand

- **Live deployment**: https://bridge-crew.zekoff.workers.dev (Cloudflare
  Workers + one Durable Object per room; includes the mission framework,
  the balance-tuning pass, and the Phaser weapons radar scope). LAN mode
  (`npm start`) works from the same codebase.
- **What's playable**: 3-station bridge crew (helm/engineering/weapons) +
  main screen with QR join + screen-less commander; 3 authored missions +
  3 procedural presets selectable from the main-screen lobby; per-seat
  difficulty; reconnection; non-binary scored debriefs with telemetry.
  Weapons now has a **Phaser-rendered radar scope** (contacts converge on
  the ship, tap a blip to target) in place of the old button list — the
  first Phaser station widget, hybrid pattern per `docs/design/06`.
- **All green**: `npm run typecheck`, `npm run smoke` (Node transport),
  `npm run smoke:cf` (Workers transport), `npm run lab` (balance sweep).
- **Cloud acceptance criteria verified live** (not just `wrangler dev`):
  TLS, Host-derived join URL, two concurrent rooms with no cross-talk —
  see `scripts/verify-cloud.mjs` (re-runnable anytime against prod).
- **A room is live right now for the owner to test from**: code `Z3W3` at
  https://bridge-crew.zekoff.workers.dev/?room=Z3W3 (may have expired by
  the next session — rooms are deleted after 10 minutes idle).

## The decision queue (things deliberately left open)

1. **Human playtest — the actual near-term goal.** Owner wants the game
   playtest-ready with other humans within 1-2 more sessions. Never
   playtested with real people since the mission framework landed. The
   owner is testing the new weapons scope live right now (as of this
   snapshot) via the room above — **check with the owner for their
   findings before doing more UI/UX work.**
2. **Balance tuning — paused, not finished.** First pass applied (weaker
   auto-weapons, denser scripted bursts, shield cap/regen cut 100->35 +
   half regen rate) — hull damage lands for the first time, but arrival is
   still 100% everywhere, short of the doc's target (auto: 30-60%
   arrival). Explicitly paused by the owner ("enough with balance for
   now") to prioritize the Phaser scope. Ranked next steps still in
   `docs/design/08-mission-balance-baseline.md`.
3. **More Phaser station work — wanted, but explicitly scoped small for
   now.** Owner said: "i don't plan to go far down this road before
   playtesting. this is part of the vertical slice, though." Read as: the
   weapons scope was the point (communicates vision to a playtester,
   validates the technical approach), not a mandate to do helm/engineering
   next. Wait for playtest feedback before deciding whether/where to keep
   going with Phaser — `docs/design/06` has the assessment (helm's
   attitude/drift display is the next-best candidate if pursued).
4. **Later-stage items, still parked**: persistence for users/crews/ships
   (`docs/design/07`, invariants already held in code), mission-in-progress
   DO storage survival across deploys (`docs/cloud-migration.md` Phase 3,
   accepted gap — a deploy currently resets any in-progress game to a
   fresh lobby).

## Operational notes

- Cloudflare credentials: exported in `~/.bashrc` on this machine
  (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN, "Edit Cloudflare Workers"
  template token). Deploy = `npm run deploy`. The token was pasted into a
  Claude session transcript once — rotate it in the dashboard if that
  transcript is ever shared.
- Right after a deploy, the very first room created can hit a not-yet-swapped
  DO instance and behave stale — transient, self-resolving; create a new room.
- The owner's dev machines: System76 Lemur Pro (primary) and a Chromebook
  with Crostini (use `localhost`, not the 100.115.x.x container IP; the
  Host-derived join URLs fixed the QR code there).
- Workflow so far: Claude implements + verifies (smokes must pass, and for
  UI changes this session also drove a real headless browser against a
  real running mission — see `weapons-scope` commit), owner explicitly
  says "commit and push" / "deploy" at milestones.
- **Browser-driven UI verification is now a skill:** `.claude/skills/run/`
  (invoke `/run`) launches the LAN server and drives the station pages with
  headless Chromium via Playwright. Playwright is a project devDependency;
  the Chromium binary is a one-time `npx playwright install chromium` per
  machine. There is still no `chromium-cli` wrapper — the skill writes a
  small one-off `.mjs` driver run from the repo root (see the skill for the
  app-specific gotchas: lobby-overlay timing, `#launch-btn`, motion ramp-up).

## Doc map

- `CLAUDE.md` — commands, architecture short version, extension rules
- `docs/architecture.md` — implemented architecture, rewritten 2026-07-10
  for the actual dual-transport / mission-as-data layout
- `docs/cloud-migration.md` — dual-transport design, phases (0-2 done, 3
  parked)
- `docs/missions.md` — mission authoring/testing guide
- `docs/design/00-overview.md` — index of all design docs (01-08)
- `docs/design/06-phaser-stations.md` — Phaser station UI plan (weapons
  scope now built; helm next-best candidate if pursued further)
