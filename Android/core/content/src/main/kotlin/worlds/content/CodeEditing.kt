package worlds.content

import org.json.JSONArray
import org.json.JSONObject

/** Edits only plain code nodes, preserving the block and its attributes. */
object CodeEditing {
    data class Value(val text: String, val language: String)

    fun read(raw: String): Value {
        val root = JSONObject(raw)
        require(root.optString("type") == "codeBlock")
        require(!root.has("attrs") || root.optJSONObject("attrs") != null)
        val attrs = root.optJSONObject("attrs")
        require(attrs == null || !attrs.has("language") || attrs.opt("language") is String)
        require(!root.has("content") || root.optJSONArray("content") != null)
        val content = root.optJSONArray("content") ?: JSONArray()
        val value = StringBuilder()
        for (i in 0 until content.length()) {
            val child = content.getJSONObject(i)
            require(child.optString("type") == "text" && child.opt("text") is String)
            require(child.keys().asSequence().all { it == "type" || it == "text" })
            value.append(child.getString("text"))
        }
        return Value(value.toString(), attrs?.optString("language", "") ?: "")
    }

    fun update(raw: String, text: String, language: String): String {
        read(raw)
        val root = JSONObject(raw)
        val attrs = root.optJSONObject("attrs") ?: JSONObject().also { root.put("attrs", it) }
        attrs.put("language", language)
        if (text.isEmpty()) root.remove("content") else root.put("content", JSONArray().put(JSONObject().put("type", "text").put("text", text)))
        return root.toString()
    }
}
