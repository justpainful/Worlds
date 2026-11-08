package worlds.sync

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.net.URL
import java.net.HttpURLConnection
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Opt-in local Worker test only. adb reverse 18790->8790 and 18791->8791 first. */
@RunWith(AndroidJUnit4::class)
class LiveSyncWorkerTest {
    private class Observer : SyncSession.Listener {
        val states = ConcurrentHashMap<Int, ByteArray>()
        val access = CountDownLatch(1)
        val closed = CountDownLatch(1)
        val closeCode = AtomicReference<Int?>(null)
        val failure = AtomicReference<String?>(null)
        override fun onState(channel: Int, snapshot: ByteArray) { states[channel] = snapshot }
        override fun onAccess(level: String) { if (level == "edit") access.countDown() else failure.set("unexpected access") }
        override fun onAttention(channel: Int, archiveId: String, reason: String) { failure.set("rejected update") }
        override fun onClosed(code: Int?) { closeCode.set(code); if (code != null && code != 4403) failure.set("connection closed: $code"); closed.countDown() }
        override fun onError() { failure.set("sync error") }
    }

    @Test fun twoAndroidSessionsExchangeUpdatesThroughLocalWorker() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("liveSync") == "1")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val fixture = JSONObject(assets.open("yjs-fixture.json").bufferedReader().use { it.readText() })
        fun field(name: String) = Base64.decode(fixture.getString(name), Base64.DEFAULT)
        val suffix = UUID.randomUUID().toString()
        val workspace = "ws-$suffix"; val page = "page-$suffix"
        val aKey = SyncDocumentKey("alice-$suffix", workspace, page, 0)
        val bKey = SyncDocumentKey("bob-$suffix", workspace, page, 0)
        val dbName = "live-$suffix.db"
        val store = AndroidSyncStore(context, dbName)
        val a = Observer(); val b = Observer()
        fun token(user: String): String = JSONObject(URL("http://127.0.0.1:18791/dev/token?sub=$user").readText()).getString("token")
        val aliceToken = token(aKey.account)
        val bobToken = token(bKey.account)
        fun session(key: SyncDocumentKey, observer: Observer, accessToken: String): SyncSession {
            return SyncSession(store, key, { callback ->
                SyncSocket("http://127.0.0.1:18790", workspace, page, key.account, accessToken, callback, allowInsecureLoopback = true)
            }, observer)
        }
        val first = session(aKey, a, aliceToken); val second = session(bKey, b, bobToken)
        fun awaitCondition(label: String, condition: () -> Boolean) {
            val until = System.nanoTime() + TimeUnit.SECONDS.toNanos(25)
            while (System.nanoTime() < until) {
                check(a.failure.get() == null && b.failure.get() == null) { "Session failed: ${a.failure.get()} ${b.failure.get()}" }
                if (condition()) return
                Thread.sleep(50)
            }
            fail("Timed out: $label")
        }
        fun hasVector(observer: Observer, expected: ByteArray): Boolean = observer.states[0]?.let {
            YrsNative.stateVector(it).contentEquals(expected)
        } ?: false
        fun editorText(observer: Observer): String = observer.states[0]?.let { state ->
            val nodes = JSONObject(YrsNative.editorJson(state)).getJSONArray("content").getJSONObject(0).getJSONArray("content")
            (0 until nodes.length()).joinToString("") { nodes.getJSONObject(it).getString("text") }
        } ?: ""
        try {
            val base = field("editorSnapshot")
            store.append(aKey, base, local = true)
            first.start(); second.start()
            assertTrue(a.access.await(25, TimeUnit.SECONDS)); assertTrue(b.access.await(25, TimeUnit.SECONDS))
            awaitCondition("first update and ack") { hasVector(b, YrsNative.stateVector(base)) && store.pending(aKey).isEmpty() }
            first.replaceBlockText(base, "block1", 1, 3, "X")
            awaitCondition("editor update and ack") {
                editorText(a) == "AXB" && editorText(b) == "AXB" &&
                    YrsNative.stateVector(a.states.getValue(0)).contentEquals(YrsNative.stateVector(b.states.getValue(0))) && store.pending(aKey).isEmpty()
            }
            val state = (URL("http://127.0.0.1:18790/v1/workspaces/$workspace/docs/$page/state").openConnection() as HttpURLConnection).run {
                setRequestProperty("Authorization", "Bearer $aliceToken")
                inputStream.use { it.readBytes() }.also { disconnect() }
            }
            assertArrayEquals(YrsNative.stateVector(b.states.getValue(0)), YrsNative.stateVector(YrsNative.merge(byteArrayOf(), state)))
            val revoke = URL("http://127.0.0.1:18790/internal/revoke").openConnection() as HttpURLConnection
            revoke.requestMethod = "POST"
            revoke.doOutput = true
            revoke.setRequestProperty("Authorization", "Bearer dev-internal-secret")
            revoke.setRequestProperty("Content-Type", "application/json")
            val request = JSONObject().put("userId", bKey.account).put("workspaceId", workspace).put("docId", page)
            revoke.outputStream.use { it.write(request.toString().toByteArray()) }
            assertEquals(200, revoke.responseCode)
            revoke.disconnect()
            assertTrue(b.closed.await(15, TimeUnit.SECONDS))
            assertEquals(4403, b.closeCode.get())
            assertTrue(store.load(bKey).updates.isEmpty())
            assertTrue(store.load(aKey).updates.isNotEmpty())
        } finally {
            first.close(); second.close()
            a.closed.await(10, TimeUnit.SECONDS); b.closed.await(10, TimeUnit.SECONDS)
            store.close(); context.deleteDatabase(dbName)
        }
    }
}
