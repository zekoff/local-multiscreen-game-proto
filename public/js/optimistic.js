// Optimistic-intent overlay (the generic version of the pattern described in
// docs/architecture.md): when a station sends an action, it records the
// INTENDED value here and renders it immediately, instead of waiting ~250ms
// for the next authoritative snapshot. The overlay is reconciled against
// every incoming snapshot — cleared the moment the server confirms the value,
// or silently dropped after `ttl` snapshots if the server never does (action
// rejected, race lost). The server state always wins; this never predicts
// derived simulation values (speed, impact times), only echoes commanded
// setpoints and toggles.

export function createIntents() {
  const pending = new Map(); // key -> { value, matches, ttl }
  return {
    // Record an intent: `matches(state)` returns true once the server state
    // reflects it (which clears the intent). ttl = snapshots before giving up.
    set(key, value, matches, ttl = 3) {
      pending.set(key, { value, matches, ttl });
    },
    // The pending value for a key, or undefined if none (render helpers do:
    // `intents.get('shields') ?? state.shields.raised`).
    get(key) {
      return pending.get(key)?.value;
    },
    has(key) {
      return pending.has(key);
    },
    // Valueless transient for impulse actions (fire, nudge): exists for `ttl`
    // snapshots then vanishes — no confirmation to wait for.
    flash(key, ttl = 2) {
      pending.set(key, { value: true, matches: null, ttl });
    },
    // Called once per incoming snapshot (station.js does this before render).
    reconcile(state) {
      for (const [key, p] of pending) {
        if (p.matches && p.matches(state)) {
          pending.delete(key); // server confirmed: authoritative state takes over
          continue;
        }
        p.ttl -= 1;
        if (p.ttl <= 0) pending.delete(key); // never confirmed: quietly revert
      }
    },
  };
}
