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
class InlineEditingTest {
    @Test fun changingFontSizePreservesOtherTextStyleAndSelectionBoundaries() {
        val original = """{"type":"paragraph","content":[{"type":"text","text":"Hello!","marks":[{"type":"bold"},{"type":"textStyle","attrs":{"color":"#ff0000","custom":"keep"}}]}]}"""
        val changed = InlineEditing.setTextStyleAttribute(original, 0, 5, "fontSize", "10.5pt")
        val nodes = org.json.JSONObject(changed).getJSONArray("content")
        val attrs = nodes.getJSONObject(0).getJSONArray("marks").getJSONObject(1).getJSONObject("attrs")
        assertEquals("10.5pt", attrs.getString("fontSize")); assertEquals("#ff0000", attrs.getString("color")); assertEquals("keep", attrs.getString("custom"))
        assertEquals("!", nodes.getJSONObject(1).getString("text"))
        assertTrue(InlineEditing.hasMark(changed, 0, 5, "bold"))
        val reset = InlineEditing.setTextStyleAttribute(changed, 0, 5, "fontSize", null)
        assertFalse(org.json.JSONObject(reset).getJSONArray("content").getJSONObject(0).getJSONArray("marks").getJSONObject(1).getJSONObject("attrs").has("fontSize"))
        assertTrue(runCatching { InlineEditing.setTextStyleAttribute(original, 0, 5, "fontSize", "9999pt") }.isFailure)
    }
    @Test fun paragraphStylesPreserveOtherDataAndRejectOtherNodes() {
        val original = """{"type":"paragraph","attrs":{"bid":"x","textAlign":"right","custom":"keep"},"content":[{"type":"text","text":"Hello","marks":[{"type":"bold"}]}]}"""
        val changed = InlineEditing.setParagraphStyle(original, "subtitle")
        val attrs = org.json.JSONObject(changed).getJSONObject("attrs")
        assertEquals("subtitle", attrs.getString("pstyle")); assertEquals("right", attrs.getString("textAlign")); assertEquals("keep", attrs.getString("custom"))
        assertTrue(InlineEditing.hasMark(changed, 0, 5, "bold"))
        assertTrue(runCatching { InlineEditing.setParagraphStyle(original, "invalid") }.isFailure)
        assertTrue(runCatching { InlineEditing.setParagraphStyle("""{"type":"heading"}""", "title") }.isFailure)
    }
    @Test fun alignmentKeepsUnknownAttributesAndFormatting() {
        val original = """{"type":"paragraph","attrs":{"bid":"x","custom":"keep"},"content":[{"type":"text","text":"Hello","marks":[{"type":"bold"}]}]}"""
        val changed = InlineEditing.setAlignment(original, "justify")
        val node = org.json.JSONObject(changed)
        assertEquals("justify", node.getJSONObject("attrs").getString("textAlign"))
        assertEquals("keep", node.getJSONObject("attrs").getString("custom"))
        assertTrue(InlineEditing.hasMark(changed, 0, 5, "bold"))
        assertTrue(org.json.JSONObject(InlineEditing.setAlignment(changed, null)).getJSONObject("attrs").isNull("textAlign"))
        assertTrue(runCatching { InlineEditing.setAlignment(original, "invented") }.isFailure)
    }
    @Test fun textStyleUpdatesOneAttributeWithoutLosingOtherData() {
        val block = """{"type":"paragraph","content":[{"type":"text","text":"Hello","marks":[{"type":"bold"},{"type":"textStyle","attrs":{"color":"#ff0000","backgroundColor":"rgba(1, 2, 3, 0.24)","custom":"keep"}}]}]}"""
        val changed = InlineEditing.setTextStyleAttribute(block, 1, 4, "color", "#64a8ff")
        val content = JSONObject(changed).getJSONArray("content")
        val middle = content.getJSONObject(1); val marks = middle.getJSONArray("marks")
        val style = (0 until marks.length()).map { marks.getJSONObject(it) }.single { it.getString("type") == "textStyle" }.getJSONObject("attrs")
        assertEquals("#64a8ff", style.getString("color")); assertEquals("rgba(1, 2, 3, 0.24)", style.getString("backgroundColor")); assertEquals("keep", style.getString("custom"))
        assertTrue(InlineEditing.hasMark(changed, 0, 5, "bold"))
        val removed = InlineEditing.setTextStyleAttribute(changed, 1, 4, "color", null)
        val removedAttrs = JSONObject(removed).getJSONArray("content").getJSONObject(1).getJSONArray("marks").getJSONObject(1).getJSONObject("attrs")
        assertFalse(removedAttrs.has("color")); assertEquals("keep", removedAttrs.getString("custom"))
    }
    @Test fun linkValidationAndMarkReplacementPreserveOtherMarks() {
        assertTrue(LinkAddress.isSupported("https://example.com/a?b=1"))
        assertTrue(LinkAddress.isSupported("mailto:hello@example.com"))
        listOf("javascript:alert(1)", "file:///etc/passwd", "https://", "https://u:p@example.com", "https://example.com/has space").forEach { assertFalse(LinkAddress.isSupported(it)) }
        val block = """{"type":"paragraph","content":[{"type":"text","text":"Hello world","marks":[{"type":"bold"}]}]}"""
        val linked = InlineEditing.setMark(block, 0, 5, """{"type":"link","attrs":{"href":"https://example.com"}}""", true)
        assertTrue(InlineEditing.hasMark(linked, 0, 5, "link"))
        assertTrue(InlineEditing.hasMark(linked, 0, 11, "bold"))
        val unlinked = InlineEditing.setMark(linked, 0, 5, """{"type":"link"}""", false)
        assertFalse(InlineEditing.hasMark(unlinked, 0, 5, "link"))
        assertTrue(InlineEditing.hasMark(unlinked, 0, 11, "bold"))
    }
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "inline-test-${UUID.randomUUID()}.db"
    private lateinit var store: ContentStore
    @Before fun create() { store = ContentStore(context, name) }
    @After fun close() { store.close(); context.deleteDatabase(name) }

    @Test fun formatsPartOfMultipleRunsWithoutLosingOtherMarksOrAttributes() {
        val block = """{"type":"paragraph","attrs":{"bid":"p","custom":7},"content":[{"type":"text","text":"ab","marks":[{"type":"link","attrs":{"href":"https://example.com"}}]},{"type":"text","text":"cd","marks":[{"type":"italic"}]}]}"""
        val result = JSONObject(InlineEditing.setMark(block, 1, 3, """{"type":"bold"}""", true))
        val nodes = result.getJSONArray("content")
        assertEquals(7, result.getJSONObject("attrs").getInt("custom"))
        assertEquals(4, nodes.length())
        assertEquals("a", nodes.getJSONObject(0).getString("text"))
        assertEquals("b", nodes.getJSONObject(1).getString("text"))
        assertEquals("link", nodes.getJSONObject(1).getJSONArray("marks").getJSONObject(0).getString("type"))
        assertEquals("bold", nodes.getJSONObject(1).getJSONArray("marks").getJSONObject(1).getString("type"))
        assertEquals("italic", nodes.getJSONObject(2).getJSONArray("marks").getJSONObject(0).getString("type"))
        assertEquals("abcd", plainText(result))
    }

    @Test fun replacementPreservesSurroundingRunsAndSupportsHardBreaks() {
        val block = """{"type":"paragraph","attrs":{"bid":"p"},"content":[{"type":"text","text":"ab","marks":[{"type":"bold"}]},{"type":"hardBreak"},{"type":"text","text":"cd","marks":[{"type":"italic"}]}]}"""
        val result = JSONObject(InlineEditing.replace(block, 1, 4, "X\nY"))
        assertEquals("aX\nYd", plainText(result))
        val nodes = result.getJSONArray("content")
        assertEquals("bold", nodes.getJSONObject(1).getJSONArray("marks").getJSONObject(0).getString("type"))
        assertEquals("hardBreak", nodes.getJSONObject(2).getString("type"))
        assertEquals("italic", nodes.getJSONObject(nodes.length() - 1).getJSONArray("marks").getJSONObject(0).getString("type"))
    }

    @Test fun unicodeOffsetsNeverSplitSurrogatePairs() {
        val block = """{"type":"paragraph","content":[{"type":"text","text":"A😀B"}]}"""
        assertTrue(runCatching { InlineEditing.replace(block, 2, 2, "x") }.isFailure)
        assertTrue(runCatching { InlineEditing.setMark(block, 1, 2, """{"type":"bold"}""", true) }.isFailure)
        assertEquals("A🌍B", plainText(JSONObject(InlineEditing.replace(block, 1, 3, "🌍"))))
        assertTrue(runCatching { InlineEditing.replace(block, 0, 0, "\uD800") }.isFailure)
    }

    @Test fun removingOneMarkKeepsUnknownMarksAndOtherContent() {
        val block = """{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"abc","marks":[{"type":"bold"},{"type":"custom","attrs":{"v":2}}]}]}"""
        val result = JSONObject(InlineEditing.setMark(block, 0, 3, """{"type":"bold"}""", false))
        val marks = result.getJSONArray("content").getJSONObject(0).getJSONArray("marks")
        assertEquals(1, marks.length())
        assertEquals(2, marks.getJSONObject(0).getJSONObject("attrs").getInt("v"))
        assertEquals(2, result.getJSONObject("attrs").getInt("level"))
    }

    @Test fun storeEditsOneBlockAndRejectsStaleOrUnsupportedEdits() {
        val page = store.create("page", "Test")
        val paragraph = """{"type":"paragraph","content":[{"type":"text","text":"hello"}]}"""
        val complex = """{"type":"mermaid","attrs":{"code":"graph TD; A-->B","bid":"diagram"}}"""
        store.saveBlocks(page.id, 0, listOf(ContentBlock("p", paragraph), ContentBlock("diagram", complex)))
        val beforeComplex = store.load(page.id)!!.blocks[1].content
        val changed = store.replaceInline(page.id, "p", 1, 1, 4, "i")
        assertEquals(2, changed.revision)
        assertEquals("hio", plainText(JSONObject(store.load(page.id)!!.blocks[0].content)))
        assertEquals(beforeComplex, store.load(page.id)!!.blocks[1].content)
        assertTrue(runCatching { store.replaceInline(page.id, "p", 1, 0, 1, "z") }.exceptionOrNull() is ContentConflict)
        assertTrue(runCatching { store.replaceInline(page.id, "diagram", 2, 0, 0, "z") }.exceptionOrNull() is InlineEditing.UnsupportedContent)
        assertEquals(beforeComplex, store.load(page.id)!!.blocks[1].content)
        assertEquals(2, store.load(page.id)!!.resource.revision)
    }

    @Test fun unknownInlineNodesFailClosed() {
        val block = """{"type":"paragraph","content":[{"type":"text","text":"x"},{"type":"pageMention","attrs":{"id":"other"}}]}"""
        assertTrue(runCatching { InlineEditing.replace(block, 0, 1, "y") }.exceptionOrNull() is InlineEditing.UnsupportedContent)
        assertTrue(runCatching { InlineEditing.setMark(block, 0, 1, """{"type":"bold"}""", true) }.exceptionOrNull() is InlineEditing.UnsupportedContent)
    }

    @Test fun savesNewAndExistingInlineBlocksWithoutTouchingOtherContent() {
        val page = store.create("page", "Draft")
        val diagram = """{"type":"mermaid","attrs":{"code":"graph TD; A-->B"}}"""
        store.saveBlocks(page.id, 0, listOf(ContentBlock("diagram", diagram)))
        val savedDiagram = store.load(page.id)!!.blocks.single().content
        val paragraph = """{"type":"paragraph","attrs":{"bid":"p"},"content":[{"type":"text","text":"hello"}]}"""
        store.saveInlineBlock(page.id, "p", 1, paragraph, true)
        val bold = InlineEditing.setMark(paragraph, 0, 5, """{"type":"bold"}""", true)
        assertTrue(InlineEditing.hasMark(bold, 0, 5, "bold"))
        store.saveInlineBlock(page.id, "p", 2, bold, false)
        assertTrue(runCatching { store.saveInlineBlock(page.id, "p", 2, paragraph, false) }.exceptionOrNull() is ContentConflict)
        val result = store.load(page.id)!!
        assertEquals(savedDiagram, result.blocks[0].content)
        assertEquals(bold, result.blocks[1].content)
    }

    @Test fun insertsAndMovesBlocksWithRevisionChecksAndPreservesUnknownNodes() {
        val page = store.create("page", "Structure")
        val a = """{"type":"paragraph","content":[{"type":"text","text":"A"}]}"""
        val diagram = """{"type":"mermaid","attrs":{"code":"graph TD; A-->B"}}"""
        store.saveBlocks(page.id, 0, listOf(ContentBlock("a", a), ContentBlock("diagram", diagram)))
        val original = store.load(page.id)!!
        val heading = """{"type":"heading","attrs":{"bid":"h","level":2},"content":[{"type":"text","text":"Heading"}]}"""
        store.saveInlineBlock(page.id, "h", 1, heading, true, "a")
        assertEquals(listOf("a", "h", "diagram"), store.load(page.id)!!.blocks.map { it.id })
        store.moveBlock(page.id, "diagram", 2, -1)
        val moved = store.load(page.id)!!
        assertEquals(listOf("a", "diagram", "h"), moved.blocks.map { it.id })
        assertEquals(original.blocks[1].content, moved.blocks[1].content)
        assertTrue(runCatching { store.moveBlock(page.id, "a", 2, 1) }.exceptionOrNull() is ContentConflict)
        assertTrue(runCatching { store.saveInlineBlock(page.id, "other", 3, heading, true, "missing") }.isFailure)
        assertEquals(moved, store.load(page.id))
    }

    @Test fun insertionAfterUnmarkedTextDoesNotInheritFollowingBold() {
        val block = """{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"text","text":"b","marks":[{"type":"bold"}]}]}"""
        val result = JSONObject(InlineEditing.replace(block, 1, 1, "x"))
        val nodes = result.getJSONArray("content")
        assertEquals("axb", plainText(result))
        assertFalse(nodes.getJSONObject(1).has("marks"))
        assertEquals("bold", nodes.getJSONObject(2).getJSONArray("marks").getJSONObject(0).getString("type"))
    }

    @Test fun emptyInsertionDoesNotChangeTheStoredBlockOrRevision() {
        val page = store.create("page", "Test")
        val paragraph = """{"type":"paragraph","attrs":{"custom":true},"content":[{"type":"text","text":"hello"}]}"""
        store.saveBlocks(page.id, 0, listOf(ContentBlock("p", paragraph)))
        val before = store.load(page.id)!!
        val result = store.replaceInline(page.id, "p", 1, 2, 2, "")
        assertEquals(1, result.revision)
        assertEquals(before.blocks.single().content, store.load(page.id)!!.blocks.single().content)
        assertTrue(store.versions(page.id).isEmpty())
    }
}
