// HTTP + WebSocket server. Hosts the static client pages, a tiny REST API for
// creating rooms and fetching join QR codes, and the realtime socket that all
// player devices (and the main screen) connect to.

import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { WebSocketServer, WebSocket } from 'ws';
import { Game, type SeatId, type Difficulty } from './game.js';

const PORT = Number(process.env.PORT || 3000);
const TICK_MS = Number(process.env.TICK_MS || 250);
// GAME_SPEED > 1 accelerates simulated time; used by the smoke test.
const GAME_SPEED = Number(process.env.GAME_SPEED || 1);
const ROOM_IDLE_MS = 10 * 60 * 1000; // delete rooms with no clients after 10 min

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// --- Room registry ---

interface Room {
  code: string;
  game: Game;
  clients: Set<WebSocket>;
  emptySince: number | null; // timestamp when the last client left
  interval: ReturnType<typeof setInterval>;
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
  const room: Room = { code, game, clients: new Set(), emptySince: Date.now(), interval: null as never };
  // Events are broadcast immediately so clients can toast/log them.
  game.onEvent = (text) => broadcast(room, { type: 'event', text });
  // Fixed-rate tick drives the simulation and pushes state to every client.
  room.interval = setInterval(() => {
    game.tick((TICK_MS / 1000) * GAME_SPEED);
    broadcast(room, { type: 'state', state: game.serialize() });
    // Garbage-collect rooms nobody is connected to.
    if (room.clients.size === 0 && room.emptySince !== null && Date.now() - room.emptySince > ROOM_IDLE_MS) {
      clearInterval(room.interval);
      rooms.delete(room.code);
    }
  }, TICK_MS);
  rooms.set(code, room);
  return room;
}

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

// Create a new ship (room). The caller becomes the host / main screen.
app.post('/api/rooms', (_req, res) => {
  const room = createRoom();
  res.json({ code: room.code });
});

// Join info for a room: the LAN URL players should open, plus a QR data URL.
app.get('/api/room-info', async (req, res) => {
  const code = String(req.query.code || '').toUpperCase();
  if (!rooms.has(code)) {
    res.status(404).json({ error: 'no such room' });
    return;
  }
  const joinUrl = `http://${lanIp()}:${PORT}/?room=${code}`;
  const qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1, width: 260 });
  res.json({ code, joinUrl, qrDataUrl });
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
  ws.on('message', (raw) => {
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
      ws.send(JSON.stringify({ type: 'joined', seat, code: room.code, state: room.game.serialize() }));
      return;
    }

    // All other messages require a prior successful join.
    const m = meta.get(ws);
    if (!m) return;
    if (msg.type === 'start') {
      // Any connected client may launch the mission from the lobby.
      if (m.room.game.phase === 'lobby') m.room.game.start();
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Bridge server ready:`);
  console.log(`  Host (main screen): http://localhost:${PORT}/`);
  console.log(`  Players (LAN):      http://${lanIp()}:${PORT}/`);
});
