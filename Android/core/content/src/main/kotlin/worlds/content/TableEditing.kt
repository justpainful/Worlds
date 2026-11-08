package worlds.content

import org.json.JSONArray
import org.json.JSONObject

/** Operations on ProseMirror tables. Unsupported nodes are retained in their original positions. */
object TableEditing {
    data class Cell(val header: Boolean, val paragraphs: List<String?>, val spanned: Boolean)
    data class Table(val rows: List<List<Cell?>>, val canResize: Boolean, val canAddRow: Boolean, val canAddColumn: Boolean)
    private const val MAX_ROWS = 100
    private const val MAX_COLUMNS = 30
    private const val MAX_CELLS = 1500

    fun read(raw: String): Table {
        val root = JSONObject(raw); require(root.optString("type") == "table")
        val rows = root.getJSONArray("content"); require(rows.length() <= MAX_ROWS)
        var count = 0
        val result = (0 until rows.length()).map { r ->
            val row = rows.optJSONObject(r)
            val cells = if (row?.optString("type") == "tableRow") row.optJSONArray("content") else null
            if (cells == null) listOf(null) else {
                require(cells.length() <= MAX_COLUMNS); count += cells.length(); require(count <= MAX_CELLS)
                (0 until cells.length()).map { c ->
                    val cell = cells.optJSONObject(c)
                    if (cell?.optString("type") !in setOf("tableHeader", "tableCell")) null else {
                        val attrs = cell!!.optJSONObject("attrs")
                        val span = (cell.has("attrs") && !cell.isNull("attrs") && attrs == null) || listOf("colspan", "rowspan").any { key ->
                            attrs != null && attrs.has(key) && !attrs.isNull(key) && ((attrs.opt(key) as? Number)?.toDouble() != 1.0)
                        }
                        val children = cell.optJSONArray("content")
                        val paragraphs = if (children == null || children.length() == 0) listOf(null) else {
                            require(children.length() <= MAX_CELLS)
                            (0 until children.length()).map { i -> children.optJSONObject(i)?.takeIf { it.optString("type") == "paragraph" }?.toString() }
                        }
                        Cell(cell.optString("type") == "tableHeader", paragraphs, span)
                    }
                }
            }
        }
        val columns = result.firstOrNull()?.size ?: 0
        val canResize = result.isNotEmpty() && columns > 0 && result.all { row -> row.size == columns && row.all { it != null && !it.spanned } }
        return Table(result, canResize, canResize && result.size < MAX_ROWS && (result.size + 1) * columns <= MAX_CELLS,
            canResize && columns < MAX_COLUMNS && result.size * (columns + 1) <= MAX_CELLS)
    }

    fun create(id: String): String {
        require(id.isNotBlank())
        val rows = JSONArray()
        repeat(3) { r ->
            val cells = JSONArray(); repeat(3) { cells.put(cell(r == 0)) }
            rows.put(JSONObject().put("type", "tableRow").put("content", cells))
        }
        return JSONObject().put("type", "table").put("attrs", JSONObject().put("bid", id)).put("content", rows).toString()
    }

    fun replaceParagraph(raw: String, row: Int, column: Int, index: Int, paragraph: String): String {
        val table = read(raw)
        val original = table.rows.getOrNull(row)?.getOrNull(column) ?: throw IllegalArgumentException("Invalid cell")
        require(original.paragraphs.getOrNull(index) != null)
        val value = JSONObject(paragraph); require(value.optString("type") == "paragraph"); InlineEditing.text(paragraph)
        val root = JSONObject(raw)
        root.getJSONArray("content").getJSONObject(row).getJSONArray("content").getJSONObject(column).getJSONArray("content").put(index, value)
        return root.toString()
    }

    fun appendRow(raw: String): String {
        val table = read(raw); require(table.canResize && table.rows.size < MAX_ROWS)
        val columns = table.rows.first().size; require((table.rows.size + 1) * columns <= MAX_CELLS)
        val cells = JSONArray(); repeat(columns) { cells.put(cell(false)) }
        val root = JSONObject(raw); root.getJSONArray("content").put(JSONObject().put("type", "tableRow").put("content", cells))
        return root.toString()
    }

    fun appendColumn(raw: String): String {
        val table = read(raw); require(table.canResize && table.rows.first().size < MAX_COLUMNS)
        require(table.rows.size * (table.rows.first().size + 1) <= MAX_CELLS)
        val root = JSONObject(raw); val rows = root.getJSONArray("content")
        for (r in 0 until rows.length()) {
            val header = table.rows[r].all { it?.header == true }
            rows.getJSONObject(r).getJSONArray("content").put(cell(header))
        }
        return root.toString()
    }

    /** Insert after the selected row while retaining every existing row and cell. */
    fun insertRowAfter(raw: String, row: Int): String {
        val table = read(raw); require(table.canAddRow && row in table.rows.indices)
        val reference = table.rows.getOrNull(row + 1) ?: table.rows[row]
        val cells = JSONArray(); reference.forEach { cells.put(cell(it!!.header)) }
        val root = JSONObject(raw); val rows = root.getJSONArray("content")
        root.put("content", insert(rows, row + 1, JSONObject().put("type", "tableRow").put("content", cells)))
        return root.toString()
    }

    fun insertColumnAfter(raw: String, column: Int): String {
        val table = read(raw); require(table.canAddColumn && column in table.rows.first().indices)
        val root = JSONObject(raw); val rows = root.getJSONArray("content")
        for (r in 0 until rows.length()) {
            val row = rows.getJSONObject(r); val cells = row.getJSONArray("content")
            row.put("content", insert(cells, column + 1, cell(table.rows[r][column]!!.header)))
        }
        return root.toString()
    }

    /** Null means removing the final row or column removes the table block. */
    fun removeRow(raw: String, row: Int): String? {
        val table = read(raw); require(table.canResize && row in table.rows.indices)
        if (table.rows.size == 1) return null
        val root = JSONObject(raw); root.getJSONArray("content").remove(row); return root.toString()
    }

    fun removeColumn(raw: String, column: Int): String? {
        val table = read(raw); require(table.canResize && column in table.rows.first().indices)
        if (table.rows.first().size == 1) return null
        val root = JSONObject(raw); val rows = root.getJSONArray("content")
        for (r in 0 until rows.length()) rows.getJSONObject(r).getJSONArray("content").remove(column)
        return root.toString()
    }

    private fun insert(source: JSONArray, at: Int, value: JSONObject): JSONArray {
        require(at in 0..source.length())
        val result = JSONArray()
        for (i in 0..source.length()) {
            if (i == at) result.put(value)
            if (i < source.length()) result.put(source.get(i))
        }
        return result
    }

    private fun cell(header: Boolean) = JSONObject().put("type", if (header) "tableHeader" else "tableCell")
        .put("content", JSONArray().put(JSONObject().put("type", "paragraph")))
}
