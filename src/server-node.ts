// HTTP + WebSocket server. Hosts the static client pages, a tiny REST API for
// creating rooms and fetching join QR codes, and the realtime socket that all
// player devices (and the main screen) connect to.

import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Game, type SeatId, type Difficulty } from './engine/game.js';
import { missionCatalog, resolveMissionStart } from './engine/mission-registry.js';

const PORT = Number(process.env.PORT || 3000);
const TICK_MS = Number(process.env.TICK_MS || 250);
// GAME_SPEED > 1 accelerates simulated time; used by the smoke test.
const GAME_SPEED = Number(process.env.GAME_SPEED || 1);
const ROOM_IDLE_MS = 10 * 60 * 1000; // delete rooms with no clients after 10 min

// Abuse guards: the server may be reachable from the public internet, where
// room codes are the only access control. These caps bound the blast radius
// of scripted abuse without affecting legitimate play.
const MAX_ROOMS = 200;
const MAX_CLIENTS_PER_ROOM = 16;
const MAX_MSG_BYTES = 4096;         // largest legitimate client message is <200B
const MAX_MSGS_PER_SEC = 60;        // humans generate ~a few actions per second
const CREATES_PER_MIN_PER_IP = 10;  // room-creation rate limit

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// --- Room registry ---

interface Room {
  code: string;
  game: Game;
  clients: Set<WebSocket>;
  emptySince: number | null; // timestamp when the last client left
  interval: ReturnType<typeof setInterval> | null; // null while the room is idle
}

const rooms = new Map<string, Room>();

// Room codes avoid ambiguous characters (0/O, 1/I/L) for easy phone entry.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode(): string {
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom(): Room {
  const code = makeCode();
  const game = new Game();
  const room: Room = { code, game, clients: new Set(), emptySince: Date.now(), interval: null };
  // Events are broadcast immediately so clients can toast/log them.
  game.onEvent = (text) => broadcast(room, { type: 'event', text });
  rooms.set(code, room);
  return room;
}

// The tick loop only runs while the room needs it: clients are connected
// (lobby/debrief screens still need state pushes) or a mission is active
// (an abandoned mission keeps simulating so the auto-crew can finish it and
// rejoining players find it where they left it). Idle rooms cost nothing.
function roomNeedsTick(room: Room): boolean {
  return room.clients.size > 0 || room.game.phase === 'active';
}

function ensureTicking(room: Room) {
  if (room.interval !== null) return;
  room.interval = setInterval(() => {
    room.game.tick((TICK_MS / 1000) * GAME_SPEED);
    broadcast(room, { type: 'state', state: room.game.serialize() });
    if (!roomNeedsTick(room)) stopTicking(room);
  }, TICK_MS);
}

function stopTicking(room: Room) {
  if (room.interval !== null) {
    clearInterval(room.interval);
    room.interval = null;
  }
}

// Garbage-collect rooms nobody has been connected to for a while.
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.clients.size === 0 && room.emptySince !== null && Date.now() - room.emptySince > ROOM_IDLE_MS) {
      stopTicking(room);
      rooms.delete(room.code);
    }
  }
}, 60_000);

function broadcast(room: Room, msg: unknown) {
  const data = JSON.stringify(msg);
  for (const ws of room.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

// First non-internal IPv4 address, for the phone-facing join URL / QR code.
function lanIp(): string {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// --- HTTP API ---

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Public origin for player-facing join URLs. Priority: PUBLIC_URL env
// override, then whatever host/scheme the request actually arrived on
// (correct for LAN IPs, port forwards, and cloud proxies alike).
function requestOrigin(req: express.Request): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

// Room-creation rate limiting: sliding window of creation timestamps per IP.
const roomCreations = new Map<string, number[]>();

// Create a new ship (room). The caller becomes the host / main screen.
app.post('/api/rooms', (req, res) => {
  if (rooms.size >= MAX_ROOMS) {
    res.status(503).json({ error: 'server is at capacity, try again later' });
    return;
  }
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (roomCreations.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= CREATES_PER_MIN_PER_IP) {
    res.status(429).json({ error: 'too many rooms created, slow down' });
    return;
  }
  recent.push(now);
  roomCreations.set(ip, recent);
  const room = createRoom();
  res.json({ code: room.code });
});

// Join info for a room: the URL players should open. The QR code is rendered
// client-side (public/js/vendor/qrcode-generator.mjs) so no server-side image
// generation is needed in any hosting environment.
app.get('/api/room-info', (req, res) => {
  const code = String(req.query.code || '').toUpperCase();
  if (!rooms.has(code)) {
    res.status(404).json({ error: 'no such room' });
    return;
  }
  res.json({ code, joinUrl: `${requestOrigin(req)}/?room=${code}` });
});

// Liveness endpoint for hosting platforms' health checks.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

// --- WebSocket handling ---

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

interface ClientMeta {
  room: Room;
  seat: SeatId;
  playerId: string;
}
const meta = new Map<WebSocket, ClientMeta>();

const VALID_SEATS: SeatId[] = ['helm', 'engineering', 'weapons', 'main'];

wss.on('connection', (ws) => {
  // Per-socket message rate window (resets every second). Oversized or
  // flooding sockets are closed; a legitimate client never approaches these.
  let msgWindowStart = Date.now();
  let msgCount = 0;

  ws.on('message', (raw, isBinary) => {
    const size = isBinary ? (raw as Buffer).length : Buffer.byteLength(String(raw));
    if (size > MAX_MSG_BYTES) {
      ws.close(1009, 'message too large');
      return;
    }
    const now = Date.now();
    if (now - msgWindowStart > 1000) {
      msgWindowStart = now;
      msgCount = 0;
    }
    if (++msgCount > MAX_MSGS_PER_SEC) {
      ws.close(1008, 'message rate exceeded');
      return;
    }

    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return; // ignore malformed frames
    }

    if (msg.type === 'join') {
      const room = rooms.get(String(msg.room || '').toUpperCase());
      const seat = msg.seat as SeatId;
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: 'No ship found with that code.' }));
        return;
      }
      if (!VALID_SEATS.includes(seat) || typeof msg.playerId !== 'string') {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid join request.' }));
        return;
      }
      if (room.clients.size >= MAX_CLIENTS_PER_ROOM) {
        ws.send(JSON.stringify({ type: 'error', message: 'This ship is at capacity.' }));
        return;
      }
      // The main screen is view-only and multiple are allowed (e.g. TV + a
      // laptop); crew seats are exclusive and handled by the game.
      if (seat !== 'main') {
        const result = room.game.join(seat, msg.playerId, String(msg.name || ''), msg.difficulty as Difficulty);
        if (!result.ok) {
          ws.send(JSON.stringify({ type: 'error', message: result.error }));
          return;
        }
      }
      meta.set(ws, { room, seat, playerId: msg.playerId });
      room.clients.add(ws);
      room.emptySince = null;
      ensureTicking(room); // a connected client always needs state pushes
      ws.send(JSON.stringify({
        type: 'joined',
        seat,
        code: room.code,
        state: room.game.serialize(),
        catalog: missionCatalog(), // lobby mission picker options
      }));
      return;
    }

    // All other messages require a prior successful join.
    const m = meta.get(ws);
    if (!m) return;
    if (msg.type === 'start') {
      // Any connected client may launch from the lobby. missionId picks an
      // authored mission or a generator preset; seed fixes the run's
      // randomness (tests/replays). Both optional — defaults apply.
      if (m.room.game.phase === 'lobby') {
        const { def, seed } = resolveMissionStart(
          typeof msg.missionId === 'string' ? msg.missionId : undefined,
          typeof msg.seed === 'number' ? msg.seed : undefined,
        );
        m.room.game.start(def, seed);
        ensureTicking(m.room);
      }
    } else if (msg.type === 'restart') {
      m.room.game.restartToLobby();
    } else if (msg.type === 'action' && msg.action && typeof msg.action.kind === 'string') {
      m.room.game.action(m.seat, msg.action);
    }
  });

  ws.on('close', () => {
    const m = meta.get(ws);
    if (!m) return;
    meta.delete(ws);
    m.room.clients.delete(ws);
    if (m.room.clients.size === 0) m.room.emptySince = Date.now();
    // Crew seats stay reserved for the playerId so reconnection resumes them.
    if (m.seat !== 'main') m.room.game.disconnect(m.seat, m.playerId);
  });
});

// Heartbeat: terminate sockets that stop responding to pings so their seats
// flip to auto-assist instead of hanging forever.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if ((ws as any).isAlive === false) {
      ws.terminate();
      continue;
    }
    (ws as any).isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on('connection', (ws) => {
  (ws as any).isAlive = true;
  ws.on('pong', () => ((ws as any).isAlive = true));
});
wss.on('close', () => clearInterval(heartbeat));

// Graceful shutdown: warn every connected client before the process exits so
// a deploy/restart reads as "reconnecting..." rather than a silent hang.
process.on('SIGTERM', () => {
  for (const room of rooms.values()) {
    broadcast(room, { type: 'event', text: 'Server restarting — reconnecting shortly...' });
    stopTicking(room);
    for (const ws of room.clients) ws.close(1012, 'server restarting');
  }
  server.close(() => process.exit(0));
  // Failsafe if sockets linger past close().
  setTimeout(() => process.exit(0), 3000).unref();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Bridge server ready:`);
  console.log(`  Host (main screen): http://localhost:${PORT}/`);
  console.log(`  Players (LAN):      http://${lanIp()}:${PORT}/`);
});
