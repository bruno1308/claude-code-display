import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import { decrypt, encrypt, type KeyPair } from './crypto.js';

export interface RelayClientOpts {
  relayUrl: string;
  channelId: string;
  role: 'daemon' | 'client';
  myKeyPair: KeyPair;
  peerPublicKey: Uint8Array | null;
}

export class RelayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private opts: RelayClientOpts;
  private backoff = 500;
  private closed = false;

  constructor(opts: RelayClientOpts) {
    super();
    this.opts = opts;
  }

  setPeerPublicKey(pub: Uint8Array): void {
    this.opts.peerPublicKey = pub;
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.ws?.close();
  }

  send(plaintext: string): void {
    if (!this.opts.peerPublicKey) {
      this.emit('error', new Error('peerPublicKey not set; cannot encrypt'));
      return;
    }
    const ct = encrypt({
      from: this.opts.myKeyPair,
      toPub: this.opts.peerPublicKey,
      plaintext,
    });
    this.sendRaw(JSON.stringify({ type: 'msg', ct }));
  }

  sendRaw(json: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(json);
    }
  }

  private connect(): void {
    if (this.closed) return;
    const url = `${this.opts.relayUrl}?channel=${encodeURIComponent(this.opts.channelId)}&role=${this.opts.role}`;
    this.ws = new WebSocket(url);
    this.ws.on('open', () => {
      this.backoff = 500;
      this.emit('open');
    });
    this.ws.on('message', (raw) => {
      let frame: unknown;
      try { frame = JSON.parse(raw.toString()); } catch { return; }
      const f = frame as { type?: string };
      if (f.type === 'hello' || f.type === 'hello_ack' || f.type === 'peer_disconnect') {
        this.emit('control', frame);
      } else if (f.type === 'msg') {
        if (!this.opts.peerPublicKey) return;
        const ctf = frame as { type: 'msg'; ct: string };
        try {
          const pt = decrypt({
            to: this.opts.myKeyPair,
            fromPub: this.opts.peerPublicKey,
            ciphertext: ctf.ct,
          });
          this.emit('message', pt);
        } catch (err) {
          this.emit('error', err);
        }
      }
    });
    this.ws.on('close', () => {
      this.emit('close');
      if (!this.closed) {
        setTimeout(() => this.connect(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 10000);
      }
    });
    this.ws.on('error', (err) => this.emit('error', err));
  }
}
