// Cloudflare Worker entry: stateless request router. Static assets are served
// by the platform before this code runs (see [assets] in wrangler.toml); what
// reaches here is the room API, health checks, and WebSocket upgrades, which
// are forwarded to the owning RoomObject Durable Object by room code.

import type { Env } from './env';
export { RoomObject } from './room-object';

// Same ambiguity-free alphabet as the Node transport (no 0/O/1/I/L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z2-9]{4}$/; // bounds the DO namespace reachable by URL

function randomCode(): string {
  return Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
}

function roomStub(env: Env, code: string): DurableObjectStub {
  // idFromName gives every code a stable global address — the platform
  // routes all traffic for a code to one object, no directory needed.
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Liveness endpoint (platform health checks, uptime monitors).
    if (url.pathname === '/healthz') {
      return Response.json({ ok: true });
    }

    // Create a new ship: pick a code, ask its DO to claim it. A 409 means a
    // live game already holds that code (rare collision) — try another.
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomCode();
        const res = await roomStub(env, code).fetch(`https://room/create?code=${code}`, { method: 'POST' });
        if (res.ok) return Response.json({ code });
      }
      return Response.json({ error: 'could not allocate a room code' }, { status: 503 });
    }

    // Join info for the main screen's lobby (QR is rendered client-side).
    if (url.pathname === '/api/room-info') {
      const code = String(url.searchParams.get('code') || '').toUpperCase();
      if (!CODE_RE.test(code)) return Response.json({ error: 'no such room' }, { status: 404 });
      const res = await roomStub(env, code).fetch('https://room/status');
      if (!res.ok) return Response.json({ error: 'no such room' }, { status: 404 });
      const status = await res.json() as { phase?: string; claimed?: Record<string, boolean>; names?: Record<string, string> };
      const origin = env.PUBLIC_URL?.replace(/\/+$/, '') || url.origin;
      return Response.json({ code, joinUrl: `${origin}/?room=${code}`, phase: status.phase, claimed: status.claimed, names: status.names });
    }

    // WebSocket upgrade: the room code rides in the URL so routing happens
    // before any message is exchanged; the DO handles the rest.
    if (url.pathname === '/ws') {
      const code = String(url.searchParams.get('room') || '').toUpperCase();
      if (!CODE_RE.test(code)) return new Response('bad room code', { status: 400 });
      return roomStub(env, code).fetch(req);
    }

    // Fallback for anything the asset layer didn't serve.
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
