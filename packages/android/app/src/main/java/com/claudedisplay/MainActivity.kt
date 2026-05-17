package com.claudedisplay

import android.Manifest
import android.content.Context
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.claudedisplay.audio.BluetoothScoController
import com.claudedisplay.audio.SpeechCapture
import com.claudedisplay.pairing.PairedState
import com.claudedisplay.pairing.PairingPayloadParser
import com.claudedisplay.pairing.PairingStore
import com.claudedisplay.relay.PeerKeys
import com.claudedisplay.relay.RelayClient
import com.claudedisplay.ui.theme.ClaudeDisplayTheme
import kotlinx.coroutines.launch
import org.json.JSONObject

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
    val scope = rememberCoroutineScope()
    val store = remember { PairingStore(ctx) }
    val sco = remember { BluetoothScoController(ctx) }
    val capture = remember { SpeechCapture(ctx) }

    var paired by remember { mutableStateOf(store.load()) }
    var relayStatus by remember { mutableStateOf("initializing…") }
    var uiStatus by remember { mutableStateOf<String?>(null) }
    var transcript by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var relay by remember { mutableStateOf<RelayClient?>(null) }
    var recording by remember { mutableStateOf(false) }
    var talkLabel by remember { mutableStateOf("Push to talk") }

    val permLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* ignore — failure surfaces on use */ }

    LaunchedEffect(Unit) {
        val needed = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            needed += Manifest.permission.BLUETOOTH_CONNECT
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
                relayStatus = "paired — connecting"
            } else {
                relayStatus = "pairing URI invalid (need v2)"
            }
        }
    }

    // Extracted: starts the SCO + SR pipeline. Used by the button onClick AND
    // by the trigger_record handler so glasses-side EMG/D-pad taps also fire it.
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

    // Open relay client once paired. DisposableEffect tears down the old client
    // when `paired` changes (e.g. re-pairing via a new ?p=... URL), so we never
    // end up with two RelayClients each delivering replies into the transcript.
    DisposableEffect(paired) {
        val p = paired
        if (p == null) {
            onDispose { }
            return@DisposableEffect onDispose { }
        }
        val client = RelayClient(
            relayUrl = p.relayUrl,
            channelId = p.channelId,
            keys = PeerKeys(p.clientPriv, p.daemonPub, p.clientPub),
        )
        val statusJob = scope.launch { client.status.collect { relayStatus = it } }
        val replyJob = scope.launch { client.replies.collect { reply ->
            transcript = transcript + ("claude" to reply)
        }}
        val triggerJob = scope.launch { client.triggers.collect { startPushToTalk() } }
        client.start()
        relay = client
        onDispose {
            statusJob.cancel()
            replyJob.cancel()
            triggerJob.cancel()
            client.stop()
            if (relay === client) relay = null
        }
    }

    if (paired == null) {
        Column(modifier.padding(24.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Not paired", style = MaterialTheme.typography.titleLarge)
            Text("On your PC, run:")
            Text("mw-claude pair --relay-url wss://…/api/ws",
                style = MaterialTheme.typography.bodySmall)
            Text("Then open the printed URL on this phone — Android will offer Claude Display as an opener.")
            Text("Status: $relayStatus", style = MaterialTheme.typography.bodySmall)
        }
        return
    }

    Column(modifier.padding(24.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("relay: $relayStatus", style = MaterialTheme.typography.bodySmall)
        uiStatus?.let { Text(it, style = MaterialTheme.typography.bodySmall) }

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
            modifier = Modifier.fillMaxWidth().height(72.dp)
        ) { Text(talkLabel, style = MaterialTheme.typography.titleMedium) }

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
