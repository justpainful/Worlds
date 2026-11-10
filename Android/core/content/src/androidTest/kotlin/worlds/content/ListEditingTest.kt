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
class ListEditingTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "list-test-${UUID.randomUUID()}.db"
    private lateinit var store: ContentStore
    @Before fun setup() { store = ContentStore(context, name) }
    @After fun cleanup() { store.close(); context.deleteDatabase(name) }

    @Test fun taskEditAndTogglePreserveNestedContentAndOtherBlocks() {
        val page = store.create("page", "List")
        val list = """{"type":"taskList","attrs":{"custom":7},"content":[{"type":"taskItem","attrs":{"checked":false,"custom":"keep"},"content":[{"type":"paragraph","content":[{"type":"text","text":"one","marks":[{"type":"bold"}]}]},{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"nested"}]}]}]}]},{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"two"}]}]}]}"""
        val other = """{"type":"mermaid","attrs":{"code":"keep"}}"""
        store.saveBlocks(page.id, 0, listOf(ContentBlock("tasks", list), ContentBlock("other", other)))
        val before = store.load(page.id)!!
        val item = ListEditing.read(before.blocks[0].content).items[0]
        assertFalse(item.incomplete); assertFalse(item.checked!!)
        assertEquals(listOf(0, 1, 0), ListEditing.read(before.blocks[0].content).items[1].path)
        val changed = InlineEditing.replace(item.paragraph!!, 0, 3, "first")
        store.editList(page.id, "tasks", 1) { ListEditing.replaceParagraph(it, 0, changed) }
        store.editList(page.id, "tasks", 2) { ListEditing.setChecked(it, 0, true) }
        store.editList(page.id, "tasks", 3) { ListEditing.append(it) }
        val after = store.load(page.id)!!
        val root = JSONObject(after.blocks[0].content)
        val first = root.getJSONArray("content").getJSONObject(0)
        assertTrue(first.getJSONObject("attrs").getBoolean("checked"))
        assertEquals("keep", first.getJSONObject("attrs").getString("custom"))
        assertEquals("nested", first.getJSONArray("content").getJSONObject(1).getJSONArray("content").getJSONObject(0).getJSONArray("content").getJSONObject(0).getJSONArray("content").getJSONObject(0).getString("text"))
        assertEquals("bold", first.getJSONArray("content").getJSONObject(0).getJSONArray("content").getJSONObject(0).getJSONArray("marks").getJSONObject(0).getString("type"))
        assertEquals(before.blocks[1].content, after.blocks[1].content)
        assertEquals(4, ListEditing.read(after.blocks[0].content).items.size)
        assertTrue(runCatching { store.editList(page.id, "tasks", 1) { ListEditing.append(it) } }.exceptionOrNull() is ContentConflict)
        assertEquals(after, store.load(page.id))
    }

    @Test fun createsAllListKindsAndKeepsOrderAndVersions() {
        val page = store.create("page", "Lists")
        val paragraph = """{"type":"paragraph","content":[{"type":"text","text":"first"}]}"""
        store.insertList(page.id, "bullet", 0, "bulletList", paragraph)
        store.insertList(page.id, "ordered", 1, "orderedList", paragraph, "bullet")
        store.insertList(page.id, "tasks", 2, "taskList", paragraph, "ordered")
        val list = store.load(page.id)!!
        assertEquals(listOf("bullet", "ordered", "tasks"), list.blocks.map { it.id })
        assertEquals(listOf("bulletList", "orderedList", "taskList"), list.blocks.map { ListEditing.read(it.content).type })
        assertFalse(ListEditing.read(list.blocks.last().content).items.single().checked!!)
        val saved = store.createVersion(page.id, 3)
        store.editList(page.id, "tasks", 3) { ListEditing.setChecked(it, 0, true) }
        store.restoreVersion(page.id, saved.id, 4)
        assertFalse(ListEditing.read(store.load(page.id)!!.blocks.last().content).items.single().checked!!)
    }

    @Test fun malformedTaskItemIsNotSilentlyModified() {
        val raw = """{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":"unknown"},"content":[{"type":"paragraph"}]}]}"""
        assertNull(ListEditing.read(raw).items.single().checked)
        assertTrue(runCatching { ListEditing.setChecked(raw, 0, true) }.isFailure)
        assertEquals("unknown", JSONObject(raw).getJSONArray("content").getJSONObject(0).getJSONObject("attrs").getString("checked"))
    }
    @Test fun nestedTasksCanBeEditedMovedAndRemovedWithoutLosingSiblings() {
        val page = store.create("page", "Nested")
        val text = """{"type":"paragraph","content":[{"type":"text","text":"Parent"}]}"""
        store.insertList(page.id, "tasks", 0, "taskList", text)
        store.editList(page.id, "tasks", 1) { ListEditing.addNested(it, listOf(0)) }
        val nestedPath = listOf(0, 1, 0)
        val nestedText = """{"type":"paragraph","content":[{"type":"text","text":"Child"}]}"""
        store.editList(page.id, "tasks", 2) { ListEditing.replaceParagraph(it, nestedPath, nestedText) }
        store.editList(page.id, "tasks", 3) { ListEditing.setChecked(it, nestedPath, true) }
        store.editList(page.id, "tasks", 4) { ListEditing.insertAfter(it, nestedPath) }
        store.editList(page.id, "tasks", 5) { ListEditing.move(it, listOf(0, 1, 1), -1) }
        val before = store.load(page.id)!!
        val list = ListEditing.read(before.blocks.single().content)
        assertEquals(listOf(listOf(0), listOf(0, 1, 0), listOf(0, 1, 1)), list.items.map { it.path })
        assertTrue(list.items[2].checked!!)
        assertEquals("Child", InlineEditing.text(list.items[2].paragraph!!))
        assertTrue(runCatching { store.removeListItem(page.id, "tasks", 5, listOf(0, 1, 1)) }.exceptionOrNull() is ContentConflict)
        store.removeListItem(page.id, "tasks", 6, listOf(0, 1, 0))
        store.removeListItem(page.id, "tasks", 7, listOf(0, 1, 0))
        val parentOnly = store.load(page.id)!!
        assertEquals(1, ListEditing.read(parentOnly.blocks.single().content).items.size)
        assertEquals("Parent", InlineEditing.text(ListEditing.read(parentOnly.blocks.single().content).items.single().paragraph!!))
        store.removeListItem(page.id, "tasks", 8, listOf(0))
        assertTrue(store.load(page.id)!!.blocks.isEmpty())
        assertTrue(store.versions(page.id).isNotEmpty())
    }

    @Test fun invalidNestedPathsAndUnknownChildrenArePreserved() {
        val raw = """{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph"},{"type":"custom","attrs":{"important":true}}]}]}"""
        assertTrue(ListEditing.read(raw).items.single().incomplete)
        val result = JSONObject(ListEditing.addNested(raw, listOf(0)))
        val children = result.getJSONArray("content").getJSONObject(0).getJSONArray("content")
        assertTrue(children.getJSONObject(1).getJSONObject("attrs").getBoolean("important"))
        assertEquals("bulletList", children.getJSONObject(2).getString("type"))
        assertTrue(runCatching { ListEditing.remove(raw, listOf(0, 1, 0)) }.isFailure)
        assertTrue(runCatching { ListEditing.move(raw, listOf(0), -1) }.isFailure)
    }

}
