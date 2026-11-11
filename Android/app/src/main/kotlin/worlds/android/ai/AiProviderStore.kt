package worlds.android.ai

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * API keys, encrypted with an AES key that never leaves the Android Keystore.
 * Only the ciphertext is written to app private storage, and the app opts out
 * of backups, so keys stay on this device. Nothing here logs a key.
 */
internal class AiKeyVault(context: Context) {
    private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences("worlds_ai_keys", Context.MODE_PRIVATE)

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    fun has(providerId: String): Boolean = prefs.contains(providerId)

    fun read(providerId: String): String? {
        val stored = prefs.getString(providerId, null) ?: return null
        return try {
            val bytes = Base64.decode(stored, Base64.NO_WRAP)
            val iv = bytes.copyOfRange(0, IV_BYTES)
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8)
        } catch (_: Exception) {
            // The Keystore key was reset (for example after a restore); the old ciphertext is useless.
            prefs.edit().remove(providerId).apply()
            null
        }
    }

    fun write(providerId: String, key: String?) {
        val value = key?.trim().orEmpty()
        if (value.isEmpty()) { prefs.edit().remove(providerId).apply(); return }
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        check(iv.size == IV_BYTES)
        val sealed = iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        prefs.edit().putString(providerId, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
    }

    private companion object {
        const val ALIAS = "worlds.ai.provider-keys"
        const val TRANSFORM = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
    }
}

/** What a person set for one provider, apart from the key. */
data class AiProviderSettings(val baseUrl: String, val model: String, val models: List<AiModelOption>)

/**
 * Provider settings for this device: a base URL and last chosen model per
 * provider, the default provider for new conversations, and the keys (through
 * [AiKeyVault]).
 */
internal class AiProviderStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("worlds_ai_providers", Context.MODE_PRIVATE)
    private val vault = AiKeyVault(context)

    fun settings(providerId: String): AiProviderSettings {
        val preset = aiPreset(providerId)
        val json = prefs.getString("provider.$providerId", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
        val models = json?.optJSONArray("models")?.let { array ->
            (0 until array.length()).mapNotNull { i -> array.optJSONObject(i)?.let { AiModelOption(it.optString("id"), it.optString("name").ifBlank { it.optString("id") }) } }.filter { it.id.isNotBlank() }
        }.orEmpty()
        return AiProviderSettings(
            baseUrl = json?.optString("baseUrl")?.ifBlank { null } ?: preset?.baseUrl.orEmpty(),
            model = json?.optString("model").orEmpty(),
            models = models,
        )
    }

    fun save(providerId: String, settings: AiProviderSettings) {
        val models = org.json.JSONArray()
        settings.models.forEach { models.put(JSONObject().put("id", it.id).put("name", it.name)) }
        val json = JSONObject().put("baseUrl", settings.baseUrl.trim()).put("model", settings.model).put("models", models)
        prefs.edit().putString("provider.$providerId", json.toString()).apply()
    }

    fun hasKey(providerId: String): Boolean = vault.has(providerId)
    fun saveKey(providerId: String, key: String?) = vault.write(providerId, key)

    var defaultProviderId: String?
        get() = prefs.getString("default", null)
        set(value) { prefs.edit().putString("default", value).apply() }

    /** Configured means a hosted provider has a key, or a local one has an address. */
    fun isConfigured(providerId: String): Boolean {
        val preset = aiPreset(providerId) ?: return false
        val settings = settings(providerId)
        if (!AiRequests.isValidBase(settings.baseUrl)) return false
        return !preset.requiresKey || hasKey(providerId)
    }

    /** The provider ready to call, with its key read from the vault. Call off the main thread. */
    fun provider(providerId: String): AiProvider? {
        val preset = aiPreset(providerId) ?: return null
        val settings = settings(providerId)
        return AiProvider(preset.id, preset.displayName, preset.kind, settings.baseUrl, vault.read(providerId))
    }
}
