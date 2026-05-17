# Plan 4 — Android Companion App (Glasses Mic via DAT)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native Android app on your phone that captures audio from the **glasses' microphone** over Bluetooth HFP, transcribes it on-device, and sends the resulting prompt through the existing E2E-encrypted Cloudflare relay to your Claude Code session. Claude's reply continues to appear on the glasses via the existing web app from Plan 3. Net result: tap a phone button (or eventually a glasses EMG gesture), speak hands-free into the glasses, see the answer on the display.

**Architecture:** The phone app is a third peer on the same Cloudflare relay channel as the glasses webapp and the `mw-claude` daemon. It pairs via the same `?p=` URL flow (handled via Android App Links so the QR scan opens our app, not Chrome). Audio capture uses `AudioManager.startBluetoothSco()` to route the glasses' HFP microphone as the system input, then `SpeechRecognizer` for on-device STT. Crypto is libsodium via Lazysodium-android, wire-compatible with the daemon's libsodium and the webapp's TweetNaCl. WebSocket uses OkHttp. DAT SDK is wired in so we can later add display push without restructuring.

**Tech Stack:** Android Studio (latest stable), Kotlin, Jetpack Compose for UI, Gradle Kotlin DSL, Lazysodium-android (libsodium JNI), OkHttp (WebSocket), Android `AudioManager` + `SpeechRecognizer`, Meta DAT SDK 0.7.

**Prerequisites:**
- Plan 3 complete (relay deployed at `https://claude-display.brunofernandeslopes.workers.dev`, daemon paired and working).
- Android Studio installed (Flamingo or newer).
- An Android 10+ phone with Meta AI app installed and paired to the Display Glasses.
- Developer Mode enabled in the Meta AI app.
- ADB-accessible phone (USB or wireless).
- GitHub PAT with `read:packages` scope for the DAT SDK Maven repo (set as `GITHUB_TOKEN` env var or `github_token` in `local.properties`).

**Risks (called out upfront):**
- The user found this product is new; HFP routing + SpeechRecognizer over the glasses mic is unverified. **Task 2 is a hard spike** before any architecture commits — if it fails, the plan pivots (most likely to Whisper-via-Workers-AI streaming raw audio).
- The DAT SDK requires GitHub package authentication; first-time setup can be fiddly.
- Android App Links require Digital Asset Links verification on the relay; if the verification flow fails we fall back to a custom URL scheme.

---

## File structure (new)

```
B:\Projects\ClaudeDisplay\
├── packages\
│   └── android\                                    (NEW)
│       ├── build.gradle.kts                        (project-level)
│       ├── settings.gradle.kts                     (DAT Maven repo)
│       ├── gradle.properties
│       ├── local.properties                        (gitignored — GitHub PAT)
│       ├── libs\                                   (Gradle version catalog)
│       │   └── libs.versions.toml
│       └── app\
│           ├── build.gradle.kts
│           ├── proguard-rules.pro
│           └── src\main\
│               ├── AndroidManifest.xml             (BT perms, app link intent filter)
│               ├── kotlin\com\claudedisplay\
│               │   ├── ClaudeDisplayApp.kt         (Application class, DAT init)
│               │   ├── MainActivity.kt             (single-activity Compose host)
│               │   ├── ui\
│               │   │   ├── MainScreen.kt           (push-to-talk + status)
│               │   │   ├── PairingScreen.kt        (consume deep link)
│               │   │   └── Theme.kt
│               │   ├── pairing\
│               │   │   ├── PairingPayload.kt       (decode ?p=)
│               │   │   └── PairingStore.kt         (EncryptedSharedPreferences)
│               │   ├── crypto\
│               │   │   └── CryptoEnvelope.kt       (libsodium crypto_box wrapper)
│               │   ├── relay\
│               │   │   └── RelayClient.kt          (OkHttp WS + handshake + reconnect)
│               │   ├── audio\
│               │   │   ├── BluetoothScoController.kt
│               │   │   └── SpeechCapture.kt        (SpeechRecognizer wrapper)
│               │   └── dat\
│               │       └── DatSessionHolder.kt     (Wearables session lifecycle)
│               └── res\
│                   ├── values\
│                   │   ├── strings.xml
│                   │   └── themes.xml
│                   └── xml\
│                       └── network_security_config.xml
└── packages\relay\glasses-app\public\.well-known\
    └── assetlinks.json                              (Digital Asset Links for App Links)
```

The Android workspace is a sibling of `packages/mw-claude` and `packages/relay`. It is NOT an npm workspace member — Gradle owns its dependencies. Root-level `package.json` gets a single helper script `build:android` that shells out to Gradle for convenience.

---

## Task 1: Bootstrap Android Studio project

**Files:** the full `packages/android/` skeleton.

- [ ] **Step 1: Pin Android Studio + Gradle versions**

Verify on the PC:
```
gradle --version
```
If Gradle isn't installed, use the Gradle wrapper that Android Studio generates — DO NOT install Gradle globally.

- [ ] **Step 2: Create a new Android Studio project via the Android Studio GUI** *(user-interactive)*

This is a user task — Android Studio's project creation wizard is the path of least resistance. Open Android Studio, **File → New → New Project**:
- Template: **Empty Activity**
- Name: **Claude Display**
- Package name: **com.claudedisplay**
- Save location: **B:\Projects\ClaudeDisplay\packages\android**
- Language: **Kotlin**
- Build configuration: **Kotlin DSL (build.gradle.kts)**
- Minimum SDK: **API 29 (Android 10)** — DAT requires this
- AGP: latest stable

Click Finish. Android Studio scaffolds the project.

- [ ] **Step 3: Verify the scaffold builds**

From repo root:
```
cd packages/android
./gradlew assembleDebug
```

On Windows PowerShell: `.\gradlew.bat assembleDebug`.

Expected: BUILD SUCCESSFUL with no errors. An APK lands under `packages/android/app/build/outputs/apk/debug/`.

- [ ] **Step 4: Install on the connected device + smoke launch**

```
adb devices
./gradlew installDebug
adb shell am start -n com.claudedisplay/.MainActivity
```

Expected: the device's screen shows the default "Hello Android" Compose activity from the wizard.

- [ ] **Step 5: Add the Android workspace to .gitignore**

Append to repo-root `.gitignore`:

```
# Android
packages/android/.gradle/
packages/android/build/
packages/android/app/build/
packages/android/local.properties
packages/android/.idea/
packages/android/captures/
packages/android/*.iml
packages/android/app/*.iml
```

- [ ] **Step 6: Commit**

```
git add packages/android .gitignore
git commit -m "feat(android): bootstrap android studio project"
```

---

## Task 2 (SPIKE): HFP audio capture from the glasses mic

**Goal of this task:** prove `AudioManager.startBluetoothSco()` + `MediaRecorder` (or `AudioRecord`) can capture audio sourced from the **glasses' microphone** — not the phone's mic. We don't care about quality, only that the byte stream is genuinely from the glasses (test by speaking near the glasses but far from the phone).

**Files:**
- Modify: `packages/android/app/src/main/AndroidManifest.xml`
- Create: `packages/android/app/src/main/kotlin/com/claudedisplay/audio/BluetoothScoController.kt`
- Modify: `packages/android/app/src/main/kotlin/com/claudedisplay/MainActivity.kt` (temporary spike UI)

- [ ] **Step 1: Add Bluetooth + audio permissions**

Edit `AndroidManifest.xml`. Inside `<manifest>` (above `<application>`):

```xml
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

- [ ] **Step 2: Write `BluetoothScoController.kt`**

```kotlin
package com.claudedisplay.audio

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Wraps the Bluetooth SCO routing dance. After [start] returns successfully,
 * the system default audio input is routed to the connected BT HFP device
 * (the Meta glasses). Call [stop] when done.
 */
class BluetoothScoController(private val context: Context) {
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    suspend fun start(): Boolean = suspendCancellableCoroutine { cont ->
        if (audioManager.isBluetoothScoOn) {
            cont.resume(true); return@suspendCancellableCoroutine
        }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, intent: Intent?) {
                val state = intent?.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1)
                if (state == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
                    try { context.unregisterReceiver(this) } catch (_: Throwable) {}
                    cont.resume(true)
                } else if (state == AudioManager.SCO_AUDIO_STATE_ERROR
                        || state == AudioManager.SCO_AUDIO_STATE_DISCONNECTED) {
                    try { context.unregisterReceiver(this) } catch (_: Throwable) {}
                    cont.resume(false)
                }
            }
        }
        context.registerReceiver(receiver, IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED))
        audioManager.startBluetoothSco()
        audioManager.isBluetoothScoOn = true
        cont.invokeOnCancellation {
            try { context.unregisterReceiver(receiver) } catch (_: Throwable) {}
        }
    }

    fun stop() {
        try { audioManager.stopBluetoothSco() } catch (_: Throwable) {}
        audioManager.isBluetoothScoOn = false
    }
}
```

- [ ] **Step 3: Add a temporary spike screen to MainActivity**

Replace `MainActivity.kt` body with:

```kotlin
package com.claudedisplay

import android.Manifest
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.claudedisplay.audio.BluetoothScoController
import kotlinx.coroutines.launch
import java.io.File

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { SpikeUI(applicationContext, this) }
    }
}

@Composable
fun SpikeUI(ctx: android.content.Context, activity: ComponentActivity) {
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf("idle") }
    var lastFile by remember { mutableStateOf<File?>(null) }
    val sco = remember { BluetoothScoController(ctx) }
    var recorder by remember { mutableStateOf<MediaRecorder?>(null) }

    val permLauncher = activity.registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* ignore — try and catch failure */ }

    LaunchedEffect(Unit) {
        val needed = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            needed += Manifest.permission.BLUETOOTH_CONNECT
        }
        permLauncher.launch(needed.toTypedArray())
    }

    MaterialTheme {
        Column(modifier = Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("HFP audio capture spike")
            Text("Status: $status")
            Button(onClick = {
                scope.launch {
                    status = "starting SCO…"
                    val ok = sco.start()
                    if (!ok) { status = "SCO failed"; return@launch }
                    val file = File(ctx.filesDir, "spike-${System.currentTimeMillis()}.m4a")
                    val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(ctx) else MediaRecorder()
                    rec.setAudioSource(MediaRecorder.AudioSource.MIC)
                    rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                    rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                    rec.setOutputFile(file.absolutePath)
                    rec.prepare()
                    rec.start()
                    recorder = rec
                    lastFile = file
                    status = "recording → ${file.name}"
                }
            }) { Text("Start") }

            Button(onClick = {
                scope.launch {
                    try { recorder?.stop(); recorder?.release() } catch (_: Throwable) {}
                    recorder = null
                    sco.stop()
                    status = "stopped → ${lastFile?.absolutePath ?: "(none)"}"
                }
            }) { Text("Stop") }

            lastFile?.let { Text("Saved: ${it.absolutePath} (${it.length()} bytes)") }
        }
    }
}
```

- [ ] **Step 4: Build, install, run on device**

```
./gradlew installDebug
adb shell am start -n com.claudedisplay/.MainActivity
```

- [ ] **Step 5 (MANUAL / USER): Verify HFP capture comes from glasses mic**

On the phone:
1. Grant the permissions when prompted.
2. Make sure the glasses are connected via the Meta AI app (BT shows them as a headset).
3. Tap **Start**. Status should read "recording → spike-XXX.m4a".
4. **Walk into another room from your phone but keep the glasses on**. Say something distinctive ("the quick brown fox").
5. Come back. Tap **Stop**.
6. Pull the recording off the device:

   ```
   adb pull /data/data/com.claudedisplay/files/spike-<timestamp>.m4a
   ```

   (Or use the Files app on the phone.)

7. Play it back. **Did it capture your voice from across the room?**
   - **Yes** → the glasses mic IS the input source. HFP routing works. Plan continues with `SpeechRecognizer`.
   - **No (silent file, or only captured phone mic)** → HFP isn't routing as we expect. Halt the plan, report, and we pivot. Likely pivots: stream raw `AudioRecord` PCM to Whisper-via-Workers-AI, or fall back to phone-mic-only.

- [ ] **Step 6: Commit (regardless of spike result — the code is informative either way)**

```
git add packages/android/app/src/main/AndroidManifest.xml \
        packages/android/app/src/main/kotlin/com/claudedisplay/audio/BluetoothScoController.kt \
        packages/android/app/src/main/kotlin/com/claudedisplay/MainActivity.kt
git commit -m "spike(android): HFP audio capture from glasses mic"
```

**If the spike fails, STOP HERE and escalate to the human.** Continuing assumes HFP capture works.

---

## Task 3 (SPIKE): `SpeechRecognizer` over the BT HFP source

**Goal:** confirm `SpeechRecognizer` actually returns text when listening to the BT-routed glasses mic.

**Files:**
- Modify: `MainActivity.kt` (extend the spike UI with a SR button)

- [ ] **Step 1: Add `SpeechCapture.kt` skeleton**

Create `packages/android/app/src/main/kotlin/com/claudedisplay/audio/SpeechCapture.kt`:

```kotlin
package com.claudedisplay.audio

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

class SpeechCapture(private val context: Context) {
    private var sr: SpeechRecognizer? = null
    var onPartial: (String) -> Unit = {}
    var onFinal: (String) -> Unit = {}
    var onError: (Int) -> Unit = {}

    fun isAvailable(): Boolean = SpeechRecognizer.isRecognitionAvailable(context)

    fun start() {
        if (sr != null) return
        sr = SpeechRecognizer.createSpeechRecognizer(context).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(p0: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(p0: Float) {}
                override fun onBufferReceived(p0: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onError(error: Int) { onError(error); release() }
                override fun onPartialResults(results: Bundle?) {
                    results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(onPartial)
                }
                override fun onResults(results: Bundle?) {
                    results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(onFinal)
                    release()
                }
                override fun onEvent(p0: Int, p1: Bundle?) {}
            })
            startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            })
        }
    }

    fun stop() { sr?.stopListening() }

    private fun release() {
        try { sr?.destroy() } catch (_: Throwable) {}
        sr = null
    }
}
```

- [ ] **Step 2: Extend the spike UI with a "Recognize" button**

Add to `MainActivity.kt`'s `SpikeUI` Compose function (inside the same Column):

```kotlin
var transcript by remember { mutableStateOf("") }
val capture = remember { com.claudedisplay.audio.SpeechCapture(ctx) }
Button(onClick = {
    scope.launch {
        status = "starting SCO for SR…"
        val ok = sco.start()
        if (!ok) { status = "SCO failed"; return@launch }
        if (!capture.isAvailable()) { status = "SR unavailable"; sco.stop(); return@launch }
        capture.onPartial = { transcript = it; status = "partial: $it" }
        capture.onFinal = { transcript = it; status = "final: $it"; sco.stop() }
        capture.onError = { status = "SR error code $it"; sco.stop() }
        capture.start()
        status = "listening…"
    }
}) { Text("Recognize (glasses mic)") }
Text("Transcript: $transcript")
```

- [ ] **Step 3: Install + run + manual test**

```
./gradlew installDebug
adb shell am start -n com.claudedisplay/.MainActivity
```

On phone: connect glasses (Meta AI app, normal pairing). Tap **Recognize**. Wait ~1s for "listening…". Speak something clear into the glasses (not into the phone). Verify:
- Partial results appear in the status line.
- A final transcript appears matching what you said.

**If SR returns text** → record what the SR error code map (if any errors) for the README, and proceed to Task 4.

**If SR errors with `ERROR_SPEECH_TIMEOUT` (6)** → the mic is being routed but Google's SR didn't pick up the 8 kHz HFP signal well. Try increasing volume / proximity. If still bad, pivot to **streaming raw PCM to Workers AI Whisper**:

> Pivot Plan 4 to: replace `SpeechRecognizer` with raw `AudioRecord` capture at 16 kHz mono → encrypted upload via WS or HTTPS to relay's `/api/stt` route → Workers AI `@cf/openai/whisper` → returned transcript → use the same downstream pipeline. This adds one task: an `/api/stt` route in the Worker that calls `env.AI.run('@cf/openai/whisper', { audio })`. The interop layer (crypto, WS, pairing) is unchanged.

**If SR errors with `ERROR_NETWORK` (2) or `ERROR_NO_MATCH` (7)** → ensure the phone has Google Services + internet. Retry. If persistent, same Whisper pivot.

Decide based on results and proceed. If pivoting, write the pivot details into this plan inline before continuing.

- [ ] **Step 4: Commit**

```
git add packages/android/app/src/main/kotlin/com/claudedisplay/audio/SpeechCapture.kt \
        packages/android/app/src/main/kotlin/com/claudedisplay/MainActivity.kt
git commit -m "spike(android): SpeechRecognizer over BT HFP source"
```

---

## Task 4: Wire DAT SDK (Maven repo + init)

**Files:**
- Modify: `packages/android/settings.gradle.kts` (DAT Maven repo)
- Create: `packages/android/local.properties` (GitHub PAT — not committed)
- Modify: `packages/android/libs/libs.versions.toml`
- Modify: `packages/android/app/build.gradle.kts`
- Modify: `packages/android/app/src/main/AndroidManifest.xml`
- Create: `packages/android/app/src/main/kotlin/com/claudedisplay/ClaudeDisplayApp.kt`

- [ ] **Step 1: Set the GitHub PAT**

```
echo "github_token=ghp_XXXXXXXXXXXX" >> packages/android/local.properties
```

Replace with a real PAT that has `read:packages` scope. The file is gitignored.

- [ ] **Step 2: Add DAT Maven repo to `settings.gradle.kts`**

Use the exact block from the mwdat-android plugin's getting-started skill (paste it under the existing `dependencyResolutionManagement` block):

```kotlin
import java.util.Properties

val localProperties = Properties().apply {
    val f = rootDir.resolve("local.properties")
    if (f.exists()) load(f.inputStream())
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven {
            url = uri("https://maven.pkg.github.com/facebook/meta-wearables-dat-android")
            credentials {
                username = ""
                password = System.getenv("GITHUB_TOKEN")
                    ?: localProperties.getProperty("github_token")
            }
        }
    }
}
```

- [ ] **Step 3: Declare DAT deps in `libs.versions.toml`**

```toml
[versions]
mwdat = "0.7.0"

[libraries]
mwdat-core = { group = "com.meta.wearable", name = "mwdat-core", version.ref = "mwdat" }
```

- [ ] **Step 4: Add to `app/build.gradle.kts` dependencies**

```kotlin
implementation(libs.mwdat.core)
```

- [ ] **Step 5: Add the DAT meta-data tag to AndroidManifest**

Inside `<application>`:

```xml
<meta-data
    android:name="com.meta.wearable.mwdat.APPLICATION_ID"
    android:value="0" />
```

(`0` is the Developer Mode value.)

- [ ] **Step 6: Create the Application class**

`ClaudeDisplayApp.kt`:

```kotlin
package com.claudedisplay

import android.app.Application
import android.util.Log
import com.meta.wearable.dat.core.Wearables

class ClaudeDisplayApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Wearables.initialize(this)
            .onFailure { error, _ ->
                Log.e("ClaudeDisplay", "DAT init failed: ${error.description}")
            }
    }
}
```

Register it in `AndroidManifest.xml`:

```xml
<application
    android:name=".ClaudeDisplayApp"
    ...>
```

- [ ] **Step 7: Build + smoke**

```
./gradlew assembleDebug
```

Expected: BUILD SUCCESSFUL. If Gradle fails to resolve `mwdat-core`, the PAT setup is wrong — check `local.properties` and PAT scope.

- [ ] **Step 8: Commit (not local.properties)**

```
git add packages/android/settings.gradle.kts \
        packages/android/libs/libs.versions.toml \
        packages/android/app/build.gradle.kts \
        packages/android/app/src/main/AndroidManifest.xml \
        packages/android/app/src/main/kotlin/com/claudedisplay/ClaudeDisplayApp.kt
git commit -m "feat(android): wire DAT SDK + Application init"
```

---

## Task 5: Crypto envelope (Kotlin) + interop check

**Files:**
- Modify: `packages/android/libs/libs.versions.toml` (add Lazysodium)
- Modify: `packages/android/app/build.gradle.kts`
- Create: `packages/android/app/src/main/kotlin/com/claudedisplay/crypto/CryptoEnvelope.kt`
- Create: `packages/android/app/src/androidTest/kotlin/com/claudedisplay/crypto/CryptoEnvelopeTest.kt`

Lazysodium-android is the canonical JNI binding for libsodium on Android. The wire format must be byte-identical to the daemon's libsodium (Plan 2) and TweetNaCl (Plan 3) implementations — namely `nonce(24) || ciphertext`, base64-encoded.

- [ ] **Step 1: Add dependency**

`libs.versions.toml`:
```toml
[versions]
lazysodium = "5.1.4"

[libraries]
lazysodium-android = { group = "com.goterl", name = "lazysodium-android", version.ref = "lazysodium" }
jna = { group = "net.java.dev.jna", name = "jna", version = "5.13.0@aar" }
```

`app/build.gradle.kts`:
```kotlin
implementation(libs.lazysodium.android)
implementation(libs.jna)
```

(JNA is required by Lazysodium-android for native loading.)

- [ ] **Step 2: Write `CryptoEnvelope.kt`**

```kotlin
package com.claudedisplay.crypto

import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import com.goterl.lazysodium.utils.Base64MessageEncoder
import com.goterl.lazysodium.utils.Key
import com.goterl.lazysodium.utils.KeyPair
import java.nio.charset.StandardCharsets
import java.security.SecureRandom

object CryptoEnvelope {
    private val sodium = LazySodiumAndroid(SodiumAndroid(), StandardCharsets.UTF_8, Base64MessageEncoder())
    private val rng = SecureRandom()
    private const val NONCE_BYTES = 24
    private const val PUB_BYTES = 32
    private const val SECRET_BYTES = 32

    fun generateKeyPair(): KeyPair = sodium.cryptoBoxKeypair()

    fun encrypt(plaintext: String, recipientPubB64: String, mySecretB64: String): String {
        val recipient = base64Decode(recipientPubB64)
        val mine = base64Decode(mySecretB64)
        val nonce = ByteArray(NONCE_BYTES).also { rng.nextBytes(it) }
        val pt = plaintext.toByteArray(StandardCharsets.UTF_8)
        val ct = ByteArray(pt.size + 16)
        val ok = sodium.cryptoBoxEasy(ct, pt, pt.size.toLong(), nonce, recipient, mine)
        require(ok) { "cryptoBoxEasy failed" }
        return base64Encode(nonce + ct)
    }

    fun decrypt(ctB64: String, senderPubB64: String, mySecretB64: String): String {
        val raw = base64Decode(ctB64)
        require(raw.size > NONCE_BYTES + 16) { "ciphertext too short" }
        val nonce = raw.copyOfRange(0, NONCE_BYTES)
        val ct = raw.copyOfRange(NONCE_BYTES, raw.size)
        val sender = base64Decode(senderPubB64)
        val mine = base64Decode(mySecretB64)
        val pt = ByteArray(ct.size - 16)
        val ok = sodium.cryptoBoxOpenEasy(pt, ct, ct.size.toLong(), nonce, sender, mine)
        require(ok) { "decrypt failed (wrong key or tampered)" }
        return String(pt, StandardCharsets.UTF_8)
    }

    fun base64Encode(bytes: ByteArray): String =
        android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
    fun base64Decode(s: String): ByteArray =
        android.util.Base64.decode(s, android.util.Base64.DEFAULT)
}
```

- [ ] **Step 3: Add instrumented test**

`CryptoEnvelopeTest.kt`:

```kotlin
package com.claudedisplay.crypto

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CryptoEnvelopeTest {
    @Test fun roundTrip() {
        val alice = CryptoEnvelope.generateKeyPair()
        val bob = CryptoEnvelope.generateKeyPair()
        val ct = CryptoEnvelope.encrypt(
            "hello", bob.publicKey.asHexString,
            alice.secretKey.asHexString,
        )
        // Use base64 actually — convert alice/bob with our helper
        val pt = CryptoEnvelope.decrypt(
            ct,
            CryptoEnvelope.base64Encode(alice.publicKey.asBytes),
            CryptoEnvelope.base64Encode(bob.secretKey.asBytes),
        )
        assertEquals("hello", pt)
    }
    // Add tamper + wrong-recipient tests once the round-trip above passes
}
```

The test above uses Lazysodium's `KeyPair` for keys, then converts to our base64 format. Adjust if Lazysodium's API surface differs at install time; the contract that matters is: `encrypt` returns a base64 of `nonce || ciphertext` and `decrypt` consumes the same format.

- [ ] **Step 4: Run the instrumented test**

```
./gradlew connectedDebugAndroidTest
```

Expected: 1 test passes.

- [ ] **Step 5: Cross-language interop**

Manually verify a Kotlin-encrypted message decrypts on the daemon (and vice versa). Steps:

1. In an Android Studio scratch session or via `adb shell am instrument`, log out: keypair, ciphertext for a known plaintext.
2. On PC, run a small Node script (in `packages/relay/scripts/decode-kotlin-ct.mjs`, temporary):

   ```js
   import sodium from 'libsodium-wrappers';
   await sodium.ready;
   const senderPubB64 = process.argv[2];
   const recipientPrivB64 = process.argv[3];
   const ctB64 = process.argv[4];
   const raw = sodium.from_base64(ctB64, sodium.base64_variants.ORIGINAL);
   const nonce = raw.subarray(0, sodium.crypto_box_NONCEBYTES);
   const ct = raw.subarray(sodium.crypto_box_NONCEBYTES);
   const sender = sodium.from_base64(senderPubB64, sodium.base64_variants.ORIGINAL);
   const recip = sodium.from_base64(recipientPrivB64, sodium.base64_variants.ORIGINAL);
   console.log(sodium.to_string(sodium.crypto_box_open_easy(ct, nonce, sender, recip)));
   ```

3. Run: `node packages/relay/scripts/decode-kotlin-ct.mjs <senderPubB64> <recipientPrivB64> <ctB64>` — expect to see the original plaintext.

Delete the temporary script after success.

- [ ] **Step 6: Commit**

```
git add packages/android/libs/libs.versions.toml \
        packages/android/app/build.gradle.kts \
        packages/android/app/src/main/kotlin/com/claudedisplay/crypto/CryptoEnvelope.kt \
        packages/android/app/src/androidTest/kotlin/com/claudedisplay/crypto/CryptoEnvelopeTest.kt
git commit -m "feat(android): libsodium crypto envelope interop-tested with daemon"
```

---

## Task 6: Pairing — App Link intent filter + payload parser + secure storage

**Files:**
- Modify: `packages/android/app/src/main/AndroidManifest.xml`
- Create: `packages/relay/glasses-app/.well-known/assetlinks.json`
- Modify: `packages/relay/scripts/build.mjs` (copy `.well-known/` into dist)
- Create: `packages/android/app/src/main/kotlin/com/claudedisplay/pairing/PairingPayload.kt`
- Create: `packages/android/app/src/main/kotlin/com/claudedisplay/pairing/PairingStore.kt`

- [ ] **Step 1: Add the App Link intent filter to AndroidManifest**

Replace the `MainActivity` activity block with:

```xml
<activity
    android:name=".MainActivity"
    android:exported="true">
    <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
    </intent-filter>
    <intent-filter android:autoVerify="true">
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="https"
              android:host="claude-display.brunofernandeslopes.workers.dev"
              android:pathPattern="/.*" />
    </intent-filter>
</activity>
```

- [ ] **Step 2: Get the app's SHA-256 signing cert fingerprint**

```
./gradlew signingReport
```

Find the `SHA-256` line under the `debug` variant. Save it for the next step.

- [ ] **Step 3: Create `assetlinks.json`**

`packages/relay/glasses-app/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.claudedisplay",
      "sha256_cert_fingerprints": ["<SHA-256 FROM SIGNING REPORT>"]
    }
  }
]
```

Replace the placeholder with the actual fingerprint.

- [ ] **Step 4: Make sure `.well-known/` ships in the relay build**

Edit `packages/relay/scripts/build.mjs` — `cpSync` already copies the entire `glasses-app` directory recursively, so `.well-known/` will be included as long as the source path exists. Verify:

```
ls packages/relay/glasses-app/.well-known/
```

Should show `assetlinks.json`.

- [ ] **Step 5: Deploy and verify**

```
npm run deploy -w packages/relay
curl -s https://claude-display.brunofernandeslopes.workers.dev/.well-known/assetlinks.json | head -20
```

Expected: returns the JSON with the fingerprint.

- [ ] **Step 6: Write `PairingPayload.kt`**

```kotlin
package com.claudedisplay.pairing

import android.net.Uri
import android.util.Base64
import org.json.JSONObject

data class PairingPayload(
    val version: Int,
    val channelId: String,
    val daemonPub: String,
    val relayUrl: String,
)

object PairingPayloadParser {
    fun parseFromUri(uri: Uri): PairingPayload? {
        val p = uri.getQueryParameter("p") ?: return null
        val padded = p.replace('-', '+').replace('_', '/')
        val pad = padded.length % 4
        val full = if (pad != 0) padded + "=".repeat(4 - pad) else padded
        val json = String(Base64.decode(full, Base64.DEFAULT), Charsets.UTF_8)
        val obj = JSONObject(json)
        if (obj.optInt("v", 0) != 1) return null
        return PairingPayload(
            version = 1,
            channelId = obj.getString("channel_id"),
            daemonPub = obj.getString("daemon_pub"),
            relayUrl = obj.getString("relay_url"),
        )
    }
}
```

- [ ] **Step 7: Write `PairingStore.kt`** (uses EncryptedSharedPreferences)

```kotlin
package com.claudedisplay.pairing

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject

data class PairedState(
    val channelId: String,
    val daemonPub: String,
    val relayUrl: String,
    val clientPub: String,
    val clientPriv: String,
)

class PairingStore(context: Context) {
    private val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
    private val prefs = EncryptedSharedPreferences.create(
        context, "pairing", masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun load(): PairedState? {
        val raw = prefs.getString("v1", null) ?: return null
        val obj = JSONObject(raw)
        return PairedState(
            channelId = obj.getString("channelId"),
            daemonPub = obj.getString("daemonPub"),
            relayUrl = obj.getString("relayUrl"),
            clientPub = obj.getString("clientPub"),
            clientPriv = obj.getString("clientPriv"),
        )
    }

    fun save(s: PairedState) {
        prefs.edit().putString("v1", JSONObject(mapOf(
            "channelId" to s.channelId,
            "daemonPub" to s.daemonPub,
            "relayUrl" to s.relayUrl,
            "clientPub" to s.clientPub,
            "clientPriv" to s.clientPriv,
        )).toString()).apply()
    }

    fun clear() { prefs.edit().remove("v1").apply() }
}
```

Add the security-crypto dep to `libs.versions.toml`:

```toml
androidx-security-crypto = { group = "androidx.security", name = "security-crypto", version = "1.1.0-alpha06" }
```

And in `app/build.gradle.kts`:

```kotlin
implementation(libs.androidx.security.crypto)
```

- [ ] **Step 8: Smoke — install + open the pairing URL**

```
./gradlew installDebug
```

In the daemon terminal: run `mw-claude pair --relay-url wss://claude-display.brunofernandeslopes.workers.dev/api/ws`. Copy the URL. On the phone, open it (via QR scan or paste into a browser). The phone should offer **Claude Display** (our app) as a choice. Pick it. The app launches — but doesn't yet handle the payload (Task 7 wires that).

- [ ] **Step 9: Commit**

```
git add packages/relay/glasses-app/.well-known \
        packages/android/app/src/main/AndroidManifest.xml \
        packages/android/libs/libs.versions.toml \
        packages/android/app/build.gradle.kts \
        packages/android/app/src/main/kotlin/com/claudedisplay/pairing
git commit -m "feat(android): app link pairing + secure storage"
```

---

## Task 7: Pairing UI + relay client + push-to-talk

**Files:**
- Replace: `packages/android/app/src/main/kotlin/com/claudedisplay/MainActivity.kt`
- Create: `packages/android/app/src/main/kotlin/com/claudedisplay/ui/MainScreen.kt`
- Create: `packages/android/app/src/main/kotlin/com/claudedisplay/relay/RelayClient.kt`

- [ ] **Step 1: Write the RelayClient**

`RelayClient.kt`:

```kotlin
package com.claudedisplay.relay

import android.util.Log
import com.claudedisplay.crypto.CryptoEnvelope
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.Response
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

data class PeerKeys(val mySecretB64: String, val peerPubB64: String, val myPubB64: String)

class RelayClient(
    private val relayUrl: String,
    private val channelId: String,
    private val keys: PeerKeys,
) {
    private val http = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private var ws: WebSocket? = null
    private var stopped = false
    private var backoff = 500L
    private val _status = MutableSharedFlow<String>(replay = 1, extraBufferCapacity = 8)
    val status: SharedFlow<String> = _status
    private val _replies = MutableSharedFlow<String>(extraBufferCapacity = 32)
    val replies: SharedFlow<String> = _replies

    fun start() {
        if (stopped) return
        val url = "$relayUrl?channel=$channelId&role=client"
        val req = Request.Builder().url(url).build()
        ws = http.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                _status.tryEmit("connecting…")
                val hello = JSONObject(mapOf(
                    "type" to "hello",
                    "client_pub" to keys.myPubB64,
                )).toString()
                webSocket.send(hello)
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                val f = try { JSONObject(text) } catch (_: Throwable) { return }
                when (f.optString("type")) {
                    "hello_ack", "peer_connect" -> { backoff = 500; _status.tryEmit("paired & encrypted") }
                    "peer_disconnect" -> _status.tryEmit("daemon disconnected — waiting")
                    "msg" -> {
                        val ct = f.optString("ct").takeIf { it.isNotEmpty() } ?: return
                        try {
                            val pt = CryptoEnvelope.decrypt(ct, keys.peerPubB64, keys.mySecretB64)
                            val obj = JSONObject(pt)
                            _status.tryEmit("paired & encrypted")
                            if (obj.optString("type") == "reply") {
                                _replies.tryEmit(obj.optString("text"))
                            }
                        } catch (t: Throwable) {
                            _status.tryEmit("decrypt error: ${t.message}")
                        }
                    }
                }
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (stopped) return
                _status.tryEmit("disconnected — reconnecting in ${backoff/1000}s")
                Thread.sleep(backoff)
                backoff = (backoff * 2).coerceAtMost(10000)
                start()
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e("RelayClient", "ws error", t)
                webSocket.close(1011, "error")
            }
        })
    }

    fun send(textObj: JSONObject) {
        val pt = textObj.toString()
        val ct = CryptoEnvelope.encrypt(pt, keys.peerPubB64, keys.mySecretB64)
        ws?.send(JSONObject(mapOf("type" to "msg", "ct" to ct)).toString())
    }

    fun stop() { stopped = true; ws?.close(1000, "bye") }
}
```

(Note: real production-quality reconnect would use Kotlin coroutines + delay, not `Thread.sleep`. Acceptable for v1.)

Add OkHttp to `libs.versions.toml`:

```toml
okhttp = { group = "com.squareup.okhttp3", name = "okhttp", version = "4.12.0" }
```

And in `app/build.gradle.kts`:
```kotlin
implementation(libs.okhttp)
```

- [ ] **Step 2: Write `MainScreen.kt`**

```kotlin
package com.claudedisplay.ui

import android.content.Context
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.claudedisplay.audio.BluetoothScoController
import com.claudedisplay.audio.SpeechCapture
import com.claudedisplay.crypto.CryptoEnvelope
import com.claudedisplay.pairing.PairedState
import com.claudedisplay.pairing.PairingPayloadParser
import com.claudedisplay.pairing.PairingStore
import com.claudedisplay.relay.PeerKeys
import com.claudedisplay.relay.RelayClient
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
fun MainScreen(ctx: Context, pairingUri: Uri?) {
    val scope = rememberCoroutineScope()
    val store = remember { PairingStore(ctx) }
    val sco = remember { BluetoothScoController(ctx) }
    val capture = remember { SpeechCapture(ctx) }

    var paired by remember { mutableStateOf(store.load()) }
    var status by remember { mutableStateOf("initializing…") }
    var transcript by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var relay by remember { mutableStateOf<RelayClient?>(null) }

    // Consume incoming pairing URI on first composition.
    LaunchedEffect(pairingUri) {
        if (pairingUri != null) {
            val payload = PairingPayloadParser.parseFromUri(pairingUri)
            if (payload != null) {
                val existing = paired
                if (existing?.channelId == payload.channelId) {
                    status = "already paired (idempotent)"
                } else {
                    val kp = CryptoEnvelope.generateKeyPair()
                    val newState = PairedState(
                        channelId = payload.channelId,
                        daemonPub = payload.daemonPub,
                        relayUrl = payload.relayUrl,
                        clientPub = CryptoEnvelope.base64Encode(kp.publicKey.asBytes),
                        clientPriv = CryptoEnvelope.base64Encode(kp.secretKey.asBytes),
                    )
                    store.save(newState)
                    paired = newState
                    status = "paired — connecting"
                }
            } else {
                status = "pairing URI invalid"
            }
        }
    }

    // Open relay client once paired.
    LaunchedEffect(paired) {
        val p = paired ?: return@LaunchedEffect
        val client = RelayClient(
            relayUrl = p.relayUrl,
            channelId = p.channelId,
            keys = PeerKeys(p.clientPriv, p.daemonPub, p.clientPub),
        )
        relay = client
        scope.launch { client.status.collect { status = it } }
        scope.launch { client.replies.collect { reply ->
            transcript = transcript + ("claude" to reply)
        }}
        client.start()
    }

    if (paired == null) {
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Not paired")
            Text("Run `mw-claude pair --relay-url wss://…/api/ws` on your PC")
            Text("and open the printed URL on this phone.")
            Text("Status: $status")
        }
        return
    }

    Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(status)
        Button(onClick = {
            scope.launch {
                val ok = sco.start()
                if (!ok) { status = "BT SCO failed"; return@launch }
                if (!capture.isAvailable()) { status = "SR unavailable"; sco.stop(); return@launch }
                capture.onPartial = { status = "… $it" }
                capture.onFinal = { text ->
                    sco.stop()
                    status = "sent: $text"
                    transcript = transcript + ("you" to text)
                    relay?.send(JSONObject(mapOf("type" to "prompt", "text" to text)))
                }
                capture.onError = { code -> sco.stop(); status = "SR error $code" }
                capture.start()
                status = "listening (glasses mic)…"
            }
        }) { Text("Push to talk") }

        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            transcript.forEach { (kind, t) ->
                Text("${kind.uppercase()}: $t")
            }
        }
    }
}
```

- [ ] **Step 3: Replace `MainActivity.kt` with the production entry**

```kotlin
package com.claudedisplay

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import com.claudedisplay.ui.MainScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pairingUri = intent?.data
        setContent { MaterialTheme { MainScreen(applicationContext, pairingUri) } }
    }
}
```

(Note: this drops the spike UI from Tasks 2–3 — that was throwaway scaffolding. The audio + SR functions it exercised are now in `BluetoothScoController` and `SpeechCapture`, called from `MainScreen`.)

- [ ] **Step 4: Build + install**

```
./gradlew installDebug
```

- [ ] **Step 5: Commit**

```
git add packages/android/app/src/main/kotlin/com/claudedisplay/MainActivity.kt \
        packages/android/app/src/main/kotlin/com/claudedisplay/ui/MainScreen.kt \
        packages/android/app/src/main/kotlin/com/claudedisplay/relay/RelayClient.kt \
        packages/android/libs/libs.versions.toml \
        packages/android/app/build.gradle.kts
git commit -m "feat(android): pairing + relay client + push-to-talk UI"
```

---

## Task 8: End-to-end test on device

**Files:** none.

The acceptance test for Plan 4.

- [ ] **Step 1: Clean slate**

On PC: `Remove-Item $env:USERPROFILE\.mw-claude\config.json -ErrorAction SilentlyContinue`.
On phone (Android app): in app settings or via `adb shell pm clear com.claudedisplay`, clear the app data.

- [ ] **Step 2: Pair**

PC: `node packages/mw-claude/dist/cli.js pair --relay-url wss://claude-display.brunofernandeslopes.workers.dev/api/ws`.

Phone: scan the QR with the phone camera. Phone offers Chrome and Claude Display as openers. Pick **Claude Display**. App launches showing "paired — connecting" → "paired & encrypted". PC terminal prints "Paired!" and exits.

- [ ] **Step 3: Run daemon + start session**

PC: `node packages/mw-claude/dist/cli.js run`. Claude TUI appears.

- [ ] **Step 4: Push-to-talk via glasses mic**

On phone, tap **Push to talk**. Speak — into the glasses, not the phone (test by moving away from phone). The transcript appears on the phone, the prompt arrives in the Claude TUI, and Claude's reply shows in **both** the phone transcript area AND the glasses webapp (because the glasses are still paired to the same channel from Plan 3 and receive the same `reply` frame).

- [ ] **Step 5: Verify reconnect**

Kill the daemon. Phone shows "daemon disconnected — waiting". Restart the daemon. Phone returns to "paired & encrypted" within ~10 s. Send another prompt.

If all of the above works → Plan 4 is done.

---

## Task 9: README + acceptance closeout

**Files:**
- Create: `packages/android/README.md`
- Modify: `packages/mw-claude/README.md`

- [ ] **Step 1: Write `packages/android/README.md`**

Document: requirements (Android Studio, Meta AI app on phone, glasses paired, DAT PAT in local.properties), build (`./gradlew assembleDebug`), install (`./gradlew installDebug`), pair (scan QR from `mw-claude pair`), run (`mw-claude run` + tap-to-talk).

Mention the BT SCO/HFP routing dance, the SR fallback to Whisper if it fails on a given device, and known limits (8 kHz mono HFP audio quality).

- [ ] **Step 2: Update `packages/mw-claude/README.md`** to mention the Android app as the recommended mic source.

- [ ] **Step 3: Commit**

```
git add packages/android/README.md packages/mw-claude/README.md
git commit -m "docs(android): plan 4 README + cross-link mw-claude"
```

---

## Acceptance criteria for Plan 4

1. `./gradlew installDebug` on a Windows host produces an APK and installs it on a connected Android 10+ phone.
2. The phone, with the Meta Display Glasses already BT-paired, can record audio from the glasses' microphone (Task 2 spike).
3. Android `SpeechRecognizer` returns text from the BT-routed glasses-mic input (Task 3 spike); if not, the documented Whisper pivot is in place.
4. Scanning the pairing QR from `mw-claude pair` opens **the Android app** (not Chrome), parses the `?p=` payload, generates a keypair, and persists via EncryptedSharedPreferences.
5. The app connects to the relay, completes the `hello` handshake, and displays "paired & encrypted".
6. Pushing the talk button records glasses-mic audio, transcribes it, encrypts the prompt, sends it via the relay, and the prompt arrives in the Claude Code TUI.
7. Claude's reply is decrypted on the phone, displayed in the app transcript, AND on the existing glasses webapp display.
8. Reconnect works on both sides without re-pairing.

If all 8 hold, Plan 4 is done. The original "hands-free into glasses, see results on glasses display" vision is real.

---

## Risks (final)

1. **Task 2 spike result is the binary fork.** If HFP routing doesn't deliver audio from the glasses mic, the whole architecture pivots. Plan recognizes this and stops at Task 2 for an escalation.
2. **Task 3 spike result is the secondary fork.** If `SpeechRecognizer` works → use it. If not → swap to Whisper-via-Workers-AI (added route + audio upload), keep everything else.
3. **DAT SDK PAT setup** — biggest non-code risk. If the user's GitHub PAT doesn't have `read:packages`, Gradle resolution fails with a 401. Documented in Task 4.
4. **App Links verification** — Digital Asset Links has to succeed for `autoVerify="true"` to take effect; otherwise the phone always shows the "Open with…" picker (still works, just an extra tap per pair). Acceptable degraded mode.
5. **Hibernating reconnect over `Thread.sleep`** — v1 quick-and-dirty. Should migrate to coroutine `delay` in a follow-up.

## Self-review notes

- **Spec coverage:** Plan 4 covers spec §5.1 (voice-in/text-out, but via phone-driven glasses mic instead of webapp-driven mic — same end-user experience). Spec §5.1 *session picker* still deferred to a later plan.
- **No placeholders:** all code blocks are complete. Tasks 2 and 3 are explicitly spikes with documented pivot paths.
- **Decommissioning:** the glasses webapp from Plan 3 remains the display surface. Optional follow-up: DAT-push display from the phone app, removing dependence on the webapp.
- **Type consistency:** `PairedState`, `PeerKeys`, frame types (`hello`, `hello_ack`, `peer_connect`, `peer_disconnect`, `msg`) match the rest of the system. Crypto wire format (nonce ‖ ct, base64 ORIGINAL) consistent with Plans 2–3.
- **Open question parked:** session picker, multi-paired-daemon support, true on-glasses display push (DAT) — all later.
