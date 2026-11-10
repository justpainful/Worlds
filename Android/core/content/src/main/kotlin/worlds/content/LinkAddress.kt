package worlds.content

import java.net.URI
import java.util.Locale

/** Only external link schemes supported by the Worlds editor are opened. */
object LinkAddress {
    fun isSupported(value: String): Boolean {
        if (value.isEmpty() || value.length > 2048 || value.any { it.isWhitespace() || it.isISOControl() }) return false
        val uri = runCatching { URI(value) }.getOrNull() ?: return false
        return when (uri.scheme?.lowercase(Locale.ROOT)) {
            "http", "https" -> !uri.host.isNullOrBlank() && uri.userInfo == null
            "mailto" -> uri.isOpaque && !uri.schemeSpecificPart.isNullOrBlank()
            else -> false
        }
    }
}
