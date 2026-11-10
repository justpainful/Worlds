package worlds.content

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class TableEditingTest {
    @Test fun createsEditsResizesAndReopensTable() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "table-${UUID.randomUUID()}.db"
        try {
            ContentStore(context, name).use { store ->
                val page = store.create("page", "Table")
                store.insertTable(page.id, "table", 0)
                val raw = store.load(page.id)!!.blocks.single().content
                val before = TableEditing.read(raw)
                assertEquals(3, before.rows.size); assertEquals(3, before.rows[0].size); assertTrue(before.rows[0].all { it!!.header })
                val updated = InlineEditing.replace(before.rows[0][1]!!.paragraphs.single()!!, 0, 0, "Name")
                store.editList(page.id, "table", 1) { TableEditing.replaceParagraph(it, 0, 1, 0, updated) }
                assertTrue(runCatching { store.editList(page.id, "table", 1) { TableEditing.appendRow(it) } }.exceptionOrNull() is ContentConflict)
                store.editList(page.id, "table", 2) { TableEditing.appendRow(it) }
                store.editList(page.id, "table", 3) { TableEditing.appendColumn(it) }
                val after = TableEditing.read(store.load(page.id)!!.blocks.single().content)
                assertEquals(4, after.rows.size); assertTrue(after.rows.all { it.size == 4 })
                assertEquals("Name", InlineEditing.text(after.rows[0][1]!!.paragraphs.single()!!))
                assertTrue(after.rows[0][3]!!.header); assertFalse(after.rows[3][3]!!.header)
            }
            ContentStore(context, name).use { store -> assertEquals(4, TableEditing.read(store.load(store.list().single().id)!!.blocks.single().content).rows.size) }
        } finally { context.deleteDatabase(name) }
    }
    @Test fun selectedRowAndColumnActionsPreserveNeighborsAndRemoveLastTable() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "table-actions-${UUID.randomUUID()}.db"
        try {
            ContentStore(context, name).use { store ->
                val page = store.create("page", "Actions")
                val raw = """{"type":"table","attrs":{"keep":7},"content":[{"type":"tableRow","attrs":{"rowId":"header"},"content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"A"}]}]},{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"B"}]}]}]},{"type":"tableRow","attrs":{"rowId":"body"},"content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"C"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"D"}]}]}]}]}"""
                val neighbor = """{"type":"paragraph","content":[{"type":"text","text":"Keep"}]}"""
                store.saveBlocks(page.id, 0, listOf(ContentBlock("table", raw), ContentBlock("neighbor", neighbor)))
                store.changeTable(page.id, "table", 1, "insert_row", 0, 0)
                store.changeTable(page.id, "table", 2, "insert_column", 1, 0)
                val inserted = JSONObject(store.load(page.id)!!.blocks[0].content)
                assertEquals(7, inserted.getJSONObject("attrs").getInt("keep"))
                assertEquals("header", inserted.getJSONArray("content").getJSONObject(0).getJSONObject("attrs").getString("rowId"))
                assertEquals("body", inserted.getJSONArray("content").getJSONObject(2).getJSONObject("attrs").getString("rowId"))
                assertEquals(3, TableEditing.read(inserted.toString()).rows.size)
                assertTrue(TableEditing.read(inserted.toString()).rows[0][1]!!.header)
                assertFalse(TableEditing.read(inserted.toString()).rows[1][1]!!.header)
                assertTrue(runCatching { store.changeTable(page.id, "table", 2, "remove_row", 0, 0) }.exceptionOrNull() is ContentConflict)
                store.changeTable(page.id, "table", 3, "remove_row", 1, 0)
                store.changeTable(page.id, "table", 4, "remove_column", 0, 1)
                val restored = TableEditing.read(store.load(page.id)!!.blocks[0].content)
                assertEquals("A", InlineEditing.text(restored.rows[0][0]!!.paragraphs.single()!!))
                assertEquals("D", InlineEditing.text(restored.rows[1][1]!!.paragraphs.single()!!))
                store.changeTable(page.id, "table", 5, "remove_row", 1, 0)
                store.changeTable(page.id, "table", 6, "remove_row", 0, 0)
                assertEquals(listOf("neighbor"), store.load(page.id)!!.blocks.map { it.id })
            }
        } finally { context.deleteDatabase(name) }
    }

    @Test fun removingLastColumnRemovesTableAndInvalidShapesRejectStructuralActions() {
        val one = """{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph"}]}]}]}"""
        assertNull(TableEditing.removeColumn(one, 0)); assertNull(TableEditing.removeRow(one, 0))
        assertTrue(runCatching { TableEditing.insertRowAfter(one, -1) }.isFailure)
        val merged = one.replace("\"type\":\"tableCell\"", "\"type\":\"tableCell\",\"attrs\":{\"rowspan\":2}")
        assertTrue(runCatching { TableEditing.removeColumn(merged, 0) }.isFailure)
        assertTrue(runCatching { TableEditing.insertColumnAfter(merged, 0) }.isFailure)
    }

    @Test fun mergedAndUnknownContentIsPreservedAndCannotBeResized() {
        val raw = """{"type":"table","attrs":{"custom":8},"content":[{"type":"tableRow","content":[{"type":"tableCell","attrs":{"colspan":2,"keep":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"Hello","marks":[{"type":"bold"}]}]},{"type":"unknown","attrs":{"keep":true}}]}]}]}"""
        val table = TableEditing.read(raw); assertFalse(table.canResize); assertTrue(table.rows[0][0]!!.spanned)
        assertTrue(runCatching { TableEditing.appendRow(raw) }.isFailure)
        assertFalse(TableEditing.read(raw.replace("\"colspan\":2", "\"colspan\":1.5")).canResize)
        assertFalse(TableEditing.read(raw.replace("\"attrs\":{\"colspan\":2,\"keep\":true}", "\"attrs\":\"invalid\"")).canResize)
        val paragraph = InlineEditing.replace(table.rows[0][0]!!.paragraphs[0]!!, 0, 5, "World")
        val changed = JSONObject(TableEditing.replaceParagraph(raw, 0, 0, 0, paragraph))
        val cell = changed.getJSONArray("content").getJSONObject(0).getJSONArray("content").getJSONObject(0)
        assertEquals(2, cell.getJSONObject("attrs").getInt("colspan")); assertTrue(cell.getJSONArray("content").getJSONObject(1).getJSONObject("attrs").getBoolean("keep"))
        assertTrue(InlineEditing.hasMark(TableEditing.read(changed.toString()).rows[0][0]!!.paragraphs[0]!!, 0, 5, "bold"))
    }
}
