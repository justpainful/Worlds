package worlds.sync

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody
import okio.BufferedSink
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class SharedVersion(val id: String, val createdAt: Long, val label: String?, val authors: List<String>, val size: Long)

/** Authenticated access to the sync Worker's version endpoints. */
class SharedHistory(private val allowInsecureLoopback: Boolean = false) {
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .callTimeout(20, TimeUnit.SECONDS).build()

    fun list(base: String, workspace: String, page: String, token: String): List<SharedVersion> {
        val bytes = get(base, workspace, page, token, null, 2 * 1024 * 1024)
        val array = JSONObject(bytes.toString(Charsets.UTF_8)).getJSONArray("versions")
        require(array.length() <= 5000)
        return (0 until array.length()).map { index ->
            parseVersion(array.getJSONObject(index))
        }
    }

    fun create(base: String, workspace: String, page: String, token: String, label: String?): SharedVersion {
        require(label == null || label.length <= 200)
        val json = JSONObject().put("label", label ?: JSONObject.NULL).toString()
        val bytes = get(base, workspace, page, token, null, 2 * 1024 * 1024, json)
        return parseVersion(JSONObject(bytes.toString(Charsets.UTF_8)))
    }

    private fun parseVersion(obj: JSONObject): SharedVersion {
        val id = obj.getString("id"); require(id.isNotBlank() && id.length <= 128)
        val authors = obj.getJSONArray("authors"); require(authors.length() <= 1000)
        return SharedVersion(id, obj.getLong("createdAt"), if (obj.isNull("label")) null else obj.getString("label"),
            (0 until authors.length()).map { authors.getString(it) }, obj.getLong("size"))
    }

    fun state(base: String, workspace: String, page: String, token: String, id: String): ByteArray {
        require(id.isNotBlank() && id.length <= 128)
        return get(base, workspace, page, token, id, 8 * 1024 * 1024)
    }

    private fun get(base: String, workspace: String, page: String, token: String, id: String?, limit: Int, json: String? = null): ByteArray {
        require(workspace.isNotBlank() && page.isNotBlank() && token.isNotBlank() && token.none { it == '\r' || it == '\n' })
        val root = base.toHttpUrl()
        require(root.username.isEmpty() && root.password.isEmpty() && root.query == null && root.fragment == null)
        require(root.isHttps || (allowInsecureLoopback && root.scheme == "http" && root.host in setOf("127.0.0.1", "localhost", "10.0.2.2", "::1")))
        val url = root.newBuilder().addPathSegment("v1").addPathSegment("workspaces").addPathSegment(workspace)
            .addPathSegment("docs").addPathSegment(page).addPathSegment("versions").apply { if (id != null) addPathSegment(id) }.build()
        val request = Request.Builder().url(url).header("Authorization", "Bearer $token").apply {
            if (json != null) post(object : RequestBody() {
                private val bytes = json.toByteArray(Charsets.UTF_8)
                override fun contentType() = "application/json; charset=utf-8".toMediaType()
                override fun contentLength() = bytes.size.toLong()
                override fun isOneShot() = true
                override fun writeTo(sink: BufferedSink) { sink.write(bytes) }
            })
        }.build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Shared history request failed (${response.code})")
            val body = response.body ?: throw IOException("Missing response")
            if (body.contentLength() > limit) throw IOException("History response too large")
            val source = body.source()
            source.request(limit.toLong() + 1)
            if (source.buffer.size > limit) throw IOException("History response too large")
            return source.readByteArray()
        }
    }
}
