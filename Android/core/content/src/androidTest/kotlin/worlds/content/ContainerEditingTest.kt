package worlds.content

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class ContainerEditingTest {
    @Test fun importedCalloutEditPreservesOtherParagraphsAndUnknownChildren() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "container-${UUID.randomUUID()}.db"
        try {
            ContentStore(context, name).use { store ->
                val page = store.create("page", "Notes")
                val source = """{"type":"callout","attrs":{"tone":"warning","custom":7},"content":[{"type":"paragraph","content":[{"type":"text","text":"First","marks":[{"type":"bold"}]}]},{"type":"unknown","attrs":{"keep":true}},{"type":"paragraph","content":[{"type":"text","text":"Last"}]}]}"""
                store.saveBlocks(page.id, 0, listOf(ContentBlock("callout", source)))
                val raw = store.load(page.id)!!.blocks.single().content
                val items = ContainerEditing.read(raw)
                assertEquals("warning", items.label); assertNull(items.paragraphs[1]); assertEquals(3, items.paragraphs.size)
                val edited = InlineEditing.replace(items.paragraphs[0]!!, 0, 5, "Updated")
                store.editList(page.id, "callout", 1) { ContainerEditing.replaceParagraph(it, 0, edited) }
                assertTrue(runCatching { store.editList(page.id, "callout", 1) { ContainerEditing.append(it) } }.exceptionOrNull() is ContentConflict)
                store.editList(page.id, "callout", 2) { ContainerEditing.append(it) }
                val saved = JSONObject(store.load(page.id)!!.blocks.single().content)
                assertEquals(7, saved.getJSONObject("attrs").getInt("custom"))
                assertTrue(saved.getJSONArray("content").getJSONObject(1).getJSONObject("attrs").getBoolean("keep"))
                val result = ContainerEditing.read(saved.toString())
                assertEquals("Updated", InlineEditing.text(result.paragraphs[0]!!))
                assertTrue(InlineEditing.hasMark(result.paragraphs[0]!!, 0, 7, "bold"))
                assertEquals("Last", InlineEditing.text(result.paragraphs[2]!!)); assertEquals("", InlineEditing.text(result.paragraphs[3]!!))
                assertTrue(runCatching { ContainerEditing.replaceParagraph(saved.toString(), 1, result.paragraphs[0]!!) }.isFailure)
            }
            ContentStore(context, name).use { store -> assertEquals(4, ContainerEditing.read(store.load(store.list().single().id)!!.blocks.single().content).paragraphs.size) }
        } finally { context.deleteDatabase(name) }
    }
    @Test fun createdTypesFollowDesktopShapes() {
        val paragraph = """{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}"""
        for (type in listOf("blockquote", "callout", "prompt")) {
            val result = ContainerEditing.read(ContainerEditing.create(type, "id", paragraph))
            assertEquals(type, result.type); assertEquals("Hello", InlineEditing.text(result.paragraphs.single()!!))
        }
        assertEquals("note", ContainerEditing.read(ContainerEditing.create("callout", "id", paragraph)).label)
        assertEquals("Prompt", ContainerEditing.read(ContainerEditing.create("prompt", "id", paragraph)).label)
    }
}
