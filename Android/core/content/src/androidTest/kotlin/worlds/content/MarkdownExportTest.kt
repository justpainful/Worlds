package worlds.content

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class MarkdownExportTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "markdown-test-${UUID.randomUUID()}.db"
    private lateinit var store: ContentStore
    @Before fun setup() { store = ContentStore(context, name) }
    @After fun cleanup() { store.close(); context.deleteDatabase(name) }

    @Test fun matchesDesktopExporterForRealNodeFixtures() {
        val json = InstrumentationRegistry.getInstrumentation().context.assets.open("desktop-markdown.json").bufferedReader(Charsets.UTF_8).use { it.readText() }
        val cases = JSONArray(json)
        assertTrue(cases.length() >= 27)
        for (i in 0 until cases.length()) {
            val fixture = cases.getJSONObject(i)
            assertEquals(fixture.getString("name"), fixture.getString("markdown"), MarkdownExport.block(fixture.getJSONObject("node")))
        }
    }

    @Test fun pageProjectionKeepsTitleOrderAndDoesNotModifySource() {
        val page = store.create("page", "عنوان 😀")
        val heading = """{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Notes"}]}"""
        val paragraph = """{"type":"paragraph","content":[{"type":"text","text":"A","marks":[{"type":"bold"}]}]}"""
        val empty = """{"type":"paragraph"}"""
        store.saveBlocks(page.id, 0, listOf(ContentBlock("one", heading), ContentBlock("empty", empty), ContentBlock("two", paragraph)))
        val before = store.load(page.id)!!
        assertEquals("# عنوان 😀\n\n## Notes\n\n**A**\n", MarkdownExport.page(before))
        assertEquals(before, store.load(page.id))
        assertEquals(1, store.history(page.id).count { it.kind == "blocks_saved" })
    }
}
