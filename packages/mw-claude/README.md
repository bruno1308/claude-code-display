# mw-claude

Wraps an interactive Claude Code session in a Node PTY and bridges it to a
browser (or, in later plans, Meta Display glasses) over an end-to-end
encrypted Cloudflare relay.

## Status

Plan 2 deliverable. Pairing + E2E encryption over the public internet works.
The browser test client at the relay URL is a dev surface; the real glasses
webapp lands in Plan 3.

## Requirements

- Windows 10/11 (validated). macOS/Linux likely work but unsupported here.
- Node.js 24+.
- Claude Code (`claude.exe`) installed and reachable via PATH.
- A deployed relay (see `packages/relay`). Public deploy lives at
  `https://claude-display.brunofernandeslopes.workers.dev`.

## First-time setup

From the repo root:

    npm install
    npm run build -w packages/mw-claude

## Pair the daemon with a browser

In your PC terminal, run:

    node packages/mw-claude/dist/cli.js pair --relay-url wss://claude-display.brunofernandeslopes.workers.dev/api/ws

This prints a QR code and a copy-paste URL. Scan the QR with your phone or
open the URL in any browser on any network. After the browser loads and
auto-completes the handshake (~1 s), the terminal prints
`Paired! Config saved` and exits. The pairing persists in
`~/.mw-claude/config.json`.

## Run the daemon

    node packages/mw-claude/dist/cli.js run

(or just `... cli.js` — `run` is the default when there's a saved pairing).

The wrapped `claude` TUI takes over the terminal as if you ran `claude`
directly. A stderr line reads `[mw-claude] relay connected (channel <id>)`.

Now any browser paired to this channel can type prompts and see Claude's
replies. Prompts from the browser appear typed into your TUI; replies
stream back to the browser. Type `/exit` in the TUI (or Ctrl+C) to stop.

## Re-pairing

Pairing is per-browser-tab. If you want a different device to drive your
Claude session, run `pair` again — the new pairing overrides the old. The
old browser tab will show "daemon disconnected" forever and can be closed.

To clear a browser's pairing without touching the daemon: in the browser
DevTools console, run
`localStorage.removeItem('mw-claude.paired.v1'); location.reload()` or
click the "unpair this browser" link at the bottom of the page.

## Security

- Prompts and replies are encrypted with libsodium `crypto_box` (X25519 +
  XSalsa20-Poly1305). The relay sees only ciphertext.
- The 5-minute pairing window is unauthenticated — anyone who has the
  pairing URL can claim the channel before the legitimate browser does.
  Acceptable for single-user use; future work could add a TUI-side
  "confirm pairing" prompt.
- Private keys never leave the device (daemon: `~/.mw-claude/config.json`;
  browser: `localStorage`).

## Known limits

- Reply segmenter is a heuristic that watches for Claude Code's `●`
  streaming bullet between prompt-box redraws. Multi-line replies are
  truncated to the first line for now. Inspect
  `tests/fixtures/sample-claude-output.txt` for the recorded TUI shape.
- One browser ↔ one daemon at a time. The Channel DO replaces older
  connections when a new one with the same role arrives.

## Development

- Tests: `npm test -w packages/mw-claude` (14 passing).
- Source layout:
  - `src/pty-session.ts` — wraps the `claude` child process.
  - `src/output-parser.ts` — ANSI strip + reply segmenter.
  - `src/crypto.ts` — libsodium envelope.
  - `src/config-store.ts` — `~/.mw-claude/config.json`.
  - `src/relay-client.ts` — WS client with reconnect + crypto.
  - `src/pair.ts` — pair subcommand.
  - `src/cli.ts` — CLI entry, subcommand routing.
  - `src/local-server.ts` — Plan 1's localhost dev UI (unused by default;
    kept as a reference implementation).
