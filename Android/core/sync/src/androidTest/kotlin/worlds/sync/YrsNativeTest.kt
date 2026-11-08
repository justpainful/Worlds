package worlds.sync

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class YrsNativeTest {
    @Test fun yjsUpdatesConvergeEvenWhenCausalDependencyArrivesLate() {
        val context = InstrumentationRegistry.getInstrumentation().context
        val fixture = JSONObject(context.assets.open("yjs-fixture.json").bufferedReader().use { it.readText() })
        fun field(name: String) = Base64.decode(fixture.getString(name), Base64.DEFAULT)
        val first = field("first"); val second = field("second")
        val firstState = YrsNative.merge(byteArrayOf(), first)
        assertArrayEquals(field("firstVector"), YrsNative.stateVector(firstState))
        val outOfOrder = YrsNative.merge(byteArrayOf(), second)
        val resolved = YrsNative.merge(outOfOrder, first)
        assertArrayEquals(field("finalVector"), YrsNative.stateVector(resolved))
        val delta = YrsNative.diff(resolved, field("firstVector"))
        val merged = YrsNative.merge(firstState, delta)
        assertArrayEquals(field("finalVector"), YrsNative.stateVector(merged))
        try { YrsNative.merge(firstState, byteArrayOf(0xff.toByte())); fail("invalid update accepted") } catch (_: IllegalArgumentException) { }
    }

    @Test fun readsDesktopContentAndEditsUtf16WithoutLosingConcurrentChanges() {
        val context = InstrumentationRegistry.getInstrumentation().context
        val fixture = JSONObject(context.assets.open("yjs-fixture.json").bufferedReader().use { it.readText() })
        fun field(name: String) = Base64.decode(fixture.getString(name), Base64.DEFAULT)
        val snapshot = field("editorSnapshot"); val doc = JSONObject(YrsNative.editorJson(snapshot))
        val heading = doc.getJSONArray("content").getJSONObject(0)
        assertEquals("heading", heading.getString("type")); assertEquals(2, heading.getJSONObject("attrs").getInt("level"))
        assertEquals("A😀B", heading.getJSONArray("content").getJSONObject(0).getString("text"))
        assertEquals(2, heading.getJSONArray("content").getJSONObject(0).getJSONArray("marks").length())
        val update = YrsNative.replaceText(snapshot, listOf(0, 0), 1, 3, "X")
        val concurrent = YrsNative.merge(snapshot, field("editorConcurrent")); val merged = YrsNative.merge(concurrent, update)
        val nodes = JSONObject(YrsNative.editorJson(merged)).getJSONArray("content").getJSONObject(0).getJSONArray("content")
        assertEquals("AXB!", (0 until nodes.length()).joinToString("") { nodes.getJSONObject(it).getString("text") })
        try { YrsNative.replaceText(snapshot, listOf(0, 0), 2, 3, "X"); fail("split surrogate accepted") } catch (_: IllegalArgumentException) { }
    }

    @Test fun blockEditsCrossTextNodesAndCreateTextInEmptyParagraph() {
        val context = InstrumentationRegistry.getInstrumentation().context
        val fixture = JSONObject(context.assets.open("yjs-fixture.json").bufferedReader().use { it.readText() })
        fun field(name: String) = Base64.decode(fixture.getString(name), Base64.DEFAULT)
        fun text(state: ByteArray, index: Int): String {
            val nodes = JSONObject(YrsNative.editorJson(state)).getJSONArray("content").getJSONObject(index).optJSONArray("content") ?: return ""
            return (0 until nodes.length()).joinToString("") { nodes.getJSONObject(it).getString("text") }
        }
        val original = field("multiSnapshot"); val update = YrsNative.replaceBlockText(original, "multi", 3, 5, "X")
        assertEquals("A😀XD", text(YrsNative.merge(original, update), 0))
        val empty = field("emptySnapshot"); val insert = YrsNative.replaceBlockText(empty, "empty", 0, 0, "مرحبا")
        assertEquals("مرحبا", text(YrsNative.merge(empty, insert), 1))
        try { YrsNative.replaceBlockText(original, "multi", 2, 3, "X"); fail("split surrogate accepted") } catch (_: IllegalArgumentException) { }
    }

    @Test fun versionRestoreInteroperatesWithYjsAndRetainsConcurrentText() {
        val context = InstrumentationRegistry.getInstrumentation().context
        val fixture = JSONObject(context.assets.open("restore-fixture.json").bufferedReader().use { it.readText() })
        fun field(name: String) = Base64.decode(fixture.getString(name), Base64.DEFAULT)
        val current = field("current"); val old = field("version"); val oldId = YrsNative.blockIdentity(current, "a")
        val update = YrsNative.restoreVersion(current, old); val restored = YrsNative.merge(current, update)
        assertArrayEquals(oldId, YrsNative.blockIdentity(restored, "a"))
        val oldBlocks = JSONObject(YrsNative.editorJson(old)).getJSONArray("content")
        val restoredBlocks = JSONObject(YrsNative.editorJson(restored)).getJSONArray("content")
        assertEquals(oldBlocks.length(), restoredBlocks.length())
        assertEquals("hello😀", restoredBlocks.getJSONObject(0).getJSONArray("content").getJSONObject(0).getString("text"))
        assertEquals(2, restoredBlocks.getJSONObject(0).getJSONObject("attrs").getInt("level"))
        val concurrent = YrsNative.merge(restored, field("peerDelta")); val peer = YrsNative.merge(field("peer"), update)
        assertArrayEquals(YrsNative.stateVector(concurrent), YrsNative.stateVector(peer))
        val nodes = JSONObject(YrsNative.editorJson(concurrent)).getJSONArray("content").getJSONObject(0).getJSONArray("content")
        assertEquals("hello😀!", (0 until nodes.length()).joinToString("") { nodes.getJSONObject(it).getString("text") })
        val result = JSONObject(fixture.toString()).put("restoreUpdate", Base64.encodeToString(update, Base64.NO_WRAP))
        val path = InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null)!!.resolve("restore-interop.json")
        path.writeText(result.toString())
        android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${path.absolutePath} /sdcard/Download/worlds-restore-interop.json")).use { it.readBytes() }
        try { YrsNative.restoreVersion(current, byteArrayOf(0xff.toByte())); fail("invalid version accepted") } catch (_: IllegalArgumentException) { }
        try { YrsNative.restoreVersion(current, field("peerDelta")); fail("incomplete version accepted") } catch (_: IllegalArgumentException) { }
        try { YrsNative.restoreVersion(field("reordered"), old); fail("reordered blocks accepted") } catch (_: IllegalArgumentException) { }
    }
}
