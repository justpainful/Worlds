package worlds.sync

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.security.MessageDigest

/** Identity is part of every key so an account switch cannot drain another account's outbox. */
data class SyncDocumentKey(val account: String, val workspace: String, val page: String, val channel: Int, val authority: String = "") {
    init {
        require(account.isNotBlank() && workspace.isNotBlank() && page.isNotBlank())
        require(channel == SyncWire.CONTENT || channel == SyncWire.COMMENTS)
        require('\u0000' !in authority && '\u0000' !in account)
    }
    internal fun storedAccount(): String {
        if (authority.isEmpty()) return account // Backward compatibility for pre-account test replicas.
        val bytes = MessageDigest.getInstance("SHA-256").digest((authority + '\u0000' + account).toByteArray(Charsets.UTF_8))
        return "authority-v1:" + bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
    }
    internal fun args() = arrayOf(storedAccount(), workspace, page, channel.toString())
}

data class StoredUpdate(val id: Long, val bytes: ByteArray)
data class PendingUpdate(val id: Long, val bytes: ByteArray)
data class SyncReplica(val snapshot: ByteArray?, val snapshotUpto: Long, val generation: Long, val updates: List<StoredUpdate>)
data class RejectedSnapshot(val archiveId: String, val bytes: ByteArray, val reason: String)
data class DraftCapture(val blockId: String, val text: String) {
    override fun toString() = "DraftCapture(blockId=$blockId, text=[redacted])"
}
data class RecoveredText(val id: Long, val blockId: String, val text: String, val reason: String, val createdAt: Long) {
    override fun toString() = "RecoveredText(id=$id, blockId=$blockId, text=[redacted], reason=$reason, createdAt=$createdAt)"
}
data class AccountRecovery(val workspace: String, val page: String, val entry: RecoveredText)
data class CachedPage(val workspace: String, val page: String, val endpoint: String, val level: String)

/** SQLite log and durable outbox. Call on a background dispatcher, never from the UI thread. */
class AndroidSyncStore(context: Context, name: String = "worlds-sync.db") :
    SQLiteOpenHelper(context.applicationContext, name, null, 5) {
    override fun onConfigure(db: SQLiteDatabase) { db.setForeignKeyConstraintsEnabled(true) }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE replica (account TEXT NOT NULL, workspace TEXT NOT NULL, page TEXT NOT NULL, channel INTEGER NOT NULL, snapshot BLOB, snapshot_upto INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(account,workspace,page,channel))")
        db.execSQL("CREATE TABLE updates (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, workspace TEXT NOT NULL, page TEXT NOT NULL, channel INTEGER NOT NULL, data BLOB NOT NULL)")
        db.execSQL("CREATE INDEX updates_document ON updates(account,workspace,page,channel,id)")
        db.execSQL("CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, workspace TEXT NOT NULL, page TEXT NOT NULL, channel INTEGER NOT NULL, data BLOB NOT NULL, state TEXT NOT NULL DEFAULT 'pending', reason TEXT)")
        db.execSQL("CREATE INDEX outbox_document ON outbox(account,workspace,page,channel,state,id)")
        db.execSQL("CREATE TABLE rejected (archive_id TEXT PRIMARY KEY, account TEXT NOT NULL, workspace TEXT NOT NULL, page TEXT NOT NULL, channel INTEGER NOT NULL, snapshot BLOB NOT NULL, reason TEXT NOT NULL)")
        createEndpoints(db)
        createRecovery(db)
        createOfflineGrants(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        require(oldVersion in 1..4 && newVersion == 5) { "No migration from schema $oldVersion to $newVersion" }
        if (oldVersion == 1) createEndpoints(db)
        if (oldVersion <= 2) createRecovery(db) else if (oldVersion == 3) {
            db.execSQL("ALTER TABLE recovered_text ADD COLUMN draft_token TEXT")
            db.execSQL("CREATE UNIQUE INDEX recovered_draft_token ON recovered_text(draft_token)")
        }
        createOfflineGrants(db)
    }

    private fun createOfflineGrants(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE offline_grants (account TEXT NOT NULL, workspace TEXT NOT NULL, page TEXT NOT NULL, device TEXT NOT NULL, endpoint TEXT NOT NULL, level TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(account,workspace,page))")
    }

    fun rememberAccess(key: SyncDocumentKey, device: String, endpoint: String, level: String) = writableDatabase.inTransaction {
        require(key.channel == SyncWire.CONTENT && device.isNotBlank() && device.length <= 128 && endpoint.isNotBlank() && endpoint.length <= 2048 && level in setOf("view", "comment", "edit", "full"))
        val args = arrayOf(key.storedAccount(), key.workspace, key.page)
        val bound = rawQuery("SELECT endpoint FROM sync_endpoints WHERE account=? AND workspace=? AND page=?", args).use { if (it.moveToFirst()) it.getString(0) else null }
        require(bound == endpoint) { "Cached permission requires the bound server" }
        insertWithOnConflict("offline_grants", null, ContentValues().apply {
            put("account", key.storedAccount()); put("workspace", key.workspace); put("page", key.page)
            put("device", device); put("endpoint", endpoint); put("level", level); put("updated_at", System.currentTimeMillis())
        }, SQLiteDatabase.CONFLICT_REPLACE).also { check(it != -1L) }
        Unit
    }

    fun cachedPages(authority: String, account: String, device: String): List<CachedPage> {
        val stored = SyncDocumentKey(account, "_", "_", SyncWire.CONTENT, authority).storedAccount()
        val result = mutableListOf<CachedPage>()
        readableDatabase.rawQuery("SELECT g.workspace,g.page,g.endpoint,g.level FROM offline_grants g WHERE g.account=? AND g.device=? AND (EXISTS(SELECT 1 FROM updates u WHERE u.account=g.account AND u.workspace=g.workspace AND u.page=g.page AND u.channel=0) OR EXISTS(SELECT 1 FROM replica r WHERE r.account=g.account AND r.workspace=g.workspace AND r.page=g.page AND r.channel=0 AND r.snapshot IS NOT NULL)) ORDER BY g.updated_at DESC LIMIT 500", arrayOf(stored, device)).use {
            while (it.moveToNext()) result.add(CachedPage(it.getString(0), it.getString(1), it.getString(2), it.getString(3)))
        }
        return result
    }

    /** Pages with pending work and a matching device-bound authorization and server binding. */
    fun pendingPages(authority: String, account: String, device: String, limit: Int = 9, offset: Int = 0): List<CachedPage> {
        require(authority.isNotBlank() && account.isNotBlank() && device.isNotBlank() && limit in 1..100 && offset in 0..1_000_000)
        val stored = SyncDocumentKey(account, "_", "_", SyncWire.CONTENT, authority).storedAccount()
        val pages = mutableListOf<CachedPage>()
        readableDatabase.rawQuery("""SELECT g.workspace,g.page,g.endpoint,g.level FROM offline_grants g
            INNER JOIN sync_endpoints e ON e.account=g.account AND e.workspace=g.workspace AND e.page=g.page AND e.endpoint=g.endpoint
            WHERE g.account=? AND g.device=? AND EXISTS (SELECT 1 FROM outbox o WHERE o.account=g.account AND o.workspace=g.workspace AND o.page=g.page AND o.state='pending')
            ORDER BY (SELECT MIN(o.id) FROM outbox o WHERE o.account=g.account AND o.workspace=g.workspace AND o.page=g.page AND o.state='pending') LIMIT ? OFFSET ?""", arrayOf(stored, device, limit.toString(), offset.toString())).use {
            while (it.moveToNext()) pages.add(CachedPage(it.getString(0), it.getString(1), it.getString(2), it.getString(3)))
        }
        return pages
    }

    fun forgetAccess(key: SyncDocumentKey) {
        writableDatabase.delete("offline_grants", "account=? AND workspace=? AND page=?", arrayOf(key.storedAccount(), key.workspace, key.page))
    }

    private fun createEndpoints(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE sync_endpoints (account TEXT NOT NULL, workspace TEXT NOT NULL, page TEXT NOT NULL, endpoint TEXT NOT NULL, PRIMARY KEY(account,workspace,page))")
    }

    private fun createRecovery(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE pending_drafts (outbox_id INTEGER PRIMARY KEY, account TEXT NOT NULL, workspace TEXT NOT NULL, page TEXT NOT NULL, channel INTEGER NOT NULL, block_id TEXT NOT NULL, text TEXT NOT NULL, FOREIGN KEY(outbox_id) REFERENCES outbox(id) ON DELETE CASCADE)")
        db.execSQL("CREATE TABLE recovered_text (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, workspace TEXT NOT NULL, page TEXT NOT NULL, channel INTEGER NOT NULL, block_id TEXT NOT NULL, text TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, draft_token TEXT)")
        db.execSQL("CREATE INDEX recovered_document ON recovered_text(account,workspace,page,channel,id)")
        db.execSQL("CREATE UNIQUE INDEX recovered_draft_token ON recovered_text(draft_token)")
    }

    class EndpointConflict : IllegalStateException("This page is bound to a different sync server")
    class UnboundReplica : IllegalStateException("Existing page data has no verified sync server")

    /** Bind before opening a socket. Legacy data with unknown origin is preserved and not sent. */
    fun bindEndpoint(key: SyncDocumentKey, endpoint: String) = writableDatabase.inTransaction {
        require(endpoint.isNotBlank() && endpoint.length <= 2048)
        val args = arrayOf(key.storedAccount(), key.workspace, key.page)
        val existing = rawQuery("SELECT endpoint FROM sync_endpoints WHERE account=? AND workspace=? AND page=?", args).use { if (it.moveToFirst()) it.getString(0) else null }
        if (existing != null) {
            if (existing != endpoint) {
                if (hasPageData(args)) throw EndpointConflict()
                update("sync_endpoints", ContentValues().apply { put("endpoint", endpoint) }, "account=? AND workspace=? AND page=?", args)
            }
            return@inTransaction
        }
        if (hasPageData(args)) throw UnboundReplica()
        insertOrThrow("sync_endpoints", null, ContentValues().apply { put("account", args[0]); put("workspace", args[1]); put("page", args[2]); put("endpoint", endpoint) })
        Unit
    }

    /** A failed connection may release a new binding only if nothing was stored under it. */
    fun releaseEmptyEndpoint(key: SyncDocumentKey, endpoint: String) = writableDatabase.inTransaction {
        val args = arrayOf(key.storedAccount(), key.workspace, key.page)
        if (!hasPageData(args)) delete("sync_endpoints", "account=? AND workspace=? AND page=? AND endpoint=?", args + endpoint)
        Unit
    }

    private fun SQLiteDatabase.hasPageData(args: Array<String>): Boolean {
        val where = "account=? AND workspace=? AND page=?"
        if (rawQuery("SELECT 1 FROM replica WHERE $where AND snapshot IS NOT NULL LIMIT 1", args).use { it.moveToFirst() }) return true
        return listOf("updates", "outbox", "rejected").any { table -> rawQuery("SELECT 1 FROM $table WHERE $where LIMIT 1", args).use { it.moveToFirst() } }
    }

    fun append(key: SyncDocumentKey, update: ByteArray, local: Boolean, draft: DraftCapture? = null) = writableDatabase.inTransaction {
        require(update.isNotEmpty())
        require(draft == null || local)
        if (draft != null) require(draft.blockId.isNotBlank() && draft.blockId.length <= 128 && draft.text.toByteArray(Charsets.UTF_8).size <= 1_000_000)
        ensureReplica(key)
        insertOrThrow("updates", null, key.values().apply { put("data", update) })
        if (local) {
            val outboxId = insertOrThrow("outbox", null, key.values().apply { put("data", update) })
            if (draft != null) insertOrThrow("pending_drafts", null, key.values().apply { put("outbox_id", outboxId); put("block_id", draft.blockId); put("text", draft.text) })
        }
        Unit
    }

    fun load(key: SyncDocumentKey): SyncReplica = readableDatabase.inTransaction {
        val checkpoint = rawQuery("SELECT snapshot,snapshot_upto,generation FROM replica WHERE $WHERE", key.args()).use {
            if (it.moveToFirst()) Triple(if (it.isNull(0)) null else it.getBlob(0), it.getLong(1), it.getLong(2)) else Triple(null, 0L, 0L)
        }
        val updates = mutableListOf<StoredUpdate>()
        rawQuery("SELECT id,data FROM updates WHERE $WHERE ORDER BY id", key.args()).use {
            while (it.moveToNext()) updates.add(StoredUpdate(it.getLong(0), it.getBlob(1)))
        }
        SyncReplica(checkpoint.first, checkpoint.second, checkpoint.third, updates)
    }

    /** Snapshot must be created from the loaded state through the supplied update ID. */
    fun compact(key: SyncDocumentKey, expectedGeneration: Long, upto: Long, snapshot: ByteArray) = writableDatabase.inTransaction {
        require(upto >= 0 && snapshot.isNotEmpty())
        ensureReplica(key)
        val checkpoint = rawQuery("SELECT snapshot_upto,generation FROM replica WHERE $WHERE", key.args()).use { it.moveToFirst(); Pair(it.getLong(0), it.getLong(1)) }
        require(checkpoint.second == expectedGeneration) { "Replica was reset" }
        val old = checkpoint.first
        val max = rawQuery("SELECT COALESCE(MAX(id),0) FROM updates WHERE $WHERE", key.args()).use { it.moveToFirst(); it.getLong(0) }
        require(upto >= old && upto <= maxOf(old, max)) { "Invalid snapshot boundary" }
        update("replica", ContentValues().apply { put("snapshot", snapshot); put("snapshot_upto", upto) }, WHERE, key.args())
        delete("updates", "$WHERE AND id<=?", key.args() + upto.toString())
        Unit
    }

    fun pending(key: SyncDocumentKey): List<PendingUpdate> {
        val items = mutableListOf<PendingUpdate>()
        readableDatabase.rawQuery("SELECT id,data FROM outbox WHERE $WHERE AND state='pending' ORDER BY id", key.args()).use {
            while (it.moveToNext()) items.add(PendingUpdate(it.getLong(0), it.getBlob(1)))
        }
        return items
    }

    fun rejected(key: SyncDocumentKey): List<RejectedSnapshot> {
        val items = mutableListOf<RejectedSnapshot>()
        readableDatabase.rawQuery("SELECT archive_id,snapshot,reason FROM rejected WHERE $WHERE ORDER BY rowid", key.args()).use {
            while (it.moveToNext()) items.add(RejectedSnapshot(it.getString(0), it.getBlob(1), it.getString(2)))
        }
        return items
    }

    fun recovered(key: SyncDocumentKey): List<RecoveredText> {
        val items = mutableListOf<RecoveredText>()
        readableDatabase.rawQuery("SELECT id,block_id,text,reason,created_at FROM recovered_text WHERE $WHERE ORDER BY id", key.args()).use {
            while (it.moveToNext()) items.add(RecoveredText(it.getLong(0), it.getString(1), it.getString(2), it.getString(3), it.getLong(4)))
        }
        return items
    }

    fun recoveredForAccount(authority: String, account: String, before: Long? = null, limit: Int = 50): List<AccountRecovery> {
        require(authority.isNotBlank() && account.isNotBlank() && limit in 1..100 && (before == null || before > 0))
        val stored = SyncDocumentKey(account, "_", "_", SyncWire.CONTENT, authority).storedAccount()
        val args = if (before == null) arrayOf(stored, limit.toString()) else arrayOf(stored, before.toString(), limit.toString())
        val where = if (before == null) "account=? AND channel=0" else "account=? AND channel=0 AND id<?"
        val items = mutableListOf<AccountRecovery>()
        readableDatabase.rawQuery("SELECT workspace,page,id,block_id,text,reason,created_at FROM recovered_text WHERE $where ORDER BY id DESC LIMIT ?", args).use {
            while (it.moveToNext()) items.add(AccountRecovery(it.getString(0), it.getString(1), RecoveredText(it.getLong(2), it.getString(3), it.getString(4), it.getString(5), it.getLong(6))))
        }
        return items
    }

    fun deleteRecovered(key: SyncDocumentKey, id: Long): Boolean {
        require(id > 0)
        return writableDatabase.delete("recovered_text", "$WHERE AND id=?", key.args() + id.toString()) == 1
    }

    /** Store an unfinished user draft separately from the revoked shared replica. */
    fun saveRecoveredText(key: SyncDocumentKey, draft: DraftCapture) {
        require(draft.blockId.isNotBlank() && draft.blockId.length <= 128 && draft.text.toByteArray(Charsets.UTF_8).size <= 1_000_000)
        writableDatabase.insertOrThrow("recovered_text", null, key.values().apply {
            put("block_id", draft.blockId); put("text", draft.text); put("reason", "unfinished"); put("created_at", System.currentTimeMillis())
        })
    }

    /** One mutable private recovery copy per editor instance. Caller serializes updates and deletion. */
    fun saveWorkingDraft(key: SyncDocumentKey, token: String, draft: DraftCapture) = writableDatabase.inTransaction {
        require(token.matches(Regex("[a-f0-9-]{36}")) && draft.blockId.isNotBlank() && draft.blockId.length <= 128 && draft.text.toByteArray(Charsets.UTF_8).size <= 1_000_000)
        val values = key.values().apply { put("draft_token", token); put("block_id", draft.blockId); put("text", draft.text); put("reason", "unfinished"); put("created_at", System.currentTimeMillis()) }
        val updated = update("recovered_text", values, "$WHERE AND draft_token=?", key.args() + token)
        if (updated == 0) insertOrThrow("recovered_text", null, values)
        Unit
    }

    fun discardWorkingDraft(key: SyncDocumentKey, token: String): Boolean =
        writableDatabase.delete("recovered_text", "$WHERE AND draft_token=?", key.args() + token) == 1

    /** Call only for the server's successful acknowledgement of this document and batch. */
    fun acknowledgeThrough(key: SyncDocumentKey, id: Long): Int {
        require(id >= 0)
        return writableDatabase.delete("outbox", "$WHERE AND state='pending' AND id<=?", key.args() + id.toString())
    }

    /** Drop a revoked page's active replica and outbox for this account across both channels. */
    fun purgeRevokedPage(key: SyncDocumentKey) = writableDatabase.inTransaction {
        val where = "account=? AND workspace=? AND page=?"
        val args = arrayOf(key.storedAccount(), key.workspace, key.page)
        captureRecovery(args, "revoked")
        delete("offline_grants", where, args)
        // Keep only the generation fence so an in-flight compaction cannot restore revoked data.
        execSQL("UPDATE replica SET snapshot=NULL,snapshot_upto=0,generation=generation+1 WHERE $where", args)
        for (table in listOf("updates", "outbox", "rejected")) delete(table, where, args)
        Unit
    }

    /** Preserve refused edits before resetting the replica. An archive ID cannot cross documents. */
    fun archiveRejection(key: SyncDocumentKey, archiveId: String, snapshot: ByteArray, empty: ByteArray, reason: String) = writableDatabase.inTransaction {
        require(archiveId.isNotBlank() && snapshot.isNotEmpty() && snapshot.size <= 64 * 1024 * 1024)
        require(empty.isNotEmpty() && empty.size <= 1024 && reason.length <= 10_000)
        val existing = rawQuery("SELECT account,workspace,page,channel FROM rejected WHERE archive_id=?", arrayOf(archiveId)).use {
            if (it.moveToFirst()) listOf(it.getString(0), it.getString(1), it.getString(2), it.getInt(3).toString()) else null
        }
        require(existing == null || existing == key.args().toList()) { "Archive belongs to another document" }
        val archive = key.values().apply { put("archive_id", archiveId); put("snapshot", snapshot); put("reason", reason) }
        if (existing == null) insertOrThrow("rejected", null, archive)
        else update("rejected", archive, "archive_id=?", arrayOf(archiveId))
        captureRecovery(arrayOf(key.storedAccount(), key.workspace, key.page), "rejected", key.channel)
        update("outbox", ContentValues().apply { put("state", "rejected"); put("reason", reason) }, "$WHERE AND state='pending'", key.args())
        ensureReplica(key)
        execSQL("UPDATE replica SET snapshot=?,snapshot_upto=0,generation=generation+1 WHERE $WHERE", arrayOf(empty, *key.args()))
        delete("updates", WHERE, key.args())
        Unit
    }

    private fun SQLiteDatabase.captureRecovery(pageArgs: Array<String>, reason: String, channel: Int? = null) {
        val filter = "account=? AND workspace=? AND page=?" + if (channel == null) "" else " AND channel=?"
        val args = if (channel == null) pageArgs else pageArgs + channel.toString()
        execSQL("INSERT INTO recovered_text(account,workspace,page,channel,block_id,text,reason,created_at) SELECT account,workspace,page,channel,block_id,text,?,? FROM pending_drafts WHERE $filter", arrayOf<Any>(reason, System.currentTimeMillis(), *args))
        delete("pending_drafts", filter, args)
    }

    private fun SQLiteDatabase.ensureReplica(key: SyncDocumentKey) {
        insertWithOnConflict("replica", null, key.values(), SQLiteDatabase.CONFLICT_IGNORE)
    }

    private fun SyncDocumentKey.values() = ContentValues().apply {
        put("account", storedAccount()); put("workspace", workspace); put("page", page); put("channel", channel)
    }

    private inline fun <T> SQLiteDatabase.inTransaction(block: SQLiteDatabase.() -> T): T {
        beginTransaction()
        try { val result = block(); setTransactionSuccessful(); return result } finally { endTransaction() }
    }

    companion object { private const val WHERE = "account=? AND workspace=? AND page=? AND channel=?" }
}
