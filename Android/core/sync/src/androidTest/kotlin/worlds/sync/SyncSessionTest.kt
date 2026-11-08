package worlds.sync

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class SyncSessionTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val testContext = InstrumentationRegistry.getInstrumentation().context
    private val dbName = "session-${UUID.randomUUID()}.db"
    private lateinit var store: AndroidSyncStore
    private val key = SyncDocumentKey("user", "space", "page", 0)
    private lateinit var transport: FakeTransport
    private val events = LinkedBlockingQueue<String>()
    private val latest = ConcurrentHashMap<Int, ByteArray>()

    private inner class FakeTransport(val callback: SyncSocket.Listener) : SyncTransport {
        val frames = LinkedBlockingQueue<SyncWire.Frame>()
        val failSend = AtomicBoolean(false)
        override fun start() { events.add("started") }
        override fun send(frame: SyncWire.Frame): Boolean { if (failSend.get()) return false; frames.add(frame); return true }
        override fun close() { }
        fun next() = requireNotNull(frames.poll(5, TimeUnit.SECONDS))
    }
    private val listener = object : SyncSession.Listener {
        override fun onState(channel: Int, snapshot: ByteArray) { latest[channel] = snapshot; events.add("state:$channel") }
        override fun onAccess(level: String) { events.add("access:$level") }
        override fun onAttention(channel: Int, archiveId: String, reason: String) { events.add("attention:$channel:$archiveId") }
        override fun onClosed(code: Int?) { events.add("closed:$code") }
        override fun onError() { events.add("error") }
    }
    private fun event(expected: String) = assertEquals(expected, events.poll(10, TimeUnit.SECONDS))
    private fun fixture(name: String): ByteArray {
        val json = JSONObject(testContext.assets.open("yjs-fixture.json").bufferedReader().use { it.readText() })
        return Base64.decode(json.getString(name), Base64.DEFAULT)
    }
    private fun session(): SyncSession = SyncSession(store, key, { FakeTransport(it).also { socket -> transport = socket } }, listener)
    @Before fun create() { store = AndroidSyncStore(context, dbName) }
    @After fun cleanup() { store.close(); context.deleteDatabase(dbName) }

    @Test fun persistsBeforeSendAndOnlyAcknowledgesCoveredEdits() {
        store.append(key, fixture("first"), local = true)
        val session = session(); session.start()
        event("state:0"); event("state:1"); event("started")
        transport.callback.onAuthenticated("edit"); event("access:edit")
        assertTrue(transport.next() is SyncWire.Frame.Sync); assertTrue(transport.next() is SyncWire.Frame.Sync)
        transport.callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
        val first = transport.next() as SyncWire.Frame.Update
        assertEquals(1, store.pending(key).size)
        session.applyLocal(0, fixture("second")); event("state:0")
        assertEquals(2, store.pending(key).size)
        transport.callback.onFrame(SyncWire.Frame.Ack(first.batchId, 0, ""))
        val second = transport.next() as SyncWire.Frame.Update
        assertEquals(1, store.pending(key).size)
        transport.callback.onFrame(SyncWire.Frame.Ack(second.batchId, 0, ""))
        session.close(); event("closed:null")
        assertTrue(store.pending(key).isEmpty())
        val rebuilt = store.load(key).updates.fold(byteArrayOf()) { state, update -> YrsNative.merge(state, update.bytes) }
        assertArrayEquals(fixture("finalVector"), YrsNative.stateVector(rebuilt))
    }

    @Test fun snapshotBarrierWaitsForAllEarlierContentAcknowledgements() {
        store.append(key, fixture("first"), local = true)
        val session = session(); session.start()
        event("state:0"); event("state:1"); event("started")
        transport.callback.onAuthenticated("edit"); event("access:edit")
        transport.next(); transport.next()
        transport.callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
        val first = transport.next() as SyncWire.Frame.Update
        session.applyLocal(0, fixture("second")); event("state:0")
        val done = CountDownLatch(1); val result = AtomicBoolean(false)
        session.whenContentSynced { result.set(it); done.countDown() }
        assertFalse(done.await(150, TimeUnit.MILLISECONDS))
        transport.callback.onFrame(SyncWire.Frame.Ack(first.batchId, 0, ""))
        val second = transport.next() as SyncWire.Frame.Update
        assertFalse(done.await(150, TimeUnit.MILLISECONDS))
        transport.callback.onFrame(SyncWire.Frame.Ack(second.batchId, 0, ""))
        assertFalse(done.await(150, TimeUnit.MILLISECONDS))
        transport.callback.onFrame(SyncWire.Frame.Sync(0, 1, byteArrayOf(0, 0))); event("state:0")
        assertTrue(done.await(5, TimeUnit.SECONDS)); assertTrue(result.get()); assertTrue(store.pending(key).isEmpty())
        session.close(); event("closed:null")
    }

    @Test fun versionRestoreChecksCurrentStateAndJournalsBeforeSending() {
        val f = JSONObject(testContext.assets.open("restore-fixture.json").bufferedReader().use { it.readText() })
        fun field(name: String) = Base64.decode(f.getString(name), Base64.DEFAULT)
        store.append(key, field("current"), local = false)
        val session = session(); session.start()
        event("state:0"); event("state:1"); event("started")
        val base = latest.getValue(0).copyOf()
        transport.callback.onAuthenticated("edit"); event("access:edit"); transport.next(); transport.next()
        transport.callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
        val initial = transport.next() as SyncWire.Frame.Update
        transport.callback.onFrame(SyncWire.Frame.Ack(initial.batchId, 0, ""))
        transport.callback.onFrame(SyncWire.Frame.Sync(0, 1, byteArrayOf(0, 0))); event("state:0")
        val barrier = CountDownLatch(1); session.whenContentSynced { barrier.countDown() }; assertTrue(barrier.await(5, TimeUnit.SECONDS))
        transport.callback.onFrame(SyncWire.Frame.Sync(0, 2, field("peerDelta"))); event("state:0")
        val staleDone = CountDownLatch(1); val stale = AtomicBoolean(true)
        session.restoreVersion(base, field("version")) { stale.set(it); staleDone.countDown() }
        assertTrue(staleDone.await(5, TimeUnit.SECONDS)); assertFalse(stale.get()); assertTrue(store.pending(key).isEmpty())
        val saved = CountDownLatch(1); val success = AtomicBoolean(false)
        session.restoreVersion(latest.getValue(0), field("version")) { success.set(it); saved.countDown() }
        assertTrue(saved.await(5, TimeUnit.SECONDS)); assertTrue(success.get()); event("state:0")
        assertEquals(1, store.pending(key).size)
        val batch = transport.next() as SyncWire.Frame.Update
        transport.callback.onFrame(SyncWire.Frame.Ack(batch.batchId, 0, ""))
        val done = CountDownLatch(1); session.whenContentSynced { done.countDown() }; assertTrue(done.await(5, TimeUnit.SECONDS))
        assertTrue(store.pending(key).isEmpty())
        session.close(); event("closed:null")
    }

    @Test fun snapshotBarrierFailsOnDisconnect() {
        val session = session(); session.start()
        event("state:0"); event("state:1"); event("started")
        transport.callback.onAuthenticated("edit"); event("access:edit")
        transport.next(); transport.next()
        val done = CountDownLatch(1); val result = AtomicBoolean(true)
        session.whenContentSynced { result.set(it); done.countDown() }
        transport.callback.onClosed(1006)
        assertTrue(done.await(5, TimeUnit.SECONDS)); assertFalse(result.get()); event("closed:1006")
    }

    @Test fun deniedUpdateIsArchivedAndRevocationPurgesBothChannels() {
        store.append(key, fixture("first"), local = true)
        val session = session(); session.start()
        event("state:0"); event("state:1"); event("started")
        transport.callback.onAuthenticated("edit"); event("access:edit")
        transport.next(); transport.next()
        transport.callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
        val batch = transport.next() as SyncWire.Frame.Update
        transport.callback.onFrame(SyncWire.Frame.Ack(batch.batchId, 1, "denied"))
        assertTrue(requireNotNull(events.poll(10, TimeUnit.SECONDS)).startsWith("attention:0:"))
        event("closed:null")
        assertEquals(1, store.rejected(key).size)
        assertTrue(store.pending(key).isEmpty())
        store.append(key.copy(channel = 1), fixture("first"), local = false)
        val second = session(); second.start()
        event("state:0"); event("state:1"); event("started")
        transport.callback.onClosed(4403); event("closed:4403")
        assertTrue(store.load(key.copy(channel = 1)).updates.isEmpty())
        assertNull(store.load(key).snapshot)
        assertTrue(store.rejected(key).isEmpty())
    }

    @Test fun unacknowledgedEditSurvivesDisconnectAndRemoteUpdatesAreSaved() {
        store.append(key, fixture("first"), local = true)
        val firstSession = session(); firstSession.start()
        event("state:0"); event("state:1"); event("started")
        transport.callback.onAuthenticated("edit"); event("access:edit")
        transport.next(); transport.next()
        transport.callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
        transport.next() as SyncWire.Frame.Update
        transport.callback.onClosed(1006); event("closed:1006")
        assertEquals(1, store.pending(key).size)
        val resumed = session(); resumed.start()
        event("state:0"); event("state:1"); event("started")
        transport.callback.onAuthenticated("edit"); event("access:edit")
        transport.next(); transport.next()
        transport.callback.onFrame(SyncWire.Frame.Sync(0, 1, fixture("second")))
        event("state:0")
        transport.callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
        val batch = transport.next() as SyncWire.Frame.Update
        transport.callback.onFrame(SyncWire.Frame.Ack(batch.batchId, 0, ""))
        resumed.close(); event("closed:null")
        assertTrue(store.pending(key).isEmpty())
        val rebuilt = store.load(key).updates.fold(byteArrayOf()) { state, update -> YrsNative.merge(state, update.bytes) }
        assertArrayEquals(fixture("finalVector"), YrsNative.stateVector(rebuilt))
    }

    @Test fun editorChangeFromStaleSnapshotMergesRemoteTextAndQueuesUpdate() {
        val base = fixture("editorSnapshot")
        store.append(key, base, local = false)
        val session = session(); session.start()
        event("state:0"); event("state:1"); event("started")
        transport.callback.onAuthenticated("edit"); event("access:edit")
        transport.next(); transport.next()
        transport.callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
        val handshake = transport.next() as SyncWire.Frame.Update
        transport.callback.onFrame(SyncWire.Frame.Ack(handshake.batchId, 0, ""))
        transport.callback.onFrame(SyncWire.Frame.Sync(0, 2, fixture("editorConcurrent")))
        event("state:0")
        session.replaceBlockText(base, "block1", 1, 3, "X"); event("state:0")
        val batch = transport.next() as SyncWire.Frame.Update
        val node = JSONObject(YrsNative.editorJson(latest.getValue(0))).getJSONArray("content").getJSONObject(0).getJSONArray("content")
        assertEquals("AXB!", (0 until node.length()).joinToString("") { node.getJSONObject(it).getString("text") })
        assertEquals(1, store.pending(key).size)
        transport.callback.onFrame(SyncWire.Frame.Ack(batch.batchId, 0, ""))
        session.close(); event("closed:null")
        assertTrue(store.pending(key).isEmpty())
    }

    @Test fun rejectsDraftIfRemoteDeletedItsBlockWithoutDiscardingTheSession() {
        val base = fixture("editorSnapshot")
        store.append(key, base, local = false)
        val session = session(); session.start()
        event("state:0"); event("state:1"); event("started")
        transport.callback.onAuthenticated("edit"); event("access:edit")
        transport.next(); transport.next()
        transport.callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
        val handshake = transport.next() as SyncWire.Frame.Update
        transport.callback.onFrame(SyncWire.Frame.Ack(handshake.batchId, 0, ""))
        transport.callback.onFrame(SyncWire.Frame.Sync(0, 2, fixture("editorDeleted"))); event("state:0")
        val done = CountDownLatch(1); val saved = AtomicBoolean(true)
        session.replaceBlockText(base, "block1", 1, 3, "X") { result -> saved.set(result); done.countDown() }
        assertTrue(done.await(5, TimeUnit.SECONDS)); assertFalse(saved.get())
        assertTrue(store.pending(key).isEmpty())
        session.close(); event("closed:null")
    }

    @Test fun failedSendStillReportsDurablySavedEditAndKeepsOutbox() {
        val base = fixture("editorSnapshot")
        store.append(key, base, local = false)
        val session = session(); session.start()
        event("state:0"); event("state:1"); event("started")
        transport.callback.onAuthenticated("edit"); event("access:edit")
        transport.next(); transport.next()
        transport.callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
        val handshake = transport.next() as SyncWire.Frame.Update
        transport.callback.onFrame(SyncWire.Frame.Ack(handshake.batchId, 0, ""))
        transport.failSend.set(true)
        val done = CountDownLatch(1); val saved = AtomicBoolean(false)
        session.replaceBlockText(base, "block1", 1, 3, "X") { saved.set(it); done.countDown() }
        assertTrue(done.await(5, TimeUnit.SECONDS)); assertTrue(saved.get())
        event("state:0"); event("error"); event("closed:null")
        assertEquals(1, store.pending(key).size)
    }
}
