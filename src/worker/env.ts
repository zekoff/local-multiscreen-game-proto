// Bindings and vars available to the Cloudflare Worker and Durable Objects.
// Declared in wrangler.toml; vars can be overridden per-environment or with
// `wrangler dev --var KEY:VALUE` (the CF smoke test uses GAME_SPEED).

export interface Env {
  ROOMS: DurableObjectNamespace; // one RoomObject per ship, addressed by room code
  ASSETS: Fetcher;               // static client pages in public/
  PUBLIC_URL?: string;           // optional override for player-facing join URLs
  GAME_SPEED?: string;           // simulated-time multiplier (tests)
  TICK_MS?: string;              // server tick interval override
}
