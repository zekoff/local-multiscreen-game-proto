// End-to-end smoke test: boots the real server at accelerated game speed,
// connects a bot crew over real WebSockets (helm, engineering, weapons, main
// screen), launches the mission, and plays competently until the debrief.
// Exits 0 on a completed mission, 1 on any failure or timeout.

import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = 90_000;

function fail(msg) {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}

// --- Boot the server with 10x simulated time ---
const server = spawn('npx', ['tsx', 'src/server.ts'], {
  env: { ...process.env, PORT: String(PORT), GAME_SPEED: '10' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
process.on('exit', () => server.kill());

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start')), 15000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('Bridge server ready')) { clearTimeout(t); resolve(); }
  });
}).catch((e) => fail(e.message));

// --- Create a room ---
const { code } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json();
console.log(`room created: ${code}`);

// --- Bot crew: each seat connects and reacts to every state broadcast ---
function connectSeat(seat, onState) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'join', room: code, seat,
        name: `bot-${seat}`, difficulty: 'normal',
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
let done = false;

// Helm bot: full throttle, correct course whenever drift builds up.
const helmState = (ws, s) => {
  if (s.phase !== 'active') return;
  if (s.throttle < 100) send(ws, { kind: 'throttle', value: 100 });
  if (Math.abs(s.alignment) > 10) send(ws, { kind: 'nudge', dir: s.alignment > 0 ? -1 : 1 });
};
// Engineering bot: reset any tripped breaker immediately.
const engState = (ws, s) => {
  if (s.phase !== 'active') return;
  for (const sys of ['engines', 'shields', 'weapons']) {
    if (s.breakers[sys]) send(ws, { kind: 'resetBreaker', system: sys });
  }
};
// Weapons bot: raise shields, target the most urgent contact, fire when charged.
let shieldsUp = false;
const wepState = (ws, s) => {
  if (s.phase !== 'active') return;
  if (!s.shields.raised && !shieldsUp) { shieldsUp = true; send(ws, { kind: 'shields', raised: true }); }
  if (s.asteroids.length > 0) {
    const urgent = [...s.asteroids].sort((a, b) => a.impactIn - b.impactIn)[0];
    if (s.targetId !== urgent.id) send(ws, { kind: 'target', id: urgent.id });
    if (s.charge >= s.fireCost && s.targetId !== null) send(ws, { kind: 'fire' });
  }
};
// Main screen bot: just watches for the debrief and reports the outcome.
const mainState = (_ws, s) => {
  if (s.phase === 'debrief' && s.debrief && !done) {
    done = true;
    console.log(`debrief reached: ${s.debrief.outcome} — ${s.debrief.grade} (${s.debrief.score}/100)`);
    console.log(`stats: ${JSON.stringify(s.debrief.stats)}`);
    if (s.debrief.outcome !== 'arrived') fail('bot crew should have arrived but went adrift');
    console.log('SMOKE PASS');
    process.exit(0);
  }
};

const [helm, , , mainWs] = await Promise.all([
  connectSeat('helm', helmState),
  connectSeat('engineering', engState),
  connectSeat('weapons', wepState),
  connectSeat('main', mainState),
]).catch((e) => fail(e.message));

// Launch the mission from the main screen.
mainWs.send(JSON.stringify({ type: 'start' }));
console.log('mission launched, bots playing...');

setTimeout(() => fail('timed out waiting for debrief'), TIMEOUT_MS);
