package worlds.android

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import worlds.sync.AndroidSyncStore
import worlds.sync.DraftCapture
import worlds.sync.SyncDocumentKey
import worlds.sync.SyncSession
import worlds.sync.SyncSocket
import worlds.sync.SyncTransport
import worlds.sync.SyncWire
import worlds.sync.OfflineEditor
import worlds.sync.YrsNative
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.io.IOException

@RunWith(AndroidJUnit4::class)
class SharedPageRecoveryTest {
    private val app = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "shared-recovery-${UUID.randomUUID()}.db"
    private lateinit var store: AndroidSyncStore
    private val authority = "https://identity.example"
    private val key = SyncDocumentKey("user", "space", "page", 0, authority)
    private val transports = CopyOnWriteArrayList<FakeTransport>()
    private val failNextUpdate = AtomicBoolean(false)
    private val failFirstOpen = AtomicBoolean(false)
    private val unauthorizedAlways = AtomicBoolean(false)
    private val revokedOnOpen = AtomicBoolean(false)
    private val holdAuthentication = AtomicBoolean(false)
    private val refreshes = AtomicInteger(0)
    private val socketRefreshes = AtomicInteger(0)
    private val retryMillis = AtomicLong(20)
    private val versionRequests = AtomicInteger(0)
    private val failDraftBackup = AtomicBoolean(false)
    @Volatile private var user = "user"
    @Volatile private var expiry = Long.MAX_VALUE
    @Volatile private var changedOnRefresh = false
    @Volatile private var level = "edit"
    private lateinit var runtime: AccountSyncRuntime
    private lateinit var controller: SharedPageController

    private inner class FakeTransport(val callback: SyncSocket.Listener) : SyncTransport {
        val updates = AtomicInteger(0)
        override fun start() {
            if (revokedOnOpen.get()) { callback.onClosed(4403); return }
            if (unauthorizedAlways.get()) { callback.onClosed(4401); return }
            if (failFirstOpen.compareAndSet(true, false)) { callback.onFailure(); return }
            if (holdAuthentication.get()) return
            authenticate()
        }
        fun authenticate() {
            callback.onAuthenticated(level)
            callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
            callback.onFrame(SyncWire.Frame.Sync(0, 1, byteArrayOf(0, 0)))
            callback.onFrame(SyncWire.Frame.Sync(1, 0, byteArrayOf(0)))
        }
        override fun send(frame: SyncWire.Frame): Boolean {
            if (frame is SyncWire.Frame.Update) {
                updates.incrementAndGet()
                if (failNextUpdate.compareAndSet(true, false)) return false
                callback.onFrame(SyncWire.Frame.Ack(frame.batchId, 0, ""))
            }
            if (frame is SyncWire.Frame.AuthRefresh) { socketRefreshes.incrementAndGet(); callback.onAuthenticated("edit") }
            return true
        }
        override fun close() { }
    }

    @Before fun setup() {
        store = AndroidSyncStore(app, name)
        store.bindEndpoint(key, "https://sync.example")
        val base = Base64.decode("AQmJBgAHAQdkZWZhdWx0AwdoZWFkaW5nBwCJBgAGBgCJBgEEYm9sZAJ7fYaJBgIEbGluax97ImhyZWYiOiJodHRwczovL2V4YW1wbGUudGVzdCJ9hIkGAwZB8J+YgEKGiQYHBGJvbGQEbnVsbIaJBggEbGluawRudWxsKACJBgAFbGV2ZWwBfQIoAIkGAANiaWQBdwZibG9jazEA", Base64.DEFAULT)
        store.append(key, base, local = false)
        runtime = AccountSyncRuntime(
            credentials = { SyncCredentials(authority, user, "device", "old", expiry) },
            makeSession = { doc, _, _, listener -> SyncSession(store, doc, { callback -> FakeTransport(callback).also { transports.add(it) } }, listener) },
            freshCredentials = { _, _ ->
                refreshes.incrementAndGet()
                SyncCredentials(authority, if (changedOnRefresh) "other" else user, "device", "new", System.currentTimeMillis() + 180_000)
            },
            offlineEdit = { doc, base, bid, start, end, text, draft -> OfflineEditor.replaceBlockText(store, doc, base, bid, start, end, text, draft) },
            recoveredText = { store.recovered(it) },
            deleteRecoveredText = { doc, id -> store.deleteRecovered(doc, id) },
            saveRecoveredText = { doc, draft -> store.saveRecoveredText(doc, draft) },
            writeWorkingDraft = { doc, token, draft -> if (failDraftBackup.get()) throw IOException("disk unavailable"); store.saveWorkingDraft(doc, token, draft) },
            removeWorkingDraft = { doc, token -> store.discardWorkingDraft(doc, token); Unit },
            historyListOverride = { _, _, _, _ -> emptyList() },
            historyCreateOverride = { _, _, _, _, _ -> versionRequests.incrementAndGet(); throw IOException("response lost") },
            rememberAccess = { doc, device, endpoint, access -> store.rememberAccess(doc, device, endpoint, access) },
            forgetAccess = { doc -> store.forgetAccess(doc) },
            cachedPages = { server, account, device -> store.cachedPages(server, account, device) },
            loadCached = { doc -> store.load(doc).let { replica -> replica.updates.fold(replica.snapshot ?: byteArrayOf()) { state, update -> YrsNative.merge(state, update.bytes) } } },
        )
        controller = SharedPageController(runtime, authority, "space", retryDelay = { retryMillis.get() })
    }
    @After fun cleanup() { controller.close(); assertTrue(controller.awaitDraftBackups()); runtime.accountChange { }; store.close(); app.deleteDatabase(name) }
    private fun await(condition: () -> Boolean) {
        val end = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < end) { if (condition()) return; Thread.sleep(20) }
        fail("condition timed out")
    }
    private fun start() {
        controller.open("https://sync.example", "page")
        await { controller.state.value.access == "edit" && controller.state.value.blocks.any { it.text == "A😀B" } && transports.isNotEmpty() && transports.last().updates.get() >= 2 }
    }

    @Test fun failedSendReconnectsAndDrainsTheDurableEdit() {
        start()
        val block = controller.state.value.blocks.single()
        controller.edit(block); controller.updateDraft("AXB")
        failNextUpdate.set(true); controller.save()
        await { transports.size >= 2 && controller.state.value.access == "edit" && controller.state.value.blocks.any { it.text == "AXB" } && store.pending(key).isEmpty() }
        assertNull(controller.state.value.draft)
    }

    @Test fun recoveredTextOpensAsDraftAndOnlyChangesPageAfterSave() {
        store.saveRecoveredText(key, DraftCapture("block1", "Recovered work"))
        start(); await { controller.state.value.recovered.any { it.text == "Recovered work" } }
        val entry = controller.state.value.recovered.single { it.text == "Recovered work" }
        controller.editRecovered(entry.id)
        assertEquals("Recovered work", controller.state.value.draft?.text)
        assertEquals("A😀B", controller.state.value.blocks.single().text)
        assertTrue(store.pending(key).isEmpty())
        controller.save()
        await { controller.state.value.draft == null && controller.state.value.blocks.single().text == "Recovered work" && store.pending(key).isEmpty() }
        assertTrue(store.recovered(key).any { it.id == entry.id && it.text == "Recovered work" })
    }

    @Test fun recoveryCannotEditAMissingBlockOrAReadOnlyPage() {
        store.saveRecoveredText(key, DraftCapture("missing-block", "Old text"))
        store.saveRecoveredText(key, DraftCapture("block1", "Protected text"))
        start(); await { controller.state.value.recovered.size == 2 }
        val entries = controller.state.value.recovered
        controller.editRecovered(entries.single { it.blockId == "missing-block" }.id)
        assertNull(controller.state.value.draft)
        transports.last().callback.onAuthenticated("view")
        await { controller.state.value.access == "view" }
        controller.editRecovered(entries.single { it.blockId == "block1" }.id)
        assertNull(controller.state.value.draft)
        assertTrue(store.pending(key).isEmpty())
    }

    @Test fun previouslyOpenedPageCanBeEditedOfflineAfterMemoryAccessReset() {
        start()
        await { runtime.cachedPageList(authority).any { it.page == "page" } }
        controller.close(); assertTrue(controller.awaitDraftBackups()); runtime.accountChange { }
        retryMillis.set(3_000); failFirstOpen.set(true)
        controller = SharedPageController(runtime, authority, "space", retryDelay = { retryMillis.get() })
        controller.open("https://sync.example", "page")
        await { controller.state.value.offline && controller.state.value.blocks.any { it.text == "A😀B" } }
        controller.edit(controller.state.value.blocks.single()); controller.updateDraft("offline after restart"); controller.save()
        await { controller.state.value.draft == null && store.pending(key).size == 1 }
        assertEquals("offline after restart", controller.state.value.blocks.single().text)
        assertNull(runtime.openCached(authority, "https://other.example", "space", "page"))
        await { transports.size >= 3 && !controller.state.value.offline && store.pending(key).isEmpty() }
        assertEquals("offline after restart", controller.state.value.blocks.single().text)
    }

    @Test fun repeatedAuthenticationFailureHidesAndForgetsCachedPage() {
        start(); await { runtime.cachedPageList(authority).isNotEmpty() }
        controller.close(); assertTrue(controller.awaitDraftBackups()); runtime.accountChange { }
        unauthorizedAlways.set(true)
        controller = SharedPageController(runtime, authority, "space", retryDelay = { 20 })
        controller.open("https://sync.example", "page")
        await { controller.state.value.reauth && controller.state.value.disconnected }
        assertTrue(controller.state.value.blocks.isEmpty()); assertNull(controller.state.value.access)
        assertTrue(runtime.cachedPageList(authority).isEmpty())
    }

    @Test fun unfinishedDraftSurvivesScreenCloseAndRemainsAccountScoped() {
        start(); controller.edit(controller.state.value.blocks.single())
        controller.updateDraft("first"); controller.updateDraft("work in progress")
        await { store.recovered(key).singleOrNull()?.text == "work in progress" }
        controller.close(); assertTrue(controller.awaitDraftBackups())
        assertEquals("work in progress", store.recovered(key).single().text)
        assertTrue(store.recovered(key.copy(account = "other")).isEmpty())
        runtime.accountChange { }
        store.close(); store = AndroidSyncStore(app, name)
        assertEquals("work in progress", store.recovered(key).single().text)
    }

    @Test fun explicitCancelAndSuccessfulSaveRemoveWorkingCopy() {
        start(); controller.edit(controller.state.value.blocks.single()); controller.updateDraft("discard me")
        await { store.recovered(key).any { it.text == "discard me" } }
        controller.cancelDraft(); await { store.recovered(key).isEmpty() }
        controller.edit(controller.state.value.blocks.single()); controller.updateDraft("save me")
        await { store.recovered(key).any { it.text == "save me" } }
        controller.save(); await { controller.state.value.draft == null && store.pending(key).isEmpty() && store.recovered(key).isEmpty() }
    }

    @Test fun accountChangeKeepsQueuedDraftUnderThePreviousAccount() {
        start(); controller.edit(controller.state.value.blocks.single())
        controller.updateDraft("private unfinished work")
        runtime.accountChange { user = "other" }
        assertTrue(controller.awaitDraftBackups())
        assertNull(controller.state.value.draft)
        assertEquals("private unfinished work", store.recovered(key).single().text)
        assertTrue(store.recovered(key.copy(account = "other")).isEmpty())
    }

    @Test fun backupFailureIsVisibleWithoutDiscardingTheEditorText() {
        start(); failDraftBackup.set(true)
        controller.edit(controller.state.value.blocks.single()); controller.updateDraft("keep this text")
        await { controller.state.value.draftBackupFailed }
        assertEquals("keep this text", controller.state.value.draft?.text)
        assertTrue(store.recovered(key).isEmpty())
        failDraftBackup.set(false); controller.updateDraft("keep this text!")
        await { !controller.state.value.draftBackupFailed && store.recovered(key).singleOrNull()?.text == "keep this text!" }
    }

    @Test fun uncertainVersionCreationCannotBeRetriedUntilHistoryRefreshes() {
        start(); controller.openHistory()
        await { controller.state.value.historyVisible && !controller.state.value.historyLoading }
        controller.createVersion("Checkpoint")
        await { controller.state.value.historyUncertain && !controller.state.value.historySaving }
        assertTrue(controller.state.value.historyError); assertEquals(1, versionRequests.get())
        controller.createVersion("Checkpoint")
        Thread.sleep(100); assertEquals(1, versionRequests.get())
        controller.openHistory()
        await { !controller.state.value.historyLoading && !controller.state.value.historyUncertain }
        controller.createVersion("Checkpoint")
        await { controller.state.value.historyUncertain }
        assertEquals(2, versionRequests.get())
    }

    @Test fun initialTransportFailureRetriesWithTheSameAccount() {
        failFirstOpen.set(true)
        start()
        assertTrue(transports.size >= 2)
        assertFalse(controller.state.value.reconnecting)
    }

    @Test fun refreshesOpenSocketBeforeTokenExpires() {
        expiry = System.currentTimeMillis() + 44_000
        start()
        await { refreshes.get() >= 1 && socketRefreshes.get() >= 1 }
        assertFalse(controller.state.value.disconnected)
    }

    @Test fun revocationPurgesAndNeverReconnects() {
        start(); transports.last().callback.onClosed(4403)
        await { controller.state.value.revoked && controller.state.value.disconnected }
        Thread.sleep(200)
        assertEquals(1, transports.size)
        assertTrue(store.load(key).updates.isEmpty())
    }

    @Test fun changedAccountCannotBeUsedOnReconnect() {
        start(); user = "different-user"; transports.last().callback.onClosed(1006)
        await { controller.state.value.disconnected && controller.state.value.error }
        assertEquals(1, transports.size)
    }

    @Test fun changedIdentityDuringRefreshClosesInsteadOfSendingToken() {
        expiry = System.currentTimeMillis() + 44_000; changedOnRefresh = true
        start()
        await { controller.state.value.disconnected && controller.state.value.error }
        assertTrue(controller.state.value.reauth); assertTrue(refreshes.get() >= 1); assertEquals(0, socketRefreshes.get()); assertEquals(1, transports.size)
    }

    @Test fun accountChangeStopsRetryAndHidesTheDraft() {
        start(); controller.edit(controller.state.value.blocks.single()); controller.updateDraft("private draft")
        runtime.accountChange { }
        await { controller.state.value.disconnected }
        Thread.sleep(200)
        assertNull(controller.state.value.draft); assertEquals(1, transports.size)
    }

    @Test fun invalidRemoteUpdateStopsInsteadOfRetryingForever() {
        start(); await { store.load(key).updates.size >= 2 }; val before = store.load(key).updates.size
        transports.last().callback.onFrame(SyncWire.Frame.Sync(0, 2, byteArrayOf(0xff.toByte())))
        await { controller.state.value.disconnected && controller.state.value.error }
        Thread.sleep(200)
        assertEquals(1, transports.size)
        assertEquals(before, store.load(key).updates.size)
    }

    @Test fun repeatedUnauthorizedResponsesRequireSignInInsteadOfInfiniteRetry() {
        unauthorizedAlways.set(true)
        controller.open("https://sync.example", "page")
        await { controller.state.value.disconnected && controller.state.value.reauth }
        assertEquals(3, transports.size)
        assertTrue(store.load(key).updates.isNotEmpty())
    }

    @Test fun editsOfflineAndSendsAfterReconnect() {
        start(); retryMillis.set(1_000); transports.last().callback.onClosed(1006)
        await { controller.state.value.offline }
        controller.edit(controller.state.value.blocks.single()); controller.updateDraft("AXB"); controller.save()
        await { controller.state.value.draft == null && store.pending(key).size == 1 }
        assertTrue(controller.state.value.offline)
        await { transports.size >= 2 && !controller.state.value.offline && store.pending(key).isEmpty() }
        assertEquals("AXB", controller.state.value.blocks.single().text)
    }

    @Test fun downgradeArchivesOfflineEditForRecovery() {
        start(); retryMillis.set(1_000); transports.last().callback.onClosed(1006)
        await { controller.state.value.offline }
        level = "view"
        controller.edit(controller.state.value.blocks.single()); controller.updateDraft("AXB"); controller.save()
        await { controller.state.value.draft == null && store.pending(key).size == 1 }
        await { controller.state.value.disconnected && controller.state.value.error }
        assertTrue(store.pending(key).isEmpty())
        val archived = store.rejected(key).single().bytes
        val nodes = JSONObject(YrsNative.editorJson(archived)).getJSONArray("content").getJSONObject(0).getJSONArray("content")
        assertEquals("AXB", (0 until nodes.length()).joinToString("") { nodes.getJSONObject(it).getString("text") })
    }

    @Test fun accountChangeWhileOfflineHidesCachedPageAndDraft() {
        start(); retryMillis.set(2_000); transports.last().callback.onClosed(1006)
        await { controller.state.value.offline }
        controller.edit(controller.state.value.blocks.single()); controller.updateDraft("private draft")
        runtime.accountChange { user = "different-user" }
        assertTrue(controller.state.value.disconnected)
        assertNull(controller.state.value.draft); assertTrue(controller.state.value.blocks.isEmpty())
        Thread.sleep(200); assertEquals(1, transports.size)
    }

    @Test fun revokedOfflineEditRemainsAvailableAsPersonalText() {
        start(); retryMillis.set(1_000); transports.last().callback.onClosed(1006)
        await { controller.state.value.offline }
        controller.edit(controller.state.value.blocks.single()); controller.updateDraft("my unsent work"); controller.save()
        await { controller.state.value.draft == null && store.pending(key).size == 1 }
        revokedOnOpen.set(true)
        await { controller.state.value.revoked && controller.state.value.recovered.any { it.text == "my unsent work" } }
        assertTrue(store.load(key).updates.isEmpty()); assertTrue(store.pending(key).isEmpty())
        assertEquals("revoked", store.recovered(key).single().reason)
        controller.deleteRecovered(controller.state.value.recovered.single().id)
        await { controller.state.value.recovered.isEmpty() }
        assertTrue(store.recovered(key).isEmpty())
    }

    @Test fun revocationAlsoPreservesAnUnfinishedEditorDraft() {
        start(); controller.edit(controller.state.value.blocks.single()); controller.updateDraft("unfinished personal text")
        transports.last().callback.onClosed(4403)
        await { controller.state.value.revoked && controller.state.value.recovered.any { it.text == "unfinished personal text" } }
        assertTrue(controller.state.value.blocks.isEmpty()); assertNull(controller.state.value.draft)
        await { store.recovered(key).size == 1 }
        assertEquals("unfinished", store.recovered(key).single().reason)
        assertTrue(store.load(key).updates.isEmpty())
    }

    @Test fun savingWhileConnectionIsBeingAuthenticatedDoesNotLoseTheEdit() {
        start(); holdAuthentication.set(true); transports.last().callback.onClosed(1006)
        await { controller.state.value.offline && transports.size >= 2 }
        controller.edit(controller.state.value.blocks.single()); controller.updateDraft("AXB"); controller.save()
        await { controller.state.value.saving }
        assertTrue(store.pending(key).isEmpty())
        holdAuthentication.set(false); transports.last().authenticate()
        await { controller.state.value.draft == null && controller.state.value.blocks.single().text == "AXB" && store.pending(key).isEmpty() }
        assertFalse(controller.state.value.offline)
    }
}
