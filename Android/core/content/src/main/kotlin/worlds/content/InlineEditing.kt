package worlds.content

import org.json.JSONArray
import org.json.JSONObject

/** Operations on text-only paragraph and heading nodes, using UTF-16 offsets like ProseMirror. */
object InlineEditing {
    class UnsupportedContent(message: String) : IllegalArgumentException(message)

    fun text(block: String): String = parse(block).text

    fun setParagraphStyle(block: String, style: String): String {
        require(style in setOf("normal", "title", "subtitle", "caption"))
        val source = parse(block)
        require(source.root.optString("type") == "paragraph")
        val attrs = source.root.optJSONObject("attrs") ?: JSONObject().also { source.root.put("attrs", it) }
        attrs.put("pstyle", style)
        return source.root.toString()
    }

    fun setAlignment(block: String, alignment: String?): String {
        require(alignment == null || alignment in setOf("left", "center", "right", "justify"))
        val source = parse(block)
        val attrs = source.root.optJSONObject("attrs") ?: JSONObject().also { source.root.put("attrs", it) }
        if (alignment == null) attrs.put("textAlign", JSONObject.NULL) else attrs.put("textAlign", alignment)
        return source.root.toString()
    }

    /** True only when every selected text character has the mark. */
    fun hasMark(block: String, start: Int, end: Int, type: String): Boolean {
        val source = parse(block)
        validateRange(source, start, end)
        require(type.isNotBlank() && start < end)
        var position = 0
        var sawText = false
        for (node in source.nodes) {
            val next = position + textOf(node).length
            if (node.optString("type") == "text" && next > start && position < end) {
                sawText = true
                val marks = node.optJSONArray("marks") ?: JSONArray()
                if ((0 until marks.length()).none { marks.getJSONObject(it).optString("type") == type }) return false
            }
            position = next
        }
        return sawText
    }

    fun replace(block: String, start: Int, end: Int, inserted: String): String {
        val source = parse(block)
        validateRange(source, start, end)
        validateUnicode(inserted)
        if (start == end && inserted.isEmpty()) return block
        val prefix = JSONArray()
        val suffix = JSONArray()
        var position = 0
        var inherited: JSONArray? = null
        var nextMarks: JSONArray? = null
        var inheritedFound = false
        var nextFound = false
        for (node in source.nodes) {
            val text = textOf(node)
            val next = position + text.length
            if (node.optString("type") == "text") {
                if (position < start && next >= start) { inherited = copyMarks(node); inheritedFound = true }
                else if (next <= start) { inherited = copyMarks(node); inheritedFound = true }
                else if (!nextFound && position >= start) { nextMarks = copyMarks(node); nextFound = true }
                val before = (start - position).coerceIn(0, text.length)
                val after = (end - position).coerceIn(0, text.length)
                if (before > 0) prefix.put(copyText(node, text.substring(0, before)))
                if (after < text.length) suffix.put(copyText(node, text.substring(after)))
            } else {
                if (next <= start) prefix.put(copy(node))
                if (position >= end) suffix.put(copy(node))
            }
            position = next
        }
        val result = JSONArray()
        appendAll(result, prefix)
        appendInserted(result, inserted, if (inheritedFound) inherited else nextMarks)
        appendAll(result, suffix)
        return source.root.put("content", result).toString()
    }

    fun setMark(block: String, start: Int, end: Int, mark: String, enabled: Boolean): String {
        val source = parse(block)
        validateRange(source, start, end)
        require(start < end) { "A non-empty selection is required" }
        val requested = JSONObject(mark)
        val type = requested.optString("type")
        require(type.isNotBlank()) { "Mark type is required" }
        val result = JSONArray()
        var position = 0
        for (node in source.nodes) {
            val text = textOf(node)
            val next = position + text.length
            if (node.optString("type") != "text" || next <= start || position >= end) result.put(copy(node))
            else {
                val from = (start - position).coerceIn(0, text.length)
                val to = (end - position).coerceIn(0, text.length)
                if (from > 0) result.put(copyText(node, text.substring(0, from)))
                val selected = copyText(node, text.substring(from, to))
                val oldMarks = node.optJSONArray("marks") ?: JSONArray()
                val newMarks = JSONArray()
                for (i in 0 until oldMarks.length()) {
                    val existing = oldMarks.getJSONObject(i)
                    if (existing.optString("type") != type) newMarks.put(copy(existing))
                }
                if (enabled) newMarks.put(copy(requested))
                if (newMarks.length() == 0) selected.remove("marks") else selected.put("marks", newMarks)
                result.put(selected)
                if (to < text.length) result.put(copyText(node, text.substring(to)))
            }
            position = next
        }
        return source.root.put("content", result).toString()
    }

    /** Modify one textStyle attribute while preserving other marks and attributes. */
    fun setTextStyleAttribute(block: String, start: Int, end: Int, attribute: String, value: String?): String {
        require(attribute in setOf("color", "backgroundColor", "fontSize"))
        if (attribute == "fontSize" && value != null) {
            val match = Regex("^(\\d+(?:\\.\\d+)?)(pt|px)$").matchEntire(value)
            require(match != null && match.groupValues[1].toFloatOrNull()?.let { it in 1f..200f } == true)
        }
        val source = parse(block); validateRange(source, start, end); require(start < end)
        val result = JSONArray(); var position = 0
        for (node in source.nodes) {
            val text = textOf(node); val next = position + text.length
            if (node.optString("type") != "text" || next <= start || position >= end) result.put(copy(node))
            else {
                val from = (start - position).coerceIn(0, text.length); val to = (end - position).coerceIn(0, text.length)
                if (from > 0) result.put(copyText(node, text.substring(0, from)))
                val selected = copyText(node, text.substring(from, to)); val oldMarks = node.optJSONArray("marks") ?: JSONArray()
                val newMarks = JSONArray(); var style: JSONObject? = null
                for (i in 0 until oldMarks.length()) {
                    val mark = oldMarks.getJSONObject(i)
                    if (mark.optString("type") == "textStyle") {
                        require(style == null) { "Duplicate text style" }
                        style = copy(mark)
                    } else newMarks.put(copy(mark))
                }
                if (style != null || value != null) {
                    val current = style ?: JSONObject().put("type", "textStyle")
                    require(!current.has("attrs") || current.isNull("attrs") || current.optJSONObject("attrs") != null)
                    val attrs = current.optJSONObject("attrs") ?: JSONObject().also { current.put("attrs", it) }
                    if (value == null) attrs.remove(attribute) else attrs.put(attribute, value)
                    if (attrs.length() > 0) newMarks.put(current)
                }
                if (newMarks.length() == 0) selected.remove("marks") else selected.put("marks", newMarks)
                result.put(selected)
                if (to < text.length) result.put(copyText(node, text.substring(to)))
            }
            position = next
        }
        return source.root.put("content", result).toString()
    }

    private data class Source(val root: JSONObject, val nodes: List<JSONObject>, val text: String)

    private fun parse(raw: String): Source {
        val root = JSONObject(raw)
        if (root.optString("type") !in setOf("paragraph", "heading")) throw UnsupportedContent("Only paragraphs and headings are supported")
        if (root.has("content") && !root.isNull("content") && root.optJSONArray("content") == null) throw UnsupportedContent("Invalid inline content")
        val content = root.optJSONArray("content") ?: JSONArray()
        val nodes = (0 until content.length()).map { index ->
            val node = content.optJSONObject(index) ?: throw UnsupportedContent("Invalid inline node")
            if (node.optString("type") !in setOf("text", "hardBreak")) throw UnsupportedContent("Unsupported inline node")
            if (node.optString("type") == "text" && (node.opt("text") !is String || node.getString("text").isEmpty())) throw UnsupportedContent("Invalid text node")
            if (node.optString("type") == "text") validateUnicode(node.getString("text"))
            if (node.has("marks")) {
                val marks = node.optJSONArray("marks") ?: throw UnsupportedContent("Invalid marks")
                for (i in 0 until marks.length()) if (marks.optJSONObject(i)?.optString("type").isNullOrBlank()) throw UnsupportedContent("Invalid mark")
            }
            node
        }
        val text = nodes.joinToString("") { textOf(it) }
        validateUnicode(text)
        return Source(root, nodes, text)
    }

    private fun validateRange(source: Source, start: Int, end: Int) {
        require(start in 0..source.text.length && end in start..source.text.length) { "Invalid selection" }
        for (offset in listOf(start, end)) {
            require(offset == 0 || offset == source.text.length || !(source.text[offset - 1].isHighSurrogate() && source.text[offset].isLowSurrogate())) { "Selection splits a Unicode character" }
        }
    }

    private fun validateUnicode(text: String) {
        var index = 0
        while (index < text.length) {
            val c = text[index]
            if (c.isHighSurrogate()) { require(index + 1 < text.length && text[index + 1].isLowSurrogate()) { "Invalid Unicode" }; index++ }
            else require(!c.isLowSurrogate()) { "Invalid Unicode" }
            index++
        }
    }

    private fun textOf(node: JSONObject) = if (node.optString("type") == "hardBreak") "\n" else node.getString("text")
    private fun copy(node: JSONObject) = JSONObject(node.toString())
    private fun copyText(node: JSONObject, text: String) = copy(node).put("text", text)
    private fun copyMarks(node: JSONObject): JSONArray? = node.optJSONArray("marks")?.let { JSONArray(it.toString()) }
    private fun appendAll(to: JSONArray, from: JSONArray) { for (i in 0 until from.length()) to.put(from.get(i)) }

    private fun appendInserted(to: JSONArray, text: String, marks: JSONArray?) {
        val parts = text.split('\n')
        for ((index, part) in parts.withIndex()) {
            if (index > 0) to.put(JSONObject().put("type", "hardBreak"))
            if (part.isNotEmpty()) {
                val node = JSONObject().put("type", "text").put("text", part)
                if (marks != null && marks.length() > 0) node.put("marks", JSONArray(marks.toString()))
                to.put(node)
            }
        }
    }
}
