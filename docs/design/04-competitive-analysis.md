# Competitive Landscape

## Products reviewed

### Artemis: Spaceship Bridge Simulator
LAN multiplayer, 3-8 players, one computer per station (Captain, Helm, Weapons, Communications,
Science, Engineering). The Captain has no workstation and coordinates verbally — this is direct
real-world validation that your "commander with no display or inputs" pillar works as a role.
**Pitfall:** requires a dedicated computer per station (not phone/tablet-friendly), and a dated,
niche-hobbyist UI/UX. The one-computer-per-station requirement is a real barrier to entry — a
group needs N spare laptops, not just N phones already in their pockets.
[Wikipedia](https://en.wikipedia.org/wiki/Artemis:_Spaceship_Bridge_Simulator) ·
[Steam](https://store.steampowered.com/app/247350/Artemis_Spaceship_Bridge_Simulator/)

### EmptyEpsilon
Open-source spinoff/successor to Artemis (C++/SDL2), same LAN-and-one-PC-per-station model, adds
a Game Master mode and Lua-scripted mission scenarios. **Validates** the "authored mission
scripting layer" approach recommended in the architecture doc, and shows this niche has sustained
a passionate hobbyist/con community for over a decade. **Differentiation opportunity:** its
audience is still bounded by the same PC-per-station friction as Artemis — a phone-first,
zero-install version could expand this audience the way Jackbox expanded party games beyond
"owns a console."
[GitHub](https://github.com/daid/EmptyEpsilon) · [Site](https://daid.github.io/EmptyEpsilon/)

### Star Trek: Bridge Crew (VR)
Commercial, polished, 4 fixed roles (Helm, Tactical, Engineer, Captain), VR headset required per
player, always-on voice chat. **Pitfall reviewers specifically flagged:** no overlapping roles
plus only 4 players plus always-on voice "leaves nowhere to hide" for a struggling or new player —
intimidating rather than welcoming. VR hardware also sharply caps how many friends can
realistically play (most groups don't own 4+ headsets). **Differentiation:** your design's
explicit configurable per-role difficulty is a direct, deliberate answer to the "nowhere to hide"
problem reviewers called out, and ubiquitous phones/tablets replace a $300-per-seat hardware
requirement.
[UploadVR review](https://www.uploadvr.com/star-trek-bridge-crew-review/) ·
[GameSpot review](https://www.gamespot.com/reviews/star-trek-bridge-crew-review/1900-6416707/)

### Space Alert (board game)
Real-time cooperative board game, ~10-minute missions driven by an audio cue track, explicitly
designed so "there is simply too much going on for one player" — forces genuine parallel
coordination. **Validates** short, audio/timer-paced real-time missions as the core tension engine
of this genre (turn-based would lose the pressure). **Pitfall:** notoriously steep rules
onboarding for new players (it's semi-famous for needing a flowchart just to learn how to learn
it) — the single biggest risk in this whole genre is losing new players to rules overhead before
the fun kicks in.
[BoardGameGeek](https://boardgamegeek.com/boardgame/38453/space-alert) ·
[Wikipedia](https://en.wikipedia.org/wiki/Space_Alert)

### Spaceteam (mobile)
The closest existing product to your core distribution pillar: free, 2-8 players, own phone/
tablet, connects over Wi-Fi/Bluetooth, no extra hardware, shouting chaotic instructions at each
other. **Validates the entire distribution model** (phone-native, zero-install, co-located,
loud). **Key gap vs. your concept:** Spaceteam's control panels are randomized and largely
interchangeable — the game's fun is chaos-for-its-own-sake, not "I am the one person who
understands this system and my teammates depend on me." Your pillar of persistent, distinct,
strategically vital roles is a meaningfully deeper design target that nothing at this
accessibility level currently offers.
[Wikipedia](https://en.wikipedia.org/wiki/Spaceteam) · [Site](https://spaceteam.ca/)

### Keep Talking and Nobody Explodes
One player (in VR or at a physical prop) sees the bomb; other players see only a manual and must
verbally describe/instruct without seeing the device. **Validates** a specific sub-mechanic —
deliberately one-sided information forcing verbal communication — that's worth borrowing at the
*puzzle* level (e.g., a science-station anomaly readout that only an engineering manual explains
how to resolve) rather than as the whole game's shape.
[Wikipedia](https://en.wikipedia.org/wiki/Keep_Talking_and_Nobody_Explodes)

### Barotrauma
2D submarine survival sim, 6 persistent professional roles (Captain, Engineer, Mechanic, Medical
Doctor, Security Officer, Assistant) with real skill depth. **Validates** how deep persistent,
specialist roles can go if you lean toward simulation over party accessibility. **Pitfall:**
commonly cited as buggy/jank with a steep learning curve — a caution against over-scoping
simulation depth for a first release; depth should be added after a shallow vertical slice is
proven fun, not baked in from day one.
[Wikipedia](https://en.wikipedia.org/wiki/Barotrauma_(video_game))

### Jackbox Games (distribution format, not spaceship-themed)
Browser + room code + WebSocket client, phones as controllers, no app install, shared TV screen
optional. **Not a competitor** in theme, but it is the strongest evidence available that the
zero-install, browser-based, phone-as-controller architecture recommended in the architecture doc
works at mass-market scale for co-located party groups specifically.
[Built In Chicago overview](https://www.builtinchicago.org/articles/jackbox-games-design-party-pack)

## Where this design differentiates

No existing product combines all of:

1. Phone/tablet-native, zero-install access (Artemis/EmptyEpsilon/Bridge Crew all fail this —
   dedicated PCs or VR headsets).
2. Distinct, persistent, strategically vital specialist roles rather than randomized chaos
   (Spaceteam fails this).
3. Per-role configurable difficulty as a first-class design goal (nothing reviewed here has this
   — it's the direct fix for the "nowhere to hide" problem Bridge Crew reviewers raised).
4. A commander role with genuinely no screen or input device (Artemis's Captain is the closest
   precedent, but it's a PC-tethered game overall).
5. Authored *and* procedurally generated missions with non-binary outcomes (EmptyEpsilon's Lua
   scenarios are the closest precedent, but scoped to a hobbyist LAN-party audience).

## Cross-cutting pitfalls to design against from day one

- **Onboarding/rules overhead** (Space Alert, Barotrauma) is the most common failure mode in this
  genre. Configurable difficulty tiers per role and a strong first-mission tutorial are not
  optional polish — they're the main defense against this.
- **Hardware/software friction** (Artemis needs spare PCs, Bridge Crew needs VR headsets) is the
  second most common failure mode. Staying phone/tablet/browser-only is the direct fix, and is
  already the recommended architecture.
