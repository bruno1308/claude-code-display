package com.claudedisplay.relay

import android.util.Log
import com.claudedisplay.crypto.CryptoEnvelope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class PeerKeys(val mySecretB64: String, val peerPubB64: String, val myPubB64: String)

class RelayClient(
    private val relayUrl: String,
    private val channelId: String,
    private val keys: PeerKeys,
) {
    private val http = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var ws: WebSocket? = null
    @Volatile private var stopped = false
    @Volatile private var backoffMs = 500L
    private var pingJob: kotlinx.coroutines.Job? = null
    private var pongDeadlineJob: kotlinx.coroutines.Job? = null

    private val _status = MutableSharedFlow<String>(replay = 1, extraBufferCapacity = 8)
    val status: SharedFlow<String> = _status
    private val _replies = MutableSharedFlow<String>(extraBufferCapacity = 32)
    val replies: SharedFlow<String> = _replies
    private val _triggers = MutableSharedFlow<Unit>(extraBufferCapacity = 32)
    val triggers: SharedFlow<Unit> = _triggers

    fun start() { openOnce() }

    fun stop() {
        stopped = true
        try { ws?.close(1000, "bye") } catch (_: Throwable) {}
        scope.cancel()
    }

    fun send(obj: JSONObject) {
        val pt = obj.toString()
        val ct = CryptoEnvelope.encrypt(pt, keys.peerPubB64, keys.mySecretB64)
        ws?.send(JSONObject(mapOf("type" to "msg", "ct" to ct)).toString())
    }

    private fun openOnce() {
        if (stopped) return
        val url = "$relayUrl?channel=$channelId&role=client"
        val req = Request.Builder().url(url).build()
        ws = http.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d("RelayClient", "onOpen url=$url")
                _status.tryEmit("connecting…")
                val hello = JSONObject(mapOf(
                    "type" to "hello",
                    "client_pub" to keys.myPubB64,
                )).toString()
                webSocket.send(hello)
                startHeartbeat(webSocket)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                Log.d("RelayClient", "recv: ${text.take(120)}")
                val f = try { JSONObject(text) } catch (_: Throwable) { return }
                when (f.optString("type")) {
                    "pong" -> {
                        pongDeadlineJob?.cancel()
                        pongDeadlineJob = null
                    }
                    "hello_ack", "peer_connect" -> {
                        backoffMs = 500
                        _status.tryEmit("paired & encrypted")
                    }
                    "peer_disconnect" -> _status.tryEmit("daemon disconnected — waiting")
                    "msg" -> {
                        val ct = f.optString("ct").takeIf { it.isNotEmpty() } ?: return
                        try {
                            val pt = CryptoEnvelope.decrypt(ct, keys.peerPubB64, keys.mySecretB64)
                            val obj = JSONObject(pt)
                            _status.tryEmit("paired & encrypted")
                            when (obj.optString("type")) {
                                "reply" -> _replies.tryEmit(obj.optString("text"))
                                "trigger_record" -> _triggers.tryEmit(Unit)
                                // ignore unknown types
                            }
                        } catch (t: Throwable) {
                            _status.tryEmit("decrypt error: ${t.message}")
                        }
                    }
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d("RelayClient", "onClosed code=$code reason=$reason")
                stopHeartbeat()
                ws = null
                if (stopped) return
                val secs = (backoffMs / 1000).coerceAtLeast(1)
                _status.tryEmit("disconnected — reconnecting in ${secs}s")
                scope.launch {
                    delay(backoffMs)
                    backoffMs = (backoffMs * 2).coerceAtMost(10_000)
                    openOnce()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e("RelayClient", "ws error", t)
                stopHeartbeat()
                webSocket.close(1011, "error")
            }
        })
    }

    /**
     * App-level ping/pong via the DO. OkHttp's WS protocol pings get pongs
     * from Cloudflare's edge proxy (not the DO), so they can't detect a
     * server-side DO drop. Sending an app-level ping forces the DO to respond,
     * proving the WS is end-to-end alive.
     */
    private fun startHeartbeat(webSocket: WebSocket) {
        stopHeartbeat()
        pingJob = scope.launch {
            while (true) {
                delay(20_000)
                if (stopped) return@launch
                webSocket.send("""{"type":"ping"}""")
                pongDeadlineJob = scope.launch {
                    delay(10_000)
                    // No pong within 10s → force a close so reconnect kicks in.
                    Log.w("RelayClient", "no pong — forcing reconnect")
                    try { webSocket.close(1001, "no pong") } catch (_: Throwable) {}
                }
            }
        }
    }

    private fun stopHeartbeat() {
        pingJob?.cancel(); pingJob = null
        pongDeadlineJob?.cancel(); pongDeadlineJob = null
    }
}
