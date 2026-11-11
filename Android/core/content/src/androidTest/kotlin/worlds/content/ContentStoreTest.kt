package worlds.content

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class ContentStoreTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "content-test-${UUID.randomUUID()}.db"
    private lateinit var store: ContentStore
    @Before fun create() { store = ContentStore(context, name) }
    @After fun close() { store.close(); context.deleteDatabase(name) }

    @Test fun avifImagesPreserveOriginalBytesInPagesGalleriesAndSlides() {
        val bytes = InstrumentationRegistry.getInstrumentation().context.assets.open("sample.avif").use { it.readBytes() }
        val page = store.create("page", "AVIF page")
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val decoded = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        val supported = bounds.outMimeType == "image/avif" && bounds.outWidth > 0 && bounds.outHeight > 0 && decoded != null
        decoded?.recycle()
        if (!supported) {
            assertTrue(runCatching { store.insertImage(page.id, page.revision, "image.avif", bytes) }.isFailure)
            assertTrue(store.load(page.id)!!.blocks.isEmpty())
            return
        }
        for (kind in listOf("page", "gallery")) {
            val resource = if (kind == "page") page else store.create(kind, "AVIF gallery")
            store.insertImage(resource.id, resource.revision, "image.avif", bytes)
            val attrs = JSONObject(store.load(resource.id)!!.blocks.single().content).getJSONObject("attrs")
            assertEquals("image/avif", attrs.getString("mime"))
            if (kind == "page") { assertEquals(24, attrs.getInt("width")); assertEquals(16, attrs.getInt("height")) }
            assertArrayEquals(bytes, store.imageBytes(attrs.getString("attachmentId")))
        }
        val deck = store.create("presentation", "AVIF deck")
        val slide = store.load(deck.id)!!.blocks.single()
        val updated = store.insertSlideImage(deck.id, deck.revision, slide.id, "image.avif", bytes)
        var attrs = JSONObject(store.load(deck.id)!!.blocks.single().content).getJSONObject("attrs")
        val image = attrs.getJSONArray("elements").getJSONObject(attrs.getJSONArray("elements").length() - 1)
        assertArrayEquals(bytes, store.imageBytes(image.getString("attachmentId")))
        store.insertSlideImage(deck.id, updated.revision, slide.id, "background.avif", bytes, background = true)
        attrs = JSONObject(store.load(deck.id)!!.blocks.single().content).getJSONObject("attrs")
        assertArrayEquals(bytes, store.imageBytes(attrs.getJSONObject("background").getString("attachmentId")))
    }

    @Test fun projectDetailsAndLinksPreserveUnknownDataAndStayIndependent() {
        val metadata = """{"outside":9,"project":{"status":"active","start":null,"due":null,"description":"old","links":[],"future":"keep"}}"""
        val project = store.create("project", "Project", metadata = metadata, instructions = "[\"retain\"]")
        val external = store.create("page", "External")
        val updated = store.updateProjectDetails(project.id, project.revision, "paused", "2026-11-08", "2027-01-01", "Plan")
        val linked = store.changeProjectLink(project.id, updated.revision, external.id, true)
        val parsed = ProjectEditing.read(linked.metadata)
        assertEquals("paused", parsed.status); assertEquals("2026-11-08", parsed.start); assertEquals("2027-01-01", parsed.due); assertEquals("Plan", parsed.description)
        assertEquals(listOf(external.id), parsed.links); assertNull(store.load(external.id)!!.resource.parentId)
        assertEquals(9, JSONObject(linked.metadata).getInt("outside")); assertEquals("keep", JSONObject(linked.metadata).getJSONObject("project").getString("future")); assertEquals("[\"retain\"]", linked.instructions)
        assertTrue(runCatching { store.changeProjectLink(project.id, updated.revision, external.id, false) }.exceptionOrNull() is ContentConflict)
        assertTrue(runCatching { store.changeProjectLink(project.id, linked.revision, external.id, true) }.isFailure)
        assertTrue(runCatching { store.updateProjectDetails(project.id, linked.revision, "done", "2026-02-30", null, "bad") }.isFailure)
        val unlinked = store.changeProjectLink(project.id, linked.revision, external.id, false)
        assertTrue(ProjectEditing.read(unlinked.metadata).links.isEmpty()); assertNull(store.load(external.id)!!.resource.parentId)
        store.close(); store = ContentStore(context, name)
        assertEquals("Plan", ProjectEditing.read(store.load(project.id)!!.resource.metadata).description)
    }

    @Test fun projectChildrenAndTrashDoNotMoveOrDeleteLinkedResources() {
        val project = store.create("project", "Project", metadata = ProjectEditing.defaultProjectMetadata)
        val external = store.create("page", "External")
        val linked = store.changeProjectLink(project.id, project.revision, external.id, true)
        val page = store.createProjectChild(project.id, linked.revision, "page", "Page")
        val document = store.createProjectChild(project.id, linked.revision, "document", "Doc")
        val drawing = store.createProjectChild(project.id, linked.revision, "drawing", "Draw")
        val nested = store.createProjectChild(project.id, linked.revision, "project", "Nested")
        assertEquals(setOf(page.id, document.id, drawing.id, nested.id), store.children(project.id).map { it.id }.toSet())
        assertEquals("A4", JSONObject(document.metadata).getJSONObject("doc").getString("size")); assertEquals("active", ProjectEditing.read(nested.metadata).status)
        assertTrue(runCatching { store.createProjectChild(project.id, project.revision, "page", "stale") }.exceptionOrNull() is ContentConflict)
        assertTrue(runCatching { store.changeProjectLink(project.id, linked.revision, page.id, true) }.isFailure)
        assertTrue(runCatching { store.changeProjectLink(project.id, linked.revision, project.id, true) }.isFailure)
        store.trash(project.id, linked.revision)
        assertNotNull(store.load(page.id)!!.resource.deletedAt); assertNull(store.load(external.id)!!.resource.deletedAt)
        store.restore(project.id)
        assertNull(store.load(page.id)!!.resource.deletedAt); assertEquals(listOf(external.id), ProjectEditing.read(store.load(project.id)!!.resource.metadata).links)
    }

    @Test fun projectRejectsMalformedMetadataAndKeepsUnknownLinks() {
        assertTrue(runCatching { ProjectEditing.read("""{"project":{"links":[42]}}""") }.isFailure)
        assertTrue(runCatching { ProjectEditing.read("""{"project":{"status":"future"}}""") }.isFailure)
        assertTrue(ProjectEditing.validDate("2024-02-29")); assertFalse(ProjectEditing.validDate("2025-02-29"))
        val project = store.create("project", "Missing link", metadata = """{"project":{"status":"active","links":["missing"]}}""")
        val changed = store.updateProjectDetails(project.id, project.revision, "done", null, null, "Finished")
        assertEquals(listOf("missing"), ProjectEditing.read(changed.metadata).links)
    }

    @Test fun personalPageCanMoveIntoProjectWithoutBypassingRevisionOrCycleChecks() {
        val project = store.create("project", "Destination", metadata = ProjectEditing.defaultProjectMetadata)
        val page = store.create("page", "Page")
        val childProject = store.create("project", "Descendant", parentId = page.id, metadata = ProjectEditing.defaultProjectMetadata)
        val destinations = store.personalMoveDestinations(page.id, page.revision)
        assertTrue(destinations.any { it.id == project.id }); assertFalse(destinations.any { it.id == childProject.id })
        assertTrue(runCatching { store.move(page.id, page.revision, childProject.id, childProject.revision, personalOnly = true) }.isFailure)
        val moved = store.move(page.id, page.revision, project.id, project.revision, personalOnly = true)
        assertEquals(project.id, moved.parentId); assertEquals(listOf(page.id), store.children(project.id).map { it.id })
        assertTrue(runCatching { store.move(page.id, page.revision, null, personalOnly = true) }.exceptionOrNull() is ContentConflict)
    }

    @Test fun findReplacePreservesFormattingUnknownBlocksAndRecovery() {
        val page = store.create("page", "Find")
        val first = """{"type":"paragraph","attrs":{"bid":"a","custom":"keep"},"content":[{"type":"text","text":"Hello hello","marks":[{"type":"bold"}]}]}"""
        val other = """{"type":"custom","attrs":{"bid":"b","other":7}}"""
        val saved = store.saveBlocks(page.id, page.revision, listOf(ContentBlock("a", first), ContentBlock("b", other)))
        val before = store.load(page.id)!!
        val found = PageFind.scan(before.blocks, "HELLO", false)
        assertEquals(2, found.matches.size); assertEquals(1, found.skippedBlocks)
        assertEquals("Hello", found.matches[0].context.substring(found.matches[0].contextStart, found.matches[0].contextEnd))
        assertEquals("hello", found.matches[1].context.substring(found.matches[1].contextStart, found.matches[1].contextEnd))
        assertTrue(PageFind.scan(before.blocks, "HELLO", true).matches.isEmpty())
        val updated = store.replacePageText(page.id, saved.revision, "hello", "Hi", false, null)
        val changed = store.load(page.id)!!
        assertEquals("Hi Hi", InlineEditing.text(changed.blocks[0].content)); assertTrue(InlineEditing.hasMark(changed.blocks[0].content, 0, 2, "bold"))
        assertEquals(before.blocks[1].content, changed.blocks[1].content)
        assertEquals("keep", JSONObject(changed.blocks[0].content).getJSONObject("attrs").getString("custom"))
        assertTrue(runCatching { store.replacePageText(page.id, saved.revision, "Hi", "lost", false, null) }.exceptionOrNull() is ContentConflict)
        val recovery = store.versions(page.id).first()
        store.restoreVersion(page.id, recovery.id, updated.revision)
        assertEquals("Hello hello", InlineEditing.text(store.load(page.id)!!.blocks[0].content))
    }

    @Test fun findDoesNotCrossTextRunsOrSplitUnicode() {
        val raw = """{"type":"paragraph","content":[{"type":"text","text":"hello"},{"type":"text","text":"world😀"}]}"""
        val blocks = listOf(ContentBlock("a", raw))
        assertTrue(PageFind.scan(blocks, "lowo", false).matches.isEmpty())
        val match = PageFind.scan(blocks, "😀", false).matches.single()
        assertEquals("helloworld!", InlineEditing.text(PageFind.replace(blocks, listOf(match), "!").single().content))
        assertTrue(runCatching { PageFind.scan(blocks, "\uD83D", false) }.isFailure)
    }

    @Test fun findReplaceFailureRollsBackAllBlocksAndHistory() {
        val page = store.create("page", "Atomic search")
        val a = """{"type":"paragraph","content":[{"type":"text","text":"old first"}]}"""
        val b = """{"type":"paragraph","content":[{"type":"text","text":"old second"}]}"""
        val saved = store.saveBlocks(page.id, page.revision, listOf(ContentBlock("a", a), ContentBlock("b", b)))
        val before = store.load(page.id)!!; val versions = store.versions(page.id).size
        store.writableDatabase.execSQL("CREATE TRIGGER fail_second_replace BEFORE UPDATE ON blocks WHEN NEW.id = 'b' BEGIN SELECT RAISE(ABORT, 'fail'); END")
        assertTrue(runCatching { store.replacePageText(page.id, saved.revision, "old", "new", false, null) }.isFailure)
        assertEquals(before.blocks, store.load(page.id)!!.blocks)
        assertEquals(saved.revision, store.load(page.id)!!.resource.revision)
        assertEquals(versions, store.versions(page.id).size)
    }

    @Test fun findReplaceTraversesNestedListsTablesAndPreservesUnknownData() {
        val page = store.create("page", "Nested search")
        val list = """{"type":"taskList","attrs":{"custom":"list"},"content":[{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"cat parent","marks":[{"type":"bold"}]}]},{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"cat nested"}]}]}]},{"type":"futureNode","attrs":{"value":"cat untouched"}}]}]}"""
        val table = """{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","attrs":{"colspan":2,"custom":"keep"},"content":[{"type":"paragraph","content":[{"type":"text","text":"cat cell"}]}]}]}]}"""
        val saved = store.saveBlocks(page.id, page.revision, listOf(ContentBlock("list", list), ContentBlock("table", table)))
        val snapshot = store.load(page.id)!!; val found = PageFind.scan(snapshot.blocks, "cat", false)
        assertEquals(3, found.matches.size); assertEquals(1, found.skippedBlocks)
        assertEquals(listOf(0, 1, 0, 0), found.matches[1].path)
        val one = PageFind.replace(snapshot.blocks, listOf(found.matches[1]), "dog")
        val oneText = JSONObject(one[0].content).getJSONArray("content").getJSONObject(0).getJSONArray("content")
        assertEquals("cat parent", InlineEditing.text(oneText.getJSONObject(0).toString()))
        assertEquals("dog nested", InlineEditing.text(oneText.getJSONObject(1).getJSONArray("content").getJSONObject(0).getJSONArray("content").getJSONObject(0).toString()))
        val changed = store.replacePageText(page.id, saved.revision, "cat", "dog", false, null)
        val blocks = store.load(page.id)!!.blocks
        val root = JSONObject(blocks[0].content); val item = root.getJSONArray("content").getJSONObject(0)
        assertTrue(item.getJSONObject("attrs").getBoolean("checked")); assertEquals("cat untouched", item.getJSONArray("content").getJSONObject(2).getJSONObject("attrs").getString("value"))
        assertEquals("dog parent", InlineEditing.text(item.getJSONArray("content").getJSONObject(0).toString()))
        assertTrue(InlineEditing.hasMark(item.getJSONArray("content").getJSONObject(0).toString(), 0, 3, "bold"))
        val cell = JSONObject(blocks[1].content).getJSONArray("content").getJSONObject(0).getJSONArray("content").getJSONObject(0)
        assertEquals(2, cell.getJSONObject("attrs").getInt("colspan")); assertEquals("keep", cell.getJSONObject("attrs").getString("custom"))
        assertEquals("dog cell", InlineEditing.text(cell.getJSONArray("content").getJSONObject(0).toString()))
        store.restoreVersion(page.id, store.versions(page.id).first().id, changed.revision)
        assertEquals(snapshot.blocks, store.load(page.id)!!.blocks)
    }

    @Test fun findScansColumnsTabsAndCalloutsWithoutEnteringUnknownNodes() {
        val raw = """{"type":"columns","content":[{"type":"column","content":[{"type":"toggle","content":[{"type":"heading","content":[{"type":"text","text":"target title"}]},{"type":"callout","content":[{"type":"paragraph","content":[{"type":"text","text":"target note"}]}]}]}]},{"type":"column","content":[{"type":"tabs","content":[{"type":"tab","attrs":{"title":"keep"},"content":[{"type":"paragraph","content":[{"type":"text","text":"target tab"}]}]}]},{"type":"future","content":[{"type":"paragraph","content":[{"type":"text","text":"target hidden"}]}]}]}]}"""
        val blocks = listOf(ContentBlock("c", raw)); val found = PageFind.scan(blocks, "target", false)
        assertEquals(3, found.matches.size); assertEquals(1, found.skippedBlocks)
        val output = PageFind.replace(blocks, found.matches, "found").single().content
        assertEquals(3, PageFind.scan(listOf(ContentBlock("c", output)), "found", false).matches.size)
        assertTrue(output.contains("target hidden")); assertTrue(output.contains("\"title\":\"keep\""))
    }

    @Test fun findReplaceCodeKeepsLanguageRunsAndUnsupportedCode() {
        val page = store.create("page", "Code search")
        val code = """{"type":"codeBlock","attrs":{"language":"kotlin","custom":"keep"},"content":[{"type":"text","text":"cat one\n"},{"type":"text","text":"cat two"}]}"""
        val protectedCode = """{"type":"codeBlock","attrs":{"language":"python"},"content":[{"type":"text","text":"cat protected","marks":[{"type":"bold"}]}]}"""
        val saved = store.saveBlocks(page.id, page.revision, listOf(ContentBlock("code", code), ContentBlock("protected", protectedCode)))
        val before = store.load(page.id)!!; val matches = PageFind.scan(before.blocks, "cat", false)
        assertEquals(2, matches.matches.size); assertEquals(1, matches.skippedBlocks)
        assertTrue(PageFind.scan(before.blocks, "one\ncat", false).matches.isEmpty())
        val changed = store.replacePageText(page.id, saved.revision, "cat", "dog", false, null)
        val after = store.load(page.id)!!; val node = JSONObject(after.blocks[0].content)
        assertEquals("dog one\ndog two", CodeEditing.read(after.blocks[0].content).text)
        assertEquals("kotlin", node.getJSONObject("attrs").getString("language")); assertEquals("keep", node.getJSONObject("attrs").getString("custom"))
        assertEquals(2, node.getJSONArray("content").length()); assertEquals(before.blocks[1].content, after.blocks[1].content)
        store.restoreVersion(page.id, store.versions(page.id).first().id, changed.revision)
        assertEquals(before.blocks, store.load(page.id)!!.blocks)
    }

    @Test fun findReplacesTextAroundInlineAtomsWithoutChangingThem() {
        val page = store.create("page", "Inline search")
        val paragraph = """{"type":"paragraph","attrs":{"custom":"keep"},"content":[{"type":"text","text":"cat before","marks":[{"type":"bold"},{"type":"futureMark","attrs":{"x":7}}]},{"type":"mathInline","attrs":{"latex":"cat^2","custom":"preserve"}},{"type":"text","text":"cat after","marks":[{"type":"italic"}]},{"type":"text","text":"cat protected","extra":"keep"}]}"""
        val saved = store.saveBlocks(page.id, page.revision, listOf(ContentBlock("p", paragraph)))
        val before = store.load(page.id)!!; val result = PageFind.scan(before.blocks, "cat", false)
        assertEquals(2, result.matches.size); assertEquals(1, result.skippedBlocks)
        val updated = store.replacePageText(page.id, saved.revision, "cat", "dog", false, null)
        val children = JSONObject(store.load(page.id)!!.blocks.single().content).getJSONArray("content")
        assertEquals("dog before", children.getJSONObject(0).getString("text")); assertEquals("futureMark", children.getJSONObject(0).getJSONArray("marks").getJSONObject(1).getString("type"))
        assertEquals("cat^2", children.getJSONObject(1).getJSONObject("attrs").getString("latex")); assertEquals("preserve", children.getJSONObject(1).getJSONObject("attrs").getString("custom"))
        assertEquals("dog after", children.getJSONObject(2).getString("text")); assertEquals("cat protected", children.getJSONObject(3).getString("text"))
        store.restoreVersion(page.id, store.versions(page.id).first().id, updated.revision)
        assertEquals(before.blocks, store.load(page.id)!!.blocks)
    }

    @Test fun findCanDeleteWholeRunsWithoutDeletingInlineAtoms() {
        val raw = """{"type":"paragraph","content":[{"type":"text","text":"😀"},{"type":"mathInline","attrs":{"latex":"x"}},{"type":"text","text":"😀"}]}"""
        val blocks = listOf(ContentBlock("p", raw)); val found = PageFind.scan(blocks, "😀", false)
        val result = JSONObject(PageFind.replace(blocks, found.matches, "").single().content).getJSONArray("content")
        assertEquals(1, result.length()); assertEquals("mathInline", result.getJSONObject(0).getString("type")); assertEquals("x", result.getJSONObject(0).getJSONObject("attrs").getString("latex"))
    }

    @Test fun findRejectsReplaceAllWhenTooManyMatches() {
        val page = store.create("page", "Many matches")
        val raw = JSONObject().put("type", "paragraph").put("content", org.json.JSONArray().put(JSONObject().put("type", "text").put("text", "x".repeat(1001)))).toString()
        val saved = store.saveBlocks(page.id, page.revision, listOf(ContentBlock("a", raw)))
        assertTrue(PageFind.scan(store.load(page.id)!!.blocks, "x", false).truncated)
        assertTrue(runCatching { store.replacePageText(page.id, saved.revision, "x", "y", false, null) }.isFailure)
        assertEquals("x".repeat(1001), InlineEditing.text(store.load(page.id)!!.blocks.single().content))
    }

    @Test fun documentTypographyPreservesOtherSettingsAndRejectsStaleChanges() {
        val page = store.create("document", "Typography", metadata = """{"doc":{"header":"keep","fontSize":12,"lineHeight":1.5},"extra":7}""")
        val changed = store.updateDocumentTypography(page.id, page.revision, 18.5, 2.0)
        val meta = JSONObject(changed.metadata); val doc = meta.getJSONObject("doc")
        assertEquals(7, meta.getInt("extra")); assertEquals("keep", doc.getString("header")); assertEquals(18.5, doc.getDouble("fontSize"), 0.001); assertEquals(2.0, doc.getDouble("lineHeight"), 0.001)
        assertTrue(runCatching { store.updateDocumentTypography(page.id, page.revision, 24.0, 1.5) }.exceptionOrNull() is ContentConflict)
        assertTrue(runCatching { store.updateDocumentTypography(page.id, changed.revision, Double.NaN, 1.5) }.isFailure)
        assertTrue(runCatching { store.updateDocumentTypography(page.id, changed.revision, 12.0, 3.1) }.isFailure)
        store.close(); store = ContentStore(context, name)
        assertEquals(18.5, JSONObject(store.load(page.id)!!.resource.metadata).getJSONObject("doc").getDouble("fontSize"), 0.001)
    }

    @Test fun documentRunningTextPreservesMetadataAndRejectsStaleWrites() {
        val page = store.create("document", "Document", metadata = """{"doc":{"size":"A4","header":"old","custom":"keep"},"outside":42}""", instructions = "[\"keep\"]")
        val saved = store.updateDocumentRunningText(page.id, page.revision, "Header", "Footer")
        val metadata = JSONObject(saved.metadata)
        assertEquals(42, metadata.getInt("outside")); assertEquals("keep", metadata.getJSONObject("doc").getString("custom"))
        assertEquals("Header", metadata.getJSONObject("doc").getString("header")); assertEquals("Footer", metadata.getJSONObject("doc").getString("footer"))
        assertEquals("[\"keep\"]", saved.instructions)
        assertTrue(runCatching { store.updateDocumentRunningText(page.id, page.revision, "stale", "") }.exceptionOrNull() is ContentConflict)
        assertEquals(saved.revision, store.updateDocumentRunningText(page.id, saved.revision, "Header", "Footer").revision)
        assertTrue(runCatching { store.updateDocumentRunningText(page.id, saved.revision, "x".repeat(2001), "") }.isFailure)
        store.close(); store = ContentStore(context, name)
        assertEquals("Footer", JSONObject(store.load(page.id)!!.resource.metadata).getJSONObject("doc").getString("footer"))
    }

    @Test fun animatedGifIsStoredAndSurvivesReopen() {
        val bytes = android.util.Base64.decode("R0lGODlhEAAMAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAHgAAACwAAAAAEAAMAAAIGQABCBxIsKDBgwgTKlzIsKHDhxAjSpwoMCAAIfkEAR4AAQAsAAAAABAADACBAAD/AAAAAAAAAAAACBkAAQgcSLCgwYMIEypcyLChw4cQI0qcKDAgADs=", android.util.Base64.DEFAULT)
        val page = store.create("page", "Animated")
        store.insertImage(page.id, page.revision, "animated.gif", bytes)
        val attrs = JSONObject(store.load(page.id)!!.blocks.single().content).getJSONObject("attrs")
        assertEquals("image/gif", attrs.getString("mime")); assertEquals(16, attrs.getInt("width")); assertEquals(12, attrs.getInt("height"))
        val id = attrs.getString("attachmentId")
        store.close(); store = ContentStore(context, name)
        assertArrayEquals(bytes, store.imageBytes(id))
    }

    @Test fun imagePresentationPersistsAndRejectsStaleChanges() {
        val bitmap = android.graphics.Bitmap.createBitmap(20, 20, android.graphics.Bitmap.Config.ARGB_8888)
        val bytes = java.io.ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray(); bitmap.recycle()
        val page = store.create("page", "Images")
        val inserted = store.insertImage(page.id, page.revision, "image.png", bytes)
        val block = store.load(page.id)!!.blocks.single()
        val original = JSONObject(block.content); val attrs = original.getJSONObject("attrs"); val attachment = attrs.getString("attachmentId")
        attrs.put("futureProperty", "preserve")
        val enriched = store.saveBlocks(page.id, inserted.revision, listOf(ContentBlock(block.id, original.toString())))
        val updated = store.updateImagePresentation(page.id, block.id, enriched.revision, "A caption", 50, "right")
        assertTrue(runCatching { store.updateImagePresentation(page.id, block.id, enriched.revision, "stale", 100, "left") }.exceptionOrNull() is ContentConflict)
        assertTrue(runCatching { store.updateImagePresentation(page.id, block.id, updated.revision, "invalid", 10, "left") }.isFailure)
        store.close(); store = ContentStore(context, name)
        val saved = JSONObject(store.load(page.id)!!.blocks.single().content).getJSONObject("attrs")
        assertEquals("A caption", saved.getString("caption")); assertEquals(50, saved.getInt("display")); assertEquals("right", saved.getString("align"))
        assertEquals("preserve", saved.getString("futureProperty")); assertArrayEquals(bytes, store.imageBytes(attachment))
    }

    @Test fun streamsKeepDesktopMetadataAndRejectStaleOrInvalidChanges() {
        assertEquals("hls", StreamEditing.parseUrl("https://example.com/LIVE.M3U8?token=test").format)
        assertEquals("dash", StreamEditing.parseUrl("https://example.com/a.mpd#t=1").format)
        assertEquals("progressive", StreamEditing.parseUrl("http://example.com/video.mp4").format)
        for (bad in listOf("file:///etc/passwd", "https://name:pass@example.com/a", "https://", "https://a b")) assertTrue(runCatching { StreamEditing.parseUrl(bad) }.isFailure)
        val parent = store.create("project", "Parent", metadata = ProjectEditing.defaultProjectMetadata)
        val stream = store.createStream("News", "https://example.com/a.m3u8", parent.id, parent.revision)
        val enriched = store.updateDetails(stream.id, stream.revision, """{"stream":{"url":"https://example.com/a.m3u8","format":"hls","future":7},"other":true}""", "[]")
        val updated = store.updateStream(stream.id, enriched.revision, "https://example.com/new.mpd?x=1")
        val metadata = JSONObject(updated.metadata); assertEquals(7, metadata.getJSONObject("stream").getInt("future")); assertTrue(metadata.getBoolean("other"))
        assertEquals("dash", StreamEditing.read(updated.metadata)!!.format)
        assertTrue(runCatching { store.updateStream(stream.id, enriched.revision, "https://example.com/stale.mp4") }.exceptionOrNull() is ContentConflict)
        val changed = store.rename(parent.id, parent.revision, "Changed")
        assertTrue(runCatching { store.createStream("bad", "https://example.com/a.mp4", parent.id, parent.revision) }.exceptionOrNull() is ContentConflict)
        assertTrue(runCatching { store.createStream("bad", "file:///etc/passwd", parent.id, changed.revision) }.isFailure)
        store.close(); store = ContentStore(context, name)
        assertEquals("dash", StreamEditing.read(store.load(stream.id)!!.resource.metadata)!!.format)
    }

    @Test fun fileCanBeLinkedToExistingOrNewGalleryWithoutCopying() {
        val bytes = byteArrayOf(1, 2, 3, 4)
        val source = store.importFileResource("photo.png", "image/png", bytes.inputStream())
        val attachment = FileAttachment.read(source.metadata)!!
        val gallery = store.create("gallery", "Gallery")
        try {
            val updated = store.addFileToGallery(source.id, source.revision, gallery.id, gallery.revision)
            val first = JSONObject(store.load(gallery.id)!!.blocks.single().content).getJSONObject("attrs")
            assertEquals(attachment.id, first.getString("attachmentId")); assertEquals("image", first.getString("kind"))
            assertTrue(runCatching { store.addFileToGallery(source.id, source.revision, gallery.id, gallery.revision) }.exceptionOrNull() is ContentConflict)
            assertEquals(1, store.load(gallery.id)!!.blocks.size)
            val newGallery = store.createGalleryFromFile(source.id, source.revision, "New gallery")
            assertEquals(attachment.id, JSONObject(store.load(newGallery.id)!!.blocks.single().content).getJSONObject("attrs").getString("attachmentId"))
            val changed = store.rename(source.id, source.revision, "changed")
            assertTrue(runCatching { store.createGalleryFromFile(source.id, source.revision, "Must not exist") }.exceptionOrNull() is ContentConflict)
            assertTrue(store.list().none { it.title == "Must not exist" })
            store.trash(source.id, changed.revision)
            assertArrayEquals(bytes, store.privateFile(attachment.id)!!.readBytes())
            assertEquals(updated.revision, store.load(gallery.id)!!.resource.revision)
        } finally { store.privateFile(attachment.id)?.delete() }
    }

    @Test fun fileImportPreservesOriginalAndRejectsStaleParentAndReadFailures() {
        val directory = java.io.File(context.filesDir, "worlds-files")
        val before = directory.listFiles()?.map { it.name }?.toSet().orEmpty()
        val project = store.create("project", "Project", metadata = ProjectEditing.defaultProjectMetadata)
        val bytes = "real file data".toByteArray()
        try {
            val imported = store.importFileResource("notes.txt", "text/plain", bytes.inputStream(), project.id, project.revision)
            val info = FileAttachment.read(imported.metadata)!!
            assertEquals("file", imported.kind); assertEquals(project.id, imported.parentId); assertEquals(bytes.size.toLong(), info.size)
            assertArrayEquals(bytes, store.privateFile(info.id)!!.readBytes()); assertNull(store.privateFile("../unsafe"))
            val savedFiles = directory.listFiles()!!.map { it.name }.toSet()
            val changed = store.rename(project.id, project.revision, "Changed")
            assertTrue(runCatching { store.importFileResource("stale", "text/plain", bytes.inputStream(), project.id, project.revision) }.exceptionOrNull() is ContentConflict)
            val broken = object : java.io.InputStream() { override fun read(): Int = throw java.io.IOException("broken") }
            assertTrue(runCatching { store.importFileResource("broken", "text/plain", broken, project.id, changed.revision) }.isFailure)
            assertEquals(savedFiles, directory.listFiles()!!.map { it.name }.toSet())
            store.trash(project.id, changed.revision); assertTrue(store.load(imported.id)!!.resource.deletedAt != null)
            store.close(); store = ContentStore(context, name)
            assertArrayEquals(bytes, store.privateFile(info.id)!!.readBytes())
        } finally { directory.listFiles()?.filter { it.name !in before }?.forEach { it.delete() } }
    }

    @Test fun slideElementsAndImageAreAtomicAndCompatible() {
        val image = android.graphics.Bitmap.createBitmap(30, 20, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.MAGENTA) }
        val bytes = java.io.ByteArrayOutputStream().also { image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray(); image.recycle()
        val deck = store.create("presentation", "Slide")
        val first = store.load(deck.id)!!.blocks.single()
        val withShape = PresentationEditing.addElement(first, "ellipse")
        val shape = JSONObject(withShape.content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(2)
        val shaped = PresentationEditing.changeElement(withShape, shape.getString("id"), listOf(40, 50, 320, 200), false)
        assertTrue(runCatching { PresentationEditing.changeElement(shaped, shape.getString("id"), listOf(1, 2, 0, 0), false) }.isFailure)
        val version = store.saveBlocks(deck.id, deck.revision, listOf(shaped))
        val saved = store.insertSlideImage(deck.id, version.revision, first.id, "photo.png", bytes)
        assertTrue(runCatching { store.insertSlideImage(deck.id, version.revision, first.id, "stale.png", bytes) }.exceptionOrNull() is ContentConflict)
        val result = JSONObject(store.load(deck.id)!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements")
        assertEquals("ellipse", result.getJSONObject(2).getString("shape")); assertEquals(40, result.getJSONObject(2).getInt("x"))
        val last = result.getJSONObject(3); assertEquals("image", last.getString("type")); assertArrayEquals(bytes, store.imageBytes(last.getString("attachmentId")))
        val duplicated = PresentationEditing.duplicate(store.load(deck.id)!!.blocks.single())
        assertEquals(last.getString("attachmentId"), JSONObject(duplicated.content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(3).getString("attachmentId"))
        assertEquals(saved.revision, store.load(deck.id)!!.resource.revision)
    }

    @Test fun slideMoveRetainsSizeStyleAndUnknownFields() {
        val slide = PresentationEditing.newSlide("title")
        val node = JSONObject(slide.content); val element = node.getJSONObject("attrs").getJSONArray("elements").getJSONObject(0)
        val id = element.getString("id"); element.put("w", 1040.5).put("rot", 15).put("future", "kept")
        val original = ContentBlock(slide.id, node.toString())
        val moved = PresentationEditing.moveElement(original, id, 300, 410)
        val result = JSONObject(moved.content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(0)
        assertEquals(300, result.getInt("x")); assertEquals(410, result.getInt("y")); assertEquals(1040.5, result.getDouble("w"), 0.0)
        assertEquals(15, result.getInt("rot")); assertEquals("kept", result.getString("future"))
        assertTrue(runCatching { PresentationEditing.moveElement(original, id, 2561, 0) }.isFailure)
        assertTrue(runCatching { PresentationEditing.moveElement(original, "missing", 0, 0) }.isFailure)
    }

    @Test fun slideVideoImportValidatesAndPreservesExistingContent() {
        val assets = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().context.assets
        val video = assets.open("gallery-video.mp4").use { it.readBytes() }
        val audio = assets.open("gallery-audio.m4a").use { it.readBytes() }
        val deck = store.create("presentation", "Video")
        val slide = store.load(deck.id)!!.blocks.single()
        val directory = java.io.File(context.filesDir, "worlds-gallery-media")
        val before = directory.listFiles()?.map { it.name }?.toSet().orEmpty()
        try {
            val saved = store.insertGalleryMedia(deck.id, deck.revision, "clip.mp4", "video/mp4", video.inputStream(), slideId = slide.id)
            val node = JSONObject(store.load(deck.id)!!.blocks.single().content).getJSONObject("attrs")
            val items = node.getJSONArray("elements"); assertEquals(3, items.length())
            val element = items.getJSONObject(2); assertEquals("video", element.getString("type")); assertEquals("contain", element.getString("fit"))
            assertArrayEquals(video, store.galleryMediaFile(element.getString("attachmentId"))!!.readBytes())
            assertTrue(runCatching { store.insertGalleryMedia(deck.id, deck.revision, "stale.mp4", "video/mp4", video.inputStream(), slideId = slide.id) }.exceptionOrNull() is ContentConflict)
            assertTrue(runCatching { store.insertGalleryMedia(deck.id, saved.revision, "bad.mp4", "video/mp4", audio.inputStream(), slideId = slide.id) }.isFailure)
            val after = directory.listFiles()?.map { it.name }?.toSet().orEmpty(); assertEquals(1, (after - before).size)
            val edited = PresentationEditing.changeElement(store.load(deck.id)!!.blocks.single(), element.getString("id"), listOf(40, 50, 600, 400), false)
            assertEquals(40, JSONObject(edited.content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(2).getInt("x"))
        } finally { directory.listFiles()?.filter { it.name !in before }?.forEach { it.delete() } }
    }

    @Test fun slideBackgroundImageImportIsAtomicAndPreservesColor() {
        val bitmap = android.graphics.Bitmap.createBitmap(20, 10, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.GREEN) }
        val bytes = java.io.ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray(); bitmap.recycle()
        val deck = store.create("presentation", "Background")
        val slide = store.load(deck.id)!!.blocks.single()
        val saved = store.insertSlideImage(deck.id, deck.revision, slide.id, "background.png", bytes, background = true)
        val changed = store.load(deck.id)!!.blocks.single()
        val attrs = JSONObject(changed.content).getJSONObject("attrs"); val background = attrs.getJSONObject("background")
        val attachment = background.getString("attachmentId")
        assertEquals("#16161a", background.getString("color")); assertEquals(2, attrs.getJSONArray("elements").length())
        assertArrayEquals(bytes, store.imageBytes(attachment))
        val countBefore = store.readableDatabase.rawQuery("SELECT COUNT(*) FROM media_blobs", null).use { it.moveToFirst(); it.getInt(0) }
        assertTrue(runCatching { store.insertSlideImage(deck.id, deck.revision, slide.id, "stale.png", bytes, background = true) }.exceptionOrNull() is ContentConflict)
        assertTrue(runCatching { store.insertSlideImage(deck.id, saved.revision, slide.id, "invalid.png", byteArrayOf(1, 2, 3), background = true) }.isFailure)
        val countAfter = store.readableDatabase.rawQuery("SELECT COUNT(*) FROM media_blobs", null).use { it.moveToFirst(); it.getInt(0) }
        assertEquals(countBefore, countAfter); assertEquals(attachment, JSONObject(store.load(deck.id)!!.blocks.single().content).getJSONObject("attrs").getJSONObject("background").getString("attachmentId"))
        val removed = PresentationEditing.removeBackgroundImage(changed)
        val revision = store.saveBlocks(deck.id, saved.revision, listOf(removed))
        val result = JSONObject(store.load(deck.id)!!.blocks.single().content).getJSONObject("attrs").getJSONObject("background")
        assertTrue(!result.has("attachmentId")); assertEquals("#16161a", result.getString("color")); assertTrue(revision.revision > saved.revision)
        assertArrayEquals(bytes, store.imageBytes(attachment))
    }

    @Test fun slideBackgroundAndTextStylePreserveUnrelatedData() {
        val block = PresentationEditing.newSlide("title")
        val node = JSONObject(block.content); val attrs = node.getJSONObject("attrs")
        attrs.getJSONObject("background").put("attachmentId", "old-picture").put("future", 7)
        val element = attrs.getJSONArray("elements").getJSONObject(0)
        element.getJSONObject("style").put("future", "kept"); val id = element.getString("id")
        attrs.put("notes", "keep notes")
        val recolored = PresentationEditing.changeBackground(ContentBlock(block.id, node.toString()), "#14532d")
        val background = JSONObject(recolored.content).getJSONObject("attrs").getJSONObject("background")
        assertEquals("#14532d", background.getString("color")); assertEquals(7, background.getInt("future")); assertTrue(!background.has("attachmentId"))
        val formatted = PresentationEditing.changeTextStyle(recolored, id, mapOf("fontSize" to "48", "fontWeight" to "700", "italic" to "true", "align" to "right", "color" to "#e5484d"))
        val result = JSONObject(formatted.content).getJSONObject("attrs"); val style = result.getJSONArray("elements").getJSONObject(0).getJSONObject("style")
        assertEquals(48, style.getInt("fontSize")); assertEquals(700, style.getInt("fontWeight")); assertTrue(style.getBoolean("italic"))
        assertEquals("right", style.getString("align")); assertEquals("#e5484d", style.getString("color")); assertEquals("kept", style.getString("future")); assertEquals("keep notes", result.getString("notes"))
        assertTrue(runCatching { PresentationEditing.changeTextStyle(formatted, id, mapOf("fontSize" to "301")) }.isFailure)
        assertTrue(runCatching { PresentationEditing.changeTextStyle(formatted, "missing", emptyMap()) }.isFailure)
        assertTrue(runCatching { PresentationEditing.changeBackground(formatted, "invalid") }.isFailure)
    }

    @Test fun slideLayoutsPreserveFilledPlaceholdersAndOtherElements() {
        val block = PresentationEditing.newSlide("two-columns")
        val node = JSONObject(block.content); val attrs = node.getJSONObject("attrs"); val elements = attrs.getJSONArray("elements")
        elements.getJSONObject(0).put("text", "Heading")
        elements.getJSONObject(1).put("text", "Left")
        elements.getJSONObject(2).put("text", "Right")
        elements.put(JSONObject().put("id", "custom").put("type", "future-widget").put("data", 42))
        attrs.put("notes", "Keep notes").put("future", "Keep metadata")
        val changed = PresentationEditing.changeLayout(ContentBlock(block.id, node.toString()), "title-body")
        val result = JSONObject(changed.content).getJSONObject("attrs"); val next = result.getJSONArray("elements")
        assertEquals("title-body", result.getString("layout")); assertEquals("Heading", next.getJSONObject(0).getString("text"))
        assertEquals("Left", next.getJSONObject(1).getString("text")); assertEquals(42, next.getJSONObject(2).getInt("data"))
        assertEquals("Right", next.getJSONObject(3).getString("text")); assertTrue(!next.getJSONObject(3).has("role"))
        assertEquals("Keep notes", result.getString("notes")); assertEquals("Keep metadata", result.getString("future"))
        listOf("title", "title-body", "section", "two-columns", "image", "blank").forEach { layout ->
            assertEquals(layout, JSONObject(PresentationEditing.newSlide(layout).content).getJSONObject("attrs").getString("layout"))
        }
        assertTrue(runCatching { PresentationEditing.changeLayout(block, "invalid") }.isFailure)
    }

    @Test fun presentationSlideEditingPreservesOtherElementsAndRejectsStaleWrites() {
        val deck = store.create("presentation", "Deck", metadata = PresentationEditing.defaultMetadata)
        val initial = store.load(deck.id)!!.blocks.single()
        val node = JSONObject(initial.content); val attrs = node.getJSONObject("attrs"); val elements = attrs.getJSONArray("elements")
        val title = elements.getJSONObject(0).getString("id")
        elements.put(JSONObject().put("id", "unknown").put("type", "future-widget").put("attachmentId", "media"))
        attrs.put("future", JSONObject().put("value", 7))
        val enriched = store.saveBlocks(deck.id, deck.revision, listOf(ContentBlock(initial.id, node.toString())))
        val edited = PresentationEditing.edit(ContentBlock(initial.id, node.toString()), mapOf(title to "Hello Worlds"), "Speaker note")
        val saved = store.saveBlocks(deck.id, enriched.revision, listOf(edited))
        assertTrue(runCatching { store.saveBlocks(deck.id, enriched.revision, listOf(initial)) }.exceptionOrNull() is ContentConflict)
        assertTrue(runCatching { PresentationEditing.duplicate(edited) }.isFailure)
        store.close(); store = ContentStore(context, name)
        val result = JSONObject(store.load(deck.id)!!.blocks.single().content).getJSONObject("attrs")
        assertEquals("Hello Worlds", result.getJSONArray("elements").getJSONObject(0).getString("text"))
        assertEquals("media", result.getJSONArray("elements").getJSONObject(2).getString("attachmentId"))
        assertEquals("Speaker note", result.getString("notes")); assertEquals(7, result.getJSONObject("future").getInt("value"))
        assertTrue(saved.revision > enriched.revision)
    }

    @Test fun galleryAudioAndVideoUseFileStorageAndRejectStaleOrInvalidMedia() {
        val assets = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().context.assets
        val video = assets.open("gallery-video.mp4").use { it.readBytes() }
        val audio = assets.open("gallery-audio.m4a").use { it.readBytes() }
        val directory = java.io.File(context.filesDir, "worlds-gallery-media")
        val before = directory.listFiles()?.map { it.name }?.toSet().orEmpty()
        val created = store.create("gallery", "Media")
        try {
            val first = store.insertGalleryMedia(created.id, created.revision, "clip.mp4", "video/mp4", video.inputStream())
            val second = store.insertGalleryMedia(created.id, first.revision, "sound.m4a", "audio/mp4", audio.inputStream())
            val nodes = store.load(created.id)!!.blocks.map { JSONObject(it.content).getJSONObject("attrs") }
            assertEquals(listOf("video", "audio"), nodes.map { it.getString("kind") })
            assertArrayEquals(video, store.galleryMediaFile(nodes[0].getString("attachmentId"))!!.readBytes())
            assertArrayEquals(audio, store.galleryMediaFile(nodes[1].getString("attachmentId"))!!.readBytes())
            val savedFiles = directory.listFiles()!!.map { it.name }.toSet()
            assertTrue(runCatching { store.insertGalleryMedia(created.id, first.revision, "stale", "audio/mp4", audio.inputStream()) }.exceptionOrNull() is ContentConflict)
            assertTrue(runCatching { store.insertGalleryMedia(created.id, second.revision, "bad", "video/mp4", audio.inputStream()) }.isFailure)
            assertTrue(runCatching { store.insertGalleryMedia(created.id, second.revision, "bad", "audio/mp4", byteArrayOf(1, 2, 3).inputStream()) }.isFailure)
            assertEquals(savedFiles, directory.listFiles()!!.map { it.name }.toSet())
            assertEquals(2, store.load(created.id)!!.blocks.size)
            assertNull(store.galleryMediaFile("../unsafe"))
        } finally { directory.listFiles()?.filter { it.name !in before }?.forEach { it.delete() } }
    }

    @Test fun galleryImageUsesDesktopNodeAndRejectsStaleImport() {
        val bitmap = android.graphics.Bitmap.createBitmap(24, 16, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.BLUE) }
        val bytes = java.io.ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray(); bitmap.recycle()
        val gallery = store.create("gallery", "Images", metadata = """{"gallery":{"view":"grid"}}""")
        val saved = store.insertImage(gallery.id, gallery.revision, "blue.png", bytes)
        val node = JSONObject(store.load(gallery.id)!!.blocks.single().content)
        assertEquals("galleryItem", node.getString("type")); val attrs = node.getJSONObject("attrs")
        assertEquals("image", attrs.getString("kind")); assertEquals("blue.png", attrs.getString("name"))
        assertArrayEquals(bytes, store.imageBytes(attrs.getString("attachmentId")))
        assertTrue(runCatching { store.insertImage(gallery.id, gallery.revision, "stale.png", bytes) }.exceptionOrNull() is ContentConflict)
        assertTrue(runCatching { store.insertImage(gallery.id, saved.revision, "broken", byteArrayOf(0)) }.isFailure)
        store.close(); store = ContentStore(context, name)
        assertEquals(1, store.load(gallery.id)!!.blocks.size)
        assertArrayEquals(bytes, store.imageBytes(attrs.getString("attachmentId")))
    }

    @Test fun imageInsertIsAtomicAndSurvivesTemplateCopyAndReopen() {
        val image = android.graphics.Bitmap.createBitmap(40, 30, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.RED) }
        val bytes = java.io.ByteArrayOutputStream().also { image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        image.recycle()
        val page = store.create("page", "With image")
        val saved = store.insertImage(page.id, page.revision, "sample.png", bytes)
        val doc = store.load(page.id)!!; val node = JSONObject(doc.blocks.single().content); val attrs = node.getJSONObject("attrs")
        assertEquals("image", node.getString("type")); assertEquals("image/png", attrs.getString("mime")); assertEquals(40, attrs.getInt("width")); assertEquals(30, attrs.getInt("height"))
        val attachment = attrs.getString("attachmentId")
        assertArrayEquals(bytes, store.imageBytes(attachment))
        assertTrue(runCatching { store.insertImage(page.id, page.revision, "old.png", bytes) }.exceptionOrNull() is ContentConflict)
        assertTrue(runCatching { store.insertImage(page.id, saved.revision, "bad.png", byteArrayOf(1, 2, 3)) }.isFailure)
        assertEquals(1, store.load(page.id)!!.blocks.size)
        val template = store.saveAsTemplate(page.id, saved.revision)
        val copy = store.instantiateTemplate(template.id)
        val copyId = JSONObject(store.load(copy.id)!!.blocks.single().content).getJSONObject("attrs").getString("attachmentId")
        assertArrayEquals(bytes, store.imageBytes(copyId))
        store.close(); store = ContentStore(context, name)
        assertArrayEquals(bytes, store.imageBytes(attachment))
    }

    @Test fun versionFiveMigrationPreservesPagesAndCreatesImageStorage() {
        val page = store.create("page", "Existing")
        store.writableDatabase.execSQL("DROP TABLE media_blobs")
        store.writableDatabase.version = 5
        store.close(); store = ContentStore(context, name)
        assertEquals("Existing", store.load(page.id)!!.resource.title)
        assertNull(store.imageBytes("missing"))
    }

    @Test fun imageBytesCanCrossCursorWindowBoundaries() {
        val image = android.graphics.Bitmap.createBitmap(900, 900, android.graphics.Bitmap.Config.ARGB_8888)
        var state = 123456789
        val pixels = IntArray(900 * 900) { state = state * 1664525 + 1013904223; -0x1000000 or (state ushr 8) }
        image.setPixels(pixels, 0, 900, 0, 0, 900, 900)
        val bytes = java.io.ByteArrayOutputStream().also { image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        image.recycle()
        assertTrue(bytes.size > 2_000_000)
        val page = store.create("page", "Large image")
        store.insertImage(page.id, 0, "noise.png", bytes)
        val id = JSONObject(store.load(page.id)!!.blocks.single().content).getJSONObject("attrs").getString("attachmentId")
        assertArrayEquals(bytes, store.imageBytes(id))
    }

    @Test fun subpageCreationChecksParentRevisionAndPreservesTree() {
        val parent = store.create("page", "Parent")
        val renamed = store.rename(parent.id, parent.revision, "Updated parent")
        val count = store.list().size
        assertTrue(runCatching { store.createSubpage(parent.id, parent.revision, "Stale") }.exceptionOrNull() is ContentConflict)
        assertEquals(count, store.list().size)
        val child = store.createSubpage(parent.id, renamed.revision, " Child ")
        assertEquals("Child", child.title); assertEquals(parent.id, child.parentId)
        assertEquals(listOf(child.id), store.children(parent.id).map { it.id })
        store.trash(parent.id)
        assertTrue(runCatching { store.createSubpage(parent.id, renamed.revision, "No") }.isFailure)
        assertTrue(store.children(parent.id).isEmpty())
        store.restore(parent.id)
        assertEquals(listOf(child.id), store.children(parent.id).map { it.id })
    }

    @Test fun personalMoveRejectsCyclesTemplatesAndStaleDestinations() {
        val source = store.create("page", "Source")
        val child = store.createSubpage(source.id, source.revision, "Child")
        val target = store.create("page", "Target")
        val template = store.create("template", "Template")
        val hidden = store.create("page", "Hidden", parentId = template.id)
        val choices = store.personalMoveDestinations(source.id, source.revision)
        assertTrue(choices.any { it.id == target.id })
        assertFalse(choices.any { it.id in setOf(source.id, child.id, template.id, hidden.id) })
        assertTrue(runCatching { store.move(source.id, source.revision, child.id, child.revision, true) }.isFailure)
        assertTrue(runCatching { store.move(source.id, source.revision, hidden.id, hidden.revision, true) }.isFailure)
        val renamed = store.rename(target.id, target.revision, "Updated target")
        assertTrue(runCatching { store.move(source.id, source.revision, target.id, target.revision, true) }.exceptionOrNull() is ContentConflict)
        assertNull(store.load(source.id)!!.resource.parentId)
        val moved = store.move(source.id, source.revision, target.id, renamed.revision, true)
        assertEquals(target.id, moved.parentId); assertEquals(source.id, store.load(child.id)!!.resource.parentId)
        assertNull(store.move(source.id, moved.revision, null, personalOnly = true).parentId)
    }

    @Test fun builtinsAreSeededOnceAndCreateIndependentStructuredPages() {
        val catalog = store.ensureBuiltinTemplates()
        val total = BuiltinTemplates.all.size
        assertEquals(total, catalog.size)
        assertEquals(total, catalog.map { JSONObject(it.metadata).getString("builtin") }.toSet().size)
        val weekly = catalog.single { JSONObject(it.metadata).getString("builtin") == "weekly" }
        val original = store.load(weekly.id)!!
        val first = store.instantiateTemplate(weekly.id, "2030-04-05")
        val second = store.instantiateTemplate(weekly.id, "2030-04-06")
        val firstDoc = store.load(first.id)!!; val secondDoc = store.load(second.id)!!
        assertEquals("Weekly Update 2030-04-05", first.title)
        assertEquals("Weekly Update 2030-04-06", second.title)
        assertEquals(original.blocks.size, firstDoc.blocks.size)
        assertTrue(firstDoc.blocks.isNotEmpty())
        assertTrue(firstDoc.blocks.map { it.id }.toSet().intersect(original.blocks.map { it.id }.toSet()).isEmpty())
        assertTrue(firstDoc.blocks.map { it.id }.toSet().intersect(secondDoc.blocks.map { it.id }.toSet()).isEmpty())
        assertEquals(weekly.id, JSONObject(first.metadata).getString("fromTemplate"))
        val project = catalog.single { JSONObject(it.metadata).getString("builtin") == "project" }
        val projectDoc = store.load(store.instantiateTemplate(project.id, "2030-04-05").id)!!
        assertTrue(projectDoc.blocks.any { it.content.contains("2030-04-05") })
        assertFalse(projectDoc.blocks.any { it.content.contains("{{date}}") })
        store.trash(weekly.id)
        assertEquals(total - 1, store.ensureBuiltinTemplates().size)
        assertTrue(runCatching { store.instantiateTemplate(weekly.id) }.isFailure)
        store.close(); store = ContentStore(context, name)
        assertEquals(total - 1, store.ensureBuiltinTemplates().size)
        assertEquals(firstDoc, store.load(first.id))
    }

    @Test fun customTemplateCopiesPageTreeAndRejectsUnsafeOrStaleCopiesAtomically() {
        val root = store.create("page", "Plan {{date}}", metadata = """{"sync":{"token":"secret"},"custom":true}""")
        val saved = store.saveBlocks(root.id, root.revision, listOf(ContentBlock("root-block", """{"type":"paragraph","content":[{"type":"text","text":"Start {{date}}"}]}""")))
        val child = store.create("document", "Child", parentId = root.id)
        store.saveBlocks(child.id, 0, listOf(ContentBlock("child-block", """{"type":"paragraph","content":[{"type":"text","text":"Child content"}]}""")))
        val before = store.list().size
        assertTrue(runCatching { store.saveAsTemplate(root.id, root.revision) }.exceptionOrNull() is ContentConflict)
        assertEquals(before, store.list().size)
        val template = store.saveAsTemplate(root.id, saved.revision)
        val templateChild = store.list().single { it.parentId == template.id }
        assertEquals("template", template.kind)
        assertEquals("Custom", JSONObject(template.metadata).getString("templateCategory"))
        assertFalse(JSONObject(template.metadata).has("sync"))
        assertEquals("Child content", InlineEditing.text(store.load(templateChild.id)!!.blocks.single().content))
        val page = store.instantiateTemplate(template.id, "2031-02-03")
        val copiedChild = store.list().single { it.parentId == page.id }
        assertEquals("Plan 2031-02-03", page.title)
        assertEquals("Start 2031-02-03", InlineEditing.text(store.load(page.id)!!.blocks.single().content))
        assertEquals("Child content", InlineEditing.text(store.load(copiedChild.id)!!.blocks.single().content))
        assertNotEquals(child.id, copiedChild.id)
        store.create("drawing", "Unsupported", parentId = root.id)
        val count = store.list().size
        assertTrue(runCatching { store.saveAsTemplate(root.id, saved.revision) }.isFailure)
        assertEquals(count, store.list().size)
    }

    @Test fun staleTemplateTrashDoesNotRemoveTemplateOrItsPages() {
        val template = store.ensureBuiltinTemplates().first()
        val page = store.instantiateTemplate(template.id)
        store.rename(template.id, template.revision, "Updated template")
        assertTrue(runCatching { store.trash(template.id, template.revision) }.exceptionOrNull() is ContentConflict)
        assertNull(store.load(template.id)!!.resource.deletedAt)
        assertNull(store.load(page.id)!!.resource.deletedAt)
    }

    @Test fun removingBlockCreatesRecoverableVersionAndRejectsStaleRequests() {
        val page = store.create("page", "Block safety")
        val first = ContentBlock("one", """{"type":"paragraph","content":[{"type":"text","text":"Keep"}]}""")
        val second = ContentBlock("two", """{"type":"unsupported","attrs":{"opaque":{"important":true}}}""")
        val saved = store.saveBlocks(page.id, page.revision, listOf(first, second))
        assertTrue(runCatching { store.removeBlock(page.id, "two", page.revision) }.exceptionOrNull() is ContentConflict)
        assertTrue(runCatching { store.removeBlock(page.id, "missing", saved.revision) }.isFailure)
        assertTrue(store.versions(page.id).isEmpty())
        val removed = store.removeBlock(page.id, "two", saved.revision)
        assertEquals(listOf("one"), store.load(page.id)!!.blocks.map { it.id })
        assertEquals("block_removed", store.history(page.id).first().kind)
        val version = store.versions(page.id).single()
        assertEquals("Before block removal", version.label)
        store.restoreVersion(page.id, version.id, removed.revision)
        val restored = store.load(page.id)!!
        assertEquals(listOf("one", "two"), restored.blocks.map { it.id })
        assertTrue(JSONObject(restored.blocks[1].content).getJSONObject("attrs").getJSONObject("opaque").getBoolean("important"))
    }

    @Test fun duplicateBlockPreservesUnknownDataAndRejectsStaleRevision() {
        val page = store.create("page", "Duplicate")
        val source = ContentBlock("source", """{"type":"customNode","attrs":{"assetId":"asset-1","unknown":{"v":2}},"content":[{"type":"text","text":"مرحبا","marks":[{"type":"bold"}]}]}""")
        val tail = ContentBlock("tail", """{"type":"paragraph","content":[{"type":"text","text":"Tail"}]}""")
        val saved = store.saveBlocks(page.id, 0, listOf(source, tail))
        assertTrue(runCatching { store.duplicateBlock(page.id, "source", page.revision) }.exceptionOrNull() is ContentConflict)
        assertTrue(runCatching { store.duplicateBlock(page.id, "missing", saved.revision) }.isFailure)
        assertEquals(2, store.load(page.id)!!.blocks.size)
        val duplicated = store.duplicateBlock(page.id, "source", saved.revision)
        val blocks = store.load(page.id)!!.blocks
        assertEquals(3, blocks.size); assertEquals("source", blocks.first().id); assertEquals("tail", blocks.last().id)
        assertNotEquals("source", blocks[1].id)
        val original = JSONObject(blocks[0].content); val copy = JSONObject(blocks[1].content)
        assertEquals(blocks[1].id, copy.getJSONObject("attrs").getString("bid"))
        original.getJSONObject("attrs").remove("bid"); copy.getJSONObject("attrs").remove("bid")
        assertEquals(original.toString(), copy.toString())
        assertTrue(duplicated.revision > saved.revision)
    }

    @Test fun duplicateTemplateCopiesChildrenAndKeepsSourceIndependent() {
        val source = store.create("page", "Blueprint")
        val child = store.create("page", "Details", parentId = source.id)
        store.saveBlocks(child.id, 0, listOf(ContentBlock("child-text", """{"type":"paragraph","content":[{"type":"text","text":"Original detail"}]}""")))
        val template = store.saveAsTemplate(source.id, source.revision)
        val clone = store.duplicateTemplate(template.id, template.revision)
        assertEquals("Blueprint (copy)", clone.title)
        assertEquals("Custom", JSONObject(clone.metadata).getString("templateCategory"))
        val originalChild = store.list().single { it.parentId == template.id }
        val clonedChild = store.list().single { it.parentId == clone.id }
        assertNotEquals(originalChild.id, clonedChild.id)
        assertEquals("Original detail", InlineEditing.text(store.load(clonedChild.id)!!.blocks.single().content))
        assertNotEquals(store.load(originalChild.id)!!.blocks.single().id, store.load(clonedChild.id)!!.blocks.single().id)
        store.rename(template.id, template.revision, "Changed")
        val count = store.list().size
        assertTrue(runCatching { store.duplicateTemplate(template.id, template.revision) }.exceptionOrNull() is ContentConflict)
        assertEquals(count, store.list().size)
    }

    @Test fun savesRichBlocksAndReopensWithoutLosingUnknownAttributes() {
        val page = store.create("page", "Test", metadata = "{\"unknown\":{\"n\":3}}")
        assertTrue(page.id.matches(Regex("[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}")))
        assertEquals(page.createdAt, page.id.substring(0, 12).toLong(16))
        val node = """{"type":"paragraph","attrs":{"custom":{"k":5}},"content":[{"type":"text","text":"مرحبا"}]}"""
        val saved = store.saveBlocks(page.id, page.revision, listOf(ContentBlock("one", node)))
        store.close(); store = ContentStore(context, name)
        val document = store.load(page.id)!!
        assertEquals(saved.revision, document.resource.revision)
        assertEquals(3, JSONObject(document.resource.metadata).getJSONObject("unknown").getInt("n"))
        val attrs = JSONObject(document.blocks.single().content).getJSONObject("attrs")
        assertEquals("one", attrs.getString("bid")); assertEquals(5, attrs.getJSONObject("custom").getInt("k"))
        assertEquals(page.id, store.search("رحب").single().id)
    }

    @Test fun staleSaveAndBlockCollisionLeavePreviousContentIntact() {
        val first = store.create("page", "First")
        val second = store.create("page", "Second")
        val node = """{"type":"paragraph","content":[{"type":"text","text":"safe"}]}"""
        store.saveBlocks(first.id, 0, listOf(ContentBlock("shared-id", node)))
        assertTrue(runCatching { store.saveBlocks(first.id, 0, emptyList()) }.exceptionOrNull() is ContentConflict)
        assertTrue(runCatching { store.saveBlocks(second.id, 0, listOf(ContentBlock("shared-id", node))) }.isFailure)
        assertTrue(runCatching { store.saveBlocks(first.id, 1, listOf(ContentBlock("shared-id", """{"attrs":"invalid"}"""))) }.isFailure)
        assertEquals(1, store.load(first.id)!!.blocks.size)
        assertEquals(0, store.load(second.id)!!.blocks.size)
    }

    @Test fun moveRejectsCyclesAndTrashRestoresOnlyItsOwnGroup() {
        val parent = store.create("project", "Parent")
        val child = store.create("page", "Child", parent.id)
        val earlier = store.create("page", "Earlier", parent.id)
        store.trash(earlier.id)
        assertTrue(runCatching { store.move(parent.id, 0, child.id) }.isFailure)
        store.trash(parent.id)
        assertTrue(store.list().isEmpty())
        store.restore(parent.id)
        assertEquals(setOf(parent.id, child.id), store.list().map { it.id }.toSet())
        assertNotNull(store.load(earlier.id)!!.resource.deletedAt)
    }

    @Test fun restoringAChildOfTrashedParentLiftsItToRoot() {
        val parent = store.create("project", "Parent")
        val child = store.create("page", "Child", parent.id)
        store.trash(parent.id); store.restore(child.id)
        assertNull(store.load(child.id)!!.resource.parentId)
        assertNotNull(store.load(parent.id)!!.resource.deletedAt)
    }

    @Test fun searchTreatsWildcardsLiterallyAndIndexesSpecialNodes() {
        val page = store.create("presentation", "Deck")
        val slide = """{"type":"slide","attrs":{"notes":"ملاحظات","elements":[{"text":"100% ready"}]}}"""
        store.saveBlocks(page.id, 0, listOf(ContentBlock("slide", slide)))
        assertEquals(page.id, store.search("100%").single().id)
        assertEquals(page.id, store.search("لاحظ").single().id)
        assertTrue(store.search("_").isEmpty())
        store.trash(page.id)
        assertTrue(store.search("100%").isEmpty())
    }

    @Test fun metadataUpdatesRejectStaleRevisionsAndInvalidJson() {
        val page = store.create("document", "Draft")
        val updated = store.updateDetails(page.id, page.revision, "{\"doc\":{\"size\":\"A4\"}}", "[\"keep\"]")
        assertEquals(1, updated.revision)
        assertTrue(runCatching { store.updateDetails(page.id, 0, "{}", "[]") }.exceptionOrNull() is ContentConflict)
        assertTrue(runCatching { store.updateDetails(page.id, 1, "{", "[]") }.isFailure)
        assertEquals("A4", JSONObject(store.load(page.id)!!.resource.metadata).getJSONObject("doc").getString("size"))
    }

    @Test fun versionRestorePreservesCurrentStateAndSurvivesReopen() {
        val page = store.create("page", "First", metadata = "{\"x\":1}", instructions = "[\"a\"]")
        val first = """{"type":"paragraph","content":[{"type":"text","text":"before"}]}"""
        val second = """{"type":"paragraph","content":[{"type":"text","text":"after"}]}"""
        store.saveBlocks(page.id, 0, listOf(ContentBlock("one", first)))
        val version = store.createVersion(page.id, 1, "Named")
        store.rename(page.id, 1, "Second")
        store.updateDetails(page.id, 2, "{\"x\":2}", "[\"b\"]")
        store.saveBlocks(page.id, 3, listOf(ContentBlock("one", second)))
        assertTrue(runCatching { store.restoreVersion(page.id, version.id, 3) }.exceptionOrNull() is ContentConflict)
        store.restoreVersion(page.id, version.id, 4)
        store.close(); store = ContentStore(context, name)
        val restored = store.load(page.id)!!
        assertEquals("First", restored.resource.title)
        assertEquals(1, JSONObject(restored.resource.metadata).getInt("x"))
        assertEquals("a", org.json.JSONArray(restored.resource.instructions).getString(0))
        assertTrue(restored.blocks.single().content.contains("before"))
        val beforeRestore = store.versions(page.id).first { it.label == "Before restore" }
        store.restoreVersion(page.id, beforeRestore.id, restored.resource.revision)
        assertEquals("Second", store.load(page.id)!!.resource.title)
        assertTrue(store.load(page.id)!!.blocks.single().content.contains("after"))
    }

    @Test fun restoringCollidingBlockLeavesBothPagesAndHistoryIntact() {
        val first = store.create("page", "First")
        val second = store.create("page", "Second")
        val node = """{"type":"paragraph","content":[{"type":"text","text":"old"}]}"""
        store.saveBlocks(first.id, 0, listOf(ContentBlock("taken", node)))
        val version = store.createVersion(first.id, 1)
        store.saveBlocks(first.id, 1, emptyList())
        store.saveBlocks(second.id, 0, listOf(ContentBlock("taken", node)))
        val count = store.versions(first.id).size
        assertTrue(runCatching { store.restoreVersion(first.id, version.id, 2) }.isFailure)
        assertEquals(count, store.versions(first.id).size)
        assertTrue(store.load(first.id)!!.blocks.isEmpty())
        assertEquals(1, store.load(second.id)!!.blocks.size)
    }

    @Test fun existingVersionOneDatabaseMigratesWithoutLosingContent() {
        store.close()
        val db = context.openOrCreateDatabase(name, 0, null)
        db.execSQL("CREATE TABLE resources (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, parent_id TEXT REFERENCES resources(id), sort_key REAL NOT NULL, metadata TEXT NOT NULL, instructions TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, trash_group TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE blocks (id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, sort_key INTEGER NOT NULL, content TEXT NOT NULL, text TEXT NOT NULL)")
        db.execSQL("INSERT INTO resources(id,title,kind,sort_key,metadata,instructions,created_at,updated_at) VALUES('legacy','Kept','page',0,'{}','[]',1,1)")
        db.version = 1
        db.close()
        store = ContentStore(context, name)
        assertEquals("Kept", store.load("legacy")!!.resource.title)
        assertEquals(0, store.createVersion("legacy", 0).blockCount)
        assertEquals(1, store.versions("legacy").size)
        assertTrue(store.history("legacy").isEmpty())
    }

    @Test fun failedRestoreRollsBackTheBeforeRestoreVersionAndContent() {
        val page = store.create("page", "Page")
        val old = """{"type":"paragraph","content":[{"type":"text","text":"old"}]}"""
        val fresh = """{"type":"paragraph","content":[{"type":"text","text":"fresh"}]}"""
        store.saveBlocks(page.id, 0, listOf(ContentBlock("one", old)))
        val version = store.createVersion(page.id, 1)
        store.saveBlocks(page.id, 1, listOf(ContentBlock("one", fresh)))
        val count = store.versions(page.id).size
        store.writableDatabase.execSQL("CREATE TRIGGER fail_restore BEFORE INSERT ON blocks BEGIN SELECT RAISE(ABORT, 'restore failed'); END")
        assertTrue(runCatching { store.restoreVersion(page.id, version.id, 2) }.isFailure)
        assertEquals(count, store.versions(page.id).size)
        assertEquals(2, store.load(page.id)!!.resource.revision)
        assertTrue(store.load(page.id)!!.blocks.single().content.contains("fresh"))
    }

    @Test fun editingAnExistingPageCreatesARecoverableVersion() {
        val page = store.create("page", "Page")
        val old = """{"type":"paragraph","content":[{"type":"text","text":"old"}]}"""
        val fresh = """{"type":"paragraph","content":[{"type":"text","text":"fresh"}]}"""
        store.saveBlocks(page.id, 0, listOf(ContentBlock("one", old)))
        store.saveBlocks(page.id, 1, listOf(ContentBlock("one", fresh)))
        val auto = store.versions(page.id).single()
        store.restoreVersion(page.id, auto.id, 2)
        assertTrue(store.load(page.id)!!.blocks.single().content.contains("old"))
    }

    @Test fun historyIsDurableOrderedAndExcludesFailedOperations() {
        val page = store.create("page", "Before")
        store.rename(page.id, 0, "After")
        assertTrue(runCatching { store.rename(page.id, 0, "Stale") }.exceptionOrNull() is ContentConflict)
        store.trash(page.id); store.restore(page.id)
        store.close(); store = ContentStore(context, name)
        val history = store.history(page.id)
        assertEquals(listOf("restored", "trashed", "renamed", "created"), history.map { it.kind })
        val rename = JSONObject(history.first { it.kind == "renamed" }.details)
        assertEquals("Before", rename.getString("before")); assertEquals("After", rename.getString("after"))
    }

    @Test fun historyFailureRollsBackResourceEdit() {
        val page = store.create("page", "Kept")
        store.writableDatabase.execSQL("CREATE TRIGGER fail_history BEFORE INSERT ON history BEGIN SELECT RAISE(ABORT, 'history failed'); END")
        assertTrue(runCatching { store.rename(page.id, 0, "Lost") }.isFailure)
        assertEquals("Kept", store.load(page.id)!!.resource.title)
        assertEquals(0, store.load(page.id)!!.resource.revision)
        assertEquals(listOf("created"), store.history(page.id).map { it.kind })
    }

    @Test fun versionTwoMigrationKeepsVersionsAndCreatesHistory() {
        val page = store.create("page", "Kept")
        val version = store.createVersion(page.id, 0, "Saved")
        store.writableDatabase.execSQL("DROP TABLE history")
        store.writableDatabase.execSQL("DROP TABLE pending_drawings")
        store.writableDatabase.execSQL("DROP TABLE markdown_sources")
        store.writableDatabase.execSQL("DROP TABLE media_blobs")
        store.writableDatabase.version = 2
        store.close(); store = ContentStore(context, name)
        assertEquals(version.id, store.versions(page.id).single().id)
        assertTrue(store.history(page.id).isEmpty())
        store.rename(page.id, 0, "Renamed")
        assertEquals("renamed", store.history(page.id).single().kind)
    }

    @Test fun unchangedSaveDoesNotCreateHistoryOrAdvanceRevision() {
        val page = store.create("page", "Same")
        val node = """{"type":"paragraph","content":[{"type":"text","text":"same"}]}"""
        val saved = store.saveBlocks(page.id, 0, listOf(ContentBlock("one", node)))
        val historyCount = store.history(page.id).size
        assertEquals(saved.revision, store.saveBlocks(page.id, saved.revision, listOf(ContentBlock("one", node))).revision)
        assertEquals(saved.revision, store.rename(page.id, saved.revision, "Same").revision)
        assertEquals(historyCount, store.history(page.id).size)
        assertTrue(store.versions(page.id).isEmpty())
    }
    @Test fun importedDrawingAndResourceCommitTogetherAndSurviveReopen() {
        val page = store.createImportedDrawing("Imported", "{\"revision\":0}")
        assertEquals("drawing", page.kind)
        assertTrue(JSONObject(page.metadata).getBoolean("androidImportedDrawing"))
        store.close(); store = ContentStore(context, name)
        assertEquals("{\"revision\":0}", store.pendingDrawing(page.id))
        assertEquals("Imported", store.load(page.id)!!.resource.title)
        store.writableDatabase.execSQL("CREATE TRIGGER fail_import BEFORE INSERT ON pending_drawings BEGIN SELECT RAISE(ABORT, 'fail'); END")
        assertTrue(runCatching { store.createImportedDrawing("Must roll back", "{}") }.isFailure)
        assertEquals(listOf("Imported"), store.list().map { it.title })
    }

    @Test fun versionThreeMigrationPreservesExistingResources() {
        val page = store.create("page", "Existing")
        store.writableDatabase.execSQL("DROP TABLE pending_drawings")
        store.writableDatabase.execSQL("DROP TABLE markdown_sources")
        store.writableDatabase.execSQL("DROP TABLE media_blobs")
        store.writableDatabase.version = 3
        store.close(); store = ContentStore(context, name)
        assertEquals("Existing", store.load(page.id)!!.resource.title)
        val drawing = store.createImportedDrawing("Drawing", "{}")
        assertEquals("{}", store.pendingDrawing(drawing.id))
    }

    @Test fun readsLargeStagedDocumentAcrossCursorWindows() {
        val document = "😀".repeat(650_000) + "end"
        val page = store.createImportedDrawing("Large", document)
        assertEquals(document, store.pendingDrawing(page.id))
    }

}
