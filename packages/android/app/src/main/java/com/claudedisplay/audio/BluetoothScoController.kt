package com.claudedisplay.audio

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.util.Log
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Routes the system audio input to a connected BT HFP device (Meta glasses).
 *
 * Android 12+ (API 31): uses `setCommunicationDevice(BLUETOOTH_SCO)`.
 * Older: falls back to `startBluetoothSco()`.
 *
 * Either path requires the audio mode to be MODE_IN_COMMUNICATION for the
 * BT mic to actually become the input source.
 */
class BluetoothScoController(private val context: Context) {
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var savedMode = AudioManager.MODE_NORMAL
    private var usedModernApi = false

    suspend fun start(): Boolean {
        savedMode = audioManager.mode
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val btSco = audioManager.availableCommunicationDevices.firstOrNull {
                it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
            }
            if (btSco != null) {
                val ok = audioManager.setCommunicationDevice(btSco)
                usedModernApi = true
                if (!ok) Log.w("ScoController", "setCommunicationDevice returned false")
                // Modern API returns synchronously, no broadcast wait.
                return ok
            }
            // No BT SCO device available — log devices we *did* see.
            Log.w("ScoController", "no BT SCO device found; available=" +
                audioManager.availableCommunicationDevices.joinToString { "${it.type}:${it.productName}" })
            audioManager.mode = savedMode
            return false
        }

        // Legacy path (API < 31).
        return legacyStart()
    }

    fun stop() {
        try {
            if (usedModernApi && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audioManager.clearCommunicationDevice()
            } else {
                audioManager.stopBluetoothSco()
                @Suppress("DEPRECATION")
                audioManager.isBluetoothScoOn = false
            }
        } catch (t: Throwable) {
            Log.w("ScoController", "stop failed", t)
        }
        audioManager.mode = savedMode
        usedModernApi = false
    }

    @Suppress("DEPRECATION")
    private suspend fun legacyStart(): Boolean = suspendCancellableCoroutine { cont ->
        if (audioManager.isBluetoothScoOn) {
            cont.resume(true); return@suspendCancellableCoroutine
        }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, intent: Intent?) {
                val state = intent?.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1)
                when (state) {
                    AudioManager.SCO_AUDIO_STATE_CONNECTED -> {
                        try { context.unregisterReceiver(this) } catch (_: Throwable) {}
                        cont.resume(true)
                    }
                    AudioManager.SCO_AUDIO_STATE_ERROR,
                    AudioManager.SCO_AUDIO_STATE_DISCONNECTED -> {
                        try { context.unregisterReceiver(this) } catch (_: Throwable) {}
                        cont.resume(false)
                    }
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
}
