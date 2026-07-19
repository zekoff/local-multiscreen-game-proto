# Project Status snaphot

This file should contain only the most recent status of the project -- usually the last major prompt with completed work.

## Most recent: salvage/ghost/heal + debug + CPU pass (2026-07-18)

**Engine (`src/engine/game.ts`, `mission.ts`, `mission-gen.ts`):**
- **Salvage silhouette from spawn**: minerals reveal their amber silhouette on the
  viewscreen from spawn (`MINERAL_VISUAL_RANGE`), so the captain can call salvage
  early. Sensor ID / tractor lock still gate on `identified` (unchanged).
- **Ghost-swarm event**: a new timed `EventAction` (`ghostSwarm`, peer to
  `ionStorm`/`debrisField`) drips phantom ghost contacts onto the scope mixed with
  the normal target cadence — weapons pressure (a shot on a ghost is wasted; sensor
  ID/pulse resolves + culls them). Serialized `ghostSwarmIn`; a "SENSORS SPOOFED"
  main-screen notice; added to the Europa timeline (~52s).
- **Engineering Damage Control** (new): an attention-only hull heal — **no power
  cost**, available only while **hull < 50%**, healing in **~8% chunks per nanite
  bond (~1%/s)** up to 50%. New `sealHull` action + `repair` serialize block;
  constants `HULL_BREACH_MAX/SEAL_BOND_TIME/SEAL_CHUNK/SEAL_DECAY`.
- **CPU crew baseline 0.6 → 0.7** (bots a bit more capable; `botCs`/`botOverBase`
  keep the 0.6 anchor as the old floor). Debug skill slider default now 70%.

**Client:**
- **Damage Control widget** on the engineering console (own grid area; fits phone
  no-scroll): slide-to-ARM → hold-to-seal, animated nanite-bond bar, hull bar,
  per-chunk "breach sealed +8%" flash/toast, **visible-but-disabled above 50%**.
- **Debug panel** now offers **every** procedurally-addable concept, grouped
  (Contacts / Navigation / Hazards / Emergencies / Test incl. a hull-damage
  button) — dispatches through the scripted-event executors so debug matches play.

**Europa CPU study (crewSkill=1.0, 16 seeds/config)** — pure all-auto arrives 94%
but scores ~52 (survives, doesn't thrive). Biggest CPU deficits: **salvage towing**
(all-auto banks ~2.6 vs ~9.4 with a human gunner — the bot never tows ore by
design) and **power/breaker management** (a skilled engineer cut impacts 5.8→2.6,
hull 58→79). See the response for the full table + CPU-improvement ideas (top:
let the auto-gunner tractor identified salvage; smarter auto-engineer power/breaker
+ auto Damage Control below 50%).

**Europa hazards are now procedural**: each run draws a different set + placement
of hazards (ion storm / debris field / ghost swarm / blackout / solar flare) —
4 distinct from the pool of 5, shuffled onto 4 slots per seed. Debug panel also
gained a **Hull +30%** heal (alongside the −30% damage test).

The CPU-crew study + a ranked improvement backlog is written to
`docs/cpu-crew-findings.md` (NOT yet implemented — owner call).

Missions: Europa (default), Shakedown Cruise, Free Flight. Deployed to Cloudflare.
