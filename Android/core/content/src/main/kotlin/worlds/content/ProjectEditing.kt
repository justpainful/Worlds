package worlds.content

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.format.DateTimeParseException

data class ProjectInfo(val status: String, val start: String?, val due: String?, val description: String, val links: List<String>)

/** Reads and patches the same metadata.project fields used by the desktop app. */
object ProjectEditing {
    val statuses = setOf("planned", "active", "paused", "done")
    val childKinds = setOf("page", "document", "drawing", "project", "gallery", "presentation", "file", "stream")
    val defaultProjectMetadata = """{"project":{"status":"active","start":null,"due":null,"description":"","links":[]}}"""
    val defaultDocumentMetadata = """{"doc":{"size":"A4","orientation":"portrait","margins":{"top":25,"right":22,"bottom":25,"left":22},"header":"","footer":"","font":"Default","fontSize":12,"lineHeight":1.5}}"""

    fun validDate(value: String?): Boolean {
        if (value == null) return true
        if (!Regex("\\d{4}-\\d{2}-\\d{2}").matches(value)) return false
        return try { LocalDate.parse(value); true } catch (_: DateTimeParseException) { false }
    }

    fun read(metadata: String): ProjectInfo {
        val root = JSONObject(metadata)
        require(!root.has("project") || root.isNull("project") || root.optJSONObject("project") != null)
        val project = root.optJSONObject("project") ?: JSONObject()
        fun optionalString(key: String): String? {
            if (!project.has(key) || project.isNull(key)) return null
            return project.opt(key) as? String ?: throw IllegalArgumentException("Invalid project field")
        }
        val status = optionalString("status") ?: "active"
        val start = optionalString("start"); val due = optionalString("due")
        val description = optionalString("description") ?: ""
        require(status in statuses && validDate(start) && validDate(due) && description.length <= 10_000)
        require(!project.has("links") || project.isNull("links") || project.optJSONArray("links") != null)
        val raw = project.optJSONArray("links") ?: JSONArray()
        require(raw.length() <= 1000)
        val links = (0 until raw.length()).map { index -> (raw.opt(index) as? String)?.takeIf { it.isNotBlank() } ?: throw IllegalArgumentException("Invalid link") }
        return ProjectInfo(status, start, due, description, links)
    }

    fun updateDetails(metadata: String, status: String, start: String?, due: String?, description: String): String {
        read(metadata)
        require(status in statuses && validDate(start) && validDate(due) && description.length <= 10_000)
        val root = JSONObject(metadata); val project = root.optJSONObject("project") ?: JSONObject().also { root.put("project", it) }
        project.put("status", status).put("start", start ?: JSONObject.NULL).put("due", due ?: JSONObject.NULL).put("description", description)
        return root.toString()
    }

    fun updateLinks(metadata: String, links: List<String>): String {
        read(metadata); require(links.size <= 1000 && links.all { it.isNotBlank() })
        val root = JSONObject(metadata); val project = root.optJSONObject("project") ?: JSONObject().also { root.put("project", it) }
        project.put("links", JSONArray(links)); return root.toString()
    }
}
