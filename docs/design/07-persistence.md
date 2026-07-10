# Persistence Plan: Users, Crews, and Ships

Requested 2026-07-09: the game should *later* support optional persistent
users, crews, and/or ships. Nothing is built yet — this document records how
persistence attaches to the architecture and which invariants to hold **now**
so the feature can land without a redesign.

## The future shape (target model)

Three optional entities, all opt-in (drop-in anonymous play must always work):

- **User** — a person with a durable identity: display name, preferred
  station(s), per-role difficulty they usually play, career stats
  (missions flown, stations crewed, grades earned).
- **Crew** — a named roster of users who play together: shared mission
  history, cooperative records ("best Kepler run"), maybe unlockable ship
  names/liveries. The social object people come back for.
- **Ship** — a persistent vessel: name, accumulated drydock scars, upgrade
  state, mission log. Enables the "generation-ship campaign" idea from the
  theme notes (docs/design/03), where damage and history carry across
  sessions.

A useful mental model: **rooms are ephemeral; identity is durable.** A mission
run is played *by* (user, crew, ship) references and, at debrief, writes a
record *onto* them. The room still owns nothing after it ends.

## How it attaches to today's architecture

The seams already exist; persistence slots in without touching the engine's
runtime model:

1. **Join-time claims.** The `join` message gains optional identity fields
   (`profileId` + token). The transport resolves them against storage and
   passes display data into `Game.join(...)` exactly like `name` today. The
   engine keeps not knowing what a "user account" is.
2. **Debrief-time writes.** The debrief is already a structured, versionable
   record — it now includes `missionId`, `seed`, per-seat `crew` info
   (difficulty, human/auto), full stats and telemetry. That record *is* the
   career-history row; persistence means writing it somewhere keyed by the
   identity claims, which is a transport-layer concern.
3. **Storage homes already exist.**
   - Cloud: each `RoomObject` already has SQLite storage; persistent entities
     get their own Durable Objects (`UserObject`, `CrewObject`, `ShipObject`
     via `idFromName`) — same pattern as rooms, no new infrastructure. The
     debrief write is a couple of stub calls from the room DO.
   - LAN mode: a JSON/SQLite file next to the server. Same interface, humbler
     backend — define a small `ProfileStore` interface both transports
     implement, mirroring the dual-transport pattern used everywhere else.

## Invariants to hold NOW (the actual "keep in mind" list)

1. **Don't overload `playerId`.** Today's sessionStorage `playerId` is a
   *seat-resumption* token, deliberately per-tab and disposable. Durable
   identity will be a separate `profileId` (localStorage or account-backed).
   Never make gameplay logic treat `playerId` as "the person."
2. **Keep the debrief record self-contained and append-only in spirit** —
   everything needed to interpret a run (mission, seed, crew composition,
   difficulty, outcome, telemetry) stays *in* the record, so future career
   history doesn't require joins against data that may have changed.
3. **Engine stays identity-free.** `Game` receives display names and
   difficulty; it never reads or writes storage. All persistence lives in
   transports/storage objects. (Same rule that made the dual transport cheap.)
4. **Rooms own nothing durable.** Anything that must outlive the room gets
   written out at debrief time, not accumulated in room state.
5. **Anonymous play is the default path forever.** Identity fields are
   optional in every message; a table of strangers with phones must never
   see a login wall.
6. **Ship/upgrade effects = parameters.** When persistent ships get upgrades
   ("mk-II shields"), they must enter the engine as data modifying existing
   knobs (a `ShipDef` sibling to `MissionDef`), not as new code paths — the
   same rule as role difficulty and missions.

## When it's time to build (rough order)

1. `profileId` + display-name persistence (localStorage; no accounts, no
   auth) — "the game remembers your name and favorite station."
2. `ProfileStore` interface + debrief-record writes (DO storage / local file).
3. Career screen (a station page reading profile history).
4. Crews (shared roster + records), then Ships (`ShipDef` + campaign state).
5. Real accounts/auth only if cross-device identity is demanded — and then
   as a resolver in front of `profileId`, not a rework of it.
