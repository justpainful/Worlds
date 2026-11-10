package worlds.content

import org.json.JSONObject

/** Text projection matching the desktop content::to_markdown implementation. */
object MarkdownExport {
    fun page(document: ResourceDocument): String {
        val body = document.blocks.map { block(JSONObject(it.content)) }.filter { it.isNotBlank() }.joinToString("\n\n")
        return "# ${document.resource.title}\n\n$body\n"
    }

    fun block(node: JSONObject): String {
        val children = children(node)
        return when (type(node)) {
            "paragraph" -> inline(children)
            "heading" -> "#".repeat((attrs(node)?.optInt("level", 1) ?: 1).coerceIn(1, 3)) + " " + inline(children)
            "bulletList" -> children.joinToString("\n") { "- ${item(it)}" }
            "orderedList" -> children.mapIndexed { i, n -> "${i + 1}. ${item(n)}" }.joinToString("\n")
            "taskList" -> children.joinToString("\n") { "- [${if (attrs(it)?.opt("checked") == true) "x" else " "}] ${item(it)}" }
            "blockquote" -> children.joinToString("\n") { "> ${block(it)}" }
            "callout" -> "> [!${attr(node, "tone") ?: "note"}] " + children.joinToString("\n> ") { block(it) }
            "prompt" -> "> [!prompt] " + children.joinToString("\n> ") { block(it) }
            "codeBlock" -> "```" + (attr(node, "language") ?: "") + "\n" + plainText(node) + "\n```"
            "horizontalRule" -> "---"
            "table" -> buildList {
                children.forEachIndexed { index, row ->
                    val cells = children(row).map { plainText(it).replace("|", "\\|") }
                    add("| ${cells.joinToString(" | ")} |")
                    if (index == 0) add("|${cells.joinToString("|") { "---" }}|")
                }
            }.joinToString("\n")
            "image", "video" -> "[${type(node)}: ${attr(node, "caption") ?: attr(node, "name") ?: ""}]"
            "file" -> "[file: ${attr(node, "name") ?: ""}]"
            "pageLink" -> "[subpage: @[${attr(node, "title") ?: ""}](page:${attr(node, "pageId") ?: ""})]"
            "embed" -> "[embed: ${attr(node, "url") ?: ""}]"
            "discordMessage" -> "[discord message: ${attr(node, "content") ?: ""}]"
            "schedule" -> "[schedule: ${attr(node, "automationId") ?: ""}]"
            "columns", "column", "tabs" -> children.map(::block).filter { it.isNotEmpty() }.joinToString("\n\n")
            "toggle" -> {
                val head = children.firstOrNull()?.let(::block) ?: ""
                val body = children.drop(1).map(::block)
                if (body.isEmpty()) "> [!toggle] $head" else "> [!toggle] $head\n> ${body.joinToString("\n> ")}"
            }
            "toc" -> "[table of contents]"
            "mathBlock" -> "$$\n${attr(node, "latex") ?: ""}\n$$"
            "mermaid" -> "```mermaid\n${attr(node, "code") ?: ""}\n```"
            "chart" -> "[chart: ${attr(node, "title")?.takeIf { it.isNotEmpty() } ?: "from a table"}]"
            "tab" -> "### ${attr(node, "title") ?: "Tab"}\n\n" + children.map(::block).filter { it.isNotEmpty() }.joinToString("\n\n")
            "gallery" -> "[gallery: ${attrs(node)?.optJSONArray("images")?.length() ?: 0} pictures]"
            "collection" -> "[collection: ${attr(node, "title")?.takeIf { it.isNotEmpty() } ?: "pages"} (${attr(node, "source") ?: "children"}, ${attr(node, "view") ?: "table"} view)]"
            else -> plainText(node)
        }
    }

    private fun item(node: JSONObject): String = children(node).joinToString("\n") { child ->
        if (type(child) == "paragraph") inline(children(child))
        else rustLines(block(child)).joinToString("\n") { "  $it" }
    }

    private fun inline(nodes: List<JSONObject>): String = buildString {
        nodes.forEach { node ->
            when (type(node)) {
                "text" -> {
                    var text = string(node, "text") ?: ""
                    val marks = node.optJSONArray("marks")
                    if (marks != null) for (index in marks.length() - 1 downTo 0) {
                        val mark = marks.optJSONObject(index) ?: continue
                        text = when (type(mark)) {
                            "bold" -> "**$text**"
                            "italic" -> "*$text*"
                            "strike" -> "~~$text~~"
                            "code" -> "`$text`"
                            "highlight" -> "==$text=="
                            "link" -> "[$text](${attr(mark, "href") ?: ""})"
                            else -> text
                        }
                    }
                    append(text)
                }
                "hardBreak" -> append('\n')
                "pageMention" -> append("@[${attr(node, "label") ?: ""}](page:${attr(node, "id") ?: ""})")
                "mathInline" -> append("$" + (attr(node, "latex") ?: "") + "$")
                else -> append(inline(children(node)))
            }
        }
    }

    private fun rustLines(value: String): List<String> {
        if (value.isEmpty()) return emptyList()
        val parts = value.split('\n').toMutableList()
        if (value.endsWith('\n')) parts.removeAt(parts.lastIndex)
        return parts.mapIndexed { i, line -> if (i < parts.lastIndex || value.endsWith('\n')) line.removeSuffix("\r") else line }
    }
    private fun type(node: JSONObject) = string(node, "type") ?: "paragraph"
    private fun attrs(node: JSONObject) = node.optJSONObject("attrs")
    private fun attr(node: JSONObject, key: String) = attrs(node)?.let { string(it, key) }
    private fun string(node: JSONObject, key: String) = (node.opt(key) as? String)
    private fun children(node: JSONObject): List<JSONObject> {
        val array = node.optJSONArray("content") ?: return emptyList()
        return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
    }
}
