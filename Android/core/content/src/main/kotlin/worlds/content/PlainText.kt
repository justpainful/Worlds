package worlds.content

import org.json.JSONObject

/** Mirrors desktop content::plain_text for supported node types. */
internal fun plainText(node: JSONObject): String = buildString { collect(node, this) }.trim()

private fun collect(node: JSONObject, out: StringBuilder) {
    val type = node.optString("type", "paragraph")
    val attrs = node.optJSONObject("attrs") ?: JSONObject()
    fun attr(name: String): String = attrs.optString(name, "")
    fun appendSpaced(value: String, separator: String) {
        if (value.isNotEmpty()) { if (out.isNotEmpty()) out.append(separator); out.append(value) }
    }
    when (type) {
        "text" -> out.append(node.optString("text", ""))
        "hardBreak" -> out.append('\n')
        "pageMention" -> { out.append('@'); out.append(attr("label")) }
        "image", "video", "file" -> { out.append(attr("caption")); appendSpaced(attr("name"), " ") }
        "pageLink" -> out.append(attr("title"))
        "slide" -> {
            val elements = attrs.optJSONArray("elements")
            if (elements != null) for (i in 0 until elements.length()) appendSpaced(elements.optJSONObject(i)?.optString("text", "") ?: "", "\n")
            val notes = attr("notes")
            if (notes.isNotEmpty()) { out.append('\n'); out.append(notes) }
        }
        "galleryItem" -> { appendSpaced(attr("caption"), " "); appendSpaced(attr("name"), " ") }
        "embed" -> out.append(attr("url"))
        "discordMessage" -> out.append(attr("content"))
        "mathInline", "mathBlock" -> out.append(attr("latex"))
        "mermaid" -> out.append(attr("code"))
        "chart" -> out.append(attr("title"))
        "tab" -> { out.append(attr("title")); children(node).forEach { out.append('\n'); collect(it, out) } }
        else -> {
            val kids = children(node)
            val blockChildren = kids.any { it.optString("type", "paragraph") !in setOf("text", "hardBreak", "pageMention", "mathInline") }
            kids.forEachIndexed { index, child -> if (blockChildren && index > 0) out.append('\n'); collect(child, out) }
        }
    }
}

private fun children(node: JSONObject): List<JSONObject> {
    val array = node.optJSONArray("content") ?: return emptyList()
    return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
}
