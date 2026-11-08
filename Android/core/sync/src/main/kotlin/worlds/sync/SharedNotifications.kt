package worlds.sync

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class SyncNotice(val id: String, val kind: String, val workspace: String, val page: String,
    val thread: String, val comment: String, val sender: String, val senderName: String?, val excerpt: String, val createdAt: Long, val readAt: Long?) {
    override fun toString() = "SyncNotice(id=$id, kind=$kind, content=[redacted])"
}
data class NoticeFeed(val items: List<SyncNotice>, val unread: Int)

/** Foreground access to the authenticated sync-server inbox. */
class SharedNotifications(private val allowInsecureLoopback: Boolean = false) {
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .callTimeout(20, TimeUnit.SECONDS).build()
    private val idPattern = Regex("[A-Za-z0-9_-]{1,128}")

    fun list(base: String, token: String): NoticeFeed {
        val body = JSONObject(request(base, token, null).toString(Charsets.UTF_8))
        val array = body.getJSONArray("items"); require(array.length() <= 200)
        val unread = body.getInt("unread"); require(unread >= 0)
        val items = (0 until array.length()).mapNotNull { index ->
            val item = array.getJSONObject(index)
            val kind = item.getString("kind")
            if (kind !in setOf("mention", "reply")) return@mapNotNull null
            val id = item.getString("id"); val workspace = item.getString("workspaceId"); val page = item.getString("docId")
            val thread = item.getString("threadId"); val comment = item.getString("commentId")
            require(listOf(thread, comment).all { it.isNotBlank() && it.length <= 160 && it !in setOf("__proto__", "constructor", "prototype") })
            val sender = item.getString("from"); val excerpt = item.optString("excerpt", "")
            val name = if (item.isNull("fromName")) null else item.optString("fromName").takeIf { it.isNotBlank() }
            require(id.isNotBlank() && id.length <= 200 && workspace.matches(idPattern) && page.matches(idPattern))
            require(sender.isNotBlank() && sender.length <= 160 && excerpt.length <= 10_000 && (name == null || name.length <= 256))
            SyncNotice(id, kind, workspace, page, thread, comment, sender, name, excerpt, item.getLong("createdAt"), if (item.isNull("readAt")) null else item.getLong("readAt"))
        }
        return NoticeFeed(items, unread)
    }

    /** The operation is idempotent; callers refresh from the server after success or uncertainty. */
    fun markRead(base: String, token: String, ids: List<String>?) {
        require(ids == null || (ids.isNotEmpty() && ids.size <= 200 && ids.all { it.isNotBlank() && it.length <= 200 }))
        val payload = JSONObject().put("ids", ids?.let { JSONArray(it) } ?: JSONObject.NULL).toString()
        val response = JSONObject(request(base, token, payload).toString(Charsets.UTF_8))
        require(response.optBoolean("ok", false) && response.getInt("marked") >= 0)
    }

    private fun request(base: String, token: String, json: String?): ByteArray {
        require(token.isNotBlank() && token.none { it == '\r' || it == '\n' })
        val root = base.toHttpUrl()
        require(root.username.isEmpty() && root.password.isEmpty() && root.query == null && root.fragment == null)
        require(root.isHttps || (allowInsecureLoopback && root.scheme == "http" && root.host in setOf("127.0.0.1", "localhost", "10.0.2.2", "::1")))
        val url = root.newBuilder().addPathSegment("v1").addPathSegment("notifications").apply {
            if (json == null) addQueryParameter("limit", "50") else addPathSegment("read")
        }.build()
        val req = Request.Builder().url(url).header("Authorization", "Bearer $token").apply {
            if (json != null) post(json.toRequestBody("application/json; charset=utf-8".toMediaType()))
        }.build()
        client.newCall(req).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Notification request failed (${response.code})")
            val body = response.body ?: throw IOException("Missing notification response")
            val limit = 1024 * 1024L
            if (body.contentLength() > limit) throw IOException("Notification response too large")
            val source = body.source(); source.request(limit + 1)
            if (source.buffer.size > limit) throw IOException("Notification response too large")
            return source.readByteArray()
        }
    }
}
