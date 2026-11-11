package worlds.android.ai

import org.json.JSONArray
import org.json.JSONObject

data class ChatAttachment(
    val id: String,
    val name: String,
    val mime: String,
    val size: Long,
    val content: String // Text or markdown projection
)

data class ChatMessage(
    val id: String,
    val role: String, // "user" | "assistant"
    val content: String,
    val timestamp: Long,
    val attachments: List<ChatAttachment> = emptyList(),
    val isStreaming: Boolean = false,
    val error: Boolean = false
)

/** One conversation. The provider and model are saved with it, so each conversation keeps its own. */
data class ChatThread(
    val id: String,
    val title: String,
    val providerId: String,
    val modelId: String,
    val messages: List<ChatMessage>,
    val createdAt: Long,
    val updatedAt: Long
)

/** Folds attached pages into the text a provider receives. */
fun ChatMessage.toTurn(): AiTurn {
    if (attachments.isEmpty()) return AiTurn(role, content)
    val text = StringBuilder()
    for (att in attachments) {
        text.append("<document name=\"").append(att.name.replace("\"", "'")).append("\">\n")
        text.append(att.content).append("\n</document>\n\n")
    }
    text.append(content)
    return AiTurn(role, text.toString())
}

/** The turns to send: finished user and assistant messages, never error notes or a reply still streaming. */
fun List<ChatMessage>.toTurns(): List<AiTurn> = filter { !it.error && !it.isStreaming && (it.role == "user" || it.role == "assistant") }.map { it.toTurn() }

internal object ChatThreadJson {
    fun encode(thread: ChatThread): String {
        val messages = JSONArray()
        thread.messages.filter { !it.isStreaming }.forEach { msg ->
            val atts = JSONArray()
            msg.attachments.forEach { atts.put(JSONObject().put("id", it.id).put("name", it.name).put("mime", it.mime).put("size", it.size).put("content", it.content)) }
            messages.put(JSONObject().put("id", msg.id).put("role", msg.role).put("content", msg.content).put("timestamp", msg.timestamp).put("error", msg.error).put("attachments", atts))
        }
        return JSONObject()
            .put("version", 1).put("id", thread.id).put("title", thread.title)
            .put("provider", thread.providerId).put("model", thread.modelId)
            .put("createdAt", thread.createdAt).put("updatedAt", thread.updatedAt)
            .put("messages", messages).toString()
    }

    fun decode(text: String): ChatThread {
        val json = JSONObject(text)
        val messages = json.optJSONArray("messages") ?: JSONArray()
        return ChatThread(
            id = json.getString("id"),
            title = json.optString("title"),
            providerId = json.optString("provider"),
            modelId = json.optString("model"),
            createdAt = json.optLong("createdAt"),
            updatedAt = json.optLong("updatedAt"),
            messages = (0 until messages.length()).mapNotNull { i ->
                val m = messages.optJSONObject(i) ?: return@mapNotNull null
                val atts = m.optJSONArray("attachments") ?: JSONArray()
                ChatMessage(
                    id = m.optString("id"), role = m.optString("role"), content = m.optString("content"),
                    timestamp = m.optLong("timestamp"), error = m.optBoolean("error"),
                    attachments = (0 until atts.length()).mapNotNull { j ->
                        val a = atts.optJSONObject(j) ?: return@mapNotNull null
                        ChatAttachment(a.optString("id"), a.optString("name"), a.optString("mime"), a.optLong("size"), a.optString("content"))
                    }
                )
            }
        )
    }
}

fun chatTitle(prompt: String): String {
    val line = prompt.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() }.orEmpty()
    return if (line.length <= 60) line.ifEmpty { "New conversation" } else line.take(57).trimEnd() + "..."
}
