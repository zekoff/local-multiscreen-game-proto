// Shared headless bot crew used by both smoke tests (Node transport and the
// Cloudflare Workers transport). Creates a room over the real HTTP API,
// connects all four seats over real WebSockets, launches the mission, and
// plays it with the shared 'skilled' policies until the debrief.

import WebSocket from 'ws';
import { makeCrew } from './policies.mjs';

// Connect one seat and react to every state broadcast with `onState`.
function connectSeat(base, code, seat, onState) {
  const wsBase = base.replace(/^http/, 'ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws?room=${code}`);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'join', room: code, seat,
        name: `bot-${seat}`, difficulty: 'officer',
        playerId: `smoke-${seat}`,
      }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'joined') resolve(ws);
      else if (msg.type === 'error') reject(new Error(`${seat}: ${msg.message}`));
      else if (msg.type === 'state') onState(ws, msg.state);
    });
    ws.on('error', reject);
  });
}

const send = (ws, action) => ws.send(JSON.stringify({ type: 'action', action }));

// Runs a full mission against `base` (e.g. http://127.0.0.1:3123).
// Options: missionId/seed select and pin the mission (defaults: server picks
// the default mission with a fresh seed). Resolves with the debrief object.
export async function runBotCrew(base, { timeoutMs = 90_000, missionId, seed } = {}) {
  const res = await fetch(`${base}/api/rooms`, { method: 'POST' });
  if (!res.ok) throw new Error(`room creation failed: HTTP ${res.status}`);
  const { code } = await res.json();
  console.log(`room created: ${code}`);

  let finish;
  const done = new Promise((resolve, reject) => {
    finish = resolve;
    setTimeout(() => reject(new Error('timed out waiting for debrief')), timeoutMs);
  });

  // Station bots run the shared 'skilled' policies over the wire.
  const crew = makeCrew('skilled');
  const policyHandler = (seat) => (ws, s) => {
    for (const action of crew[seat](s)) send(ws, action);
  };
  // Main screen bot: watches for the debrief and reports the outcome.
  const mainState = (_ws, s) => {
    if (s.phase === 'debrief' && s.debrief) finish(s.debrief);
  };

  const sockets = await Promise.all([
    connectSeat(base, code, 'helm', policyHandler('helm')),
    connectSeat(base, code, 'engineering', policyHandler('engineering')),
    connectSeat(base, code, 'weapons', policyHandler('weapons')),
    connectSeat(base, code, 'crewchief', policyHandler('crewchief')),
    connectSeat(base, code, 'main', mainState),
  ]);

  // Launch the mission from the main screen seat (now the 5th socket).
  sockets[4].send(JSON.stringify({ type: 'start', missionId, seed }));
  console.log(`mission launched (${missionId ?? 'default'}), bots playing...`);

  try {
    return await done;
  } finally {
    for (const ws of sockets) ws.close();
  }
}

// Spawn a server process and resolve once `readyPattern` appears on stdout.
export function spawnServer(cmd, args, { env = {}, readyPattern, startTimeoutMs = 60_000 }) {
  return import('node:child_process').then(({ spawn }) => {
    // detached: negative-PID kill reaps grandchildren (npx → tsx/wrangler → workerd)
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const killTree = () => {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
    };
    process.on('exit', killTree);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`server did not print ready pattern within ${startTimeoutMs}ms`)), startTimeoutMs);
      const onData = (d) => {
        process.stderr.write(d); // surface server logs in test output
        if (readyPattern.test(String(d))) {
          clearTimeout(t);
          resolve({ child, killTree });
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('exit', (codeNum) => reject(new Error(`server exited early (code ${codeNum})`)));
    });
  });
}
