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
    val error: Boolean = false,
    /** The tools this reply ran, in order. */
    val steps: List<AiToolStep> = emptyList(),
    /** The pages this reply changed, undoable in one step. */
    val changes: List<AiPageChange> = emptyList(),
    val undone: Boolean = false,
    /** The model refused tools during this reply, so it answered as chat only. */
    val chatOnly: Boolean = false
)

/** One conversation. The provider and model are saved with it, so each conversation keeps its own. */
data class ChatThread(
    val id: String,
    val title: String,
    val providerId: String,
    val modelId: String,
    val messages: List<ChatMessage>,
    val createdAt: Long,
    val updatedAt: Long,
    /** The model refused tools in this conversation; later replies are sent without them until the model changes. */
    val chatOnly: Boolean = false
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
        // A reply still running is kept only once it changed pages, so its Undo survives the app closing mid reply.
        thread.messages.filter { !it.isStreaming || it.changes.isNotEmpty() }.forEach { msg ->
            val atts = JSONArray()
            msg.attachments.forEach { atts.put(JSONObject().put("id", it.id).put("name", it.name).put("mime", it.mime).put("size", it.size).put("content", it.content)) }
            val json = JSONObject().put("id", msg.id).put("role", msg.role).put("content", msg.content).put("timestamp", msg.timestamp).put("error", msg.error).put("attachments", atts)
            if (msg.steps.isNotEmpty()) {
                val steps = JSONArray()
                msg.steps.forEach { steps.put(JSONObject().put("tool", it.tool).put("ok", it.ok == true)) }
                json.put("steps", steps)
            }
            if (msg.changes.isNotEmpty()) {
                val changes = JSONArray()
                msg.changes.forEach { changes.put(JSONObject().put("pageId", it.pageId).put("title", it.title).put("versionId", it.versionId ?: JSONObject.NULL).put("created", it.created)) }
                json.put("changes", changes).put("undone", msg.undone)
            }
            if (msg.chatOnly) json.put("chatOnly", true)
            messages.put(json)
        }
        val json = JSONObject()
            .put("version", 1).put("id", thread.id).put("title", thread.title)
            .put("provider", thread.providerId).put("model", thread.modelId)
            .put("createdAt", thread.createdAt).put("updatedAt", thread.updatedAt)
        if (thread.chatOnly) json.put("chatOnly", true)
        return json.put("messages", messages).toString()
    }

    private fun steps(array: JSONArray?): List<AiToolStep> = if (array == null) emptyList() else (0 until array.length()).mapNotNull { i ->
        val s = array.optJSONObject(i) ?: return@mapNotNull null
        AiToolStep(s.optString("tool"), s.optBoolean("ok"))
    }

    private fun changes(array: JSONArray?): List<AiPageChange> = if (array == null) emptyList() else (0 until array.length()).mapNotNull { i ->
        val c = array.optJSONObject(i) ?: return@mapNotNull null
        val pageId = c.optString("pageId")
        if (pageId.isBlank()) return@mapNotNull null
        AiPageChange(pageId, c.optString("title"), if (c.isNull("versionId")) null else c.optString("versionId").ifBlank { null }, c.optBoolean("created"))
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
            chatOnly = json.optBoolean("chatOnly"),
            messages = (0 until messages.length()).mapNotNull { i ->
                val m = messages.optJSONObject(i) ?: return@mapNotNull null
                val atts = m.optJSONArray("attachments") ?: JSONArray()
                ChatMessage(
                    id = m.optString("id"), role = m.optString("role"), content = m.optString("content"),
                    timestamp = m.optLong("timestamp"), error = m.optBoolean("error"),
                    attachments = (0 until atts.length()).mapNotNull { j ->
                        val a = atts.optJSONObject(j) ?: return@mapNotNull null
                        ChatAttachment(a.optString("id"), a.optString("name"), a.optString("mime"), a.optLong("size"), a.optString("content"))
                    },
                    steps = steps(m.optJSONArray("steps")),
                    changes = changes(m.optJSONArray("changes")),
                    undone = m.optBoolean("undone"),
                    chatOnly = m.optBoolean("chatOnly")
                )
            }
        )
    }
}

/** The title older versions saved for a conversation without one. Read as no title, so it shows translated. */
internal const val LEGACY_NEW_CONVERSATION_TITLE = "New conversation"

/** True while the conversation has no title of its own; screens then show the translated default title. */
fun ChatThread.hasPlaceholderTitle(): Boolean = title.isBlank() || title == LEGACY_NEW_CONVERSATION_TITLE

/** The first line of the prompt, shortened. Empty when there is nothing to name it by; screens show the default title then. */
fun chatTitle(prompt: String): String {
    val line = prompt.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() }.orEmpty()
    return if (line.length <= 60) line else line.take(57).trimEnd() + "..."
}
