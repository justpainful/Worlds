package worlds.android

import org.json.JSONObject

/**
 * HTML pages (docs/HTML_PAGES.md): the document a page's WebView receives.
 * It follows `compose` in src-tauri/src/html_page.rs: the Worlds base styles
 * and runtime go first in <head> so the page's own styles win, the boot data
 * cannot close its script, and a page that sets no language gets the app's.
 */
internal object HtmlPageDocument {
    const val KIND = "html"
    const val MAX_STATE_BYTES = 256 * 1024
    private val PAGE_ID = Regex("[A-Za-z0-9_-]{1,128}")

    /** The page's source and saved state from its metadata (`html.source`, `html.state`). */
    fun read(metadata: String): Pair<String, Any?> {
        val html = runCatching { JSONObject(metadata).optJSONObject("html") }.getOrNull() ?: return "" to null
        val state = html.opt("state").takeUnless { it == null || it == JSONObject.NULL }
        return html.optString("source", "") to state
    }

    fun isPageId(id: String) = PAGE_ID.matches(id)

    /**
     * `extraHead` goes right after the viewport, before the base styles and
     * the runtime: the platform's own policy and message bridge.
     */
    fun compose(source: String, state: Any?, lang: String, baseCss: String, runtimeJs: String, extraHead: String = ""): String {
        val language = if (lang == "ar") "ar" else "en"
        val boot = JSONObject().put("state", state ?: JSONObject.NULL).put("lang", language).toString().replace("</", "<\\/")
        val head = "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">$extraHead" +
            "<style data-worlds-base>$baseCss</style><script>window.__worldsBoot=$boot;</script><script>$runtimeJs</script>"
        val langAttrs = if (language == "ar") " lang=\"ar\" dir=\"rtl\"" else " lang=\"en\""
        // ASCII lowering keeps every index the same as in the source.
        val lower = asciiLower(source)
        val html = firstTag(lower, "html", 0)
            ?: return "<!doctype html><html$langAttrs><head>$head</head><body>$source</body></html>"
        val doc = StringBuilder(source.length + head.length + 64)
        val (htmlStart, htmlEnd) = html
        if (attr(lower.substring(htmlStart, htmlEnd), "lang") != null) {
            doc.append(source, 0, htmlEnd)
        } else {
            doc.append(source, 0, htmlEnd - 1).append(langAttrs).append('>')
        }
        val afterHead = firstTag(lower, "head", htmlEnd)?.second
        if (afterHead != null) {
            doc.append(source, htmlEnd, afterHead).append(head).append(source, afterHead, source.length)
        } else {
            doc.append("<head>").append(head).append("</head>").append(source, htmlEnd, source.length)
        }
        if (!lower.trimStart().startsWith("<!doctype")) doc.insert(0, "<!doctype html>")
        return doc.toString()
    }

    private fun asciiLower(text: String): String {
        val chars = text.toCharArray()
        for (i in chars.indices) if (chars[i] in 'A'..'Z') chars[i] = chars[i] + 32
        return String(chars)
    }

    /** The first opening tag `<name` at or after `from`, as start until just past its `>`. */
    private fun firstTag(lower: String, name: String, from: Int): Pair<Int, Int>? {
        val open = "<$name"
        var at = from
        while (true) {
            val start = lower.indexOf(open, at).takeIf { it >= 0 } ?: return null
            val after = start + open.length
            val next = lower.getOrNull(after)
            if (next != null && (next.isWhitespace() || next == '>' || next == '/')) {
                val end = lower.indexOf('>', after).let { if (it < 0) lower.length else it + 1 }
                return start to end
            }
            at = after
        }
    }

    /** The value of `name` in one opening tag, quoted or not. */
    private fun attr(tag: String, name: String): String? {
        var from = 0
        while (true) {
            val start = tag.indexOf(name, from).takeIf { it >= 0 } ?: return null
            val before = if (start == 0) ' ' else tag[start - 1]
            val rest = tag.substring(start + name.length).trimStart()
            if ((before.isWhitespace() || before == '<') && rest.startsWith("=")) {
                val value = rest.substring(1).trimStart()
                val quote = value.firstOrNull()
                return if (quote == '"' || quote == '\'') value.substring(1).substringBefore(quote)
                else value.takeWhile { !it.isWhitespace() && it != '>' }
            }
            from = start + name.length
        }
    }
}
