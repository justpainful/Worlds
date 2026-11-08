package worlds.android

import android.content.Context
import worlds.identity.EncryptedSessionStore
import worlds.identity.IdentityService
import worlds.identity.canonicalBaseUrl
import worlds.sync.AndroidSyncStore
import worlds.sync.SyncDocumentKey
import worlds.sync.SyncSession
import worlds.sync.SyncWire
import worlds.sync.OfflineEditor
import worlds.sync.RecoveredText
import worlds.sync.DraftCapture
import worlds.sync.AccountRecovery
import worlds.sync.SharedNotifications
import worlds.sync.NoticeFeed
import worlds.sync.SharedHistory
import worlds.sync.SharedVersion
import worlds.sync.CachedPage
import worlds.sync.YrsNative
import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean

internal data class SyncCredentials(val authority: String, val userId: String, val deviceId: String, val token: String, val expiresAt: Long = Long.MAX_VALUE) {
    override fun toString() = "SyncCredentials(authority=$authority, userId=$userId, deviceId=$deviceId, token=[redacted])"
}
internal data class SyncPrincipal(val authority: String, val userId: String, val deviceId: String)
internal data class OpenedSync(val session: SyncSession, val principal: SyncPrincipal, val expiresAt: Long)

/** Process-wide gate between account changes and shared document sessions. Blocking I/O: call on IO dispatcher. */
internal class AccountSyncRuntime(
    private val credentials: (String) -> SyncCredentials,
    private val makeSession: (SyncDocumentKey, String, String, SyncSession.Listener) -> SyncSession,
    private val freshCredentials: (String, Long) -> SyncCredentials = { server, _ -> credentials(server) },
    private val offlinePrincipal: (String) -> SyncPrincipal = { server -> credentials(server).let { SyncPrincipal(it.authority, it.userId, it.deviceId) } },
    private val offlineEdit: (SyncDocumentKey, ByteArray, String, Int, Int, String, String) -> ByteArray = { _, _, _, _, _, _, _ -> error("Offline editing is unavailable") },
    private val offlineAppend: (SyncDocumentKey, String, String) -> ByteArray = { _, _, _ -> error("Offline editing is unavailable") },
    private val offlineInsert: (SyncDocumentKey, ByteArray, String, String, String, Int, String?) -> ByteArray = { _, _, _, _, _, _, _ -> error("Offline editing is unavailable") },
    private val offlineDuplicate: (SyncDocumentKey, ByteArray, String, String) -> ByteArray = { _, _, _, _ -> error("Offline editing is unavailable") },
    private val recoveredText: (SyncDocumentKey) -> List<RecoveredText> = { emptyList() },
    private val deleteRecoveredText: (SyncDocumentKey, Long) -> Boolean = { _, _ -> false },
    private val saveRecoveredText: (SyncDocumentKey, DraftCapture) -> Unit = { _, _ -> error("Recovery is unavailable") },
    private val writeWorkingDraft: (SyncDocumentKey, String, DraftCapture) -> Unit = { _, _, _ -> error("Draft backup is unavailable") },
    private val removeWorkingDraft: (SyncDocumentKey, String) -> Unit = { _, _ -> },
    private val accountRecovery: (String, String, Long?) -> List<AccountRecovery> = { _, _, _ -> emptyList() },
    private val bindEndpoint: (SyncDocumentKey, String) -> Unit = { _, _ -> },
    private val releaseEmptyEndpoint: (SyncDocumentKey, String) -> Unit = { _, _ -> },
    private val allowLoopbackForTests: Boolean = false,
    private val historyListOverride: ((String, String, String, String) -> List<SharedVersion>)? = null,
    private val historyCreateOverride: ((String, String, String, String, String?) -> SharedVersion)? = null,
    private val historyStateOverride: ((String, String, String, String, String) -> ByteArray)? = null,
    private val rememberAccess: (SyncDocumentKey, String, String, String) -> Unit = { _, _, _, _ -> },
    private val forgetAccess: (SyncDocumentKey) -> Unit = { _ -> },
    private val cachedPages: (String, String, String) -> List<CachedPage> = { _, _, _ -> emptyList() },
    private val loadCached: (SyncDocumentKey) -> ByteArray = { error("Cached page unavailable") },
    private val scheduleOutboxWork: (SyncPrincipal, String, String, String) -> Unit = { _, _, _, _ -> },
    private val ensureSweepWork: () -> Unit = {},
) {
    private val lock = Any()
    private val sessions = mutableMapOf<SyncSession, SyncDocumentKey>()
    private val access = mutableMapOf<SyncDocumentKey, String>()
    private val accountObservers = mutableSetOf<() -> Unit>()
    private var changingAccount = false

    fun open(identityServer: String, syncServer: String, workspace: String, page: String, listener: SyncSession.Listener): SyncSession =
        openBound(identityServer, syncServer, workspace, page, listener).session

    fun openBound(identityServer: String, syncServer: String, workspace: String, page: String, listener: SyncSession.Listener, expected: SyncPrincipal? = null): OpenedSync = synchronized(lock) {
        check(!changingAccount) { "Account change in progress" }
        val authority = canonicalBaseUrl(identityServer)
        val current = credentials(authority)
        require(current.authority == authority && current.userId.isNotBlank() && current.deviceId.isNotBlank())
        val principal = SyncPrincipal(authority, current.userId, current.deviceId)
        require(expected == null || expected == principal) { "Account or device changed" }
        val key = SyncDocumentKey(current.userId, workspace, page, SyncWire.CONTENT, authority)
        if (sessions.values.any { it == key }) throw SessionActive()
        val endpoint = canonicalSyncEndpoint(syncServer, allowLoopbackForTests)
        bindEndpoint(key, endpoint)
        lateinit var session: SyncSession
        val authenticated = AtomicBoolean(false)
        val guarded = object : SyncSession.Listener {
            override fun onSynchronized(channel: Int) = listener.onSynchronized(channel)
            override fun onState(channel: Int, snapshot: ByteArray) = listener.onState(channel, snapshot)
            override fun onAccess(level: String) { synchronized(lock) { check(!changingAccount && sessions[session] == key); rememberAccess(key, principal.deviceId, endpoint, level); authenticated.set(true); access[key] = level }; listener.onAccess(level) }
            override fun onAttention(channel: Int, archiveId: String, reason: String) { synchronized(lock) { access.remove(key); runCatching { forgetAccess(key) } }; listener.onAttention(channel, archiveId, reason) }
            override fun onError() { synchronized(lock) { access.remove(key); runCatching { forgetAccess(key) } }; listener.onError() }
            override fun onTransportFailure() = listener.onTransportFailure()
            override fun onClosed(code: Int?) {
                synchronized(lock) {
                    sessions.remove(session)
                    if (code == 4403 || code == -1 || code == -2) access.remove(key)
                    if (code == 4403 || code == -2) runCatching { forgetAccess(key) }
                    if (!authenticated.get() && sessions.values.none { it == key }) runCatching { releaseEmptyEndpoint(key, endpoint) }
                }
                listener.onClosed(code)
            }
        }
        try { session = makeSession(key, endpoint, current.token, guarded) }
        catch (e: Exception) { runCatching { releaseEmptyEndpoint(key, endpoint) }; throw e }
        sessions[session] = key
        session.start()
        OpenedSync(session, principal, current.expiresAt)
    }

    fun renew(principal: SyncPrincipal, minValidityMillis: Long): SyncCredentials = synchronized(lock) {
        check(!changingAccount) { "Account change in progress" }
        val current = freshCredentials(principal.authority, minValidityMillis)
        require(SyncPrincipal(current.authority, current.userId, current.deviceId) == principal) { "Account or device changed" }
        current
    }

    class SessionActive : IllegalStateException("A document session is active")

    fun ensureBackgroundSweep() { ensureSweepWork() }

    fun scheduleOutbox(principal: SyncPrincipal, endpoint: String, workspace: String, page: String) {
        scheduleOutboxWork(principal, endpoint, workspace, page)
    }

    fun cachedPageList(identityServer: String): List<CachedPage> = synchronized(lock) {
        check(!changingAccount)
        val authority = canonicalBaseUrl(identityServer)
        val principal = offlinePrincipal(authority)
        require(principal.authority == authority)
        cachedPages(authority, principal.userId, principal.deviceId)
    }

    fun forgetCachedAccess(principal: SyncPrincipal, workspace: String, page: String) = synchronized(lock) {
        val key = SyncDocumentKey(principal.userId, workspace, page, SyncWire.CONTENT, principal.authority)
        access.remove(key)
        forgetAccess(key)
    }

    fun openCached(identityServer: String, endpoint: String, workspace: String, page: String): Triple<SyncPrincipal, String, ByteArray>? = synchronized(lock) {
        check(!changingAccount)
        val authority = canonicalBaseUrl(identityServer)
        val principal = offlinePrincipal(authority)
        require(principal.authority == authority)
        val server = canonicalSyncEndpoint(endpoint, allowLoopbackForTests)
        val entry = cachedPages(authority, principal.userId, principal.deviceId).firstOrNull { it.workspace == workspace && it.page == page && it.endpoint == server } ?: return@synchronized null
        val key = SyncDocumentKey(principal.userId, workspace, page, SyncWire.CONTENT, authority)
        check(sessions.values.none { it == key })
        val snapshot = loadCached(key)
        require(snapshot.isNotEmpty())
        access[key] = entry.level
        Triple(principal, entry.level, snapshot)
    }

    /** Last confirmed edit permission is rechecked by the server when the queued update is sent. */
    fun editOffline(principal: SyncPrincipal, workspace: String, page: String, base: ByteArray, bid: String, start: Int, end: Int, text: String, draftText: String, isValid: () -> Boolean = { true }): ByteArray = synchronized(lock) {
        check(!changingAccount && isValid())
        require(offlinePrincipal(principal.authority) == principal) { "Account or device changed" }
        val key = SyncDocumentKey(principal.userId, workspace, page, SyncWire.CONTENT, principal.authority)
        require(access[key] in setOf("edit", "full")) { "No confirmed edit access" }
        if (sessions.values.any { it == key }) throw SessionActive()
        check(isValid())
        offlineEdit(key, base, bid, start, end, text, draftText)
    }

    fun appendOffline(principal: SyncPrincipal, workspace: String, page: String, bid: String, text: String, isValid: () -> Boolean = { true }): ByteArray = synchronized(lock) {
        check(!changingAccount && isValid())
        require(offlinePrincipal(principal.authority) == principal) { "Account or device changed" }
        val key = SyncDocumentKey(principal.userId, workspace, page, SyncWire.CONTENT, principal.authority)
        require(access[key] in setOf("edit", "full")) { "No confirmed edit access" }
        if (sessions.values.any { it == key }) throw SessionActive()
        check(isValid())
        offlineAppend(key, bid, text)
    }

    fun insertOffline(principal: SyncPrincipal, workspace: String, page: String, base: ByteArray, bid: String, text: String, kind: String, level: Int, after: String?, isValid: () -> Boolean = { true }): ByteArray = synchronized(lock) {
        check(!changingAccount && isValid())
        require(offlinePrincipal(principal.authority) == principal) { "Account or device changed" }
        val key = SyncDocumentKey(principal.userId, workspace, page, SyncWire.CONTENT, principal.authority)
        require(access[key] in setOf("edit", "full")) { "No confirmed edit access" }
        if (sessions.values.any { it == key }) throw SessionActive()
        check(isValid())
        offlineInsert(key, base, bid, text, kind, level, after)
    }

    fun duplicateOffline(principal: SyncPrincipal, workspace: String, page: String, base: ByteArray, source: String, bid: String, isValid: () -> Boolean = { true }): ByteArray = synchronized(lock) {
        check(!changingAccount && isValid())
        require(offlinePrincipal(principal.authority) == principal) { "Account or device changed" }
        val key = SyncDocumentKey(principal.userId, workspace, page, SyncWire.CONTENT, principal.authority)
        require(access[key] in setOf("edit", "full")) { "No confirmed edit access" }
        if (sessions.values.any { it == key }) throw SessionActive()
        check(isValid())
        offlineDuplicate(key, base, source, bid)
    }

    fun recovered(principal: SyncPrincipal, workspace: String, page: String): List<RecoveredText> = synchronized(lock) {
        check(!changingAccount)
        require(offlinePrincipal(principal.authority) == principal) { "Account or device changed" }
        recoveredText(SyncDocumentKey(principal.userId, workspace, page, SyncWire.CONTENT, principal.authority))
    }

    fun deleteRecovered(principal: SyncPrincipal, workspace: String, page: String, id: Long): Boolean = synchronized(lock) {
        check(!changingAccount)
        require(offlinePrincipal(principal.authority) == principal) { "Account or device changed" }
        deleteRecoveredText(SyncDocumentKey(principal.userId, workspace, page, SyncWire.CONTENT, principal.authority), id)
    }

    fun recoveryPage(identityServer: String, expected: SyncPrincipal?, before: Long?): Pair<SyncPrincipal, List<AccountRecovery>> = synchronized(lock) {
        check(!changingAccount)
        val authority = canonicalBaseUrl(identityServer)
        val principal = offlinePrincipal(authority)
        require(principal.authority == authority && (expected == null || expected == principal)) { "Account or device changed" }
        principal to accountRecovery(authority, principal.userId, before)
    }

    fun history(principal: SyncPrincipal, endpoint: String, workspace: String, page: String, version: String? = null): Pair<List<SharedVersion>?, ByteArray?> = synchronized(lock) {
        check(!changingAccount)
        val key = SyncDocumentKey(principal.userId, workspace, page, SyncWire.CONTENT, principal.authority)
        require(sessions.values.any { it == key } && access[key] in setOf("view", "comment", "edit", "full")) { "Shared page is not open" }
        val current = freshCredentials(principal.authority, 30_000)
        require(SyncPrincipal(current.authority, current.userId, current.deviceId) == principal) { "Account or device changed" }
        val api = SharedHistory(allowInsecureLoopback = allowLoopbackForTests)
        val server = canonicalSyncEndpoint(endpoint, allowLoopbackForTests)
        if (version == null) (historyListOverride?.invoke(server, workspace, page, current.token) ?: api.list(server, workspace, page, current.token)) to null
        else null to (historyStateOverride?.invoke(server, workspace, page, current.token, version) ?: api.state(server, workspace, page, current.token, version))
    }

    fun notices(principal: SyncPrincipal, endpoint: String, workspace: String, page: String, mark: Boolean = false, ids: List<String>? = null): NoticeFeed = synchronized(lock) {
        check(!changingAccount)
        val key = SyncDocumentKey(principal.userId, workspace, page, SyncWire.CONTENT, principal.authority)
        require(sessions.values.any { it == key } && access[key] in setOf("view", "comment", "edit", "full"))
        val current = freshCredentials(principal.authority, 30_000)
        require(SyncPrincipal(current.authority, current.userId, current.deviceId) == principal)
        val server = canonicalSyncEndpoint(endpoint, allowLoopbackForTests)
        val api = SharedNotifications(allowLoopbackForTests)
        if (mark) api.markRead(server, current.token, ids)
        api.list(server, current.token)
    }

    fun createVersion(principal: SyncPrincipal, endpoint: String, workspace: String, page: String, expectedSession: SyncSession, label: String?): SharedVersion = synchronized(lock) {
        check(!changingAccount)
        val key = SyncDocumentKey(principal.userId, workspace, page, SyncWire.CONTENT, principal.authority)
        require(sessions[expectedSession] == key && access[key] in setOf("edit", "full")) { "Shared page is not editable" }
        val current = freshCredentials(principal.authority, 30_000)
        require(SyncPrincipal(current.authority, current.userId, current.deviceId) == principal) { "Account or device changed" }
        val server = canonicalSyncEndpoint(endpoint, allowLoopbackForTests)
        historyCreateOverride?.invoke(server, workspace, page, current.token, label)
            ?: SharedHistory(allowInsecureLoopback = allowLoopbackForTests).create(server, workspace, page, current.token, label)
    }

    fun saveUnfinished(principal: SyncPrincipal, workspace: String, page: String, blockId: String, text: String) = synchronized(lock) {
        check(!changingAccount)
        require(offlinePrincipal(principal.authority) == principal) { "Account or device changed" }
        saveRecoveredText(SyncDocumentKey(principal.userId, workspace, page, SyncWire.CONTENT, principal.authority), DraftCapture(blockId, text))
    }

    // The principal was captured from the open session. These scoped writes may finish after
    // sign-out so the old account's queued draft is not lost during the account transition.
    fun backupWorkingDraft(principal: SyncPrincipal, workspace: String, page: String, token: String, draft: DraftCapture) =
        writeWorkingDraft(SyncDocumentKey(principal.userId, workspace, page, SyncWire.CONTENT, principal.authority), token, draft)

    fun discardWorkingDraft(principal: SyncPrincipal, workspace: String, page: String, token: String) =
        removeWorkingDraft(SyncDocumentKey(principal.userId, workspace, page, SyncWire.CONTENT, principal.authority), token)

    fun observeAccountChanges(observer: () -> Unit): AutoCloseable {
        synchronized(lock) { accountObservers.add(observer) }
        return AutoCloseable { synchronized(lock) { accountObservers.remove(observer) } }
    }

    /** Prevents new sessions until every old connection is closed and the account operation ends. */
    fun <T> accountChange(action: () -> T): T {
        val (old, observers) = synchronized(lock) {
            check(!changingAccount) { "Account change already in progress" }
            changingAccount = true
            access.clear()
            sessions.keys.toList() to accountObservers.toList()
        }
        try {
            observers.forEach { runCatching { it() } }
            old.forEach { it.closeForAccountChange() }
            check(old.all { it.closeAndWait() }) { "Could not close shared sessions" }
            return action()
        } finally {
            synchronized(lock) { changingAccount = false }
        }
    }
}

internal fun canonicalSyncEndpoint(value: String, allowLoopback: Boolean): String {
    val uri = URI(value.trim()).normalize()
    val scheme = uri.scheme?.lowercase()
    val host = uri.host?.lowercase()
    require(!host.isNullOrBlank() && uri.userInfo == null && uri.rawQuery == null && uri.rawFragment == null)
    require(scheme == "https" || (allowLoopback && scheme == "http" && host in setOf("127.0.0.1", "localhost", "10.0.2.2")))
    require(uri.port == -1 || uri.port in 1..65535)
    require(!uri.rawPath.orEmpty().contains('%'))
    val port = if (scheme == "https" && uri.port == 443 || scheme == "http" && uri.port == 80) -1 else uri.port
    return URI(scheme, null, host, port, uri.path.orEmpty().trimEnd('/'), null, null).toASCIIString()
}

internal object WorldsAccountSync {
    @Volatile private var instance: AccountSyncRuntime? = null
    fun get(context: Context): AccountSyncRuntime = instance ?: synchronized(this) {
        instance ?: run {
            val app = context.applicationContext
            val vault = EncryptedSessionStore(app)
            val store = AndroidSyncStore(app)
            AccountSyncRuntime(
                credentials = { server ->
                    val session = IdentityService(server, vault, networkAvailable = { networkAvailable(app) }).activeSession()
                    SyncCredentials(session.profile.baseUrl, session.profile.userId, session.profile.deviceId, session.accessToken, session.expiresAt)
                },
                makeSession = { key, syncUrl, token, listener -> SyncSession.connect(store, key, syncUrl, token, listener) },
                freshCredentials = { server, validity ->
                    val session = IdentityService(server, vault, networkAvailable = { networkAvailable(app) }).activeSession(validity)
                    SyncCredentials(session.profile.baseUrl, session.profile.userId, session.profile.deviceId, session.accessToken, session.expiresAt)
                },
                offlinePrincipal = { server ->
                    val session = IdentityService(server, vault).session() ?: throw worlds.identity.ReauthenticationRequired()
                    SyncPrincipal(session.profile.baseUrl, session.profile.userId, session.profile.deviceId)
                },
                offlineEdit = { key, base, bid, start, end, text, draft -> OfflineEditor.replaceBlockText(store, key, base, bid, start, end, text, draft) },
                offlineAppend = { key, bid, text -> OfflineEditor.appendParagraph(store, key, bid, text) },
                offlineInsert = { key, base, bid, text, kind, level, after -> OfflineEditor.insertTextBlock(store, key, base, bid, text, kind, level, after) },
                offlineDuplicate = { key, base, source, bid -> OfflineEditor.duplicateTextBlock(store, key, base, source, bid) },
                recoveredText = { key -> store.recovered(key) },
                deleteRecoveredText = { key, id -> store.deleteRecovered(key, id) },
                saveRecoveredText = { key, draft -> store.saveRecoveredText(key, draft) },
                writeWorkingDraft = { key, token, draft -> store.saveWorkingDraft(key, token, draft) },
                removeWorkingDraft = { key, token -> store.discardWorkingDraft(key, token); Unit },
                accountRecovery = { authority, user, before -> store.recoveredForAccount(authority, user, before) },
                bindEndpoint = { key, endpoint -> store.bindEndpoint(key, endpoint) },
                releaseEmptyEndpoint = { key, endpoint -> store.releaseEmptyEndpoint(key, endpoint) },
                rememberAccess = { key, device, endpoint, level -> store.rememberAccess(key, device, endpoint, level) },
                forgetAccess = { key -> store.forgetAccess(key) },
                cachedPages = { authority, user, device -> store.cachedPages(authority, user, device) },
                loadCached = { key -> store.load(key).let { replica -> replica.updates.fold(replica.snapshot ?: byteArrayOf()) { state, update -> YrsNative.merge(state, update.bytes) } } },
                ensureSweepWork = { BackgroundSync.ensureSweep(app) },
                scheduleOutboxWork = { principal, endpoint, workspace, page ->
                    val key = SyncDocumentKey(principal.userId, workspace, page, SyncWire.CONTENT, principal.authority)
                    if ((0..1).any { store.pending(key.copy(channel = it)).isNotEmpty() }) BackgroundSync.enqueue(app, principal, endpoint, workspace, page)
                },
            ).also { instance = it }
        }
    }
}
