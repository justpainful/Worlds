package worlds.android

import android.content.Context
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import worlds.identity.EncryptedSessionStore
import worlds.identity.IdentityService
import worlds.identity.IdentityTransport
import worlds.sync.AndroidSyncStore
import worlds.sync.OfflineEditor
import worlds.sync.SyncDocumentKey
import worlds.sync.SyncSession
import worlds.sync.SyncSocket
import worlds.sync.SyncTransport
import worlds.sync.SyncWire
import worlds.sync.YrsNative
import java.io.File
import java.security.KeyStore
import java.util.concurrent.atomic.AtomicInteger

/** Run stages in distinct target processes; never uses the app's real account or database. */
@RunWith(AndroidJUnit4::class)
class OfflineProcessRestartTest {
    private val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
    private val authority = "https://restart.identity.example"
    private val endpoint = "https://restart.sync.example"
    private val dbName = "offline-process-test.db"
    private val vaultName = "offline-process-test.identity"
    private val alias = "worlds.test.offline-process"
    private val key = SyncDocumentKey("test-user", "test-space", "test-page", 0, authority)
    private val fixture = Base64.decode("AQmJBgAHAQdkZWZhdWx0AwdoZWFkaW5nBwCJBgAGBgCJBgEEYm9sZAJ7fYaJBgIEbGluax97ImhyZWYiOiJodHRwczovL2V4YW1wbGUudGVzdCJ9hIkGAwZB8J+YgEKGiQYHBGJvbGQEbnVsbIaJBggEbGluawRudWxsKACJBgAFbGV2ZWwBfQIoAIkGAANiaWQBdwZibG9jazEA", Base64.DEFAULT)

    private fun vault() = EncryptedSessionStore(app, alias, vaultName)
    private fun identity() = IdentityService(authority, vault(), IdentityTransport { _, _, _, _, _ -> error("Identity network must not be used") })
    private fun waitFor(test: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 20_000
        while (System.currentTimeMillis() < deadline) { if (test()) return; Thread.sleep(25) }
        fail("condition timed out")
    }

    @Test fun seedInFirstProcess() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("processRestart") == "1")
        app.deleteDatabase(dbName)
        File(app.noBackupFilesDir, "offline-process-test.pids").writeText(android.os.Process.myPid().toString())
        val fake = IdentityTransport { _, _, path, _, _ ->
            require(path == "/auth/email/verify")
            JSONObject().put("userId", "test-user").put("deviceId", "test-device")
                .put("accessToken", "synthetic-access").put("refreshToken", "synthetic-refresh")
                .put("accessTokenExpiresAt", 4_000_000_000_000L).put("refreshTokenExpiresAt", 4_000_000_000_000L)
                .put("user", JSONObject().put("id", "test-user").put("displayName", "Test"))
        }
        IdentityService(authority, vault(), fake).verifyEmail("challenge", "123456", "Test emulator")
        AndroidSyncStore(app, dbName).use { store ->
            store.bindEndpoint(key, endpoint)
            store.append(key, fixture, local = false)
            store.rememberAccess(key, "test-device", endpoint, "edit")
            assertEquals(1, store.cachedPages(authority, "test-user", "test-device").size)
        }
    }

    private fun runtime(store: AndroidSyncStore, offline: Boolean, sent: AtomicInteger): AccountSyncRuntime = AccountSyncRuntime(
        credentials = { server ->
            val guarded = IdentityService(authority, vault(), IdentityTransport { _, _, _, _, _ -> error("Identity network must not be used") },
                networkAvailable = { !offline }, now = { if (offline) 4_000_000_000_001L else System.currentTimeMillis() })
            guarded.activeSession().let { SyncCredentials(server, it.profile.userId, it.profile.deviceId, it.accessToken, it.expiresAt) }
        },
        offlinePrincipal = { server -> identity().session()!!.let { SyncPrincipal(server, it.profile.userId, it.profile.deviceId) } },
        cachedPages = { server, user, device -> store.cachedPages(server, user, device) },
        loadCached = { doc -> store.load(doc).let { replica -> replica.updates.fold(replica.snapshot ?: byteArrayOf()) { state, update -> YrsNative.merge(state, update.bytes) } } },
        bindEndpoint = { doc, server -> store.bindEndpoint(doc, server) },
        releaseEmptyEndpoint = { doc, server -> store.releaseEmptyEndpoint(doc, server) },
        rememberAccess = { doc, device, server, level -> store.rememberAccess(doc, device, server, level) },
        forgetAccess = { doc -> store.forgetAccess(doc) },
        offlineEdit = { doc, base, bid, start, end, text, draft -> OfflineEditor.replaceBlockText(store, doc, base, bid, start, end, text, draft) },
        recoveredText = { doc -> store.recovered(doc) },
        writeWorkingDraft = { doc, token, draft -> store.saveWorkingDraft(doc, token, draft) },
        removeWorkingDraft = { doc, token -> store.discardWorkingDraft(doc, token); Unit },
        makeSession = { doc, _, _, listener -> SyncSession(store, doc, { callback -> object : SyncTransport {
            override fun start() {
                if (offline) callback.onFailure() else {
                    callback.onAuthenticated("edit")
                    callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
                    callback.onFrame(SyncWire.Frame.Sync(1, 0, byteArrayOf(0)))
                }
            }
            override fun send(frame: SyncWire.Frame): Boolean {
                if (frame is SyncWire.Frame.Update) { sent.incrementAndGet(); callback.onFrame(SyncWire.Frame.Ack(frame.batchId, 0, "")) }
                return true
            }
            override fun close() { }
        } }, listener) },
    )

    @Test fun editOfflineInSecondProcess() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("processRestart") == "1")
        val pids = File(app.noBackupFilesDir, "offline-process-test.pids")
        val pid = android.os.Process.myPid().toString(); assertNotEquals(pids.readText(), pid); pids.appendText("\n$pid")
        AndroidSyncStore(app, dbName).use { store ->
            val runtime = runtime(store, offline = true, sent = AtomicInteger())
            assertEquals("test-page", runtime.cachedPageList(authority).single().page)
            val controller = SharedPageController(runtime, authority, "test-space", retryDelay = { 60_000 })
            try {
                controller.open(endpoint, "test-page")
                waitFor { controller.state.value.offline && controller.state.value.blocks.singleOrNull()?.text == "A😀B" }
                controller.edit(controller.state.value.blocks.single()); controller.updateDraft("Persisted after process restart"); controller.save()
                waitFor { controller.state.value.draft == null && store.pending(key).size == 1 }
            } finally { controller.close(); assertTrue(controller.awaitDraftBackups()); runtime.accountChange { } }
        }
    }

    @Test fun sweepPendingInThirdProcessWithoutOpeningPage() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("processRestart") == "1")
        val pids = File(app.noBackupFilesDir, "offline-process-test.pids")
        assertFalse(pids.readLines().contains(android.os.Process.myPid().toString())); pids.delete()
        AndroidSyncStore(app, dbName).use { store ->
            assertEquals(1, store.pending(key).size)
            val sent = AtomicInteger(); val runtime = runtime(store, offline = false, sent = sent)
            try {
                val principal = SyncPrincipal(authority, "test-user", "test-device")
                val pages = store.pendingPages(authority, principal.userId, principal.deviceId)
                assertEquals(listOf("test-page"), pages.map { it.page })
                assertEquals(DrainResult.DONE, kotlinx.coroutines.runBlocking { BackgroundSweep.run(runtime, principal, pages) })
                assertTrue(store.pending(key).isEmpty()); assertTrue(sent.get() >= 2)
                val replica = store.load(key)
                val snapshot = replica.updates.fold(replica.snapshot ?: byteArrayOf()) { state, update -> YrsNative.merge(state, update.bytes) }
                assertTrue(YrsNative.editorJson(snapshot).contains("Persisted after process restart"))
            } finally { runtime.accountChange { } }
        }
        app.deleteDatabase(dbName)
        File(app.noBackupFilesDir, vaultName).delete()
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
    }

    @Test fun reconnectInThirdProcess() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("processRestart") == "1")
        AndroidSyncStore(app, dbName).use { store ->
            assertEquals(1, store.pending(key).size)
            val sent = AtomicInteger()
            val runtime = runtime(store, offline = false, sent = sent)
            val controller = SharedPageController(runtime, authority, "test-space")
            try {
                controller.open(endpoint, "test-page")
                waitFor { controller.state.value.access == "edit" && store.pending(key).isEmpty() && sent.get() >= 2 }
                assertEquals("Persisted after process restart", controller.state.value.blocks.single().text)
            } finally { controller.close(); assertTrue(controller.awaitDraftBackups()); runtime.accountChange { } }
        }
        app.deleteDatabase(dbName)
        File(app.noBackupFilesDir, vaultName).delete()
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
    }
}
