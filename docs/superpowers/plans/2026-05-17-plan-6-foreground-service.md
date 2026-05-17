# Plan 6 — Foreground Service (Android Background / Screen-Off Operation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Android companion app work with the screen off and/or the app not in the foreground. Currently Android suspends the WebSocket and the `SpeechRecognizer` when the app isn't visible; Plan 6 promotes the core (relay client + audio + STT) to a **foreground service** so it stays alive as long as a small persistent notification is showing.

**Architecture:** Move ownership of `RelayClient`, `BluetoothScoController`, and `SpeechCapture` out of the Compose UI into a new `ClaudeDisplayService : Service`. The service starts itself in foreground mode with a persistent notification ("Claude Display — ready"), maintains the WS connection, listens for `trigger_record`, and runs the push-to-talk pipeline when triggered. The UI becomes a thin viewer of state that the service publishes — it can be opened, paused, or closed without breaking the loop.

**Tech Stack:** Same as Plan 5. One new Android class. Two manifest entries. No new third-party deps.

**Prerequisite:** Plan 5 complete and verified. Hands-free trigger flow works while app is foregrounded.

**Out of scope (parked):**
- Auto-start on device boot. The plan adds the structure for this but keeps it disabled in v1 — the user can manually open the app once after a reboot to start the service.
- Wake-word ("hey Claude") — still gated on EMG/D-pad tap.
- "Permanent pair" enrollment UX changes — same pairing flow as Plan 5.

---

## File structure (new + modified)

```
packages/android/app/src/main/
├── AndroidManifest.xml                                          (modified)
└── java/com/claudedisplay/
    ├── MainActivity.kt                                          (refactored: thin viewer)
    ├── service/
    │   ├── ClaudeDisplayService.kt                              (NEW)
    │   ├── ServiceState.kt                                      (NEW — shared flows)
    │   └── NotificationFactory.kt                               (NEW — channel + builder)
    ├── relay/RelayClient.kt                                     (unchanged)
    ├── audio/BluetoothScoController.kt                          (unchanged)
    ├── audio/SpeechCapture.kt                                   (unchanged)
    ├── crypto/CryptoEnvelope.kt                                 (unchanged)
    └── pairing/Pairing.kt                                       (unchanged)
```

The service is the new owner of long-running state. The Activity becomes a "remote control" — it starts the service if not running, observes published state, and triggers manual push-to-talk via a bound interface or intent action.

---

## Task 1: Manifest — permissions + service declaration

**File:** `packages/android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Add foreground service permissions**

Inside `<manifest>`, after the existing `<uses-permission>` lines, add:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

The `_MICROPHONE` and `_CONNECTED_DEVICE` typed permissions are required as of Android 14 (API 34) for foreground services that record audio or interact with BT devices respectively.

- [ ] **Step 2: Declare the service inside `<application>`**

Add (before `</application>`):

```xml
<service
    android:name=".service.ClaudeDisplayService"
    android:exported="false"
    android:foregroundServiceType="microphone|connectedDevice" />
```

- [ ] **Step 3: Verify build still succeeds**

```bash
cd packages/android
./gradlew assembleDebug
```

- [ ] **Step 4: Commit**

```
git add packages/android/app/src/main/AndroidManifest.xml
git commit -m "feat(android): foreground service permissions + declaration"
```

---

## Task 2: Notification channel + builder

**File:** `packages/android/app/src/main/java/com/claudedisplay/service/NotificationFactory.kt` (new)

The persistent notification needs:
- A unique channel ID, low importance (no sound/vibration).
- A title that reflects current state (idle / listening).
- A "Stop" action that sends an Intent to the service to shut down.

- [ ] **Step 1: Create the file**

```kotlin
package com.claudedisplay.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.claudedisplay.MainActivity
import com.claudedisplay.R

object NotificationFactory {
    const val CHANNEL_ID = "claude-display-service"
    const val NOTIFICATION_ID = 1

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Claude Display",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Background relay listener"
            setShowBadge(false)
        }
        nm.createNotificationChannel(channel)
    }

    fun build(context: Context, statusText: String): Notification {
        ensureChannel(context)

        val openIntent = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            context, 1,
            Intent(context, ClaudeDisplayService::class.java).apply {
                action = ClaudeDisplayService.ACTION_STOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Claude Display")
            .setContentText(statusText)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopIntent)
            .build()
    }
}
```

- [ ] **Step 2: Commit (no build yet; service refers to it)**

(Combined with Task 3 commit.)

---

## Task 3: Shared state holder

**File:** `packages/android/app/src/main/java/com/claudedisplay/service/ServiceState.kt` (new)

A singleton with `MutableStateFlow`s the service updates and the UI observes. Simplest cross-process-safe-enough pattern for in-process singletons.

- [ ] **Step 1: Create the file**

```kotlin
package com.claudedisplay.service

import kotlinx.coroutines.flow.MutableStateFlow

object ServiceState {
    val running = MutableStateFlow(false)
    val relayStatus = MutableStateFlow("idle")
    val recording = MutableStateFlow(false)
    val talkLabel = MutableStateFlow("Push to talk")
    val uiHint = MutableStateFlow<String?>(null)
    // Append-only transcript. UI displays as-is.
    val transcript = MutableStateFlow<List<Pair<String, String>>>(emptyList())
}
```

---

## Task 4: ClaudeDisplayService

**File:** `packages/android/app/src/main/java/com/claudedisplay/service/ClaudeDisplayService.kt` (new)

This is the heart of Plan 6. Owns the relay client, audio controllers, and SR. Updates `ServiceState`. Exposes `ACTION_START`, `ACTION_TRIGGER` (manual push-to-talk), and `ACTION_STOP`.

- [ ] **Step 1: Create the file**

```kotlin
package com.claudedisplay.service

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.claudedisplay.audio.BluetoothScoController
import com.claudedisplay.audio.SpeechCapture
import com.claudedisplay.pairing.PairingStore
import com.claudedisplay.relay.PeerKeys
import com.claudedisplay.relay.RelayClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

class ClaudeDisplayService : Service() {

    companion object {
        const val ACTION_START = "com.claudedisplay.service.START"
        const val ACTION_STOP = "com.claudedisplay.service.STOP"
        const val ACTION_TRIGGER = "com.claudedisplay.service.TRIGGER"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var sco: BluetoothScoController
    private lateinit var capture: SpeechCapture
    private var relay: RelayClient? = null
    private var relayJobs: List<Job> = emptyList()

    override fun onCreate() {
        super.onCreate()
        sco = BluetoothScoController(applicationContext)
        capture = SpeechCapture(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_TRIGGER -> startPushToTalk()
            else -> ensureRunning()
        }
        return START_STICKY
    }

    private fun ensureRunning() {
        if (ServiceState.running.value) {
            updateNotification()
            return
        }
        ServiceState.running.value = true

        val notification = NotificationFactory.build(this, "ready")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NotificationFactory.NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                    or ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            )
        } else {
            startForeground(NotificationFactory.NOTIFICATION_ID, notification)
        }

        startRelay()
    }

    private fun startRelay() {
        val paired = PairingStore(applicationContext).load() ?: run {
            ServiceState.relayStatus.value = "not paired"
            return
        }
        val client = RelayClient(
            relayUrl = paired.relayUrl,
            channelId = paired.channelId,
            keys = PeerKeys(paired.clientPriv, paired.daemonPub, paired.clientPub),
        )
        relay = client
        relayJobs = listOf(
            scope.launch {
                client.status.collect {
                    ServiceState.relayStatus.value = it
                    updateNotification()
                }
            },
            scope.launch {
                client.replies.collect { reply ->
                    ServiceState.transcript.value = ServiceState.transcript.value + ("claude" to reply)
                }
            },
            scope.launch {
                client.triggers.collect { startPushToTalk() }
            },
        )
        client.start()
    }

    private fun startPushToTalk() {
        scope.launch {
            if (ServiceState.recording.value) return@launch
            val ok = sco.start()
            if (!ok) { ServiceState.uiHint.value = "BT SCO failed"; return@launch }
            if (!capture.isAvailable()) {
                ServiceState.uiHint.value = "SR unavailable"
                sco.stop()
                return@launch
            }
            capture.onPartial = { ServiceState.talkLabel.value = "… $it" }
            capture.onFinal = { text ->
                sco.stop()
                ServiceState.recording.value = false
                ServiceState.talkLabel.value = "Push to talk"
                ServiceState.uiHint.value = null
                ServiceState.transcript.value = ServiceState.transcript.value + ("you" to text)
                relay?.send(JSONObject(mapOf("type" to "prompt", "text" to text)))
                updateNotification()
            }
            capture.onError = { code ->
                sco.stop()
                ServiceState.recording.value = false
                ServiceState.talkLabel.value = "Push to talk"
                ServiceState.uiHint.value = "SR error $code"
                updateNotification()
            }
            capture.start()
            ServiceState.recording.value = true
            ServiceState.talkLabel.value = "Listening… tap to stop"
            ServiceState.uiHint.value = "listening (glasses mic)…"
            updateNotification()
        }
    }

    private fun updateNotification() {
        val text = when {
            ServiceState.recording.value -> "listening (glasses mic)…"
            else -> ServiceState.relayStatus.value
        }
        val nm = getSystemService(android.app.NotificationManager::class.java)
        nm.notify(NotificationFactory.NOTIFICATION_ID, NotificationFactory.build(this, text))
    }

    override fun onDestroy() {
        relayJobs.forEach { it.cancel() }
        relayJobs = emptyList()
        relay?.stop()
        relay = null
        try { sco.stop() } catch (_: Throwable) {}
        scope.cancel()
        ServiceState.running.value = false
        ServiceState.relayStatus.value = "stopped"
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
```

- [ ] **Step 2: Commit Task 2+3+4 together**

```
git add packages/android/app/src/main/java/com/claudedisplay/service/
git commit -m "feat(android): foreground service owning relay + audio + STT pipeline"
```

---

## Task 5: Refactor MainActivity into a thin observer

**File:** `packages/android/app/src/main/java/com/claudedisplay/MainActivity.kt`

The Activity now:
- Starts the service (if not running).
- Observes `ServiceState` flows for display.
- Sends an Intent with `ACTION_TRIGGER` when the user taps the manual button (for testing — the EMG-on-glasses path goes through the service's own relay listener).
- Does NOT own RelayClient, audio, or SR anymore.

- [ ] **Step 1: Replace MainActivity body**

Rewrite `packages/android/app/src/main/java/com/claudedisplay/MainActivity.kt`:

```kotlin
package com.claudedisplay

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.claudedisplay.pairing.PairingPayloadParser
import com.claudedisplay.pairing.PairingStore
import com.claudedisplay.service.ClaudeDisplayService
import com.claudedisplay.service.ServiceState
import com.claudedisplay.ui.theme.ClaudeDisplayTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val pairingUri = intent?.data
        setContent {
            ClaudeDisplayTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    MainScreen(
                        ctx = applicationContext,
                        pairingUri = pairingUri,
                        modifier = Modifier.padding(innerPadding),
                    )
                }
            }
        }
    }
}

@Composable
fun MainScreen(ctx: Context, pairingUri: Uri?, modifier: Modifier = Modifier) {
    val store = remember { PairingStore(ctx) }
    var paired by remember { mutableStateOf(store.load()) }

    val relayStatus by ServiceState.relayStatus.collectAsState()
    val uiHint by ServiceState.uiHint.collectAsState()
    val talkLabel by ServiceState.talkLabel.collectAsState()
    val transcript by ServiceState.transcript.collectAsState()
    val recording by ServiceState.recording.collectAsState()
    val serviceRunning by ServiceState.running.collectAsState()

    val permLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* surfaces on use */ }

    LaunchedEffect(Unit) {
        val needed = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            needed += Manifest.permission.BLUETOOTH_CONNECT
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed += Manifest.permission.POST_NOTIFICATIONS
        }
        permLauncher.launch(needed.toTypedArray())
    }

    // Consume incoming pairing URI on first composition.
    LaunchedEffect(pairingUri) {
        if (pairingUri != null) {
            val payload = PairingPayloadParser.parseFromUri(pairingUri)
            if (payload != null) {
                store.save(payload)
                paired = payload
            }
        }
    }

    // Ensure service is running when we have a pairing.
    LaunchedEffect(paired) {
        if (paired != null && !serviceRunning) {
            ctx.startForegroundService(Intent(ctx, ClaudeDisplayService::class.java).apply {
                action = ClaudeDisplayService.ACTION_START
            })
        }
    }

    if (paired == null) {
        Column(modifier.padding(24.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Not paired", style = MaterialTheme.typography.titleLarge)
            Text("On your PC, run:")
            Text("mw-claude pair --relay-url wss://…/api/ws",
                style = MaterialTheme.typography.bodySmall)
            Text("Then open the printed URL on this phone — Android will offer Claude Display as an opener.")
        }
        return
    }

    Column(modifier.padding(24.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("relay: $relayStatus", style = MaterialTheme.typography.bodySmall)
        uiHint?.let { Text(it, style = MaterialTheme.typography.bodySmall) }

        Button(
            onClick = {
                ctx.startService(Intent(ctx, ClaudeDisplayService::class.java).apply {
                    action = ClaudeDisplayService.ACTION_TRIGGER
                })
            },
            enabled = !recording,
            modifier = Modifier.fillMaxWidth().height(72.dp),
        ) { Text(talkLabel, style = MaterialTheme.typography.titleMedium) }

        Text("(or tap EMG on glasses; the phone listens even when this app is in the background)",
            style = MaterialTheme.typography.bodySmall)

        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            transcript.forEach { (kind, t) ->
                Text("${kind.uppercase()}: $t")
            }
        }
    }
}
```

- [ ] **Step 2: Build + install**

```
./gradlew installDebug
```

- [ ] **Step 3: Commit**

```
git add packages/android/app/src/main/java/com/claudedisplay/MainActivity.kt
git commit -m "refactor(android): MainActivity becomes a thin viewer of ServiceState"
```

---

## Task 6: End-to-end screen-off / backgrounded test

**Files:** none.

- [ ] **Step 1: Reinstall + launch the app once**

```
adb shell am start -n com.claudedisplay/.MainActivity
```

The first open triggers the service start (the LaunchedEffect on `paired`). Confirm the persistent notification appears in the phone's notification shade: "Claude Display — paired & encrypted" (or whatever the current relay status is).

- [ ] **Step 2: Background the app**

Press the phone's home button (or recent-apps and swipe away — DO NOT force-stop). The app is no longer in the foreground. The notification should still be visible.

- [ ] **Step 3: Trigger via glasses**

Tap EMG (or D-pad Enter) on the glasses talk button. Expected:
- Glasses status: "Asked phone to listen…".
- Phone notification text changes to "listening (glasses mic)…".
- After you speak and the SR finalizes, the prompt arrives in the Claude TUI.
- Reply arrives on glasses; the phone notification returns to "paired & encrypted".

- [ ] **Step 4: Screen-off test**

Lock the phone (press power). Now you cannot see the screen. Tap EMG on glasses. Speak. Verify in the Claude TUI that the prompt arrived.

- [ ] **Step 5: "Stop" action test**

Open notification shade → tap "Stop" on the Claude Display notification. The service should shut down, notification disappear. Subsequent glasses taps should do nothing until you open the app again (which auto-restarts the service).

- [ ] **Step 6: No commit** — verification only.

---

## Task 7: README updates

**File:** `packages/android/README.md`

- [ ] **Step 1: Replace the "Known limits" section**

Find the existing line about foreground-only operation and remove it. Add to "Daily use":

```markdown
5. Hands-free with screen off: once you've opened the app once and the
   persistent notification ("Claude Display — paired & encrypted") is
   showing, you can lock the phone and stash it. EMG taps on the
   glasses still wake the phone's mic and send prompts. Swipe the
   notification's "Stop" action to fully exit.
```

- [ ] **Step 2: Add a "Service lifecycle" subsection**

```markdown
## Service lifecycle

The app uses an Android foreground service (`ClaudeDisplayService`) to
keep the WebSocket and audio pipeline alive when the app isn't visible.
The persistent notification is required by Android — there's no way to
hide it for a long-running service.

- Start: opening the app for the first time after install, OR after
  hitting "Stop" in the notification.
- Stop: tap "Stop" in the notification, or `pm clear com.claudedisplay`.
- The service does NOT auto-start on device boot (parked for a future
  plan). After rebooting your phone, open the app once.
```

- [ ] **Step 3: Commit**

```
git add packages/android/README.md
git commit -m "docs(android): foreground service, screen-off operation"
```

---

## Acceptance criteria for Plan 6

1. App build still succeeds, no test regressions (`npm test --workspaces`).
2. Opening the app once produces a persistent notification "Claude Display — …".
3. Backgrounding the app does NOT stop the WS — `relayStatus` remains "paired & encrypted".
4. Tapping EMG on the glasses while the app is in the background still wakes the phone mic, captures audio, and the prompt reaches Claude.
5. The above also works with the phone screen locked.
6. Tapping "Stop" in the notification shuts the service down cleanly; reopening the app restarts it.
7. No JNI / native-lib crashes (libsodium still loads in the service process — which is the same process as the activity, so this should just work).

If all 7 hold, Plan 6 is done. The product is now true hands-free, phone-in-pocket.

---

## Risks

1. **Battery drain.** WS + heartbeat ping + occasional SR runs ≈ small but non-zero drain. For personal use, fine. Doc in README.
2. **OEM aggressive battery management.** Some Android OEMs (especially Chinese builds) kill foreground services to save battery. Pixel is friendly. Document the limitation.
3. **BT SCO during service.** SCO is acquired from the service context, not the activity. Should work identically — `AudioManager` is process-scoped, not activity-scoped.
4. **Notification permission denied.** On Android 13+, POST_NOTIFICATIONS is runtime-requested. We ask in the permission launcher. If denied, the service still runs but the notification is invisible. UX-wise that's fine (state is still in the app UI), but Android might kill the service faster without a visible notification.

## Self-review notes

- **Spec coverage:** Plan 6 closes the last gap from the original spec — true hands-free with the phone stashed.
- **No placeholders:** all code complete. Foreground service types declared correctly for Android 14+ (microphone, connectedDevice).
- **Type consistency:** `ServiceState` flows used consistently; `ACTION_START`/`STOP`/`TRIGGER` are the only new intent actions.
- **Decommissioning:** the previous in-Activity RelayClient is fully removed; UI is purely observational now.
- **Open question parked:** boot-completed auto-start, wake-word detection — both Plan 7+ territory.
