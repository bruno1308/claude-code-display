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
    var status by remember { mutableStateOf("initializing…") }
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
                status = "paired — connecting"
            } else {
                status = "pairing URI invalid (need v2)"
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
        Column(modifier.padding(24.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Not paired", style = MaterialTheme.typography.titleLarge)
            Text("On your PC, run:")
            Text("mw-claude pair --relay-url wss://…/api/ws",
                style = MaterialTheme.typography.bodySmall)
            Text("Then open the printed URL on this phone — Android will offer Claude Display as an opener.")
            Text("Status: $status", style = MaterialTheme.typography.bodySmall)
        }
        return
    }

    Column(modifier.padding(24.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(status, style = MaterialTheme.typography.bodySmall)

        Button(
            onClick = {
                if (recording) {
                    // stop & send
                    recording = false
                    capture.stop()
                    sco.stop()
                } else {
                    scope.launch {
                        val ok = sco.start()
                        if (!ok) { status = "BT SCO failed"; return@launch }
                        if (!capture.isAvailable()) { status = "SR unavailable"; sco.stop(); return@launch }
                        capture.onPartial = { talkLabel = "… $it" }
                        capture.onFinal = { text ->
                            sco.stop()
                            recording = false
                            talkLabel = "Push to talk"
                            transcript = transcript + ("you" to text)
                            relay?.send(JSONObject(mapOf("type" to "prompt", "text" to text)))
                        }
                        capture.onError = { code ->
                            sco.stop()
                            recording = false
                            talkLabel = "Push to talk"
                            status = "SR error $code"
                        }
                        capture.start()
                        recording = true
                        talkLabel = "Listening… tap to stop"
                        status = "listening (glasses mic)…"
                    }
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
