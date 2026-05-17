# Claude Code Display

Control your Claude Code session on a PC from **Meta Display Glasses** + an **Android phone**, hands-free, over end-to-end encrypted Cloudflare relay.

- **Wear the glasses.** Tap to talk on the temple (or your Neural Band).
- **Phone in pocket** picks up the glasses microphone over Bluetooth HFP, runs on-device speech-to-text.
- **Daemon on your PC** types the prompt into your already-running `claude` session.
- **Reply appears on the glasses** within seconds.

> Inspired by [Happy](https://github.com/slopus/happy), but for [Meta Ray-Ban Display Glasses](https://wearables.developer.meta.com/) instead of phones.

## Architecture

```
                    ┌──────────────────────────────────┐
                    │  Cloudflare Worker (relay)       │
                    │  + Durable Object per channel    │
┌──────────────┐    │                                  │    ┌──────────────────┐
│ Glasses      │◀──▶│  GET /       → static webapp     │◀──▶│ mw-claude daemon │
│ webapp       │    │  WSS /api/ws → Channel DO        │    │ on your PC       │
│ (vanilla JS) │    │                                  │    │ (wraps claude)   │
└──────────────┘    └──────────────────────────────────┘    └──────────────────┘
       ▲                          ▲
       │                          │
       └──────── EMG tap          │
                                  │
                          ┌──────────────────┐
                          │ Android phone    │
                          │ — captures glasses
                          │   mic via BT HFP │
                          │ — runs SR        │
                          │ — sends prompt   │
                          └──────────────────┘
```

All three peers share one **channel ID + shared client keypair** baked into a single pairing URL. Crypto is libsodium `crypto_box` (X25519 + XSalsa20-Poly1305); the relay only sees ciphertext.

## Packages

- **[`packages/mw-claude`](packages/mw-claude/)** — Node CLI (`mw-claude` / `ccdisplay`) that wraps your interactive `claude` session in a PTY and bridges it to the relay.
- **[`packages/relay`](packages/relay/)** — Cloudflare Worker hosting the WebSocket relay (Durable Object) AND the static glasses webapp.
- **[`packages/android`](packages/android/)** — Kotlin/Compose Android app that captures audio from the glasses mic and ships transcripts to the relay. Runs as a foreground service so the phone can be stashed in your pocket.

## Quick start

You'll need:

- Android Studio + an Android 10+ phone
- Meta Ray-Ban Display Glasses + the Meta AI app with **Developer Mode enabled** ([how](https://wearables.developer.meta.com/docs/develop/webapps/setup/#enabling-developer-mode-in-the-meta-ai-app))
- Node 24+ on Windows/macOS/Linux for the daemon
- A working `claude` CLI on PATH (your Claude Code subscription)

### 1. Clone + install

```bash
git clone https://github.com/bruno1308/claude-code-display.git
cd claude-code-display
npm install
```

### 2. Install the daemon CLI

```bash
cd packages/mw-claude
npm link
```

You now have a global `ccdisplay` command (and `mw-claude` alias) on PATH.

### 3. Build + install the Android app

```bash
cd ../android
./gradlew installDebug
```

(Needs a phone connected via ADB.)

### 4. Pair everything against the public relay

On your PC:

```bash
ccdisplay pair --relay-url wss://claude-display.brunofernandeslopes.workers.dev/api/ws
```

The daemon prints **two URLs**:

- An **https://** URL for the glasses webapp — paste into Meta AI app → Devices → Display Glasses → App connections → Web apps → Add a web app.
- A **claude-display://** URL + QR for the Android app — scan the QR with your phone camera, Android opens the Claude Display app and auto-pairs.

(Both URLs encode the same channel + shared keypair.)

### 5. Run the daemon + use it

```bash
ccdisplay run
```

The Claude TUI takes over your terminal. The phone shows a persistent "Claude Display — paired & encrypted" notification. Tap EMG (or D-pad) on the glasses, speak, see Claude's reply on the display.

## Self-hosting (optional)

The public relay at `claude-display.brunofernandeslopes.workers.dev` is multi-tenant — each user gets their own random channel and the relay only sees ciphertext. If you'd rather run your own:

```bash
npm i -g wrangler
wrangler login
npm run deploy -w packages/relay
```

Use your deploy's URL (e.g. `https://claude-display.<your-subdomain>.workers.dev`) wherever the public URL above is referenced.

## Security model

- libsodium `crypto_box` (X25519 + XSalsa20-Poly1305) end-to-end between daemon and paired devices.
- Wire format: base64(nonce(24) ‖ ciphertext). Byte-identical across libsodium (daemon), TweetNaCl (glasses webapp), and Lazysodium (Android).
- The pairing URL embeds a **shared client keypair** so multiple devices can pair to the same channel without the daemon needing to track per-device keys. Trade-off accepted: anyone with the pair URL during its lifetime can decrypt traffic to all paired devices. Fine for personal-use single-user setups.
- Cloudflare relay only sees ciphertext.
- `--dangerously-skip-permissions` is passed to `claude` by default because hands-free wearers can't answer permission prompts. Set `CCDISPLAY_SAFE_MODE=1` to opt out.

## Status

Works end-to-end on Pixel 8 Pro + Ray-Ban Display Glasses + Windows 11 + Cloudflare Workers. Built incrementally across 6 design plans.

Known limitations:
- **Captouch single-tap doesn't activate** on the Display — platform behavior. Use EMG pinch (one gesture = activate) or captouch double-tap.
- HFP audio is 8 kHz mono (Bluetooth profile spec). Fine indoors, struggles in noisy environments.

## License

MIT — see [LICENSE](LICENSE).
