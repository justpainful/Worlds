package worlds.android.ai

import org.json.JSONArray
import org.json.JSONObject

/**
 * The provider shape shared by Worlds on desktop, Android and Apple platforms.
 *
 * A provider is an id, a display name, a kind, a base URL, an optional API key
 * (local servers need none) and a model picked from the provider's own list.
 * Anthropic speaks the Messages API; every other preset speaks the OpenAI
 * compatible Chat Completions API (`GET {base}/models`, `POST {base}/chat/completions`).
 */
enum class AiProviderKind(val id: String) {
    Anthropic("anthropic"),
    OpenAiCompatible("openai-compatible");

    companion object {
        fun fromId(id: String?): AiProviderKind = entries.firstOrNull { it.id == id } ?: OpenAiCompatible
    }
}

data class AiProviderPreset(
    val id: String,
    val displayName: String,
    val kind: AiProviderKind,
    val baseUrl: String,
    /** Local servers run without a key; hosted services need one. */
    val requiresKey: Boolean,
    /** Where people get a key, shown as plain text in settings. */
    val keyHint: String,
)

val AI_PROVIDER_PRESETS: List<AiProviderPreset> = listOf(
    AiProviderPreset("anthropic", "Anthropic", AiProviderKind.Anthropic, "https://api.anthropic.com", true, "console.anthropic.com"),
    AiProviderPreset("openai", "OpenAI", AiProviderKind.OpenAiCompatible, "https://api.openai.com/v1", true, "platform.openai.com"),
    AiProviderPreset("gemini", "Google Gemini", AiProviderKind.OpenAiCompatible, "https://generativelanguage.googleapis.com/v1beta/openai", true, "aistudio.google.com"),
    AiProviderPreset("groq", "Groq", AiProviderKind.OpenAiCompatible, "https://api.groq.com/openai/v1", true, "console.groq.com"),
    AiProviderPreset("deepseek", "DeepSeek", AiProviderKind.OpenAiCompatible, "https://api.deepseek.com/v1", true, "platform.deepseek.com"),
    AiProviderPreset("mistral", "Mistral", AiProviderKind.OpenAiCompatible, "https://api.mistral.ai/v1", true, "console.mistral.ai"),
    AiProviderPreset("xai", "xAI", AiProviderKind.OpenAiCompatible, "https://api.x.ai/v1", true, "console.x.ai"),
    AiProviderPreset("openrouter", "OpenRouter", AiProviderKind.OpenAiCompatible, "https://openrouter.ai/api/v1", true, "openrouter.ai"),
    AiProviderPreset("ollama", "Ollama", AiProviderKind.OpenAiCompatible, "http://localhost:11434/v1", false, "Runs on your own computer"),
    AiProviderPreset("lmstudio", "LM Studio", AiProviderKind.OpenAiCompatible, "http://localhost:1234/v1", false, "Runs on your own computer"),
    AiProviderPreset("custom", "Custom", AiProviderKind.OpenAiCompatible, "", false, "Any OpenAI compatible server"),
)

fun aiPreset(id: String?): AiProviderPreset? = AI_PROVIDER_PRESETS.firstOrNull { it.id == id }

/** A provider ready to call: the preset with the person's own base URL and key. */
data class AiProvider(
    val id: String,
    val displayName: String,
    val kind: AiProviderKind,
    val baseUrl: String,
    val apiKey: String?,
) {
    override fun toString(): String = "AiProvider(id=$id, kind=${kind.id}, baseUrl=$baseUrl, key=${if (apiKey.isNullOrBlank()) "none" else "set"})"
}

data class AiModelOption(val id: String, val name: String)

/** One turn sent to a provider. Attachments are already folded into [content]. */
data class AiTurn(val role: String, val content: String)

data class AiHttpRequest(val method: String, val url: String, val headers: Map<String, String>, val body: String?)

sealed class AiStreamEvent {
    data class Delta(val text: String) : AiStreamEvent()
    object Done : AiStreamEvent()
    data class Failure(val message: String) : AiStreamEvent()
}

/** Errors people can act on. Messages never include the key. */
sealed class AiError(message: String) : Exception(message) {
    class NoProvider : AiError("Choose an AI provider in AI settings to start.")
    class NoKey(provider: String) : AiError("Add your $provider API key in AI settings.")
    class NoModel(provider: String) : AiError("Choose a model for $provider in AI settings.")
    class BadUrl(provider: String) : AiError("The $provider address is not a valid http or https URL.")
    class BadKey(provider: String) : AiError("$provider rejected the API key. Check it in AI settings.")
    class ModelMissing(provider: String, model: String) : AiError("$provider has no model named $model. Pick another model.")
    class Offline(provider: String, host: String, local: Boolean) : AiError(
        if (local) "Cannot reach $provider at $host. Check that it is running and reachable from this device."
        else "Cannot reach $provider. Check your internet connection."
    )
    class RateLimited(provider: String, detail: String?) : AiError("$provider is limiting requests right now." + (detail?.let { " $it" } ?: ""))
    class Server(provider: String, code: Int, detail: String?) : AiError("$provider returned an error ($code)." + (detail?.let { " $it" } ?: ""))
    class Stream(provider: String, detail: String) : AiError("$provider stopped the reply: $detail")
    class Malformed(provider: String) : AiError("$provider sent a reply Worlds could not read.")
}

object AiRequests {
    const val ANTHROPIC_VERSION = "2023-06-01"
    const val MAX_TOKENS = 4096

    fun normalizedBase(baseUrl: String): String = baseUrl.trim().trimEnd('/')

    /** Anthropic's preset is the bare host; accept a base that already ends in /v1 too. */
    private fun anthropicRoot(baseUrl: String): String {
        val base = normalizedBase(baseUrl)
        return if (base.endsWith("/v1")) base else "$base/v1"
    }

    fun isValidBase(baseUrl: String): Boolean {
        val base = normalizedBase(baseUrl)
        val scheme = base.substringBefore("://", "").lowercase()
        val rest = base.substringAfter("://", "")
        return (scheme == "http" || scheme == "https") && rest.isNotEmpty() && !rest.startsWith("/") && rest.none { it.isWhitespace() }
    }

    fun isLocal(baseUrl: String): Boolean {
        val host = host(baseUrl).lowercase()
        return host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2" || host.startsWith("192.168.") || host.startsWith("10.") || host.endsWith(".local") || host == "[::1]"
    }

    fun host(baseUrl: String): String = normalizedBase(baseUrl).substringAfter("://").substringBefore('/').ifBlank { baseUrl }

    fun headers(provider: AiProvider, streaming: Boolean): Map<String, String> {
        val headers = linkedMapOf("Accept" to if (streaming) "text/event-stream" else "application/json")
        val key = provider.apiKey?.trim().orEmpty()
        when (provider.kind) {
            AiProviderKind.Anthropic -> {
                if (key.isNotEmpty()) headers["x-api-key"] = key
                headers["anthropic-version"] = ANTHROPIC_VERSION
            }
            AiProviderKind.OpenAiCompatible -> if (key.isNotEmpty()) headers["Authorization"] = "Bearer $key"
        }
        if (provider.id == "openrouter") {
            headers["X-Title"] = "Worlds"
        }
        return headers
    }

    fun listModels(provider: AiProvider): AiHttpRequest = when (provider.kind) {
        AiProviderKind.Anthropic -> AiHttpRequest("GET", anthropicRoot(provider.baseUrl) + "/models?limit=1000", headers(provider, false), null)
        AiProviderKind.OpenAiCompatible -> AiHttpRequest("GET", normalizedBase(provider.baseUrl) + "/models", headers(provider, false), null)
    }

    fun chat(provider: AiProvider, model: String, system: String, turns: List<AiTurn>): AiHttpRequest {
        val cleaned = cleanTurns(turns)
        val body = JSONObject()
        body.put("model", model)
        body.put("stream", true)
        val messages = JSONArray()
        return when (provider.kind) {
            AiProviderKind.Anthropic -> {
                body.put("max_tokens", MAX_TOKENS)
                if (system.isNotBlank()) body.put("system", system)
                cleaned.forEach { messages.put(JSONObject().put("role", it.role).put("content", it.content)) }
                body.put("messages", messages)
                AiHttpRequest("POST", anthropicRoot(provider.baseUrl) + "/messages", headers(provider, true) + ("Content-Type" to "application/json"), body.toString())
            }
            AiProviderKind.OpenAiCompatible -> {
                if (system.isNotBlank()) messages.put(JSONObject().put("role", "system").put("content", system))
                cleaned.forEach { messages.put(JSONObject().put("role", it.role).put("content", it.content)) }
                body.put("messages", messages)
                AiHttpRequest("POST", normalizedBase(provider.baseUrl) + "/chat/completions", headers(provider, true) + ("Content-Type" to "application/json"), body.toString())
            }
        }
    }

    /** Only user and assistant turns with text, starting with the person, with no two turns of one role in a row. */
    fun cleanTurns(turns: List<AiTurn>): List<AiTurn> {
        val out = ArrayList<AiTurn>()
        for (turn in turns) {
            if (turn.role != "user" && turn.role != "assistant") continue
            if (turn.content.isBlank()) continue
            if (out.isEmpty() && turn.role != "user") continue
            val last = out.lastOrNull()
            if (last != null && last.role == turn.role) out[out.size - 1] = AiTurn(last.role, last.content + "\n\n" + turn.content)
            else out.add(turn)
        }
        return out
    }

    private val NON_CHAT = listOf("embed", "tts", "whisper", "dall-e", "moderation", "transcribe", "rerank", "davinci", "babbage", "image", "audio", "realtime", "search", "guard")

    /** Reads `{"data":[{"id":...}]}`, the list shape both kinds use, and drops models that cannot chat. */
    fun parseModels(body: String): List<AiModelOption> {
        val json = JSONObject(body)
        val data = json.optJSONArray("data") ?: json.optJSONArray("models") ?: JSONArray()
        val out = ArrayList<AiModelOption>()
        for (i in 0 until data.length()) {
            val item = data.optJSONObject(i) ?: continue
            val rawId = item.optString("id").ifBlank { item.optString("name") }
            if (rawId.isBlank()) continue
            val id = rawId.removePrefix("models/")
            val lower = id.lowercase()
            if (NON_CHAT.any { lower.contains(it) }) continue
            val name = item.optString("display_name").ifBlank { item.optString("name").removePrefix("models/") }.ifBlank { id }
            if (out.none { it.id == id }) out.add(AiModelOption(id, name))
        }
        return out
    }

    /** The provider's own error text, from the shapes Anthropic and OpenAI compatible servers return. */
    fun errorDetail(body: String?): String? {
        if (body.isNullOrBlank()) return null
        return try {
            val json = JSONObject(body)
            val error = json.opt("error")
            val text = when (error) {
                is JSONObject -> error.optString("message")
                is String -> error
                else -> json.optString("message")
            }
            text.trim().take(300).ifBlank { null }
        } catch (_: Exception) {
            body.trim().take(200).ifBlank { null }
        }
    }

    fun httpError(provider: AiProvider, code: Int, body: String?, model: String?): AiError {
        val detail = errorDetail(body)
        val lower = detail?.lowercase().orEmpty()
        val modelProblem = model != null && lower.contains("model") && (lower.contains("not found") || lower.contains("does not exist") || lower.contains("not exist") || lower.contains("invalid model") || lower.contains("unknown model") || lower.contains("not_found") || lower.contains("no such"))
        return when {
            code == 401 || code == 403 -> AiError.BadKey(provider.displayName)
            modelProblem -> AiError.ModelMissing(provider.displayName, model!!)
            code == 404 && model != null -> AiError.ModelMissing(provider.displayName, model)
            code == 429 -> AiError.RateLimited(provider.displayName, detail)
            else -> AiError.Server(provider.displayName, code, detail)
        }
    }
}

/**
 * Reads server sent events line by line. Both kinds put JSON after `data:`;
 * Anthropic names each event, OpenAI compatible servers end with `[DONE]`.
 */
class AiStreamParser(private val kind: AiProviderKind) {
    fun line(raw: String): List<AiStreamEvent> {
        val line = raw.trimEnd('\r')
        if (line.isEmpty() || line.startsWith(":") || line.startsWith("event:") || line.startsWith("id:") || line.startsWith("retry:")) return emptyList()
        if (!line.startsWith("data:")) {
            // Some servers answer an error as plain JSON instead of an event stream.
            return if (line.trimStart().startsWith("{")) json(line.trim()) else emptyList()
        }
        val data = line.removePrefix("data:").trim()
        if (data.isEmpty()) return emptyList()
        if (data == "[DONE]") return listOf(AiStreamEvent.Done)
        return json(data)
    }

    private fun json(data: String): List<AiStreamEvent> {
        val obj = try { JSONObject(data) } catch (_: Exception) { return emptyList() }
        obj.opt("error")?.let { error ->
            val message = when (error) { is JSONObject -> error.optString("message"); else -> error.toString() }
            return listOf(AiStreamEvent.Failure(message.ifBlank { "Unknown error" }))
        }
        return when (kind) {
            AiProviderKind.Anthropic -> anthropic(obj)
            AiProviderKind.OpenAiCompatible -> openAi(obj)
        }
    }

    private fun anthropic(obj: JSONObject): List<AiStreamEvent> = when (obj.optString("type")) {
        "content_block_delta" -> {
            val delta = obj.optJSONObject("delta")
            if (delta != null && delta.optString("type") == "text_delta") {
                val text = delta.optString("text")
                if (text.isEmpty()) emptyList() else listOf(AiStreamEvent.Delta(text))
            } else emptyList()
        }
        "message_stop" -> listOf(AiStreamEvent.Done)
        else -> emptyList()
    }

    private fun openAi(obj: JSONObject): List<AiStreamEvent> {
        val choices = obj.optJSONArray("choices") ?: return emptyList()
        val out = ArrayList<AiStreamEvent>()
        for (i in 0 until choices.length()) {
            val choice = choices.optJSONObject(i) ?: continue
            val delta = choice.optJSONObject("delta") ?: choice.optJSONObject("message")
            val content = delta?.opt("content")
            if (content is String && content.isNotEmpty()) out.add(AiStreamEvent.Delta(content))
        }
        return out
    }
}
