package worlds.content

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class CodeEditingTest {
    @Test fun preservesMetadataAndPersistsWithoutChangingOtherBlocks() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "code-${UUID.randomUUID()}.db"
        try {
            ContentStore(context, name).use { store ->
                val page = store.create("page", "Code")
                val code = """{"type":"codeBlock","attrs":{"language":"kotlin","custom":{"keep":true}},"content":[{"type":"text","text":"val x = 1\n"}]}"""
                val neighbor = """{"type":"paragraph","content":[{"type":"text","text":"Keep me"}]}"""
                store.saveBlocks(page.id, 0, listOf(ContentBlock("code", code), ContentBlock("neighbor", neighbor)))
                val loaded = store.load(page.id)!!
                val changed = CodeEditing.update(loaded.blocks[0].content, "val x = 2\nprintln(x)", "java")
                store.saveCodeBlock(page.id, "code", 1, changed, false)
                assertTrue(runCatching { store.saveCodeBlock(page.id, "code", 1, changed, false) }.exceptionOrNull() is ContentConflict)
                val saved = store.load(page.id)!!
                assertEquals(CodeEditing.Value("val x = 2\nprintln(x)", "java"), CodeEditing.read(saved.blocks[0].content))
                assertTrue(JSONObject(saved.blocks[0].content).getJSONObject("attrs").getJSONObject("custom").getBoolean("keep"))
                assertEquals(loaded.blocks[1].content, saved.blocks[1].content)
                assertEquals(page.id, store.search("println").single().id)
            }
            ContentStore(context, name).use { assertEquals("java", CodeEditing.read(it.list().single().let { p -> it.load(p.id)!!.blocks[0].content }).language) }
        } finally { context.deleteDatabase(name) }
    }

    @Test fun rejectsNodesWhoseEditingCouldLoseInformation() {
        assertTrue(runCatching { CodeEditing.read("""{"type":"codeBlock","content":[{"type":"text","text":"x","marks":[{"type":"bold"}]}]}""") }.isFailure)
        assertTrue(runCatching { CodeEditing.read("""{"type":"codeBlock","content":[{"type":"unknown"}]}""") }.isFailure)
        val empty = CodeEditing.update("""{"type":"codeBlock","attrs":{"language":""}}""", "", "")
        assertEquals(CodeEditing.Value("", ""), CodeEditing.read(empty))
    }
}
