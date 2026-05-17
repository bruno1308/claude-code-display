package com.claudedisplay.service

import android.app.NotificationManager
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

    // SpeechRecognizer requires the main thread. RelayClient (OkHttp WS) and
    // BluetoothScoController are both thread-safe so running everything on Main
    // is fine and simplifies dispatcher juggling.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
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
            ACTION_TRIGGER -> {
                ensureRunning()
                startPushToTalk()
            }
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
            if (!ok) {
                ServiceState.uiHint.value = "BT SCO failed"
                updateNotification()
                return@launch
            }
            if (!capture.isAvailable()) {
                ServiceState.uiHint.value = "SR unavailable"
                sco.stop()
                updateNotification()
                return@launch
            }
            capture.onPartial = { ServiceState.talkLabel.value = "… $it" }
            capture.onFinal = { text ->
                sco.stop()
                ServiceState.recording.value = false
                ServiceState.talkLabel.value = "Push to talk"
                ServiceState.uiHint.value = null
                // Send as a DRAFT — the glasses show it for confirmation before
                // shipping to Claude. Glasses sends the actual prompt when the
                // user taps Send. Locally we add a (draft) row for visibility.
                ServiceState.transcript.value = ServiceState.transcript.value + ("draft" to text)
                relay?.send(JSONObject(mapOf("type" to "draft", "text" to text)))
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
            // Tell other peers (the glasses webapp) that the phone is now actively
            // listening, so they can show "Speak now" instead of the waiting state.
            relay?.send(JSONObject(mapOf("type" to "phone_state", "state" to "listening")))
        }
    }

    private fun updateNotification() {
        val text = if (ServiceState.recording.value) "listening (glasses mic)…"
        else ServiceState.relayStatus.value
        val nm = getSystemService(NotificationManager::class.java)
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
