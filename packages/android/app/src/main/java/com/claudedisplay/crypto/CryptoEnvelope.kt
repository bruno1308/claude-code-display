package com.claudedisplay.crypto

import android.util.Base64
import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import java.nio.charset.StandardCharsets
import java.security.SecureRandom

/**
 * libsodium `crypto_box` envelope, wire-compatible with the daemon's libsodium
 * and the glasses webapp's TweetNaCl. Format: base64(nonce(24) || ciphertext).
 */
object CryptoEnvelope {
    private val sodium = LazySodiumAndroid(SodiumAndroid())
    private val rng = SecureRandom()
    private const val NONCE_BYTES = 24
    private const val MAC_BYTES = 16

    fun encrypt(plaintext: String, recipientPubB64: String, mySecretB64: String): String {
        val recipient = b64dec(recipientPubB64)
        val mine = b64dec(mySecretB64)
        val nonce = ByteArray(NONCE_BYTES).also { rng.nextBytes(it) }
        val pt = plaintext.toByteArray(StandardCharsets.UTF_8)
        val ct = ByteArray(pt.size + MAC_BYTES)
        val ok = sodium.cryptoBoxEasy(ct, pt, pt.size.toLong(), nonce, recipient, mine)
        require(ok) { "cryptoBoxEasy failed" }
        val out = ByteArray(nonce.size + ct.size)
        System.arraycopy(nonce, 0, out, 0, nonce.size)
        System.arraycopy(ct, 0, out, nonce.size, ct.size)
        return b64enc(out)
    }

    fun decrypt(ctB64: String, senderPubB64: String, mySecretB64: String): String {
        val raw = b64dec(ctB64)
        require(raw.size > NONCE_BYTES + MAC_BYTES) { "ciphertext too short" }
        val nonce = raw.copyOfRange(0, NONCE_BYTES)
        val ct = raw.copyOfRange(NONCE_BYTES, raw.size)
        val sender = b64dec(senderPubB64)
        val mine = b64dec(mySecretB64)
        val pt = ByteArray(ct.size - MAC_BYTES)
        val ok = sodium.cryptoBoxOpenEasy(pt, ct, ct.size.toLong(), nonce, sender, mine)
        require(ok) { "decrypt failed (wrong key or tampered)" }
        return String(pt, StandardCharsets.UTF_8)
    }

    private fun b64enc(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun b64dec(s: String): ByteArray = Base64.decode(s, Base64.DEFAULT)
}
