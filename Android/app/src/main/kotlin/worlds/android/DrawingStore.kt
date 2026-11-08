package worlds.android

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import worlds.content.ContentStore
import worlds.stylus.StrokeBrush
import worlds.stylus.StrokeGeometry
import worlds.stylus.StrokeSample
import java.util.UUID
import java.io.InputStream
import kotlin.math.max
import kotlin.math.min

/** Local drawing journal. Only drawings created by this store are currently editable. */
internal class DrawingStore(context: Context, name: String = "worlds-drawings.db") : SQLiteOpenHelper(context, name, null, 1) {
    override fun onCreate(db: SQLiteDatabase) { db.execSQL("CREATE TABLE drawings (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL)") }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { error("Unsupported drawing database migration") }

    fun loadOrCreate(id: String, content: ContentStore? = null, imported: Boolean = false): JSONObject {
        // The staging copy remains durable until the drawing database transaction commits.
        val staged = if (imported) requireNotNull(content).pendingDrawing(id) else null
        val result = transaction {
            find(id) ?: (staged?.let { JSONObject(it) } ?: run {
                check(!imported) { "Imported drawing is missing" }
                initial(id)
            }).also { doc ->
                insertOrThrow("drawings", null, ContentValues().apply { put("id", id); put("revision", doc.getInt("revision")); put("document", doc.toString()) })
            }
        }
        if (staged != null) requireNotNull(content).clearPendingDrawing(id)
        return result
    }

    /** Stage a validated project under a new ID. Existing drawings can never be replaced. */
    fun importPackage(id: String, input: InputStream): JSONObject {
        require(id.isNotBlank())
        val document = DrawingPackage.decode(input)
        val doc = JSONObject(document)
        transaction {
            insertOrThrow("drawings", null, ContentValues().apply {
                put("id", id); put("revision", doc.getInt("revision")); put("document", document)
            })
        }
        return doc
    }

    fun addStroke(id: String, revision: Int, samples: List<StrokeSample>, brush: StrokeBrush, erase: Boolean, color: String = "#202023"): JSONObject = transaction {
        val doc = checked(id, revision)
        require(samples.isNotEmpty())
        val b = brush.normalized()
        require(b.kind in setOf("hard", "marker", "highlighter", "natural-pencil")) { "Brush renderer is not supported" }
        require(!erase || b.kind == "hard") { "Eraser brush is not supported" }
        require(COLOR.matches(color)) { "Color is not supported" }
        StrokeGeometry.requireBudget(samples, b)
        val scene = doc.getJSONObject("scene")
        val node = strokeNode(scene, samples, b, erase, color)
        val opId = UUID.randomUUID().toString()
        val order = JSONArray(scene.getJSONArray("nodeOrder").toString()).put(node.getString("id"))
        val changes = JSONArray().put(JSONObject().put("type", "put").put("collection", "nodes").put("id", node.getString("id")).put("value", node))
            .put(JSONObject().put("type", "order").put("list", "nodeOrder").put("ids", order))
        val op = JSONObject().put("id", opId).put("actor", ACTOR).put("base", revision).put("at", System.currentTimeMillis())
            .put("label", if (erase) "Erase" else "Stroke").put("type", "edit").put("changes", changes)
        doc.getJSONArray("operations").put(op)
        scene.getJSONObject("nodes").put(node.getString("id"), node)
        scene.put("nodeOrder", order)
        // Never commit a stroke that the current renderer cannot reopen.
        DrawingInk.parse(doc.toString())
        save(id, revision, doc)
    }

    fun moveStroke(id: String, revision: Int, nodeId: String, dx: Double, dy: Double): JSONObject = moveStrokes(id, revision, setOf(nodeId), dx, dy)

    /** Duplicate in scene order as one journal edit so a group can be undone together. */
    fun duplicateStrokes(id: String, revision: Int, nodeIds: Set<String>): Pair<JSONObject, Set<String>> = transaction {
        require(nodeIds.isNotEmpty() && nodeIds.size <= 1000)
        val doc = checked(id, revision); val scene = doc.getJSONObject("scene")
        val nodes = scene.getJSONObject("nodes"); val order = scene.getJSONArray("nodeOrder")
        val sourceIds = (0 until order.length()).map { order.getString(it) }.filter { it in nodeIds }
        require(sourceIds.size == nodeIds.size)
        val next = JSONArray(order.toString()); val changes = JSONArray(); val copies = linkedSetOf<String>()
        sourceIds.forEach { sourceId ->
            val source = nodes.getJSONObject(sourceId)
            require(source.getString("kind") == "stroke" && !source.optBoolean("erase") && !source.optBoolean("locked"))
            val x = source.getDouble("x") + 24.0; val y = source.getDouble("y") + 24.0
            require(x.isFinite() && y.isFinite() && x in -1e7..1e7 && y in -1e7..1e7)
            val copyId = UUID.randomUUID().toString()
            val copy = JSONObject(source.toString()).put("id", copyId).put("x", x).put("y", y)
            nodes.put(copyId, copy); next.put(copyId); copies.add(copyId)
            changes.put(JSONObject().put("type", "put").put("collection", "nodes").put("id", copyId).put("value", copy))
        }
        changes.put(JSONObject().put("type", "order").put("list", "nodeOrder").put("ids", next))
        val op = JSONObject().put("id", UUID.randomUUID().toString()).put("actor", ACTOR).put("base", revision).put("at", System.currentTimeMillis())
            .put("label", if (copies.size == 1) "Duplicate stroke" else "Duplicate strokes").put("type", "edit").put("changes", changes)
        doc.getJSONArray("operations").put(op); scene.put("nodeOrder", next)
        DrawingInk.parse(doc.toString())
        save(id, revision, doc) to copies
    }

    fun moveStrokes(id: String, revision: Int, nodeIds: Set<String>, dx: Double, dy: Double): JSONObject = transaction {
        require(dx.isFinite() && dy.isFinite() && (dx != 0.0 || dy != 0.0))
        require(nodeIds.isNotEmpty() && nodeIds.size <= 1000)
        val doc = checked(id, revision); val scene = doc.getJSONObject("scene")
        val nodes = scene.getJSONObject("nodes"); val changes = JSONArray()
        nodeIds.sorted().forEach { nodeId ->
            val node = nodes.getJSONObject(nodeId)
            require(node.getString("kind") == "stroke" && !node.optBoolean("erase") && !node.optBoolean("locked"))
            val x = node.getDouble("x") + dx; val y = node.getDouble("y") + dy
            require(x.isFinite() && y.isFinite() && x in -1e7..1e7 && y in -1e7..1e7)
            changes.put(JSONObject().put("type", "patch").put("collection", "nodes").put("id", nodeId).put("fields", JSONObject().put("x", x).put("y", y)))
            node.put("x", x).put("y", y)
        }
        val op = JSONObject().put("id", UUID.randomUUID().toString()).put("actor", ACTOR).put("base", revision).put("at", System.currentTimeMillis())
            .put("label", if (nodeIds.size == 1) "Move stroke" else "Move strokes").put("type", "edit").put("changes", changes)
        doc.getJSONArray("operations").put(op)
        DrawingInk.parse(doc.toString())
        save(id, revision, doc)
    }

    fun removeStroke(id: String, revision: Int, nodeId: String): JSONObject = removeStrokes(id, revision, setOf(nodeId))

    fun removeStrokes(id: String, revision: Int, nodeIds: Set<String>): JSONObject = transaction {
        require(nodeIds.isNotEmpty() && nodeIds.size <= 1000)
        val doc = checked(id, revision); val scene = doc.getJSONObject("scene")
        val nodes = scene.getJSONObject("nodes")
        nodeIds.forEach { nodeId -> val node = nodes.getJSONObject(nodeId); require(node.getString("kind") == "stroke" && !node.optBoolean("erase") && !node.optBoolean("locked")) }
        val order = scene.getJSONArray("nodeOrder")
        val next = JSONArray(); for (i in 0 until order.length()) if (order.getString(i) !in nodeIds) next.put(order.getString(i))
        require(next.length() + nodeIds.size == order.length())
        val changes = JSONArray(); nodeIds.sorted().forEach { changes.put(JSONObject().put("type", "remove").put("collection", "nodes").put("id", it)) }
        changes.put(JSONObject().put("type", "order").put("list", "nodeOrder").put("ids", next))
        val op = JSONObject().put("id", UUID.randomUUID().toString()).put("actor", ACTOR).put("base", revision).put("at", System.currentTimeMillis())
            .put("label", if (nodeIds.size == 1) "Remove stroke" else "Remove strokes").put("type", "edit").put("changes", changes)
        doc.getJSONArray("operations").put(op); nodeIds.forEach { nodes.remove(it) }; scene.put("nodeOrder", next)
        DrawingInk.parse(doc.toString())
        save(id, revision, doc)
    }

    fun toggle(id: String, revision: Int, redo: Boolean): JSONObject = transaction {
        val doc = checked(id, revision)
        val operations = doc.getJSONArray("operations")
        val enabled = enabled(operations)
        val edits = (0 until operations.length()).map { operations.getJSONObject(it) }.filter { it.optString("type") == "edit" && it.optString("actor") == ACTOR }
        val target = if (!redo) edits.lastOrNull { enabled[it.getString("id")] != false } else {
            var found: JSONObject? = null
            for (i in operations.length() - 1 downTo 0) {
                val op = operations.getJSONObject(i)
                if (op.optString("actor") != ACTOR) continue
                if (op.getString("type") == "edit") break
                val targetId = op.getString("target")
                if (!op.getBoolean("enabled") && enabled[targetId] == false) { found = edits.firstOrNull { it.getString("id") == targetId }; break }
            }
            found
        }
        requireNotNull(target) { "No operation available" }
        operations.put(JSONObject().put("id", UUID.randomUUID().toString()).put("actor", ACTOR).put("base", revision)
            .put("at", System.currentTimeMillis()).put("label", if (redo) "Redo" else "Undo").put("type", "toggle").put("target", target.getString("id")).put("enabled", redo))
        val flags = enabled(operations)
        val allEdits = (0 until operations.length()).map { operations.getJSONObject(it) }.filter { it.getString("type") == "edit" }
        val scene = DrawingPackage.replay(doc.getJSONObject("seed"), allEdits, flags)
        doc.put("scene", scene)
        save(id, revision, doc)
    }

    private fun enabled(operations: JSONArray): Map<String, Boolean> {
        val flags = mutableMapOf<String, Boolean>()
        for (i in 0 until operations.length()) {
            val op = operations.getJSONObject(i)
            if (op.getString("type") == "edit") flags[op.getString("id")] = true
            else if (op.getString("type") == "toggle") flags[op.getString("target")] = op.getBoolean("enabled")
            else error("Unsupported drawing operation")
        }
        return flags
    }
    private fun SQLiteDatabase.find(id: String): JSONObject? {
        val length = rawQuery("SELECT length(document) FROM drawings WHERE id=?", arrayOf(id)).use { if (it.moveToFirst()) it.getInt(0) else return null }
        val document = StringBuilder(length)
        var offset = 1
        while (offset <= length) {
            val part = rawQuery("SELECT substr(document,?,?) FROM drawings WHERE id=?", arrayOf(offset.toString(), "100000", id)).use {
                check(it.moveToFirst()) { "Drawing changed" }; it.getString(0)
            }
            check(part.isNotEmpty()) { "Drawing is incomplete" }
            document.append(part)
            offset += part.codePointCount(0, part.length)
        }
        return JSONObject(document.toString())
    }
    private fun SQLiteDatabase.checked(id: String, revision: Int): JSONObject {
        val doc = requireNotNull(find(id)) { "Drawing missing" }
        check(doc.getInt("revision") == revision) { "Drawing changed" }
        return doc
    }
    private fun SQLiteDatabase.save(id: String, revision: Int, doc: JSONObject): JSONObject {
        doc.put("revision", revision + 1)
        val changed = update("drawings", ContentValues().apply { put("revision", revision + 1); put("document", doc.toString()) }, "id=? AND revision=?", arrayOf(id, revision.toString()))
        check(changed == 1) { "Drawing changed" }
        return doc
    }
    private inline fun <T> transaction(block: SQLiteDatabase.() -> T): T {
        val db = writableDatabase; db.beginTransaction()
        try { val result = db.block(); db.setTransactionSuccessful(); return result } finally { db.endTransaction() }
    }
    companion object {
        private const val ACTOR = "android-local"
        private val COLOR = Regex("#[0-9a-fA-F]{6}")
        private fun initial(page: String): JSONObject {
            val f = "$page-frame"; val l = "$page-layer"
            val frame = JSONObject().put("id", f).put("name", "Frame 1").put("x", 0).put("y", 0).put("w", 1280).put("h", 720).put("background", "#ffffff").put("clip", true).put("status", "draft").put("exportScale", 1)
            val layer = JSONObject().put("id", l).put("name", "Layer 1").put("visible", true).put("locked", false).put("positionLocked", false).put("alphaLocked", false).put("opacity", 1).put("blend", "source-over").put("parentId", JSONObject.NULL)
            val seed = JSONObject().put("schema", 1).put("defaultFrameId", f).put("frames", JSONObject().put(f, frame)).put("frameOrder", JSONArray().put(f))
                .put("layers", JSONObject().put(l, layer)).put("layerOrder", JSONArray().put(l)).put("nodes", JSONObject()).put("nodeOrder", JSONArray())
                .put("assets", JSONObject()).put("masks", JSONObject()).put("steps", JSONObject()).put("stepOrder", JSONArray())
            return JSONObject().put("revision", 0).put("seed", seed).put("scene", JSONObject(seed.toString())).put("operations", JSONArray())
        }
        private fun strokeNode(scene: JSONObject, samples: List<StrokeSample>, brush: StrokeBrush, erase: Boolean, color: String): JSONObject {
            val padding = brush.size / 2 + if (brush.kind == "natural-pencil") max(0.3, brush.size * 0.065) + 2 else 2.0
            val left = samples.minOf { it.x } - padding; val top = samples.minOf { it.y } - padding
            val width = max(1.0, samples.maxOf { it.x } - left + padding); val height = max(1.0, samples.maxOf { it.y } - top + padding)
            val nodeId = UUID.randomUUID().toString()
            val paint = JSONObject().put("fill", "transparent").put("stroke", "#202023").put("strokeWidth", 3).put("dash", JSONArray()).put("cap", "round").put("radius", 16)
            val text = JSONObject().put("font", "IBM Plex Sans Arabic").put("size", 28).put("weight", 400).put("italic", false).put("align", "start").put("direction", "auto").put("leading", 1.7).put("background", "transparent").put("color", "#202023").put("border", "transparent").put("resizeMode", "wrap")
            val style = JSONObject().put("kind", brush.kind).put("size", brush.size).put("opacity", brush.opacity).put("flow", brush.flow).put("hardness", 1)
                .put("spacing", brush.spacing).put("angle", brush.angle).put("roundness", brush.roundness).put("smoothing", brush.smoothing).put("stabilizer", brush.stabilizer)
                .put("taperStart", brush.taperStart).put("taperEnd", brush.taperEnd).put("pressureSize", brush.pressureSize).put("pressureOpacity", brush.pressureOpacity)
                .put("pressureFlow", brush.pressureFlow).put("pressureCurve", brush.pressureCurve).put("color", color)
            if (brush.straightLine) style.put("straightLine", true)
            val points = JSONArray()
            for (p in samples) points.put(JSONObject().put("x", p.x - left).put("y", p.y - top).put("pressure", p.pressure).put("tiltX", p.tiltX).put("tiltY", p.tiltY).put("time", p.time))
            return JSONObject().put("id", nodeId).put("kind", "stroke").put("name", "stroke").put("layerId", scene.getJSONArray("layerOrder").getString(0))
                .put("frameId", scene.getString("defaultFrameId")).put("groupId", JSONObject.NULL).put("visible", true).put("locked", false).put("rotation", 0).put("opacity", 1).put("flipX", false).put("flipY", false)
                .put("paint", paint).put("textStyle", text).put("effects", JSONArray()).put("x", left).put("y", top).put("w", width).put("h", height)
                .put("brush", style).put("samples", points).put("erase", erase).put("seed", 1)
        }
    }
}
