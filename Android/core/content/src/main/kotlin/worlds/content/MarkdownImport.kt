package worlds.content

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/** Port of the constrained Markdown dialect in desktop content::from_markdown. */
object MarkdownImport {
    const val MAX_BYTES = 8 * 1024 * 1024
    private const val MAX_NODES = 100_000
    private const val MAX_WORK = 50_000_000L
    class TooComplex : IllegalArgumentException("Markdown exceeds import limits")

    fun parse(source: String): List<String> {
        if (source.toByteArray(Charsets.UTF_8).size > MAX_BYTES) throw TooComplex()
        return Parser().parse(source).map { node ->
            node.toString().also { if (it.toByteArray(Charsets.UTF_8).size > 1_000_000) throw TooComplex() }
        }
    }

    private class Parser {
        private var nodes = 0
        private var work = 0L
        private fun count(value: JSONObject): JSONObject { if (++nodes > MAX_NODES) throw TooComplex(); return value }
        private fun charge(value: Int) { work += value.toLong(); if (work > MAX_WORK) throw TooComplex() }
        private fun text(value: String, marks: JSONArray? = null): JSONObject = count(JSONObject().put("type", "text").put("text", value).also { if (marks != null && marks.length() > 0) it.put("marks", marks) })
        private fun paragraph(inline: List<JSONObject>): JSONObject = count(JSONObject().put("type", "paragraph").also { if (inline.isNotEmpty()) it.put("content", JSONArray(inline)) })
        private fun mark(type: String) = JSONObject().put("type", type)

        private fun inline(source: String, depth: Int = 0): List<JSONObject> {
            if (depth > 32) throw TooComplex()
            val result = mutableListOf<JSONObject>(); val buffer = StringBuilder()
            fun flush() { if (buffer.isNotEmpty()) { result.add(text(buffer.toString())); buffer.setLength(0) } }
            fun find(pattern: String, from: Int): Int {
                val found = source.indexOf(pattern, from)
                charge(if (found < 0) source.length - from else found - from + pattern.length)
                return found
            }
            var i = 0
            while (i < source.length) {
                charge(1)
                if (source.startsWith("@[", i)) {
                    val close = find("](page:", i + 2)
                    if (close >= 0) {
                        val end = find(")", close + 7)
                        if (end >= 0) {
                            flush(); result.add(count(JSONObject().put("type", "pageMention").put("attrs", JSONObject().put("id", source.substring(close + 7, end)).put("label", source.substring(i + 2, close)))))
                            i = end + 1; continue
                        }
                    }
                }
                if (source.startsWith("[", i)) {
                    val close = find("](", i + 1)
                    if (close >= 0) {
                        val end = find(")", close + 2)
                        if (end >= 0) {
                            val label = source.substring(i + 1, close); val href = source.substring(close + 2, end)
                            if (label.isNotEmpty() && !href.contains(' ')) {
                                flush(); result.add(text(label, JSONArray().put(JSONObject().put("type", "link").put("attrs", JSONObject().put("href", href)))))
                                i = end + 1; continue
                            }
                        }
                    }
                }
                var matched = false
                for ((delimiter, kind) in listOf("**" to "bold", "~~" to "strike", "==" to "highlight", "`" to "code", "*" to "italic")) {
                    if (!source.startsWith(delimiter, i)) continue
                    val from = i + delimiter.length; val end = find(delimiter, from)
                    if (end <= from) continue
                    flush(); val inner = source.substring(from, end)
                    if (kind == "code") result.add(text(inner, JSONArray().put(mark(kind))))
                    else for (child in inline(inner, depth + 1)) {
                        if (child.optString("type") == "text") {
                            val marks = child.optJSONArray("marks") ?: JSONArray().also { child.put("marks", it) }
                            marks.put(mark(kind))
                        }
                        result.add(child)
                    }
                    i = end + delimiter.length; matched = true; break
                }
                if (matched) continue
                val point = source.codePointAt(i); buffer.appendCodePoint(point); i += Character.charCount(point)
            }
            flush(); return result
        }

        fun parse(source: String): List<JSONObject> {
            val lines = rustLines(source); val blocks = mutableListOf<JSONObject>(); val pending = mutableListOf<String>(); var i = 0
            fun flush() {
                if (pending.isEmpty()) return
                val values = mutableListOf<JSONObject>()
                pending.forEachIndexed { index, line -> if (index > 0) values.add(count(JSONObject().put("type", "hardBreak"))); values.addAll(inline(line)) }
                blocks.add(paragraph(values)); pending.clear()
            }
            while (i < lines.size) {
                charge(1)
                val t = lines[i].trimEnd().trimStart()
                if (t.isEmpty()) { flush(); i++; continue }
                if (t.startsWith("```")) {
                    flush(); val language = t.substring(3).trim(); val code = mutableListOf<String>(); i++
                    while (i < lines.size && !lines[i].trimStart().startsWith("```")) { code.add(lines[i]); i++ }
                    i++
                    val node = count(JSONObject().put("type", "codeBlock").put("attrs", JSONObject().put("language", language)))
                    val value = code.joinToString("\n"); if (value.isNotEmpty()) node.put("content", JSONArray().put(text(value)))
                    blocks.add(node); continue
                }
                if (t == "---" || t == "***") { flush(); blocks.add(count(JSONObject().put("type", "horizontalRule"))); i++; continue }
                val heading = listOf("### " to 3, "## " to 2, "# " to 1).firstOrNull { t.startsWith(it.first) }
                if (heading != null) {
                    flush(); val node = count(JSONObject().put("type", "heading").put("attrs", JSONObject().put("level", heading.second)))
                    val value = inline(t.substring(heading.first.length)); if (value.isNotEmpty()) node.put("content", JSONArray(value))
                    blocks.add(node); i++; continue
                }
                if (t.startsWith('>')) {
                    flush(); val body = mutableListOf<String>()
                    while (i < lines.size && lines[i].trimStart().startsWith('>')) {
                        val stripped = lines[i].trimStart().trimStart('>')
                        body.add(if (stripped.startsWith(' ')) stripped.substring(1) else stripped); i++
                    }
                    val first = body.firstOrNull().orEmpty(); val end = if (first.startsWith("[!")) first.indexOf(']', 2) else -1
                    if (end >= 0) {
                        val tag = first.substring(2, end).lowercase(Locale.ROOT); val after = first.substring(end + 1).trim()
                        val rest = buildList { if (after.isNotEmpty()) add(after); addAll(body.drop(1)) }
                        val paras = if (rest.isEmpty()) listOf(paragraph(emptyList())) else rest.map { paragraph(inline(it)) }
                        val type = if (tag == "prompt") "prompt" else "callout"
                        val attrs = if (tag == "prompt") JSONObject().put("label", "Prompt") else JSONObject().put("tone", tag)
                        blocks.add(count(JSONObject().put("type", type).put("attrs", attrs).put("content", JSONArray(paras))))
                    } else blocks.add(count(JSONObject().put("type", "blockquote").put("content", JSONArray(body.map { paragraph(inline(it)) }))))
                    continue
                }
                if (t.startsWith('|')) {
                    flush(); val rows = mutableListOf<List<String>>()
                    while (i < lines.size && lines[i].trimStart().startsWith('|')) {
                        val cells = lines[i].trim().trim('|').split('|').map { it.trim() }
                        if (!cells.all { it.isNotEmpty() && it.all { char -> char == '-' || char == ':' } }) rows.add(cells)
                        i++
                    }
                    val tableRows = rows.mapIndexed { rowIndex, cells ->
                        val cellType = if (rowIndex == 0) "tableHeader" else "tableCell"
                        count(JSONObject().put("type", "tableRow").put("content", JSONArray(cells.map { cell -> count(JSONObject().put("type", cellType).put("content", JSONArray().put(paragraph(inline(cell))))) })))
                    }
                    blocks.add(count(JSONObject().put("type", "table").put("content", JSONArray(tableRows)))); continue
                }
                val kind = listKind(t)
                if (kind != null) {
                    flush(); val items = mutableListOf<JSONObject>()
                    while (i < lines.size) {
                        val line = lines[i].trimStart(); if (listKind(line) != kind) break
                        val checked = kind == "taskList" && line.getOrNull(3)?.equals('x', ignoreCase = true) == true
                        val begin = when (kind) { "taskList" -> 6; "bulletList" -> 2; else -> line.takeWhile { it in '0'..'9' }.length + 2 }
                        val content = if (begin <= line.length) line.substring(begin) else ""
                        val item = count(JSONObject().put("type", if (kind == "taskList") "taskItem" else "listItem").put("content", JSONArray().put(paragraph(inline(content)))))
                        if (kind == "taskList") item.put("attrs", JSONObject().put("checked", checked))
                        items.add(item); i++
                    }
                    blocks.add(count(JSONObject().put("type", kind).put("content", JSONArray(items)))); continue
                }
                pending.add(t); i++
            }
            flush(); return blocks
        }
    }

    private fun listKind(value: String): String? {
        if (listOf("- [ ]", "- [x]", "- [X]").any { value == it || value.startsWith("$it ") }) return "taskList"
        if (value == "-" || value == "*" || value.startsWith("- ") || value.startsWith("* ")) return "bulletList"
        val digits = value.takeWhile { it in '0'..'9' }.length
        if (digits > 0 && (value.substring(digits) == "." || value.substring(digits).startsWith(". "))) return "orderedList"
        return null
    }
    private fun rustLines(value: String): List<String> {
        if (value.isEmpty()) return emptyList()
        val parts = mutableListOf<String>(); var offset = 0
        while (offset < value.length) {
            if (parts.size >= MAX_NODES) throw TooComplex()
            val end = value.indexOf('\n', offset)
            if (end < 0) { parts.add(value.substring(offset)); break }
            parts.add(value.substring(offset, end).removeSuffix("\r")); offset = end + 1
        }
        return parts
    }
}
