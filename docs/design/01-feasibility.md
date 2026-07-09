# Technical Feasibility with Claude Code as Primary Implementation Agent

## Verdict: high feasibility

The proposed game — a LAN-based, multi-device, real-time cooperative bridge-crew simulator —
is architecturally a full-stack web application: a Node.js server holding authoritative game
state, talking over WebSockets to N thin browser clients. This is squarely inside Claude Code's
strongest domain (TypeScript/JavaScript, server + browser, text-based diffable source, testable
with standard tooling). There is no native/binary toolchain, no proprietary IDE, and no platform
SDK required to build the core game.

Two things make this an *especially* good fit for an agent-driven workflow, not just an
acceptable one:

- **Content volume.** Missions, per-role flavor text, technobabble, and system definitions are
  exactly the kind of high-volume, pattern-following content generation an LLM agent is efficient
  at, once the schema/DSL for a "mission" or "role" is established.
- **Parameterized roles.** If roles and difficulty tiers are data (JSON/YAML mission and role
  definitions) rather than bespoke code per role, Claude Code can generate new roles and mission
  content by following an established pattern rather than writing one-off logic each time.

## Where Claude Code is strong here

- Scaffolding the monorepo (server, shared types, per-role client apps).
- Writing and iterating the mission-engine / state-machine logic.
- Writing integration tests: Playwright driving multiple browser contexts as simulated players,
  or a scripted "headless bot" WebSocket client for fast CI-style regression tests of mission
  logic without spinning up real browsers.
- Iterating on UI for role control panels from a clear spec (these are mostly data-driven
  forms/dashboards — dials, toggles, meters — not complex game-engine scenes).
- Keeping client/server state in sync via a shared TypeScript types package, catching drift at
  compile time rather than at 2am during a playtest.

## Where Claude Code is *not* the bottleneck — you are

These are the parts of this project that no amount of agent capability changes, because they
require a human body in a physical room with real hardware:

- **Real device testing.** Claude Code cannot open Safari on an iPhone or Chrome on someone's
  three-year-old Android tablet. Touch input quirks, screen-lock/backgrounding behavior, PWA
  installability, and battery/power-saving throttling all need to be verified on real phones —
  the agent can write the code and reason about known platform quirks, but can't observe the
  actual behavior.
- **Local network reality.** Home Wi-Fi routers vary: guest-network client isolation, mDNS not
  resolving across subnets, captive portals, etc. The agent can build a robust join flow (QR code
  + fallback manual IP entry), but whether it actually works on *your* router needs to be tested
  by you.
- **"Is this fun" playtesting.** Whether five people shouting at each other about a plasma
  conduit is actually fun, whether a mission is too easy/too hard, whether the commander role
  feels engaging with no screen — this is judged by humans playing together, not by code review.
  Claude Code can help you iterate fast once you have that feedback, but it can't generate the
  feedback itself.

## Practical implication for how you use Claude Code on this project

Treat Claude Code as very strong at "build and test the mechanism," and treat yourself (plus
friends/family as playtesters) as the only source of "is the mechanism actually good." Build a
short feedback loop: thin vertical slice → real playtest on real devices on your real Wi-Fi →
iterate. Don't let the agent's ability to generate lots of roles/missions tempt you into building
wide before a 2-3-role vertical slice has been playtested end-to-end on real hardware.

## Dev machine fit

Both your primary (System76 Lemur Pro, native Linux) and secondary (Chromebook Linux/Crostini)
machines are standard Node.js + browser environments. No native compilation, no GPU-dependent
engine, no proprietary editor — this stack runs identically on both without special setup. This
also rules out anything requiring a heavyweight native engine (e.g., C++/SDL2 like EmptyEpsilon)
as the *primary* tool, since that would reintroduce a build toolchain that doesn't travel as well
to the Chromebook.
