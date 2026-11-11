package worlds.android.ai

import android.content.Context
import java.io.File

/** Conversations as one JSON file each in app private storage. Call off the main thread. */
internal class AiConversationStore(context: Context) {
    private val folder = File(context.applicationContext.filesDir, "ai-conversations")

    private fun file(id: String): File {
        require(id.matches(Regex("[A-Za-z0-9-]{1,64}"))) { "Invalid conversation id" }
        return File(folder, "$id.json")
    }

    fun list(): List<ChatThread> {
        val files = folder.listFiles { f -> f.isFile && f.name.endsWith(".json") } ?: return emptyList()
        return files.mapNotNull { runCatching { ChatThreadJson.decode(it.readText()) }.getOrNull() }.sortedByDescending { it.updatedAt }
    }

    fun load(id: String): ChatThread? = runCatching { ChatThreadJson.decode(file(id).readText()) }.getOrNull()

    fun save(thread: ChatThread) {
        folder.mkdirs()
        val target = file(thread.id)
        val temp = File(folder, "${thread.id}.json.tmp")
        temp.writeText(ChatThreadJson.encode(thread))
        if (!temp.renameTo(target)) { target.delete(); temp.renameTo(target) }
    }

    fun delete(id: String) { file(id).delete() }
}
