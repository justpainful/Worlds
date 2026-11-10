package worlds.identity

import org.json.JSONObject
import org.json.JSONArray
import org.json.JSONTokener
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.nio.charset.StandardCharsets
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

class IdentityApiException(val status: Int, val code: String) : IOException("Identity request failed: $status ($code)")

/** Separates transport from account state so rotation failures can be tested deterministically. */
fun interface IdentityTransport {
    @Throws(IOException::class)
    fun request(baseUrl: String, method: String, path: String, body: JSONObject?, bearer: String?): JSONObject
    fun requestArray(baseUrl: String, path: String, bearer: String): JSONArray = throw UnsupportedOperationException("Array responses are not supported")
}

/** Production transport requires HTTPS, does not follow redirects and never retries POSTs. */
class HttpsIdentityTransport(private val patchClient: OkHttpClient = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).callTimeout(20, TimeUnit.SECONDS).build()) : IdentityTransport {
    override fun request(baseUrl: String, method: String, path: String, body: JSONObject?, bearer: String?): JSONObject =
        exchange(baseUrl, method, path, body, bearer) as? JSONObject ?: throw IOException("Expected an object response")

    override fun requestArray(baseUrl: String, path: String, bearer: String): JSONArray =
        exchange(baseUrl, "GET", path, null, bearer) as? JSONArray ?: throw IOException("Expected an array response")

    private fun exchange(baseUrl: String, method: String, path: String, body: JSONObject?, bearer: String?): Any {
        val base = canonicalBaseUrl(baseUrl)
        require(method in setOf("GET", "POST", "PUT", "PATCH", "DELETE"))
        require(path.startsWith("/") && !path.startsWith("//") && '?' !in path && '#' !in path)
        require(bearer == null || (bearer.isNotBlank() && bearer.none { it == '\r' || it == '\n' }))
        if (method == "PATCH") return patch(base, path, requireNotNull(body), bearer)
        val connection = URL(base + path).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = method
            connection.connectTimeout = 15_000; connection.readTimeout = 20_000
            connection.setRequestProperty("Accept", "application/json")
            if (bearer != null) connection.setRequestProperty("Authorization", "Bearer $bearer")
            if (body != null) {
                val bytes = body.toString().toByteArray(StandardCharsets.UTF_8)
                require(bytes.size <= MAX_RESPONSE)
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            val input = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = input?.use { stream ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val count = stream.read(buffer)
                    if (count < 0) break
                    if (count == 0) continue
                    if (output.size() + count > MAX_RESPONSE) throw IOException("Identity response exceeds limit")
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            } ?: ByteArray(0)
            if (bytes.size > MAX_RESPONSE) throw IOException("Identity response exceeds limit")
            val result = if (bytes.isEmpty()) JSONObject() else try { JSONTokener(String(bytes, StandardCharsets.UTF_8)).nextValue() } catch (_: Exception) { throw IOException("Invalid identity response") }
            if (status !in 200..299) {
                val code = (result as? JSONObject)?.optString("error", "http_error") ?: "http_error"
                throw IdentityApiException(status, if (code.matches(Regex("[a-z0-9_]{1,80}"))) code else "http_error")
            }
            return result
        } finally { connection.disconnect() }
    }
    private fun patch(base: String, path: String, body: JSONObject, bearer: String?): Any {
        val bytes = body.toString().toByteArray(StandardCharsets.UTF_8)
        require(bytes.size <= MAX_RESPONSE)
        val request = Request.Builder().url(base + path).apply { if (bearer != null) header("Authorization", "Bearer $bearer") }
            .header("Accept", "application/json").patch(bytes.toRequestBody("application/json; charset=utf-8".toMediaType())).build()
        patchClient.newCall(request).execute().use { response ->
            val responseBody = response.body ?: throw IOException("Missing identity response")
            if (responseBody.contentLength() > MAX_RESPONSE) throw IOException("Identity response exceeds limit")
            val source = responseBody.source(); source.request(MAX_RESPONSE.toLong() + 1)
            if (source.buffer.size > MAX_RESPONSE) throw IOException("Identity response exceeds limit")
            val raw = source.readByteArray()
            val result = if (raw.isEmpty()) JSONObject() else try { JSONTokener(String(raw, StandardCharsets.UTF_8)).nextValue() } catch (_: Exception) { throw IOException("Invalid identity response") }
            if (!response.isSuccessful) {
                val code = (result as? JSONObject)?.optString("error", "http_error") ?: "http_error"
                throw IdentityApiException(response.code, if (code.matches(Regex("[a-z0-9_]{1,80}"))) code else "http_error")
            }
            return result
        }
    }
    companion object { private const val MAX_RESPONSE = 2 * 1024 * 1024 }
}

fun canonicalBaseUrl(value: String): String {
    val uri = URI(value.trim())
    require(uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank()) { "Identity server must use HTTPS" }
    require(uri.userInfo == null && uri.query == null && uri.fragment == null && (uri.path.isNullOrEmpty() || uri.path == "/")) { "Invalid identity server URL" }
    require(uri.port == -1 || uri.port in 1..65535)
    return URI("https", null, uri.host.lowercase(), uri.port, null, null, null).toASCIIString()
}
