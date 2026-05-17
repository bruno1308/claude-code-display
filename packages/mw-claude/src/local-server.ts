import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'node:events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface LocalServerEvents {
  prompt: (text: string) => void;
}

export class LocalServer extends EventEmitter {
  private http: http.Server;
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(private port: number) {
    super();
    this.http = http.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.http, path: '/ws' });
    this.wss.on('connection', (ws) => this.handleWs(ws));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.http.listen(this.port, '127.0.0.1', () => resolve());
    });
  }

  sendReply(text: string): void {
    const frame = JSON.stringify({ type: 'reply', text });
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
    }
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.url === '/' || req.url === '/index.html') {
      const filePath = path.join(__dirname, 'static', 'index.html');
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.statusCode = 500;
          res.end('index.html read error: ' + err.message);
          return;
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(data);
      });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  }

  private handleWs(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'prompt' && typeof msg.text === 'string') {
          this.emit('prompt', msg.text);
        }
      } catch {
        // ignore malformed frames
      }
    });
    ws.on('close', () => this.clients.delete(ws));
  }
}
