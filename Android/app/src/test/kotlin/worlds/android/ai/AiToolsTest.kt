package worlds.android.ai

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import worlds.content.ContentBlock
import worlds.content.ContentConflict
import worlds.content.ContentVersion
import worlds.content.MarkdownExport
import worlds.content.MarkdownImport
import worlds.content.Resource
import worlds.content.ResourceDocument
import java.time.ZoneOffset

/**
 * ContentStore's rules for the calls the tools use, in memory: revisions must
 * match, trashed pages refuse edits, versions snapshot title and blocks, and
 * restoring a version first keeps the current content as a version.
 */
internal open class MemoryWorkspace : AiWorkspace {
    private class Page(var resource: Resource, var blocks: List<ContentBlock>)
    private class Snapshot(val pageId: String, val title: String, val blocks: List<ContentBlock>)

    private val pages = LinkedHashMap<String, Page>()
    private val snapshots = LinkedHashMap<String, Snapshot>()
    var hidden: Set<String> = emptySet()
    private var now = 1_700_000_000_000L
    private var next = 0

    fun add(title: String, kind: String = "page", parentId: String? = null, markdown: String = ""): Resource {
        val id = "page${++next}"
        val resource = Resource(id, title, kind, parentId, next.toDouble(), "{}", "[]", 0, null, now, ++now)
        pages[id] = Page(resource, if (markdown.isBlank()) emptyList() else MarkdownImport.parse(markdown).map { json ->
            val bid = "block${++next}"
            val node = JSONObject(json)
            (node.optJSONObject("attrs") ?: JSONObject().also { node.put("attrs", it) }).put("bid", bid)
            ContentBlock(bid, node.toString())
        })
        return resource
    }

    fun markdown(id: String): String = pages.getValue(id).blocks.joinToString("\n\n") { MarkdownExport.block(JSONObject(it.content)) }
    fun resource(id: String): Resource = pages.getValue(id).resource
    fun versionCount(id: String) = snapshots.values.count { it.pageId == id }

    private fun writable(id: String, expectedRevision: Long): Page {
        val page = requireNotNull(pages[id]) { "Resource not found" }
        check(page.resource.deletedAt == null) { "Resource is in trash" }
        if (page.resource.revision != expectedRevision) throw ContentConflict()
        return page
    }

    private fun bump(page: Page) { page.resource = page.resource.copy(revision = page.resource.revision + 1, updatedAt = ++now) }

    override fun list() = pages.values.map { it.resource }
    override fun hiddenIds() = hidden
    override fun load(id: String) = pages[id]?.let { ResourceDocument(it.resource, it.blocks) }
    override fun search(query: String, limit: Int) = pages.values
        .filter { it.resource.deletedAt == null && it.resource.kind != "template" }
        .filter { p -> p.resource.title.contains(query, true) || p.blocks.any { MarkdownExport.block(JSONObject(it.content)).contains(query, true) } }
        .map { it.resource }.take(limit)

    override fun createPage(title: String, parentId: String?): Resource {
        if (parentId != null) check(pages.getValue(parentId).resource.deletedAt == null)
        return add(title, "page", parentId)
    }

    override fun saveBlocks(id: String, expectedRevision: Long, blocks: List<ContentBlock>): Resource {
        val page = writable(id, expectedRevision)
        require(blocks.map { it.id }.toSet().size == blocks.size)
        page.blocks = blocks.map { b -> ContentBlock(b.id, JSONObject(b.content).also { it.optJSONObject("attrs")?.put("bid", b.id) }.toString()) }
        bump(page)
        return page.resource
    }

    override fun rename(id: String, expectedRevision: Long, title: String): Resource {
        val page = writable(id, expectedRevision)
        page.resource = page.resource.copy(title = title)
        bump(page)
        return page.resource
    }

    override fun createVersion(id: String, expectedRevision: Long, label: String): ContentVersion {
        val page = writable(id, expectedRevision)
        val versionId = "v${++next}"
        snapshots[versionId] = Snapshot(id, page.resource.title, page.blocks)
        return ContentVersion(versionId, id, now, label, page.blocks.size)
    }

    override fun restoreVersion(id: String, versionId: String, expectedRevision: Long): Resource {
        val page = writable(id, expectedRevision)
        val snapshot = requireNotNull(snapshots[versionId]?.takeIf { it.pageId == id }) { "Version not found for this resource" }
        snapshots["v${++next}"] = Snapshot(id, page.resource.title, page.blocks)
        page.blocks = snapshot.blocks
        page.resource = page.resource.copy(title = snapshot.title)
        bump(page)
        return page.resource
    }

    override fun trash(id: String, expectedRevision: Long) {
        val root = requireNotNull(pages[id])
        if (root.resource.revision != expectedRevision) throw ContentConflict()
        val stamp = ++now
        fun mark(pageId: String) {
            val page = pages.getValue(pageId)
            if (page.resource.deletedAt == null) page.resource = page.resource.copy(deletedAt = stamp, revision = page.resource.revision + 1)
            pages.values.filter { it.resource.parentId == pageId }.forEach { mark(it.resource.id) }
        }
        mark(id)
    }
}

class AiToolsTest {
    private fun args(vararg pairs: Pair<String, Any>) = JSONObject().also { o -> pairs.forEach { (k, v) -> o.put(k, v) } }

    private fun ok(result: AiToolResult): String {
        assertFalse(result.output, result.isError)
        return result.output
    }

    private fun failed(result: AiToolResult): String {
        assertTrue(result.output, result.isError)
        assertTrue(result.output.startsWith("Error: "))
        return result.output
    }

    @Test fun toolsMatchTheDesktopNamesAndShapes() {
        assertEquals(
            listOf("workspace_overview", "pages_list", "pages_search", "pages_read", "pages_create", "pages_append_markdown", "blocks_update", "pages_rename", "tasks_add", "tasks_list"),
            AiTools.ALL.map { it.name },
        )
        fun required(name: String): List<String> {
            val array = AiTools.ALL.first { it.name == name }.schema.getJSONArray("required")
            return (0 until array.length()).map { array.getString(it) }
        }
        assertEquals(listOf("pageId"), required("pages_read"))
        assertEquals(listOf("title"), required("pages_create"))
        assertEquals(listOf("pageId", "markdown"), required("pages_append_markdown"))
        assertEquals(listOf("blockId", "markdown"), required("blocks_update"))
        assertEquals(listOf("pageId", "title"), required("pages_rename"))
        assertEquals(listOf("pageId", "items"), required("tasks_add"))
        assertEquals(listOf("query"), required("pages_search"))
        assertEquals(emptyList<String>(), required("tasks_list"))
        val status = AiTools.ALL.first { it.name == "tasks_list" }.schema.getJSONObject("properties").getJSONObject("status").getJSONArray("enum")
        assertEquals(3, status.length())
        assertEquals("array", AiTools.ALL.first { it.name == "tasks_add" }.schema.getJSONObject("properties").getJSONObject("items").getString("type"))
    }

    @Test fun overviewListsCountsRecentPagesAndTheTime() {
        val ws = MemoryWorkspace()
        ws.add("Plan")
        ws.add("Budget", kind = "spreadsheet")
        val template = ws.add("Meeting notes", kind = "template")
        ws.hidden = setOf(template.id)
        val out = JSONObject(ok(AiToolRunner(ws, ZoneOffset.UTC) { 0L }.call("workspace_overview", JSONObject())))
        assertEquals("1970-01-01T00:00:00", out.getJSONObject("now").getString("local"))
        assertEquals("Thursday", out.getJSONObject("now").getString("weekday"))
        assertEquals(2, out.getJSONObject("counts").getInt("pages"))
        assertEquals(1, out.getJSONObject("counts").getJSONObject("byKind").getInt("spreadsheet"))
        assertEquals("Budget", out.getJSONArray("recent").getJSONObject(0).getString("title"))
    }

    @Test fun listShowsTheTreeAndHidesTemplatesAndTrash() {
        val ws = MemoryWorkspace()
        val parent = ws.add("Projects")
        val child = ws.add("Worlds", parentId = parent.id)
        ws.add("Old")
        ws.trash(ws.list().last().id, 0)
        ws.add("Template", kind = "template")
        val runner = AiToolRunner(ws)
        val all = JSONArray(ok(runner.call("pages_list", JSONObject())))
        assertEquals(listOf("Projects", "Worlds"), (0 until all.length()).map { all.getJSONObject(it).getString("title") })
        assertEquals(1, all.getJSONObject(1).getInt("depth"))
        val branch = JSONArray(ok(runner.call("pages_list", args("parentId" to parent.id))))
        assertEquals(child.id, branch.getJSONObject(0).getString("id"))
        failed(runner.call("pages_list", args("parentId" to "missing")))
    }

    @Test fun searchReturnsSnippetsAroundTheMatch() {
        val ws = MemoryWorkspace()
        val page = ws.add("Trip", markdown = "Pack the passport and the charger\n\nBook the hotel")
        ws.add("Other", markdown = "Nothing here")
        val hits = JSONArray(ok(AiToolRunner(ws).call("pages_search", args("query" to "hotel"))))
        assertEquals(1, hits.length())
        assertEquals(page.id, hits.getJSONObject(0).getString("pageId"))
        assertEquals("Book the «hotel»", hits.getJSONObject(0).getString("snippet"))
        failed(AiToolRunner(ws).call("pages_search", JSONObject()))
    }

    @Test fun readShowsBlocksSubpagesAndPath() {
        val ws = MemoryWorkspace()
        val root = ws.add("Home")
        val page = ws.add("Plan", parentId = root.id, markdown = "# Goals\n\n- [ ] Ship\n\nنص عربي")
        ws.add("Notes", parentId = page.id)
        val out = JSONObject(ok(AiToolRunner(ws).call("pages_read", args("pageId" to page.id))))
        assertEquals("Plan", out.getString("title"))
        assertTrue(out.getBoolean("editable"))
        assertEquals("Home", out.getJSONArray("path").getString(0))
        val blocks = out.getJSONArray("blocks")
        assertEquals(listOf("heading", "taskList", "paragraph"), (0 until blocks.length()).map { blocks.getJSONObject(it).getString("type") })
        assertEquals("# Goals", blocks.getJSONObject(0).getString("markdown"))
        assertEquals("نص عربي", blocks.getJSONObject(2).getString("markdown"))
        assertEquals("Notes", out.getJSONArray("subpages").getJSONObject(0).getString("title"))
        assertTrue(failed(AiToolRunner(ws).call("pages_read", args("pageId" to "nope"))).contains("page not found"))
        failed(AiToolRunner(ws).call("pages_read", JSONObject()))
    }

    @Test fun createdPagesAreUndoneByMovingThemToTrash() {
        val ws = MemoryWorkspace()
        val parent = ws.add("Projects")
        val runner = AiToolRunner(ws)
        val created = JSONObject(ok(runner.call("pages_create", args("title" to "Launch", "parentId" to parent.id, "markdown" to "# Launch\n\nFirst step"))))
        val id = created.getString("pageId")
        assertEquals(parent.id, ws.resource(id).parentId)
        assertEquals("# Launch\n\nFirst step", ws.markdown(id))
        ok(runner.call("pages_append_markdown", args("pageId" to id, "markdown" to "Second step")))
        assertEquals(listOf(AiPageChange(id, "Launch", null, true)), runner.changes)
        assertEquals(0, ws.versionCount(id))

        val result = AiUndo.undo(ws, runner.changes)
        assertEquals(listOf("Launch"), result.undone)
        assertNotNull(ws.resource(id).deletedAt)
        assertNull(ws.resource(parent.id).deletedAt)
    }

    @Test fun editsToExistingPagesAreUndoneInOneStep() {
        val ws = MemoryWorkspace()
        val page = ws.add("Plan", markdown = "Hello\n\nKeep me")
        val other = ws.add("Groceries")
        val runner = AiToolRunner(ws)
        val read = JSONObject(ok(runner.call("pages_read", args("pageId" to page.id))))
        val firstBlock = read.getJSONArray("blocks").getJSONObject(0).getString("id")

        val updated = JSONObject(ok(runner.call("blocks_update", args("blockId" to firstBlock, "markdown" to "Hi **there**\n\nInserted"))))
        assertEquals(firstBlock, updated.getString("updated"))
        assertEquals(1, updated.getJSONArray("inserted").length())
        assertEquals("Hi **there**\n\nInserted\n\nKeep me", ws.markdown(page.id))
        ok(runner.call("pages_rename", args("pageId" to page.id, "title" to "Plan v2")))
        ok(runner.call("tasks_add", args("pageId" to other.id, "items" to JSONArray().put("Milk").put("  ").put("Eggs\nlarge"))))
        assertEquals("- [ ] Milk\n- [ ] Eggs large", ws.markdown(other.id))

        // One version per page, captured before its first change.
        assertEquals(1, ws.versionCount(page.id))
        assertEquals(listOf(page.id, other.id), runner.changes.map { it.pageId })
        assertEquals("Plan v2", runner.changes[0].title)
        assertFalse(runner.changes[0].created)

        val result = AiUndo.undo(ws, runner.changes)
        assertEquals(2, result.undone.size)
        assertTrue(result.failed.isEmpty())
        assertEquals("Plan", ws.resource(page.id).title)
        assertEquals("Hello\n\nKeep me", ws.markdown(page.id))
        assertEquals("", ws.markdown(other.id))
        // The assistant's version is kept too, in the page's history.
        assertEquals(2, ws.versionCount(page.id))
    }

    @Test fun blockUpdateKeepsAnExplicitDirection() {
        val ws = MemoryWorkspace()
        val page = ws.add("Notes", markdown = "Old")
        val doc = ws.load(page.id)!!
        val node = JSONObject(doc.blocks[0].content)
        node.getJSONObject("attrs").put("dir", "rtl")
        ws.saveBlocks(page.id, 0, listOf(ContentBlock(doc.blocks[0].id, node.toString())))
        ok(AiToolRunner(ws).call("blocks_update", args("blockId" to doc.blocks[0].id, "markdown" to "جديد")))
        assertEquals("rtl", JSONObject(ws.load(page.id)!!.blocks[0].content).getJSONObject("attrs").getString("dir"))
        failed(AiToolRunner(ws).call("blocks_update", args("blockId" to "missing", "markdown" to "x")))
    }

    @Test fun tasksAreAddedAfterABlockAndListedByState() {
        val ws = MemoryWorkspace()
        val page = ws.add("Week", markdown = "# Monday\n\n- [x] Gym\n- [ ] Call mum\n\n# Tuesday")
        val heading = ws.load(page.id)!!.blocks[0].id
        val runner = AiToolRunner(ws)
        ok(runner.call("tasks_add", args("pageId" to page.id, "items" to JSONArray().put("Read"), "afterBlockId" to heading)))
        assertTrue(ws.markdown(page.id).startsWith("# Monday\n\n- [ ] Read\n\n- [x] Gym"))
        val open = JSONObject(ok(runner.call("tasks_list", JSONObject())))
        assertEquals(2, open.getInt("open"))
        assertEquals(1, open.getInt("done"))
        assertEquals(listOf("Read", "Call mum"), (0 until open.getJSONArray("items").length()).map { open.getJSONArray("items").getJSONObject(it).getString("text") })
        val done = JSONObject(ok(runner.call("tasks_list", args("status" to "done", "pageId" to page.id))))
        assertEquals("Gym", done.getJSONArray("items").getJSONObject(0).getString("text"))
        assertEquals(0, done.getJSONArray("items").getJSONObject(0).getInt("index"))
        assertEquals(3, JSONObject(ok(runner.call("tasks_list", args("status" to "all", "limit" to "2")))).getInt("open") + 1)
        failed(runner.call("tasks_add", args("pageId" to page.id, "items" to JSONArray())))
        failed(runner.call("tasks_add", args("pageId" to page.id, "items" to JSONArray().put("x"), "afterBlockId" to "missing")))
    }

    @Test fun onlyPagesAndDocumentsAreEdited() {
        val ws = MemoryWorkspace()
        val sheet = ws.add("Budget", kind = "spreadsheet")
        val template = ws.add("Template", kind = "template")
        val runner = AiToolRunner(ws)
        assertTrue(failed(runner.call("pages_append_markdown", args("pageId" to sheet.id, "markdown" to "x"))).contains("only pages and documents"))
        failed(runner.call("pages_read", args("pageId" to template.id)))
        failed(runner.call("pages_create", args("title" to "Inside", "parentId" to sheet.id)))
        // A rename works on any kind and is undoable like any other change.
        ok(runner.call("pages_rename", args("pageId" to sheet.id, "title" to "Budget 2027")))
        AiUndo.undo(ws, runner.changes)
        assertEquals("Budget", ws.resource(sheet.id).title)
        assertTrue(runner.changes.none { it.pageId == template.id })
    }

    @Test fun staleRevisionsAreRefusedAndNothingChanges() {
        val ws = object : MemoryWorkspace() {
            override fun load(id: String): ResourceDocument? {
                val doc = super.load(id) ?: return null
                // Someone else saved after this read.
                return doc.copy(resource = doc.resource.copy(revision = doc.resource.revision - 1))
            }
        }
        val page = ws.add("Plan", markdown = "Original")
        ws.rename(page.id, 0, "Plan")
        val before = ws.markdown(page.id)
        val runner = AiToolRunner(ws)
        assertTrue(failed(runner.call("pages_append_markdown", args("pageId" to page.id, "markdown" to "More"))).contains("changed"))
        assertEquals(before, ws.markdown(page.id))
        assertTrue(runner.changes.isEmpty())
    }

    @Test fun undoReportsPagesItCouldNotPutBack() {
        val ws = MemoryWorkspace()
        val page = ws.add("Plan", markdown = "One")
        val runner = AiToolRunner(ws)
        ok(runner.call("pages_append_markdown", args("pageId" to page.id, "markdown" to "Two")))
        ws.trash(page.id, ws.resource(page.id).revision)
        val result = AiUndo.undo(ws, runner.changes)
        assertEquals(listOf("Plan"), result.failed)
        assertTrue(result.undone.isEmpty())
    }

    @Test fun badArgumentsAndUnknownToolsAreErrors() {
        val ws = MemoryWorkspace()
        val runner = AiToolRunner(ws)
        assertTrue(failed(runner.call("pages_create", args("title" to "  "))).contains("title"))
        assertTrue(failed(runner.call("pages_delete", JSONObject())).contains("no tool named"))
        assertTrue(failed(runner.call("pages_append_markdown", args("pageId" to ws.add("P").id, "markdown" to "   "))).isNotEmpty())
        assertTrue(runner.changes.isEmpty())
    }
}
