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

## Launch

```bash
npm start &                # binds :3000
timeout 20 bash -c 'until curl -sf http://localhost:3000/healthz >/dev/null; do sleep 0.5; done'
curl -sX POST http://localhost:3000/api/rooms   # -> {"code":"XXXX"}
```

## Drive with Playwright

There's no `chromium-cli` wrapper in this repo — write a small one-off
`.mjs` driver, run it with `node` **from the repo root** (module resolution
needs `node_modules/playwright` on the path), and delete it when done. Key
gotchas specific to this app:

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

Minimal template:

```js
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
await page.goto('http://localhost:3000/mainscreen.html?room=XXXX');
await page.waitForTimeout(800);
await page.click('#launch-btn', { force: true });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/frame.png' });
await browser.close();
```

Stop the server with `kill %1` (or `pkill -f 'tsx src/server-node.ts'`)
before relaunching, or the next run hits `EADDRINUSE`.
