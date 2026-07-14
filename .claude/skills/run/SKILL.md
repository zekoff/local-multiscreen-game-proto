---
name: run
description: Launch the LAN Node server and drive the browser clients (mainscreen/helm/engineering/weapons) with headless Chromium via Playwright, for visually verifying rendering changes (e.g. the mainscreen starfield/canvas).
---

# Running and visually verifying this app

This is a build-free static-client app served by the Node LAN transport
(`src/server-node.ts`). There is no dev-server hot reload for `public/`
assets — after editing anything under `public/js/`, restart the server to
pick up the change.

## Prerequisites

Playwright is a devDependency (`npm install` gets it). The Chromium binary
itself is a separate download, cached at `~/.cache/ms-playwright/` — install
once per machine:

```bash
npx playwright install chromium
```

## Run it as ONE Node process (do NOT launch the server from bash)

The obvious `npm start & ; until curl … sleep …` pattern does **not** work in
the agent sandbox, and re-deriving that wastes a lot of turns. Three gotchas:

1. **Bash foreground `sleep` is blocked** — a wait-loop like
   `until curl …; do sleep 0.5; done` dies with **exit 144**.
2. **A server backgrounded with `&` in one Bash call doesn't survive** into the
   next Bash call (it's killed when that call's shell exits).
3. **Wrapping the driver in bash plumbing trips the sandbox.** `pkill … ;`,
   `timeout N node …`, `… && echo`, trailing `; echo EXIT=$?`, and
   `> file 2>&1` redirects around the run have all produced spurious
   **exit 144 / exit 1 with no output**. Invoke the driver as a **bare**
   `node scripts/<driver>.mjs` with nothing before or after it.

So: do the whole thing — boot server, wait, drive Chromium, tear down — inside a
**single Node process**, waiting with **Node timers** (`setTimeout`), exactly
like `scripts/smoke.mjs`. A reusable helper already does the boilerplate:
**`scripts/lib/verify-browser.mjs`** (`withServerAndBrowser`). It boots the real
server via `spawnServer`, opens Chromium, gives you an `open(pageName)` that
loads `<pageName>.html?room=…` and captures every page's console/`pageerror`
into a shared `errors` array, and tears both down afterward.

## Drive with Playwright

Write a small one-off driver **under `scripts/`** (or the repo root) — it must
live inside the repo tree so a bare `import 'playwright'` resolves
(`node_modules` is found from the *script's* directory upward, NOT from cwd; a
script in `/tmp` throws `ERR_MODULE_NOT_FOUND` even when run from the repo).
Delete it when done. Template:

```js
// scripts/_drive.mjs  (delete after running)
import { withServerAndBrowser } from './lib/verify-browser.mjs';
await withServerAndBrowser(async ({ open, errors, sleep }) => {
  const main = await open('mainscreen');           // /mainscreen.html?room=…
  await open('weapons'); await open('crewchief');
  await sleep(1000);                               // let the first state push land
  await main.click('#launch-btn', { force: true }); // leave lobby -> active
  await sleep(14000);                              // let the sim run
  await main.screenshot({ path: '/tmp/frame.png' });
  console.log('console errors:', errors.length, JSON.stringify(errors, null, 2));
});
process.exit(0);  // teardown can otherwise surface a signal exit code
```

Run it bare (the printed output is what matters; a trailing signal code from the
server-tree teardown is harmless):

```bash
node scripts/_drive.mjs
```

App-specific gotchas for whatever you put inside the callback:

- Station pages (mainscreen/helm/engineering/weapons) all go through
  `initStation()` in `public/js/station.js`. The lobby `#lobby-overlay` div
  starts with class `hidden` in markup and is toggled by the *first*
  websocket state push — don't screenshot before that lands (`waitForTimeout`
  ~500-800ms after `goto`, or `waitForSelector('#launch-btn')` — note the
  button exists but is 0×0 while its parent overlay is hidden, so don't wait
  for `state: 'visible'` on the button itself).
- Click `#launch-btn` to leave the lobby and start the default/selected
  mission — that's what un-hides the mainscreen canvas (`#viewscreen`).
- Ship speed ramps up from the mission's throttle scripting; if you're
  eyeballing speed-dependent motion (e.g. starfield pacing), wait 10-15s
  after launch before comparing frames, not just 1-2s.

The helper tears the server down for you, so there's no stray process to kill
between runs. If you ever bypass it and a server does linger, `pkill -f 'tsx
src/server-node'` clears it — but run that in its **own** Bash call, never
chained around the `node` driver invocation (see gotcha 3 above).
