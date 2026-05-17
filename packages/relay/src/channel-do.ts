type Role = 'client' | 'daemon';

interface DurableObjectStateExt extends DurableObjectState {
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
}

export class Channel {
  constructor(private state: DurableObjectStateExt, private env: unknown) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const role = url.searchParams.get('role');
    if (role !== 'client' && role !== 'daemon') {
      return new Response('missing or invalid role', { status: 400 });
    }
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 });
    }

    // Single connection per role per channel. New connection replaces the old.
    for (const old of this.state.getWebSockets(role)) {
      try { old.close(4000, 'replaced'); } catch {}
    }

    const pair = new WebSocketPair();
    const [clientSide, serverSide] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(serverSide, [role]);

    // Two notifications: tell the existing peer we joined, and tell us if a
    // peer is already present (so a refreshing client learns about an
    // already-running daemon, not just the other way around).
    const otherRole: Role = role === 'client' ? 'daemon' : 'client';
    const peerSockets = this.state.getWebSockets(otherRole);
    for (const t of peerSockets) {
      try { t.send(JSON.stringify({ type: 'peer_connect', role })); } catch {}
    }
    if (peerSockets.length > 0) {
      try { serverSide.send(JSON.stringify({ type: 'peer_connect', role: otherRole })); } catch {}
    }

    return new Response(null, { status: 101, webSocket: clientSide });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const role: Role = this.state.getWebSockets('client').includes(ws) ? 'client' : 'daemon';
    const otherRole: Role = role === 'client' ? 'daemon' : 'client';
    const targets = this.state.getWebSockets(otherRole);
    for (const t of targets) {
      try {
        t.send(typeof message === 'string' ? message : new Uint8Array(message));
      } catch {
        // drop on send failure
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const role: Role = this.state.getWebSockets('client').includes(ws) ? 'client' : 'daemon';
    const otherRole: Role = role === 'client' ? 'daemon' : 'client';
    for (const t of this.state.getWebSockets(otherRole)) {
      try { t.send(JSON.stringify({ type: 'peer_disconnect', role })); } catch {}
    }
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // No-op; close handler runs separately.
  }
}
