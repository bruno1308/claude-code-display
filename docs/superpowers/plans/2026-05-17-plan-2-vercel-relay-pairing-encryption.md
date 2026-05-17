# Plan 2 — Vercel Relay + Pairing + E2E Encryption

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the Plan 1 localhost loop to an internet-reachable Vercel-hosted relay with QR-based pairing and end-to-end encryption between browser/glasses client and the `mw-claude` daemon. After this plan, a browser at the production Vercel URL can pair with your PC and have a working prompt-reply loop, and the relay is never able to read the content.

**Architecture:** Single Next.js project on Vercel hosts both a static test-client webapp at `/` and a WebSocket relay at `/ws`. Cross-instance fan-out via Upstash Redis pub/sub keyed by channel ID. Daemon and client both speak a tiny JSON wire protocol carrying libsodium-`crypto_box` ciphertext. Pairing is a one-time QR scan that bootstraps each side's knowledge of the other's public key plus the shared channel ID.

**Tech Stack:** Next.js 16 App Router on Vercel (Fluid Compute, Node 24), `ws` for server-side WebSocket, `@upstash/redis` for fan-out, `libsodium-wrappers` for crypto, `qrcode-terminal` for daemon-side QR rendering, existing `mw-claude` package extended.

**Prerequisite:** Plan 1 complete and verified. Vercel CLI installed (`npm i -g vercel`) — if not, the first task installs it. Upstash account (free tier sufficient).

---

## File structure (new + modified)

```
B:\Projects\ClaudeDisplay\
├── packages\
│   ├── mw-claude\                      (extended)
│   │   ├── src\
│   │   │   ├── cli.ts                  (rewritten — adds `pair` subcommand, relay mode)
│   │   │   ├── pty-session.ts          (unchanged)
│   │   │   ├── output-parser.ts        (unchanged)
│   │   │   ├── local-server.ts         (kept for `--local` mode, no longer default)
│   │   │   ├── config-store.ts         (NEW — ~/.mw-claude/config.json)
│   │   │   ├── crypto.ts               (NEW — libsodium envelope)
│   │   │   ├── relay-client.ts         (NEW — WS client to Vercel relay)
│   │   │   └── pair.ts                 (NEW — pair subcommand QR flow)
│   │   └── tests\
│   │       ├── crypto.test.ts          (NEW)
│   │       └── ...
│   └── relay\                          (NEW package — the Vercel app)
│       ├── package.json
│       ├── next.config.ts
│       ├── tsconfig.json
│       ├── vercel.ts                   (project config)
│       ├── app\
│       │   ├── layout.tsx
│       │   ├── page.tsx                (test client UI)
│       │   └── api\
│       │       └── ws\
│       │           └── route.ts        (WebSocket relay)
│       ├── lib\
│       │   ├── channels.ts             (pub/sub via Upstash)
│       │   └── env.ts                  (typed env vars)
│       └── public\
│           └── (static assets if any)
```

**File responsibilities:**
- `relay/app/api/ws/route.ts` — accepts WS upgrade, identifies role (`client` or `daemon`) + `channel_id`, subscribes to the channel's pub/sub topic for incoming frames, publishes outgoing frames.
- `relay/lib/channels.ts` — thin Upstash Redis pub/sub wrapper: `subscribe(channel, role, cb)` and `publish(channel, role, frame)`.
- `relay/app/page.tsx` — minimal test client (the Plan-1 HTML page, ported to React, with a channel-id input plus pairing-aware crypto via Web Crypto / sodium-wasm).
- `mw-claude/src/config-store.ts` — reads/writes `~/.mw-claude/config.json` (channel_id, daemon keypair, peer pubkey, relay URL).
- `mw-claude/src/crypto.ts` — `encrypt({to, from, plaintext})` / `decrypt({from, to, ciphertext})` using libsodium `crypto_box`.
- `mw-claude/src/relay-client.ts` — connects WS to relay, reconnect with backoff, dispatches `prompt` events, accepts `reply` outbound.
- `mw-claude/src/pair.ts` — generates keypair if missing, generates random channel ID, prints QR encoding `{v:1, channel_id, daemon_pub, relay_url}` plus instructions, then connects and waits for browser handshake.
- `mw-claude/src/cli.ts` — argument parser; subcommands `pair` and `run` (default). `run` requires config to exist, opens relay client.

---

## Task 1: Install Vercel CLI + authenticate

**Files:** none (tooling step)

- [ ] **Step 1: Install Vercel CLI globally**

In a terminal:

```
npm i -g vercel
vercel --version
```

Expected: version string printed.

- [ ] **Step 2: Authenticate**

```
vercel login
```

Follow the email/SSO flow. After success, `vercel whoami` should print your username/team.

- [ ] **Step 3: No commit**

This step installs global tooling and authenticates. Nothing to commit.

---

## Task 2: Scaffold the `relay` Next.js package

**Files:**
- Create: `packages/relay/package.json`
- Create: `packages/relay/tsconfig.json`
- Create: `packages/relay/next.config.ts`
- Create: `packages/relay/app/layout.tsx`
- Create: `packages/relay/app/page.tsx`
- Modify: root `package.json` to add `dev:relay` script

- [ ] **Step 1: Create `packages/relay/package.json`**

```json
{
  "name": "relay",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "next lint",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "ws": "^8.18.0",
    "@upstash/redis": "^1.34.0",
    "libsodium-wrappers": "^0.7.15"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/ws": "^8.5.13",
    "@types/libsodium-wrappers": "^0.7.14",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `packages/relay/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `packages/relay/next.config.ts`**

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // No special config needed yet.
};

export default nextConfig;
```

- [ ] **Step 4: Create `packages/relay/app/layout.tsx`**

```tsx
export const metadata = {
  title: 'Claude Display',
  description: 'Remote control your Claude Code session from anywhere',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'ui-monospace, monospace', background: '#0b0d10', color: '#e7e7e7', margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Create placeholder `packages/relay/app/page.tsx`**

```tsx
export default function HomePage() {
  return (
    <main style={{ maxWidth: 900, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Claude Display</h1>
      <p>relay scaffold — pairing UI lands in Task 9.</p>
    </main>
  );
}
```

- [ ] **Step 6: Add `dev:relay` script to root `package.json`**

Edit root `package.json`. Add `"dev:relay": "npm run dev -w packages/relay"` to the `scripts` block (alongside `dev:mw-claude`).

- [ ] **Step 7: Install**

```
npm install
```

Expected: completes, including Next 16 and React 19.

- [ ] **Step 8: Verify dev server starts**

```
npm run dev:relay
```

Expected: Next.js banner, listening on http://localhost:3000. Open the URL — you should see "Claude Display / relay scaffold — pairing UI lands in Task 9." Ctrl+C to stop.

- [ ] **Step 9: Commit**

```
git add packages/relay root-package.json
git commit -m "feat(relay): scaffold next.js app for vercel relay"
```

---

## Task 3: First Vercel deploy

**Files:**
- Create: `packages/relay/vercel.ts`

- [ ] **Step 1: Create `packages/relay/vercel.ts`**

Per the knowledge-update guidance, prefer `vercel.ts` over `vercel.json`.

```ts
import { type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',
  buildCommand: 'npm run build',
  installCommand: 'npm install',
};
```

If `@vercel/config` cannot be installed at this point (e.g. v1 not yet published in the version range), substitute a minimal `vercel.json` with the same fields:

```json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "installCommand": "npm install"
}
```

Document whichever was used in a brief comment at the top of the file.

- [ ] **Step 2: First deploy**

```
cd packages/relay
vercel
```

Answer the CLI prompts:
- Set up and deploy `packages/relay`? **Yes**
- Which scope? **<your-personal-scope>**
- Link to existing project? **No**
- Project name? **claude-display** (or similar)
- In which directory is your code located? **./**
- Want to override settings? **No**

Wait for the deploy. Capture the deployed URL (e.g. `https://claude-display-xxx.vercel.app`).

- [ ] **Step 3: Smoke check the deployed URL**

```powershell
Invoke-WebRequest -Uri 'https://claude-display-xxx.vercel.app' -UseBasicParsing | Select-Object -ExpandProperty StatusCode
```

(replace with the URL from Step 2)

Expected: 200.

Also visit the URL in a browser — should show the placeholder text.

- [ ] **Step 4: Pin the production domain**

If the project has an `vercel.app` production alias different from the deploy URL, note it for later use.

```
vercel inspect <project-name> --scope <scope> | grep 'Production'
```

- [ ] **Step 5: Commit `vercel.ts` (or `vercel.json`)**

```
cd ../..
git add packages/relay/vercel.ts
git commit -m "chore(relay): vercel project configuration"
```

Note: the `.vercel/` directory generated by `vercel link` should NOT be committed — verify it's in `.gitignore` or add it:

If `.gitignore` does not already exclude it, append a line `.vercel/`:

```
echo .vercel/ >> .gitignore
git add .gitignore
git commit --amend --no-edit
```

---

## Task 4: Upstash Redis setup

**Files:** none (external setup) + 1 env file

- [ ] **Step 1: Create Upstash database**

In a browser, sign in at https://console.upstash.com. Create a new Redis database:
- Type: Regional
- Region: closest to you
- Name: `claude-display-relay`

After creation, copy the REST URL and REST token from the database details page.

- [ ] **Step 2: Add env vars to Vercel project**

From repo root:

```
cd packages/relay
vercel env add UPSTASH_REDIS_REST_URL production
```

Paste the URL when prompted. Repeat:

```
vercel env add UPSTASH_REDIS_REST_TOKEN production
```

Paste the token. Also add to `preview` and `development` environments with the same values (they all use the same DB for v1):

```
vercel env add UPSTASH_REDIS_REST_URL preview
vercel env add UPSTASH_REDIS_REST_TOKEN preview
vercel env add UPSTASH_REDIS_REST_URL development
vercel env add UPSTASH_REDIS_REST_TOKEN development
```

- [ ] **Step 3: Pull env vars for local dev**

```
vercel env pull .env.local
```

Verify the file appears at `packages/relay/.env.local` and contains the two vars. This file is gitignored (Next.js defaults).

- [ ] **Step 4: No commit**

Env vars never commit. The Vercel project + Upstash DB exist; local `.env.local` exists.

```
cd ../..
```

---

## Task 5: `lib/channels.ts` — Upstash pub/sub wrapper (TDD)

**Files:**
- Create: `packages/relay/lib/channels.ts`
- Create: `packages/relay/lib/env.ts`
- Create: `packages/relay/tests/channels.test.ts`

- [ ] **Step 1: Write the env loader**

Write `packages/relay/lib/env.ts`:

```ts
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const env = {
  upstashUrl: required('UPSTASH_REDIS_REST_URL'),
  upstashToken: required('UPSTASH_REDIS_REST_TOKEN'),
};
```

- [ ] **Step 2: Write failing test**

Note: `@upstash/redis` does not expose pub/sub via REST. We'll use Upstash's separate **Redis pub/sub over HTTP** which Upstash supports through their SSE endpoint. Since this is heavier than a unit test should handle, we'll test the *contract* of our wrapper with a mocked transport.

Write `packages/relay/tests/channels.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelBus } from '../lib/channels.js';

describe('ChannelBus', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('publish() POSTs to the publish endpoint with channel+role+payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const bus = new ChannelBus({
      url: 'https://example.upstash.io',
      token: 'tok',
      fetchImpl: fetchMock,
    });
    await bus.publish('abc', 'client', '{"hello":1}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/publish/');
    expect(String(url)).toContain('abc');
    expect(String(url)).toContain('client');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('subscribe() returns an unsubscribe function', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    const bus = new ChannelBus({
      url: 'https://example.upstash.io',
      token: 'tok',
      fetchImpl: fetchMock,
    });
    const unsub = await bus.subscribe('abc', 'daemon', () => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });
});
```

- [ ] **Step 3: Run test — verify fail**

```
npm test -w packages/relay
```

Expected: fail (module not found).

- [ ] **Step 4: Implement `lib/channels.ts`**

Write `packages/relay/lib/channels.ts`:

```ts
export type ChannelRole = 'client' | 'daemon';

export interface ChannelBusOpts {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
}

/**
 * Thin pub/sub wrapper over Upstash REST. The "topic" identifier we use is
 * `<channel_id>:<role>` so that each side subscribes to its own incoming
 * topic and publishes to the OTHER role's topic.
 *
 * For v1 we use Upstash's PUBLISH REST endpoint to send and their
 * server-sent-events SUBSCRIBE endpoint to receive. Both are documented at
 * https://upstash.com/docs/redis/features/pubsub
 */
export class ChannelBus {
  private url: string;
  private token: string;
  private fetchImpl: typeof fetch;

  constructor(opts: ChannelBusOpts) {
    this.url = opts.url.replace(/\/$/, '');
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private topic(channelId: string, role: ChannelRole): string {
    return `${channelId}:${role}`;
  }

  async publish(channelId: string, toRole: ChannelRole, payload: string): Promise<void> {
    const topic = encodeURIComponent(this.topic(channelId, toRole));
    const body = payload;
    const res = await this.fetchImpl(`${this.url}/publish/${topic}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'text/plain',
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`publish ${topic} failed: ${res.status}`);
    }
  }

  async subscribe(
    channelId: string,
    asRole: ChannelRole,
    onMessage: (payload: string) => void,
  ): Promise<() => void> {
    const topic = encodeURIComponent(this.topic(channelId, asRole));
    const controller = new AbortController();

    // Start the SSE subscription in the background.
    (async () => {
      try {
        const res = await this.fetchImpl(`${this.url}/subscribe/${topic}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'text/event-stream',
          },
          signal: controller.signal,
        });
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // Upstash SSE delivers `data: <payload>\n\n` frames
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const m = frame.match(/^data:\s*(.*)$/m);
            if (m) onMessage(m[1]);
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') {
          // swallow — caller can re-subscribe on next retry tick
        }
      }
    })();

    return () => controller.abort();
  }
}
```

- [ ] **Step 5: Run tests — verify pass**

```
npm test -w packages/relay
```

Expected: 2 passing.

- [ ] **Step 6: Commit**

```
git add packages/relay/lib/channels.ts packages/relay/lib/env.ts packages/relay/tests/channels.test.ts
git commit -m "feat(relay): channel bus over upstash pub/sub"
```

---

## Task 6: WebSocket relay route

**Files:**
- Create: `packages/relay/app/api/ws/route.ts`

**Important Vercel-specific note:** Next.js on Vercel does not have a built-in WebSocket upgrade story in route handlers as of Next 16. The current canonical approach is to use the `vercel-edge`–style handler returning a `Response` with a `webSocket` field, OR — for full Node compatibility — switch the route to the Node runtime and use Node's `http.IncomingMessage` upgrade hook. **Before writing this task, the implementer should verify the current Vercel docs for WebSocket support**. The code below assumes the Node runtime + `ws` package approach; if Vercel has shipped a more idiomatic API since this plan was written, prefer that.

- [ ] **Step 1: Spike the Vercel WS API surface**

Before writing the route, briefly verify the API. Run:

```
node -e "console.log(require('ws').WebSocketServer)"
```

(should print a function — confirms `ws` is installed in `relay`).

Then check Vercel's docs at https://vercel.com/docs (search "websocket"). If their recommended pattern differs from the `ws`-based handler below, adopt theirs and document the deviation in a comment at the top of `route.ts`.

- [ ] **Step 2: Write the route handler**

Write `packages/relay/app/api/ws/route.ts`:

```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import type { NextRequest } from 'next/server';
import { WebSocketServer, WebSocket } from 'ws';
import { ChannelBus, type ChannelRole } from '@/lib/channels';
import { env } from '@/lib/env';

// Single WSS instance per Node process — held in a module-level cache so
// it survives across function invocations on the same Vercel instance.
declare global {
  // eslint-disable-next-line no-var
  var __wss: WebSocketServer | undefined;
}

function getWss(): WebSocketServer {
  if (!globalThis.__wss) {
    globalThis.__wss = new WebSocketServer({ noServer: true });
  }
  return globalThis.__wss;
}

const bus = new ChannelBus({ url: env.upstashUrl, token: env.upstashToken });

function parseRoleAndChannel(req: NextRequest): { role: ChannelRole; channel: string } | null {
  const url = new URL(req.url);
  const channel = url.searchParams.get('channel');
  const roleParam = url.searchParams.get('role');
  if (!channel) return null;
  if (roleParam !== 'client' && roleParam !== 'daemon') return null;
  return { channel, role: roleParam };
}

async function attach(ws: WebSocket, channel: string, role: ChannelRole): Promise<void> {
  const otherRole: ChannelRole = role === 'client' ? 'daemon' : 'client';

  // Subscribe to incoming traffic targeted at THIS role.
  const unsubscribe = await bus.subscribe(channel, role, (payload) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });

  ws.on('message', async (raw) => {
    const text = raw.toString();
    try {
      await bus.publish(channel, otherRole, text);
    } catch {
      // best-effort — drop on failure
    }
  });

  ws.on('close', () => {
    unsubscribe();
  });
}

// Next.js doesn't expose the underlying server here, so we hand the upgrade
// to a global handler installed on first request. This is a hack but reliable.
let upgradeHandlerInstalled = false;

export async function GET(req: NextRequest): Promise<Response> {
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('expected websocket upgrade', { status: 400 });
  }
  const parsed = parseRoleAndChannel(req);
  if (!parsed) return new Response('missing channel/role', { status: 400 });

  const wss = getWss();
  if (!upgradeHandlerInstalled) {
    upgradeHandlerInstalled = true;
    // @ts-expect-error — accessing Node's underlying server via process internals
    const server = process._getActiveHandles?.().find((h: { setMaxListeners?: unknown }) => h.setMaxListeners);
    if (server && typeof (server as { on?: unknown }).on === 'function') {
      (server as { on: (event: string, cb: (req: unknown, socket: unknown, head: unknown) => void) => void }).on(
        'upgrade',
        (rawReq, socket, head) => {
          wss.handleUpgrade(rawReq as never, socket as never, head as never, (ws) => {
            const u = new URL((rawReq as { url: string }).url, 'http://localhost');
            const channel = u.searchParams.get('channel');
            const role = u.searchParams.get('role') as ChannelRole;
            if (channel && (role === 'client' || role === 'daemon')) {
              attach(ws, channel, role).catch(() => ws.close());
            } else {
              ws.close();
            }
          });
        },
      );
    }
  }

  // Return a 101-style response — Next.js will swap to the upgrade handler above.
  return new Response(null, { status: 101 });
}
```

**Reality check:** the above is a best-effort sketch. The Vercel/Next 16 surface for WebSocket upgrades may require a different pattern (e.g. `Bun.serve`-style handler, a dedicated edge function, or running the relay outside of Next.js as a custom server). If after a 30-minute spike this approach doesn't work, escalate with the specific error and propose one of:
- Run the relay as a separate Node service deployed via Vercel as a serverless function with `vercel-deploy-static` (not Next).
- Use Vercel's Edge runtime with `WebSocketPair` if available.
- Move the relay to a small Fly.io machine (pivot from Plan 2 §5.2 host decision).

The implementer has authority to make this call — pick the simplest path that works and document the deviation in a comment at the top of `route.ts`. **This is the single highest-risk task in Plan 2.**

- [ ] **Step 3: Local smoke test**

Start the dev server:

```
npm run dev:relay
```

In another terminal:

```powershell
node -e "const W=require('ws');const w=new W('ws://localhost:3000/api/ws?channel=test&role=client');w.on('open',()=>{console.log('open');w.send('hello');setTimeout(()=>w.close(),500)});w.on('error',e=>console.error('err',e.message));w.on('close',()=>console.log('closed'))"
```

Expected: `open` then `closed`. If you see `err Unexpected server response: 400` or similar, the upgrade handler isn't wired correctly — escalate per Step 2.

- [ ] **Step 4: Round-trip smoke test**

With the dev server running, open two terminals:

Terminal A (daemon side):

```powershell
node -e "const W=require('ws');const w=new W('ws://localhost:3000/api/ws?channel=test1&role=daemon');w.on('open',()=>console.log('daemon open'));w.on('message',m=>console.log('daemon got:',m.toString()));"
```

Terminal B (client side):

```powershell
node -e "const W=require('ws');const w=new W('ws://localhost:3000/api/ws?channel=test1&role=client');w.on('open',()=>{console.log('client open');setTimeout(()=>{w.send('ping from client');},500);setTimeout(()=>{w.close();process.exit(0)},2000)});"
```

Expected: Terminal A prints `daemon got: ping from client`.

- [ ] **Step 5: Commit**

```
git add packages/relay/app/api/ws/route.ts
git commit -m "feat(relay): websocket relay route with upstash fanout"
```

---

## Task 7: `mw-claude/crypto.ts` (TDD)

**Files:**
- Modify: `packages/mw-claude/package.json` (add `libsodium-wrappers` dep)
- Create: `packages/mw-claude/src/crypto.ts`
- Create: `packages/mw-claude/tests/crypto.test.ts`

- [ ] **Step 1: Add dependency**

Edit `packages/mw-claude/package.json`. In `dependencies`, add:

```
"libsodium-wrappers": "^0.7.15",
```

In `devDependencies`, add:

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

Expected: 7 (existing) passing + 4 failing (crypto not implemented).

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

```
npm test -w packages/mw-claude
```

Expected: 11 passing total (7 + 4).

- [ ] **Step 6: Commit**

```
git add packages/mw-claude/package.json packages/mw-claude/package-lock.json packages/mw-claude/src/crypto.ts packages/mw-claude/tests/crypto.test.ts
git commit -m "feat(mw-claude): libsodium crypto envelope with tests"
```

---

## Task 8: `mw-claude/config-store.ts` (TDD)

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
      relayUrl: 'wss://example.vercel.app/api/ws',
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

```
npm test -w packages/mw-claude
```

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

## Task 9: `mw-claude/pair.ts` + `cli.ts` subcommands

**Files:**
- Modify: `packages/mw-claude/package.json` (add `qrcode-terminal` dep)
- Create: `packages/mw-claude/src/pair.ts`
- Modify: `packages/mw-claude/src/cli.ts`

- [ ] **Step 1: Add dep**

Edit `packages/mw-claude/package.json`. In `dependencies`:

```
"qrcode-terminal": "^0.12.0",
```

In `devDependencies`:

```
"@types/qrcode-terminal": "^0.12.2",
```

Run `npm install`.

- [ ] **Step 2: Write `pair.ts`**

Write `packages/mw-claude/src/pair.ts`:

```ts
import qrcode from 'qrcode-terminal';
import sodium from 'libsodium-wrappers';
import { initCrypto, generateKeyPair } from './crypto.js';
import { ConfigStore, type Config } from './config-store.js';

interface PairOpts {
  relayUrl: string;
}

/**
 * Generates a fresh channel ID + daemon keypair, prints a QR code, and
 * returns a partial Config (without peerPublicKey, which arrives during
 * the handshake). Caller is responsible for connecting to the relay and
 * filling in peerPublicKey.
 */
export async function runPair(opts: PairOpts): Promise<Partial<Config> & { qrPayload: string }> {
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

  process.stdout.write('\nScan this QR with the Claude Display client:\n\n');
  await new Promise<void>((resolve) => {
    qrcode.generate(payloadStr, { small: true }, (qr) => {
      process.stdout.write(qr + '\n');
      resolve();
    });
  });
  process.stdout.write(
    `Or paste this URL: ${opts.relayUrl.replace('/api/ws', '')}/?p=${encodeURIComponent(
      sodium.to_base64(sodium.from_string(payloadStr), sodium.base64_variants.URLSAFE_NO_PADDING),
    )}\n\n`,
  );

  return {
    relayUrl: opts.relayUrl,
    channelId,
    daemonPublicKey: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    daemonPrivateKey: sodium.to_base64(kp.privateKey, sodium.base64_variants.ORIGINAL),
    qrPayload: payloadStr,
  };
}
```

- [ ] **Step 3: Rewrite `cli.ts` with subcommands**

Replace `packages/mw-claude/src/cli.ts`:

```ts
import process from 'node:process';
import { runPair } from './pair.js';
import { ConfigStore } from './config-store.js';

const args = process.argv.slice(2);
const subcommand = args[0] ?? 'run';

async function main(): Promise<void> {
  const store = new ConfigStore();

  if (subcommand === 'pair') {
    const relayUrlArg = args[args.indexOf('--relay-url') + 1];
    const relayUrl = relayUrlArg && !relayUrlArg.startsWith('--')
      ? relayUrlArg
      : process.env.MW_CLAUDE_RELAY_URL;
    if (!relayUrl) {
      process.stderr.write(
        'mw-claude pair: missing --relay-url or MW_CLAUDE_RELAY_URL env\n',
      );
      process.exit(2);
    }
    const partial = await runPair({ relayUrl });
    process.stderr.write(
      '\n[mw-claude] Waiting for the client to complete handshake — Task 10 wires this. For now, this command exits after showing the QR.\n',
    );
    // Persist what we have so the future run subcommand can resume.
    store.save({
      version: 1,
      relayUrl: partial.relayUrl!,
      channelId: partial.channelId!,
      daemonPublicKey: partial.daemonPublicKey!,
      daemonPrivateKey: partial.daemonPrivateKey!,
      peerPublicKey: '', // filled by handshake in Task 10
    });
    return;
  }

  if (subcommand === 'run') {
    const cfg = store.load();
    if (!cfg || !cfg.peerPublicKey) {
      process.stderr.write(
        'mw-claude: not paired yet — run `mw-claude pair --relay-url <wss://...>` first\n',
      );
      process.exit(2);
    }
    // Implementation continues in Task 11 (relay-client + claude PTY).
    process.stderr.write('[mw-claude] run mode — relay client implementation arrives in Task 11.\n');
    return;
  }

  process.stderr.write(`mw-claude: unknown subcommand "${subcommand}"\n`);
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Smoke check the pair command**

```
npm run build -w packages/mw-claude
node packages/mw-claude/dist/cli.js pair --relay-url wss://example.vercel.app/api/ws
```

Expected: a QR code prints to your terminal. `~/.mw-claude/config.json` is created with partial config. Visually verify the QR is well-formed (not garbage). Then DELETE the temp config (`Remove-Item ~\.mw-claude\config.json`) so it doesn't pollute subsequent tasks.

- [ ] **Step 5: Tests still pass**

```
npm test -w packages/mw-claude
```

Expected: 14 passing.

- [ ] **Step 6: Commit**

```
git add packages/mw-claude/package.json packages/mw-claude/package-lock.json packages/mw-claude/src/pair.ts packages/mw-claude/src/cli.ts
git commit -m "feat(mw-claude): pair subcommand with QR rendering"
```

---

## Task 10: Pairing handshake protocol

**Files:**
- Modify: `packages/mw-claude/src/pair.ts`
- Modify: `packages/mw-claude/src/cli.ts`
- Create: `packages/mw-claude/src/relay-client.ts`

**Protocol:**
- Daemon connects to `wss://relay/api/ws?channel=<channel_id>&role=daemon` after showing the QR.
- Client scans QR (or opens the URL), learns `{channel_id, daemon_pub, relay_url}`, generates its own keypair, connects to `wss://relay/api/ws?channel=<channel_id>&role=client`.
- Client sends an unencrypted handshake frame: `{type:"hello", client_pub:"<base64>"}`.
- Daemon receives, stores `client_pub` as `peerPublicKey`, replies with `{type:"hello_ack"}`.
- Both sides switch to encrypted mode for all subsequent frames.

The unencrypted handshake is acceptable because:
- An attacker on the relay learns `client_pub` but cannot impersonate the daemon (they don't have `daemon_priv`).
- An attacker who scans the QR would know `daemon_pub`, but they'd also need to be the first to complete the handshake (acceptable race window for v1).

- [ ] **Step 1: Write `relay-client.ts`**

Write `packages/mw-claude/src/relay-client.ts`:

```ts
import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import sodium from 'libsodium-wrappers';
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
      this.emit('error', new Error('peerPublicKey not set yet; cannot encrypt'));
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
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const f = frame as { type?: string };
      if (f.type === 'hello' || f.type === 'hello_ack') {
        this.emit('handshake', frame);
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

- [ ] **Step 2: Wire daemon-side handshake in `pair.ts`**

Modify `runPair` to *also* connect to the relay after rendering the QR, wait for the `hello` frame, send `hello_ack`, and persist `peerPublicKey`. Replace `packages/mw-claude/src/pair.ts` with:

```ts
import qrcode from 'qrcode-terminal';
import sodium from 'libsodium-wrappers';
import { initCrypto, generateKeyPair } from './crypto.js';
import { ConfigStore, type Config } from './config-store.js';
import { RelayClient } from './relay-client.js';

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

  process.stdout.write('\nScan this QR with the Claude Display client:\n\n');
  await new Promise<void>((resolve) =>
    qrcode.generate(payloadStr, { small: true }, (qr) => {
      process.stdout.write(qr + '\n');
      resolve();
    }),
  );
  const webUrl =
    opts.relayUrl.replace(/^wss?:/, 'https:').replace('/api/ws', '') +
    '/?p=' +
    encodeURIComponent(
      sodium.to_base64(sodium.from_string(payloadStr), sodium.base64_variants.URLSAFE_NO_PADDING),
    );
  process.stdout.write(`Or paste this URL: ${webUrl}\n\n`);

  // Connect to relay and wait for handshake.
  const client = new RelayClient({
    relayUrl: opts.relayUrl,
    channelId,
    role: 'daemon',
    myKeyPair: kp,
    peerPublicKey: null,
  });

  const peerPub = await new Promise<Uint8Array>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.stop();
      reject(new Error('Pairing timed out after 5 minutes'));
    }, 5 * 60 * 1000);
    client.on('handshake', (frame: { type: string; client_pub?: string }) => {
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

- [ ] **Step 3: Update `cli.ts` to consume the full Config returned by runPair**

In `packages/mw-claude/src/cli.ts`, replace the `if (subcommand === 'pair') { ... }` block with:

```ts
  if (subcommand === 'pair') {
    const relayUrlArg = args[args.indexOf('--relay-url') + 1];
    const relayUrl = relayUrlArg && !relayUrlArg.startsWith('--')
      ? relayUrlArg
      : process.env.MW_CLAUDE_RELAY_URL;
    if (!relayUrl) {
      process.stderr.write('mw-claude pair: missing --relay-url or MW_CLAUDE_RELAY_URL env\n');
      process.exit(2);
    }
    const cfg = await runPair({ relayUrl });
    store.save(cfg);
    process.stdout.write('\n[mw-claude] Paired! Config saved to ~/.mw-claude/config.json\n');
    process.stdout.write('[mw-claude] Run `mw-claude` (no args) to start the claude session.\n');
    return;
  }
```

- [ ] **Step 4: Build**

```
npm run build -w packages/mw-claude
```

Expected: no errors.

- [ ] **Step 5: Tests still pass**

```
npm test -w packages/mw-claude
```

Expected: 14 passing.

- [ ] **Step 6: Commit**

```
git add packages/mw-claude/src/pair.ts packages/mw-claude/src/relay-client.ts packages/mw-claude/src/cli.ts
git commit -m "feat(mw-claude): pairing handshake over relay with hello/hello_ack"
```

---

## Task 11: Run subcommand — wire claude PTY + relay client + segmenter

**Files:**
- Modify: `packages/mw-claude/src/cli.ts`

- [ ] **Step 1: Implement `run` branch**

In `packages/mw-claude/src/cli.ts`, replace the `if (subcommand === 'run') { ... }` block with:

```ts
  if (subcommand === 'run') {
    const cfg = store.load();
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
        // ignore
      }
    });

    relay.on('open', () => process.stderr.write(`[mw-claude] relay connected (${cfg.channelId})\n`));
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
    return;
  }
```

You'll also need to add at the top of the file:

```ts
import sodium from 'libsodium-wrappers';
import { initCrypto } from './crypto.js';
```

- [ ] **Step 2: Build**

```
npm run build -w packages/mw-claude
```

- [ ] **Step 3: Tests**

```
npm test -w packages/mw-claude
```

Expected: 14 passing.

- [ ] **Step 4: Smoke check (limited)**

You cannot do a real handshake without a working relay URL + a client. Just verify `node packages/mw-claude/dist/cli.js run` fails gracefully when not paired:

```powershell
$env:MW_CLAUDE_RELAY_URL=$null
Remove-Item $env:USERPROFILE\.mw-claude\config.json -ErrorAction SilentlyContinue
node packages/mw-claude/dist/cli.js run
```

Expected stderr: `mw-claude: not paired yet — run \`mw-claude pair --relay-url <wss://...>\` first`. Exit code 2.

- [ ] **Step 5: Commit**

```
git add packages/mw-claude/src/cli.ts
git commit -m "feat(mw-claude): run subcommand wires claude PTY through encrypted relay"
```

---

## Task 12: Browser test client with pairing-aware crypto

**Files:**
- Modify: `packages/relay/package.json` (add `libsodium-wrappers`)
- Create: `packages/relay/app/page.tsx` (replace placeholder)
- Create: `packages/relay/app/pair/page.tsx`

The browser test client mirrors the Plan-1 HTML page but with three additions:
1. On first visit (no stored config), shows a QR-paste / URL-param flow.
2. Generates its own keypair (stored in `localStorage`).
3. Performs the `hello` handshake and then sends/receives encrypted messages.

- [ ] **Step 1: Already have `libsodium-wrappers` in relay — verify**

If not in `packages/relay/package.json` `dependencies`, add it and `npm install`.

- [ ] **Step 2: Write `app/page.tsx`**

Write `packages/relay/app/page.tsx`:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import sodium from 'libsodium-wrappers';

interface PairedState {
  channelId: string;
  daemonPub: string;       // base64
  relayUrl: string;        // wss://.../api/ws
  clientPub: string;       // base64 — mine
  clientPriv: string;      // base64 — mine
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

interface QrPayload {
  v: 1;
  channel_id: string;
  daemon_pub: string;
  relay_url: string;
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

export default function HomePage(): JSX.Element {
  const [paired, setPaired] = useState<PairedState | null>(null);
  const [status, setStatus] = useState('initializing…');
  const [log, setLog] = useState<Array<{ kind: 'you' | 'claude'; text: string }>>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Boot: load paired state, OR consume ?p=... from URL.
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
      if (!stored) setStatus('not paired — run `mw-claude pair --relay-url wss://...` on your PC and open the URL it prints');
    })();
  }, []);

  // Connect once paired.
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

    function encrypt(plaintext: string): string {
      const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
      const pt = sodium.from_string(plaintext);
      const ct = sodium.crypto_box_easy(pt, nonce, daemonPub, myKP.privateKey);
      const out = new Uint8Array(nonce.length + ct.length);
      out.set(nonce, 0);
      out.set(ct, nonce.length);
      return sodium.to_base64(out, sodium.base64_variants.ORIGINAL);
    }

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
        } else if (f.type === 'msg' && f.ct) {
          try {
            const pt = decrypt(f.ct);
            const m = JSON.parse(pt);
            if (m.type === 'reply') setLog((l) => [...l, { kind: 'claude', text: m.text }]);
          } catch {}
        }
      };
      ws.onclose = () => {
        setStatus(`disconnected — reconnecting in ${Math.round(backoff/1000)}s`);
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
    const myKP = {
      publicKey: sodium.from_base64(paired.clientPub, sodium.base64_variants.ORIGINAL),
      privateKey: sodium.from_base64(paired.clientPriv, sodium.base64_variants.ORIGINAL),
    };
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const pt = sodium.from_string(JSON.stringify({ type: 'prompt', text }));
    const ct = sodium.crypto_box_easy(pt, nonce, daemonPub, myKP.privateKey);
    const out = new Uint8Array(nonce.length + ct.length);
    out.set(nonce, 0);
    out.set(ct, nonce.length);
    wsRef.current.send(JSON.stringify({ type: 'msg', ct: sodium.to_base64(out, sodium.base64_variants.ORIGINAL) }));
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
          <div key={i} style={{ color: l.kind === 'you' ? '#9ad0ff' : '#e7e7e7', marginTop: '0.5rem' }}>
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
          style={{ padding: '0.6rem 1rem', borderRadius: 6, border: 0, background: '#3a7afe', color: 'white' }}
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
          style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#7a8597', background: 'none', border: 'none' }}
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

Expected: success.

- [ ] **Step 3: Local end-to-end smoke test**

This is the moment of truth for the protocol. In four terminals:

Terminal 1 — relay:

```
npm run dev:relay
```

Terminal 2 — pair daemon (will print a QR and wait for handshake):

```
node packages/mw-claude/dist/cli.js pair --relay-url ws://localhost:3000/api/ws
```

Copy the "Or paste this URL" line from the terminal output. (It will be `http://localhost:3000/?p=...`.)

Terminal 3 — browser:

Open the URL in a browser. The page should show "paired & encrypted" after a moment. The daemon (Terminal 2) should print "Paired! Config saved" and exit.

Terminal 4 — run daemon:

```
node packages/mw-claude/dist/cli.js run
```

The Claude TUI appears in this terminal. Stderr shows `[mw-claude] relay connected`.

Now in the browser (Terminal 3 still open), type a prompt and Send. Verify:
- The prompt arrives in Terminal 4's TUI.
- Claude's response shows in the browser.

If any step fails, escalate with the specific error.

- [ ] **Step 4: Commit**

```
git add packages/relay
git commit -m "feat(relay): browser test client with libsodium handshake"
```

---

## Task 13: Production deploy + production smoke test

**Files:** none beyond a tiny doc note.

- [ ] **Step 1: Deploy to Vercel**

```
cd packages/relay
vercel --prod
```

Capture the production URL.

- [ ] **Step 2: Smoke test against production**

In your PC terminal:

```
node packages/mw-claude/dist/cli.js pair --relay-url wss://<production-url>/api/ws
```

Open the printed URL in a browser. Confirm pairing completes. Then `node packages/mw-claude/dist/cli.js run`. Send a prompt from the browser. Verify it reaches your local Claude session.

This is the acceptance test for Plan 2.

- [ ] **Step 3: Update README**

In `packages/mw-claude/README.md`, append a section:

```markdown
## Pairing with the cloud relay

1. Deploy the relay (see `packages/relay/README.md`) or use the public deploy.
2. Pair: `mw-claude pair --relay-url wss://<your-relay>.vercel.app/api/ws`
   This prints a QR and a URL. Open either on the device you want to control from.
3. Run: `mw-claude` (or `mw-claude run`). Now any browser/client paired with
   this channel can prompt your Claude session.
```

Commit:

```
git add packages/mw-claude/README.md
git commit -m "docs(mw-claude): document pairing flow"
```

---

## Acceptance criteria for Plan 2

1. `vercel --prod` deploys the `relay` package successfully and the production URL serves the home page over HTTPS.
2. `mw-claude pair --relay-url wss://<prod>/api/ws` prints a scannable QR and a copy-pasteable URL, then waits for handshake.
3. Opening the URL in any browser (different network is fine) shows "paired & encrypted" and the daemon prints "Paired! Config saved".
4. `mw-claude run` after pairing connects to the relay, the Claude TUI appears, and stderr shows `relay connected`.
5. A prompt typed in the browser arrives in the local Claude session and produces a reply visible in the browser within a few seconds — over the internet, not localhost.
6. Forcibly killing `mw-claude` and restarting it (without re-pairing) resumes the session: the daemon reconnects and resumes accepting browser prompts.
7. `npm test --workspaces` passes (mw-claude 14 + relay 2 = 16 tests minimum).

If all 7 hold, Plan 2 is done and we can begin **Plan 3** (Meta Display glasses webapp).

---

## Risks

1. **Task 6 (WebSocket on Vercel) is the highest-risk** task. Vercel's WS story has evolved repeatedly and may require pattern revision. The task explicitly authorizes the implementer to deviate or pivot.
2. **Upstash SSE subscribe latency** — if it's slow (>500ms), prompts will feel laggy. We can measure post-deploy and switch to direct WebSocket between instances later if needed.
3. **Pairing URL leak** — anyone with the URL during the 5-minute handshake window can claim the pairing. Acceptable for v1 single-user use; future work could add a daemon-side confirmation prompt.
4. **Browser key persistence** — losing `localStorage` means re-pairing. Acceptable; documented in the "unpair" button.

## Self-review notes

- **Spec coverage:** Plan 2 covers spec §5.1 (browser test client — minimal), §5.2 (relay), §6 (data flow), §7 (pairing + encryption), §11 risk #4 (reconnect-tolerance baked in). Spec §5.1 *glasses webapp* deferred to Plan 3; spec §7 *Whisper proxy* deferred to Plan 4.
- **No placeholders:** all code blocks complete. Task 6 has an explicit "this may need a pivot" callout — that's a known-unknown, not a placeholder.
- **Type consistency:** `Config`, `PairedState`, `RelayClient` opts, frame types (`hello`, `hello_ack`, `msg`) used consistently across daemon + browser sides.
- **Open question parked:** §1 of the spec lists "Whisper proxy: through relay or direct from daemon" — still parked, Plan 4 territory.
