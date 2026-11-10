package worlds.content

import java.net.URI
import java.util.Locale
import org.json.JSONObject

data class StreamInfo(val url: String, val format: String)

/** Same stream metadata and path-based format detection as the desktop app. */
object StreamEditing {
    fun parseUrl(value: String): StreamInfo {
        val url = value.trim()
        require(url.isNotEmpty() && url.length <= 8192 && url.none { it.isWhitespace() || it.isISOControl() })
        val uri = URI(url)
        require(uri.scheme?.lowercase(Locale.ROOT) in setOf("http", "https") && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.port in -1..65535)
        val path = uri.rawPath.orEmpty().lowercase(Locale.ROOT)
        return StreamInfo(url, when { path.endsWith(".m3u8") || path.endsWith(".m3u") -> "hls"; path.endsWith(".mpd") -> "dash"; else -> "progressive" })
    }
    fun update(metadata: String, url: String): String {
        val stream = parseUrl(url); val root = JSONObject(metadata)
        require(!root.has("stream") || root.isNull("stream") || root.optJSONObject("stream") != null)
        val existing = root.optJSONObject("stream") ?: JSONObject()
        root.put("stream", existing.put("url", stream.url).put("format", stream.format))
        return root.toString()
    }
    fun read(metadata: String): StreamInfo? = runCatching {
        val stream = JSONObject(metadata).getJSONObject("stream")
        val parsed = parseUrl(stream.getString("url"))
        val format = stream.optString("format", parsed.format)
        require(format in setOf("hls", "dash", "progressive"))
        StreamInfo(parsed.url, format)
    }.getOrNull()
}
