package worlds.content

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class MarkdownImportTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "markdown-import-${UUID.randomUUID()}.db"
    private lateinit var store: ContentStore
    @Before fun setup() { store = ContentStore(context, name) }
    @After fun cleanup() { store.close(); context.deleteDatabase(name) }

    private fun equal(a: Any?, b: Any?): Boolean = when {
        a is JSONObject && b is JSONObject -> {
            val keys = a.keys().asSequence().toSet(); keys == b.keys().asSequence().toSet() && keys.all { equal(a.get(it), b.get(it)) }
        }
        a is JSONArray && b is JSONArray -> a.length() == b.length() && (0 until a.length()).all { equal(a.get(it), b.get(it)) }
        a is Number && b is Number -> a.toDouble() == b.toDouble()
        else -> a == b
    }

    @Test fun matchesOriginalDesktopParserFixtures() {
        val json = InstrumentationRegistry.getInstrumentation().context.assets.open("desktop-markdown-import.json").bufferedReader(Charsets.UTF_8).use { it.readText() }
        val cases = JSONArray(json); assertTrue(cases.length() >= 28)
        for (i in 0 until cases.length()) {
            val fixture = cases.getJSONObject(i)
            val actual = JSONArray(MarkdownImport.parse(fixture.getString("source")).map { JSONObject(it) })
            assertTrue("Mismatch: ${fixture.getString("name")} expected ${fixture.getJSONArray("nodes")} got $actual", equal(fixture.getJSONArray("nodes"), actual))
        }
    }

    @Test fun importedPageAndSourceSurviveEditsAndReopen() {
        val original = "# Heading\r\n\r\n- [ ] First\r\n- [x] Second\r\n\r\n> [!note] Saved".toByteArray(Charsets.UTF_8)
        val blocks = MarkdownImport.parse(original.toString(Charsets.UTF_8))
        val page = store.createImportedMarkdown("Notes", "notes.md", original, blocks)
        val saved = store.load(page.id)!!
        assertEquals("notes.md", saved.markdownSourceName); assertEquals(3, saved.blocks.size)
        assertEquals("heading", JSONObject(saved.blocks[0].content).getString("type"))
        assertEquals("taskList", JSONObject(saved.blocks[1].content).getString("type"))
        store.editList(page.id, saved.blocks[1].id, saved.resource.revision) { ListEditing.setChecked(it, 0, true) }
        store.close(); store = ContentStore(context, name)
        assertArrayEquals(original, store.markdownSource(page.id)!!.bytes)
        assertTrue(ListEditing.read(store.load(page.id)!!.blocks[1].content).items.first().checked!!)
    }

    @Test fun failedImportRollsBackResourceBlocksAndOriginal() {
        store.create("page", "Existing")
        store.writableDatabase.execSQL("CREATE TRIGGER fail_source BEFORE INSERT ON markdown_sources BEGIN SELECT RAISE(ABORT, 'fail'); END")
        assertTrue(runCatching { store.createImportedMarkdown("Missing", "x.md", byteArrayOf(65), MarkdownImport.parse("hello")) }.isFailure)
        assertEquals(listOf("Existing"), store.list().map { it.title })
        assertEquals(0, store.readableDatabase.rawQuery("SELECT count(*) FROM blocks", null).use { it.moveToFirst(); it.getInt(0) })
    }

    @Test fun originalBytesCanExceedCursorWindowWithoutTruncation() {
        val bytes = ByteArray(2_600_000) { (it % 251).toByte() }
        val page = store.createImportedMarkdown("Large source", "large.md", bytes, emptyList())
        assertArrayEquals(bytes, store.markdownSource(page.id)!!.bytes)
    }

    @Test fun rejectsOversizedOrPathologicallyComplexInput() {
        assertTrue(runCatching { MarkdownImport.parse("a".repeat(MarkdownImport.MAX_BYTES + 1)) }.exceptionOrNull() is MarkdownImport.TooComplex)
        assertTrue(runCatching { MarkdownImport.parse("\n".repeat(100_001)) }.exceptionOrNull() is MarkdownImport.TooComplex)
        assertTrue(runCatching { MarkdownImport.parse("a".repeat(1_000_001)) }.exceptionOrNull() is MarkdownImport.TooComplex)
    }

    @Test fun versionFourMigrationKeepsResources() {
        val page = store.create("page", "Existing")
        store.writableDatabase.execSQL("DROP TABLE markdown_sources")
        store.writableDatabase.execSQL("DROP TABLE media_blobs")
        store.writableDatabase.version = 4
        store.close(); store = ContentStore(context, name)
        assertEquals("Existing", store.load(page.id)!!.resource.title)
        assertNull(store.markdownSource(page.id))
        val imported = store.createImportedMarkdown("New", "file.md", byteArrayOf(), emptyList())
        assertArrayEquals(byteArrayOf(), store.markdownSource(imported.id)!!.bytes)
    }
}
