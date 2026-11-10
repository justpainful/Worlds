package worlds.content

import org.json.JSONArray
import org.json.JSONObject

/** Edits ProseMirror list items without rewriting their siblings or unknown children. */
object ListEditing {
    data class Item(val index: Int, val paragraph: String?, val checked: Boolean?, val incomplete: Boolean,
        val path: List<Int>, val depth: Int, val listType: String, val number: Int, val siblingCount: Int)
    data class ListBlock(val type: String, val start: Int, val items: List<Item>)
    private val types = setOf("bulletList", "orderedList", "taskList")
    private const val MAX_DEPTH = 16
    private const val MAX_ITEMS = 3000

    fun read(raw: String): ListBlock {
        val root = JSONObject(raw)
        require(isList(root)) { "Not a supported list" }
        val result = mutableListOf<Item>()
        fun visit(list: JSONObject, path: List<Int>, depth: Int) {
            require(depth <= MAX_DEPTH && isList(list))
            val type = list.getString("type")
            val content = list.getJSONArray("content")
            val start = start(list)
            for (index in 0 until content.length()) {
                require(result.size < MAX_ITEMS) { "List exceeds display limit" }
                val itemPath = path + index
                val item = content.optJSONObject(index)
                val expected = if (type == "taskList") "taskItem" else "listItem"
                if (item == null || item.optString("type") != expected) {
                    result.add(Item(index, null, null, true, itemPath, depth, type, start + index, content.length()))
                    continue
                }
                val children = item.optJSONArray("content")
                val paragraph = children?.optJSONObject(0)?.takeIf { it.optString("type") == "paragraph" }
                val checked = if (type == "taskList") checked(item) else null
                val nested = mutableListOf<Pair<Int, JSONObject>>()
                var incomplete = children == null || paragraph == null || (type == "taskList" && checked == null)
                if (children != null) for (childIndex in 1 until children.length()) {
                    val child = children.optJSONObject(childIndex)
                    if (child != null && depth < MAX_DEPTH && isList(child) && validStart(child)) nested.add(childIndex to child)
                    else incomplete = true
                }
                result.add(Item(index, paragraph?.toString(), checked, incomplete, itemPath, depth, type, start + index, content.length()))
                nested.forEach { (childIndex, child) -> visit(child, itemPath + childIndex, depth + 1) }
            }
        }
        visit(root, emptyList(), 0)
        return ListBlock(root.getString("type"), start(root), result)
    }

    fun create(type: String, id: String, paragraph: String): String {
        require(type in types && id.isNotBlank())
        val node = validateParagraph(paragraph)
        return JSONObject().put("type", type).put("attrs", JSONObject().put("bid", id))
            .put("content", JSONArray().put(newItem(type, node))).toString()
    }

    fun append(raw: String): String {
        val root = JSONObject(raw); require(isList(root)); start(root)
        root.getJSONArray("content").put(newItem(root.getString("type"), JSONObject().put("type", "paragraph")))
        return checkedResult(root)
    }

    fun insertAfter(raw: String, path: List<Int>): String {
        val root = JSONObject(raw); val list = parentList(root, path)
        val content = list.getJSONArray("content"); val index = path.last()
        requireItem(list, index)
        val values = (0 until content.length()).map { content.get(it) }.toMutableList()
        values.add(index + 1, newItem(list.getString("type"), JSONObject().put("type", "paragraph")))
        list.put("content", JSONArray(values)); return checkedResult(root)
    }

    fun addNested(raw: String, path: List<Int>): String {
        val root = JSONObject(raw); val list = parentList(root, path); val item = requireItem(list, path.last())
        val children = item.getJSONArray("content")
        require(children.optJSONObject(0)?.optString("type") == "paragraph")
        val type = list.getString("type")
        require(path.size / 2 < MAX_DEPTH)
        children.put(JSONObject().put("type", type).put("content", JSONArray().put(newItem(type, JSONObject().put("type", "paragraph")))))
        return checkedResult(root)
    }

    fun move(raw: String, path: List<Int>, direction: Int): String {
        require(direction == -1 || direction == 1)
        val root = JSONObject(raw); val list = parentList(root, path); val content = list.getJSONArray("content")
        val index = path.last(); requireItem(list, index)
        val destination = index + direction; require(destination in 0 until content.length())
        val values = (0 until content.length()).map { content.get(it) }.toMutableList()
        val item = values.removeAt(index); values.add(destination, item); list.put("content", JSONArray(values))
        return root.toString()
    }

    /** A null result means the final root item was removed, so its entire block is removed. */
    fun remove(raw: String, path: List<Int>): String? {
        val root = JSONObject(raw); val list = parentList(root, path); val content = list.getJSONArray("content")
        val index = path.last(); requireItem(list, index)
        content.remove(index)
        if (content.length() == 0) {
            if (path.size == 1) return null
            val parentItem = itemAt(root, path.dropLast(2))
            parentItem.getJSONArray("content").remove(path[path.size - 2])
        }
        return root.toString()
    }

    fun replaceParagraph(raw: String, index: Int, paragraph: String): String = replaceParagraph(raw, listOf(index), paragraph)
    fun replaceParagraph(raw: String, path: List<Int>, paragraph: String): String {
        val root = JSONObject(raw); val item = itemAt(root, path); val children = item.getJSONArray("content")
        require(children.optJSONObject(0)?.optString("type") == "paragraph")
        children.put(0, validateParagraph(paragraph)); return root.toString()
    }

    fun setChecked(raw: String, index: Int, checked: Boolean): String = setChecked(raw, listOf(index), checked)
    fun setChecked(raw: String, path: List<Int>, checked: Boolean): String {
        val root = JSONObject(raw); val list = parentList(root, path)
        require(list.getString("type") == "taskList")
        val item = requireItem(list, path.last()); require(checked(item) != null)
        val attrs = item.optJSONObject("attrs") ?: JSONObject().also { item.put("attrs", it) }
        attrs.put("checked", checked); return root.toString()
    }

    private fun parentList(root: JSONObject, path: List<Int>): JSONObject {
        require(path.isNotEmpty() && path.size % 2 == 1 && path.size <= MAX_DEPTH * 2 + 1)
        var list = root
        require(isList(list)); start(list)
        var offset = 0
        while (offset < path.lastIndex) {
            val item = requireItem(list, path[offset]); val children = item.getJSONArray("content")
            val child = children.getJSONObject(path[offset + 1]); require(isList(child)); start(child)
            list = child; offset += 2
        }
        return list
    }
    private fun itemAt(root: JSONObject, path: List<Int>): JSONObject = requireItem(parentList(root, path), path.last())
    private fun requireItem(list: JSONObject, index: Int): JSONObject {
        val item = list.getJSONArray("content").getJSONObject(index)
        require(item.optString("type") == if (list.getString("type") == "taskList") "taskItem" else "listItem")
        return item
    }
    private fun checked(item: JSONObject): Boolean? {
        val attrs = item.optJSONObject("attrs")
        return when {
            item.has("attrs") && !item.isNull("attrs") && attrs == null -> null
            attrs == null || !attrs.has("checked") -> false
            attrs.opt("checked") is Boolean -> attrs.getBoolean("checked")
            else -> null
        }
    }
    private fun isList(node: JSONObject) = node.optString("type") in types && node.optJSONArray("content") != null
    private fun validStart(node: JSONObject) = runCatching { start(node) }.isSuccess
    private fun start(node: JSONObject): Int {
        val value = if (node.getString("type") == "orderedList") node.optJSONObject("attrs")?.optInt("start", 1) ?: 1 else 1
        require(value in 1..1000000); return value
    }
    private fun checkedResult(root: JSONObject): String = root.toString().also { read(it) }
    private fun validateParagraph(raw: String): JSONObject {
        val node = JSONObject(raw); require(node.optString("type") == "paragraph"); InlineEditing.text(raw); return node
    }
    private fun newItem(type: String, paragraph: JSONObject): JSONObject {
        val item = JSONObject().put("type", if (type == "taskList") "taskItem" else "listItem")
        if (type == "taskList") item.put("attrs", JSONObject().put("checked", false))
        return item.put("content", JSONArray().put(paragraph))
    }
}
