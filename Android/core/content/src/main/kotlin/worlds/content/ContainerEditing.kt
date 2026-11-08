package worlds.content

import org.json.JSONArray
import org.json.JSONObject

/** Supports text inside desktop quote, callout and prompt blocks without discarding other children. */
object ContainerEditing {
    data class Container(val type: String, val label: String, val paragraphs: List<String?>)
    private val types = setOf("blockquote", "callout", "prompt")
    private const val MAX_CHILDREN = 3000

    fun read(raw: String): Container {
        val root = JSONObject(raw)
        val type = root.optString("type")
        require(type in types)
        val content = root.optJSONArray("content") ?: throw IllegalArgumentException("Invalid container")
        require(content.length() <= MAX_CHILDREN)
        val label = when (type) {
            "callout" -> root.optJSONObject("attrs")?.optString("tone", "") ?: ""
            "prompt" -> root.optJSONObject("attrs")?.optString("label", "") ?: ""
            else -> ""
        }
        val paragraphs = (0 until content.length()).map { index ->
            content.optJSONObject(index)?.takeIf { it.optString("type") == "paragraph" }?.toString()
        }
        return Container(type, label, paragraphs)
    }

    fun create(type: String, id: String, paragraph: String): String {
        require(type in types && id.isNotBlank())
        val node = paragraph(paragraph)
        val attrs = JSONObject().put("bid", id)
        if (type == "callout") attrs.put("tone", "note")
        if (type == "prompt") attrs.put("label", "Prompt")
        return JSONObject().put("type", type).put("attrs", attrs).put("content", JSONArray().put(node)).toString()
    }

    fun replaceParagraph(raw: String, index: Int, paragraph: String): String {
        val current = read(raw)
        require(index in current.paragraphs.indices && current.paragraphs[index] != null)
        val root = JSONObject(raw)
        root.getJSONArray("content").put(index, paragraph(paragraph))
        return root.toString()
    }

    fun append(raw: String): String {
        val current = read(raw); require(current.paragraphs.size < MAX_CHILDREN)
        val root = JSONObject(raw)
        root.getJSONArray("content").put(JSONObject().put("type", "paragraph"))
        return root.toString()
    }

    private fun paragraph(raw: String): JSONObject {
        val node = JSONObject(raw)
        require(node.optString("type") == "paragraph")
        InlineEditing.text(raw)
        return node
    }
}
