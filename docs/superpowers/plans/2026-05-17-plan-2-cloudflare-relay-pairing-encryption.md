# Plan 2 — Cloudflare Relay + Pairing + E2E Encryption

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the Plan 1 localhost loop to an internet-reachable relay hosted on Cloudflare with QR-based pairing and end-to-end encryption between browser/glasses client and the `mw-claude` daemon. After this plan, a browser at the production Workers URL can pair with your PC and have a working prompt-reply loop, and the relay is never able to read content.

**Architecture:** A single Cloudflare Worker hosts both:

- **Static webapp** at `/` — a Vite-built React SPA serving the test client (will be replaced by the glasses webapp in Plan 3). Delivered via Workers Assets.
- **WebSocket relay** at `/api/ws` — routes the connection to a **Durable Object** instance keyed by `channel_id`. The DO holds the two WebSockets (client + daemon) and pipes encrypted frames between them. State stays in the DO — no external pub/sub layer.

Both sides speak a tiny JSON wire protocol carrying libsodium-`crypto_box` ciphertext. Pairing is a one-time QR scan that bootstraps each side's knowledge of the other's public key plus the shared channel ID.

**Why Cloudflare instead of Vercel for this product:**

- Durable Objects are literally designed for stateful WebSocket routing — one DO per channel, no fan-out service required.
- WebSockets are first-class in Workers; no upgrade hacks, no execution-window reconnect dance.
- Free tier covers personal use forever (100k requests/day, 1M DO invocations/month).
- Edge-hosted globally — lower latency than us-east-only deployments.
- Bonus: Workers AI runs `@cf/openai/whisper` natively, so Plan 4's speech-to-text can live in the same Worker with no separate API key (we'll revisit this when we get there).
- One `wrangler deploy` ships everything.

**Tech Stack:** Cloudflare Workers (Node compat mode), Durable Objects, Workers Assets, Vite + React 19 for the SPA, `libsodium-wrappers` for crypto in both daemon and browser, `qrcode-terminal` for daemon-side QR rendering, existing `mw-claude` package extended.

**Prerequisite:** Plan 1 complete and verified. A Cloudflare account (free tier is fine). Wrangler CLI installed via the first task.

---

## File structure (new + modified)

```
B:\Projects\ClaudeDisplay\
├── packages\
│   ├── mw-claude\                      (extended)
│   │   ├── src\
│   │   │   ├── cli.ts                  (rewritten — adds `pair` and `run` subcommands)
│   │   │   ├── pty-session.ts          (unchanged)
│   │   │   ├── output-parser.ts        (unchanged)
│   │   │   ├── local-server.ts         (unchanged — kept; `--local` subcommand re-uses it later)
│   │   │   ├── config-store.ts         (NEW — ~/.mw-claude/config.json)
│   │   │   ├── crypto.ts               (NEW — libsodium envelope)
│   │   │   ├── relay-client.ts         (NEW — WS client to Cloudflare relay)
│   │   │   └── pair.ts                 (NEW — pair subcommand QR flow)
│   │   └── tests\
│   │       ├── crypto.test.ts          (NEW)
│   │       ├── config-store.test.ts    (NEW)
│   │       └── ...                     (existing 7 tests untouched)
│   └── relay\                          (NEW package — the Cloudflare Worker)
│       ├── package.json
│       ├── wrangler.toml               (Worker + DO + Assets config)
│       ├── tsconfig.json
│       ├── vite.config.ts              (Vite for the React SPA)
│       ├── index.html                  (Vite entry)
│       ├── src\
│       │   ├── worker.ts               (Worker entry — routes / and /api/ws)
│       │   ├── channel-do.ts           (Durable Object class)
│       │   └── client\
│       │       ├── main.tsx            (React entry)
│       │       └── App.tsx             (test client UI)
│       └── public\                     (static assets if needed)
```

**File responsibilities:**

- `relay/src/worker.ts` — fetch handler. Routes `/api/ws?channel=...&role=...` to the matching Durable Object via `env.CHANNELS.idFromName(channel)`. All other paths fall through to Workers Assets which serves the built SPA.
- `relay/src/channel-do.ts` — `Channel` Durable Object class. Holds up to two WebSockets (one `client`, one `daemon`). On `webSocketMessage` from one side, forwards opaque payload to the other. Stateless beyond the two sockets.
- `relay/src/client/App.tsx` — React test client. Same UX as Plan 1's HTML page, but loads pairing payload from `?p=<base64>` or `localStorage`, generates its own libsodium keypair, performs the `hello` handshake, then exchanges encrypted frames.
- `mw-claude/src/config-store.ts` — reads/writes `~/.mw-claude/config.json` (channel_id, daemon keypair, peer pubkey, relay URL).
- `mw-claude/src/crypto.ts` — `encrypt({to, from, plaintext})` / `decrypt({from, to, ciphertext})` using libsodium `crypto_box`.
- `mw-claude/src/relay-client.ts` — connects WS to relay with reconnect backoff, dispatches `prompt` events, accepts `reply` outbound.
- `mw-claude/src/pair.ts` — generates keypair, channel ID; prints QR encoding `{v:1, channel_id, daemon_pub, relay_url}`; opens relay WS as `daemon`; waits for browser handshake; persists peer pubkey.
- `mw-claude/src/cli.ts` — subcommands `pair` and `run` (default). `run` requires config, opens relay client, wires the existing PtySession + segmenter.

---

## Task 1: Install Wrangler + authenticate

**Files:** none (tooling step)

- [ ] **Step 1: Install Wrangler globally**

```
npm i -g wrangler
wrangler --version
```

Expected: version string printed (Wrangler 4.x or later).

- [ ] **Step 2: Authenticate**

```
wrangler login
```

A browser tab opens. Complete the Cloudflare OAuth flow. After success, `wrangler whoami` should print your account email and account ID.

- [ ] **Step 3: No commit**

Tooling-only step.

---

## Task 2: Scaffold the `relay` package

**Files:**
- Create: `packages/relay/package.json`
- Create: `packages/relay/wrangler.toml`
- Create: `packages/relay/tsconfig.json`
- Create: `packages/relay/vite.config.ts`
- Create: `packages/relay/index.html`
- Create: `packages/relay/src/worker.ts` (minimal placeholder)
- Create: `packages/relay/src/channel-do.ts` (minimal placeholder)
- Create: `packages/relay/src/client/main.tsx`
- Create: `packages/relay/src/client/App.tsx` (placeholder)
- Modify: root `package.json` to add `dev:relay` script

- [ ] **Step 1: Create `packages/relay/package.json`**

```json
{
  "name": "relay",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "build": "vite build",
    "deploy": "vite build && wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "libsodium-wrappers": "^0.7.15"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250101.0",
    "@types/libsodium-wrappers": "^0.7.14",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0",
    "wrangler": "^4.0.0"
  }
}
```

If `wrangler@^4` is not yet on npm at execution time, fall back to the latest 3.x. Document the chosen version in a one-line comment in `wrangler.toml`.

- [ ] **Step 2: Create `packages/relay/wrangler.toml`**

```toml
name = "claude-display"
main = "src/worker.ts"
compatibility_date = "2026-01-15"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./dist"
binding = "ASSETS"

[[durable_objects.bindings]]
name = "CHANNELS"
class_name = "Channel"

[[migrations]]
tag = "v1"
new_classes = ["Channel"]
```

- [ ] **Step 3: Create `packages/relay/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["@cloudflare/workers-types/2023-07-01", "vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "*.config.ts"]
}
```

- [ ] **Step 4: Create `packages/relay/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
```

- [ ] **Step 5: Create `packages/relay/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claude Display</title>
  </head>
  <body style="margin: 0; background: #0b0d10; color: #e7e7e7; font-family: ui-monospace, monospace;">
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `packages/relay/src/client/main.tsx`**

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
```

- [ ] **Step 7: Create placeholder `packages/relay/src/client/App.tsx`**

```tsx
export function App() {
  return (
    <main style={{ maxWidth: 900, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Claude Display</h1>
      <p>relay scaffold — pairing UI lands in Task 8.</p>
    </main>
  );
}
```

- [ ] **Step 8: Create placeholder `packages/relay/src/worker.ts`**

```ts
import { Channel } from './channel-do';

export { Channel };

export interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  CHANNELS: DurableObjectNamespace;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/ws') {
      return new Response('WS handler lands in Task 4', { status: 501 });
    }
    return env.ASSETS.fetch(req);
  },
};
```

- [ ] **Step 9: Create placeholder `packages/relay/src/channel-do.ts`**

```ts
export class Channel {
  constructor(private state: DurableObjectState, private env: unknown) {}

  async fetch(req: Request): Promise<Response> {
    return new Response('Channel DO lands in Task 4', { status: 501 });
  }
}
```

- [ ] **Step 10: Add `dev:relay` script to root `package.json`**

Edit root `package.json`. In the `scripts` block, add `"dev:relay": "npm run dev -w packages/relay"` next to `dev:mw-claude`.

- [ ] **Step 11: Install**

```
npm install
```

Expected: completes. New deps installed at root.

- [ ] **Step 12: Build the static client**

```
npm run build -w packages/relay
```

Expected: Vite builds to `packages/relay/dist/`. Verify `packages/relay/dist/index.html` exists.

- [ ] **Step 13: Local dev test (Wrangler)**

```
npm run dev:relay
```

Expected: Wrangler starts on http://localhost:8787 (default). In a browser visit `http://localhost:8787/` — should serve the React SPA with placeholder text. Visit `http://localhost:8787/api/ws` — should return 501. Ctrl+C to stop.

- [ ] **Step 14: Commit**

```
git add packages/relay package.json package-lock.json
git commit -m "feat(relay): scaffold cloudflare worker + react SPA"
```

---

## Task 3: First Cloudflare deploy

**Files:** none beyond verifying wrangler config

- [ ] **Step 1: Deploy**

```
cd packages/relay
npm run deploy
```

(Equivalent to `vite build && wrangler deploy`.)

Wrangler prompts may include: project name, account confirmation, custom domain (skip — say no). On first deploy, it creates the Worker, sets up the Durable Object namespace via migration, and uploads assets.

Capture the deployed URL (e.g. `https://claude-display.<your-subdomain>.workers.dev`).

- [ ] **Step 2: Smoke check the deployed URL**

```powershell
Invoke-WebRequest -Uri 'https://claude-display.<your-subdomain>.workers.dev' -UseBasicParsing | Select-Object -ExpandProperty StatusCode
```

Expected: 200. Also open in a browser — should show the placeholder text.

- [ ] **Step 3: WS placeholder check**

```powershell
Invoke-WebRequest -Uri 'https://claude-display.<your-subdomain>.workers.dev/api/ws' -UseBasicParsing
```

Expected: 501. Confirms the Worker routes `/api/ws` separately and Workers Assets serves everything else.

- [ ] **Step 4: Save the deployed URL**

```
cd ../..
```

Add the production URL to a personal note (or `.env.production` ignored by git). It'll be referenced in Task 7 for daemon pairing.

- [ ] **Step 5: No commit** (deploy is a side effect; nothing local changed).

---

## Task 4: Durable Object — `Channel` (the relay core)

**Files:**
- Replace: `packages/relay/src/channel-do.ts`
- Replace: `packages/relay/src/worker.ts`
- Create: `packages/relay/src/channel-do.test.ts`

The DO holds two WebSockets per channel — one labelled `client`, one labelled `daemon`. When a frame arrives from one socket, it's forwarded to the other. The DO has no other state (the daemon and client carry the keypairs; the relay is just a dumb pipe of opaque payloads).

We use Cloudflare's **Hibernatable WebSocket API** (`ctx.acceptWebSocket(ws, tags)`) so the DO can scale to zero between message bursts and resume cheaply when a new message arrives.

- [ ] **Step 1: Write the DO**

Replace `packages/relay/src/channel-do.ts`:

```ts
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

    // Reject if there's already a connected socket with this role — single
    // connection per role per channel keeps the relay simple. New connection
    // wins: close the old one.
    for (const old of this.state.getWebSockets(role)) {
      try { old.close(4000, 'replaced'); } catch {}
    }

    const pair = new WebSocketPair();
    const [clientSide, serverSide] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(serverSide, [role]);

    return new Response(null, { status: 101, webSocket: clientSide });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const tags = this.state.getWebSockets().find((s) => s === ws);
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
    // Hibernation cleanup happens automatically. Optionally signal the peer
    // that we disconnected so it can update UI state.
    const role: Role = this.state.getWebSockets('client').includes(ws) ? 'client' : 'daemon';
    const otherRole: Role = role === 'client' ? 'daemon' : 'client';
    for (const t of this.state.getWebSockets(otherRole)) {
      try { t.send(JSON.stringify({ type: 'peer_disconnect', role })); } catch {}
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    // No-op; close handler will run.
  }
}
```

- [ ] **Step 2: Wire the Worker entry to route WS into the DO**

Replace `packages/relay/src/worker.ts`:

```ts
import { Channel } from './channel-do';

export { Channel };

export interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  CHANNELS: DurableObjectNamespace;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/ws') {
      const channel = url.searchParams.get('channel');
      if (!channel) return new Response('missing channel', { status: 400 });
      const id = env.CHANNELS.idFromName(channel);
      const stub = env.CHANNELS.get(id);
      return stub.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};
```

- [ ] **Step 3: Write the DO test**

Cloudflare provides `@cloudflare/vitest-pool-workers` for integration-testing Workers + DOs. To keep this task lightweight, we use a simpler approach: a **two-WebSocket-client end-to-end test against `wrangler dev`** rather than mocking the DO. The test starts `wrangler dev` (assumed already running for dev) and verifies the round-trip.

Skip a unit test here in favor of the Task 5 manual smoke test plus the comprehensive E2E test in Task 11. This is intentional — DO unit testing requires extra harness setup that doesn't pay back for ~50 LOC of routing.

- [ ] **Step 4: Run `wrangler dev` and round-trip-smoke-test**

In one terminal:

```
npm run dev:relay
```

In a second terminal, run this two-client round-trip script:

```powershell
node -e "const W=require('ws');const ch='smoke-'+Date.now();const d=new W('ws://localhost:8787/api/ws?channel='+ch+'&role=daemon');d.on('open',()=>console.log('daemon open'));d.on('message',m=>{console.log('daemon recv:',m.toString());process.exit(0)});setTimeout(()=>{const c=new W('ws://localhost:8787/api/ws?channel='+ch+'&role=client');c.on('open',()=>{console.log('client open');c.send('ping')})},500)"
```

Expected output:

```
daemon open
client open
daemon recv: ping
```

If you see `daemon recv: ping`, the relay works.

- [ ] **Step 5: Deploy and re-smoke against production**

```
npm run deploy -w packages/relay
```

Then repeat the round-trip test against the production URL:

```powershell
node -e "const W=require('ws');const ch='smoke-'+Date.now();const URL='wss://claude-display.<your-subdomain>.workers.dev/api/ws';const d=new W(URL+'?channel='+ch+'&role=daemon');d.on('open',()=>console.log('daemon open'));d.on('message',m=>{console.log('daemon recv:',m.toString());process.exit(0)});setTimeout(()=>{const c=new W(URL+'?channel='+ch+'&role=client');c.on('open',()=>{console.log('client open');c.send('ping')})},500)"
```

Substitute your subdomain. Expected output: same as above.

- [ ] **Step 6: Commit**

```
git add packages/relay/src/channel-do.ts packages/relay/src/worker.ts
git commit -m "feat(relay): channel durable object with hibernatable websockets"
```

---

## Task 5: `mw-claude/crypto.ts` (TDD)

**Files:**
- Modify: `packages/mw-claude/package.json` (add `libsodium-wrappers`)
- Create: `packages/mw-claude/src/crypto.ts`
- Create: `packages/mw-claude/tests/crypto.test.ts`

- [ ] **Step 1: Add dependency**

Edit `packages/mw-claude/package.json`. Add to `dependencies`:

```
"libsodium-wrappers": "^0.7.15",
```

Add to `devDependencies`:

```
"@types/libsodium-wrappers": "^0.7.14",
```

Run `npm install` from repo root.

- [ ] **Step 2: Write failing tests**

Write `packages/mw-claude/tests/crypto.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import {
  initCrypto,
  generateKeyPair,
  encrypt,
  decrypt,
  type KeyPair,
} from '../src/crypto.js';

let alice: KeyPair;
let bob: KeyPair;

beforeAll(async () => {
  await initCrypto();
  alice = generateKeyPair();
  bob = generateKeyPair();
});

describe('crypto envelope', () => {
  it('round-trips a string', () => {
    const ct = encrypt({ from: alice, toPub: bob.publicKey, plaintext: 'hello world' });
    const pt = decrypt({ to: bob, fromPub: alice.publicKey, ciphertext: ct });
    expect(pt).toBe('hello world');
  });

  it('produces different ciphertext each time (nonce is fresh)', () => {
    const a = encrypt({ from: alice, toPub: bob.publicKey, plaintext: 'same' });
    const b = encrypt({ from: alice, toPub: bob.publicKey, plaintext: 'same' });
    expect(a).not.toBe(b);
  });

  it('rejects tampered ciphertext', () => {
    const ct = encrypt({ from: alice, toPub: bob.publicKey, plaintext: 'secret' });
    const tampered = ct.slice(0, -4) + 'AAAA';
    expect(() => decrypt({ to: bob, fromPub: alice.publicKey, ciphertext: tampered })).toThrow();
  });

  it('rejects wrong recipient', () => {
    const eve = generateKeyPair();
    const ct = encrypt({ from: alice, toPub: bob.publicKey, plaintext: 'secret' });
    expect(() => decrypt({ to: eve, fromPub: alice.publicKey, ciphertext: ct })).toThrow();
  });
});
```

- [ ] **Step 3: Run — verify fail**

```
npm test -w packages/mw-claude
```

Expected: 7 (existing) passing + 4 failing.

- [ ] **Step 4: Implement `crypto.ts`**

Write `packages/mw-claude/src/crypto.ts`:

```ts
import sodium from 'libsodium-wrappers';

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export async function initCrypto(): Promise<void> {
  await sodium.ready;
}

export function generateKeyPair(): KeyPair {
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

interface EncryptOpts {
  from: KeyPair;
  toPub: Uint8Array;
  plaintext: string;
}

/**
 * Encrypts `plaintext` from `from` to `toPub`. Returns a base64-encoded
 * concatenation of nonce (24 bytes) + ciphertext.
 */
export function encrypt(opts: EncryptOpts): string {
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const pt = sodium.from_string(opts.plaintext);
  const ct = sodium.crypto_box_easy(pt, nonce, opts.toPub, opts.from.privateKey);
  const concat = new Uint8Array(nonce.length + ct.length);
  concat.set(nonce, 0);
  concat.set(ct, nonce.length);
  return sodium.to_base64(concat, sodium.base64_variants.ORIGINAL);
}

interface DecryptOpts {
  to: KeyPair;
  fromPub: Uint8Array;
  ciphertext: string;
}

export function decrypt(opts: DecryptOpts): string {
  const raw = sodium.from_base64(opts.ciphertext, sodium.base64_variants.ORIGINAL);
  const nonce = raw.subarray(0, sodium.crypto_box_NONCEBYTES);
  const ct = raw.subarray(sodium.crypto_box_NONCEBYTES);
  const pt = sodium.crypto_box_open_easy(ct, nonce, opts.fromPub, opts.to.privateKey);
  return sodium.to_string(pt);
}
```

- [ ] **Step 5: Run — verify pass**

Expected: 11 passing.

- [ ] **Step 6: Commit**

```
git add packages/mw-claude/package.json package-lock.json packages/mw-claude/src/crypto.ts packages/mw-claude/tests/crypto.test.ts
git commit -m "feat(mw-claude): libsodium crypto envelope with tests"
```

---

## Task 6: `mw-claude/config-store.ts` (TDD)

**Files:**
- Create: `packages/mw-claude/src/config-store.ts`
- Create: `packages/mw-claude/tests/config-store.test.ts`

Persists daemon's keypair + paired peer's public key + channel ID + relay URL at `~/.mw-claude/config.json`.

- [ ] **Step 1: Write failing tests**

Write `packages/mw-claude/tests/config-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigStore, type Config } from '../src/config-store.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-claude-cfg-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ConfigStore', () => {
  it('returns null when no config exists', () => {
    const store = new ConfigStore(tmpDir);
    expect(store.load()).toBeNull();
  });

  it('saves and loads a config round-trip', () => {
    const store = new ConfigStore(tmpDir);
    const cfg: Config = {
      version: 1,
      relayUrl: 'wss://example.workers.dev/api/ws',
      channelId: 'abc-123',
      daemonPublicKey: 'pub-base64',
      daemonPrivateKey: 'priv-base64',
      peerPublicKey: 'peer-base64',
    };
    store.save(cfg);
    expect(store.load()).toEqual(cfg);
  });

  it('save() creates the directory if missing', () => {
    const nested = path.join(tmpDir, 'deep', 'nested');
    const store = new ConfigStore(nested);
    store.save({
      version: 1,
      relayUrl: 'x',
      channelId: 'y',
      daemonPublicKey: 'a',
      daemonPrivateKey: 'b',
      peerPublicKey: 'c',
    });
    expect(fs.existsSync(path.join(nested, 'config.json'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify fail**

Expected: 11 passing + 3 failing.

- [ ] **Step 3: Implement `config-store.ts`**

Write `packages/mw-claude/src/config-store.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface Config {
  version: 1;
  relayUrl: string;
  channelId: string;
  daemonPublicKey: string;
  daemonPrivateKey: string;
  peerPublicKey: string;
}

export class ConfigStore {
  private file: string;
  private dir: string;

  constructor(dir: string = path.join(os.homedir(), '.mw-claude')) {
    this.dir = dir;
    this.file = path.join(dir, 'config.json');
  }

  load(): Config | null {
    if (!fs.existsSync(this.file)) return null;
    const raw = fs.readFileSync(this.file, 'utf8');
    return JSON.parse(raw) as Config;
  }

  save(cfg: Config): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(cfg, null, 2), 'utf8');
  }
}
```

- [ ] **Step 4: Run — verify pass**

Expected: 14 passing.

- [ ] **Step 5: Commit**

```
git add packages/mw-claude/src/config-store.ts packages/mw-claude/tests/config-store.test.ts
git commit -m "feat(mw-claude): config-store for daemon keys and pairing"
```

---

## Task 7: `mw-claude/relay-client.ts`

**Files:**
- Create: `packages/mw-claude/src/relay-client.ts`

The relay client opens a WS to the Cloudflare DO route, handles reconnect with exp backoff, performs the handshake protocol (sends `hello`/`hello_ack` unencrypted; everything else is encrypted), and emits `message` events with decrypted plaintext.

- [ ] **Step 1: Write `relay-client.ts`**

Write `packages/mw-claude/src/relay-client.ts`:

```ts
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
```

- [ ] **Step 2: Build**

```
npm run build -w packages/mw-claude
```

Expected: no errors.

- [ ] **Step 3: Tests still pass**

```
npm test -w packages/mw-claude
```

Expected: 14 passing (no new tests for relay-client — covered by end-to-end smoke in Task 11).

- [ ] **Step 4: Commit**

```
git add packages/mw-claude/src/relay-client.ts
git commit -m "feat(mw-claude): relay client with reconnect and crypto wrapping"
```

---

## Task 8: `mw-claude/pair.ts` + `pair` subcommand

**Files:**
- Modify: `packages/mw-claude/package.json` (add `qrcode-terminal`)
- Create: `packages/mw-claude/src/pair.ts`
- Modify: `packages/mw-claude/src/cli.ts`

**Pairing protocol:**

1. Daemon: generate keypair + random `channel_id`, render a QR with `{v:1, channel_id, daemon_pub, relay_url}`. Also render a copy-paste URL `https://<host>/?p=<base64>` for convenience.
2. Daemon connects to `wss://<host>/api/ws?channel=<channel_id>&role=daemon` and waits.
3. Client (browser) loads the URL, decodes the payload from `?p=...`, generates its own keypair, connects to `wss://<host>/api/ws?channel=<channel_id>&role=client`, sends `{type:"hello", client_pub:"<base64>"}` (unencrypted — it's a pubkey, safe to expose).
4. Daemon receives `hello`, persists `client_pub` as `peerPublicKey`, replies `{type:"hello_ack"}`.
5. Both sides switch to encrypted frames (`{type:"msg", ct:"<base64>"}`).

The unencrypted handshake is acceptable because: (a) attacker on the relay sees pubkeys but can't impersonate either side, (b) attacker who scans the QR could race the legitimate browser; for v1 single-user use we accept this. A future hardening (post-Plan 2) could add a daemon-side "confirm pairing" prompt.

- [ ] **Step 1: Add `qrcode-terminal`**

Edit `packages/mw-claude/package.json`. Add to `dependencies`:

```
"qrcode-terminal": "^0.12.0",
```

Add to `devDependencies`:

```
"@types/qrcode-terminal": "^0.12.2",
```

`npm install`.

- [ ] **Step 2: Write `pair.ts`**

Write `packages/mw-claude/src/pair.ts`:

```ts
import qrcode from 'qrcode-terminal';
import sodium from 'libsodium-wrappers';
import { initCrypto, generateKeyPair } from './crypto.js';
import { RelayClient } from './relay-client.js';
import type { Config } from './config-store.js';

interface PairOpts {
  relayUrl: string;
}

export async function runPair(opts: PairOpts): Promise<Config> {
  await initCrypto();
  const kp = generateKeyPair();
  const channelId = sodium.to_base64(
    sodium.randombytes_buf(16),
    sodium.base64_variants.URLSAFE_NO_PADDING,
  );

  const payload = {
    v: 1,
    channel_id: channelId,
    daemon_pub: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    relay_url: opts.relayUrl,
  };
  const payloadStr = JSON.stringify(payload);
  const webUrl =
    opts.relayUrl.replace(/^wss?:/, (m) => (m === 'wss:' ? 'https:' : 'http:')).replace('/api/ws', '') +
    '/?p=' +
    encodeURIComponent(
      sodium.to_base64(sodium.from_string(payloadStr), sodium.base64_variants.URLSAFE_NO_PADDING),
    );

  process.stdout.write('\nScan this QR with the Claude Display client:\n\n');
  await new Promise<void>((resolve) =>
    qrcode.generate(payloadStr, { small: true }, (qr) => {
      process.stdout.write(qr + '\n');
      resolve();
    }),
  );
  process.stdout.write(`Or open this URL in a browser:\n${webUrl}\n\n`);

  const client = new RelayClient({
    relayUrl: opts.relayUrl,
    channelId,
    role: 'daemon',
    myKeyPair: kp,
    peerPublicKey: null,
  });

  process.stdout.write('Waiting for the client (5 min timeout)…\n');

  const peerPub = await new Promise<Uint8Array>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.stop();
      reject(new Error('Pairing timed out after 5 minutes'));
    }, 5 * 60 * 1000);
    client.on('control', (frame: { type: string; client_pub?: string }) => {
      if (frame.type === 'hello' && frame.client_pub) {
        clearTimeout(timeout);
        const pub = sodium.from_base64(frame.client_pub, sodium.base64_variants.ORIGINAL);
        client.setPeerPublicKey(pub);
        client.sendRaw(JSON.stringify({ type: 'hello_ack' }));
        resolve(pub);
      }
    });
    client.on('error', (err) => process.stderr.write(`[pair] relay error: ${err}\n`));
    client.start();
  });

  client.stop();

  return {
    version: 1,
    relayUrl: opts.relayUrl,
    channelId,
    daemonPublicKey: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    daemonPrivateKey: sodium.to_base64(kp.privateKey, sodium.base64_variants.ORIGINAL),
    peerPublicKey: sodium.to_base64(peerPub, sodium.base64_variants.ORIGINAL),
  };
}
```

- [ ] **Step 3: Rewrite `cli.ts` with `pair` and `run` subcommands**

Replace `packages/mw-claude/src/cli.ts`:

```ts
import process from 'node:process';
import sodium from 'libsodium-wrappers';
import { ConfigStore } from './config-store.js';
import { initCrypto } from './crypto.js';
import { runPair } from './pair.js';

const args = process.argv.slice(2);
const subcommand = args[0] && !args[0].startsWith('--') ? args[0] : 'run';

function argValue(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

async function cmdPair(): Promise<void> {
  const relayUrl = argValue('--relay-url') ?? process.env.MW_CLAUDE_RELAY_URL;
  if (!relayUrl) {
    process.stderr.write('mw-claude pair: missing --relay-url or MW_CLAUDE_RELAY_URL env\n');
    process.exit(2);
  }
  const cfg = await runPair({ relayUrl });
  new ConfigStore().save(cfg);
  process.stdout.write('\n[mw-claude] Paired! Config saved to ~/.mw-claude/config.json\n');
  process.stdout.write('[mw-claude] Run `mw-claude` (no args) to start the claude session.\n');
}

async function cmdRun(): Promise<void> {
  const cfg = new ConfigStore().load();
  if (!cfg || !cfg.peerPublicKey) {
    process.stderr.write('mw-claude: not paired yet — run `mw-claude pair --relay-url <wss://...>` first\n');
    process.exit(2);
  }
  await initCrypto();
  const { PtySession } = await import('./pty-session.js');
  const { segmentReplies } = await import('./output-parser.js');
  const { RelayClient } = await import('./relay-client.js');

  const myKeyPair = {
    publicKey: sodium.from_base64(cfg.daemonPublicKey, sodium.base64_variants.ORIGINAL),
    privateKey: sodium.from_base64(cfg.daemonPrivateKey, sodium.base64_variants.ORIGINAL),
  };
  const peerPub = sodium.from_base64(cfg.peerPublicKey, sodium.base64_variants.ORIGINAL);

  const session = new PtySession({
    cwd: process.cwd(),
    cols: process.stdout.columns,
    rows: process.stdout.rows,
  });

  const relay = new RelayClient({
    relayUrl: cfg.relayUrl,
    channelId: cfg.channelId,
    role: 'daemon',
    myKeyPair,
    peerPublicKey: peerPub,
  });

  const segmenter = segmentReplies((text) => {
    relay.send(JSON.stringify({ type: 'reply', text }));
  });

  session.on('data', (chunk: string) => {
    process.stdout.write(chunk);
    segmenter.feed(chunk);
  });

  relay.on('message', (pt: string) => {
    try {
      const msg = JSON.parse(pt);
      if (msg.type === 'prompt' && typeof msg.text === 'string') {
        session.write(msg.text + '\r');
      }
    } catch {
      // ignore malformed
    }
  });

  relay.on('open', () => process.stderr.write(`[mw-claude] relay connected (channel ${cfg.channelId})\n`));
  relay.on('close', () => process.stderr.write('[mw-claude] relay disconnected (reconnecting…)\n'));
  relay.on('error', (err: Error) => process.stderr.write(`[mw-claude] relay error: ${err.message}\n`));

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('data', (chunk) => session.write(chunk.toString()));
  process.stdout.on('resize', () =>
    session.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 30),
  );

  session.on('exit', (code: number) => {
    segmenter.flush();
    relay.stop();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit(code);
  });

  relay.start();
}

async function main(): Promise<void> {
  if (subcommand === 'pair') return cmdPair();
  if (subcommand === 'run') return cmdRun();
  process.stderr.write(`mw-claude: unknown subcommand "${subcommand}"\n`);
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Build**

```
npm run build -w packages/mw-claude
```

Expected: no errors.

- [ ] **Step 5: Smoke check `pair` UX (don't complete the handshake)**

```powershell
node packages/mw-claude/dist/cli.js pair --relay-url wss://example.workers.dev/api/ws
```

Expected: a QR code prints, a URL is displayed, and the process waits for handshake. Ctrl+C to abort. Verify no config file was created at `~/.mw-claude/config.json` (or delete it if so).

- [ ] **Step 6: Smoke check `run` graceful failure**

```powershell
Remove-Item $env:USERPROFILE\.mw-claude\config.json -ErrorAction SilentlyContinue
node packages/mw-claude/dist/cli.js run
```

Expected stderr: `mw-claude: not paired yet — run \`mw-claude pair --relay-url <wss://...>\` first`. Exit code 2.

- [ ] **Step 7: Tests**

```
npm test -w packages/mw-claude
```

Expected: 14 passing.

- [ ] **Step 8: Commit**

```
git add packages/mw-claude/package.json package-lock.json packages/mw-claude/src/pair.ts packages/mw-claude/src/cli.ts
git commit -m "feat(mw-claude): pair/run subcommands with QR + handshake"
```

---

## Task 9: Browser test client (paired + encrypted)

**Files:**
- Replace: `packages/relay/src/client/App.tsx`

The browser client:

1. On first load, reads `?p=<base64-encoded-pairing-payload>` from the URL OR loads persisted state from `localStorage`. If neither exists, shows a "not paired" message.
2. When a `?p=...` payload is decoded, generates its own keypair, persists `{channelId, daemonPub, relayUrl, clientPub, clientPriv}`, and strips the query param from the URL.
3. Connects to the relay as `role=client`, sends `{type:"hello", client_pub}`, waits for `hello_ack`.
4. Sends prompts as encrypted `{type:"msg", ct}`. Renders received `reply` plaintext.

- [ ] **Step 1: Write the React client**

Replace `packages/relay/src/client/App.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import sodium from 'libsodium-wrappers';

interface PairedState {
  channelId: string;
  daemonPub: string;
  relayUrl: string;
  clientPub: string;
  clientPriv: string;
}

interface QrPayload {
  v: 1;
  channel_id: string;
  daemon_pub: string;
  relay_url: string;
}

const STORAGE_KEY = 'mw-claude.paired.v1';

function loadPaired(): PairedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PairedState) : null;
  } catch {
    return null;
  }
}

function savePaired(s: PairedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

async function completePairing(qr: QrPayload): Promise<PairedState> {
  await sodium.ready;
  const kp = sodium.crypto_box_keypair();
  return {
    channelId: qr.channel_id,
    daemonPub: qr.daemon_pub,
    relayUrl: qr.relay_url,
    clientPub: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    clientPriv: sodium.to_base64(kp.privateKey, sodium.base64_variants.ORIGINAL),
  };
}

export function App() {
  const [paired, setPaired] = useState<PairedState | null>(null);
  const [status, setStatus] = useState('initializing…');
  const [log, setLog] = useState<Array<{ kind: 'you' | 'claude'; text: string }>>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      await sodium.ready;
      const url = new URL(window.location.href);
      const p = url.searchParams.get('p');
      if (p) {
        try {
          const json = sodium.to_string(
            sodium.from_base64(p, sodium.base64_variants.URLSAFE_NO_PADDING),
          );
          const qr = JSON.parse(json) as QrPayload;
          const s = await completePairing(qr);
          savePaired(s);
          setPaired(s);
          history.replaceState({}, '', '/');
          return;
        } catch (err) {
          setStatus('pairing payload invalid: ' + (err as Error).message);
          return;
        }
      }
      const stored = loadPaired();
      setPaired(stored);
      if (!stored) {
        setStatus(
          'not paired — run `mw-claude pair --relay-url wss://…/api/ws` on your PC and open the URL it prints',
        );
      }
    })();
  }, []);

  useEffect(() => {
    if (!paired) return;
    let backoff = 500;
    let stopped = false;
    let ws: WebSocket | null = null;
    const myKP = {
      publicKey: sodium.from_base64(paired.clientPub, sodium.base64_variants.ORIGINAL),
      privateKey: sodium.from_base64(paired.clientPriv, sodium.base64_variants.ORIGINAL),
    };
    const daemonPub = sodium.from_base64(paired.daemonPub, sodium.base64_variants.ORIGINAL);

    function decrypt(b64: string): string {
      const raw = sodium.from_base64(b64, sodium.base64_variants.ORIGINAL);
      const nonce = raw.subarray(0, sodium.crypto_box_NONCEBYTES);
      const ct = raw.subarray(sodium.crypto_box_NONCEBYTES);
      const pt = sodium.crypto_box_open_easy(ct, nonce, daemonPub, myKP.privateKey);
      return sodium.to_string(pt);
    }

    function connect() {
      if (stopped) return;
      const url = `${paired!.relayUrl}?channel=${encodeURIComponent(paired!.channelId)}&role=client`;
      ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        backoff = 500;
        setStatus('connected — sending hello');
        ws!.send(JSON.stringify({ type: 'hello', client_pub: paired!.clientPub }));
      };
      ws.onmessage = (e) => {
        let f: { type?: string; ct?: string };
        try { f = JSON.parse(String(e.data)); } catch { return; }
        if (f.type === 'hello_ack') {
          setStatus('paired & encrypted');
        } else if (f.type === 'peer_disconnect') {
          setStatus('daemon disconnected (waiting…)');
        } else if (f.type === 'msg' && f.ct) {
          try {
            const pt = decrypt(f.ct);
            const m = JSON.parse(pt);
            if (m.type === 'reply') setLog((l) => [...l, { kind: 'claude', text: m.text }]);
          } catch {}
        }
      };
      ws.onclose = () => {
        setStatus(`disconnected — reconnecting in ${Math.round(backoff / 1000)}s`);
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 10000);
      };
      ws.onerror = () => { try { ws?.close(); } catch {} };
    }
    connect();

    return () => {
      stopped = true;
      ws?.close();
    };
  }, [paired]);

  function send(text: string) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !paired) return;
    const daemonPub = sodium.from_base64(paired.daemonPub, sodium.base64_variants.ORIGINAL);
    const myPriv = sodium.from_base64(paired.clientPriv, sodium.base64_variants.ORIGINAL);
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const pt = sodium.from_string(JSON.stringify({ type: 'prompt', text }));
    const ct = sodium.crypto_box_easy(pt, nonce, daemonPub, myPriv);
    const out = new Uint8Array(nonce.length + ct.length);
    out.set(nonce, 0);
    out.set(ct, nonce.length);
    wsRef.current.send(
      JSON.stringify({ type: 'msg', ct: sodium.to_base64(out, sodium.base64_variants.ORIGINAL) }),
    );
    setLog((l) => [...l, { kind: 'you', text }]);
  }

  return (
    <main style={{ maxWidth: 900, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Claude Display</h1>
      <div style={{ fontSize: '0.85rem', color: '#7a8597' }}>{status}</div>
      <div
        style={{
          whiteSpace: 'pre-wrap',
          border: '1px solid #2a2f36',
          padding: '1rem',
          borderRadius: 8,
          minHeight: 300,
          maxHeight: '60vh',
          overflow: 'auto',
          background: '#10141a',
          marginTop: '1rem',
        }}
      >
        {log.map((l, i) => (
          <div
            key={i}
            style={{ color: l.kind === 'you' ? '#9ad0ff' : '#e7e7e7', marginTop: '0.5rem' }}
          >
            {l.kind}: {l.text}
          </div>
        ))}
      </div>
      <form
        style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}
        onSubmit={(e) => {
          e.preventDefault();
          const v = inputRef.current?.value.trim();
          if (v) {
            send(v);
            if (inputRef.current) inputRef.current.value = '';
          }
        }}
      >
        <input
          ref={inputRef}
          placeholder="Type a prompt for Claude Code…"
          style={{
            flex: 1,
            padding: '0.6rem',
            borderRadius: 6,
            border: '1px solid #2a2f36',
            background: '#10141a',
            color: '#e7e7e7',
            fontFamily: 'inherit',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '0.6rem 1rem',
            borderRadius: 6,
            border: 0,
            background: '#3a7afe',
            color: 'white',
          }}
        >
          Send
        </button>
      </form>
      {paired && (
        <button
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY);
            location.reload();
          }}
          style={{
            marginTop: '1rem',
            fontSize: '0.75rem',
            color: '#7a8597',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          unpair this browser
        </button>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Build the relay**

```
npm run build -w packages/relay
```

Expected: Vite builds successfully. `packages/relay/dist/index.html` plus hashed JS/CSS exist.

- [ ] **Step 3: Commit**

```
git add packages/relay/src/client/App.tsx
git commit -m "feat(relay): browser test client with libsodium handshake"
```

---

## Task 10: End-to-end local smoke test

**Files:** none

This is the protocol's first integration test. Four terminals.

- [ ] **Step 1: Terminal A — start relay locally**

```
npm run dev:relay
```

Expected: `wrangler dev` starts on http://localhost:8787.

- [ ] **Step 2: Terminal B — pair daemon**

```
node packages/mw-claude/dist/cli.js pair --relay-url ws://localhost:8787/api/ws
```

Expected: QR prints, plus a URL like `http://localhost:8787/?p=<base64>`. Process waits.

- [ ] **Step 3: Terminal C — open the URL in a browser**

Copy the URL from Terminal B's "Or open this URL in a browser:" line. Open it.

Expected:
- Browser shows status: `paired & encrypted` after ~1s.
- Terminal B prints `Paired! Config saved` and exits.
- `~/.mw-claude/config.json` exists with all five fields populated.

- [ ] **Step 4: Terminal D — run daemon**

```
node packages/mw-claude/dist/cli.js run
```

Expected:
- Claude TUI appears.
- Stderr line: `[mw-claude] relay connected (channel <id>)`.

- [ ] **Step 5: Round-trip test**

In the browser (Terminal C), type `what is 7 times 6` and click Send.

Expected:
- "you: what is 7 times 6" appears in the browser.
- Terminal D's Claude TUI shows the prompt being typed in and Claude responds.
- A "claude: …" line appears in the browser containing "42".

Now in Terminal D's TUI, type `what's the capital of France` directly. Expected: browser also receives the reply containing "Paris".

- [ ] **Step 6: Cleanup**

Type `/exit` in Terminal D's TUI. Stop wrangler in Terminal A.

- [ ] **Step 7: No commit** — this is a verification step.

If any of the above fails, escalate with the specific terminal and what you saw.

---

## Task 11: Production deploy + production smoke test

**Files:**
- Modify: `packages/mw-claude/README.md`

- [ ] **Step 1: Deploy**

```
npm run deploy -w packages/relay
```

Capture the production URL (likely the same as Task 3, since `wrangler deploy` updates in place).

- [ ] **Step 2: Production smoke test**

```
Remove-Item $env:USERPROFILE\.mw-claude\config.json -ErrorAction SilentlyContinue
node packages/mw-claude/dist/cli.js pair --relay-url wss://claude-display.<your-subdomain>.workers.dev/api/ws
```

Open the printed URL. Confirm "paired & encrypted". Then in a second terminal:

```
node packages/mw-claude/dist/cli.js run
```

Send a prompt from the browser. Confirm round-trip works over the internet.

This is the acceptance test for Plan 2.

- [ ] **Step 3: Update README**

Append to `packages/mw-claude/README.md`:

```markdown

## Pairing with the cloud relay

The relay lives at `https://claude-display.<your-subdomain>.workers.dev` (Cloudflare Workers + Durable Objects).

1. Pair: `mw-claude pair --relay-url wss://claude-display.<your-subdomain>.workers.dev/api/ws`
   This prints a QR and a URL. Open either on the device you want to control from.
2. Once the browser shows "paired & encrypted", run `mw-claude` (no args) to start the Claude session.
3. The browser can now prompt your Claude Code session from anywhere on the internet.

End-to-end encryption: prompts and replies are encrypted with libsodium `crypto_box`. The relay sees only ciphertext.
```

Commit:

```
git add packages/mw-claude/README.md
git commit -m "docs(mw-claude): document cloudflare pairing flow"
```

---

## Acceptance criteria for Plan 2

1. `wrangler deploy` ships the relay successfully. The Workers URL serves the React SPA at `/` and routes `/api/ws` to the Durable Object.
2. `mw-claude pair --relay-url wss://<prod>/api/ws` prints a scannable QR + a copy-pasteable URL, then waits for handshake.
3. Opening the URL in any browser (different network is fine, e.g. phone on cellular) shows "paired & encrypted" and the daemon prints "Paired! Config saved".
4. `mw-claude run` after pairing connects to the relay; the Claude TUI appears; stderr shows `relay connected`.
5. A prompt typed in the browser arrives in the local Claude session and a reply is shown in the browser within a few seconds — over the internet, not localhost.
6. Forcibly killing `mw-claude` and restarting it (without re-pairing) resumes the session: the daemon reconnects and resumes accepting browser prompts.
7. `npm test --workspaces` passes (mw-claude 14 + relay 0 = 14 tests minimum; the DO is integration-tested by Task 10's manual smoke).

If all 7 hold, Plan 2 is done and we can begin **Plan 3** (Meta Display glasses webapp).

---

## Risks

1. **Cloudflare Hibernatable WebSocket API version drift** — `ctx.acceptWebSocket()` and `getWebSockets()` have evolved; if the API names differ from those in this plan, the implementer adopts whatever the current docs say. Source of truth: https://developers.cloudflare.com/durable-objects/api/websockets/
2. **Workers Assets binding** — newer feature; if it's not yet available for the account or wrangler version, fall back to embedding the SPA bytes in the Worker bundle (`@cloudflare/kv-asset-handler` or similar). The fallback adds ~50 LOC; document the deviation.
3. **Pairing race** — anyone with the URL during the 5-minute handshake window can claim the pairing. Acceptable for v1 single-user. Hardening parked for future work.
4. **Browser key persistence** — losing `localStorage` requires re-pairing. Acceptable; documented in the "unpair" button.

## Self-review notes

- **Spec coverage:** Plan 2 covers spec §5.1 (browser test client — minimal), §5.2 (relay — pivoted from Vercel to Cloudflare), §6 (data flow), §7 (pairing + encryption), §11 risk #4 (reconnect-tolerance baked in). Spec §5.1 *glasses webapp* deferred to Plan 3; spec §7 *Whisper proxy* deferred to Plan 4 (and will now live in the same Cloudflare Worker via Workers AI).
- **No placeholders:** all code blocks complete. Risk 1 is a known-unknown about API versioning, not a placeholder.
- **Type consistency:** `Config`, `PairedState`, `RelayClient` opts, frame types (`hello`, `hello_ack`, `msg`, `peer_disconnect`) used consistently across daemon + browser sides.
- **Open question parked:** Whisper proxy host decision now trivially resolves to "in the same Worker, via Workers AI" — to be confirmed when we get to Plan 4.
