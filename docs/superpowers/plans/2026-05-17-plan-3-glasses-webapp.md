# Plan 3 — Meta Display Glasses Webapp

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a vanilla-JS Meta Display Glasses webapp that, paired with your `mw-claude` daemon, lets you tap-to-talk on the glasses and see Claude's reply on the waveguide display. The same webapp works in any browser, so you can verify the loop on a laptop before putting it on real hardware.

**Architecture:** Replace Plan 2's React test SPA with a glasses-native webapp following Meta's `meta-wearables-webapp` template (600×600 viewport, D-pad focus model, `#000000` as transparent background). The webapp ships from the same Cloudflare Worker that hosts the relay — Workers Assets serves the static files, the same `/api/ws` route handles the WebSocket. Pairing is the same `?p=` URL flow from Plan 2; the glasses load that URL once via the Meta Display companion app and persist state in `localStorage`. Crypto uses **TweetNaCl** (~50 KB) instead of libsodium (~870 KB) — same `crypto_box` primitive, fully interoperable with the daemon's libsodium. Speech-to-text uses the Web Speech API, with a text-input fallback for laptop testing and devices where the API isn't available.

**Tech Stack:** Vanilla HTML/CSS/JS, TweetNaCl (`tweetnacl` + `tweetnacl-util`), Web Speech API, Cloudflare Workers + DO (unchanged), existing `mw-claude` daemon (unchanged).

**Prerequisite:** Plan 2 complete and verified. The Worker is deployed at `https://claude-display.brunofernandeslopes.workers.dev`. ADB-connected Meta Display Glasses for on-device testing in Task 11.

---

## File structure (new + modified)

```
B:\Projects\ClaudeDisplay\
├── packages\
│   └── relay\
│       ├── package.json                  (modified: drop Vite/React, add tweetnacl, add copy build)
│       ├── wrangler.toml                 (unchanged)
│       ├── tsconfig.json                 (unchanged for Worker; drop client tsx config)
│       ├── src\
│       │   ├── worker.ts                 (unchanged)
│       │   ├── channel-do.ts             (unchanged)
│       │   └── client\                   (DELETED — Plan 2's React SPA, no longer used)
│       ├── glasses-app\                  (NEW — vanilla glasses webapp)
│       │   ├── index.html                (HTML structure with screens)
│       │   ├── styles.css                (dark theme, focus states, 600×600 layout)
│       │   ├── app.js                    (main entry: navigation, UI, STT, lifecycle)
│       │   ├── crypto.js                 (TweetNaCl crypto_box wrapper)
│       │   ├── pairing.js                (?p= consume + localStorage)
│       │   ├── relay-ws.js               (WebSocket client + handshake)
│       │   ├── favicon.png               (128×128 PNG via favicon_generator.py)
│       │   ├── manifest.webmanifest
│       │   └── vendor\
│       │       ├── nacl.min.js           (~50 KB — vendored from tweetnacl npm)
│       │       └── nacl-util.min.js      (~3 KB — vendored from tweetnacl-util npm)
│       └── (no dist/ committed — generated)
└── docs\superpowers\plans\
    └── 2026-05-17-plan-3-glasses-webapp.md   (this file)
```

**Module responsibilities:**

- `glasses-app/app.js` — main entry. Hooks up D-pad navigation per the template, manages UI state (idle / recording / waiting / error), wires button presses to the speech recognition flow, renders incoming replies into the transcript. Imports `pairing.js`, `crypto.js`, `relay-ws.js`.
- `glasses-app/crypto.js` — exports `generateKeyPair()`, `encrypt(pt, recipientPubB64, mySecretB64)`, `decrypt(ctB64, senderPubB64, mySecretB64)`. Uses TweetNaCl box primitive.
- `glasses-app/pairing.js` — exports `getPaired()`, `consumeUrlPairing()`, `clearPairing()`. Handles the `?p=` query param: decodes the base64 JSON, generates a fresh keypair if this is a new pairing, persists to `localStorage`. If `?p=` matches stored pairing (same `channel_id`), it's a no-op (reload after pair).
- `glasses-app/relay-ws.js` — exports `connect({paired, onStatus, onReply})`. Wraps the WebSocket lifecycle with reconnect backoff, sends `hello` on open, decrypts incoming `msg` frames, exposes a `send(plaintextObj)` to encrypt and emit `msg` frames.

The split into modules is intentional — vanilla-JS webapps still benefit from one-responsibility files. The Display browser supports native ES modules (`<script type="module">`), so no bundler needed.

---

## Task 1: Read the Meta Display performance guidelines

**Files:** none — informational.

The implementer must read `C:/Users/RTZ-PC/.claude/plugins/cache/meta-wearables/meta-wearables-webapp/125.0.0/references/performance-guidelines.md` before any UI work. Key constraints will inform Tasks 4–8 (animation budgets, memory limits, what to avoid).

- [ ] **Step 1: Read the performance guidelines file at the path above**

No commit. Internal calibration only.

---

## Task 2: Reconfigure relay build — drop Vite/React, vendor TweetNaCl

**Files:**
- Modify: `packages/relay/package.json`
- Delete: `packages/relay/vite.config.ts`, `packages/relay/index.html` (the Vite entry), `packages/relay/src/client/`, all React-related deps
- Modify: `packages/relay/tsconfig.json` (drop DOM/JSX config — only the Worker remains TypeScript)
- Create: `packages/relay/glasses-app/vendor/nacl.min.js`
- Create: `packages/relay/glasses-app/vendor/nacl-util.min.js`

The previous build pipeline was Vite + React, building to `dist/`. We're replacing that with a plain copy step: `node scripts/build.mjs` copies `glasses-app/*` to `dist/*`, then `wrangler deploy` uploads as Workers Assets.

- [ ] **Step 1: Update `packages/relay/package.json`**

Replace the entire file with:

```json
{
  "name": "relay",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "build": "node scripts/build.mjs",
    "deploy": "npm run build && wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "tweetnacl": "^1.0.3",
    "tweetnacl-util": "^0.15.1"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260517.1",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0",
    "wrangler": "^4.0.0"
  }
}
```

(Vite, React, libsodium-wrappers — all removed.)

- [ ] **Step 2: Update `packages/relay/tsconfig.json`**

Replace with a Worker-only config:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Delete now-obsolete files**

```bash
rm packages/relay/vite.config.ts
rm packages/relay/index.html
rm -rf packages/relay/src/client
```

- [ ] **Step 4: Create the build script**

Create `packages/relay/scripts/build.mjs`:

```js
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'glasses-app');
const dst = join(root, 'dist');

if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });

console.log('built:', dst);
```

- [ ] **Step 5: Install deps (replace lock entries cleanly)**

```bash
npm install
```

Expected: removes Vite/React/libsodium-wrappers from `node_modules`, installs TweetNaCl.

- [ ] **Step 6: Vendor the TweetNaCl files**

We vendor (not import) because the glasses webapp is plain static HTML — no bundler to resolve `node_modules` paths. Copy the prebuilt browser scripts from `node_modules` into `glasses-app/vendor/`:

```bash
mkdir -p packages/relay/glasses-app/vendor
cp node_modules/tweetnacl/nacl.min.js packages/relay/glasses-app/vendor/nacl.min.js
cp node_modules/tweetnacl-util/nacl-util.min.js packages/relay/glasses-app/vendor/nacl-util.min.js
```

Verify both files exist and are <100 KB combined:

```bash
wc -c packages/relay/glasses-app/vendor/nacl.min.js
wc -c packages/relay/glasses-app/vendor/nacl-util.min.js
```

Expected: roughly 50 KB and 3 KB respectively.

- [ ] **Step 7: Smoke check — empty build runs**

```bash
mkdir -p packages/relay/glasses-app   # ensure src dir exists even if empty
npm run build -w packages/relay
```

Expected: `built: ...\dist` printed. `packages/relay/dist/vendor/nacl.min.js` exists.

- [ ] **Step 8: Commit**

```
git add packages/relay package.json package-lock.json
git commit -m "refactor(relay): replace vite/react with static glasses-app pipeline"
```

---

## Task 3: Scaffold glasses-app HTML + styles + favicon

**Files:**
- Create: `packages/relay/glasses-app/index.html`
- Create: `packages/relay/glasses-app/styles.css`
- Create: `packages/relay/glasses-app/manifest.webmanifest`
- Create: `packages/relay/glasses-app/favicon.png` (generated)

Single-screen app for v1. Three logical regions:
1. **Status strip** (top, 64 dp tall) — pairing/connection state.
2. **Talk button** (center, 88×88 dp+ tap target, focused by default).
3. **Transcript** (lower, scrollable) — your last spoken prompt + Claude's reply.

D-pad behavior: Up/Down toggles focus between the talk button and the transcript (when scrollable). Enter activates the talk button (start/stop recording) or scrolls the transcript. Back/Escape returns focus to the talk button.

- [ ] **Step 1: Create `packages/relay/glasses-app/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=600, height=600, initial-scale=1.0" />
  <title>Claude Display</title>
  <link rel="icon" href="favicon.png" type="image/png" />
  <link rel="manifest" href="manifest.webmanifest" />
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <div class="app-root">
    <div id="screen-main" class="screen">
      <header class="status-strip" aria-live="polite">
        <span id="status-text">starting…</span>
      </header>

      <main class="main-area">
        <button
          id="talk-btn"
          class="talk-btn focusable"
          data-action="toggle-talk"
          aria-label="Hold to talk"
        >
          <span class="talk-btn-label" id="talk-btn-label">Tap to talk</span>
        </button>

        <section
          id="transcript"
          class="transcript focusable"
          tabindex="0"
          aria-live="polite"
          aria-label="Conversation transcript"
        ></section>
      </main>
    </div>

    <div id="screen-not-paired" class="screen hidden">
      <div class="not-paired">
        <h1>Not paired</h1>
        <p>
          On your PC, run:
        </p>
        <p class="cli">mw-claude pair --relay-url wss://&lt;this-host&gt;/api/ws</p>
        <p>and open the URL it prints — on these glasses (via the Meta Display companion app).</p>
      </div>
    </div>
  </div>

  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `packages/relay/glasses-app/styles.css`**

```css
:root {
  --bg-page: #000000;          /* transparent on additive display */
  --bg-surface: #0a0a0f;       /* visible UI surface */
  --bg-surface-alt: #1c1e21;
  --fg-primary: #ffffff;
  --fg-secondary: #e4e6eb;
  --fg-muted: #b0b3b8;
  --accent: #3a7afe;
  --accent-glow: rgba(58, 122, 254, 0.65);
  --danger: #ff6b6b;
}

* { box-sizing: border-box; }

html, body {
  width: 600px;
  height: 600px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: var(--bg-page);
  color: var(--fg-primary);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}

.app-root {
  width: 600px;
  height: 600px;
  padding: 8px;
  display: flex;
  flex-direction: column;
}

.screen {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  height: 100%;
}

.screen.hidden { display: none; }

.status-strip {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface);
  border-radius: 16px;
  font-size: 14px;
  color: var(--fg-secondary);
  padding: 0 16px;
  flex-shrink: 0;
}

.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
}

.talk-btn {
  width: 100%;
  height: 160px;
  border: 0;
  border-radius: 24px;
  background: var(--bg-surface-alt);
  color: var(--fg-primary);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition:
    transform 475ms cubic-bezier(0.6, 0, 0.4, 1),
    box-shadow 300ms cubic-bezier(0.4, 0.04, 0.5, 1),
    background 300ms cubic-bezier(0.4, 0.04, 0.5, 1);
}

.talk-btn:focus,
.talk-btn.focused {
  outline: none;
  transform: scale(0.95);
  box-shadow: 0 0 0 3px var(--accent), 0 0 24px var(--accent-glow);
}

.talk-btn.recording {
  background: var(--danger);
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 3px var(--danger), 0 0 12px var(--danger); }
  50%      { box-shadow: 0 0 0 6px var(--danger), 0 0 32px var(--danger); }
}

.transcript {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--bg-surface);
  border-radius: 16px;
  padding: 12px 16px;
  font-size: 16px;
  line-height: 1.4;
  position: relative;
}

.transcript:focus,
.transcript.focused {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent), 0 0 16px var(--accent-glow);
}

.transcript::after {
  content: '';
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  display: block;
  height: 32px;
  margin-top: -32px;
  background: linear-gradient(to top, var(--bg-surface) 0%, transparent 100%);
  pointer-events: none;
}

.turn { margin-bottom: 12px; }
.turn-you { color: #9ad0ff; }
.turn-claude { color: var(--fg-primary); }
.turn-label {
  display: block;
  font-size: 12px;
  color: var(--fg-muted);
  margin-bottom: 2px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.not-paired {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  background: var(--bg-surface);
  border-radius: 24px;
}
.not-paired h1 { font-size: 28px; margin: 0 0 16px; }
.not-paired p { font-size: 16px; color: var(--fg-secondary); margin: 4px 0; }
.not-paired .cli {
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: 13px;
  background: var(--bg-surface-alt);
  padding: 8px 12px;
  border-radius: 8px;
  margin: 12px 0;
  word-break: break-all;
}
```

- [ ] **Step 3: Create `packages/relay/glasses-app/manifest.webmanifest`**

```json
{
  "name": "Claude Display",
  "short_name": "Claude",
  "icons": [
    { "src": "favicon.png", "sizes": "128x128", "type": "image/png" }
  ],
  "background_color": "#000000",
  "theme_color": "#000000",
  "display": "standalone"
}
```

- [ ] **Step 4: Generate the favicon**

Use the Meta Wearables plugin's bundled `favicon_generator.py`:

```bash
python3 "C:/Users/RTZ-PC/.claude/plugins/cache/meta-wearables/meta-wearables-webapp/125.0.0/skills/create-webapp/scripts/favicon_generator.py" \
  --spec - --out packages/relay/glasses-app/favicon.png <<'EOF'
{
  "size": 128,
  "background": {"type": "gradient", "from": "#0a0a0f", "to": "#000000"},
  "plate": {"color": "#3a7afe", "radius": 32, "inset": 8},
  "layers": [
    {"type": "ring", "cx": 64, "cy": 64, "r": 36, "width": 4, "color": "#ffffff"},
    {"type": "circle", "cx": 64, "cy": 64, "r": 12, "color": "#ffffff"}
  ]
}
EOF
```

If `python3` isn't on PATH, try `python`. On Windows PowerShell the heredoc syntax differs — use:

```powershell
$spec = '{"size":128,"background":{"type":"gradient","from":"#0a0a0f","to":"#000000"},"plate":{"color":"#3a7afe","radius":32,"inset":8},"layers":[{"type":"ring","cx":64,"cy":64,"r":36,"width":4,"color":"#ffffff"},{"type":"circle","cx":64,"cy":64,"r":12,"color":"#ffffff"}]}'
$spec | python "C:/Users/RTZ-PC/.claude/plugins/cache/meta-wearables/meta-wearables-webapp/125.0.0/skills/create-webapp/scripts/favicon_generator.py" --spec - --out packages/relay/glasses-app/favicon.png
```

Verify:

```bash
ls -la packages/relay/glasses-app/favicon.png
# expected: ~1-3 KB PNG file
```

- [ ] **Step 5: Build (smoke check assets land in dist)**

```bash
npm run build -w packages/relay
ls packages/relay/dist
```

Expected: `index.html`, `styles.css`, `manifest.webmanifest`, `favicon.png`, `vendor/` all present.

- [ ] **Step 6: Commit**

```
git add packages/relay/glasses-app/
git commit -m "feat(glasses-app): HTML + styles + favicon scaffold"
```

---

## Task 4: Crypto module (TweetNaCl)

**Files:**
- Create: `packages/relay/glasses-app/crypto.js`

Wire TweetNaCl's `box` primitive to match the daemon's libsodium `crypto_box_easy` envelope: nonce (24 bytes) prepended to ciphertext, base64-encoded.

- [ ] **Step 1: Write `crypto.js`**

Since we vendor TweetNaCl as global scripts (`nacl.min.js` exports `window.nacl`), the module imports those via plain `<script>` tags — but we're using ES modules, so we'll load them dynamically once and cache.

Write `packages/relay/glasses-app/crypto.js`:

```js
// Loads vendored TweetNaCl scripts and caches the global handle.
// Vendored scripts attach `nacl` and `nacl.util` to window.
let ready;
async function loadNacl() {
  if (window.nacl && window.nacl.util) return window.nacl;
  if (ready) return ready;
  ready = (async () => {
    await loadScript('vendor/nacl.min.js');
    await loadScript('vendor/nacl-util.min.js');
    return window.nacl;
  })();
  return ready;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

export async function generateKeyPair() {
  const nacl = await loadNacl();
  const kp = nacl.box.keyPair();
  return {
    publicKey: nacl.util.encodeBase64(kp.publicKey),
    secretKey: nacl.util.encodeBase64(kp.secretKey),
  };
}

/** Encrypts `plaintext` (string) for recipient. Returns base64 string of nonce||ciphertext. */
export async function encrypt(plaintext, recipientPubB64, mySecretB64) {
  const nacl = await loadNacl();
  const recipient = nacl.util.decodeBase64(recipientPubB64);
  const mine = nacl.util.decodeBase64(mySecretB64);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const msg = nacl.util.decodeUTF8(plaintext);
  const ct = nacl.box(msg, nonce, recipient, mine);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce, 0);
  out.set(ct, nonce.length);
  return nacl.util.encodeBase64(out);
}

/** Decrypts base64 of nonce||ciphertext. Returns plaintext string. Throws on failure. */
export async function decrypt(ctB64, senderPubB64, mySecretB64) {
  const nacl = await loadNacl();
  const raw = nacl.util.decodeBase64(ctB64);
  const nonce = raw.slice(0, nacl.box.nonceLength);
  const ct = raw.slice(nacl.box.nonceLength);
  const sender = nacl.util.decodeBase64(senderPubB64);
  const mine = nacl.util.decodeBase64(mySecretB64);
  const pt = nacl.box.open(ct, nonce, sender, mine);
  if (!pt) throw new Error('decryption failed (wrong key or tampered)');
  return nacl.util.encodeUTF8(pt);
}
```

- [ ] **Step 2: Build**

```bash
npm run build -w packages/relay
```

Expected: `dist/crypto.js` exists.

- [ ] **Step 3: Manual round-trip test in a browser console**

Add a temporary test stub. Open `packages/relay/dist/` in `wrangler dev`:

```bash
npm run dev:relay
```

In a browser, navigate to `http://localhost:8787/`, open DevTools console, paste:

```js
const { generateKeyPair, encrypt, decrypt } = await import('./crypto.js');
const alice = await generateKeyPair();
const bob = await generateKeyPair();
const ct = await encrypt('hello over the wire', bob.publicKey, alice.secretKey);
const pt = await decrypt(ct, alice.publicKey, bob.secretKey);
console.assert(pt === 'hello over the wire', 'round-trip failed', pt);
console.log('crypto round-trip OK');
```

Expected console output: `crypto round-trip OK`. Stop `wrangler dev`.

- [ ] **Step 4: Daemon-interop spot check**

The wire compatibility with the libsodium daemon needs verification. Pick a known plaintext, encrypt with our `crypto.js`, then decrypt using the daemon's `crypto.ts` via a quick node script:

Create `packages/relay/scripts/interop-check.mjs` (temporary — delete after):

```js
import sodium from 'libsodium-wrappers';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

await sodium.ready;

// Generate keypairs with libsodium and TweetNaCl, ensure they're interop.
const aliceSodium = sodium.crypto_box_keypair();
const bobNacl = nacl.box.keyPair();

const plaintext = 'interop test';

// TweetNaCl encrypts to libsodium recipient.
const nonce = nacl.randomBytes(nacl.box.nonceLength);
const ct = nacl.box(naclUtil.decodeUTF8(plaintext), nonce, aliceSodium.publicKey, bobNacl.secretKey);

// libsodium decrypts.
const raw = new Uint8Array(nonce.length + ct.length);
raw.set(nonce, 0);
raw.set(ct, nonce.length);
const decoded = sodium.crypto_box_open_easy(
  raw.slice(sodium.crypto_box_NONCEBYTES),
  raw.slice(0, sodium.crypto_box_NONCEBYTES),
  bobNacl.publicKey,
  aliceSodium.privateKey,
);
const decodedStr = sodium.to_string(decoded);
console.assert(decodedStr === plaintext, 'interop mismatch', decodedStr);
console.log('interop OK');
```

Install the deps at root level for the test (they're already in `packages/mw-claude` and `packages/relay`):

```bash
node packages/relay/scripts/interop-check.mjs
```

Expected output: `interop OK`. If it fails, the encoding/nonce handling differs — fix `crypto.js` and re-run.

Delete the interop script:

```bash
rm packages/relay/scripts/interop-check.mjs
```

- [ ] **Step 5: Commit**

```
git add packages/relay/glasses-app/crypto.js
git commit -m "feat(glasses-app): tweetnacl crypto_box wrapper interop-tested with libsodium"
```

---

## Task 5: Pairing module

**Files:**
- Create: `packages/relay/glasses-app/pairing.js`

- [ ] **Step 1: Write `pairing.js`**

```js
import { generateKeyPair } from './crypto.js';

const STORAGE_KEY = 'claude-display.paired.v1';

export function getPaired() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPairing() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * If the current URL has `?p=...`, decode the QR payload, generate a fresh
 * keypair, persist to localStorage, and strip `?p=` from the URL.
 * Returns the paired state (existing or newly created), or null if no pairing.
 */
export async function consumeUrlPairing() {
  const url = new URL(window.location.href);
  const p = url.searchParams.get('p');
  if (!p) return getPaired();

  let payload;
  try {
    const json = atob(b64UrlToB64(p));
    payload = JSON.parse(json);
    if (payload.v !== 1) throw new Error('unsupported pairing version');
  } catch (err) {
    return { error: 'pairing payload invalid: ' + err.message };
  }

  // If we're already paired to this same channel, no-op (page reload after pair).
  const existing = getPaired();
  if (existing && existing.channelId === payload.channel_id) {
    cleanUrl();
    return existing;
  }

  // Fresh pairing — generate a new keypair.
  const kp = await generateKeyPair();
  const paired = {
    channelId: payload.channel_id,
    daemonPub: payload.daemon_pub,
    relayUrl: payload.relay_url,
    clientPub: kp.publicKey,
    clientPriv: kp.secretKey,
    pairedAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(paired));
  cleanUrl();
  return paired;
}

function b64UrlToB64(s) {
  // tweetnacl-util doesn't accept urlsafe-no-padding. Convert.
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return pad ? padded + '='.repeat(4 - pad) : padded;
}

function cleanUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('p');
  history.replaceState({}, '', url.pathname + (url.search ? '?' + url.searchParams.toString() : ''));
}
```

- [ ] **Step 2: Manual test in browser console**

```bash
npm run dev:relay
```

Browser to `http://localhost:8787/?p=eyJ2IjoxLCJjaGFubmVsX2lkIjoidGVzdC1jaCIsImRhZW1vbl9wdWIiOiJBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQT0iLCJyZWxheV91cmwiOiJ3c3M6Ly90ZXN0L2FwaS93cyJ9` (a hand-crafted v1 payload with channel `test-ch`).

Open DevTools console:

```js
const { consumeUrlPairing, getPaired } = await import('./pairing.js');
const result = await consumeUrlPairing();
console.log('paired:', result);
console.log('URL is clean now:', location.search === '');
console.log('persisted:', getPaired());
// Clean up:
localStorage.removeItem('claude-display.paired.v1');
```

Expected: `result.channelId === 'test-ch'`, the URL no longer has `?p=`, persisted state matches.

Stop `wrangler dev`.

- [ ] **Step 3: Commit**

```
git add packages/relay/glasses-app/pairing.js
git commit -m "feat(glasses-app): pairing module with ?p= URL consumption"
```

---

## Task 6: WebSocket client + handshake

**Files:**
- Create: `packages/relay/glasses-app/relay-ws.js`

- [ ] **Step 1: Write `relay-ws.js`**

```js
import { encrypt, decrypt } from './crypto.js';

/**
 * Opens a WebSocket to the relay as role=client. Handles handshake
 * (hello → hello_ack) and bidirectional encrypted msg frames.
 *
 * @param {object} opts
 * @param {object} opts.paired - { channelId, daemonPub, relayUrl, clientPub, clientPriv }
 * @param {(status: string) => void} opts.onStatus
 * @param {(replyObj: object) => void} opts.onMessage - decoded JSON object
 * @returns {{ send: (obj: object) => void, stop: () => void }}
 */
export function connect(opts) {
  const { paired, onStatus, onMessage } = opts;
  let ws = null;
  let stopped = false;
  let backoff = 500;
  let acked = false;

  function openOnce() {
    if (stopped) return;
    const url = `${paired.relayUrl}?channel=${encodeURIComponent(paired.channelId)}&role=client`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      acked = false;
      onStatus('connecting…');
      ws.send(JSON.stringify({ type: 'hello', client_pub: paired.clientPub }));
    };

    ws.onmessage = async (e) => {
      let f;
      try { f = JSON.parse(String(e.data)); } catch { return; }
      if (f.type === 'hello_ack') {
        acked = true;
        backoff = 500;
        onStatus('paired & encrypted');
      } else if (f.type === 'peer_disconnect') {
        onStatus('daemon disconnected — waiting');
      } else if (f.type === 'msg' && f.ct) {
        try {
          const pt = await decrypt(f.ct, paired.daemonPub, paired.clientPriv);
          const obj = JSON.parse(pt);
          // any decrypted msg = daemon is alive, refresh status
          acked = true;
          onStatus('paired & encrypted');
          onMessage(obj);
        } catch (err) {
          onStatus('decrypt error: ' + err.message);
        }
      }
    };

    ws.onclose = () => {
      ws = null;
      if (stopped) return;
      onStatus(`disconnected — reconnecting in ${Math.round(backoff / 1000)}s`);
      setTimeout(openOnce, backoff);
      backoff = Math.min(backoff * 2, 10000);
    };

    ws.onerror = () => { try { ws?.close(); } catch {} };
  }

  openOnce();

  return {
    async send(obj) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const ct = await encrypt(JSON.stringify(obj), paired.daemonPub, paired.clientPriv);
      ws.send(JSON.stringify({ type: 'msg', ct }));
    },
    stop() {
      stopped = true;
      try { ws?.close(); } catch {}
    },
  };
}
```

- [ ] **Step 2: Build + smoke test**

```bash
npm run build -w packages/relay
```

No interactive test — `relay-ws.js` is exercised by the full integration in Task 8. For now, just verify the file copies to `dist/`:

```bash
ls packages/relay/dist/relay-ws.js
```

- [ ] **Step 3: Commit**

```
git add packages/relay/glasses-app/relay-ws.js
git commit -m "feat(glasses-app): WebSocket client with handshake + encrypted msgs"
```

---

## Task 7: Main app.js — D-pad navigation + lifecycle

**Files:**
- Create: `packages/relay/glasses-app/app.js`

Wires everything together. Pairing on boot → if paired, opens WS → user can tap the talk button. STT integration happens in Task 8; for now the talk button toggles a recording placeholder.

- [ ] **Step 1: Write the skeleton (no STT yet)**

```js
import { consumeUrlPairing } from './pairing.js';
import { connect } from './relay-ws.js';

const els = {
  status: document.getElementById('status-text'),
  talkBtn: document.getElementById('talk-btn'),
  talkBtnLabel: document.getElementById('talk-btn-label'),
  transcript: document.getElementById('transcript'),
  screenMain: document.getElementById('screen-main'),
  screenNotPaired: document.getElementById('screen-not-paired'),
};

const state = {
  paired: null,
  relay: null,
  recording: false,
  focusables: [],
  focusIndex: 0,
};

function setStatus(text) {
  els.status.textContent = text;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function appendTurn(kind, text) {
  const div = document.createElement('div');
  div.className = `turn turn-${kind}`;
  const label = document.createElement('span');
  label.className = 'turn-label';
  label.textContent = kind === 'you' ? 'you' : 'claude';
  const body = document.createElement('div');
  body.textContent = text;
  div.appendChild(label);
  div.appendChild(body);
  els.transcript.appendChild(div);
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function setRecording(on) {
  state.recording = on;
  els.talkBtn.classList.toggle('recording', on);
  els.talkBtnLabel.textContent = on ? 'Listening… tap to send' : 'Tap to talk';
}

// D-pad: Up/Down toggles focus between talk button and transcript.
function rebuildFocusables() {
  state.focusables = [els.talkBtn, els.transcript];
  state.focusIndex = 0;
  applyFocus();
}

function applyFocus() {
  state.focusables.forEach((el, i) => {
    el.classList.toggle('focused', i === state.focusIndex);
  });
  state.focusables[state.focusIndex]?.focus();
}

function moveFocus(delta) {
  const next = (state.focusIndex + delta + state.focusables.length) % state.focusables.length;
  state.focusIndex = next;
  applyFocus();
}

document.addEventListener('keydown', (e) => {
  if (state.focusables.length === 0) return;
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault();
    moveFocus(-1);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault();
    moveFocus(1);
  } else if (e.key === 'Enter' || e.key === ' ') {
    if (state.focusables[state.focusIndex] === els.talkBtn) {
      e.preventDefault();
      handleTalkPress();
    }
  } else if (e.key === 'Escape' || e.key === 'Backspace') {
    state.focusIndex = 0;
    applyFocus();
  }
});

els.talkBtn.addEventListener('click', handleTalkPress);

function handleTalkPress() {
  if (!state.relay) {
    setStatus('not connected');
    return;
  }
  if (!state.recording) {
    startRecording();
  } else {
    stopRecordingAndSend();
  }
}

// Placeholder — Task 8 replaces this with Web Speech API.
let pendingTranscript = '';
function startRecording() {
  setRecording(true);
  pendingTranscript = '';
}
function stopRecordingAndSend() {
  setRecording(false);
  const text = (pendingTranscript || prompt('Speech disabled in placeholder — type your prompt:') || '').trim();
  if (!text) return;
  appendTurn('you', text);
  state.relay.send({ type: 'prompt', text });
}

// Boot.
(async () => {
  setStatus('initializing…');
  const paired = await consumeUrlPairing();
  if (!paired || paired.error) {
    showScreen('screen-not-paired');
    setStatus(paired?.error ?? 'not paired');
    return;
  }
  state.paired = paired;
  showScreen('screen-main');
  rebuildFocusables();

  state.relay = connect({
    paired,
    onStatus: setStatus,
    onMessage: (obj) => {
      if (obj.type === 'reply' && typeof obj.text === 'string') {
        appendTurn('claude', obj.text);
      }
    },
  });
})();
```

- [ ] **Step 2: Build**

```bash
npm run build -w packages/relay
```

- [ ] **Step 3: Local smoke test — render + pairing UI**

```bash
npm run dev:relay
```

Browse to `http://localhost:8787/`. Expected: the "Not paired" screen renders (no `?p=` in URL).

Now use the daemon to generate a real pairing URL. In another terminal:

```bash
node packages/mw-claude/dist/cli.js pair --relay-url ws://localhost:8787/api/ws
```

Open the printed URL in the same browser tab. Expected:
- The main screen appears (talk button + transcript).
- Status text reads "paired & encrypted" within ~1 second.
- The daemon prints "Paired! Config saved" and exits.

Stop `wrangler dev`.

- [ ] **Step 4: Commit**

```
git add packages/relay/glasses-app/app.js
git commit -m "feat(glasses-app): main app — pairing boot, D-pad nav, talk-button placeholder"
```

---

## Task 8: Web Speech API integration

**Files:**
- Modify: `packages/relay/glasses-app/app.js`

Replace the placeholder `startRecording` / `stopRecordingAndSend` with the Web Speech API. Keep a text-input fallback for environments where the API isn't available (Display device may or may not support it; laptop Chrome supports it; Firefox does not).

- [ ] **Step 1: Add Web Speech API integration**

In `app.js`, replace the placeholder section (everything from `// Placeholder — Task 8 replaces this with Web Speech API.` through the end of `stopRecordingAndSend`) with:

```js
// Web Speech API integration with fallback.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let interimText = '';
let finalText = '';

if (SR) {
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || 'en-US';

  recognition.onresult = (event) => {
    interimText = '';
    finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    els.talkBtnLabel.textContent = (finalText + interimText).trim() || 'Listening…';
  };

  recognition.onerror = (event) => {
    setStatus('speech error: ' + event.error);
    setRecording(false);
  };

  recognition.onend = () => {
    // Only fires when stop() is called or recognition ends spontaneously.
    if (state.recording) {
      // unexpected end — finalize what we have
      stopRecordingAndSend();
    }
  };
}

function startRecording() {
  finalText = '';
  interimText = '';
  setRecording(true);
  if (recognition) {
    try {
      recognition.start();
    } catch (err) {
      // some browsers throw if start() is called twice in a row
      setStatus('speech start error: ' + err.message);
      setRecording(false);
    }
  } else {
    // Fallback: prompt for typed input on this device.
    setRecording(false);
    const text = (prompt('Type your prompt (speech not supported here):') || '').trim();
    if (text) {
      appendTurn('you', text);
      state.relay.send({ type: 'prompt', text });
    }
  }
}

function stopRecordingAndSend() {
  if (!state.recording) return;
  setRecording(false);
  if (recognition) {
    try { recognition.stop(); } catch {}
  }
  const text = (finalText + interimText).trim();
  els.talkBtnLabel.textContent = 'Tap to talk';
  if (!text) return;
  appendTurn('you', text);
  state.relay.send({ type: 'prompt', text });
}
```

- [ ] **Step 2: Build**

```bash
npm run build -w packages/relay
```

- [ ] **Step 3: Local laptop smoke test**

```bash
npm run dev:relay
```

In a Chromium-based browser (Web Speech API is supported there), navigate to your paired URL. Grant microphone permission when prompted.

Manual checks:
1. Tap the talk button → status indicator changes to "Listening…", button pulses red.
2. Speak: "what's seven times six".
3. Tap again. The label briefly shows the recognized text, then it's appended to the transcript as `you: what's seven times six`, sent to the daemon, and a `claude: …` reply containing **42** appears.
4. Tap again, speak a different prompt, confirm another round-trip works.

If Web Speech is unavailable (e.g. Firefox), tapping the button triggers a `prompt()` for typed input. Verify that path works too.

Stop `wrangler dev` when done.

- [ ] **Step 4: Commit**

```
git add packages/relay/glasses-app/app.js
git commit -m "feat(glasses-app): web speech API talk button with typed-input fallback"
```

---

## Task 9: Production deploy

**Files:** none beyond a verification step.

- [ ] **Step 1: Deploy**

```bash
npm run deploy -w packages/relay
```

Capture the version ID from the output.

- [ ] **Step 2: Smoke check production page**

```bash
curl -s https://claude-display.brunofernandeslopes.workers.dev/ | grep -o 'Claude Display'
```

Expected: `Claude Display`.

- [ ] **Step 3: Verify static assets are present**

```bash
curl -sI https://claude-display.brunofernandeslopes.workers.dev/styles.css
curl -sI https://claude-display.brunofernandeslopes.workers.dev/app.js
curl -sI https://claude-display.brunofernandeslopes.workers.dev/vendor/nacl.min.js
```

Expected: 200 on all three.

- [ ] **Step 4: Verify WS still works**

Re-run the two-WS-client round-trip smoke from Plan 2 Task 4:

```bash
node -e "
const W = require('ws');
const ch = 'smoke-' + Date.now();
const URL = 'wss://claude-display.brunofernandeslopes.workers.dev/api/ws';
const d = new W(URL + '?channel=' + ch + '&role=daemon');
d.on('open', () => console.log('daemon open'));
d.on('message', m => { console.log('daemon recv:', m.toString()); process.exit(0); });
setTimeout(() => {
  const c = new W(URL + '?channel=' + ch + '&role=client');
  c.on('open', () => { console.log('client open'); c.send('ping'); });
}, 500);
setTimeout(() => { console.error('timed out'); process.exit(2); }, 10000);
"
```

Expected: `daemon recv: ping`.

- [ ] **Step 5: No commit** — deploy is a side effect.

---

## Task 10: End-to-end laptop browser test against production

**Files:** none.

- [ ] **Step 1: Clean slate**

On the PC:

```powershell
Remove-Item $env:USERPROFILE\.mw-claude\config.json -ErrorAction SilentlyContinue
```

In your browser DevTools console (any browser, but Chromium for Web Speech):

```js
localStorage.removeItem('claude-display.paired.v1'); location.reload();
```

The page should now show "Not paired".

- [ ] **Step 2: Pair against production**

```powershell
cd B:\Projects\ClaudeDisplay
node packages/mw-claude/dist/cli.js pair --relay-url wss://claude-display.brunofernandeslopes.workers.dev/api/ws
```

Open the printed URL in your browser. After ~1s the page should show the talk button and "paired & encrypted". Terminal prints "Paired!" and exits.

- [ ] **Step 3: Run daemon**

```powershell
node packages/mw-claude/dist/cli.js run
```

TUI appears, stderr says `relay connected`.

- [ ] **Step 4: Round-trip via speech**

In the browser, tap the talk button, speak "what's seven times six", tap again. Verify the transcript area shows your prompt and Claude's reply (containing 42).

- [ ] **Step 5: Verify reconnect**

Stop the daemon (Ctrl+C in the TUI terminal). The browser should show "daemon disconnected — waiting".

Restart the daemon (`node packages/mw-claude/dist/cli.js run`). The next prompt you send should succeed; the status should self-correct to "paired & encrypted" once a reply round-trips.

- [ ] **Step 6: No commit** — verification only.

If any step fails, report the specific terminal output and what the browser showed.

---

## Task 11: On-device test (Meta Display Glasses via ADB)

**Files:** none.

The Meta Wearables Display companion app is the canonical way to deploy webapps to the glasses. The user opens the companion app on their phone, adds a custom webapp URL, and the glasses load it.

Alternatively, with ADB access we may be able to push a URL directly to the Display browser. The exact mechanism depends on the Display's developer mode capabilities — consult `meta-wearables-webapp:test-on-device` skill if needed.

- [ ] **Step 1: Pair from the glasses**

Run `mw-claude pair --relay-url wss://claude-display.brunofernandeslopes.workers.dev/api/ws` on the PC.

Take the printed URL (the long `https://…/?p=<base64>` one) and paste it into the Meta Display companion app as a custom webapp URL. The glasses should load the page, auto-pair, and persist state.

Confirm on the PC: the daemon prints "Paired! Config saved" and exits.

- [ ] **Step 2: Run daemon, talk to it from the glasses**

`node packages/mw-claude/dist/cli.js run` on the PC.

On the glasses, the webapp should already be open. Use the EMG band / D-pad to focus the talk button (it should be focused by default). Tap to start recording, speak a prompt, tap to stop.

Verify:
- The status line on the glasses updates to "Listening…", then "paired & encrypted".
- The prompt arrives in the PC's Claude TUI.
- Claude's reply appears in the transcript on the glasses display.

If Web Speech API is **unavailable** on the Display browser: this becomes a known v1 limitation, and the typed-input fallback isn't usable on the glasses (no keyboard). We'll address it in Plan 4 by adding a Whisper API path (audio recorded on the glasses → encrypted upload to relay → Whisper-on-Workers-AI → returned transcript → existing prompt flow).

If Web Speech API IS available, this is the moment of truth — the entire product works end-to-end on real Display hardware.

- [ ] **Step 3: Report results**

Document:
- Whether the pairing flow worked on the glasses (companion app accepted the URL, page loaded, paired).
- Whether the D-pad / EMG band can focus and activate the talk button.
- Whether Web Speech API is supported on this Display browser version.
- Whether a round-trip prompt → reply succeeded.

- [ ] **Step 4: No commit** — verification.

---

## Task 12: README update

**Files:**
- Modify: `packages/mw-claude/README.md`
- Create: `packages/relay/README.md`

- [ ] **Step 1: Append to `packages/mw-claude/README.md`**

Replace the line `The browser test client at the relay URL is a dev surface; the real glasses webapp lands in Plan 3.` with:

```markdown
The companion webapp at the relay URL is built for Meta Display Glasses
(600×600 viewport, D-pad / EMG input, tap-to-talk via Web Speech API),
and also works in any modern browser for laptop testing.
```

- [ ] **Step 2: Create `packages/relay/README.md`**

```markdown
# relay

Cloudflare Worker that hosts:
- The Claude Display companion webapp at `/` (vanilla HTML/CSS/JS, targets
  Meta Display Glasses but works in any modern browser).
- The WebSocket relay at `/api/ws`, routing through a per-channel
  Durable Object.

## Deploy

    npm install                    # from repo root
    npm run deploy -w packages/relay

Builds `glasses-app/` → `dist/`, then `wrangler deploy` uploads both the
static assets (via the `ASSETS` binding) and the Worker bundle (which
exports the `Channel` DO class).

## Layout

- `src/worker.ts` — entry; routes `/api/ws` to `Channel` DO via
  `idFromName(channel)`, falls through to Workers Assets otherwise.
- `src/channel-do.ts` — Hibernatable WebSocket DO that pipes frames
  between roles `client` and `daemon`.
- `glasses-app/` — static webapp (vanilla JS modules + vendored TweetNaCl).
- `scripts/build.mjs` — copies `glasses-app/` → `dist/`.

## Local dev

    npm run dev:relay

`wrangler dev` serves both the Worker and the static assets on
`http://localhost:8787`.
```

- [ ] **Step 3: Commit**

```
git add packages/mw-claude/README.md packages/relay/README.md
git commit -m "docs: plan 3 webapp and relay package README"
```

---

## Acceptance criteria for Plan 3

1. `npm run deploy -w packages/relay` ships the vanilla glasses webapp to Cloudflare and the WS relay still passes the two-client round-trip smoke.
2. Opening the pairing URL in any browser shows the Display-style UI: black background, status strip, talk button focused, transcript area below.
3. Web Speech API path works: tap → speak → tap → prompt is sent encrypted → daemon transcribes it as a Claude turn → Claude's reply lands in the browser transcript.
4. Typed-input fallback works in browsers without Web Speech support (verified in e.g. Firefox).
5. D-pad navigation: Up/Down toggles focus between talk button and transcript. Enter activates the talk button. Escape returns focus to talk button.
6. State persists: refreshing the browser keeps the pairing in `localStorage`; tapping "unpair" (via DevTools console for now) and reloading shows "Not paired".
7. The webapp loads on actual Meta Display Glasses hardware (Task 11) — at minimum the UI renders correctly and the pairing flow completes. Web Speech availability on the Display browser is a known unknown; if it fails, Plan 4 picks it up.
8. `npm test --workspaces` still passes (mw-claude 14 + relay 0 = 14).

---

## Risks

1. **Web Speech API on Meta Display browser** — unknown availability. Mitigation: Plan 4 will add a Whisper-on-Workers-AI path that records audio on the glasses, ships it E2E-encrypted to the daemon-via-relay, and gets a transcript back. For Plan 3, we accept this as a known unknown.
2. **D-pad / EMG mapping to keyboard events** — the Meta Wearables platform translates D-pad gestures to arrow keys + Enter + Escape. If the actual key codes differ from our handlers, Task 11 surfaces it and we adjust.
3. **TweetNaCl + libsodium interop** — daemon uses libsodium's `crypto_box_easy`, glasses use TweetNaCl `box`. Both implement X25519 + XSalsa20-Poly1305 with the same wire format (nonce ‖ ciphertext), so interop should be byte-perfect. Task 4 Step 4 verifies this explicitly before we depend on it.
4. **Companion app URL persistence** — when the companion app stores the long `?p=` URL, every glasses reload re-applies that pairing. `pairing.js` handles this idempotently (same `channel_id` = no-op), so it's not a bug, just a UX wart.

## Self-review notes

- **Spec coverage:** Plan 3 covers spec §5.1 (glasses webapp — voice in / text out, transcript view). Spec §5.1 *session picker* deferred (Plan 4 or later). Spec §7 *Whisper fallback* deferred (Plan 4 — same place as the Workers AI integration).
- **No placeholders:** all code blocks are complete. Task 11's on-device test references the platform skill `meta-wearables-webapp:test-on-device` as a fallback, but the primary path (companion app URL paste) doesn't require it.
- **Type consistency:** PairedState shape in `pairing.js` matches what `relay-ws.js` consumes (same field names: `channelId`, `daemonPub`, `relayUrl`, `clientPub`, `clientPriv`). Frame types (`hello`, `hello_ack`, `msg`, `peer_disconnect`) unchanged from Plan 2.
- **Decommissioning:** Plan 2's React SPA is removed in Task 2. The pairing UX is unchanged from the user's perspective — same `?p=` URL, same flow.
- **Open question parked:** Whisper fallback path lives in Plan 4. The "session picker" UI from the original spec is also deferred.
