package com.claudedisplay

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
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

        // Battery optimization exemption — without this, Android can kill the
        // foreground service when the app has been idle, which breaks the
        // hands-free flow. Send the user to the system settings dialog once;
        // if they grant it, the OS leaves our service alone.
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!pm.isIgnoringBatteryOptimizations(ctx.packageName)) {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:${ctx.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try { ctx.startActivity(intent) } catch (_: Throwable) {}
        }
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

    // Ensure the foreground service is running once we have a pairing.
    LaunchedEffect(paired, serviceRunning) {
        if (paired != null && !serviceRunning) {
            ctx.startForegroundService(
                Intent(ctx, ClaudeDisplayService::class.java).apply {
                    action = ClaudeDisplayService.ACTION_START
                }
            )
        }
    }

    if (paired == null) {
        Column(modifier.padding(24.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Not paired", style = MaterialTheme.typography.titleLarge)
            Text("On your PC, run:")
            Text(
                "mw-claude pair --relay-url wss://…/api/ws",
                style = MaterialTheme.typography.bodySmall,
            )
            Text("Then open the printed URL on this phone — Android will offer Claude Display as an opener.")
        }
        return
    }

    Column(modifier.padding(24.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("relay: $relayStatus", style = MaterialTheme.typography.bodySmall)
        uiHint?.let { Text(it, style = MaterialTheme.typography.bodySmall) }

        Button(
            onClick = {
                ctx.startService(
                    Intent(ctx, ClaudeDisplayService::class.java).apply {
                        action = ClaudeDisplayService.ACTION_TRIGGER
                    }
                )
            },
            enabled = !recording,
            modifier = Modifier.fillMaxWidth().height(72.dp),
        ) { Text(talkLabel, style = MaterialTheme.typography.titleMedium) }

        Text(
            "(or tap EMG on glasses — works even when this app is in the background)",
            style = MaterialTheme.typography.bodySmall,
        )

        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            transcript.forEach { (kind, t) ->
                Text("${kind.uppercase()}: $t")
            }
        }
    }
}
