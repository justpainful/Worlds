package worlds.content

import org.json.JSONObject

data class PageMatch(val blockId: String, val blockIndex: Int, val path: List<Int>, val runIndex: Int, val start: Int, val end: Int, val context: String, val contextStart: Int, val contextEnd: Int)
data class PageFindResult(val matches: List<PageMatch>, val truncated: Boolean, val skippedBlocks: Int)

/** Literal non-overlapping matches within individual text runs, as in the desktop editor. */
object PageFind {
    const val MAX_MATCHES = 1000
    fun scan(blocks: List<ContentBlock>, query: String, matchCase: Boolean): PageFindResult {
        require(query.length <= 256)
        requireValidUnicode(query)
        if (query.isEmpty()) return PageFindResult(emptyList(), false, 0)
        val matches = mutableListOf<PageMatch>(); var skipped = 0
        for ((blockIndex, block) in blocks.withIndex()) {
            val root = runCatching { JSONObject(block.content) }.getOrNull()
            if (root == null) { skipped++; continue }
            var blockSkipped = false
            var truncated = false
            fun visit(node: JSONObject, path: List<Int>) {
                if (truncated) return
                if (path.size > 48) { blockSkipped = true; return }
                val type = node.optString("type")
                if (type !in setOf("paragraph", "heading", "codeBlock")) {
                    val allowed = childTypes(type)
                    val children = node.optJSONArray("content")
                    if (allowed == null || children == null) { blockSkipped = true; return }
                    for (i in 0 until children.length()) {
                        val child = children.optJSONObject(i)
                        if (child == null || child.optString("type") !in allowed) blockSkipped = true
                        else visit(child, path + i)
                        if (truncated) return
                    }
                    return
                }
                if (type == "codeBlock" && runCatching { CodeEditing.read(node.toString()) }.isFailure) { blockSkipped = true; return }
                if (node.has("content") && !node.isNull("content") && node.optJSONArray("content") == null) { blockSkipped = true; return }
                val content = node.optJSONArray("content") ?: return
                val text = StringBuilder()
                val runs = mutableListOf<Triple<Int, Int, String>>()
                for (i in 0 until content.length()) {
                    val inline = content.optJSONObject(i)
                    when {
                        inline?.optString("type") == "hardBreak" -> text.append('\n')
                        inline?.optString("type") == "text" && inline.opt("text") is String &&
                            inline.keys().asSequence().all { it in setOf("type", "text", "marks") } &&
                            (!inline.has("marks") || inline.optJSONArray("marks") != null) -> {
                            val run = inline.getString("text")
                            if (run.isEmpty() || runCatching { requireValidUnicode(run) }.isFailure) { blockSkipped = true; text.append('…') }
                            else { runs.add(Triple(i, text.length, run)); text.append(run) }
                        }
                        else -> { blockSkipped = true; text.append('…') }
                    }
                }
                for ((runIndex, offset, run) in runs) {
                var from = 0
                while (from <= run.length - query.length) {
                    val index = run.indexOf(query, from, ignoreCase = !matchCase)
                    if (index < 0) break
                    if (matches.size == MAX_MATCHES) { truncated = true; return }
                    val start = offset + index; val end = start + query.length
                    var before = (start - 32).coerceAtLeast(0); var after = (end + 32).coerceAtMost(text.length)
                    if (before > 0 && text[before].isLowSurrogate() && text[before - 1].isHighSurrogate()) before--
                    if (after < text.length && after > 0 && text[after - 1].isHighSurrogate() && text[after].isLowSurrogate()) after++
                    matches.add(PageMatch(block.id, blockIndex, path, runIndex, index, index + query.length, text.substring(before, after), start - before, end - before))
                    from = index + query.length
                }
                }
            }
            visit(root, emptyList())
            if (blockSkipped) skipped++
            if (truncated) return PageFindResult(matches, true, skipped)
        }
        return PageFindResult(matches, false, skipped)
    }

    fun replace(blocks: List<ContentBlock>, matches: List<PageMatch>, replacement: String): List<ContentBlock> {
        require(matches.isNotEmpty() && matches.size <= MAX_MATCHES && replacement.length <= 2000)
        requireValidUnicode(replacement)
        val byBlock = matches.groupBy { it.blockId }
        require(byBlock.keys.all { id -> blocks.any { it.id == id } })
        return blocks.map { block ->
            val selected = byBlock[block.id] ?: return@map block
            var root = JSONObject(block.content)
            for ((path, group) in selected.groupBy { it.path }) {
                var node = root
                for (child in path) node = node.getJSONArray("content").getJSONObject(child)
                val text = replaceRuns(node.toString(), group, replacement)
                if (path.isEmpty()) root = JSONObject(text) else {
                    var parent = root
                    for (child in path.dropLast(1)) parent = parent.getJSONArray("content").getJSONObject(child)
                    parent.getJSONArray("content").put(path.last(), JSONObject(text))
                }
            }
            val raw = root.toString()
            require(raw.toByteArray(Charsets.UTF_8).size <= 1_000_000)
            ContentBlock(block.id, raw)
        }
    }

    private fun replaceRuns(raw: String, matches: List<PageMatch>, replacement: String): String {
        val node = JSONObject(raw); val content = node.optJSONArray("content") ?: org.json.JSONArray()
        require(node.optString("type") in setOf("paragraph", "heading", "codeBlock"))
        val updated = org.json.JSONArray(); var replaced = 0
        for (i in 0 until content.length()) {
            val changes = matches.filter { it.runIndex == i }.sortedByDescending { it.start }
            if (changes.isEmpty()) { updated.put(content.get(i)); continue }
            val child = content.getJSONObject(i)
            require(child.optString("type") == "text" && child.opt("text") is String)
            require(child.keys().asSequence().all { it in setOf("type", "text", "marks") })
            val original = child.getString("text"); requireValidUnicode(original)
            replaced += changes.size
            val value = StringBuilder(original)
            var previousStart = original.length
            for (match in changes) {
                require(match.start >= 0 && match.start < match.end && match.end <= previousStart)
                require(!(match.start > 0 && original[match.start].isLowSurrogate() && original[match.start - 1].isHighSurrogate()))
                require(!(match.end < original.length && original[match.end].isLowSurrogate() && original[match.end - 1].isHighSurrogate()))
                value.replace(match.start, match.end, replacement); previousStart = match.start
            }
            if (value.isNotEmpty()) { child.put("text", value.toString()); updated.put(child) }
        }
        require(replaced == matches.size)
        if (updated.length() == 0) node.remove("content") else node.put("content", updated)
        return node.toString()
    }

    private val blocks = setOf("paragraph", "heading", "codeBlock", "blockquote", "callout", "prompt", "bulletList", "orderedList", "taskList", "table", "columns", "toggle", "tabs")
    private fun childTypes(type: String): Set<String>? = when (type) {
        "bulletList", "orderedList" -> setOf("listItem")
        "taskList" -> setOf("taskItem")
        "listItem", "taskItem", "blockquote", "column", "toggle", "tab", "tableCell", "tableHeader" -> blocks
        "callout", "prompt" -> setOf("paragraph")
        "table" -> setOf("tableRow")
        "tableRow" -> setOf("tableCell", "tableHeader")
        "columns" -> setOf("column")
        "tabs" -> setOf("tab")
        else -> null
    }

    private fun requireValidUnicode(text: String) {
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (c.isHighSurrogate()) { require(i + 1 < text.length && text[i + 1].isLowSurrogate()); i++ }
            else require(!c.isLowSurrogate())
            i++
        }
    }
}
