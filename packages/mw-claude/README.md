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
- Claude Code (`claude.exe`) installed and reachable via PATH. Verify by
  running `claude` in a terminal — you should land in the interactive TUI.

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

- Reply segmenter is a heuristic that watches for Claude Code's `●` streaming
  bullet between prompt-box redraws. Some chrome lines may slip through or
  multi-line replies may be truncated to the first line. Inspect
  `tests/fixtures/sample-claude-output.txt` to see what the parser sees.
- The WS server binds to `127.0.0.1` only — other devices on your LAN cannot
  reach it. That's intentional for Plan 1.
