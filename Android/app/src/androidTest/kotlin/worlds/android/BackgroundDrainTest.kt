package worlds.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import worlds.sync.*
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class BackgroundDrainTest {
    @Test fun drainsBothChannelsOnlyAfterAcknowledgementsAndRejectsOtherAccounts() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = "background-${UUID.randomUUID()}.db"; val store = AndroidSyncStore(context, db)
        val authority = "https://identity.example"; val principal = SyncPrincipal(authority, "alice", "device")
        val key = SyncDocumentKey("alice", "team", "page", SyncWire.CONTENT, authority)
        val comment = YrsNative.changeComment(byteArrayOf(), "create", "thread", "alice", body = "Hello")
        store.append(key.copy(channel = SyncWire.COMMENTS), comment, local = true)
        store.append(key, comment, local = true)
        var connections = 0
        val runtime = AccountSyncRuntime(credentials = { SyncCredentials(authority, "alice", "device", "secret") },
            makeSession = { doc, _, _, listener -> SyncSession(store, doc, { callback -> object : SyncTransport {
                override fun start() {
                    connections++
                    callback.onAuthenticated("edit")
                    callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
                    callback.onFrame(SyncWire.Frame.Sync(1, 0, byteArrayOf(0)))
                }
                override fun send(frame: SyncWire.Frame): Boolean {
                    if (frame is SyncWire.Frame.Update) callback.onFrame(SyncWire.Frame.Ack(frame.batchId, 0, ""))
                    return true
                }
                override fun close() = Unit
            } }, listener) })
        try {
            assertEquals(DrainResult.DONE, BackgroundDrain.run(runtime, principal.copy(userId = "bob"), "https://sync.example", "team", "page", 3_000))
            assertEquals(0, connections); assertTrue(store.pending(key).isNotEmpty())
            assertEquals(DrainResult.DONE, BackgroundDrain.run(runtime, principal, "https://sync.example", "team", "page", 10_000))
            assertEquals(1, connections); assertTrue(store.pending(key).isEmpty()); assertTrue(store.pending(key.copy(channel = 1)).isEmpty())
        } finally { runtime.accountChange { }; store.close(); context.deleteDatabase(db) }
    }

    @Test fun workManagerPersistsAndRunsScheduledWork() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val principal = SyncPrincipal("https://identity.example", "unavailable-${UUID.randomUUID()}", "device")
        val endpoint = "https://sync.example"; val workspace = "team"; val page = "page"
        val manager = androidx.work.WorkManager.getInstance(context)
        BackgroundSync.enqueue(context, principal, endpoint, workspace, page)
        val name = BackgroundSync.workName(principal, endpoint, workspace, page)
        val deadline = System.currentTimeMillis() + 30_000
        var state: androidx.work.WorkInfo.State? = null
        while (System.currentTimeMillis() < deadline) {
            state = manager.getWorkInfosForUniqueWork(name).get().lastOrNull()?.state
            if (state?.isFinished == true) break
            Thread.sleep(100)
        }
        assertEquals(androidx.work.WorkInfo.State.SUCCEEDED, state)
    }

    @Test fun periodicSweepSchedulingIsPersistentAndIdempotent() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        BackgroundSync.ensureSweep(context); BackgroundSync.ensureSweep(context)
        val works = androidx.work.WorkManager.getInstance(context).getWorkInfosForUniqueWork("worlds-outbox-sweep").get()
        assertEquals(1, works.size)
        assertTrue(works.single().state in setOf(androidx.work.WorkInfo.State.ENQUEUED, androidx.work.WorkInfo.State.RUNNING))
    }

    @Test fun activePageIsNeverOpenedTwice() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = "background-active-${UUID.randomUUID()}.db"; val store = AndroidSyncStore(context, db)
        val authority = "https://identity.example"; val principal = SyncPrincipal(authority, "alice", "device")
        val runtime = AccountSyncRuntime(credentials = { SyncCredentials(authority, "alice", "device", "secret") },
            makeSession = { doc, _, _, listener -> SyncSession(store, doc, { _ -> object : SyncTransport {
                override fun start() = Unit
                override fun send(frame: SyncWire.Frame) = true
                override fun close() = Unit
            } }, listener) })
        val session = runtime.open(authority, "https://sync.example", "team", "page", object : SyncSession.Listener {
            override fun onState(channel: Int, snapshot: ByteArray) = Unit
            override fun onAccess(level: String) = Unit
            override fun onAttention(channel: Int, archiveId: String, reason: String) = Unit
            override fun onClosed(code: Int?) = Unit
            override fun onError() = Unit
        })
        try { assertEquals(DrainResult.RETRY, BackgroundDrain.run(runtime, principal, "https://sync.example", "team", "page", 1_000)) }
        finally { session.closeAndWait(); runtime.accountChange { }; store.close(); context.deleteDatabase(db) }
    }

    @Test fun waitsForServerAcknowledgements() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = "background-${UUID.randomUUID()}.db"; val store = AndroidSyncStore(context, db)
        val authority = "https://identity.example"; val key = SyncDocumentKey("alice", "team", "page", 1, authority)
        store.append(key, YrsNative.changeComment(byteArrayOf(), "create", "thread", "alice", body = "Hello"), local = true)
        val sent = java.util.concurrent.CountDownLatch(2)
        val batches = java.util.Collections.synchronizedList(mutableListOf<Long>())
        lateinit var socket: SyncSocket.Listener
        val runtime = AccountSyncRuntime(credentials = { SyncCredentials(authority, "alice", "device", "secret") },
            makeSession = { doc, _, _, listener -> SyncSession(store, doc, { callback -> object : SyncTransport {
                override fun start() { socket = callback; callback.onAuthenticated("edit"); callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0))); callback.onFrame(SyncWire.Frame.Sync(1, 0, byteArrayOf(0))) }
                override fun send(frame: SyncWire.Frame): Boolean { if (frame is SyncWire.Frame.Update) { batches.add(frame.batchId); sent.countDown() }; return true }
                override fun close() = Unit
            } }, listener) })
        try {
            val run = async(kotlinx.coroutines.Dispatchers.IO) { BackgroundDrain.run(runtime, SyncPrincipal(authority, "alice", "device"), "https://sync.example", "team", "page", 10_000) }
            assertTrue(sent.await(5, java.util.concurrent.TimeUnit.SECONDS)); assertFalse(run.isCompleted); assertEquals(1, store.pending(key).size)
            batches.toList().forEach { socket.onFrame(SyncWire.Frame.Ack(it, 0, "")) }
            assertEquals(DrainResult.DONE, run.await()); assertTrue(store.pending(key).isEmpty())
        } finally { runtime.accountChange { }; store.close(); context.deleteDatabase(db) }
    }

    @Test fun drainsQueuedCommentThroughLocalWorkerToAnotherClient() = runBlocking {
        org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("liveSync") == "1")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString(); val db = "background-live-$suffix.db"; val store = AndroidSyncStore(context, db)
        val authority = "https://identity.example"; val user = "user-$suffix"; val other = "peer-$suffix"; val space = "ws-$suffix"; val page = "page-$suffix"; val endpoint = "http://127.0.0.1:18790"
        fun token(id: String) = org.json.JSONObject(java.net.URL("http://127.0.0.1:18791/dev/token?sub=$id").readText()).getString("token")
        val key = SyncDocumentKey(user, space, page, 1, authority)
        store.append(key, YrsNative.changeComment(byteArrayOf(), "create", "thread", user, body = "Queued offline"), local = true)
        val runtime = AccountSyncRuntime(credentials = { SyncCredentials(authority, user, "device", token(user)) }, allowLoopbackForTests = true,
            makeSession = { doc, url, bearer, listener -> SyncSession(store, doc, { callback -> SyncSocket(url, space, page, user, bearer, callback, allowInsecureLoopback = true) }, listener) })
        var peer: SyncSession? = null
        try {
            assertEquals(DrainResult.DONE, BackgroundDrain.run(runtime, SyncPrincipal(authority, user, "device"), endpoint, space, page, 20_000))
            assertTrue(store.pending(key).isEmpty())
            val received = java.util.concurrent.CountDownLatch(1); val remote = java.util.concurrent.atomic.AtomicReference<ByteArray>()
            peer = SyncSession(store, SyncDocumentKey(other, space, page, 0, authority), { callback -> SyncSocket(endpoint, space, page, other, token(other), callback, allowInsecureLoopback = true) }, object : SyncSession.Listener {
                override fun onState(channel: Int, snapshot: ByteArray) { if (channel == 1) remote.set(snapshot) }
                override fun onSynchronized(channel: Int) { if (channel == 1) received.countDown() }
                override fun onAccess(level: String) = Unit
                override fun onAttention(channel: Int, archiveId: String, reason: String) = Unit
                override fun onClosed(code: Int?) = Unit
                override fun onError() = Unit
            })
            peer.start(); assertTrue(received.await(20, java.util.concurrent.TimeUnit.SECONDS))
            val thread = org.json.JSONObject(YrsNative.commentsJson(remote.get())).getJSONObject("threads").getJSONObject("thread")
            assertEquals("Queued offline", thread.getJSONArray("comments").getJSONObject(0).getString("body"))
        } finally { peer?.closeAndWait(); runtime.accountChange { }; store.close(); context.deleteDatabase(db) }
    }

    @Test fun transportFailureDoesNotDropPendingUpdate() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = "background-${UUID.randomUUID()}.db"; val store = AndroidSyncStore(context, db)
        val authority = "https://identity.example"; val key = SyncDocumentKey("alice", "team", "page", 1, authority)
        store.append(key, YrsNative.changeComment(byteArrayOf(), "create", "thread", "alice", body = "Hello"), local = true)
        val runtime = AccountSyncRuntime(credentials = { SyncCredentials(authority, "alice", "device", "secret") },
            makeSession = { doc, _, _, listener -> SyncSession(store, doc, { callback -> object : SyncTransport {
                override fun start() { callback.onFailure() }
                override fun send(frame: SyncWire.Frame) = false
                override fun close() = Unit
            } }, listener) })
        try {
            assertEquals(DrainResult.RETRY, BackgroundDrain.run(runtime, SyncPrincipal(authority, "alice", "device"), "https://sync.example", "team", "page", 3_000))
            assertEquals(1, store.pending(key).size)
        } finally { runtime.accountChange { }; store.close(); context.deleteDatabase(db) }
    }
}
