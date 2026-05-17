package com.claudedisplay.pairing

import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject

data class PairedState(
    val channelId: String,
    val daemonPub: String,
    val relayUrl: String,    // wss://… form
    val clientPub: String,
    val clientPriv: String,
)

object PairingPayloadParser {
    /** Returns PairedState built from a v2 pairing URL `?p=…`, or null. */
    fun parseFromUri(uri: Uri): PairedState? {
        val p = uri.getQueryParameter("p") ?: return null
        val padded = p.replace('-', '+').replace('_', '/')
        val pad = padded.length % 4
        val full = if (pad != 0) padded + "=".repeat(4 - pad) else padded
        val json = String(Base64.decode(full, Base64.DEFAULT), Charsets.UTF_8)
        val obj = JSONObject(json)
        val v = obj.optInt("v", 0)
        if (v != 2) return null  // android app requires v2 (embedded keypair)
        return PairedState(
            channelId = obj.getString("channel_id"),
            daemonPub = obj.getString("daemon_pub"),
            relayUrl = obj.getString("relay_url"),
            clientPub = obj.getString("client_pub"),
            clientPriv = obj.getString("client_priv"),
        )
    }
}

class PairingStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context, "pairing",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun load(): PairedState? {
        val raw = prefs.getString("v2", null) ?: return null
        val o = JSONObject(raw)
        return PairedState(
            channelId = o.getString("channelId"),
            daemonPub = o.getString("daemonPub"),
            relayUrl = o.getString("relayUrl"),
            clientPub = o.getString("clientPub"),
            clientPriv = o.getString("clientPriv"),
        )
    }

    fun save(s: PairedState) {
        prefs.edit().putString("v2", JSONObject(mapOf(
            "channelId" to s.channelId,
            "daemonPub" to s.daemonPub,
            "relayUrl" to s.relayUrl,
            "clientPub" to s.clientPub,
            "clientPriv" to s.clientPriv,
        )).toString()).apply()
    }

    fun clear() { prefs.edit().remove("v2").apply() }
}
