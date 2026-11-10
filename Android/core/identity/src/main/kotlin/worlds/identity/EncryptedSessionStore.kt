package worlds.identity

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** One authenticated encrypted record, atomically replaced before and after token rotation. */
class EncryptedSessionStore(context: Context, private val alias: String = "worlds.identity.v1", fileName: String = "worlds-identity.v1") {
    private val file = AtomicFile(File(context.noBackupFilesDir, fileName))
    init { require(alias.isNotBlank() && fileName != "." && fileName != ".." && fileName.matches(Regex("[A-Za-z0-9._-]+"))) }

    /** The server address is stored inside the encrypted session, including quarantined sessions. */
    fun storedServer(): String? = read()?.let { canonicalBaseUrl(it.getString("baseUrl")) }

    internal fun read(): JSONObject? {
        val raw = try { file.openRead().use { it.readBytes() } } catch (_: java.io.FileNotFoundException) { return null }
        if (raw.size > 512 * 1024) throw IOException("Stored identity is too large")
        try {
            val outer = JSONObject(String(raw, Charsets.UTF_8)); require(outer.getInt("v") == 1)
            val iv = unb64(outer.getString("iv")); require(iv.size == 12)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(create = false), GCMParameterSpec(128, iv))
            cipher.updateAAD(AAD)
            return JSONObject(String(cipher.doFinal(unb64(outer.getString("data"))), Charsets.UTF_8))
        } catch (e: Exception) { throw IOException("Unable to read encrypted identity", e) }
    }

    internal fun write(record: JSONObject) {
        val plain = record.toString().toByteArray(Charsets.UTF_8); require(plain.size <= 256 * 1024)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(create = true)); cipher.updateAAD(AAD)
        val bytes = JSONObject().put("v", 1).put("iv", b64(cipher.iv)).put("data", b64(cipher.doFinal(plain))).toString().toByteArray(Charsets.UTF_8)
        val stream = file.startWrite()
        try { stream.write(bytes); file.finishWrite(stream) } catch (e: Exception) { file.failWrite(stream); throw e }
    }

    internal fun clear() { file.delete() }

    private fun key(create: Boolean): SecretKey {
        val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keystore.getKey(alias, null) as? SecretKey)?.let { return it }
        if (!create) throw IOException("Identity encryption key is unavailable")
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        return generator.generateKey()
    }
    companion object { private val AAD = "worlds.identity.session.v1".toByteArray(Charsets.UTF_8) }
}
