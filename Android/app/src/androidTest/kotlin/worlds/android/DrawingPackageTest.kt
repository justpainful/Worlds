package worlds.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import worlds.stylus.StrokeBrush
import worlds.stylus.StrokeSample
import java.io.ByteArrayInputStream
import java.util.UUID
import java.util.zip.GZIPInputStream

@RunWith(AndroidJUnit4::class)
class DrawingPackageTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "package-test-${UUID.randomUUID()}.db"
    private lateinit var store: DrawingStore
    @Before fun setup() { store = DrawingStore(context, name) }
    @After fun cleanup() { store.close(); context.deleteDatabase(name) }
    private fun point(x: Double) = StrokeSample(x, 30.0, 0.7, 0.0, 0.0, x)

    @Test fun exportsEditableWorldsPackageIncludingHistory() {
        store.loadOrCreate("package-drawing")
        store.addStroke("package-drawing", 0, listOf(point(20.0), point(100.0)), StrokeBrush(size = 16.0), false, "#245b93")
        store.addStroke("package-drawing", 1, listOf(point(50.0)), StrokeBrush(size = 24.0), true)
        store.toggle("package-drawing", 2, false)
        val doc = store.toggle("package-drawing", 3, true)
        val bytes = DrawingPackage.encode(doc.toString())
        val header = "WORLDSDRAW1\n".toByteArray(Charsets.UTF_8)
        assertArrayEquals(header, bytes.copyOfRange(0, header.size))
        val json = GZIPInputStream(ByteArrayInputStream(bytes, header.size, bytes.size - header.size)).bufferedReader(Charsets.UTF_8).use { it.readText() }
        val pack = JSONObject(json)
        assertEquals("worldsdraw", pack.getString("format")); assertEquals(2, pack.getInt("version"))
        assertEquals(4, pack.getJSONObject("history").getJSONArray("operations").length())
        assertTrue(DrawingPackage.equalJson(pack.getJSONObject("scene"), doc.getJSONObject("scene")))
        assertTrue(DrawingPackage.equalJson(pack.getJSONObject("history"), doc))
        context.getExternalFilesDir(null)!!.resolve("android-worlds-project.worldsdraw").writeBytes(bytes)
    }

    @Test fun importsHistoryAndContinuesEditingWithoutOverwritingAnExistingDrawing() {
        store.loadOrCreate("source")
        store.addStroke("source", 0, listOf(point(20.0)), StrokeBrush(), false)
        val source = store.toggle("source", 1, false)
        val bytes = DrawingPackage.encode(source.toString())
        val imported = store.importPackage("destination", ByteArrayInputStream(bytes))
        assertTrue(DrawingPackage.equalJson(source, imported))
        val restored = store.toggle("destination", 2, true)
        assertEquals(1, restored.getJSONObject("scene").getJSONArray("nodeOrder").length())
        store.addStroke("destination", 3, listOf(point(50.0)), StrokeBrush(), false)
        assertTrue(runCatching { store.importPackage("destination", ByteArrayInputStream(bytes)) }.isFailure)
        assertEquals(4, store.loadOrCreate("destination").getInt("revision"))
        assertTrue(DrawingPackage.equalJson(source, store.loadOrCreate("source")))
    }

    @Test fun rejectsUnsupportedOrCorruptPackagesWithoutCreatingDrawing() {
        val source = store.loadOrCreate("source")
        val encoded = DrawingPackage.encode(source.toString())
        fun packageBytes(change: (JSONObject) -> Unit): ByteArray {
            val header = "WORLDSDRAW1\n".toByteArray()
            val payload = JSONObject(GZIPInputStream(ByteArrayInputStream(encoded, header.size, encoded.size - header.size)).bufferedReader().use { it.readText() })
            change(payload)
            val out = java.io.ByteArrayOutputStream()
            out.write(header)
            java.util.zip.GZIPOutputStream(out).use { it.write(payload.toString().toByteArray()) }
            return out.toByteArray()
        }
        val invalid = listOf(
            byteArrayOf(1, 2, 3),
            encoded.copyOf(encoded.size - 4),
            packageBytes { it.put("preview", "would be lost") },
            packageBytes { it.getJSONArray("assets").put(JSONObject()) },
            packageBytes { it.getJSONObject("scene").put("schema", 9) },
            packageBytes { it.getJSONObject("history").put("revision", 99) },
        )
        invalid.forEachIndexed { index, bytes ->
            assertTrue("case $index", runCatching { store.importPackage("bad-$index", ByteArrayInputStream(bytes)) }.isFailure)
            assertEquals(0, store.readableDatabase.rawQuery("SELECT COUNT(*) FROM drawings WHERE id=?", arrayOf("bad-$index")).use { it.moveToFirst(); it.getInt(0) })
        }
    }

    @Test fun importsDesktopSceneAndPreservesItWhenUndoingAndroidEdits() {
        val asset = InstrumentationRegistry.getInstrumentation().context.assets.open("desktop-scene.worldsdraw")
        val imported = store.importPackage("desktop-scene", asset)
        assertEquals(0, imported.getInt("revision"))
        val originalOrder = imported.getJSONObject("scene").getJSONArray("nodeOrder").toString()
        assertEquals(2, imported.getJSONObject("scene").getJSONArray("nodeOrder").length())
        store.addStroke("desktop-scene", 0, listOf(point(10.0)), StrokeBrush(), false)
        val undone = store.toggle("desktop-scene", 1, false)
        assertEquals(originalOrder, undone.getJSONObject("scene").getJSONArray("nodeOrder").toString())
        val bytes = DrawingPackage.encode(undone.toString())
        assertTrue(DrawingPackage.equalJson(undone, JSONObject(DrawingPackage.decode(ByteArrayInputStream(bytes)))))
        context.getExternalFilesDir(null)!!.resolve("desktop-scene-after-android.worldsdraw").writeBytes(bytes)
    }

    @Test fun importsDesktopMultiAuthorHistoryAndReplaysOriginalOrdering() {
        val asset = InstrumentationRegistry.getInstrumentation().context.assets.open("desktop-history.worldsdraw")
        val imported = store.importPackage("desktop-history", asset)
        assertEquals(4, imported.getInt("revision"))
        assertEquals("desktop-alice", imported.getJSONArray("operations").getJSONObject(0).getString("actor"))
        assertEquals("desktop-bob", imported.getJSONArray("operations").getJSONObject(2).getString("actor"))
        val order = imported.getJSONObject("scene").getJSONArray("nodeOrder").toString()
        store.addStroke("desktop-history", 4, listOf(point(20.0)), StrokeBrush(), false)
        val undone = store.toggle("desktop-history", 5, false)
        assertEquals(order, undone.getJSONObject("scene").getJSONArray("nodeOrder").toString())
        val bytes = DrawingPackage.encode(undone.toString())
        assertTrue(DrawingPackage.equalJson(undone, JSONObject(DrawingPackage.decode(ByteArrayInputStream(bytes)))))
        context.getExternalFilesDir(null)!!.resolve("desktop-history-after-android.worldsdraw").writeBytes(bytes)
    }

    @Test fun importsDesktopHighlighterAndMarkerWithoutFlattening() {
        val asset = InstrumentationRegistry.getInstrumentation().context.assets.open("desktop-uniform.worldsdraw")
        val imported = store.importPackage("desktop-uniform", asset)
        val strokes = DrawingInk.parse(imported.toString())
        assertEquals(listOf("highlighter", "marker"), strokes.map { it.brush.kind })
        assertEquals(0.35, strokes[0].brush.opacity, 0.0)
        assertTrue(strokes[1].brush.straightLine)
        assertEquals(0.6, strokes[1].brush.flow, 0.0)
        store.addStroke("desktop-uniform", 2, listOf(point(50.0)), StrokeBrush(kind="highlighter", opacity=0.35, pressureSize=false), false)
        val undone = store.toggle("desktop-uniform", 3, false)
        assertEquals(2, DrawingInk.parse(undone.toString()).size)
        val encoded = DrawingPackage.encode(undone.toString())
        context.getExternalFilesDir(null)!!.resolve("desktop-uniform-after-android.worldsdraw").writeBytes(encoded)
        assertTrue(DrawingPackage.equalJson(undone, JSONObject(DrawingPackage.decode(ByteArrayInputStream(encoded)))))
    }

    @Test fun verifiesDesktopPreviewBeforeImport() {
        val original = InstrumentationRegistry.getInstrumentation().context.assets.open("desktop-scene.worldsdraw").readBytes()
        val header = "WORLDSDRAW1\n".toByteArray()
        val payload = JSONObject(GZIPInputStream(ByteArrayInputStream(original, header.size, original.size - header.size)).bufferedReader().use { it.readText() })
        val bitmap = android.graphics.Bitmap.createBitmap(2, 2, android.graphics.Bitmap.Config.ARGB_8888)
        val out = java.io.ByteArrayOutputStream()
        bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out); bitmap.recycle()
        val png = out.toByteArray()
        val digest = java.security.MessageDigest.getInstance("SHA-256").digest(png).joinToString("") { "%02x".format(it.toInt() and 255) }
        val preview = JSONObject().put("mime", "image/png").put("width", 2).put("height", 2).put("sha256", digest).put("data", android.util.Base64.encodeToString(png, android.util.Base64.NO_WRAP))
        payload.put("preview", preview)
        fun encode(): ByteArray {
            val result = java.io.ByteArrayOutputStream(); result.write(header)
            java.util.zip.GZIPOutputStream(result).use { it.write(payload.toString().toByteArray()) }
            return result.toByteArray()
        }
        val parsed = JSONObject(DrawingPackage.decode(ByteArrayInputStream(encode())))
        assertEquals(2, parsed.getJSONObject("scene").getJSONArray("nodeOrder").length())
        preview.put("sha256", "0".repeat(64))
        assertTrue(runCatching { DrawingPackage.decode(ByteArrayInputStream(encode())) }.isFailure)
    }

    @Test fun interruptedCopyKeepsStagedImportAndNeverCreatesBlankReplacement() {
        val contentName = "content-stage-${UUID.randomUUID()}.db"
        val content = worlds.content.ContentStore(context, contentName)
        try {
            store.loadOrCreate("source")
            val source = store.addStroke("source", 0, listOf(point(20.0)), StrokeBrush(), false)
            val resource = content.createImportedDrawing("Imported", source.toString())
            store.writableDatabase.execSQL("CREATE TRIGGER fail_import BEFORE INSERT ON drawings BEGIN SELECT RAISE(ABORT, 'fail'); END")
            assertTrue(runCatching { store.loadOrCreate(resource.id, content, true) }.isFailure)
            assertNotNull(content.pendingDrawing(resource.id))
            store.writableDatabase.execSQL("DROP TRIGGER fail_import")
            val restored = store.loadOrCreate(resource.id, content, true)
            assertTrue(DrawingPackage.equalJson(source, restored))
            assertNull(content.pendingDrawing(resource.id))
            store.writableDatabase.delete("drawings", "id=?", arrayOf(resource.id))
            assertTrue(runCatching { store.loadOrCreate(resource.id, content, true) }.isFailure)
        } finally { content.close(); context.deleteDatabase(contentName) }
    }

    @Test fun refusesTamperedHistoryAndPortableLimitWithoutChangingStoredDrawing() {
        store.loadOrCreate("d")
        val original = store.addStroke("d", 0, listOf(point(10.0)), StrokeBrush(), false)
        val corrupted = JSONObject(original.toString())
        corrupted.getJSONArray("operations").getJSONObject(0).put("base", 9)
        assertTrue(runCatching { DrawingPackage.encode(corrupted.toString()) }.isFailure)
        val wrongScene = JSONObject(original.toString()); wrongScene.getJSONObject("scene").put("nodeOrder", JSONArray())
        assertTrue(runCatching { DrawingPackage.encode(wrongScene.toString()) }.isFailure)
        val undone = store.toggle("d", 1, false)
        val unsupported = JSONObject(undone.toString())
        unsupported.getJSONArray("operations").getJSONObject(0).getJSONArray("changes").getJSONObject(0).getJSONObject("value").put("redaction", true)
        assertTrue(runCatching { DrawingPackage.encode(unsupported.toString()) }.isFailure)
        val repeatedUndo = JSONObject(undone.toString())
        val duplicate = JSONObject(repeatedUndo.getJSONArray("operations").getJSONObject(1).toString()).put("id", "foreign-undo").put("actor", "another-author").put("base", 2)
        repeatedUndo.getJSONArray("operations").put(duplicate); repeatedUndo.put("revision", 3)
        assertTrue(runCatching { DrawingPackage.encode(repeatedUndo.toString()) }.isFailure)
        val tooMany = JSONObject(original.toString()); val ops = JSONArray(); repeat(501) { ops.put(JSONObject()) }; tooMany.put("operations", ops)
        assertTrue(runCatching { DrawingPackage.encode(tooMany.toString()) }.exceptionOrNull() is DrawingPackage.HistoryLimit)
        assertTrue(DrawingPackage.equalJson(store.loadOrCreate("d"), undone))
    }
}
