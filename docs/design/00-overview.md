# Design Assessment: Multi-Device Co-Located Bridge-Crew Game

Assessment of the proposed multi-device, co-located spaceship-bridge cooperative game, written
2026-07-09. Covers feasibility, architecture, theming, competitive landscape, and other risks.

- [01 — Feasibility with Claude Code as primary implementer](01-feasibility.md)
- [02 — Architecture and framework recommendation](02-architecture.md)
- [03 — Theme ideas](03-theme-ideas.md)
- [04 — Competitive landscape](04-competitive-analysis.md)
- [05 — Additional assessment](05-additional-assessment.md)

Added after implementation began:

- [06 — Phaser station UIs: feasibility for a later stage](06-phaser-stations.md)
  (weapons scope now built)
- [07 — Persistence plan: users, crews, ships](07-persistence.md)
- [11 — Gameplay expansion menu](11-gameplay-expansion-menu.md) — the proposal
  pool the Crew Chief expansion branch drew from

> Note: several one-off session docs (08–10, 12–14) and older recaps have been
> pruned. The narrative of record for the Crew Chief expansion branch is PR #7
> plus the commit log; current balance lives in `../console-complexity-analysis.md`.

Living docs outside `design/` (current state, not assessment):

- [`../status.md`](../status.md) — the resume-here snapshot; read this first
- [`../console-complexity-analysis.md`](../console-complexity-analysis.md) —
  current per-console load, interplay map, and balance observations

## TL;DR

- **Feasibility: high.** This is a Node.js server + WebSocket + browser-clients app — squarely
  Claude Code's strongest domain. The real bottlenecks are real-device testing and human
  playtesting, not code generation.
- **Architecture: authoritative Node.js server, zero-install browser clients** (QR code + room
  code join, Jackbox-style), data-driven role and mission definitions, shared TypeScript types.
  Use React (or similar) for role control-panel screens; use Phaser narrowly, only for the
  optional main-screen viewscreen. **Construct 3 is not recommended** as the primary tool because
  its GUI-authored project format isn't something Claude Code can read/write/test as code.
- **Theme:** ship the spaceship-bridge theme first; the mechanical skeleton reskins cheaply into
  submarine, airship, pirate-ship, heist-crew, or fantasy variants later.
- **Competitive landscape:** closest precedents are Artemis/EmptyEpsilon (validate the
  screen-less-commander role and mission-scripting approach, but require dedicated PCs) and
  Spaceteam (validates phone-native zero-install distribution, but roles are randomized chaos,
  not persistent specialists). No existing product combines phone-native access + persistent
  vital roles + configurable difficulty + a true screen-less commander + authored/procedural
  missions — that combination is the differentiation.
- **Biggest cross-cutting risks:** onboarding/rules overhead, and hardware/network friction.
  Configurable per-role difficulty and a zero-install phone-first join flow are the direct
  countermeasures, and should be treated as core design pillars rather than later polish.
