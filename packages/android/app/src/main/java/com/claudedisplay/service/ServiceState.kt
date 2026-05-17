package com.claudedisplay.service

import kotlinx.coroutines.flow.MutableStateFlow

/**
 * In-process singleton exposing the live state of [ClaudeDisplayService]
 * to the UI via Kotlin flows. The service writes, the UI observes.
 */
object ServiceState {
    val running = MutableStateFlow(false)
    val relayStatus = MutableStateFlow("idle")
    val recording = MutableStateFlow(false)
    val talkLabel = MutableStateFlow("Push to talk")
    val uiHint = MutableStateFlow<String?>(null)
    val transcript = MutableStateFlow<List<Pair<String, String>>>(emptyList())
}
