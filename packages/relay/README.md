# relay

Cloudflare Worker that hosts:
- The Claude Display companion webapp at `/` (vanilla HTML/CSS/JS, targets
  Meta Display Glasses but works in any modern browser).
- The WebSocket relay at `/api/ws`, routing through a per-channel
  Durable Object that pipes encrypted frames between `client` and
  `daemon` roles.

The relay is a dumb pipe — it only sees ciphertext. All crypto happens
at the endpoints (`mw-claude` daemon uses libsodium, browser uses
TweetNaCl, both speak the same `crypto_box` wire format).

## Deploy

    npm install                     # from repo root
    npm run deploy -w packages/relay

Builds `glasses-app/` → `dist/`, then `wrangler deploy` uploads both the
static assets (via the `ASSETS` binding) and the Worker bundle (which
exports the `Channel` Durable Object class).

Production URL: `https://claude-display.brunofernandeslopes.workers.dev`.

## Layout

- `src/worker.ts` — entry. Routes `/api/ws` to a `Channel` DO via
  `idFromName(channel)`, falls through to Workers Assets otherwise.
- `src/channel-do.ts` — Hibernatable WebSocket DO. Holds one WS per
  role per channel, forwards opaque frames between them, emits
  `peer_connect` / `peer_disconnect` control frames.
- `glasses-app/` — static webapp:
  - `index.html` — screens (main + not-paired)
  - `styles.css` — dark theme, focus states, 600×600 layout
  - `app.js` — D-pad navigation, lifecycle, Web Speech API
  - `crypto.js` — TweetNaCl `crypto_box` wrapper
  - `pairing.js` — `?p=` URL consumption + localStorage
  - `relay-ws.js` — WS client with handshake + reconnect
  - `vendor/` — vendored TweetNaCl scripts
  - `favicon.png`, `manifest.webmanifest`
- `scripts/build.mjs` — copies `glasses-app/` → `dist/`.

## Local dev

    npm run dev:relay

`wrangler dev` serves both the Worker and the static assets on
`http://localhost:8787`.

## Pairing protocol

See `packages/mw-claude/README.md`. The pair URL embeds a v2 payload:
channel ID, daemon pubkey, and a **shared client keypair**. All paired
devices (glasses webapp, Android phone app) import the same client
identity, so the daemon only ever tracks one peer pubkey but multiple
devices can simultaneously send and receive.

## Wire protocol

The DO broadcasts every WebSocket frame to all OTHER peers in the
channel (sender excluded). Each peer dispatches by the inner msg
`type` and ignores types it doesn't care about:

| `type` | Sender | Receiver acts on | Receiver ignores |
|---|---|---|---|
| `prompt` | phone or laptop client | daemon types into Claude TUI; glasses webapp shows in transcript | (none) |
| `reply` | daemon | clients render in transcript | (none) |
| `trigger_record` | glasses webapp (Plan 5 hands-free) | phone fires push-to-talk | daemon |

Control frames (`hello`, `hello_ack`, `peer_connect`, `peer_disconnect`)
are unencrypted and managed by the DO + client `RelayClient`s.

## Adding the webapp to Meta Display Glasses

1. Enable **Developer Mode** in the Meta AI app (required — the menu
   path below is hidden otherwise). See
   https://wearables.developer.meta.com/docs/develop/webapps/setup/#enabling-developer-mode-in-the-meta-ai-app
2. *Devices → Display Glasses → App connections → Web apps → Add a web app*
3. Name: `Claude Display`. URL: the full pairing URL printed by
   `mw-claude pair`.
4. Open the webapp from the glasses apps menu; pairing happens
   automatically.
