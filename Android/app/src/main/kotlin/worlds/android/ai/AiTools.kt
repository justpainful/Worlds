package worlds.android.ai

import org.json.JSONArray
import org.json.JSONObject
import worlds.android.planning.OWN_VIEW_KINDS
import worlds.content.ContentBlock
import worlds.content.ContentConflict
import worlds.content.ContentStore
import worlds.content.ContentVersion
import worlds.content.MarkdownExport
import worlds.content.MarkdownImport
import worlds.content.Resource
import worlds.content.ResourceDocument
import worlds.content.newBlockId
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The store calls the assistant's tools need. [ContentStoreWorkspace] passes
 * them to the device's ContentStore; JVM tests use an in memory version, so
 * the tool logic is tested without a device.
 */
interface AiWorkspace {
    fun list(): List<Resource>
    /** Templates and everything inside them; never shown to the assistant. */
    fun hiddenIds(): Set<String>
    fun load(id: String): ResourceDocument?
    fun search(query: String, limit: Int): List<Resource>
    fun createPage(title: String, parentId: String?): Resource
    fun saveBlocks(id: String, expectedRevision: Long, blocks: List<ContentBlock>): Resource
    fun rename(id: String, expectedRevision: Long, title: String): Resource
    fun createVersion(id: String, expectedRevision: Long, label: String): ContentVersion
    fun restoreVersion(id: String, versionId: String, expectedRevision: Long): Resource
    fun trash(id: String, expectedRevision: Long)
}

class ContentStoreWorkspace(private val store: ContentStore) : AiWorkspace {
    override fun list() = store.list()
    override fun hiddenIds() = store.templateTreeIds()
    override fun load(id: String) = store.load(id)
    override fun search(query: String, limit: Int) = store.search(query, limit)
    override fun createPage(title: String, parentId: String?) = store.create("page", title, parentId)
    override fun saveBlocks(id: String, expectedRevision: Long, blocks: List<ContentBlock>) = store.saveBlocks(id, expectedRevision, blocks)
    override fun rename(id: String, expectedRevision: Long, title: String) = store.rename(id, expectedRevision, title)
    override fun createVersion(id: String, expectedRevision: Long, label: String) = store.createVersion(id, expectedRevision, label)
    override fun restoreVersion(id: String, versionId: String, expectedRevision: Long) = store.restoreVersion(id, versionId, expectedRevision)
    override fun trash(id: String, expectedRevision: Long) { store.trash(id, expectedRevision) }
}

/**
 * A page the assistant changed in one reply. An existing page keeps the
 * version captured before its first change; a page the assistant created is
 * moved to Trash on undo.
 */
data class AiPageChange(val pageId: String, val title: String, val versionId: String?, val created: Boolean)

private class AiToolError(message: String) : Exception(message)

/** The tool set, with the desktop MCP tools' names, descriptions and argument schemas. */
object AiTools {
    private fun schema(props: JSONObject, vararg required: String): JSONObject =
        JSONObject().put("type", "object").put("properties", props).put("required", JSONArray(required.toList()))

    private fun str(description: String? = null) = JSONObject().put("type", "string").also { if (description != null) it.put("description", description) }
    private fun pageId() = str("Page id")
    private fun md() = str("Content in Worlds Markdown")

    val ALL: List<AiToolDef> = listOf(
        AiToolDef(
            "workspace_overview",
            "A snapshot of the whole workspace: counts, recently edited pages and the current local date and time. Call this first when you need orientation.",
            schema(JSONObject()),
        ),
        AiToolDef(
            "pages_list",
            "List pages as a tree (id, title, parent, flags). Use parentId to list one branch.",
            schema(JSONObject().put("parentId", str()).put("includeArchived", JSONObject().put("type", "boolean"))),
        ),
        AiToolDef(
            "pages_search",
            "Full-text search page titles and content (Arabic and English).",
            schema(JSONObject().put("query", str()).put("limit", JSONObject().put("type", "integer")), "query"),
        ),
        AiToolDef(
            "pages_read",
            "Read a page: metadata, assistant instructions, blocks (id, type, markdown), subpages and backlinks.",
            schema(JSONObject().put("pageId", pageId()), "pageId"),
        ),
        AiToolDef(
            "pages_create",
            "Create a page (optionally inside a parent) with initial Markdown content.",
            schema(JSONObject().put("title", str()).put("parentId", str()).put("icon", str("single emoji")).put("markdown", md()), "title"),
        ),
        AiToolDef(
            "pages_append_markdown",
            "Add content at the end of a page.",
            schema(JSONObject().put("pageId", pageId()).put("markdown", md()), "pageId", "markdown"),
        ),
        AiToolDef(
            "blocks_update",
            "Replace one block's content. If the Markdown yields several blocks, the first replaces the block and the rest are inserted after it.",
            schema(JSONObject().put("blockId", str()).put("markdown", md()), "blockId", "markdown"),
        ),
        AiToolDef(
            "pages_rename",
            "Rename a page.",
            schema(JSONObject().put("pageId", pageId()).put("title", str()), "pageId", "title"),
        ),
        AiToolDef(
            "tasks_add",
            "Add checklist items to a page (at the end, or after a block).",
            schema(
                JSONObject().put("pageId", str("Page id")).put("items", JSONObject().put("type", "array").put("items", str()))
                    .put("afterBlockId", str("Block id")),
                "pageId", "items",
            ),
        ),
        AiToolDef(
            "tasks_list",
            "Checklist items across the workspace or one page, with their page, block id, index and state. Use it for to-do overviews.",
            schema(
                JSONObject().put("pageId", str("Page id"))
                    .put("status", JSONObject().put("type", "string").put("enum", JSONArray(listOf("open", "done", "all"))))
                    .put("limit", JSONObject().put("type", "integer")),
            ),
        ),
    )

    val NAMES: Set<String> = ALL.map { it.name }.toSet()

    /** Kinds whose content is a list of ProseMirror blocks the assistant may edit. */
    val EDITABLE_KINDS = setOf("page", "document")
    /** Kinds a new page may be created inside. */
    val PARENT_KINDS = setOf("page", "document", "project")

    /** Longest tool output sent back to the model, in characters. */
    const val MAX_OUTPUT = 60_000
    const val VERSION_LABEL = "Before assistant changes"
}

/**
 * Runs the assistant's tools over an [AiWorkspace]. Every write checks the
 * page revision, so it cannot overwrite an edit made meanwhile. Before the
 * first change to an existing page a version is captured, and pages the
 * assistant creates are remembered, so [changes] can undo the whole reply.
 * Call from one thread at a time, off the main thread.
 */
class AiToolRunner(
    private val workspace: AiWorkspace,
    private val zone: ZoneId = ZoneId.systemDefault(),
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val changeLog = LinkedHashMap<String, AiPageChange>()
    private val blockPages = HashMap<String, String>()

    /** The pages changed so far, in the order they were first changed. */
    val changes: List<AiPageChange> get() = synchronized(changeLog) { changeLog.values.toList() }

    fun call(name: String, args: JSONObject): AiToolResult = try {
        val value = when (name) {
            "workspace_overview" -> overview()
            "pages_list" -> pagesList(args)
            "pages_search" -> pagesSearch(args)
            "pages_read" -> pagesRead(args)
            "pages_create" -> pagesCreate(args)
            "pages_append_markdown" -> appendMarkdown(args)
            "blocks_update" -> blocksUpdate(args)
            "pages_rename" -> pagesRename(args)
            "tasks_add" -> tasksAdd(args)
            "tasks_list" -> tasksList(args)
            else -> throw AiToolError("there is no tool named $name")
        }
        AiToolResult(compact(value.toString()), false)
    } catch (_: ContentConflict) {
        AiToolResult("Error: the page changed while you were working on it. Read it again, then retry.", true)
    } catch (_: MarkdownImport.TooComplex) {
        AiToolResult("Error: the Markdown is too large or too complex.", true)
    } catch (e: AiToolError) {
        AiToolResult("Error: ${e.message}", true)
    } catch (e: IllegalArgumentException) {
        AiToolResult("Error: ${e.message ?: "invalid argument"}", true)
    } catch (e: IllegalStateException) {
        AiToolResult("Error: ${e.message ?: "the change was refused"}", true)
    } catch (e: org.json.JSONException) {
        AiToolResult("Error: ${e.message ?: "unreadable content"}", true)
    }

    // ---- arguments

    private fun s(a: JSONObject, key: String): String {
        val value = if (a.isNull(key)) "" else a.opt(key) as? String ?: ""
        if (value.isBlank()) throw AiToolError("missing argument `$key`")
        return value
    }

    private fun os(a: JSONObject, key: String): String? = (if (a.isNull(key)) null else a.opt(key) as? String)?.takeIf { it.isNotBlank() }

    private fun int(a: JSONObject, key: String, default: Int, range: IntRange): Int {
        val value = a.opt(key)
        val n = when (value) {
            is Number -> value.toInt()
            is String -> value.trim().toIntOrNull() ?: default
            else -> default
        }
        return n.coerceIn(range)
    }

    // ---- pages

    private fun visible(): List<Resource> {
        val hidden = workspace.hiddenIds()
        return workspace.list().filter { it.deletedAt == null && it.id !in hidden && it.kind != "template" && it.kind !in OWN_VIEW_KINDS }
    }

    private fun page(id: String): ResourceDocument {
        val doc = workspace.load(id)
        if (doc == null || doc.resource.kind == "template" || id in workspace.hiddenIds()) throw AiToolError("page not found")
        if (doc.resource.deletedAt != null) throw AiToolError("that page is in Trash")
        return doc
    }

    private fun editable(id: String): ResourceDocument {
        val doc = page(id)
        if (doc.resource.kind !in AiTools.EDITABLE_KINDS) throw AiToolError("this ${doc.resource.kind} cannot be edited by the assistant on Android; only pages and documents can")
        return doc
    }

    private fun time(ms: Long): String = DateTimeFormatter.ISO_LOCAL_DATE_TIME.format(Instant.ofEpochMilli(ms).atZone(zone).withNano(0))

    private fun brief(r: Resource) = JSONObject().put("id", r.id).put("title", r.title).put("kind", r.kind).put("updatedAt", time(r.updatedAt))

    private fun overview(): JSONObject {
        val pages = visible()
        val now = ZonedDateTime.ofInstant(Instant.ofEpochMilli(clock()), zone).withNano(0)
        val byKind = JSONObject()
        pages.groupingBy { it.kind }.eachCount().toSortedMap().forEach { (kind, count) -> byKind.put(kind, count) }
        val recent = JSONArray()
        pages.sortedByDescending { it.updatedAt }.take(12).forEach { recent.put(brief(it)) }
        return JSONObject()
            .put("now", JSONObject().put("local", DateTimeFormatter.ISO_LOCAL_DATE_TIME.format(now)).put("weekday", now.dayOfWeek.getDisplayName(java.time.format.TextStyle.FULL, Locale.ENGLISH)).put("timeZone", zone.id))
            .put("counts", JSONObject().put("pages", pages.size).put("byKind", byKind))
            .put("recent", recent)
            .put("device", "Android")
    }

    private fun pagesList(a: JSONObject): JSONArray {
        val all = visible()
        val ids = all.map { it.id }.toSet()
        val root = os(a, "parentId")
        if (root != null && root !in ids) throw AiToolError("page not found")
        val children = all.groupBy { it.parentId?.takeIf { p -> p in ids } }
        val out = JSONArray()
        fun walk(parent: String?, depth: Int) {
            for (p in children[parent].orEmpty()) {
                if (out.length() >= 500) return
                out.put(JSONObject().put("id", p.id).put("title", p.title).put("kind", p.kind).put("parentId", p.parentId ?: JSONObject.NULL).put("depth", depth).put("updatedAt", time(p.updatedAt)))
                if (depth < 12) walk(p.id, depth + 1)
            }
        }
        walk(root, 0)
        return out
    }

    private fun pagesSearch(a: JSONObject): JSONArray {
        val query = s(a, "query").trim()
        val limit = int(a, "limit", 15, 1..50)
        val hidden = workspace.hiddenIds()
        val all = workspace.list().associateBy { it.id }
        val out = JSONArray()
        for (hit in workspace.search(query, limit)) {
            if (hit.id in hidden || hit.kind in OWN_VIEW_KINDS) continue
            val doc = workspace.load(hit.id)
            val snippet = doc?.let { snippet(it, query) }.orEmpty()
            out.put(JSONObject().put("pageId", hit.id).put("title", hit.title).put("kind", hit.kind).put("parent", hit.parentId?.let { all[it]?.title } ?: JSONObject.NULL).put("snippet", snippet))
        }
        return out
    }

    private fun snippet(doc: ResourceDocument, query: String): String {
        val needle = query.lowercase()
        for (block in doc.blocks) {
            val text = runCatching { MarkdownExport.block(JSONObject(block.content)) }.getOrDefault("").replace('\n', ' ')
            val at = text.lowercase().indexOf(needle)
            if (at < 0) continue
            val start = (at - 60).coerceAtLeast(0)
            val end = (at + needle.length + 60).coerceAtMost(text.length)
            return text.substring(start, at) + "«" + text.substring(at, at + needle.length) + "»" + text.substring(at + needle.length, end)
        }
        return ""
    }

    private fun pagesRead(a: JSONObject): JSONObject {
        val doc = page(s(a, "pageId"))
        val r = doc.resource
        val all = visible()
        val byId = all.associateBy { it.id }
        val path = JSONArray()
        var parent = r.parentId
        var guard = 0
        val crumbs = ArrayList<String>()
        while (parent != null && guard++ < 32) {
            val p = byId[parent] ?: break
            crumbs.add(p.title)
            parent = p.parentId
        }
        crumbs.reversed().forEach { path.put(it) }
        val blocks = JSONArray()
        var size = 0
        var truncated = false
        if (r.kind in AiTools.EDITABLE_KINDS) {
            for (block in doc.blocks) {
                val node = runCatching { JSONObject(block.content) }.getOrNull() ?: continue
                val markdown = MarkdownExport.block(node)
                size += markdown.length
                if (size > AiTools.MAX_OUTPUT - 4_000) { truncated = true; break }
                blockPages[block.id] = r.id
                blocks.put(JSONObject().put("id", block.id).put("type", node.optString("type", "paragraph")).put("markdown", markdown))
            }
        }
        val subpages = JSONArray()
        all.filter { it.parentId == r.id }.forEach { subpages.put(JSONObject().put("id", it.id).put("title", it.title).put("kind", it.kind)) }
        val out = JSONObject()
            .put("id", r.id).put("title", r.title).put("kind", r.kind)
            .put("editable", r.kind in AiTools.EDITABLE_KINDS)
            .put("path", path)
            .put("assistantInstructions", runCatching { JSONArray(r.instructions) }.getOrDefault(JSONArray()))
            .put("blocks", blocks)
            .put("subpages", subpages)
            .put("updatedAt", time(r.updatedAt))
        if (truncated) out.put("truncated", true)
        if (r.kind !in AiTools.EDITABLE_KINDS) out.put("note", "This ${r.kind} has no block content the assistant can read on Android.")
        return out
    }

    // ---- writes

    /** Captures a version before the first change to an existing page in this reply. */
    private fun beforeChange(r: Resource) {
        synchronized(changeLog) {
            if (changeLog.containsKey(r.id)) return
            val version = workspace.createVersion(r.id, r.revision, AiTools.VERSION_LABEL)
            changeLog[r.id] = AiPageChange(r.id, r.title, version.id, false)
        }
    }

    private fun afterChange(r: Resource) {
        synchronized(changeLog) { changeLog[r.id]?.let { changeLog[r.id] = it.copy(title = r.title) } }
    }

    /** Parsed Markdown as blocks with fresh ids. */
    private fun blocksFrom(markdown: String): List<ContentBlock> {
        val nodes = MarkdownImport.parse(markdown)
        if (nodes.isEmpty()) throw AiToolError("the Markdown produced no blocks")
        return nodes.map { json ->
            val id = newBlockId()
            val node = JSONObject(json)
            val attrs = node.optJSONObject("attrs") ?: JSONObject().also { node.put("attrs", it) }
            attrs.put("bid", id)
            ContentBlock(id, node.toString())
        }
    }

    private fun save(doc: ResourceDocument, blocks: List<ContentBlock>): Resource {
        beforeChange(doc.resource)
        val saved = workspace.saveBlocks(doc.resource.id, doc.resource.revision, blocks)
        afterChange(saved)
        blocks.forEach { blockPages[it.id] = saved.id }
        return saved
    }

    private fun ids(blocks: List<ContentBlock>) = JSONArray(blocks.map { it.id })

    private fun pagesCreate(a: JSONObject): JSONObject {
        val title = s(a, "title").trim().take(500)
        val parentId = os(a, "parentId")
        if (parentId != null) {
            val parent = page(parentId).resource
            if (parent.kind !in AiTools.PARENT_KINDS) throw AiToolError("a page cannot be created inside a ${parent.kind}")
        }
        val markdown = os(a, "markdown")
        val blocks = markdown?.let { blocksFrom(it) }
        val created = workspace.createPage(title, parentId)
        synchronized(changeLog) { changeLog[created.id] = AiPageChange(created.id, created.title, null, true) }
        if (blocks != null) {
            workspace.saveBlocks(created.id, created.revision, blocks)
            blocks.forEach { blockPages[it.id] = created.id }
        }
        return JSONObject().put("pageId", created.id).put("title", created.title)
    }

    private fun appendMarkdown(a: JSONObject): JSONObject {
        val doc = editable(s(a, "pageId"))
        val added = blocksFrom(s(a, "markdown"))
        save(doc, doc.blocks + added)
        return JSONObject().put("inserted", ids(added))
    }

    private fun findBlock(blockId: String): ResourceDocument {
        blockPages[blockId]?.let { id ->
            val doc = runCatching { page(id) }.getOrNull()
            if (doc != null && doc.blocks.any { it.id == blockId }) return doc
        }
        for (r in visible()) {
            if (r.kind !in AiTools.EDITABLE_KINDS) continue
            val doc = workspace.load(r.id) ?: continue
            if (doc.blocks.any { it.id == blockId }) return doc
        }
        throw AiToolError("block not found")
    }

    private fun blocksUpdate(a: JSONObject): JSONObject {
        val blockId = s(a, "blockId")
        val doc = findBlock(blockId)
        if (doc.resource.kind !in AiTools.EDITABLE_KINDS) throw AiToolError("this ${doc.resource.kind} cannot be edited by the assistant on Android")
        val fresh = blocksFrom(s(a, "markdown")).toMutableList()
        val index = doc.blocks.indexOfFirst { it.id == blockId }
        val existing = JSONObject(doc.blocks[index].content)
        val first = JSONObject(fresh.removeAt(0).content)
        val attrs = first.optJSONObject("attrs") ?: JSONObject().also { first.put("attrs", it) }
        attrs.put("bid", blockId)
        // Keep an explicit direction the person set.
        val dir = existing.optJSONObject("attrs")?.optString("dir").orEmpty()
        if (dir == "ltr" || dir == "rtl") attrs.put("dir", dir)
        val blocks = doc.blocks.toMutableList()
        blocks[index] = ContentBlock(blockId, first.toString())
        blocks.addAll(index + 1, fresh)
        save(doc, blocks)
        return JSONObject().put("updated", blockId).put("inserted", ids(fresh))
    }

    private fun pagesRename(a: JSONObject): JSONObject {
        val doc = page(s(a, "pageId"))
        val title = s(a, "title").trim().take(500)
        if (doc.resource.title == title) return JSONObject().put("pageId", doc.resource.id).put("title", title)
        beforeChange(doc.resource)
        val renamed = workspace.rename(doc.resource.id, doc.resource.revision, title)
        afterChange(renamed)
        return JSONObject().put("pageId", renamed.id).put("title", renamed.title)
    }

    private fun tasksAdd(a: JSONObject): JSONObject {
        val doc = editable(s(a, "pageId"))
        val raw = a.optJSONArray("items") ?: throw AiToolError("items is empty")
        val items = (0 until raw.length()).mapNotNull { i -> (raw.opt(i) as? String)?.replace(Regex("\\s*\\n\\s*"), " ")?.trim()?.takeIf { it.isNotEmpty() } }
        if (items.isEmpty()) throw AiToolError("items is empty")
        val added = blocksFrom(items.joinToString("\n") { "- [ ] $it" })
        val after = os(a, "afterBlockId")
        val blocks = doc.blocks.toMutableList()
        val at = if (after == null) blocks.size else {
            val index = blocks.indexOfFirst { it.id == after }
            if (index < 0) throw AiToolError("block not found on this page")
            index + 1
        }
        blocks.addAll(at, added)
        save(doc, blocks)
        return JSONObject().put("inserted", ids(added))
    }

    private fun tasksList(a: JSONObject): JSONObject {
        val status = os(a, "status") ?: "open"
        val limit = int(a, "limit", 200, 1..500)
        val pages = os(a, "pageId")?.let { listOf(page(it).resource) } ?: visible().filter { it.kind in AiTools.EDITABLE_KINDS }
        var open = 0
        var done = 0
        val items = JSONArray()
        for (p in pages) {
            val doc = workspace.load(p.id) ?: continue
            for (block in doc.blocks) {
                val node = runCatching { JSONObject(block.content) }.getOrNull() ?: continue
                var index = 0
                forTasks(node) { item ->
                    val checked = item.optJSONObject("attrs")?.optBoolean("checked", false) ?: false
                    if (checked) done++ else open++
                    val keep = when (status) { "done" -> checked; "all" -> true; else -> !checked }
                    if (keep && items.length() < limit) {
                        blockPages[block.id] = p.id
                        items.put(JSONObject().put("pageId", p.id).put("page", p.title).put("blockId", block.id).put("index", index).put("text", AiText.plain(item)).put("checked", checked))
                    }
                    index++
                }
            }
        }
        return JSONObject().put("open", open).put("done", done).put("items", items)
    }

    private fun forTasks(node: JSONObject, visit: (JSONObject) -> Unit) {
        if (node.optString("type") == "taskItem") visit(node)
        val children = node.optJSONArray("content") ?: return
        for (i in 0 until children.length()) children.optJSONObject(i)?.let { forTasks(it, visit) }
    }

    private fun compact(text: String): String =
        if (text.length <= AiTools.MAX_OUTPUT) text else text.take(AiTools.MAX_OUTPUT) + "\n[truncated: ask for less, for example one page or a smaller limit]"
}

internal object AiText {
    /** The text of a node, with spaces between its paragraphs. */
    fun plain(node: JSONObject): String {
        val out = StringBuilder()
        fun walk(n: JSONObject) {
            if (n.optString("type") == "text") out.append(n.optString("text"))
            if (n.optString("type") == "hardBreak") out.append(' ')
            val children = n.optJSONArray("content") ?: return
            for (i in 0 until children.length()) {
                val child = children.optJSONObject(i) ?: continue
                if (out.isNotEmpty() && child.optString("type") != "text" && child.optString("type") != "hardBreak" && !out.endsWith(" ")) out.append(' ')
                walk(child)
            }
        }
        walk(node)
        return out.toString().trim()
    }
}

/** Undoes every change one reply made, newest first. */
object AiUndo {
    /** Titles of the pages that were put back and of those that could not be. */
    data class Result(val undone: List<String>, val failed: List<String>)

    fun undo(workspace: AiWorkspace, changes: List<AiPageChange>): Result {
        val undone = ArrayList<String>()
        val failed = ArrayList<String>()
        for (change in changes.reversed()) {
            val ok = runCatching {
                val doc = workspace.load(change.pageId)
                if (change.created) {
                    // Already gone or already in Trash counts as undone.
                    if (doc != null && doc.resource.deletedAt == null) workspace.trash(change.pageId, doc.resource.revision)
                } else {
                    requireNotNull(doc) { "page not found" }
                    check(doc.resource.deletedAt == null) { "page is in Trash" }
                    // Restoring captures the current content as a version first, so a later edit is never lost.
                    workspace.restoreVersion(change.pageId, requireNotNull(change.versionId), doc.resource.revision)
                }
            }.isSuccess
            if (ok) undone.add(change.title) else failed.add(change.title)
        }
        return Result(undone, failed)
    }
}
