# Additional Assessment

## Voice chat: don't build it for the core mode

Co-located play means voice is already handled — people are talking in the same room. Building
in-game voice chat adds real complexity (multi-party WebRTC audio, echo/feedback across phones
sitting near each other) for a co-located mode that doesn't need it. If remote play is added
later, recommend explicitly deferring to "bring your own Discord/Zoom" rather than building
first-party voice — reliable multi-party WebRTC audio is a substantial separate project, not an
incremental add-on.

## Reconnection is core infrastructure, not a nice-to-have

Real phones on real Wi-Fi drop packets, get backgrounded by the OS, and lock their screens
mid-session. A player's client needs to be able to rejoin the same room/role and resume state
without restarting the mission — the social cost of "someone's phone hiccuped and now the whole
group's mission is broken" is high enough that this should be designed in from the first vertical
slice, not retrofitted later. (Called out in the architecture doc too — repeating it here because
it's easy to deprioritize until it causes a bad first playtest.)

## Local network reality check

Home Wi-Fi is messier than a dev laptop's network: guest-network client isolation can block
device-to-device traffic, mDNS/Bonjour discovery doesn't always resolve cleanly across subnets or
on locked-down routers. Recommend the host's server always show a QR code *and* a plain
LAN-IP-plus-room-code fallback, and test specifically on an ordinary home router (not just a
clean dev network) before trusting auto-discovery alone.

## Device/screen diversity is a real engineering line item

Phone vs. tablet vs. laptop screens vary widely in size, aspect ratio, and input method (touch vs.
mouse/trackpad). Responsive, adaptive layouts per role screen need to be budgeted as real work,
not an afterthought. Your Lemur Pro + Chromebook combo is a reasonable minimum dev matrix, but
plan to playtest on a few different real phones/tablets (a housemate's random Android device, an
older iPhone) since emulated viewports won't catch everything.

## Session length is an early decision, not a detail

Space Alert's ~10-minute missions and Bridge Crew's longer campaign missions represent genuinely
different design points, and the choice drives UI pacing, tutorial design, and how much
authoring/generation effort is worth investing per mission. Recommend picking an explicit target
session length early (even a rough one) rather than letting it emerge implicitly from whatever
gets built first.

## IP/legal note

Leaning into Star Trek/Star Wars/Firefly/BSG-style bridge-crew tropes for original characters,
ship names, and aesthetic is normal genre pastiche and fine. If there's ever commercial intent,
avoid reusing specific copyrighted names, ship designs, or character likenesses from those
franchises directly.

## Recommended build sequencing

Build the networking + join-flow + mission-engine skeleton with only 2-3 placeholder roles first,
as a fully playable end-to-end vertical slice — this validates the hardest architectural risk
(real-time state sync across a handful of heterogeneous real devices on a real home network)
before investing in role/content breadth. Expanding role count and mission depth is comparatively
cheap once that skeleton is proven on real hardware in a real room.
