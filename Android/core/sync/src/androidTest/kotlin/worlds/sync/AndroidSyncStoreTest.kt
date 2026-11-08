package worlds.sync

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class AndroidSyncStoreTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "sync-test-${UUID.randomUUID()}.db"
    private lateinit var store: AndroidSyncStore
    private val key = SyncDocumentKey("alice", "team", "page", 0)
    private val other = key.copy(account = "bob")

    @Before fun create() { store = AndroidSyncStore(context, name) }
    @After fun close() { store.close(); context.deleteDatabase(name) }

    @Test fun localWritesAreDurableAndAcknowledgementsAreScoped() {
        store.append(key, byteArrayOf(1), local = true)
        store.append(key, byteArrayOf(2), local = false)
        store.append(other, byteArrayOf(3), local = true)
        val ack = store.pending(key).single().id
        store.close()
        store = AndroidSyncStore(context, name)
        assertEquals(2, store.load(key).updates.size)
        assertEquals(1, store.acknowledgeThrough(key, ack))
        assertTrue(store.pending(key).isEmpty())
        assertEquals(1, store.pending(other).size)
        assertEquals(2, store.load(key).updates.size)
    }

    @Test fun cachedPagesAreBoundToAccountDeviceAndRevocation() {
        val alice = key.copy(authority = "https://identity.example")
        store.bindEndpoint(alice, "https://sync.example")
        store.append(alice, byteArrayOf(1), local = false)
        assertTrue(runCatching { store.rememberAccess(alice, "device-a", "https://different.example", "edit") }.isFailure)
        store.rememberAccess(alice, "device-a", "https://sync.example", "edit")
        assertEquals(listOf("page"), store.cachedPages(alice.authority, "alice", "device-a").map { it.page })
        assertTrue(store.cachedPages(alice.authority, "alice", "device-b").isEmpty())
        assertTrue(store.cachedPages(alice.authority, "bob", "device-a").isEmpty())
        assertTrue(store.cachedPages("https://other.example", "alice", "device-a").isEmpty())
        store.close(); store = AndroidSyncStore(context, name)
        assertEquals("edit", store.cachedPages(alice.authority, "alice", "device-a").single().level)
        store.rememberAccess(alice, "device-a", "https://sync.example", "view")
        assertEquals("view", store.cachedPages(alice.authority, "alice", "device-a").single().level)
        store.purgeRevokedPage(alice)
        assertTrue(store.cachedPages(alice.authority, "alice", "device-a").isEmpty())
    }

    @Test fun pendingPageScanIsAccountDeviceAndEndpointBoundAndDeduplicated() {
        val authority = "https://identity.example"
        val alice = key.copy(authority = authority)
        val second = alice.copy(page = "second")
        val bob = alice.copy(account = "bob", page = "bob-page")
        val unrelated = alice.copy(authority = "https://other.example", page = "other")
        for (doc in listOf(alice, second, bob, unrelated)) {
            store.bindEndpoint(doc, "https://sync.example")
            store.rememberAccess(doc, "device-a", "https://sync.example", "edit")
        }
        store.append(second.copy(channel = 1), byteArrayOf(1), local = true)
        store.append(second, byteArrayOf(2), local = true)
        store.append(alice, byteArrayOf(3), local = true)
        store.append(bob, byteArrayOf(4), local = true)
        store.append(unrelated, byteArrayOf(5), local = true)
        assertEquals(listOf("second", "page"), store.pendingPages(authority, "alice", "device-a").map { it.page })
        assertEquals(listOf("second"), store.pendingPages(authority, "alice", "device-a", 1).map { it.page })
        assertEquals(listOf("page"), store.pendingPages(authority, "alice", "device-a", 1, 1).map { it.page })
        assertTrue(store.pendingPages(authority, "alice", "device-b").isEmpty())
        assertEquals(listOf("bob-page"), store.pendingPages(authority, "bob", "device-a").map { it.page })
        store.forgetAccess(second)
        assertEquals(listOf("page"), store.pendingPages(authority, "alice", "device-a").map { it.page })
        store.acknowledgeThrough(alice, store.pending(alice).single().id)
        assertTrue(store.pendingPages(authority, "alice", "device-a").isEmpty())
    }

    @Test fun revocationPreservesOnlyUnacknowledgedUserDraftsForTheSameAccount() {
        store.append(key, byteArrayOf(1), local = true, draft = DraftCapture("block", "confirmed text"))
        val confirmed = store.pending(key).single().id
        store.acknowledgeThrough(key, confirmed)
        store.append(key, byteArrayOf(2), local = true, draft = DraftCapture("block", "my unsent text"))
        store.append(other, byteArrayOf(3), local = true, draft = DraftCapture("block", "another account"))
        store.purgeRevokedPage(key)
        assertTrue(store.load(key).updates.isEmpty()); assertTrue(store.pending(key).isEmpty())
        assertEquals(listOf("my unsent text"), store.recovered(key).map { it.text })
        assertEquals("revoked", store.recovered(key).single().reason)
        assertTrue(store.recovered(other).isEmpty()); assertEquals(1, store.pending(other).size)
        store.close(); store = AndroidSyncStore(context, name)
        assertEquals("my unsent text", store.recovered(key).single().text)
    }

    @Test fun rejectionCopiesDraftAndLeavesOtherChannelsUntouched() {
        store.append(key, byteArrayOf(1), local = true, draft = DraftCapture("block", "edit to keep"))
        val comments = key.copy(channel = 1)
        store.append(comments, byteArrayOf(2), local = true, draft = DraftCapture("comment", "other channel"))
        store.archiveRejection(key, "archive", byteArrayOf(7), byteArrayOf(0, 0), "denied")
        assertEquals("edit to keep", store.recovered(key).single().text)
        assertEquals("rejected", store.recovered(key).single().reason)
        assertTrue(store.recovered(comments).isEmpty()); assertEquals(1, store.pending(comments).size)
    }

    @Test fun oversizedDraftDoesNotPartiallyAppend() {
        assertTrue(runCatching { store.append(key, byteArrayOf(1), local = true, draft = DraftCapture("block", "a".repeat(1_000_001))) }.isFailure)
        assertTrue(store.pending(key).isEmpty()); assertTrue(store.load(key).updates.isEmpty())
    }

    @Test fun workingDraftUpdatesInPlaceAndDeletionIsAccountScoped() {
        val token = UUID.randomUUID().toString()
        store.saveWorkingDraft(key, token, DraftCapture("block", "first"))
        store.saveWorkingDraft(key, token, DraftCapture("block", "second"))
        assertEquals(listOf("second"), store.recovered(key).map { it.text })
        assertFalse(store.discardWorkingDraft(other, token))
        assertEquals("second", store.recovered(key).single().text)
        store.close(); store = AndroidSyncStore(context, name)
        assertEquals("second", store.recovered(key).single().text)
        assertTrue(store.discardWorkingDraft(key, token)); assertTrue(store.recovered(key).isEmpty())
    }

    @Test fun upgradeFromVersionThreeKeepsRecoveredTextAndAddsWorkingDrafts() {
        val oldName = "v3-sync-${UUID.randomUUID()}.db"
        try {
            AndroidSyncStore(context, oldName).use { initial ->
                initial.saveRecoveredText(key, DraftCapture("block", "older recovery"))
                initial.writableDatabase.execSQL("DROP INDEX recovered_draft_token")
                initial.writableDatabase.execSQL("DROP TABLE offline_grants")
                // Android 11 SQLite cannot drop a column. Recreate the v3 table instead.
                initial.writableDatabase.execSQL("ALTER TABLE recovered_text RENAME TO recovered_text_new")
                initial.writableDatabase.execSQL("CREATE TABLE recovered_text (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, workspace TEXT NOT NULL, page TEXT NOT NULL, channel INTEGER NOT NULL, block_id TEXT NOT NULL, text TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL)")
                initial.writableDatabase.execSQL("INSERT INTO recovered_text(id,account,workspace,page,channel,block_id,text,reason,created_at) SELECT id,account,workspace,page,channel,block_id,text,reason,created_at FROM recovered_text_new")
                initial.writableDatabase.execSQL("DROP TABLE recovered_text_new")
                initial.writableDatabase.execSQL("CREATE INDEX recovered_document ON recovered_text(account,workspace,page,channel,id)")
                initial.writableDatabase.version = 3
            }
            AndroidSyncStore(context, oldName).use { upgraded ->
                val token = UUID.randomUUID().toString()
                upgraded.saveWorkingDraft(key, token, DraftCapture("block", "new draft"))
                assertEquals(listOf("older recovery", "new draft"), upgraded.recovered(key).map { it.text })
            }
        } finally { context.deleteDatabase(oldName) }
    }

    @Test fun upgradeFromVersionFourPreservesDraftRecovery() {
        val oldName = "v4-sync-${UUID.randomUUID()}.db"
        try {
            AndroidSyncStore(context, oldName).use { initial ->
                initial.saveWorkingDraft(key, UUID.randomUUID().toString(), DraftCapture("block", "saved draft"))
                initial.writableDatabase.execSQL("DROP TABLE offline_grants")
                initial.writableDatabase.version = 4
            }
            AndroidSyncStore(context, oldName).use { upgraded ->
                assertEquals("saved draft", upgraded.recovered(key).single().text)
                assertTrue(upgraded.cachedPages("https://identity.example", "alice", "device").isEmpty())
            }
        } finally { context.deleteDatabase(oldName) }
    }

    @Test fun recoveredTextDeletionIsScopedToItsAccountAndDocument() {
        store.saveRecoveredText(key, DraftCapture("block", "private text"))
        val id = store.recovered(key).single().id
        assertFalse(store.deleteRecovered(other, id))
        assertFalse(store.deleteRecovered(key.copy(page = "other"), id))
        assertEquals("private text", store.recovered(key).single().text)
        assertTrue(store.deleteRecovered(key, id)); assertTrue(store.recovered(key).isEmpty())
    }

    @Test fun accountRecoveryIncludesRemovedWorkspacesAndIsolatesAuthoritiesAndUsers() {
        val first = key.copy(authority = "https://identity.example", workspace = "removed-workspace")
        val second = first.copy(workspace = "another-workspace", page = "another-page")
        store.saveRecoveredText(first, DraftCapture("a", "first"))
        store.saveRecoveredText(second, DraftCapture("b", "second"))
        store.saveRecoveredText(first.copy(account = "bob"), DraftCapture("c", "other user"))
        store.saveRecoveredText(first.copy(authority = "https://other.example"), DraftCapture("d", "other server"))
        val page = store.recoveredForAccount("https://identity.example", "alice", null, 1)
        assertEquals(listOf("second"), page.map { it.entry.text })
        val next = store.recoveredForAccount("https://identity.example", "alice", page.single().entry.id, 1)
        assertEquals(listOf("first"), next.map { it.entry.text })
        assertEquals("removed-workspace", next.single().workspace)
        assertTrue(store.recoveredForAccount("https://identity.example", "alice", next.single().entry.id, 1).isEmpty())
    }

    @Test fun sameUserIdOnDifferentIdentityServersHasSeparateReplicas() {
        val first = key.copy(authority = "https://identity-one.example")
        val second = key.copy(authority = "https://identity-two.example")
        store.append(first, byteArrayOf(1), local = true)
        store.append(second, byteArrayOf(2), local = true)
        store.purgeRevokedPage(first)
        assertTrue(store.pending(first).isEmpty())
        assertEquals(1, store.pending(second).size)
        assertArrayEquals(byteArrayOf(2), store.load(second).updates.single().bytes)
    }

    @Test fun endpointBindingPreventsSendingReplicaToAnotherServer() {
        val scoped = key.copy(authority = "https://identity.example")
        store.bindEndpoint(scoped, "https://sync-one.example")
        store.append(scoped, byteArrayOf(1), local = true)
        store.bindEndpoint(scoped, "https://sync-one.example")
        assertTrue(runCatching { store.bindEndpoint(scoped, "https://sync-two.example") }.exceptionOrNull() is AndroidSyncStore.EndpointConflict)
        store.releaseEmptyEndpoint(scoped, "https://sync-one.example")
        assertTrue(runCatching { store.bindEndpoint(scoped, "https://sync-two.example") }.exceptionOrNull() is AndroidSyncStore.EndpointConflict)
        assertEquals(1, store.pending(scoped).size)
    }

    @Test fun legacyUnboundDataIsPreservedAndEmptyFailedBindingCanBeReleased() {
        val legacy = key.copy(authority = "https://identity.example")
        store.append(legacy, byteArrayOf(3), local = true)
        assertTrue(runCatching { store.bindEndpoint(legacy, "https://sync.example") }.exceptionOrNull() is AndroidSyncStore.UnboundReplica)
        assertEquals(1, store.pending(legacy).size)
        val empty = legacy.copy(page = "another-page")
        store.bindEndpoint(empty, "https://wrong.example")
        // An empty abandoned binding can be changed even after a process restart.
        store.bindEndpoint(empty, "https://correct.example")
        store.releaseEmptyEndpoint(empty, "https://correct.example")
        store.bindEndpoint(empty, "https://final.example")
    }

    @Test fun upgradeKeepsLegacyOutboxWithoutAssumingItsServer() {
        val legacyName = "old-sync-${UUID.randomUUID()}.db"
        try {
            context.openOrCreateDatabase(legacyName, Context.MODE_PRIVATE, null).use { db ->
                db.execSQL("CREATE TABLE replica (account TEXT NOT NULL, workspace TEXT NOT NULL, page TEXT NOT NULL, channel INTEGER NOT NULL, snapshot BLOB, snapshot_upto INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(account,workspace,page,channel))")
                db.execSQL("CREATE TABLE updates (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, workspace TEXT NOT NULL, page TEXT NOT NULL, channel INTEGER NOT NULL, data BLOB NOT NULL)")
                db.execSQL("CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, workspace TEXT NOT NULL, page TEXT NOT NULL, channel INTEGER NOT NULL, data BLOB NOT NULL, state TEXT NOT NULL DEFAULT 'pending', reason TEXT)")
                db.execSQL("CREATE TABLE rejected (archive_id TEXT PRIMARY KEY, account TEXT NOT NULL, workspace TEXT NOT NULL, page TEXT NOT NULL, channel INTEGER NOT NULL, snapshot BLOB NOT NULL, reason TEXT NOT NULL)")
                db.execSQL("INSERT INTO outbox(account,workspace,page,channel,data) VALUES(?,?,?,?,?)", arrayOf(key.storedAccount(), key.workspace, key.page, key.channel, byteArrayOf(7)))
                db.version = 1
            }
            AndroidSyncStore(context, legacyName).use { upgraded ->
                assertArrayEquals(byteArrayOf(7), upgraded.pending(key).single().bytes)
                assertTrue(runCatching { upgraded.bindEndpoint(key, "https://sync.example") }.exceptionOrNull() is AndroidSyncStore.UnboundReplica)
                assertEquals(1, upgraded.pending(key).size)
            }
        } finally { context.deleteDatabase(legacyName) }
    }

    @Test fun refusedChangesAreArchivedAndResetInOneTransaction() {
        store.append(key, byteArrayOf(1), local = true)
        store.append(other, byteArrayOf(2), local = true)
        store.archiveRejection(key, "archive", byteArrayOf(7), byteArrayOf(0, 0), "denied")
        assertTrue(store.pending(key).isEmpty())
        assertTrue(store.load(key).updates.isEmpty())
        assertArrayEquals(byteArrayOf(0, 0), store.load(key).snapshot)
        assertArrayEquals(byteArrayOf(7), store.rejected(key).single().bytes)
        assertEquals(1, store.pending(other).size)
        assertTrue(runCatching { store.archiveRejection(other, "archive", byteArrayOf(9), byteArrayOf(0), "denied") }.isFailure)
        assertEquals(1, store.pending(other).size)
    }

    @Test fun compactionKeepsLaterUpdatesAndDoesNotRemoveOutbox() {
        store.append(key, byteArrayOf(1), local = true)
        val boundary = store.load(key).updates.single().id
        store.append(key, byteArrayOf(2), local = true)
        store.compact(key, 0, boundary, byteArrayOf(8))
        val replica = store.load(key)
        assertArrayEquals(byteArrayOf(8), replica.snapshot)
        assertEquals(boundary, replica.snapshotUpto)
        assertArrayEquals(byteArrayOf(2), replica.updates.single().bytes)
        assertEquals(2, store.pending(key).size)
        assertTrue(runCatching { store.compact(key, 0, boundary - 1, byteArrayOf(9)) }.isFailure)
        assertArrayEquals(byteArrayOf(8), store.load(key).snapshot)
        store.archiveRejection(key, "reset", byteArrayOf(8), byteArrayOf(0), "denied")
        store.append(key, byteArrayOf(3), local = true)
        assertTrue(runCatching { store.compact(key, 0, boundary, byteArrayOf(8)) }.isFailure)
        assertArrayEquals(byteArrayOf(0), store.load(key).snapshot)
    }

    @Test fun rejectionFailureRollsBackArchiveAndOutboxChanges() {
        store.append(key, byteArrayOf(1), local = true)
        store.writableDatabase.execSQL("CREATE TRIGGER fail_reset BEFORE DELETE ON updates BEGIN SELECT RAISE(ABORT, 'reset failed'); END")
        assertTrue(runCatching { store.archiveRejection(key, "failed", byteArrayOf(7), byteArrayOf(0), "denied") }.isFailure)
        assertEquals(1, store.pending(key).size)
        assertEquals(1, store.load(key).updates.size)
        assertTrue(store.rejected(key).isEmpty())
        assertNull(store.load(key).snapshot)
    }

    @Test fun outboxInsertFailureRollsBackLocalUpdate() {
        store.writableDatabase.execSQL("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'outbox failed'); END")
        assertTrue(runCatching { store.append(key, byteArrayOf(1), local = true) }.isFailure)
        assertTrue(store.load(key).updates.isEmpty())
        assertTrue(store.pending(key).isEmpty())
    }

    @Test fun revocationPurgesBothChannelsOnlyForTheAffectedAccount() {
        val comments = key.copy(channel = 1)
        store.append(key, byteArrayOf(1), local = true)
        val before = store.load(key)
        store.append(comments, byteArrayOf(2), local = true)
        store.append(other, byteArrayOf(3), local = true)
        store.purgeRevokedPage(key)
        assertTrue(store.load(key).updates.isEmpty())
        assertTrue(store.pending(comments).isEmpty())
        assertEquals(1, store.pending(other).size)
        store.append(key, byteArrayOf(4), local = true)
        assertTrue(runCatching { store.compact(key, before.generation, before.updates.single().id, byteArrayOf(1)) }.isFailure)
    }
}
