// Shared WebSocket client with automatic reconnection and seat resumption.
// Each browser tab gets a sticky playerId (sessionStorage) so a dropped
// connection rejoins the same seat instead of being told "seat taken".

export class Net {
  constructor({ room, seat, name, difficulty, handlers }) {
    this.room = room;
    this.seat = seat;
    this.name = name || '';
    this.difficulty = difficulty || 'officer';
    this.handlers = handlers; // { onState, onEvent, onJoined, onError, onStatus }
    this.retryMs = 1000;
    this.closedByUser = false;

    // sessionStorage is per-tab: multiple tabs on one device can each hold a
    // different seat, while a reload in the same tab resumes its seat.
    this.playerId = sessionStorage.getItem('bridge-player-id');
    if (!this.playerId) {
      this.playerId = crypto.randomUUID();
      sessionStorage.setItem('bridge-player-id', this.playerId);
    }
  }

  connect() {
    this.handlers.onStatus?.('connecting');
    // wss when the page is served over https (required in cloud hosting; a
    // https page cannot open a plain ws:// socket). The room code rides in
    // the URL so a routing layer can pick the owning server before any
    // message is exchanged; the Node server reads it from the join message.
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(this.room)}`);

    this.ws.addEventListener('open', () => {
      this.retryMs = 1000; // reset backoff on success
      this.send({
        type: 'join',
        room: this.room,
        seat: this.seat,
        name: this.name,
        difficulty: this.difficulty,
        playerId: this.playerId,
      });
    });

    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'joined') {
        this.handlers.onStatus?.('connected');
        this.handlers.onJoined?.(msg);
        this.handlers.onState?.(msg.state);
      } else if (msg.type === 'state') {
        this.handlers.onState?.(msg.state);
      } else if (msg.type === 'event') {
        this.handlers.onEvent?.(msg.text);
      } else if (msg.type === 'error') {
        this.handlers.onError?.(msg.message);
      }
    });

    // Reconnect with capped exponential backoff whenever the socket drops.
    this.ws.addEventListener('close', () => {
      if (this.closedByUser) return;
      this.handlers.onStatus?.('disconnected');
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 1.7, 8000);
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  // Convenience wrapper for role-scoped control actions.
  action(action) {
    this.send({ type: 'action', action });
  }
}
