package worlds.content

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Desktop-compatible slide nodes; edits retain unknown fields and elements. */
object PresentationEditing {
    const val defaultMetadata = """{"deck":{"aspect":"16:9","theme":"dark"}}"""
    private fun id() = UUID.randomUUID().toString().replace("-", "").take(26)
    private val layouts = setOf("title", "title-body", "section", "two-columns", "image", "blank")
    private fun layoutElements(layout: String): JSONArray {
        require(layout in layouts)
        val elements = JSONArray()
        fun text(role: String, x: Int, y: Int, w: Int, h: Int, size: Int, weight: Int, align: String, color: String = "#f4f2ee") {
            elements.put(JSONObject().put("id", id()).put("type", "text").put("role", role).put("x", x).put("y", y).put("w", w).put("h", h).put("text", "")
                .put("style", JSONObject().put("fontSize", size).put("fontWeight", weight).put("color", color).put("align", align)))
        }
        when (layout) {
            "title" -> { text("title", 120, 250, 1040, 140, 76, 700, "center"); text("subtitle", 200, 400, 880, 70, 30, 400, "center", "rgba(244, 242, 238, 0.66)") }
            "title-body" -> { text("title", 90, 70, 1100, 100, 54, 700, "left"); text("body", 90, 200, 1100, 440, 30, 400, "left") }
            "section" -> { text("title", 90, 280, 1100, 120, 64, 700, "left"); elements.put(JSONObject().put("id", id()).put("type", "shape").put("shape", "rect").put("x", 90).put("y", 250).put("w", 90).put("h", 8).put("fill", "#d2a46e").put("radius", 4)) }
            "two-columns" -> { text("title", 90, 70, 1100, 100, 50, 700, "left"); text("body", 90, 210, 530, 430, 28, 400, "left"); text("body", 660, 210, 530, 430, 28, 400, "left") }
            "image" -> text("title", 90, 560, 1100, 70, 36, 600, "center")
        }
        return elements
    }
    fun newSlide(layout: String): ContentBlock {
        val bid = id(); val elements = layoutElements(layout)
        val attrs = JSONObject().put("bid", bid).put("layout", layout).put("background", JSONObject().put("color", "#16161a")).put("notes", "").put("elements", elements)
        return ContentBlock(bid, JSONObject().put("type", "slide").put("attrs", attrs).toString())
    }
    fun changeLayout(block: ContentBlock, layout: String): ContentBlock {
        val fresh = layoutElements(layout)
        val node = JSONObject(block.content); require(node.optString("type") == "slide")
        val attrs = requireNotNull(node.optJSONObject("attrs")); val original = requireNotNull(attrs.optJSONArray("elements"))
        val filled = mutableListOf<JSONObject>(); val own = mutableListOf<JSONObject>()
        for (i in 0 until original.length()) {
            val element = requireNotNull(original.optJSONObject(i))
            if (element.optString("type") == "text" && element.optString("role").isNotBlank()) {
                if (element.optString("text").isNotBlank()) filled.add(element)
            } else own.add(element)
        }
        for (i in 0 until fresh.length()) {
            val element = fresh.getJSONObject(i); val role = element.optString("role")
            if (role.isBlank()) continue
            val match = filled.indexOfFirst { it.optString("role") == role }
            if (match >= 0) element.put("text", filled.removeAt(match).optString("text"))
        }
        own.forEach { fresh.put(it) }
        filled.forEach { it.remove("role"); fresh.put(it) }
        attrs.put("layout", layout).put("elements", fresh)
        return ContentBlock(block.id, node.toString())
    }
    fun changeBackground(block: ContentBlock, color: String): ContentBlock {
        require(color.matches(Regex("#[0-9a-fA-F]{6}")))
        val node = JSONObject(block.content); require(node.optString("type") == "slide")
        val attrs = requireNotNull(node.optJSONObject("attrs"))
        require(!attrs.has("background") || attrs.optJSONObject("background") != null)
        val background = attrs.optJSONObject("background") ?: JSONObject()
        background.put("color", color); background.remove("attachmentId")
        attrs.put("background", background)
        return ContentBlock(block.id, node.toString())
    }
    fun removeBackgroundImage(block: ContentBlock): ContentBlock {
        val node = JSONObject(block.content); require(node.optString("type") == "slide")
        val attrs = requireNotNull(node.optJSONObject("attrs")); val background = requireNotNull(attrs.optJSONObject("background"))
        require(background.optString("attachmentId").isNotBlank())
        background.remove("attachmentId")
        return ContentBlock(block.id, node.toString())
    }
    fun changeTextStyle(block: ContentBlock, elementId: String, changes: Map<String, String>): ContentBlock {
        require(changes.keys.all { it in setOf("fontSize", "fontWeight", "italic", "align", "color") })
        val node = JSONObject(block.content); require(node.optString("type") == "slide")
        val elements = requireNotNull(node.optJSONObject("attrs")?.optJSONArray("elements"))
        val matches = (0 until elements.length()).mapNotNull { elements.optJSONObject(it) }.filter { it.optString("id") == elementId }
        require(matches.size == 1); val element = matches.single(); require(element.optString("type") == "text")
        require(!element.has("style") || element.optJSONObject("style") != null)
        val style = element.optJSONObject("style") ?: JSONObject()
        changes.forEach { (key, value) -> when (key) {
            "fontSize" -> { val size = value.toInt(); require(size in 4..300); style.put(key, size) }
            "fontWeight" -> { val weight = value.toInt(); require(weight == 500 || weight == 700); style.put(key, weight) }
            "italic" -> { require(value == "true" || value == "false"); style.put(key, value.toBoolean()) }
            "align" -> { require(value in setOf("left", "center", "right")); style.put(key, value) }
            "color" -> { require(value.matches(Regex("#[0-9a-fA-F]{6}"))); style.put(key, value) }
        } }
        element.put("style", style)
        return ContentBlock(block.id, node.toString())
    }
    fun edit(block: ContentBlock, texts: Map<String, String>, notes: String): ContentBlock {
        require(notes.length <= 20_000 && texts.values.all { it.length <= 20_000 })
        val node = JSONObject(block.content); require(node.optString("type") == "slide")
        val attrs = requireNotNull(node.optJSONObject("attrs")); val elements = requireNotNull(attrs.optJSONArray("elements"))
        val remaining = texts.keys.toMutableSet()
        for (i in 0 until elements.length()) {
            val el = elements.optJSONObject(i) ?: continue
            val key = el.optString("id")
            if (key in texts) { require(el.optString("type") == "text" && remaining.remove(key)); el.put("text", texts.getValue(key)) }
        }
        require(remaining.isEmpty()); attrs.put("notes", notes)
        return ContentBlock(block.id, node.toString())
    }
    fun addElement(block: ContentBlock, kind: String): ContentBlock {
        val node = JSONObject(block.content); require(node.optString("type") == "slide")
        val elements = requireNotNull(node.optJSONObject("attrs")?.optJSONArray("elements"))
        require(elements.length() < 1000)
        val element = JSONObject().put("id", id())
        when (kind) {
            "text" -> element.put("type", "text").put("x", 340).put("y", 300).put("w", 600).put("h", 110).put("text", "")
                .put("style", JSONObject().put("fontSize", 36).put("fontWeight", 500).put("color", "#f4f2ee").put("align", "left"))
            "rect", "ellipse" -> element.put("type", "shape").put("shape", kind).put("x", 490).put("y", 210).put("w", 300).put("h", 300).put("fill", "#d2a46e").put("radius", if (kind == "rect") 18 else 0)
            "line" -> element.put("type", "shape").put("shape", "line").put("x", 440).put("y", 358).put("w", 400).put("h", 4).put("stroke", "#f4f2ee")
            else -> error("Unsupported element")
        }
        elements.put(element); return ContentBlock(block.id, node.toString())
    }
    fun changeElement(block: ContentBlock, elementId: String, bounds: List<Int>?, remove: Boolean): ContentBlock {
        val node = JSONObject(block.content); require(node.optString("type") == "slide")
        val elements = requireNotNull(node.optJSONObject("attrs")?.optJSONArray("elements"))
        val matches = (0 until elements.length()).filter { elements.optJSONObject(it)?.optString("id") == elementId }
        require(matches.size == 1)
        val index = matches.single(); val element = elements.getJSONObject(index)
        require(element.optString("type") in setOf("text", "shape", "image", "video"))
        if (remove) elements.remove(index) else {
            require(bounds != null && bounds.size == 4 && bounds[0] in -1280..2560 && bounds[1] in -720..1440 && bounds[2] in 16..2560 && bounds[3] in 4..1440)
            element.put("x", bounds[0]).put("y", bounds[1]).put("w", bounds[2]).put("h", bounds[3])
        }
        return ContentBlock(block.id, node.toString())
    }
    fun moveElement(block: ContentBlock, elementId: String, x: Int, y: Int): ContentBlock {
        require(x in -1280..2560 && y in -720..1440)
        val node = JSONObject(block.content); require(node.optString("type") == "slide")
        val elements = requireNotNull(node.optJSONObject("attrs")?.optJSONArray("elements"))
        val matches = (0 until elements.length()).mapNotNull { elements.optJSONObject(it) }.filter { it.optString("id") == elementId }
        require(matches.size == 1); val element = matches.single()
        require(element.optString("type") in setOf("text", "shape", "image", "video"))
        element.put("x", x).put("y", y)
        return ContentBlock(block.id, node.toString())
    }
    fun duplicate(block: ContentBlock): ContentBlock {
        val node = JSONObject(block.content); require(node.optString("type") == "slide")
        val attrs = requireNotNull(node.optJSONObject("attrs")); val elements = requireNotNull(attrs.optJSONArray("elements")); val bid = id(); attrs.put("bid", bid)
        for (i in 0 until elements.length()) {
            val element = requireNotNull(elements.optJSONObject(i))
            require(element.optString("type") in setOf("text", "shape", "image", "video")) { "Cannot duplicate unsupported slide elements" }
            element.put("id", id())
        }
        return ContentBlock(bid, node.toString())
    }
}
