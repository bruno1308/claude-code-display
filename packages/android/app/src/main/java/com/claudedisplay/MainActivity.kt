package com.claudedisplay

import android.Manifest
import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.claudedisplay.audio.BluetoothScoController
import com.claudedisplay.audio.SpeechCapture
import com.claudedisplay.ui.theme.ClaudeDisplayTheme
import kotlinx.coroutines.launch
import java.io.File

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ClaudeDisplayTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    SpikeUI(
                        ctx = applicationContext,
                        activity = this,
                        modifier = Modifier.padding(innerPadding)
                    )
                }
            }
        }
    }
}

@Composable
fun SpikeUI(ctx: Context, activity: ComponentActivity, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf("idle") }
    var lastFile by remember { mutableStateOf<File?>(null) }
    val sco = remember { BluetoothScoController(ctx) }
    var recorder by remember { mutableStateOf<MediaRecorder?>(null) }

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

    Column(
        modifier = modifier.padding(24.dp).fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("HFP audio capture spike", style = MaterialTheme.typography.titleLarge)
        Text("Status: $status")

        Button(
            onClick = {
                scope.launch {
                    status = "starting SCO…"
                    val ok = sco.start()
                    if (!ok) { status = "SCO failed"; return@launch }
                    val file = File(ctx.filesDir, "spike-${System.currentTimeMillis()}.m4a")
                    val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        MediaRecorder(ctx)
                    } else {
                        @Suppress("DEPRECATION") MediaRecorder()
                    }
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
            }
        ) { Text("Start") }

        Button(
            onClick = {
                scope.launch {
                    try { recorder?.stop(); recorder?.release() } catch (_: Throwable) {}
                    recorder = null
                    sco.stop()
                    status = "stopped → ${lastFile?.absolutePath ?: "(none)"}"
                }
            }
        ) { Text("Stop") }

        lastFile?.let { Text("Saved: ${it.absolutePath} (${it.length()} bytes)") }

        HorizontalDivider()
        Text("SpeechRecognizer over BT HFP", style = MaterialTheme.typography.titleMedium)
        var transcript by remember { mutableStateOf("") }
        val capture = remember { SpeechCapture(ctx) }
        Button(
            onClick = {
                scope.launch {
                    transcript = ""
                    status = "starting SCO for SR…"
                    val ok = sco.start()
                    if (!ok) { status = "SCO failed (SR)"; return@launch }
                    if (!capture.isAvailable()) { status = "SR unavailable"; sco.stop(); return@launch }
                    capture.onPartial = { transcript = it; status = "partial: $it" }
                    capture.onFinal = { transcript = it; status = "final: $it"; sco.stop() }
                    capture.onError = { code -> status = "SR error code $code"; sco.stop() }
                    capture.start()
                    status = "listening…"
                }
            }
        ) { Text("Recognize (glasses mic)") }
        Text("Transcript: $transcript")
    }
}
