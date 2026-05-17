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

## Quick start (fork → deploy → use)

This project is per-user — each fork deploys its own Cloudflare Worker and signs its own Android APK. You'll need:

- Cloudflare account (free tier works)
- Android Studio + an Android 10+ phone
- Meta Ray-Ban Display Glasses + the Meta AI app with **Developer Mode enabled**
- Node 24+ on Windows/macOS/Linux for the daemon
- A working `claude` CLI on PATH (your Claude Code subscription)

### 1. Clone + install

```bash
git clone https://github.com/<your-fork>/claude-code-display.git
cd claude-code-display
npm install
```

### 2. Deploy your own relay

```bash
npm i -g wrangler
wrangler login
npm run deploy -w packages/relay
```

Note the deployed URL (e.g. `https://claude-display.<your-subdomain>.workers.dev`). You'll need it for the next steps.

### 3. Update the Android intent filter for App Links

Edit `packages/android/app/src/main/AndroidManifest.xml` — change the `android:host` in the App Link `intent-filter` to YOUR Worker subdomain.

Get your app's debug SHA-256 fingerprint:

```bash
cd packages/android
./gradlew signingReport | grep "SHA-256" | head -1
```

Edit `packages/relay/glasses-app/.well-known/assetlinks.json` with your fingerprint and your package name. Redeploy:

```bash
cd ..
npm run deploy -w packages/relay
```

### 4. Build + install the Android app

```bash
cd packages/android
./gradlew installDebug
```

### 5. Install the daemon CLI

```bash
cd packages/mw-claude
npm link
```

This gives you a global `ccdisplay` command (and `mw-claude` alias).

### 6. Pair everything

On your PC:

```bash
ccdisplay pair --relay-url wss://claude-display.<your-subdomain>.workers.dev/api/ws
```

You get a QR code + URL. Then:

- **Phone**: scan the QR with the phone camera. Android opens the Claude Display app (because App Links is verified). Pairs automatically.
- **Glasses**: in Meta AI app → Devices → Display Glasses → App connections → Web apps → Add a web app. Paste the same URL. Open the webapp on the glasses.

### 7. Run the daemon + use it

```bash
ccdisplay run
```

The Claude TUI takes over your terminal. The phone shows a persistent "Claude Display — paired & encrypted" notification. Tap EMG (or D-pad) on the glasses, speak, see Claude's reply on the display.

## Security model

- libsodium `crypto_box` (X25519 + XSalsa20-Poly1305) end-to-end between daemon and paired devices.
- Wire format: base64(nonce(24) ‖ ciphertext). Byte-identical across libsodium (daemon), TweetNaCl (glasses webapp), and Lazysodium (Android).
- The pairing URL embeds a **shared client keypair** so multiple devices can pair to the same channel without the daemon needing to track per-device keys. Trade-off accepted: anyone with the pair URL during its lifetime can decrypt traffic to all paired devices. Fine for personal-use single-user setups.
- Cloudflare relay only sees ciphertext.
- `--dangerously-skip-permissions` is passed to `claude` by default because hands-free wearers can't answer permission prompts. Set `CCDISPLAY_SAFE_MODE=1` to opt out.

## Status

Works end-to-end on Pixel 8 Pro + Ray-Ban Display Glasses + Windows 11 + Cloudflare Workers. Built over 6 incremental design plans (see [`docs/superpowers/plans`](docs/superpowers/plans/)).

Known limitations:
- **Captouch single-tap doesn't activate** on the Display — platform behavior. Use EMG pinch (one gesture = activate) or captouch double-tap.
- HFP audio is 8 kHz mono (Bluetooth profile spec). Fine indoors, struggles in noisy environments.

## License

MIT — see [LICENSE](LICENSE).
