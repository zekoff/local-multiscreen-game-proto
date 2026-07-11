# 11 — Gameplay Expansion Menu (2026-07-11)

A menu of numbered proposals to pick from and refine: new challenges and
their counters, new console widgets, and mission designs — both ones that
fully exercise what's already built and ones that showcase new ship systems.
Selection bias throughout: **every idea is scored mentally against "does this
force two or more stations to talk?"** — the playtest confirmed communication
is the game.

Notation: [HELM×ENG] = the stations a proposal binds together. "Cheap" /
"Medium" / "Big" = rough implementation size against the current engine
(cheap ≈ one system + serialize + one widget; big ≈ new entity type with its
own lifecycle).

---

## A. New challenges and their counters

**1. Tractor beam — salvage & rescue** (owner seed) [WEAPONS×ENG×HELM] Medium
A new powered system (5th breaker-able system, or a weapons-console mode
toggle): project a beam at a *non-hostile* contact (escape pod, cargo pod,
mineral chunk) to reel it in. While the beam is latched: ship speed is
penalized, the beam draws weapons power (can't fire while tractoring), and
helm must hold alignment within a tolerance or the latch breaks. Counter-play
is the crew choosing WHEN it's safe to latch — a rock volley mid-tow forces
a "drop the pod or eat the hit?" call. Mining variant: tractored chunks pay
score/upgrade currency. Rescue variant: pods have their own life-support
clocks (uses the countdown readout, already built).

**2. Enemy raider — a ship that shoots back** (owner seed) [ALL] Big
One raider class to start: approaches like an asteroid but *stands off* at a
range band, fires volleys on a visible charge-up cycle (its charge state is
the tell — captain calls "incoming in 3"), and RETREATS after taking a hit,
returning later if not driven off. Counters: time shields to its volley
(weapons), warp resets its attack run (helm), sensor pulse reveals its
charge state early (eng). No player aiming — combat stays call-and-response
timing, not dexterity. Non-binary: driving it off scores; destroying it
scores more; ignoring it bleeds hull.

**3. Don't-shoot contacts / false positives** (owner seed) [WEAPONS×ENG×CAPTAIN] Cheap-Medium
Contacts with a `kind` field: rock, civilian pod, sensor ghost. On the scope
all three look identical at low sensor power; at higher power (or after a
pulse) pods get a distinct icon/color, ghosts vanish. On the main screen a
pod is visually distinct up close (blinking beacon) — so EITHER the captain
spots it out the window OR engineering buys the sensor margin. Shooting a
pod: hard score penalty + narrative shame in the debrief. Ghosts waste
charge and time only. This is the cheapest strong cooperation driver on the
menu: it makes "confirm before you fire" a real crew ritual.

**4. Competing objectives** (owner seed) [CAPTAIN×ALL] Medium
Mid-mission fork event: "Distress call, bearing far off-course — divert or
press on?" Diverting costs progress (course change + time) but pays score /
fiction; pressing on completes the primary faster. Implemented as a scripted
event that spawns a temporary secondary destination with its own countdown
readout; helm steers onto it like an oversized gate. The captain finally has
a strategic DECISION, not just tactical calls. Degrades gracefully: crews
that ignore it lose nothing but the bonus.

**5. Solar flare / EMP front** [ENG×WEAPONS] Cheap
A scheduled, ANNOUNCED wave ("flare in 20s"): when it hits, every RAISED
system component takes stress — shields up = shield breaker trips, laser
charged = charge dumped. Counter: engineering calls a "safe" posture
(shields down, hold fire) for the 5s crossing. Inverts the usual instincts;
pure communication test with three constants and one event action.

**6. Hull fires / damage control** [ENG] Medium
Big hull hits can start a fire (a DoT) in a compartment; engineering gets a
suppress gesture (like breaker restore but timed taps). Ignoring it burns
hull steadily. Adds triage pressure to the engineer's crisis loop — but
watch total workload; playtest already rates eng medium-high stress.

**7. Gravity well / current lanes** [HELM×ENG] Medium
A visible field region that drags alignment sideways (stronger than drift)
but BOOSTS speed if you ride its edge on-course. Skilled helm surfs it;
engineering feeds engines to hold the line. Risk/reward geometry rather
than another damage source.

**8. Mine chains** [WEAPONS×HELM] Cheap
A slow "mine" contact that, if shot, detonates NEIGHBORING contacts within
a radius (chain clears) — but if it impacts, hits double-hard. Rewards
target-order planning called by the captain ("take the mine first, the
chain clears the cluster").

**9. Hull leech** [ENG×WEAPONS] Medium
A small contact that attaches instead of impacting: continuous power drain
(engineering sees a phantom power deficit) until weapons burns it off with
a point-blank low-charge shot (a new "burst" fire mode at ≤25% charge).
Teaches that the charge meter is a resource with more than one spend.

## B. New console widgets (enhance existing stations)

**10. Weapons: charge governor** [WEAPONS×ENG] Cheap
A two-position switch: STANDARD (fire at 100, full damage) vs SNAPSHOT
(fire at 60, only kills small rocks). Turns "wait for the bar" into a real
decision synced with engineering's weapon-power choices.

**11. Engineering: power presets** [ENG] Cheap
Two savable preset slots ("combat", "cruise") the engineer configures
mid-run and applies with one tap. Rewards planning; halves crisis tap-count;
per-console difficulty could disable presets on intense.

**12. Helm: course hold (autopilot trim)** [HELM] Cheap
A HOLD toggle that applies weak auto-centering (auto-helm's correction at
half strength) so the helm can look up during quiet stretches — but it
fights you near gates (auto-disengages on manual input, never chases rings).
Keeps helm the lowest-stress seat without making it idle.

**13. Captain: order chips on the main screen** [CAPTAIN×ALL] Medium
A supervisor-style page (or main-screen debug-like panel) where the captain
taps a pre-baked order ("POWER TO WEAPONS", "EASE THROTTLE", "SHIELDS UP")
that appears as a highlighted banner on the target console. Formalizes the
call-outs for loud rooms; telemetry can then measure real order→action
latency (the coordination proxy becomes a measurement).

**14. Weapons: firing solution quality** [WEAPONS×HELM] Medium
Shots take a visible 0.5-1.5s "solution time" scaled by how hard the ship is
maneuvering (turn rate at fire time). Gunner asks helm for a steady hand on
the tough shot; helm weighs it against a ring approach.

**15. Engineering: coolant loop (overdrive)** [ENG] Medium
A single OVERDRIVE token: push one system to power 5 for 10s, then that
system's breaker trips automatically (the bill comes due). One more
deliberate spike tool with a built-in cost, parameter-shaped.

**16. Scope: contact tagging** [WEAPONS×CAPTAIN] Cheap
Long-press a blip to cycle a tag (skull = priority, flag = don't shoot).
Tags render on the main screen too — silent coordination for loud rooms,
and the natural UI partner of proposal 3.

## C. Mission designs — fully exercising EXISTING mechanics

**17. "The Long Dark" — endurance run** — gen:long structure, but ambient
spawning replaced almost entirely by scripted waves separated by true calm.
Exercises: shield charge discipline, power re-trims between waves, slipstream
chains during calms (rings spawn in pairs there). The calm/storm rhythm is
authorable today with `calm` + `spawnRate` + `spawnAsteroids`.

**18. "Blackout Approach"** — final third under a scripted PERMANENT ion
storm (sensor range floor). Weapons must lean on pulses (cooldown planning)
and captain's visual spotting of unresolved rocks on the viewscreen.
Everything needed already exists.

**19. "The Gauntlet Regatta"** — a gate-dense speed trial: rings every ~15s,
double slipstream duration, sparse rocks that punish over-throttle at ring
approaches. The score leans on time + gates. Exercises helm/eng speed-turn
coupling harder than anything current. All existing knobs (`gateEvery`,
`GATE_SLIPSTREAM_SECS` as a MissionDef scale — one new data field).

**20. "Running on Fumes"** — start with POWER_TOTAL 4 (mission knob), gain a
point at 25/50/75% progress via scripted events ("reactor segment back
online"). Engineering's triage is brutal early, luxurious late. Needs one
`setPowerTotal` event action (small, in the setMaxAsteroids mold).

**21. "Deadline at Kepler" — the countdown showcase** — kepler-rescue with a
REAL failure clock wired to the countdown readout (pod dies at T+N: mission
ends 'adrift'-equivalent with its own narrative). The readout abstraction
is already built; this adds the fail condition + a third outcome type
('lost-the-pod' vs 'arrived' — keeps outcomes non-binary).

**22. "Shakedown, Part Two"** — first-flight's sequel for crews who
graduated: same teaching structure but each scripted beat pairs TWO consoles
("ring ahead + power surge" — helm turns while eng restores). A curriculum
mission: teaches coordination the way first-flight teaches controls.

## D. Mission designs — showcasing NEW systems

**23. "Salvage Claim"** (needs #1 tractor) — a debris field full of mineral
chunks and TWO rival salvage windows (scripted timers): tow chunks while
defending against ambient rocks; every tow slows you; the mission ends on a
timer, score = salvage banked. Pure cooperation economics.

**24. "The Lifeboat Run"** (needs #1 + #3) — a broken convoy left pods AND
debris that looks identical at low sensor power. Find pods (sensors),
confirm (captain's eyes or a pulse), tow them aboard (tractor + steady
helm), never shoot a pod. The complete don't-shoot + tractor showcase.

**25. "Toll of the Reef"** (needs #2) — a raider pack patrols a mined
corridor: pay the "toll" (take a volley, tank it with shields) or fight
through (slower, scores higher). Competing objectives inside combat pacing.

**26. "Silent Running"** (needs #5-style posture rules) — cross a listening
grid: sensor pings and laser fire RAISE your signature and pull raiders;
crossing dark (low power, shields down, no pulse) is slow and blind. The
whole crew plays against their own habits — the captain arbitrates every
noisy action.

**27. "First Contact"** (needs #3 ghosts + #13 orders) — an unknown
formation approaches; ghosts, pods, and one real threat mixed. The crew has
one pulse, one chance to NOT start a war. Short, tense, almost a puzzle
mission; huge table-talk potential.

## Suggested picks if you want a coherent next arc

Cheapest high-cooperation core: **3 (don't-shoot) + 16 (tagging) + 4
(competing objectives)** — then **1 (tractor)** as the first new system,
with **24 (Lifeboat Run)** as its showcase mission and **21 (Deadline)**
as the countdown-readout payoff. **2 (raider)** is the biggest single
swing and worth its own pass.
