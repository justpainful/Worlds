package worlds.android.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class AiClient(
    private val endpointUrl: String = "https://api.anthropic.com/v1/messages",
    private val apiKey: String? = null
) {
    suspend fun sendMessage(
        modelId: String,
        history: List<ChatMessage>,
        newMessage: ChatMessage,
        systemPrompt: String = "You are Worlds AI Assistant, embedded in the Worlds creative workspace."
    ): String = withContext(Dispatchers.IO) {
        val key = apiKey?.trim()
        if (key.isNullOrBlank()) {
            // Local fallback simulation when no API key is configured
            return@withContext simulateAiResponse(newMessage)
        }

        val url = URL(endpointUrl)
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("User-Agent", "Worlds-Android/1.0")

        if (endpointUrl.contains("anthropic.com")) {
            conn.setRequestProperty("x-api-key", key)
            conn.setRequestProperty("anthropic-version", "2023-06-01")
        } else {
            conn.setRequestProperty("Authorization", "Bearer $key")
        }

        conn.doOutput = true
        conn.connectTimeout = 30000
        conn.readTimeout = 60000

        val payload = buildRequestPayload(modelId, history, newMessage, systemPrompt)

        OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
            writer.write(payload.toString())
            writer.flush()
        }

        val code = conn.responseCode
        if (code !in 200..299) {
            val errorBody = conn.errorStream?.bufferedReader()?.readText().orEmpty()
            throw IllegalStateException("AI API request failed ($code): $errorBody")
        }

        val responseBody = conn.inputStream.bufferedReader().readText()
        parseAiResponse(responseBody)
    }

    private fun buildRequestPayload(
        modelId: String,
        history: List<ChatMessage>,
        newMessage: ChatMessage,
        systemPrompt: String
    ): JSONObject {
        val payload = JSONObject()
        payload.put("model", modelId)
        payload.put("max_tokens", 4096)
        payload.put("system", systemPrompt)

        val messagesArr = JSONArray()
        val allMessages = history + newMessage

        for (msg in allMessages) {
            if (msg.role !in setOf("user", "assistant")) continue
            val msgObj = JSONObject()
            msgObj.put("role", msg.role)

            if (msg.attachments.isEmpty()) {
                msgObj.put("content", msg.content)
            } else {
                val contentBuilder = StringBuilder()
                for (att in msg.attachments) {
                    contentBuilder.append("<document name=\"").append(att.name).append("\">\n")
                    contentBuilder.append(att.content).append("\n</document>\n\n")
                }
                contentBuilder.append(msg.content)
                msgObj.put("content", contentBuilder.toString())
            }
            messagesArr.put(msgObj)
        }

        payload.put("messages", messagesArr)
        return payload
    }

    private fun parseAiResponse(responseJson: String): String {
        val json = JSONObject(responseJson)
        // Anthropic structure: { "content": [ { "type": "text", "text": "..." } ] }
        val contentArr = json.optJSONArray("content")
        if (contentArr != null && contentArr.length() > 0) {
            val sb = StringBuilder()
            for (i in 0 until contentArr.length()) {
                val block = contentArr.optJSONObject(i)
                if (block != null && block.optString("type") == "text") {
                    sb.append(block.optString("text"))
                }
            }
            return sb.toString()
        }
        // OpenAI structure: { "choices": [ { "message": { "content": "..." } } ] }
        val choices = json.optJSONArray("choices")
        if (choices != null && choices.length() > 0) {
            val choice = choices.optJSONObject(0)
            val msg = choice?.optJSONObject("message")
            return msg?.optString("content").orEmpty()
        }
        return responseJson
    }

    private fun simulateAiResponse(message: ChatMessage): String {
        val hasAttachments = message.attachments.isNotEmpty()
        val attachmentNames = message.attachments.joinToString { it.name }
        return buildString {
            append("I received your message")
            if (hasAttachments) {
                append(" with attached context from **").append(attachmentNames).append("**")
            }
            append(":\n\n> ")
            append(message.content.replace("\n", "\n> "))
            append("\n\nHere is an analysis of your request within Worlds:\n")
            append("- **Content Structure**: Your prompt has been analyzed in the context of the active workspace.\n")
            append("- **Next Steps**: You can refine this response, attach additional pages or files, or export this directly into a new page in your Worlds library using the export button below.\n\n")
            append("```kotlin\n// Worlds workspace context\nval page = store.create(\"page\", \"AI Generated Draft\")\n```\n")
            append("*(Note: To connect to live Claude or GPT APIs, configure your API key in Settings)*")
        }
    }
}
