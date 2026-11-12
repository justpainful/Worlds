package worlds.android.ai

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.util.TreeMap

/*
 * The tool calling wire formats, mirroring the desktop's providers/wire.rs:
 * one neutral conversation shape, request bodies for both dialects (Anthropic
 * tool_use and tool_result blocks, OpenAI tool_calls and tool messages), and a
 * stream accumulator that turns either dialect's stream into text deltas plus
 * the finished assistant turn.
 */

/** One piece of a message in the tool loop: text, a tool call the model made, or the result Worlds sent back. */
sealed class AiPart {
    data class Text(val text: String) : AiPart()
    data class ToolCall(val id: String, val name: String, val input: JSONObject) : AiPart()
    data class ToolResult(val id: String, val output: String, val isError: Boolean) : AiPart()
}

/** A message in the tool loop. [role] is "user" or "assistant"; tool results travel as user parts, as on the desktop. */
data class AiMsg(val role: String, val parts: List<AiPart>) {
    companion object {
        fun text(role: String, text: String) = AiMsg(role, listOf(AiPart.Text(text)))
    }
}

/** A Worlds tool offered to the model, with the same name, description and JSON schema the desktop MCP server uses. */
data class AiToolDef(val name: String, val description: String, val schema: JSONObject)

data class AiToolCall(val id: String, val name: String, val input: JSONObject)

/** What the model said in one turn: its text and the tools it asked for. */
data class AiAssistantTurn(val text: String, val calls: List<AiToolCall>, val stop: String?) {
    fun toMsg(): AiMsg {
        val parts = ArrayList<AiPart>()
        if (text.isNotBlank()) parts.add(AiPart.Text(text))
        calls.forEach { parts.add(AiPart.ToolCall(it.id, it.name, it.input)) }
        return AiMsg("assistant", parts)
    }
}

object AiToolWire {
    const val AGENT_MAX_TOKENS = 8192

    /** Consecutive messages of one role merged, empty text dropped, and the conversation starting with the person. */
    fun normalized(msgs: List<AiMsg>): List<AiMsg> {
        val out = ArrayList<AiMsg>()
        for (m in msgs) {
            if (m.role != "user" && m.role != "assistant") continue
            val parts = m.parts.filterNot { it is AiPart.Text && it.text.isBlank() }
            if (parts.isEmpty()) continue
            if (out.isEmpty() && m.role != "user") continue
            val last = out.lastOrNull()
            if (last != null && last.role == m.role) out[out.size - 1] = AiMsg(last.role, last.parts + parts)
            else out.add(AiMsg(m.role, parts))
        }
        return out
    }

    /** A streamed chat request that offers [tools]; with no tools it is a plain chat request in the same shape. */
    fun request(provider: AiProvider, model: String, system: String, msgs: List<AiMsg>, tools: List<AiToolDef>): AiHttpRequest {
        val body = when (provider.kind) {
            AiProviderKind.Anthropic -> anthropicBody(model, system, msgs, tools)
            AiProviderKind.OpenAiCompatible -> openAiBody(model, system, msgs, tools)
        }
        // The plain chat request already knows each dialect's address and headers.
        val shape = AiRequests.chat(provider, model, system, emptyList())
        return AiHttpRequest("POST", shape.url, shape.headers, body.toString())
    }

    fun anthropicBody(model: String, system: String, msgs: List<AiMsg>, tools: List<AiToolDef>): JSONObject {
        val messages = JSONArray()
        for (m in normalized(msgs)) {
            val content = JSONArray()
            for (p in m.parts) {
                when (p) {
                    is AiPart.Text -> content.put(JSONObject().put("type", "text").put("text", p.text))
                    is AiPart.ToolCall -> content.put(JSONObject().put("type", "tool_use").put("id", p.id).put("name", p.name).put("input", p.input))
                    is AiPart.ToolResult -> content.put(JSONObject().put("type", "tool_result").put("tool_use_id", p.id).put("content", p.output).put("is_error", p.isError))
                }
            }
            messages.put(JSONObject().put("role", m.role).put("content", content))
        }
        val body = JSONObject().put("model", model).put("max_tokens", AGENT_MAX_TOKENS).put("stream", true)
        if (system.isNotBlank()) body.put("system", system)
        body.put("messages", messages)
        if (tools.isNotEmpty()) {
            val list = JSONArray()
            tools.forEach { list.put(JSONObject().put("name", it.name).put("description", it.description).put("input_schema", it.schema)) }
            body.put("tools", list)
        }
        return body
    }

    fun openAiBody(model: String, system: String, msgs: List<AiMsg>, tools: List<AiToolDef>): JSONObject {
        val messages = JSONArray()
        if (system.isNotBlank()) messages.put(JSONObject().put("role", "system").put("content", system))
        for (m in normalized(msgs)) {
            if (m.role == "user") {
                // Tool results become `tool` messages, which must directly follow the assistant message that asked for them.
                val texts = ArrayList<String>()
                for (p in m.parts) {
                    when (p) {
                        is AiPart.ToolResult -> {
                            val text = if (p.isError && !p.output.startsWith("Error")) "Error: ${p.output}" else p.output
                            messages.put(JSONObject().put("role", "tool").put("tool_call_id", p.id).put("content", text))
                        }
                        is AiPart.Text -> texts.add(p.text)
                        is AiPart.ToolCall -> Unit
                    }
                }
                if (texts.isNotEmpty()) messages.put(JSONObject().put("role", "user").put("content", texts.joinToString("\n\n")))
            } else {
                val text = m.parts.filterIsInstance<AiPart.Text>().joinToString("\n\n") { it.text }
                val msg = JSONObject().put("role", "assistant").put("content", if (text.isEmpty()) JSONObject.NULL else text)
                val calls = JSONArray()
                m.parts.filterIsInstance<AiPart.ToolCall>().forEach { call ->
                    calls.put(JSONObject().put("id", call.id).put("type", "function").put("function", JSONObject().put("name", call.name).put("arguments", call.input.toString())))
                }
                if (calls.length() > 0) msg.put("tool_calls", calls)
                messages.put(msg)
            }
        }
        val body = JSONObject().put("model", model).put("messages", messages).put("stream", true)
        if (tools.isNotEmpty()) {
            val list = JSONArray()
            tools.forEach { list.put(JSONObject().put("type", "function").put("function", JSONObject().put("name", it.name).put("description", it.description).put("parameters", it.schema))) }
            body.put("tools", list)
        }
        return body
    }

    /** The server refused the request because the model has no tool support (the same test as the desktop). */
    fun noToolSupport(code: Int, body: String?): Boolean {
        if (code !in 400..500) return false
        val b = body.orEmpty().lowercase()
        return (b.contains("tool") || b.contains("function")) &&
            listOf("not support", "unsupported", "--jinja", "not enabled", "not available", "does not have").any { b.contains(it) }
    }

    /** Tool arguments as an object. Some servers double encode them as a JSON string. */
    fun parseArgs(raw: String): JSONObject {
        val text = raw.trim()
        if (text.isEmpty()) return JSONObject()
        return try {
            when (val value = JSONTokener(text).nextValue()) {
                is JSONObject -> value
                is String -> runCatching { JSONObject(value) }.getOrDefault(JSONObject())
                else -> JSONObject()
            }
        } catch (_: Exception) {
            JSONObject()
        }
    }
}

/**
 * Turns either dialect's stream into text deltas plus the finished turn (text
 * and tool calls). Feed it every line of the response body, then call [end]:
 * a server that ignored `stream: true` and answered with one JSON document is
 * read there.
 */
class AiTurnStream(private val kind: AiProviderKind) {
    private class Block(var type: String = "", val text: StringBuilder = StringBuilder(), var id: String = "", var name: String = "", val json: StringBuilder = StringBuilder())
    private class Call(var id: String = "", var name: String = "", val args: StringBuilder = StringBuilder())

    private val blocks = TreeMap<Int, Block>()
    private val calls = ArrayList<Call>()
    private val text = StringBuilder()
    private val raw = StringBuilder()
    private var sawData = false
    private var stop: String? = null

    fun line(rawLine: String): List<AiStreamEvent> {
        val line = rawLine.trimEnd('\r')
        if (line.isEmpty() || line.startsWith(":") || line.startsWith("event:") || line.startsWith("id:") || line.startsWith("retry:")) return emptyList()
        if (!line.startsWith("data:")) {
            if (!sawData && raw.length < MAX_RAW) raw.append(line).append('\n')
            return emptyList()
        }
        sawData = true
        val data = line.removePrefix("data:").trim()
        if (data.isEmpty()) return emptyList()
        if (data == "[DONE]") return listOf(AiStreamEvent.Done)
        val obj = try { JSONObject(data) } catch (_: Exception) { return emptyList() }
        errorOf(obj)?.let { return listOf(AiStreamEvent.Failure(it)) }
        return when (kind) {
            AiProviderKind.Anthropic -> anthropic(obj)
            AiProviderKind.OpenAiCompatible -> openAi(obj)
        }
    }

    /** Reads a whole JSON answer when the server did not stream. Call once after the last line. */
    fun end(): List<AiStreamEvent> {
        if (sawData) return emptyList()
        val body = raw.toString().trim()
        raw.setLength(0)
        if (!body.startsWith("{")) return emptyList()
        val obj = try { JSONObject(body) } catch (_: Exception) { return emptyList() }
        errorOf(obj)?.let { return listOf(AiStreamEvent.Failure(it)) }
        return when (kind) {
            AiProviderKind.Anthropic -> {
                val content = obj.optJSONArray("content") ?: JSONArray()
                for (i in 0 until content.length()) {
                    val b = content.optJSONObject(i) ?: continue
                    val block = Block(b.optString("type"), StringBuilder(b.optString("text")), b.optString("id"), b.optString("name"))
                    if (block.type == "tool_use") block.json.append(b.optJSONObject("input")?.toString() ?: "{}")
                    blocks[i] = block
                }
                stop = obj.optString("stop_reason").takeIf { it.isNotBlank() && it != "null" }
                val all = blocks.values.filter { it.type == "text" }.joinToString("") { it.text }
                if (all.isEmpty()) emptyList() else listOf(AiStreamEvent.Delta(all))
            }
            AiProviderKind.OpenAiCompatible -> openAi(obj)
        }
    }

    fun turn(): AiAssistantTurn = when (kind) {
        AiProviderKind.Anthropic -> {
            val out = StringBuilder()
            val found = ArrayList<AiToolCall>()
            for ((index, b) in blocks) {
                when (b.type) {
                    "text" -> out.append(b.text)
                    "tool_use" -> if (b.name.isNotBlank()) found.add(AiToolCall(b.id.ifBlank { "toolu_$index" }, b.name, AiToolWire.parseArgs(b.json.toString())))
                }
            }
            AiAssistantTurn(out.toString(), found, stop)
        }
        AiProviderKind.OpenAiCompatible -> AiAssistantTurn(
            text.toString(),
            calls.mapIndexedNotNull { i, c -> if (c.name.isBlank()) null else AiToolCall(c.id.ifBlank { "call_$i" }, c.name, AiToolWire.parseArgs(c.args.toString())) },
            stop,
        )
    }

    private fun errorOf(obj: JSONObject): String? {
        if (!obj.has("error") || obj.isNull("error")) return null
        val error = obj.opt("error")
        return (if (error is JSONObject) error.optString("message") else error.toString()).trim()
    }

    private fun anthropic(obj: JSONObject): List<AiStreamEvent> {
        val index = obj.optInt("index", 0)
        return when (obj.optString("type")) {
            "content_block_start" -> {
                val b = obj.optJSONObject("content_block") ?: JSONObject()
                val block = Block(b.optString("type"), StringBuilder(b.optString("text")), b.optString("id"), b.optString("name"))
                blocks[index] = block
                if (block.text.isNotEmpty()) listOf(AiStreamEvent.Delta(block.text.toString())) else emptyList()
            }
            "content_block_delta" -> {
                val d = obj.optJSONObject("delta") ?: JSONObject()
                val block = blocks.getOrPut(index) { Block(if (d.optString("type") == "input_json_delta") "tool_use" else "text") }
                when (d.optString("type")) {
                    "text_delta" -> {
                        val t = d.optString("text")
                        block.text.append(t)
                        if (t.isEmpty()) emptyList() else listOf(AiStreamEvent.Delta(t))
                    }
                    "input_json_delta" -> {
                        block.json.append(d.optString("partial_json"))
                        emptyList()
                    }
                    else -> emptyList()
                }
            }
            "message_delta" -> {
                val reason = obj.optJSONObject("delta")?.optString("stop_reason").orEmpty()
                if (reason.isNotBlank() && reason != "null") stop = reason
                emptyList()
            }
            "message_stop" -> listOf(AiStreamEvent.Done)
            else -> emptyList()
        }
    }

    private fun openAi(obj: JSONObject): List<AiStreamEvent> {
        val choice = obj.optJSONArray("choices")?.optJSONObject(0) ?: return emptyList()
        val reason = choice.optString("finish_reason")
        if (reason.isNotBlank() && reason != "null") stop = reason
        val delta = choice.optJSONObject("delta") ?: choice.optJSONObject("message") ?: return emptyList()
        val toolCalls = delta.optJSONArray("tool_calls")
        if (toolCalls != null) for (i in 0 until toolCalls.length()) toolCalls.optJSONObject(i)?.let { toolDelta(it) }
        val content = delta.opt("content")
        if (content is String && content.isNotEmpty()) {
            text.append(content)
            return listOf(AiStreamEvent.Delta(content))
        }
        return emptyList()
    }

    private fun toolDelta(tc: JSONObject) {
        val id = tc.optString("id").takeIf { it.isNotBlank() && it != "null" }.orEmpty()
        val index = if (tc.has("index") && !tc.isNull("index")) tc.optInt("index")
        else calls.indexOfFirst { id.isNotEmpty() && it.id == id }.takeIf { it >= 0 } ?: calls.size
        if (index < 0 || index > 255) return
        while (calls.size <= index) calls.add(Call())
        val call = calls[index]
        if (id.isNotEmpty()) call.id = id
        val f = tc.optJSONObject("function") ?: return
        val name = f.optString("name")
        if (name.isNotBlank() && name != "null" && call.name.isEmpty()) call.name = name
        if (f.has("arguments") && !f.isNull("arguments")) {
            when (val args = f.opt("arguments")) {
                is String -> call.args.append(args)
                else -> call.args.append(args.toString())
            }
        }
    }

    private companion object {
        const val MAX_RAW = 4 * 1024 * 1024
    }
}
