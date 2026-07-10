# Project Status Snapshot

Last updated: 2026-07-10 (after mission-framework deploy). This file is the
"resume here" note — read it with `CLAUDE.md` at the start of a session.

## Where things stand

- **Live deployment**: https://bridge-crew.zekoff.workers.dev (Cloudflare
  Workers + one Durable Object per room; version c262222d, mission framework
  included). LAN mode (`npm start`) works from the same codebase.
- **What's playable**: 3-station bridge crew (helm/engineering/weapons) +
  main screen with QR join + screen-less commander; 3 authored missions +
  3 procedural presets selectable from the main-screen lobby; per-seat
  difficulty; reconnection; non-binary scored debriefs with telemetry.
- **All green**: `npm run typecheck`, `npm run smoke` (Node transport),
  `npm run smoke:cf` (Workers transport), `npm run lab` (balance sweep).

## The decision queue (things deliberately left open)

1. **Balance tuning — the active question.** The mission lab proved the game
   is too easy: an unmanned auto-crew ship completes every mission at 100%
   hull, so humans currently only improve the time score. Ranked fix
   recommendations (weaken auto-weapons first, then denser scripted bursts,
   then make shields cost something) are in
   `docs/design/08-mission-balance-baseline.md` — **not yet applied; owner
   wanted to decide together.** This is the natural next work item.
2. **Real-crew playtest** on the deployed URL (phones on cellular work now).
   No human playtest has happened since the mission framework landed.
3. **Later-stage items, documented and parked**: Phaser station UIs
   (`docs/design/06`, start with a weapons radar scope when mechanics
   stabilize) and persistence for users/crews/ships (`docs/design/07`,
   invariants already being held in code).

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
- Workflow so far: Claude implements + verifies (smokes must pass), owner
  explicitly says "commit and push" / "deploy" at milestones.

## Doc map

- `CLAUDE.md` — commands, architecture short version, extension rules
- `docs/architecture.md` — implemented architecture (Node transport detail)
- `docs/cloud-migration.md` — dual-transport design, phases (0-2 done)
- `docs/missions.md` — mission authoring/testing guide
- `docs/design/00-overview.md` — index of all design docs (01-08)
