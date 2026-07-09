# Theme Ideas

If roles and missions are data-driven (per the architecture doc), theme is largely a skin over a
fixed mechanical skeleton: N asymmetric role stations + a shared mission/objective system + an
optional main screen + an optional screen-less commander. That makes it cheap to maintain a
backlog of reskins once the core is built. Recommendation: ship the spaceship-bridge theme first
(most reference material, matches the design direction you already have in mind), and treat the
rest as a validated reskin backlog.

## Reskins that map directly onto the existing role skeleton

- **Submarine / Cold War hunt** — sealed-vessel-under-pressure tension, sonar/comms/reactor
  roles map cleanly onto helm/science/engineering equivalents. (Barotrauma-adjacent tone, but can
  stay PG.)
- **Airship / steampunk sky-pirates** — same helm/gunnery/navigation/engineering shape, different
  visual language (boilers and brass instead of consoles).
- **Age-of-sail pirate ship** — very approachable and kid-friendly; roles (captain, navigator,
  gunner, quartermaster, lookout) are instantly legible without any sci-fi explanation needed.
- **Heist crew** — trades "vessel" for "operation": hacker, lockpick/safecracker, driver, lookout,
  inside-woman. The **commander-with-no-screen pillar maps unusually well here** — the
  screen-less "mastermind giving orders over an earpiece" is a well-worn heist-movie trope, so it
  needs almost no explanation to new players.
- **Fantasy airship / living-ship adventuring party** — helm = pilot the dragon/ship, engineering
  = tend the magic engine, science = read the ley-line sensors. Good fit if you want a fantasy
  audience rather than sci-fi.
- **Wizard's-tower ritual team** — each player tends one magical subsystem to sustain a communal
  spell under time pressure; leans into fast, loud, Spaceteam-style chaos rather than deep
  simulation, fantasy-flavored.

## Grounded / realistic reskins (different audience)

- **Emergency response**: nuclear plant control room, ER trauma team, or air-traffic control
  tower. Same coordination shape, no sci-fi/fantasy trapping at all — appeals to "workplace-sim"
  fans (this is essentially "Spaceteam but it's a hospital").
- **Mission control** (not vessel-bound): a field team + a control-room "bridge" coordinating a
  disaster response or expedition. Riskier fit, since it loses the "everyone is sealed in one
  room together" tension that gives the genre its urgency — worth prototyping cautiously.

## Structural/meta ideas worth considering independent of surface theme

- **Persistent generation-ship campaign**: missions accumulate a persistent ship/crew state
  across sessions (damage carries over, crew reputation, unlocked systems) — leans directly into
  your "non-binary win conditions" pillar by making "how well did we do" matter beyond a single
  session's pass/fail.
- **Escape-room-style one-shot missions** vs. **serialized campaign missions** are a real fork in
  session design (see the assessment doc for the pacing trade-off) — worth deciding per-theme
  rather than assuming one mission length fits all reskins.
