package worlds.android

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.Configuration
import androidx.work.ListenableWorker
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.WorkManagerTestInitHelper
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import worlds.sync.*
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class BackgroundWorkIntegrationTest {
    @Test fun scheduledWorkerSendsPendingUpdateWhenNetworkConstraintIsMet() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("liveSync") == "1")
        val context = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val suffix = UUID.randomUUID().toString(); val db = "worker-integration-$suffix.db"; val store = AndroidSyncStore(context, db)
        val authority = "https://identity.example"; val user = "writer-$suffix"; val other = "reader-$suffix"
        val space = "workspace-$suffix"; val page = "page-$suffix"; val endpoint = "http://127.0.0.1:18790"
        val principal = SyncPrincipal(authority, user, "device")
        fun token(id: String) = JSONObject(URL("http://127.0.0.1:18791/dev/token?sub=$id").readText()).getString("token")
        val commentKey = SyncDocumentKey(user, space, page, SyncWire.COMMENTS, authority)
        store.append(commentKey, YrsNative.changeComment(byteArrayOf(), "create", "thread", user, body = "Sent by scheduled job"), local = true)
        val runtime = AccountSyncRuntime(credentials = { SyncCredentials(authority, user, "device", token(user)) }, allowLoopbackForTests = true,
            makeSession = { doc, url, bearer, listener -> SyncSession(store, doc, { callback -> SyncSocket(url, doc.workspace, doc.page, user, bearer, callback, allowInsecureLoopback = true) }, listener) })
        val executor = Executors.newFixedThreadPool(4)
        val factory = object : WorkerFactory() {
            override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker? =
                when (workerClassName) {
                    OutboxSyncWorker::class.java.name -> OutboxSyncWorker(appContext, workerParameters).apply { runtimeProvider = { runtime } }
                    OutboxSweepWorker::class.java.name -> OutboxSweepWorker(appContext, workerParameters).apply {
                        runtimeProvider = { runtime }; principalProvider = { principal }
                        scanProvider = { _, current, _ -> 0 to store.pendingPages(current.authority, current.userId, current.deviceId) }
                    }
                    else -> null
                }
        }
        var peer: SyncSession? = null
        try {
            val config = Configuration.Builder().setExecutor(executor).setWorkerFactory(factory).build()
            WorkManagerTestInitHelper.initializeTestWorkManager(context, config)
            val manager = WorkManager.getInstance(context)
            BackgroundSync.enqueue(context, principal, endpoint, space, page)
            val name = BackgroundSync.workName(principal, endpoint, space, page)
            val work = manager.getWorkInfosForUniqueWork(name).get(10, TimeUnit.SECONDS).single()
            assertEquals(WorkInfo.State.ENQUEUED, work.state)
            assertEquals(1, store.pending(commentKey).size)
            WorkManagerTestInitHelper.getTestDriver(context)!!.setAllConstraintsMet(work.id)
            val deadline = System.currentTimeMillis() + 30_000
            var state: WorkInfo.State? = null
            while (System.currentTimeMillis() < deadline) {
                state = manager.getWorkInfoById(work.id).get(10, TimeUnit.SECONDS)?.state
                if (state?.isFinished == true) break
                Thread.sleep(100)
            }
            assertEquals(WorkInfo.State.SUCCEEDED, state); assertTrue(store.pending(commentKey).isEmpty())
            val remote = AtomicReference<ByteArray>(); val received = java.util.concurrent.CountDownLatch(1)
            peer = SyncSession(store, SyncDocumentKey(other, space, page, SyncWire.CONTENT, authority), { callback ->
                SyncSocket(endpoint, space, page, other, token(other), callback, allowInsecureLoopback = true)
            }, object : SyncSession.Listener {
                override fun onState(channel: Int, snapshot: ByteArray) { if (channel == SyncWire.COMMENTS) remote.set(snapshot) }
                override fun onSynchronized(channel: Int) { if (channel == SyncWire.COMMENTS) received.countDown() }
                override fun onAccess(level: String) = Unit
                override fun onAttention(channel: Int, archiveId: String, reason: String) = Unit
                override fun onClosed(code: Int?) = Unit
                override fun onError() = Unit
            })
            peer.start(); assertTrue(received.await(20, TimeUnit.SECONDS))
            val body = JSONObject(YrsNative.commentsJson(remote.get())).getJSONObject("threads").getJSONObject("thread").getJSONArray("comments").getJSONObject(0).getString("body")
            assertEquals("Sent by scheduled job", body)

            // Simulate a crash between committing an update and scheduling its one-time work.
            val orphanPage = "orphan-$suffix"
            val orphanKey = SyncDocumentKey(user, space, orphanPage, SyncWire.CONTENT, authority)
            store.bindEndpoint(orphanKey, endpoint); store.rememberAccess(orphanKey, "device", endpoint, "edit")
            store.append(orphanKey.copy(channel = SyncWire.COMMENTS), YrsNative.changeComment(byteArrayOf(), "create", "thread2", user, body = "Recovered by sweep"), local = true)
            BackgroundSync.ensureSweep(context)
            val periodic = manager.getWorkInfosForUniqueWork("worlds-outbox-sweep").get(10, TimeUnit.SECONDS).single()
            val driver = WorkManagerTestInitHelper.getTestDriver(context)!!
            driver.setAllConstraintsMet(periodic.id); driver.setPeriodDelayMet(periodic.id)
            val sweepDeadline = System.currentTimeMillis() + 30_000
            while (System.currentTimeMillis() < sweepDeadline && store.pending(orphanKey.copy(channel = 1)).isNotEmpty()) Thread.sleep(100)
            assertTrue(store.pending(orphanKey.copy(channel = 1)).isEmpty())
            val orphanRemote = AtomicReference<ByteArray>(); val orphanReceived = java.util.concurrent.CountDownLatch(1)
            peer?.closeAndWait()
            peer = SyncSession(store, SyncDocumentKey(other, space, orphanPage, 0, authority), { callback ->
                SyncSocket(endpoint, space, orphanPage, other, token(other), callback, allowInsecureLoopback = true)
            }, object : SyncSession.Listener {
                override fun onState(channel: Int, snapshot: ByteArray) { if (channel == 1) orphanRemote.set(snapshot) }
                override fun onSynchronized(channel: Int) { if (channel == 1) orphanReceived.countDown() }
                override fun onAccess(level: String) = Unit
                override fun onAttention(channel: Int, archiveId: String, reason: String) = Unit
                override fun onClosed(code: Int?) = Unit
                override fun onError() = Unit
            })
            peer.start(); assertTrue(orphanReceived.await(20, TimeUnit.SECONDS))
            val recovered = JSONObject(YrsNative.commentsJson(orphanRemote.get())).getJSONObject("threads").getJSONObject("thread2").getJSONArray("comments").getJSONObject(0).getString("body")
            assertEquals("Recovered by sweep", recovered)
        } finally {
            peer?.closeAndWait(); runtime.accountChange { }; store.close(); context.deleteDatabase(db); executor.shutdownNow()
        }
    }
}
