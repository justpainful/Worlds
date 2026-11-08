package worlds.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.BitmapFactory
import android.graphics.Color
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import worlds.stylus.StrokeBrush
import worlds.stylus.StrokeSample
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class DrawingStoreTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "draw-test-${UUID.randomUUID()}.db"
    private lateinit var store: DrawingStore
    private fun point(x: Double) = StrokeSample(x, 30.0, 0.6, 0.0, 0.0, x)
    @Before fun setup() { store = DrawingStore(context, name) }
    @After fun cleanup() { store.close(); context.deleteDatabase(name) }

    @Test fun duplicatesSelectedStrokesAsOneReversibleCompatibleEdit() {
        store.loadOrCreate("copies")
        store.addStroke("copies", 0, listOf(point(10.0), point(50.0)), StrokeBrush(size = 8.0), false, "#ff0000")
        val original = store.addStroke("copies", 1, listOf(point(90.0), point(120.0)), StrokeBrush(kind = "natural-pencil"), false)
        val scene = original.getJSONObject("scene"); val order = scene.getJSONArray("nodeOrder")
        val ids = setOf(order.getString(0), order.getString(1))
        assertTrue(runCatching { store.duplicateStrokes("copies", 1, ids) }.isFailure)
        assertTrue(runCatching { store.duplicateStrokes("copies", 2, ids + "missing") }.isFailure)
        assertEquals(original.toString(), store.loadOrCreate("copies").toString())
        val (duplicated, copies) = store.duplicateStrokes("copies", 2, ids)
        val next = duplicated.getJSONObject("scene"); val nextOrder = next.getJSONArray("nodeOrder")
        assertEquals(4, nextOrder.length()); assertEquals(copies, setOf(nextOrder.getString(2), nextOrder.getString(3)))
        repeat(2) { i ->
            val source = scene.getJSONObject("nodes").getJSONObject(order.getString(i))
            val copy = next.getJSONObject("nodes").getJSONObject(nextOrder.getString(i + 2))
            assertEquals(source.getDouble("x") + 24, copy.getDouble("x"), 0.0)
            assertEquals(source.getDouble("y") + 24, copy.getDouble("y"), 0.0)
            assertEquals(source.getJSONObject("brush").toString(), copy.getJSONObject("brush").toString())
            assertEquals(source.getJSONArray("samples").toString(), copy.getJSONArray("samples").toString())
        }
        assertTrue(DrawingPackage.equalJson(duplicated, org.json.JSONObject(DrawingPackage.decode(DrawingPackage.encode(duplicated.toString()).inputStream()))))
        val corrupt = org.json.JSONObject(duplicated.toString())
        val changes = corrupt.getJSONArray("operations").getJSONObject(2).getJSONArray("changes")
        changes.put(1, org.json.JSONObject(changes.getJSONObject(0).toString()))
        assertTrue(runCatching { DrawingPackage.encode(corrupt.toString()) }.isFailure)
        val undo = store.toggle("copies", 3, false)
        assertTrue(DrawingPackage.equalJson(scene, undo.getJSONObject("scene")))
        val redo = store.toggle("copies", 4, true)
        assertTrue(DrawingPackage.equalJson(next, redo.getJSONObject("scene")))
        val folder = context.getExternalFilesDir(null)!!
        folder.resolve("android-drawing-duplicate-contract.json").writeText(redo.toString())
        folder.resolve("android-drawing-duplicate.worldsdraw").writeBytes(DrawingPackage.encode(redo.toString()))
    }

    @Test fun persistsStrokesAndReplaysUndoRedoWithRevisionProtection() {
        val initial = store.loadOrCreate("drawing-test")
        assertEquals(0, initial.getInt("revision"))
        val first = store.addStroke("drawing-test", 0, listOf(point(10.0), point(50.0)), StrokeBrush(size = 8.0), false)
        val second = store.addStroke("drawing-test", 1, listOf(point(25.0)), StrokeBrush(size = 24.0), true)
        assertEquals(2, second.getJSONObject("scene").getJSONArray("nodeOrder").length())
        assertTrue(runCatching { store.addStroke("drawing-test", 1, listOf(point(1.0)), StrokeBrush(), false) }.isFailure)
        val undo = store.toggle("drawing-test", 2, false)
        assertEquals(1, undo.getJSONObject("scene").getJSONArray("nodeOrder").length())
        val redo = store.toggle("drawing-test", 3, true)
        assertEquals(second.getJSONObject("scene").toString(), redo.getJSONObject("scene").toString())
        assertEquals(4, store.loadOrCreate("drawing-test").getInt("revision"))
        val sample = first.getJSONObject("scene").getJSONObject("nodes").getJSONObject(first.getJSONObject("scene").getJSONArray("nodeOrder").getString(0)).getJSONArray("samples").getJSONObject(0)
        assertEquals(0.6, sample.getDouble("pressure"), 0.0)
        context.getExternalFilesDir(null)!!.resolve("android-drawing-contract.json").writeText(redo.toString())
    }

    @Test fun groupedStrokeOperationsUndoRedoAndRoundTripAtomically() {
        store.loadOrCreate("group")
        store.addStroke("group", 0, listOf(point(10.0), point(50.0)), StrokeBrush(), false)
        val added = store.addStroke("group", 1, listOf(point(90.0), point(120.0)), StrokeBrush(), false)
        val order = added.getJSONObject("scene").getJSONArray("nodeOrder"); val ids = setOf(order.getString(0), order.getString(1))
        val original = org.json.JSONObject(added.getJSONObject("scene").toString())
        val moved = store.moveStrokes("group", 2, ids, 60.0, 25.0)
        ids.forEach { id ->
            assertEquals(original.getJSONObject("nodes").getJSONObject(id).getDouble("x") + 60, moved.getJSONObject("scene").getJSONObject("nodes").getJSONObject(id).getDouble("x"), 0.0)
        }
        assertEquals(2, moved.getJSONArray("operations").getJSONObject(2).getJSONArray("changes").length())
        val duplicatePatch = org.json.JSONObject(moved.toString())
        val badPatches = duplicatePatch.getJSONArray("operations").getJSONObject(2).getJSONArray("changes")
        badPatches.put(1, org.json.JSONObject(badPatches.getJSONObject(0).toString()))
        assertTrue(runCatching { DrawingPackage.encode(duplicatePatch.toString()) }.isFailure)
        assertTrue(runCatching { store.moveStrokes("group", 3, ids + "missing", 1.0, 1.0) }.isFailure)
        assertEquals(moved.toString(), store.loadOrCreate("group").toString())
        val undo = store.toggle("group", 3, false); assertTrue(DrawingPackage.equalJson(original, undo.getJSONObject("scene")))
        val redo = store.toggle("group", 4, true); assertTrue(DrawingPackage.equalJson(moved.getJSONObject("scene"), redo.getJSONObject("scene")))
        assertTrue(DrawingPackage.equalJson(redo, org.json.JSONObject(DrawingPackage.decode(DrawingPackage.encode(redo.toString()).inputStream()))))
        val removed = store.removeStrokes("group", 5, ids)
        assertEquals(0, removed.getJSONObject("scene").getJSONArray("nodeOrder").length())
        assertEquals(3, removed.getJSONArray("operations").getJSONObject(5).getJSONArray("changes").length())
        val duplicateRemove = org.json.JSONObject(removed.toString())
        val badRemovals = duplicateRemove.getJSONArray("operations").getJSONObject(5).getJSONArray("changes")
        badRemovals.put(1, org.json.JSONObject(badRemovals.getJSONObject(0).toString()))
        assertTrue(runCatching { DrawingPackage.encode(duplicateRemove.toString()) }.isFailure)
        assertTrue(DrawingPackage.equalJson(removed, org.json.JSONObject(DrawingPackage.decode(DrawingPackage.encode(removed.toString()).inputStream()))))
        val restore = store.toggle("group", 6, false); assertTrue(DrawingPackage.equalJson(redo.getJSONObject("scene"), restore.getJSONObject("scene")))
        val repeat = store.toggle("group", 7, true); assertTrue(DrawingPackage.equalJson(removed.getJSONObject("scene"), repeat.getJSONObject("scene")))
        assertTrue(DrawingPackage.equalJson(repeat, org.json.JSONObject(DrawingPackage.decode(DrawingPackage.encode(repeat.toString()).inputStream()))))
        val fixture = context.getExternalFilesDir(null)!!.resolve("android-group-drawing-contract.json")
        fixture.writeText(repeat.toString())
        android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${fixture.absolutePath} /sdcard/Download/android-group-drawing-contract.json")).use { it.readBytes() }
    }

    @Test fun movesStrokeWithDesktopJournalUndoRedoAndPortableHistory() {
        store.loadOrCreate("move")
        val added = store.addStroke("move", 0, listOf(point(10.0), point(50.0)), StrokeBrush(size = 8.0), false)
        val scene = added.getJSONObject("scene"); val id = scene.getJSONArray("nodeOrder").getString(0)
        val before = scene.getJSONObject("nodes").getJSONObject(id)
        val x = before.getDouble("x"); val y = before.getDouble("y")
        val moved = store.moveStroke("move", 1, id, 100.0, 20.0)
        val node = moved.getJSONObject("scene").getJSONObject("nodes").getJSONObject(id)
        assertEquals(x + 100, node.getDouble("x"), 0.0); assertEquals(y + 20, node.getDouble("y"), 0.0)
        assertEquals("patch", moved.getJSONArray("operations").getJSONObject(1).getJSONArray("changes").getJSONObject(0).getString("type"))
        assertTrue(runCatching { store.moveStroke("move", 1, id, 1.0, 1.0) }.isFailure)
        assertTrue(runCatching { store.moveStroke("move", 2, id, Double.NaN, 1.0) }.isFailure)
        val portable = DrawingPackage.decode(DrawingPackage.encode(moved.toString()).inputStream())
        assertTrue(DrawingPackage.equalJson(moved, org.json.JSONObject(portable)))
        val undo = store.toggle("move", 2, false)
        assertEquals(x, undo.getJSONObject("scene").getJSONObject("nodes").getJSONObject(id).getDouble("x"), 0.0)
        val redo = store.toggle("move", 3, true)
        assertEquals(x + 100, redo.getJSONObject("scene").getJSONObject("nodes").getJSONObject(id).getDouble("x"), 0.0)
        assertTrue(DrawingPackage.equalJson(redo, org.json.JSONObject(DrawingPackage.decode(DrawingPackage.encode(redo.toString()).inputStream()))))
        val fixture = context.getExternalFilesDir(null)!!.resolve("android-moved-drawing-contract.json")
        fixture.writeText(redo.toString())
        android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${fixture.absolutePath} /sdcard/Download/android-moved-drawing-contract.json")).use { it.readBytes() }
    }

    @Test fun removesStrokeAndRestoresItWithPortableDesktopHistory() {
        store.loadOrCreate("remove")
        val first = store.addStroke("remove", 0, listOf(point(10.0)), StrokeBrush(), false)
        val firstId = first.getJSONObject("scene").getJSONArray("nodeOrder").getString(0)
        val second = store.addStroke("remove", 1, listOf(point(50.0)), StrokeBrush(), false)
        val removed = store.removeStroke("remove", 2, firstId)
        assertEquals(1, removed.getJSONObject("scene").getJSONArray("nodeOrder").length())
        assertEquals("remove", removed.getJSONArray("operations").getJSONObject(2).getJSONArray("changes").getJSONObject(0).getString("type"))
        assertTrue(runCatching { store.removeStroke("remove", 2, firstId) }.isFailure)
        assertTrue(runCatching { store.removeStroke("remove", 3, firstId) }.isFailure)
        assertTrue(DrawingPackage.equalJson(removed, org.json.JSONObject(DrawingPackage.decode(DrawingPackage.encode(removed.toString()).inputStream()))))
        val undo = store.toggle("remove", 3, false)
        assertTrue(DrawingPackage.equalJson(second.getJSONObject("scene"), undo.getJSONObject("scene")))
        val redo = store.toggle("remove", 4, true)
        assertTrue(DrawingPackage.equalJson(removed.getJSONObject("scene"), redo.getJSONObject("scene")))
        assertTrue(DrawingPackage.equalJson(redo, org.json.JSONObject(DrawingPackage.decode(DrawingPackage.encode(redo.toString()).inputStream()))))
        val fixture = context.getExternalFilesDir(null)!!.resolve("android-removed-drawing-contract.json")
        fixture.writeText(redo.toString())
        android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${fixture.absolutePath} /sdcard/Download/android-removed-drawing-contract.json")).use { it.readBytes() }
    }

    @Test fun newEditClearsRedoAndFailedInputLeavesDocumentUnchanged() {
        store.loadOrCreate("d")
        store.addStroke("d", 0, listOf(point(0.0)), StrokeBrush(), false)
        store.toggle("d", 1, false)
        val newEdit = store.addStroke("d", 2, listOf(point(20.0)), StrokeBrush(), false)
        assertTrue(runCatching { store.toggle("d", 3, true) }.isFailure)
        assertTrue(runCatching { store.addStroke("d", 3, listOf(point(Double.NaN)), StrokeBrush(), false) }.isFailure)
        assertEquals(newEdit.toString(), store.loadOrCreate("d").toString())
    }

    @Test fun pngUsesFrameDimensionsAndPreservesInkAndEraser() {
        store.loadOrCreate("png")
        store.addStroke("png", 0, listOf(point(10.0), point(50.0)), StrokeBrush(size = 8.0), false)
        val doc = store.addStroke("png", 1, listOf(point(25.0)), StrokeBrush(size = 24.0), true)
        val png = DrawingInk.png(doc.toString())
        val bitmap = BitmapFactory.decodeByteArray(png, 0, png.size)
        try {
            assertEquals(1280, bitmap.width); assertEquals(720, bitmap.height)
            assertEquals(Color.WHITE, bitmap.getPixel(25, 30))
            val ink = bitmap.getPixel(45, 30)
            assertTrue(Color.red(ink) in 28..36 && Color.green(ink) in 28..36 && Color.blue(ink) in 31..39)
            assertEquals(Color.WHITE, bitmap.getPixel(500, 500))
        } finally { bitmap.recycle() }
        context.getExternalFilesDir(null)!!.resolve("android-drawing-export.png").writeBytes(png)
        val scene = doc.getJSONObject("scene"); val nodes = scene.getJSONObject("nodes"); val firstId = scene.getJSONArray("nodeOrder").getString(0)
        nodes.getJSONObject(firstId).getJSONObject("brush").put("kind", "watercolor")
        assertTrue(runCatching { DrawingInk.png(doc.toString()) }.isFailure)
    }

    @Test fun coloredWidthsSurviveReloadUndoRedoAndPngExport() {
        store.loadOrCreate("colors")
        val blue = "#245b93"; val red = "#b33335"
        store.addStroke("colors", 0, listOf(StrokeSample(100.0, 100.0, 1.0, 0.0, 0.0, 0.0)), StrokeBrush(size = 40.0), false, blue)
        store.addStroke("colors", 1, listOf(StrokeSample(200.0, 100.0, 1.0, 0.0, 0.0, 1.0)), StrokeBrush(size = 8.0), false, red)
        store.toggle("colors", 2, false); store.toggle("colors", 3, true)
        val doc = store.loadOrCreate("colors")
        val strokes = DrawingInk.parse(doc.toString())
        assertEquals(listOf(Color.parseColor(blue), Color.parseColor(red)), strokes.map { it.color })
        assertEquals(listOf(40.0, 8.0), strokes.map { it.brush.size })
        val bytes = DrawingInk.png(doc.toString()); val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        try {
            assertEquals(Color.parseColor(blue), bitmap.getPixel(100, 100))
            assertEquals(Color.parseColor(red), bitmap.getPixel(200, 100))
            assertEquals(Color.WHITE, bitmap.getPixel(210, 100))
            assertEquals(Color.parseColor(blue), bitmap.getPixel(110, 100))
        } finally { bitmap.recycle() }
        assertTrue(runCatching { store.addStroke("colors", 4, listOf(point(0.0)), StrokeBrush(), false, "url(invalid)") }.isFailure)
        assertTrue(runCatching { store.addStroke("colors", 4, listOf(point(0.0)), StrokeBrush(flow = 0.5), false, blue) }.isFailure)
        assertEquals(4, store.loadOrCreate("colors").getInt("revision"))
        context.getExternalFilesDir(null)!!.resolve("android-colored-drawing-contract.json").writeText(doc.toString())
    }
    @Test fun readsLargeDocumentAcrossCursorWindows() {
        val doc = org.json.JSONObject().put("revision", 0).put("padding", "😀".repeat(650_000))
        store.writableDatabase.insertOrThrow("drawings", null, android.content.ContentValues().apply {
            put("id", "large"); put("revision", 0); put("document", doc.toString())
        })
        assertEquals(doc.getString("padding"), store.loadOrCreate("large").getString("padding"))
    }

    @Test fun pencilPersistsPressureTiltAndExportsThroughUndoRedo() {
        store.loadOrCreate("pencil")
        val points = listOf(StrokeSample(100.0, 100.0, 0.25, 45.0, 30.0, 0.0), StrokeSample(180.0, 100.0, 1.0, 45.0, 30.0, 10.0))
        val brush = worlds.stylus.pencilBrush(24.0, points.first())
        val doc = store.addStroke("pencil", 0, points, brush, false, "#245b93")
        val stroke = DrawingInk.parse(doc.toString()).single()
        assertEquals("natural-pencil", stroke.brush.kind); assertEquals(brush.roundness, stroke.brush.roundness, 0.0)
        assertEquals(45.0, stroke.samples.first().tiltX, 0.0); assertEquals(0.25, stroke.samples.first().pressure, 0.0)
        val first = DrawingInk.png(doc.toString()); val second = DrawingInk.png(store.loadOrCreate("pencil").toString())
        assertArrayEquals(first, second)
        val bitmap = BitmapFactory.decodeByteArray(first, 0, first.size)
        try {
            var painted = 0
            for (y in 85..115) for (x in 95..185) if (bitmap.getPixel(x, y) != Color.WHITE) painted++
            assertTrue(painted > 20)
        } finally { bitmap.recycle() }
        val encoded = DrawingPackage.encode(doc.toString())
        assertTrue(DrawingPackage.equalJson(doc, org.json.JSONObject(DrawingPackage.decode(encoded.inputStream()))))
        store.toggle("pencil", 1, false); assertTrue(DrawingInk.parse(store.loadOrCreate("pencil").toString()).isEmpty())
        store.toggle("pencil", 2, true); assertArrayEquals(first, DrawingInk.png(store.loadOrCreate("pencil").toString()))
    }

    @Test fun highlighterCompositesOnceAndPreservesImportedBrushSettings() {
        store.loadOrCreate("highlight")
        val points = listOf(StrokeSample(20.0, 100.0, 1.0, 0.0, 0.0, 0.0),
            StrokeSample(120.0, 100.0, 1.0, 0.0, 0.0, 10.0), StrokeSample(20.0, 100.0, 1.0, 0.0, 0.0, 20.0))
        val brush = StrokeBrush(kind = "highlighter", size = 20.0, opacity = 0.35, pressureSize = false)
        val doc = store.addStroke("highlight", 0, points, brush, false, "#e6c235")
        val strokes = DrawingInk.parse(doc.toString())
        assertEquals("highlighter", strokes.single().brush.kind); assertEquals(0.35, strokes.single().brush.opacity, 0.0)
        val image = DrawingInk.png(doc.toString()); val bitmap = BitmapFactory.decodeByteArray(image, 0, image.size)
        try {
            val center = bitmap.getPixel(70, 100)
            assertTrue(Color.red(center) in 244..248 && Color.green(center) in 232..236 && Color.blue(center) in 182..187)
            assertEquals(center, bitmap.getPixel(40, 100))
            assertEquals(Color.WHITE, bitmap.getPixel(15, 100))
            assertEquals(Color.WHITE, bitmap.getPixel(70, 112))
        } finally { bitmap.recycle() }
        val encoded = DrawingPackage.encode(doc.toString())
        val restored = org.json.JSONObject(DrawingPackage.decode(encoded.inputStream()))
        assertTrue(DrawingPackage.equalJson(doc, restored))
        store.toggle("highlight", 1, false)
        assertEquals(0, DrawingInk.parse(store.loadOrCreate("highlight").toString()).size)
        store.toggle("highlight", 2, true)
        assertEquals("highlighter", DrawingInk.parse(store.loadOrCreate("highlight").toString()).single().brush.kind)
        context.getExternalFilesDir(null)!!.resolve("android-highlighter.worldsdraw").writeBytes(encoded)
    }

    @Test fun markerAndHighlighterHaveDistinctCapsAndPressureGeometry() {
        store.loadOrCreate("caps")
        fun p(x: Double, y: Double, pressure: Double) = StrokeSample(x, y, pressure, 0.0, 0.0, x)
        store.addStroke("caps", 0, listOf(p(100.0, 100.0, 1.0), p(200.0, 100.0, 1.0)), StrokeBrush(kind="marker", size=20.0, pressureSize=false), false)
        val doc = store.addStroke("caps", 1, listOf(p(100.0, 200.0, 0.25), p(200.0, 200.0, 1.0)), StrokeBrush(kind="highlighter", size=40.0, pressureSize=true), false)
        val bytes = DrawingInk.png(doc.toString()); val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        try {
            assertNotEquals(Color.WHITE, bitmap.getPixel(93, 100))
            assertEquals(Color.WHITE, bitmap.getPixel(95, 200))
            assertEquals(Color.WHITE, bitmap.getPixel(110, 210))
            assertNotEquals(Color.WHITE, bitmap.getPixel(190, 210))
        } finally { bitmap.recycle() }
    }

}
