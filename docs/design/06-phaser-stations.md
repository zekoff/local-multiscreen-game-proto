# Feasibility: Phaser Station UIs (later-stage upgrade)

Assessment of migrating station UIs from the current DOM dashboards to Phaser
for rich graphical feedback and input. Requested 2026-07-09 as a
later-development-stage option, to be built collaboratively (human + Claude).

## Verdict: feasible, low architectural risk, do it per-widget rather than per-app

The architecture makes this cheap to adopt incrementally: stations are
stateless renderers of server snapshots, so **the rendering technology is
invisible to the server, the wire protocol, and every other client**. A
Phaser-rendered weapons station and a DOM engineering station can crew the
same ship — nothing anywhere else changes. There is no migration cliff.

Claude Code works well with Phaser (plain JavaScript/TypeScript, huge public
example corpus), so the collaboration model is the same as today.

## What the current architecture already guarantees

- **State in, actions out.** Every station is `render(state)` + controls that
  send actions. A Phaser scene consumes the same snapshot and emits the same
  actions — `net.js`, `station.js` (overlays, toasts, reconnection), and the
  transports are untouched.
- **Zero-build stays possible.** Phaser ships an ESM bundle that can be
  vendored into `public/js/vendor/` exactly like qrcode-generator was. No
  bundler needed. (Phaser is ~1.2-1.5 MB — served once from LAN/CDN-cached
  Workers assets, acceptable; but don't load it on stations that don't use it.)
- **The main screen already proves the pattern**: `mainscreen.js` is a canvas
  renderer fed by snapshots. A Phaser station is the same idea with a scene
  graph, tweens, and input handling instead of raw canvas calls.

## Where Phaser earns its keep (and where it doesn't)

Rich graphical *interaction* is valuable where the station's mental model is
spatial; it's overhead where the station is a form.

**Strong candidates:**
- **Weapons**: a real radar scope — contacts converging on the ship, tap to
  target, lead indicators, beam/impact animations. This is the station whose
  current list-of-buttons UI most undersells the fantasy.
- **Helm**: attitude/course display, drift visualized as a wandering vector,
  starfield parallax reacting to your own throttle, dramatic evasive feedback.
- **Engineering (partial)**: animated power-flow diagram (Phaser or plain
  SVG/CSS — evaluate both; a static diagram with CSS animation may be 90% of
  the value at 10% of the weight).

**Poor candidates:** lobby/join flows, difficulty selects, debrief screens,
anything textual — DOM is better at text, layout, and accessibility, and the
shared `station.js` shell (overlays/toasts/reconnect) should stay DOM
permanently.

## Recommended architecture: hybrid page, Phaser as a widget

Keep each station an HTML page using `initStation`; mount Phaser into a
`<div>` for the graphical instrument only, DOM for everything else:

```
helm.html
├── header / overlays / toasts        (DOM — station.js, unchanged)
├── #instrument → Phaser.Game         (scene reads latest snapshot, emits actions)
└── throttle slider, evasive button   (DOM, or migrated into the scene later)
```

Pattern for the seam (same as mainscreen.js today): `render(state)` stashes
the latest snapshot; the Phaser scene's `update()` reads it and tweens toward
it; scene input handlers call `net.action(...)`. One new shared helper
(`js/phaser-station.js`) can own the mount/resize/DPR boilerplate.

## Risks and mitigations

- **Phone performance/battery**: WebGL at 60fps drains phones faster than
  DOM. Mitigate: cap at 30fps, `powerPreference: 'low-power'`, pause the
  scene when the tab is hidden. Test on a mid-tier phone early.
- **Touch ergonomics**: game-scene hit areas need the same ≥48px discipline
  the CSS enforces today; Phaser doesn't give it for free.
- **Bundle size on LAN mode**: 1.5 MB from a laptop server on LAN is nothing;
  over cellular to the Workers deployment it's a one-time cached cost. Fine.
- **Reconnection/overlay correctness**: keep lifecycle state (lobby/debrief/
  disconnected) in the DOM shell — never inside the scene — so a Phaser bug
  can't break seat resumption.

## Sequencing recommendation

1. Not yet — current DOM stations are the right cost for mechanics iteration
   (agreed premise of the request).
2. First migration: **weapons radar scope**, as the highest fantasy-per-effort
   widget, vendored Phaser + hybrid pattern above.
3. Evaluate on real phones (perf + feel), then decide helm/engineering.
4. Trigger point: when mechanics stabilize enough that UI polish, not
   mechanics iteration, is the bottleneck to "feels like a real bridge."
