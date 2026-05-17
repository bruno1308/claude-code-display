# Plan 1 — PTY Spike + Minimal Local Loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove `node-pty` can drive an interactive Claude Code session on Windows, then ship a localhost-only browser-to-Claude bridge so you can type prompts in a browser tab and see Claude's replies — all running on the same Windows PC, no relay, no glasses, no encryption.

**Architecture:** A single Node CLI (`mw-claude`) spawns `claude` under a Windows ConPTY via `node-pty`, mirrors the PTY to the user's terminal in both directions, runs an embedded HTTP+WebSocket server on `localhost`, and serves a tiny static HTML page that lets you type a prompt, ship it through the WS into the child PTY's stdin, and stream sanitized assistant text back.

**Tech Stack:** Node.js 24 LTS, TypeScript, `node-pty` (Microsoft official, N-API based, ships Windows prebuilts), `ws` (WebSocket server), `ansi-regex`, `vitest` for tests, `tsx` for dev runs.

**Prerequisite:** Claude Code (`claude`) is installed and signed in on the PC. Test by running `claude` in a terminal manually — you should land in the interactive TUI.

---

## File Structure

```
B:\Projects\ClaudeDisplay\
├── package.json                       # root package, npm workspaces
├── tsconfig.base.json                 # shared TS config
├── .gitignore
├── packages\
│   └── mw-claude\
│       ├── package.json
│       ├── tsconfig.json
│       ├── bin\mw-claude.js           # tiny shim that imports compiled CLI
│       ├── src\
│       │   ├── cli.ts                 # entry: arg parsing, lifecycle
│       │   ├── pty-session.ts         # PTY spawn + bidirectional mirror
│       │   ├── output-parser.ts       # ANSI strip + reply segmenter
│       │   ├── local-server.ts        # HTTP + WS on 127.0.0.1
│       │   └── static\
│       │       └── index.html         # debug browser UI
│       └── tests\
│           ├── output-parser.test.ts
│           └── fixtures\
│               └── sample-claude-output.txt
└── docs\superpowers\
    ├── specs\2026-05-17-mw-claude-glasses-design.md   (exists)
    └── plans\2026-05-17-plan-1-pty-spike-and-local-loop.md   (this file)
```

**File responsibilities:**
- `cli.ts` — orchestrates: parses args, starts `pty-session`, starts `local-server`, wires events, handles SIGINT.
- `pty-session.ts` — owns the child PTY. Exposes `write(text)`, `onData(cb)`, `kill()`. Mirrors stdin/stdout to the parent process so the user's terminal still feels like normal Claude Code.
- `output-parser.ts` — pure functions: `stripAnsi(s)`, `segmentReplies(stream)`. Unit-tested against recorded fixtures.
- `local-server.ts` — Express-free; uses Node `http` + `ws`. Serves `static/index.html` on `/`, accepts WS on `/ws`. Forwards browser → PTY and PTY → browser.

---

## Task 1: Repo bootstrap

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.nvmrc`

- [ ] **Step 1: Initialize git repo**

```bash
git init
git branch -m main
```

- [ ] **Step 2: Create `.gitignore`**

Write to `.gitignore`:

```
node_modules/
dist/
*.log
.env
.env.*
!.env.example
.DS_Store
Thumbs.db
```

- [ ] **Step 3: Create `.nvmrc`**

Write to `.nvmrc`:

```
24
```

- [ ] **Step 4: Create root `package.json` with npm workspaces**

Write to `package.json`:

```json
{
  "name": "claude-display",
  "private": true,
  "version": "0.0.0",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "dev:mw-claude": "npm run dev -w packages/mw-claude"
  }
}
```

- [ ] **Step 5: Create `tsconfig.base.json`**

Write to `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: initialize repo with npm workspaces"
```

---

## Task 2: `mw-claude` package skeleton

**Files:**
- Create: `packages/mw-claude/package.json`
- Create: `packages/mw-claude/tsconfig.json`
- Create: `packages/mw-claude/src/cli.ts`
- Create: `packages/mw-claude/bin/mw-claude.js`

- [ ] **Step 1: Write package.json**

Write to `packages/mw-claude/package.json`:

```json
{
  "name": "mw-claude",
  "version": "0.0.0",
  "type": "module",
  "bin": { "mw-claude": "./bin/mw-claude.js" },
  "main": "./dist/cli.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/cli.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "node-pty": "^0.11.14",
    "ansi-regex": "^6.1.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

Write to `packages/mw-claude/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write bin shim**

Write to `packages/mw-claude/bin/mw-claude.js`:

```js
#!/usr/bin/env node
import('../dist/cli.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Write placeholder `cli.ts`**

Write to `packages/mw-claude/src/cli.ts`:

```ts
console.log('mw-claude — coming online');
```

- [ ] **Step 5: Install deps and verify build**

```bash
npm install
npm run build -w packages/mw-claude
```

Expected: completes without errors. `packages/mw-claude/dist/cli.js` exists.

- [ ] **Step 6: Run via tsx**

```bash
npm run dev -w packages/mw-claude
```

Expected output: `mw-claude — coming online`

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat(mw-claude): scaffold package with tsx + vitest"
```

---

## Task 3: PTY validation spike (the de-risking moment)

**Files:**
- Modify: `packages/mw-claude/src/cli.ts`

**Goal of this task:** confirm `node-pty` can spawn `claude` interactively on Windows, you see the TUI in your own terminal, you can type and use it normally, AND we can programmatically inject a prompt from code. If this fails we stop and reconsider transport before writing anything else.

- [ ] **Step 1: Rewrite `cli.ts` to spawn claude in a PTY and mirror it**

Replace entire contents of `packages/mw-claude/src/cli.ts`:

```ts
import * as pty from 'node-pty';
import process from 'node:process';

const shell = process.platform === 'win32' ? 'claude.cmd' : 'claude';

const child = pty.spawn(shell, [], {
  name: 'xterm-256color',
  cols: process.stdout.columns ?? 120,
  rows: process.stdout.rows ?? 30,
  cwd: process.cwd(),
  env: process.env as Record<string, string>,
});

// child -> parent terminal
child.onData((data) => {
  process.stdout.write(data);
});

// parent terminal -> child
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.on('data', (chunk) => {
  child.write(chunk.toString());
});

// resize forwarding
process.stdout.on('resize', () => {
  child.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 30);
});

child.onExit(({ exitCode }) => {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(exitCode ?? 0);
});

// SPIKE: after 10 seconds, programmatically inject a prompt
setTimeout(() => {
  console.error('\n[mw-claude spike] injecting test prompt in 1s...\n');
  setTimeout(() => {
    child.write('say hello in five words\r');
  }, 1000);
}, 10000);
```

- [ ] **Step 2: Run it manually and exercise the TUI**

```bash
npm run dev -w packages/mw-claude
```

Manual checks (do them all — this is the spike):
1. The Claude Code TUI banner appears.
2. You can type a prompt normally with your keyboard, press Enter, get a response.
3. Arrow keys, Ctrl+C handling, resize all behave like running `claude` directly.
4. After ~11 seconds the injected prompt `say hello in five words` appears and Claude responds.
5. Exit `claude` cleanly (`/exit`). The wrapper exits with code 0.

**If any of those fail:** stop here. File the failure mode (with screen recording / log capture) and revisit the design — likely fallback to tmux/Windows Terminal mode.

**If all pass:** the technical core of the entire project is de-risked.

- [ ] **Step 3: Remove the test injection, keep the mirror code**

Edit `packages/mw-claude/src/cli.ts` — delete the two `setTimeout` blocks at the bottom (everything from `// SPIKE: after 10 seconds...` through the closing `}, 10000);`).

- [ ] **Step 4: Verify it still works as a transparent wrapper**

```bash
npm run dev -w packages/mw-claude
```

Run `claude` normally. Exit cleanly. Should be indistinguishable from running `claude` directly.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(mw-claude): PTY spike — wrap claude in node-pty on Windows"
```

---

## Task 4: Extract `PtySession` module

**Files:**
- Create: `packages/mw-claude/src/pty-session.ts`
- Modify: `packages/mw-claude/src/cli.ts`

- [ ] **Step 1: Write `pty-session.ts`**

Write to `packages/mw-claude/src/pty-session.ts`:

```ts
import * as pty from 'node-pty';
import { EventEmitter } from 'node:events';

export interface PtySessionEvents {
  data: (chunk: string) => void;
  exit: (code: number) => void;
}

export class PtySession extends EventEmitter {
  private child: pty.IPty;

  constructor(opts: { cwd?: string; cols?: number; rows?: number }) {
    super();
    const shell = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    this.child = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      cwd: opts.cwd ?? process.cwd(),
      env: process.env as Record<string, string>,
    });
    this.child.onData((data) => this.emit('data', data));
    this.child.onExit(({ exitCode }) => this.emit('exit', exitCode ?? 0));
  }

  write(text: string): void {
    this.child.write(text);
  }

  resize(cols: number, rows: number): void {
    this.child.resize(cols, rows);
  }

  kill(): void {
    this.child.kill();
  }
}
```

- [ ] **Step 2: Rewrite `cli.ts` to use `PtySession`**

Replace entire contents of `packages/mw-claude/src/cli.ts`:

```ts
import process from 'node:process';
import { PtySession } from './pty-session.js';

const session = new PtySession({
  cwd: process.cwd(),
  cols: process.stdout.columns,
  rows: process.stdout.rows,
});

session.on('data', (chunk: string) => process.stdout.write(chunk));

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => session.write(chunk.toString()));
process.stdout.on('resize', () =>
  session.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 30),
);

session.on('exit', (code: number) => {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(code);
});
```

- [ ] **Step 3: Verify the wrapper still works**

```bash
npm run dev -w packages/mw-claude
```

Use Claude normally, exit cleanly.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "refactor(mw-claude): extract PtySession module"
```

---

## Task 5: `output-parser.ts` — `stripAnsi` (TDD)

**Files:**
- Create: `packages/mw-claude/src/output-parser.ts`
- Create: `packages/mw-claude/tests/output-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Write to `packages/mw-claude/tests/output-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stripAnsi } from '../src/output-parser.js';

describe('stripAnsi', () => {
  it('removes SGR color codes', () => {
    expect(stripAnsi('[31mhello[0m world')).toBe('hello world');
  });

  it('removes cursor movement sequences', () => {
    expect(stripAnsi('foo[2Kbar[1Abaz')).toBe('foobarbaz');
  });

  it('passes through plain text unchanged', () => {
    expect(stripAnsi('plain text\nwith newlines')).toBe('plain text\nwith newlines');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -w packages/mw-claude
```

Expected: FAIL — `stripAnsi` is not defined / module not found.

- [ ] **Step 3: Implement `stripAnsi`**

Write to `packages/mw-claude/src/output-parser.ts`:

```ts
import ansiRegex from 'ansi-regex';

export function stripAnsi(input: string): string {
  return input.replace(ansiRegex(), '');
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -w packages/mw-claude
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(mw-claude): stripAnsi helper with tests"
```

---

## Task 6: Capture a real claude-output fixture for the reply segmenter

**Files:**
- Modify: `packages/mw-claude/src/cli.ts` (temporary capture mode)
- Create: `packages/mw-claude/tests/fixtures/sample-claude-output.txt`

**Why:** the reply segmenter is a heuristic. We cannot write the right heuristic without seeing real bytes. We add a temporary `--capture <path>` flag, run one real conversation, save it as a fixture, then revert the flag.

- [ ] **Step 1: Add temporary capture flag**

Edit `packages/mw-claude/src/cli.ts`. Replace the entire file with:

```ts
import process from 'node:process';
import fs from 'node:fs';
import { PtySession } from './pty-session.js';

const captureArgIndex = process.argv.indexOf('--capture');
const capturePath = captureArgIndex >= 0 ? process.argv[captureArgIndex + 1] : null;
const captureStream = capturePath ? fs.createWriteStream(capturePath) : null;

const session = new PtySession({
  cwd: process.cwd(),
  cols: process.stdout.columns,
  rows: process.stdout.rows,
});

session.on('data', (chunk: string) => {
  process.stdout.write(chunk);
  captureStream?.write(chunk);
});

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => session.write(chunk.toString()));
process.stdout.on('resize', () =>
  session.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 30),
);

session.on('exit', (code: number) => {
  captureStream?.end();
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(code);
});
```

- [ ] **Step 2: Run a capture session**

```bash
npm run dev -w packages/mw-claude -- --capture packages/mw-claude/tests/fixtures/sample-claude-output.txt
```

Inside the captured Claude session, do exactly this conversation so the fixture has predictable structure:

1. Type: `say hello in exactly five words`  → press Enter, wait for reply.
2. Type: `what is 2 plus 2`  → press Enter, wait for reply.
3. Type: `/exit`  → press Enter to exit.

Verify the fixture file now exists and is non-empty:

```bash
node -e "console.log(require('node:fs').statSync('packages/mw-claude/tests/fixtures/sample-claude-output.txt').size)"
```

Expected: a number greater than 1000.

- [ ] **Step 3: Revert the capture flag (cli.ts will be rewritten again in Task 8)**

Leave `cli.ts` as-is for now — we'll rewrite it in Task 8. The fixture is what matters.

- [ ] **Step 4: Commit the fixture**

```bash
git add packages/mw-claude/tests/fixtures/sample-claude-output.txt packages/mw-claude/src/cli.ts
git commit -m "test(mw-claude): capture real claude TUI output fixture"
```

---

## Task 7: `output-parser.ts` — `segmentReplies` (TDD against the fixture)

**Files:**
- Modify: `packages/mw-claude/src/output-parser.ts`
- Modify: `packages/mw-claude/tests/output-parser.test.ts`

**Approach:** the reply segmenter is a streaming state machine. We feed it raw PTY chunks and it emits `{ kind: 'reply', text }` events when it believes a full assistant reply has been delivered. Heuristic for v1:

1. Strip ANSI from each chunk.
2. Maintain a rolling line buffer.
3. Look for a "fresh user input prompt redraw" pattern. In current Claude Code, the input box renders as a bordered line that starts with `╭─` and contains `>`. When we see the bordered prompt reappear *after* having accumulated non-prompt content, we treat the accumulated content as one assistant reply and flush.
4. Within accumulated content, drop lines that are entirely Claude Code chrome (border characters `╭ ╮ ╰ ╯ │ ─`, lines starting with `?` for tips, lines matching common status prefixes).
5. Trim leading/trailing blank lines from the flushed reply.

If the fixture's chrome differs from what's described above (Claude Code's TUI evolves), the implementer adjusts the regex constants in `CHROME_PATTERNS` and `PROMPT_PATTERN` below to match what's actually in the fixture. The test asserts only the *content* lines, so adapting chrome detection won't break the assertion structure.

- [ ] **Step 1: Add failing tests for the segmenter**

Append to `packages/mw-claude/tests/output-parser.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { segmentReplies } from '../src/output-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'sample-claude-output.txt'),
  'utf8',
);

describe('segmentReplies', () => {
  it('emits two replies for the two-prompt fixture conversation', () => {
    const replies: string[] = [];
    const seg = segmentReplies((r) => replies.push(r));
    // Feed in 256-byte chunks to mimic streaming.
    for (let i = 0; i < fixture.length; i += 256) {
      seg.feed(fixture.slice(i, i + 256));
    }
    seg.flush();
    expect(replies.length).toBe(2);
  });

  it('first reply contains a five-word greeting', () => {
    const replies: string[] = [];
    const seg = segmentReplies((r) => replies.push(r));
    seg.feed(fixture);
    seg.flush();
    // "say hello in exactly five words" — the reply should contain 5 words on its content line.
    // We assert loosely: reply is non-empty and shorter than 200 chars (greeting, not a paragraph).
    expect(replies[0].trim().length).toBeGreaterThan(0);
    expect(replies[0].trim().length).toBeLessThan(200);
  });

  it('second reply contains the digit 4', () => {
    const replies: string[] = [];
    const seg = segmentReplies((r) => replies.push(r));
    seg.feed(fixture);
    seg.flush();
    expect(replies[1]).toMatch(/4/);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npm test -w packages/mw-claude
```

Expected: 3 failing (segmentReplies missing).

- [ ] **Step 3: Implement `segmentReplies`**

Append to `packages/mw-claude/src/output-parser.ts`:

```ts
const PROMPT_PATTERN = /╭[─]+╮[\s\S]*?│\s*>/; // bordered input box redraw
const CHROME_PATTERNS: RegExp[] = [
  /^[╭╮╰╯│─\s]+$/,           // pure border lines
  /^\s*\?\s+for shortcuts/i, // hint line
  /^\s*[⏵⏴⏸▶◀]/,             // status arrows / spinners
];

function isChromeLine(line: string): boolean {
  if (line.trim() === '') return false;
  return CHROME_PATTERNS.some((re) => re.test(line));
}

function cleanReply(buf: string): string {
  return buf
    .split('\n')
    .filter((l) => !isChromeLine(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface Segmenter {
  feed(chunk: string): void;
  flush(): void;
}

export function segmentReplies(onReply: (text: string) => void): Segmenter {
  let buffer = '';
  let sawContentSincePrompt = false;
  let promptSeenOnce = false;

  return {
    feed(chunk: string) {
      const clean = stripAnsi(chunk);
      buffer += clean;

      // Try to find a prompt redraw in the buffer.
      let match: RegExpExecArray | null;
      while ((match = PROMPT_PATTERN.exec(buffer)) !== null) {
        const before = buffer.slice(0, match.index);
        if (promptSeenOnce && sawContentSincePrompt) {
          const reply = cleanReply(before);
          if (reply.length > 0) onReply(reply);
        }
        buffer = buffer.slice(match.index + match[0].length);
        promptSeenOnce = true;
        sawContentSincePrompt = false;
      }
      if (buffer.replace(/[╭╮╰╯│─\s]/g, '').length > 0) {
        sawContentSincePrompt = true;
      }
    },
    flush() {
      if (promptSeenOnce && sawContentSincePrompt) {
        const reply = cleanReply(buffer);
        if (reply.length > 0) onReply(reply);
      }
      buffer = '';
      sawContentSincePrompt = false;
    },
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -w packages/mw-claude
```

Expected: 7 passing. If the segmenter tests fail because Claude Code's chrome doesn't match the patterns above, inspect the fixture (`packages/mw-claude/tests/fixtures/sample-claude-output.txt`) to find the actual prompt-redraw pattern and chrome-line shape, then update `PROMPT_PATTERN` / `CHROME_PATTERNS` to match. The fixture is the ground truth.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(mw-claude): reply segmenter with fixture-based tests"
```

---

## Task 8: `local-server.ts` — HTTP + WS on 127.0.0.1

**Files:**
- Create: `packages/mw-claude/src/local-server.ts`
- Create: `packages/mw-claude/src/static/index.html`
- Modify: `packages/mw-claude/src/cli.ts`

- [ ] **Step 1: Write the local server**

Write to `packages/mw-claude/src/local-server.ts`:

```ts
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
```

- [ ] **Step 2: Write the debug HTML page**

Write to `packages/mw-claude/src/static/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>mw-claude local</title>
  <style>
    body { font-family: ui-monospace, monospace; max-width: 900px; margin: 2rem auto; padding: 0 1rem; background:#0b0d10; color:#e7e7e7; }
    #log { white-space: pre-wrap; border:1px solid #2a2f36; padding:1rem; border-radius:8px; min-height:300px; max-height:60vh; overflow:auto; background:#10141a; }
    .turn-user { color:#9ad0ff; margin-top:1rem; }
    .turn-claude { color:#e7e7e7; margin-top:0.5rem; }
    #form { display:flex; gap:0.5rem; margin-top:1rem; }
    #prompt { flex:1; padding:0.6rem; border-radius:6px; border:1px solid #2a2f36; background:#10141a; color:#e7e7e7; font-family:inherit; }
    button { padding:0.6rem 1rem; border-radius:6px; border:0; background:#3a7afe; color:white; cursor:pointer; }
    #status { font-size:0.85rem; color:#7a8597; margin-bottom:0.5rem; }
  </style>
</head>
<body>
  <h1>mw-claude</h1>
  <div id="status">connecting…</div>
  <div id="log"></div>
  <form id="form">
    <input id="prompt" autocomplete="off" placeholder="Type a prompt for Claude Code…" autofocus />
    <button type="submit">Send</button>
  </form>
  <script>
    const log = document.getElementById('log');
    const status = document.getElementById('status');
    const form = document.getElementById('form');
    const input = document.getElementById('prompt');

    function append(cls, text) {
      const div = document.createElement('div');
      div.className = cls;
      div.textContent = text;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }

    const ws = new WebSocket('ws://' + location.host + '/ws');
    ws.onopen = () => { status.textContent = 'connected'; };
    ws.onclose = () => { status.textContent = 'disconnected — refresh to reconnect'; };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'reply') append('turn-claude', 'claude: ' + msg.text);
      } catch {}
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'prompt', text }));
      append('turn-user', 'you: ' + text);
      input.value = '';
    });
  </script>
</body>
</html>
```

- [ ] **Step 3: Configure TypeScript to copy static assets at build**

Edit `packages/mw-claude/package.json`. Replace the `"scripts"` block with:

```json
  "scripts": {
    "build": "tsc -p tsconfig.json && node -e \"require('node:fs').cpSync('src/static','dist/static',{recursive:true})\"",
    "dev": "tsx src/cli.ts",
    "test": "vitest run"
  },
```

- [ ] **Step 4: Wire everything together in `cli.ts`**

Replace entire contents of `packages/mw-claude/src/cli.ts`:

```ts
import process from 'node:process';
import { PtySession } from './pty-session.js';
import { LocalServer } from './local-server.js';
import { segmentReplies } from './output-parser.js';

const PORT = Number(process.env.MW_CLAUDE_PORT ?? 7878);

const session = new PtySession({
  cwd: process.cwd(),
  cols: process.stdout.columns,
  rows: process.stdout.rows,
});

const server = new LocalServer(PORT);

const segmenter = segmentReplies((text) => server.sendReply(text));

session.on('data', (chunk: string) => {
  process.stdout.write(chunk);
  segmenter.feed(chunk);
});

server.on('prompt', (text: string) => {
  session.write(text + '\r');
});

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => session.write(chunk.toString()));
process.stdout.on('resize', () =>
  session.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 30),
);

session.on('exit', (code: number) => {
  segmenter.flush();
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(code);
});

server.start().then(() => {
  process.stderr.write(`[mw-claude] local UI on http://127.0.0.1:${PORT}\n`);
});
```

- [ ] **Step 5: Build and end-to-end test**

```bash
npm run build -w packages/mw-claude
```

Expected: no errors. Then run:

```bash
npm run dev -w packages/mw-claude
```

Wait for the `[mw-claude] local UI on http://127.0.0.1:7878` line. Open that URL in a browser. Verify the browser status reads "connected".

Then exercise the loop manually:
1. In the **browser**: type `what's 7 times 6` and click Send. Confirm the prompt also appears typed into the terminal where `mw-claude` is running, Claude replies, and the browser receives a `claude: …` line containing `42`.
2. In the **terminal** (the wrapped claude TUI): type `what's the capital of France` and press Enter. Confirm the browser also receives the reply.
3. Type `/exit` in the terminal; the wrapper exits cleanly.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(mw-claude): local HTTP + WS bridge with browser UI"
```

---

## Task 9: Add reconnect-tolerance to the browser client

**Files:**
- Modify: `packages/mw-claude/src/static/index.html`

**Why:** when we lift this to Vercel in Plan 2, the server may close WS due to function execution windows; clients must reconnect. Bake this in now.

- [ ] **Step 1: Replace the inline `<script>` in `index.html`**

In `packages/mw-claude/src/static/index.html`, replace everything from `<script>` to `</script>` with:

```html
  <script>
    const log = document.getElementById('log');
    const status = document.getElementById('status');
    const form = document.getElementById('form');
    const input = document.getElementById('prompt');

    function append(cls, text) {
      const div = document.createElement('div');
      div.className = cls;
      div.textContent = text;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }

    let ws;
    let backoff = 500;

    function connect() {
      ws = new WebSocket('ws://' + location.host + '/ws');
      ws.onopen = () => { status.textContent = 'connected'; backoff = 500; };
      ws.onclose = () => {
        status.textContent = 'disconnected — reconnecting in ' + Math.round(backoff/1000) + 's';
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 10000);
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'reply') append('turn-claude', 'claude: ' + msg.text);
        } catch {}
      };
    }
    connect();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'prompt', text }));
      append('turn-user', 'you: ' + text);
      input.value = '';
    });
  </script>
```

- [ ] **Step 2: Verify reconnect works**

```bash
npm run dev -w packages/mw-claude
```

Open the browser at `http://127.0.0.1:7878`. Confirm status reads "connected." Now stop `mw-claude` with Ctrl+C in the terminal. The browser should immediately show "disconnected — reconnecting in 1s" and the backoff number should grow (1s → 2s → 4s → 8s → capped at 10s). Restart `mw-claude` in the terminal. The browser should reconnect within 10 seconds and status returns to "connected."

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat(mw-claude): reconnect-tolerant browser client with backoff"
```

---

## Task 10: README for Plan 1 deliverable

**Files:**
- Create: `packages/mw-claude/README.md`

- [ ] **Step 1: Write README**

Write to `packages/mw-claude/README.md`:

```markdown
# mw-claude (local v0)

Wraps an interactive Claude Code session in a Node PTY and exposes a tiny local
browser UI for typing prompts into the same session.

## Status

Plan 1 deliverable: localhost-only, no auth, no encryption. The browser UI is
a development convenience that will be replaced by Meta Display glasses in
later plans.

## Requirements

- Windows 10/11 (validated). macOS/Linux likely work but unsupported here.
- Node.js 24+
- Claude Code (`claude`) installed and signed in. Verify by running `claude`
  in a terminal — you should land in the interactive TUI.

## Run

From the repo root:

    npm install
    npm run dev:mw-claude

Then open http://127.0.0.1:7878 in any browser on the same machine. Type a
prompt in the browser and watch it appear in the terminal where `mw-claude`
is running. Claude's replies stream back to the browser.

Exit by typing `/exit` in the terminal (the wrapped Claude session) or
pressing Ctrl+C.

## Configuration

- `MW_CLAUDE_PORT` — port for the local UI (default `7878`).

## Known limits

- Reply segmenter is heuristic; some chrome lines may slip through or
  fragments may be split across replies. Inspect
  `tests/fixtures/sample-claude-output.txt` to see what the parser sees.
- WS server is bound to `127.0.0.1` — other devices on your LAN cannot
  reach it. That's intentional for Plan 1.
```

- [ ] **Step 2: Commit**

```bash
git add .
git commit -m "docs(mw-claude): README for local v0"
```

---

## Acceptance criteria for Plan 1

All of the following must hold:

1. `npm install && npm run dev:mw-claude` from a clean checkout on a Windows machine launches a wrapped Claude Code session with full TUI fidelity.
2. The terminal running `mw-claude` behaves indistinguishably from running `claude` directly (typing, history, exit, resize all work).
3. Opening `http://127.0.0.1:7878` in a browser shows a connected status.
4. A prompt typed in the browser arrives at the wrapped Claude session and produces a reply that is shown in the browser within a few seconds.
5. A prompt typed in the terminal also produces a reply visible in the browser.
6. `npm test -w packages/mw-claude` passes (7 tests across `stripAnsi` and `segmentReplies`).
7. Stopping `mw-claude` causes the browser to enter reconnecting state; restarting it reconnects within 10 seconds.

If all 7 hold, the technical risk for the entire Claude Display project is retired and Plan 2 can begin.

---

## Self-review notes

- **Spec coverage:** Plan 1 covers spec §5.3 (PTY-proxy wrapper), §8 (output parsing — first cut), §10 testing (PTY validation spike), §11 risk #1 (Windows PTY) and #2 (TUI parsing). Spec §5.1 (glasses webapp), §5.2 (relay), §7 (pairing + encryption) intentionally deferred to Plans 2–4.
- **No placeholders:** all code blocks complete, no "TBD".
- **Type consistency:** `PtySession.write`, `LocalServer.sendReply`, `segmentReplies` signatures consistent across tasks 4, 7, 8.
- **Test fixture caveat:** Task 7's segmenter regexes may need to be tuned to the captured fixture from Task 6. The plan calls this out explicitly — the implementer is told to adjust `PROMPT_PATTERN` / `CHROME_PATTERNS` to match the fixture if the default values don't.
