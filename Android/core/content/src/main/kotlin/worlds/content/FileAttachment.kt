package worlds.content

import org.json.JSONObject

data class FileAttachment(val id: String, val name: String, val mime: String, val size: Long, val kind: String) {
    companion object {
        fun read(metadata: String): FileAttachment? = runCatching {
            val file = JSONObject(metadata).getJSONObject("file")
            val id = file.getString("attachmentId"); val name = file.getString("name"); val mime = file.getString("mime"); val size = file.getLong("size")
            require(Regex("[0-9a-f]{32}").matches(id) && size >= 0 && name.length <= 512 && mime.length <= 127 && Regex("[A-Za-z0-9!#\\$&^_.+-]+/[A-Za-z0-9!#\\$&^_.+-]+").matches(mime))
            FileAttachment(id, name, mime, size, file.optString("kind", "file"))
        }.getOrNull()
    }
}
