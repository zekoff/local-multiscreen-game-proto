// Durable Object: one instance per room (ship), addressed by room code via
// idFromName. The platform guarantees all requests for a code reach the same
// single-threaded object, which is exactly the room-affinity property the
// game needs — the DO owns the authoritative Game instance, its WebSockets,
// and its tick loop, mirroring the Node transport's behavior and protocol.

import { Game, type SeatId, type Difficulty } from '../engine/game';
import { missionCatalog, resolveMissionStart } from '../engine/mission-registry';
import type { Env } from './env';

const VALID_SEATS: SeatId[] = ['helm', 'engineering', 'weapons', 'main', 'supervisor'];
// View-only seats: non-exclusive, don't reserve a game seat (main screen, sim supervisor).
const VIEW_SEATS: SeatId[] = ['main', 'supervisor'];

// Same abuse caps as the Node transport (see docs/cloud-migration.md).
const MAX_CLIENTS_PER_ROOM = 16;
const MAX_MSG_BYTES = 4096;
const MAX_MSGS_PER_SEC = 60;

interface ClientMeta {
  seat: SeatId;
  playerId: string;
  msgWindowStart: number; // per-socket rate window
  msgCount: number;
}

export class RoomObject {
  private game: Game;
  private clients = new Map<WebSocket, ClientMeta>();
  private interval: number | null = null; // null while the room is idle
  private code: string | null = null;     // null until claimed via /create
  private readonly tickMs: number;
  private readonly speed: number;

  constructor(private state: DurableObjectState, env: Env) {
    this.tickMs = Number(env.TICK_MS || 250);
    this.speed = Number(env.GAME_SPEED || 1);
    this.game = this.freshGame();
    // Restore room identity if the object was evicted/restarted. Mission
    // state is not persisted in the prototype: the room comes back as a
    // fresh lobby, but its code keeps working (Phase 3 adds persistence).
    this.state.blockConcurrencyWhile(async () => {
      this.code = (await this.state.storage.get<string>('code')) ?? null;
    });
  }

  private freshGame(): Game {
    const game = new Game();
    game.onEvent = (text) => this.broadcast({ type: 'event', text });
    return game;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Claim this room code (called by the Worker on POST /api/rooms). A 409
    // makes the Worker retry with a different code, so a rare 4-char code
    // collision with a live game is handled instead of hijacked.
    if (url.pathname === '/create') {
      if (this.clients.size > 0 || this.game.phase === 'active') {
        return new Response('room code in use', { status: 409 });
      }
      this.code = String(url.searchParams.get('code') || '');
      await this.state.storage.put('code', this.code);
      this.game = this.freshGame();
      return Response.json({ ok: true });
    }

    // Existence/status probe (used by /api/room-info).
    if (url.pathname === '/status') {
      if (this.code === null) return new Response('no such room', { status: 404 });
      return Response.json({ code: this.code, phase: this.game.phase, clients: this.clients.size });
    }

    // WebSocket upgrade, forwarded here by the Worker with ?room= routing.
    if (url.pathname === '/ws') {
      if (this.code === null) return new Response('no such room', { status: 404 });
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('expected websocket upgrade', { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      server.accept();
      server.addEventListener('message', (ev) => this.onMessage(server, ev));
      server.addEventListener('close', () => this.onClose(server));
      server.addEventListener('error', () => this.onClose(server));
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('not found', { status: 404 });
  }

  // --- WebSocket message handling: same protocol as the Node transport ---

  private onMessage(ws: WebSocket, ev: MessageEvent) {
    const raw = typeof ev.data === 'string' ? ev.data : '';
    if (raw.length > MAX_MSG_BYTES) {
      ws.close(1009, 'message too large');
      return;
    }
    // Per-socket flood guard, mirroring the Node transport.
    const m = this.clients.get(ws);
    if (m) {
      const now = Date.now();
      if (now - m.msgWindowStart > 1000) {
        m.msgWindowStart = now;
        m.msgCount = 0;
      }
      if (++m.msgCount > MAX_MSGS_PER_SEC) {
        ws.close(1008, 'message rate exceeded');
        return;
      }
    }

    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // ignore malformed frames
    }

    if (msg.type === 'join') {
      if (!VALID_SEATS.includes(msg.seat) || typeof msg.playerId !== 'string') {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid join request.' }));
        return;
      }
      if (this.clients.size >= MAX_CLIENTS_PER_ROOM) {
        ws.send(JSON.stringify({ type: 'error', message: 'This ship is at capacity.' }));
        return;
      }
      // Crew seats are exclusive (game enforces sticky-playerId resumption);
      // view-only seats (main screen, sim supervisor) are non-exclusive.
      if (!VIEW_SEATS.includes(msg.seat)) {
        const result = this.game.join(msg.seat, msg.playerId, String(msg.name || ''), msg.difficulty as Difficulty);
        if (!result.ok) {
          ws.send(JSON.stringify({ type: 'error', message: result.error }));
          return;
        }
      }
      this.clients.set(ws, { seat: msg.seat, playerId: msg.playerId, msgWindowStart: Date.now(), msgCount: 0 });
      this.ensureTicking();
      ws.send(JSON.stringify({
        type: 'joined',
        seat: msg.seat,
        code: this.code,
        state: this.game.serialize(),
        catalog: missionCatalog(), // lobby mission picker options
      }));
      return;
    }

    if (!m) return; // everything else requires a prior successful join
    if (msg.type === 'start') {
      // Same mission-resolution contract as the Node transport.
      if (this.game.phase === 'lobby') {
        const { def, seed } = resolveMissionStart(
          typeof msg.missionId === 'string' ? msg.missionId : undefined,
          typeof msg.seed === 'number' ? msg.seed : undefined,
        );
        this.game.start(def, seed, msg.debug === true);
        this.ensureTicking();
      }
    } else if (msg.type === 'restart') {
      this.game.restartToLobby();
    } else if (msg.type === 'action' && msg.action && typeof msg.action.kind === 'string') {
      this.game.action(m.seat, msg.action);
    }
  }

  private onClose(ws: WebSocket) {
    const m = this.clients.get(ws);
    if (!m) return;
    this.clients.delete(ws);
    // Crew seats stay reserved for the playerId so reconnection resumes them.
    if (!VIEW_SEATS.includes(m.seat)) this.game.disconnect(m.seat, m.playerId);
  }

  // --- Tick loop: runs only while clients are connected or a mission is
  // active (an abandoned mission keeps simulating so the auto-crew finishes
  // it). While idle, the DO does no work and can be evicted by the platform.

  private needsTick(): boolean {
    return this.clients.size > 0 || this.game.phase === 'active';
  }

  private ensureTicking() {
    if (this.interval !== null) return;
    this.interval = setInterval(() => {
      this.game.tick((this.tickMs / 1000) * this.speed);
      this.broadcast({ type: 'state', state: this.game.serialize() });
      this.game.clearFx(); // one-shot effects delivered; reset for the next tick
      if (!this.needsTick()) this.stopTicking();
    }, this.tickMs);
  }

  private stopTicking() {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private broadcast(msg: unknown) {
    const data = JSON.stringify(msg);
    for (const ws of this.clients.keys()) {
      try {
        ws.send(data);
      } catch {
        // socket already dead; close handler will clean it up
      }
    }
  }
}
