# Claude Display — Android companion app

A native Android app that captures audio from the **Meta Display Glasses
microphone** over Bluetooth HFP, runs Android `SpeechRecognizer` for STT,
and ships the resulting prompt — end-to-end encrypted — through the
Cloudflare relay into your local `mw-claude` daemon. Claude's reply
arrives on the glasses via the existing Plan 3 webapp display.

## Status

Plan 4 deliverable, verified on a Pixel 8 Pro running Android 16 with
Meta Display Glasses BT-paired via the Meta AI app.

## Requirements

- Android Studio (Flamingo or newer).
- Android 10+ phone with the Meta AI app installed and Display Glasses paired.
- Developer Mode enabled in the Meta AI app (Plan 3 requirement, also needed
  for the glasses webapp to install).
- `mw-claude` daemon running on your PC (see `packages/mw-claude/README.md`).
- Cloudflare relay deployed (see `packages/relay/README.md`).

## Build + install

From repo root:

    cd packages/android
    ./gradlew installDebug

This builds the debug APK and installs to the connected ADB device. The
APK bundles libsodium (via Lazysodium-android) for crypto and OkHttp for
the WebSocket transport.

## First-time pairing

1. On the PC:

       node packages/mw-claude/dist/cli.js pair --relay-url wss://<your-relay>/api/ws

   This prints a URL containing a v2 pairing payload (channel ID, daemon
   pubkey, shared client keypair).

2. Scan the QR (or open the URL) on the phone. Android opens the
   Claude Display app directly — App Links is verified via
   `assetlinks.json` on the relay.

3. The app stores the pairing in EncryptedSharedPreferences. Phone status
   reads "paired — connecting".

4. On the PC, start the daemon:

       node packages/mw-claude/dist/cli.js run

   Phone status flips to "paired & encrypted" via the relay's
   `peer_connect` event.

## Daily use

1. Start the daemon on your PC: `node packages/mw-claude/dist/cli.js run`.
2. Open the Android app on your phone once. A persistent notification
   "Claude Display — paired & encrypted" appears.
3. **Hands-free**: tap your fingers together (EMG select) or press
   D-pad Enter on the glasses with the talk button focused. The phone
   wakes up its mic, captures your voice, and ships the prompt. You
   don't need to touch the phone.
4. Both your prompt and Claude's reply appear on the glasses transcript
   (and in the phone transcript / notification).
5. The app/phone can be backgrounded or the screen locked — the
   foreground service keeps the relay listener and audio pipeline alive.
   Tap "Stop" on the notification to fully exit.

## Architecture notes

### Audio routing — glasses mic over BT HFP

Android 12+ deprecated the legacy `AudioManager.startBluetoothSco()`. We
use the modern `AudioManager.setCommunicationDevice(BLUETOOTH_SCO)` with
a fallback to the legacy API on older devices. See
`audio/BluetoothScoController.kt`.

The audio system must be in `MODE_IN_COMMUNICATION` for the BT mic to
become the input source.

### STT — Android SpeechRecognizer

Uses Google's on-device/cloud recognizer via the standard
`android.speech.SpeechRecognizer` API. Once the SCO route is up, SR
implicitly reads from the BT-routed input — no special source selection
needed. See `audio/SpeechCapture.kt`.

### Crypto wire format

`crypto_box` (X25519 + XSalsa20-Poly1305) via Lazysodium-android.
Envelope: base64(nonce(24) || ciphertext). Byte-identical to the
daemon's libsodium and the glasses webapp's TweetNaCl. See
`crypto/CryptoEnvelope.kt`.

### Shared keypair (v2 pairing)

To let the phone and the glasses webapp both talk to the daemon without
the daemon needing to track multiple peer pubkeys, the v2 pair URL
embeds the client keypair directly. All paired devices share the same
crypto identity. Acceptable for personal use; security note: anyone
with the pair URL during its lifetime can decrypt traffic to all
devices paired from it.

### Relay client

OkHttp WebSocket with `pingInterval(20s)` keep-alive and exponential
reconnect backoff (500 ms → 10 s). See `relay/RelayClient.kt`.

## Known limits

- HFP audio quality is 8 kHz mono (Bluetooth profile spec limitation).
  SR copes well in quiet rooms; noisy environments hurt accuracy.
- Re-pair workflow: if you re-run `mw-claude pair`, you must also
  restart `mw-claude run` and clear/re-pair the phone — the daemon
  loads config once at startup, and the phone stores the pairing
  locally.
- App Links auto-verification requires the relay's
  `/.well-known/assetlinks.json` to be reachable and match the app's
  signing fingerprint. The debug keystore fingerprint is in the file;
  release builds will need a different one added to the JSON.

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| App crashes on launch | Check logcat. Usually a missing native lib (libjnidispatch.so for JNA) — confirm JNA's AAR variant is installed via `implementation("net.java.dev.jna:jna:5.13.0@aar")` and the JAR is excluded from lazysodium's transitive deps. |
| Status stuck on "connecting…" | Daemon (`mw-claude run`) isn't up. The relay needs at least one peer of each role for the DO to emit `peer_connect`. |
| "BT SCO failed" when tapping talk | Glasses aren't connected as a BT communication device. Confirm via the Meta AI app, then try again. |
| "SR error N" codes | Common: 6 = timeout (try again, speak sooner), 7 = no match, 9 = insufficient permissions (re-grant), 2 = network. |
| Prompt sent but never reaches Claude | Daemon may have been started with a stale config from an earlier pair. Stop the daemon, re-pair, restart `mw-claude run`. |
