# Architecture Evaluation and Recommendation

## Core shape (framework-independent)

Regardless of rendering framework choice, the architecture should be:

- **Authoritative server, thin clients.** One Node.js process (run on the host's own laptop, or
  a small always-on box) holds canonical game/mission state. All player devices — including the
  optional main screen — are thin clients that render server-pushed state and send back input
  actions. This avoids peer-to-peer complexity entirely; since everyone is on one LAN, there's no
  NAT traversal problem to solve, so there's no reason to reach for WebRTC data channels.
- **Zero-install join flow.** The server serves plain web pages. The main screen (or the host's
  own device, if there's no main screen) shows a QR code and a short room code; players scan or
  type it into their phone's browser and are in — no app store, no install. This mirrors Jackbox
  Games' proven distribution model almost exactly (browser + room code + WebSocket client),
  which is strong evidence this isn't just technically convenient but validated at mass-market
  scale for co-located party groups.
- **Data-driven roles and missions.** Role definitions (what controls a station has, what
  difficulty tiers exist) and mission definitions (objectives, timers, triggers, branching state)
  should be data — JSON/YAML or a small DSL — not hardcoded per-role logic. This is what makes
  "configurable difficulty per role" and "authored or procedurally generated missions" tractable,
  and it's the layer where an agent can generate new content by following an established schema.
  EmptyEpsilon's Lua-scripted scenario system is a validated example of this pattern in the same
  genre.
- **Shared types package.** A TypeScript package of message/state schemas used by both server and
  every client. This is the single highest-leverage piece of infrastructure for an agent-driven,
  many-small-apps codebase: it turns client/server drift into a compile error instead of a bug
  discovered mid-playtest.
- **Reconnection as a first-class requirement, not a nice-to-have.** Phones drop Wi-Fi, get
  backgrounded, and lock their screens. A player's client must be able to rejoin the same room/
  role and resume state without restarting the mission. Build this in from the start — retrofitting
  it later is painful because it touches every part of the state model.

## Framework comparison: Construct 3 vs Phaser vs a custom web stack

You asked specifically to weigh this against your positive experience with Phaser and Construct,
and to prefer one of those if roughly equivalent — but the deciding factor here is which one
Claude Code can actually operate on effectively, since Claude Code is your primary implementer.

### Construct 3 — not recommended as the primary tool here

Construct 3 projects are authored primarily through its own GUI event-sheet editor; the project
format is not a plain, hand-editable, diffable text format that an agent can read, modify, and
verify by running a CLI build. There's no headless way for Claude Code to author or modify
event-sheet logic — the actual game-logic authoring loop requires driving the Construct editor UI,
which isn't something Claude Code can do. That breaks the "agent writes code, runs tests, iterates"
loop that makes Claude Code effective. (Construct's Multiplayer add-on is also built on WebRTC
peer-to-peer data channels, which is the wrong networking model for an authoritative-server design
like this one.) Construct remains a fine tool for *you personally* to prototype in, but it's a poor
primary target for an agent-driven implementation workflow.

### Phaser — good, but only for one specific piece

Phaser is plain JavaScript/TypeScript, fully text-based and diffable, and has a large, well-trodden
ecosystem of Node.js + Socket.io multiplayer examples. It's a real option — but most of this game's
screens (role control panels: toggles, sliders, meters, readouts) are essentially data-driven forms
and dashboards, not sprite/canvas gameplay, so a full game-engine scene graph is unnecessary weight
for them. Phaser earns its place specifically on the **main screen / viewscreen** (starfield,
ship-exterior view, radar sweep) where actual canvas/WebGL rendering adds real value.

### Recommended: thin custom web stack, Phaser used narrowly

- **Server:** Node.js + TypeScript, `ws` or Socket.io for the realtime transport, serving the
  join/QR flow and static client bundles.
- **Shared:** the types/schema package described above.
- **Client shell:** a common join/lobby/connection-status UI reused by every role screen and the
  main screen.
- **Role screens:** React (or something lighter like Preact) for the control-panel UI — this is
  where "every role feels vital" is expressed as bespoke-but-consistent dashboards.
- **Main screen:** Phaser, mounted only inside that one page, for the ambient/viewscreen rendering.
- **Monorepo layout:** npm/pnpm workspaces — `/server`, `/shared`, `/client-shell`,
  `/roles/<role-name>`, `/mainscreen`.

This maximizes the fraction of the codebase that is plain, diffable, type-checked TypeScript —
which is exactly what makes Claude Code fast and reliable here — while still using Phaser where it
genuinely earns its keep. It also keeps the rendering choice for the main screen swappable later
without touching the networking or mission-engine core.

## Testing strategy this architecture enables

- **Playwright** driving N browser contexts as simulated players, to exercise a full mission
  scenario end-to-end in CI.
- **Headless bot clients** — raw scripted WebSocket clients — for fast, browser-free regression
  tests of the mission engine's logic (timers, triggers, win/loss conditions) on every change.
- Both are only straightforward because the transport is plain WebSocket/JSON messages against an
  authoritative server — this would be much harder to script against a WebRTC P2P mesh.

## Difficulty configurability

Model per-role difficulty as data: a role definition can have multiple "tiers" (e.g., Engineering
"simple" = 3 sliders to keep in a green zone; Engineering "complex" = a cascading fault-diagnosis
minigame with dependent subsystems). Difficulty is a parameter chosen at role-select time, not a
separate code path — this keeps the content-authoring loop (including agent-assisted authoring)
tractable as the number of roles grows.
