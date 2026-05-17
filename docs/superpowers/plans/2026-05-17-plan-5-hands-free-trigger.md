# Plan 5 — Hands-Free Trigger (EMG / D-Pad on Glasses)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "tap a button on the phone" requirement. The user wears the glasses, taps their fingers together (EMG select) or presses Enter on the D-pad, the phone (sitting in their pocket) wakes up and records, the prompt goes to Claude, the reply renders on the glasses display. Same product, no phone interaction.

**Architecture:** The glasses webapp's existing talk-button (already activated by EMG/D-pad Enter via the Plan 3 keyboard handlers) stops trying to do local Web Speech (which fails on the Display platform) and instead sends an encrypted **`trigger_record`** control message through the relay. The Channel DO is updated to broadcast `role=client` frames to **all** other peers (instead of only to the daemon), so the phone receives the trigger. The Android app gets a handler that auto-fires its existing push-to-talk flow when a `trigger_record` arrives. The daemon ignores `trigger_record` (it only acts on `prompt` messages).

**Tech Stack:** Same as Plans 1-4. No new dependencies. Touches: DO routing logic, glasses webapp `app.js` and `relay-ws.js`, daemon `cli.ts` message dispatcher (verify it ignores unknown types), Android app `MainActivity.kt`.

**Prerequisite:** Plan 4 complete and verified. Phone, glasses, and daemon all paired to the same channel via v2 URL.

**Out of scope (deferred to a later plan):**
- Background / lock-screen operation. v1 requires the Android app to be in the foreground (or at least the screen on). A future plan could add a foreground service with a persistent notification so the phone is "always armed."
- Wake-word detection ("hey Claude"). EMG tap is the intentionality gate; we trust it.

---

## Wire protocol additions

One new encrypted message type, sent client → daemon AND client → client via the DO's broadcast change:

```json
{ "type": "trigger_record" }
```

No payload — the trigger itself is the message. Encrypted with the same `crypto_box` envelope as `prompt` and `reply`.

The daemon ignores it (it only acts on `prompt`). The phone listens for it and programmatically fires the SCO + SR pipeline.

---

## File structure (modifications only)

```
packages/
├── relay/
│   └── src/channel-do.ts                   (modify: broadcast to all peers)
├── relay/glasses-app/
│   ├── app.js                              (modify: button sends trigger, shows status)
│   └── relay-ws.js                         (modify: send raw msgs, not just replies)
└── android/app/src/main/java/com/claudedisplay/
    ├── MainActivity.kt                     (modify: handle trigger_record)
    └── relay/RelayClient.kt                (modify: surface trigger_record as event)
```

No new files. Total diff probably ~150 LOC.

---

## Task 1: DO broadcast change

**File:** `packages/relay/src/channel-do.ts`

The current `webSocketMessage` handler routes `role=client` → only `role=daemon`. Change it to broadcast to ALL other WSs (every WS except the sender). This lets the glasses webapp's encrypted message reach the phone in addition to the daemon.

- [ ] **Step 1: Modify `webSocketMessage`**

Replace the existing handler:

```ts
async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
  const role: Role = this.state.getWebSockets('client').includes(ws) ? 'client' : 'daemon';
  const otherRole: Role = role === 'client' ? 'daemon' : 'client';
  const targets = this.state.getWebSockets(otherRole);
  for (const t of targets) {
    try {
      t.send(typeof message === 'string' ? message : new Uint8Array(message));
    } catch {
      // drop on send failure
    }
  }
}
```

with:

```ts
async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
  // Broadcast to every other peer in the channel — sender is excluded.
  // This lets clients talk to clients (for trigger_record control) as well
  // as the existing client↔daemon flow. Daemon ignores msg types it doesn't
  // care about; client peers do the same.
  const all = this.state.getWebSockets();
  for (const t of all) {
    if (t === ws) continue;
    try {
      t.send(typeof message === 'string' ? message : new Uint8Array(message));
    } catch {
      // drop on send failure
    }
  }
}
```

- [ ] **Step 2: Deploy + smoke**

```
npm run deploy -w packages/relay
```

Three-peer smoke test:

```bash
node -e "
const W = require('ws');
const ch = 'smoke-' + Date.now();
const URL = 'wss://claude-display.brunofernandeslopes.workers.dev/api/ws';
const d = new W(URL + '?channel=' + ch + '&role=daemon');
d.on('open', () => console.log('daemon open'));
d.on('message', m => console.log('daemon recv:', m.toString()));
let c1, c2;
setTimeout(() => {
  c1 = new W(URL + '?channel=' + ch + '&role=client');
  c1.on('open', () => console.log('c1 open'));
  c1.on('message', m => console.log('c1 recv:', m.toString()));
}, 500);
setTimeout(() => {
  c2 = new W(URL + '?channel=' + ch + '&role=client');
  c2.on('open', () => console.log('c2 open'));
  c2.on('message', m => console.log('c2 recv:', m.toString()));
}, 1000);
setTimeout(() => {
  c1.send('hello-from-c1');
  console.log('c1 sent hello-from-c1');
}, 1500);
setTimeout(() => process.exit(0), 3500);
"
```

Expected output includes:
- `daemon recv: hello-from-c1`
- `c2 recv: hello-from-c1`

(C1 must NOT receive its own message back.)

- [ ] **Step 3: Commit**

```
git add packages/relay/src/channel-do.ts
git commit -m "feat(relay): DO broadcasts to all other peers (enables client-to-client control)"
```

---

## Task 2: Glasses webapp — send `trigger_record` instead of trying local SR

**Files:**
- `packages/relay/glasses-app/relay-ws.js` — expose a generic `send(obj)` AND a `sendRaw(obj)` if the current API doesn't already.
- `packages/relay/glasses-app/app.js` — replace the talk button's local-SR path with sending the trigger; subscribe to `trigger_record` echo for self-status (optional).

- [ ] **Step 1: Confirm `relay-ws.js` exposes a generic encrypted send**

Open `packages/relay/glasses-app/relay-ws.js`. Verify it already exports a `send(obj)` that encrypts and emits a `{type:"msg", ct}` frame (it does, per Plan 3). No changes needed.

- [ ] **Step 2: Rewrite the talk button handler in `app.js`**

Find the section that sets up `recognition`, `startRecording`, `stopRecordingAndSend`. Replace the whole "Web Speech API integration" block (from the comment marker through the end of `stopRecordingAndSend`) with:

```js
// Hands-free trigger: tap the talk button to ask the phone to record.
function handleTalkPress() {
  if (!state.relay) {
    setStatus('not connected — wait for phone');
    return;
  }
  state.relay.send({ type: 'trigger_record' });
  setRecording(true);
  els.talkBtnLabel.textContent = 'Asked phone to listen…';
  // The phone will send its transcript back as the daemon's prompt — and the
  // reply will arrive normally. We reset the button when a reply or status
  // change happens (handled in the onMessage hook below).
}

function setRecording(on) {
  state.recording = on;
  els.talkBtn.classList.toggle('recording', on);
  if (!on) els.talkBtnLabel.textContent = 'Tap to talk';
}
```

Then in the boot block where `connect()` is called, augment the `onMessage` handler so a Claude reply also clears the recording UI:

```js
state.relay = connect({
  paired,
  onStatus: setStatus,
  onMessage: (obj) => {
    setRecording(false);  // any decrypted msg = phone has done its job
    if (obj.type === 'reply' && typeof obj.text === 'string') {
      appendTurn('claude', obj.text);
    }
  },
});
```

- [ ] **Step 3: Local sanity check**

`npm run dev:relay`, navigate to the local URL in a browser. Tap "Tap to talk" — UI should change to "Asked phone to listen…". (Nothing else happens locally; the phone listens for it on real device.)

- [ ] **Step 4: Deploy**

```
npm run deploy -w packages/relay
```

- [ ] **Step 5: Commit**

```
git add packages/relay/glasses-app/app.js
git commit -m "feat(glasses-app): tap-to-talk sends trigger_record instead of local SR"
```

---

## Task 3: Android app — listen for `trigger_record`, auto-fire push-to-talk

**Files:**
- `packages/android/app/src/main/java/com/claudedisplay/relay/RelayClient.kt` (modify: emit triggers)
- `packages/android/app/src/main/java/com/claudedisplay/MainActivity.kt` (modify: subscribe + auto-record)

- [ ] **Step 1: Extend `RelayClient.kt` to surface trigger messages**

Add a second `MutableSharedFlow<String>` for non-reply messages and emit on it.

Replace the `_replies` flow region with:

```kotlin
private val _replies = MutableSharedFlow<String>(extraBufferCapacity = 32)
val replies: SharedFlow<String> = _replies
private val _triggers = MutableSharedFlow<Unit>(extraBufferCapacity = 32)
val triggers: SharedFlow<Unit> = _triggers
```

And in the `"msg"` branch of `onMessage`, after parsing `obj`, dispatch by type:

```kotlin
"msg" -> {
  val ct = f.optString("ct").takeIf { it.isNotEmpty() } ?: return
  try {
    val pt = CryptoEnvelope.decrypt(ct, keys.peerPubB64, keys.mySecretB64)
    val obj = JSONObject(pt)
    _status.tryEmit("paired & encrypted")
    when (obj.optString("type")) {
      "reply" -> _replies.tryEmit(obj.optString("text"))
      "trigger_record" -> _triggers.tryEmit(Unit)
      // other types: ignore
    }
  } catch (t: Throwable) {
    _status.tryEmit("decrypt error: ${t.message}")
  }
}
```

- [ ] **Step 2: Subscribe to triggers in `MainScreen` and auto-start push-to-talk**

Extract the existing push-to-talk start logic into a function so it can be called from both the button onClick AND the trigger handler. In `MainScreen`, near the top of the body (alongside other `remember { }` initializations):

```kotlin
fun startPushToTalk() {
  scope.launch {
    if (recording) return@launch  // ignore re-triggers while already recording
    val ok = sco.start()
    if (!ok) { uiStatus = "BT SCO failed"; return@launch }
    if (!capture.isAvailable()) { uiStatus = "SR unavailable"; sco.stop(); return@launch }
    capture.onPartial = { talkLabel = "… $it" }
    capture.onFinal = { text ->
      sco.stop()
      recording = false
      talkLabel = "Push to talk"
      uiStatus = null
      transcript = transcript + ("you" to text)
      val r = relay
      if (r == null) {
        uiStatus = "relay not connected — prompt not sent"
      } else {
        r.send(JSONObject(mapOf("type" to "prompt", "text" to text)))
      }
    }
    capture.onError = { code ->
      sco.stop()
      recording = false
      talkLabel = "Push to talk"
      uiStatus = "SR error $code"
    }
    capture.start()
    recording = true
    talkLabel = "Listening… tap to stop"
    uiStatus = "listening (glasses mic)…"
  }
}
```

The button's `onClick` becomes:

```kotlin
Button(
  onClick = {
    if (recording) {
      recording = false
      capture.stop()
      sco.stop()
    } else {
      startPushToTalk()
    }
  },
  modifier = Modifier.fillMaxWidth().height(72.dp),
) { Text(talkLabel, style = MaterialTheme.typography.titleMedium) }
```

And add (inside the `DisposableEffect(paired)` block right after wiring `replyJob`):

```kotlin
val triggerJob = scope.launch { client.triggers.collect { startPushToTalk() } }
```

Update the `onDispose` block to cancel `triggerJob` too:

```kotlin
onDispose {
  statusJob.cancel()
  replyJob.cancel()
  triggerJob.cancel()
  client.stop()
  if (relay === client) relay = null
}
```

- [ ] **Step 3: Build + install**

```
cd packages/android
./gradlew installDebug
```

- [ ] **Step 4: Commit**

```
git add packages/android/app/src/main/java/com/claudedisplay/relay/RelayClient.kt \
        packages/android/app/src/main/java/com/claudedisplay/MainActivity.kt
git commit -m "feat(android): subscribe to trigger_record and auto-fire push-to-talk"
```

---

## Task 4: End-to-end hands-free test

**Files:** none.

- [ ] **Step 1: Set up the three peers** (assuming Plan 4 v2 pairing already done)

PC: `node packages/mw-claude/dist/cli.js run`.
Phone: open the Claude Display app (foreground required for v1).
Glasses: open the Claude Display webapp via the Meta AI companion.

All three should show "paired & encrypted".

- [ ] **Step 2: The hands-free trigger**

On the glasses, **tap your fingers together (EMG select)** while the talk button is focused. The glasses status should flip to "Asked phone to listen…".

The phone should:
- Auto-start the SCO route (LED indicator on glasses may signal mic active).
- Show "listening (glasses mic)…" UI status.

Speak: "what's eight times nine".

The phone's SR finalizes. The prompt arrives in the Claude TUI on PC. Claude replies. The reply lands in:
- The glasses transcript area.
- The phone transcript (still useful for debugging).

The glasses talk-button label returns to "Tap to talk".

- [ ] **Step 3: D-pad sanity check**

Same flow but instead of EMG, press **Enter on the D-pad** (or whatever the glasses' captouch maps to Enter). The behavior should be identical — the existing keyboard handler treats both inputs the same.

- [ ] **Step 4: Edge cases to verify**

- **Trigger while phone app is recording**: tap glasses again mid-recording. Expected: phone ignores the duplicate trigger (the `if (recording) return@launch` guard).
- **Phone screen off**: lock the phone, tap glasses. Expected for v1: SR may not fire (Android suspends background SR). Document the limitation; foreground service is a future plan.

- [ ] **Step 5: Report results**

If all happy paths work, Plan 5 is done.

---

## Task 5: README updates

**Files:**
- `packages/relay/README.md` — note the new `trigger_record` control message and the DO broadcast model.
- `packages/android/README.md` — daily-use section: "tap EMG on glasses to talk."

- [ ] **Step 1: Update `packages/relay/README.md` — add a "Wire protocol" subsection.**

```markdown
## Wire protocol

Encrypted `msg` frames carry inner JSON objects with a `type` field. Known types:

- `prompt` — text to type into Claude. Sent by phone (or laptop test client). Daemon acts on it.
- `reply` — Claude's response text. Sent by daemon. Clients render it.
- `trigger_record` — hands-free trigger from glasses to phone. Phone acts on it; daemon ignores it.

The DO broadcasts every msg frame to all other peers in the channel. Each peer decrypts and dispatches based on the inner `type` (ignoring types it doesn't care about).
```

- [ ] **Step 2: Update `packages/android/README.md` daily-use section**

Add to the "Daily use" section:

```markdown
4. Hands-free trigger (Plan 5): instead of tapping the phone, tap your
   fingers together with the talk button focused on the glasses
   (or press D-pad Enter). The phone wakes up, records, sends the
   prompt — all without touching the phone. Note: the Android app must
   be in the foreground for this to work in v1.
```

- [ ] **Step 3: Commit**

```
git add packages/relay/README.md packages/android/README.md
git commit -m "docs: plan 5 — hands-free trigger via glasses EMG/D-pad"
```

---

## Acceptance criteria for Plan 5

1. The DO broadcast change passes the three-peer smoke test in Task 1.
2. Tapping the glasses talk button (EMG or D-pad) flips its status to "Asked phone to listen…" and the daemon does NOT receive a prompt at this point.
3. Within ~1 second of the trigger, the phone auto-starts its push-to-talk flow (status flips to "listening (glasses mic)…").
4. Speaking is captured, transcribed, and the prompt arrives in the Claude TUI on PC.
5. Claude's reply arrives at both the glasses webapp and the phone transcript.
6. The glasses talk-button returns to "Tap to talk" once the reply lands.
7. A second trigger while still recording is a no-op (guard works).
8. No tests broken: `npm test --workspaces` still passes (mw-claude 14).

If all 8 hold, Plan 5 is done. The product is genuinely hands-free.

---

## Risks

1. **Phone backgrounding / screen off** — v1 requires the Android app foreground. If the user locks the phone, the SR pipeline may suspend. Documented limitation; foreground service plan can address later.
2. **DO broadcast loops** — we already exclude `t === ws` from the broadcast, but if a peer were to echo the same frame back the DO would forward it to others. The wire protocol doesn't have any peer that echos, so this is theoretical. Still, the implementer should double-check no `peer_connect`/`peer_disconnect` frames are inadvertently re-broadcast.
3. **Double-trigger from EMG noise** — if EMG produces a duplicate Enter event, the second one would be ignored by the recording-already-active guard. Verified in Task 4.
4. **Daemon decrypting `trigger_record`** — daemon already only acts on `type:prompt`. We rely on this. If the daemon's switch statement is ever broadened, it must not accidentally write `trigger_record` text into the TUI.

## Self-review notes

- **Spec coverage:** Plan 5 closes the original "voice into glasses" experience the spec described. The user wears glasses, taps EMG, speaks, sees reply. No phone interaction.
- **No placeholders:** all code blocks complete. Inline pivots flagged in Risks rather than as TBDs.
- **Type consistency:** `trigger_record` is the only new wire type, consistently used in glasses-app and android. No daemon-side acceptance — explicit no-op.
- **Decommissioning:** no removal of Plan 4 — push-to-talk on the phone button still works as a fallback, just becomes the secondary input method.
- **Open question parked:** foreground service / always-on phone for Plan 6 or later.
