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

See `packages/mw-claude/README.md`. Briefly: daemon prints a URL with
`?p=<base64>` payload (channel ID, daemon pubkey, relay URL). Browser
opens it, decodes, generates its own keypair, sends an unencrypted
`hello` over the relay. Daemon replies with `hello_ack`. From that
point on, all frames are encrypted `crypto_box` envelopes.

## Adding the webapp to Meta Display Glasses

1. Enable **Developer Mode** in the Meta AI app (required — the menu
   path below is hidden otherwise). See
   https://wearables.developer.meta.com/docs/develop/webapps/setup/#enabling-developer-mode-in-the-meta-ai-app
2. *Devices → Display Glasses → App connections → Web apps → Add a web app*
3. Name: `Claude Display`. URL: the full pairing URL printed by
   `mw-claude pair`.
4. Open the webapp from the glasses apps menu; pairing happens
   automatically.
