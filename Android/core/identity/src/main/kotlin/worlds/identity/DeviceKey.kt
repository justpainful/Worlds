package worlds.identity

import android.util.Base64
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.security.MessageDigest
import java.security.SecureRandom

internal fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
internal fun unb64(value: String): ByteArray = Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

/** Ed25519 uses a software key encrypted at rest by Android Keystore. */
internal class DeviceKey(private val seed: ByteArray) {
    init { require(seed.size == 32) }
    private fun key() = Ed25519PrivateKeyParameters(seed, 0)
    fun publicKey(): String = b64(key().generatePublicKey().encoded)
    fun sign(message: String): String {
        val signer = Ed25519Signer(); signer.init(true, key())
        val bytes = message.toByteArray(Charsets.UTF_8); signer.update(bytes, 0, bytes.size)
        return b64(signer.generateSignature())
    }
    fun export(): String = b64(seed)
    companion object {
        fun generate(): DeviceKey = DeviceKey(ByteArray(32).also { SecureRandom().nextBytes(it) })
        fun load(value: String): DeviceKey = DeviceKey(unb64(value))
    }
}

internal fun refreshMessage(deviceId: String, timestamp: Long, token: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8))
    val hex = digest.joinToString("") { "%02x".format(it.toInt() and 255) }
    return "worlds-refresh.v1:$deviceId:$timestamp:$hex"
}
