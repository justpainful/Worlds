package worlds.android

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.content.Context
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import worlds.content.InlineEditing
import worlds.content.MarkdownExport
import worlds.identity.Workspace
import worlds.identity.ReauthenticationRequired
import worlds.identity.RefreshUncertain
import worlds.identity.IdentityApiException
import worlds.sync.SyncSession
import worlds.sync.AndroidSyncStore
import worlds.sync.SyncWire
import worlds.sync.YrsNative
import worlds.sync.RecoveredText
import worlds.sync.SharedVersion
import worlds.sync.SyncNotice
import worlds.sync.CachedPage
import worlds.sync.DraftCapture
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.UUID
import java.io.IOException
import java.text.DateFormat
import java.util.Date

internal data class SharedBlock(val id: String?, val raw: String, val text: String?, val canEdit: Boolean)
internal data class NotificationTarget(val workspace: String, val page: String, val endpoint: String, val thread: String, val comment: String)
internal data class ConversationMessage(val id: String, val author: String, val body: String, val createdAt: Long, val deleted: Boolean, val editedAt: Long)
internal data class ConversationThread(val id: String, val quote: String, val resolved: Boolean, val createdAt: Long, val comments: List<ConversationMessage>)
internal data class SharedDraft(val block: SharedBlock, val base: ByteArray, val text: String, val isNew: Boolean = false,
    val kind: String = "paragraph", val level: Int = 1, val after: String? = null)

internal fun sharedDraftPreview(draft: SharedDraft): AnnotatedString? {
    if (draft.isNew) return null
    val original = draft.block.text ?: return null
    return runCatching {
        previewBlock(replaceChangedText(draft.block.raw, original, draft.text), interactiveLinks = false).text
    }.getOrNull()?.takeIf { it.text == draft.text }
}
internal enum class EndpointProblem { DIFFERENT_SERVER, UNKNOWN_ORIGIN }
internal data class SharedPageState(val opening: Boolean = false, val access: String? = null, val blocks: List<SharedBlock> = emptyList(),
    val snapshot: ByteArray? = null, val disconnected: Boolean = false, val revoked: Boolean = false, val error: Boolean = false,
    val draft: SharedDraft? = null, val saving: Boolean = false, val reconnecting: Boolean = false, val reauth: Boolean = false, val offline: Boolean = false, val needsAttention: Boolean = false, val endpointProblem: EndpointProblem? = null,
    val recovered: List<RecoveredText> = emptyList(), val draftRecoveryFailed: Boolean = false,
    val historyVisible: Boolean = false, val historyLoading: Boolean = false, val historyError: Boolean = false,
    val versions: List<SharedVersion> = emptyList(), val historyPreview: List<String>? = null, val historyPreviewId: String? = null, val historyPreviewBytes: ByteArray? = null, val historyRestoreConflict: Boolean = false,
    val conversationsVisible: Boolean = false, val commentsSynced: Boolean = false, val focusedThread: String? = null, val focusedComment: String? = null, val conversations: List<ConversationThread> = emptyList(), val people: Map<String, String> = emptyMap(), val conversationsError: Boolean = false, val replySaving: Boolean = false,
    val noticesVisible: Boolean = false, val noticesLoading: Boolean = false, val noticesError: Boolean = false, val notices: List<SyncNotice> = emptyList(), val unread: Int = 0,
    val historySaving: Boolean = false, val historyRestoring: Boolean = false, val historyUncertain: Boolean = false, val historySyncFailed: Boolean = false, val draftBackupFailed: Boolean = false,
    val backgroundScheduleFailed: Boolean = false, val backgroundScheduleRetrying: Boolean = false,
    val markdownExporting: Boolean = false, val markdownStatus: Int? = null, val duplicateError: Boolean = false)

private data class SharedMarkdownSnapshot(val principal: SyncPrincipal, val page: String, val blocks: List<String>)

internal class SharedPageController(private val runtime: AccountSyncRuntime, private val identity: String, private val workspace: String,
    private val retryDelay: (Int) -> Long = { attempt -> (1_000L shl attempt.coerceIn(0, 5)).coerceAtMost(30_000L) },
    private val now: () -> Long = System::currentTimeMillis) : AutoCloseable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val closed = AtomicBoolean(false)
    private val pendingLocalSave = AtomicBoolean(false)
    private val mutable = MutableStateFlow(SharedPageState())
    val state = mutable.asStateFlow()
    @Volatile private var session: SyncSession? = null
    @Volatile private var currentPrincipal: SyncPrincipal? = null
    @Volatile private var currentPage: String = ""
    @Volatile private var currentServer: String = ""
    @Volatile private var markdownSnapshot: SharedMarkdownSnapshot? = null
    private val historyGeneration = AtomicInteger()
    private val noticeGeneration = AtomicInteger()
    private val historyCreating = AtomicBoolean(false)
    private val draftLock = Any()
    private val draftQueue = CoalescingDraftQueue()
    private val draftBackupVersion = AtomicLong()
    @Volatile private var draftToken: String? = null
    private val accountObserver = runtime.observeAccountChanges {
        if (!closed.get()) {
            historyGeneration.incrementAndGet()
            noticeGeneration.incrementAndGet()
            mutable.update { it.copy(access = null, blocks = emptyList(), snapshot = null, draft = null, recovered = emptyList(), saving = false, disconnected = true, reconnecting = false, offline = false, historyVisible = false, conversationsVisible = false, commentsSynced = false, focusedThread = null, focusedComment = null, conversations = emptyList(), people = emptyMap(), replySaving = false, noticesVisible = false, notices = emptyList(), unread = 0, historySaving = false, historyUncertain = false, versions = emptyList(), historyPreview = null, historyPreviewId = null, historyPreviewBytes = null) }
            close()
        }
    }

    fun currentPageId(): String = currentPage

    fun beginMarkdownExport(): Boolean {
        val state = mutable.value
        val principal = currentPrincipal ?: return false
        if (closed.get() || state.access !in setOf("view", "comment", "edit", "full") || state.disconnected || state.snapshot == null || state.markdownExporting) return false
        val blocks = state.blocks.map { it.raw }
        if (blocks.sumOf { it.length.toLong() } > 10_000_000L) {
            mutable.update { it.copy(markdownStatus = R.string.markdown_export_error) }; return false
        }
        markdownSnapshot = SharedMarkdownSnapshot(principal, currentPage, blocks)
        mutable.update { it.copy(markdownExporting = true, markdownStatus = null) }
        return true
    }

    fun finishMarkdownExport(context: Context, uri: Uri?) {
        val captured = markdownSnapshot
        markdownSnapshot = null
        if (uri == null) { mutable.update { it.copy(markdownExporting = false) }; return }
        if (captured == null || closed.get() || currentPrincipal != captured.principal || currentPage != captured.page || mutable.value.access !in setOf("view", "comment", "edit", "full") || mutable.value.disconnected) {
            mutable.update { it.copy(markdownExporting = false, markdownStatus = R.string.markdown_export_interrupted) }; return
        }
        scope.launch {
            val result = runCatching {
                val text = captured.blocks.map { MarkdownExport.block(JSONObject(it)) }.filter { it.isNotBlank() }.joinToString("\n\n") + "\n"
                check(!closed.get() && currentPrincipal == captured.principal && currentPage == captured.page && mutable.value.access in setOf("view", "comment", "edit", "full") && !mutable.value.disconnected)
                requireNotNull(context.contentResolver.openOutputStream(uri, "w")).use { it.write(text.toByteArray(Charsets.UTF_8)); it.flush() }
            }
            if (!closed.get()) mutable.update { it.copy(markdownExporting = false, markdownStatus = if (result.isSuccess) R.string.markdown_export_success else R.string.markdown_export_error) }
        }
    }

    fun markdownPickerFailed() { markdownSnapshot = null; mutable.update { it.copy(markdownExporting = false, markdownStatus = R.string.markdown_export_error) } }

    fun deliverMarkdown(copy: Boolean, deliver: (String) -> Unit) {
        if (!beginMarkdownExport()) return
        val captured = markdownSnapshot ?: return
        markdownSnapshot = null
        scope.launch {
            val text = runCatching { captured.blocks.map { MarkdownExport.block(JSONObject(it)) }.filter { it.isNotBlank() }.joinToString("\n\n") + "\n" }.getOrNull()
            val status = when {
                text == null -> if (copy) R.string.markdown_copy_error else R.string.markdown_share_error
                text.length > MAX_SHARE_TEXT_CHARS -> R.string.shared_markdown_text_limit
                else -> withContext(Dispatchers.Main) {
                    val valid = !closed.get() && currentPrincipal == captured.principal && currentPage == captured.page &&
                        mutable.value.access in setOf("view", "comment", "edit", "full") && !mutable.value.disconnected
                    if (!valid) R.string.markdown_export_interrupted
                    else if (runCatching { deliver(text) }.isFailure) {
                        if (copy) R.string.markdown_copy_error else R.string.markdown_share_error
                    } else if (copy) R.string.markdown_copy_success else null
                }
            }
            if (!closed.get()) mutable.update { it.copy(markdownExporting = false, markdownStatus = status) }
        }
    }

    private fun scheduleOutbox(principal: SyncPrincipal, endpoint: String, page: String) {
        runCatching { runtime.scheduleOutbox(principal, endpoint, workspace, page) }
            .onFailure { if (!closed.get()) mutable.update { it.copy(backgroundScheduleFailed = true) } }
    }
    fun retryBackgroundSchedule() {
        val principal = currentPrincipal ?: return
        if (mutable.value.backgroundScheduleRetrying) return
        mutable.update { it.copy(backgroundScheduleRetrying = true) }
        scope.launch {
            val result = runCatching {
                runtime.ensureBackgroundSweep()
                runtime.scheduleOutbox(principal, currentServer, workspace, currentPage)
            }
            if (!closed.get()) mutable.update { it.copy(backgroundScheduleRetrying = false, backgroundScheduleFailed = result.isFailure) }
        }
    }

    fun open(server: String, page: String) {
        if (mutable.value.opening || session != null || closed.get()) return
        if (server.isBlank() || page.isBlank() || page.length > 128) { mutable.update { it.copy(error = true) }; return }
        currentPage = page.trim()
        currentServer = server.trim()
        mutable.update { it.copy(opening = true, error = false, disconnected = false, revoked = false, reauth = false, endpointProblem = null) }
        scope.launch {
            runCatching { runtime.ensureBackgroundSweep() }.onFailure { if (!closed.get()) mutable.update { it.copy(backgroundScheduleFailed = true) } }
            var principal: SyncPrincipal? = null
            val cached = runCatching { runtime.openCached(identity, server.trim(), workspace, page.trim()) }.getOrNull()
            if (closed.get()) return@launch
            if (cached != null) {
                principal = cached.first; currentPrincipal = cached.first
                acceptSnapshot(cached.third)
                mutable.update { it.copy(access = cached.second, offline = true, reconnecting = true, opening = true) }
                refreshRecovery()
            }
            var attempt = 0
            var unauthorized = 0
            while (isActive && !closed.get()) {
                while (isActive && mutable.value.offline && (mutable.value.draft != null || mutable.value.saving)) delay(50)
                val ended = CompletableDeferred<Int>()
                val ready = CompletableDeferred<Unit>()
                val rejected = AtomicBoolean(false)
                val localFailed = AtomicBoolean(false)
                val refreshFailed = AtomicBoolean(false)
                val attemptListener = listener(ended, ready, rejected, localFailed)
                val opened = try { runtime.openBound(identity, server.trim(), workspace, page.trim(), attemptListener, principal) }
                catch (e: Exception) {
                    if (e is AccountSyncRuntime.SessionActive) { delay(250); continue }
                    if (e is IOException && e !is ReauthenticationRequired && e !is RefreshUncertain &&
                        (e !is IdentityApiException || e.status !in 400..499) && principal != null) {
                        mutable.update { it.copy(opening = true, reconnecting = true) }
                        delay(retryDelay(attempt++)); continue
                    }
                    val needsLogin = e is ReauthenticationRequired || e is RefreshUncertain || (e is IdentityApiException && e.status == 401)
                    val endpointProblem = when (e) { is AndroidSyncStore.EndpointConflict -> EndpointProblem.DIFFERENT_SERVER; is AndroidSyncStore.UnboundReplica -> EndpointProblem.UNKNOWN_ORIGIN; else -> null }
                    mutable.update { it.copy(opening = false, reconnecting = false, error = true, endpointProblem = endpointProblem, reauth = needsLogin, disconnected = principal != null, access = null, blocks = emptyList(), snapshot = null) }
                    break
                }
                principal = opened.principal
                currentPrincipal = opened.principal
                scheduleOutbox(opened.principal, currentServer, currentPage)
                refreshRecovery()
                session = opened.session
                if (closed.get()) { opened.session.close(); break }
                val startedAt = now()
                val refresh = launch {
                    ready.await()
                    var expiry = opened.expiresAt
                    while (isActive && expiry != Long.MAX_VALUE) {
                        delay((expiry - now() - 45_000).coerceAtLeast(1_000))
                        try {
                            val fresh = runtime.renew(opened.principal, 60_000)
                            require(fresh.expiresAt > now())
                            opened.session.refreshToken(fresh.token)
                            expiry = fresh.expiresAt
                        } catch (_: Exception) {
                            refreshFailed.set(true)
                            opened.session.close()
                            break
                        }
                    }
                }
                val code = ended.await()
                refresh.cancel()
                session = null
                if (closed.get()) break
                if (code == 4403 || code == -1 || code == -2 || rejected.get() || localFailed.get() || refreshFailed.get()) {
                    mutable.update { it.copy(opening = false, reconnecting = false, offline = false, access = null, blocks = emptyList(), snapshot = null, disconnected = true, error = it.error || (code != 4403 && code != -1) || it.draftRecoveryFailed, reauth = refreshFailed.get(), revoked = code == 4403, draft = if (code == -1 || (code == 4403 && !it.draftRecoveryFailed)) null else it.draft) }
                    break
                }
                if (code == 4401) {
                    unauthorized = if (now() - startedAt > 60_000) 1 else unauthorized + 1
                    if (unauthorized > 2 || runCatching { runtime.renew(opened.principal, 60_000) }.isFailure) {
                        runCatching { runtime.forgetCachedAccess(opened.principal, workspace, currentPage) }
                        mutable.update { it.copy(opening = false, reconnecting = false, disconnected = true, error = true, reauth = true,
                            offline = false, access = null, blocks = emptyList(), snapshot = null, draft = null) }
                        break
                    }
                }
                if (now() - startedAt > 60_000) attempt = 0
                mutable.update { it.copy(opening = true, reconnecting = true, disconnected = false) }
                delay(retryDelay(attempt++))
            }
        }
    }

    private fun acceptSnapshot(snapshot: ByteArray) {
        if (closed.get()) return
        val result = runCatching {
            val root = JSONObject(YrsNative.editorJson(snapshot))
            val array = root.getJSONArray("content")
            val raw = (0 until array.length()).map { array.getJSONObject(it) }
            val ids = raw.mapNotNull { it.optJSONObject("attrs")?.optString("bid")?.takeIf(String::isNotBlank) }.groupingBy { it }.eachCount()
            raw.map { node ->
                val id = node.optJSONObject("attrs")?.optString("bid")?.takeIf(String::isNotBlank)
                val contents = node.optJSONArray("content")
                val textOnly = contents == null || (0 until contents.length()).all { contents.optJSONObject(it)?.optString("type") == "text" }
                val editable = id != null && ids[id] == 1 && node.optString("type") in setOf("paragraph", "heading") && textOnly
                val text = if (editable) runCatching { InlineEditing.text(node.toString()) }.getOrNull() else null
                SharedBlock(id, node.toString(), text, editable && text != null)
            }
        }
        result.onSuccess { blocks -> mutable.update { it.copy(snapshot = snapshot.copyOf(), blocks = blocks) } }
            .onFailure { mutable.update { it.copy(error = true, snapshot = null, blocks = emptyList()) } }
    }

    private fun acceptConversations(snapshot: ByteArray) {
        if (closed.get()) return
        val result = runCatching {
            val root = JSONObject(YrsNative.commentsJson(snapshot))
            val raw = root.getJSONObject("threads")
            val peopleRaw = root.getJSONObject("people")
            val names = peopleRaw.keys().asSequence().mapNotNull { id -> peopleRaw.optJSONObject(id)?.optString("name")?.takeIf { it.isNotBlank() }?.let { id to it } }.toMap()
            val threads = raw.keys().asSequence().mapNotNull { id ->
                val item = raw.optJSONObject(id) ?: return@mapNotNull null
                val comments = item.optJSONArray("comments")
                val entries = (0 until (comments?.length() ?: 0)).mapNotNull { i ->
                    val c = comments?.optJSONObject(i) ?: return@mapNotNull null
                    val cid = c.optString("id"); val author = c.optString("author")
                    if (cid.isBlank() || author.isBlank()) null else ConversationMessage(cid, author, c.optString("body"), c.optLong("createdAt"), c.optBoolean("deleted"), c.optLong("editedAt"))
                }
                ConversationThread(id, item.optString("quote"), item.optBoolean("resolved"), item.optLong("createdAt"), entries)
            }.sortedBy { it.createdAt }.toList()
            threads to names
        }
        result.onSuccess { (threads, names) -> mutable.update { it.copy(conversations = threads, people = names, conversationsError = false) } }
            .onFailure { mutable.update { it.copy(conversations = emptyList(), people = emptyMap(), conversationsError = true) } }
    }

    fun openConversations() {
        if (currentPrincipal != null && mutable.value.access != null && !mutable.value.offline && !mutable.value.disconnected) mutable.update { it.copy(conversationsVisible = true) }
    }
    fun closeConversations() { if (!mutable.value.replySaving) mutable.update { it.copy(conversationsVisible = false, focusedThread = null, focusedComment = null) } }
    fun showConversation(thread: String, comment: String) {
        if (mutable.value.access != null && !mutable.value.offline && !mutable.value.disconnected) mutable.update { it.copy(noticesVisible = false, conversationsVisible = true, focusedThread = thread, focusedComment = comment) }
    }
    fun showAllConversations() { mutable.update { it.copy(focusedThread = null, focusedComment = null) } }
    fun canEditComment(comment: ConversationMessage): Boolean = currentPrincipal?.userId == comment.author && !comment.deleted
    fun canDeleteComment(thread: ConversationThread, comment: ConversationMessage): Boolean =
        currentPrincipal?.userId == comment.author && !comment.deleted && (thread.comments.firstOrNull()?.id != comment.id || thread.comments.size == 1)
    fun changeConversation(action: String, thread: String, body: String? = null, resolved: Boolean? = null, comment: String? = null, expectedBody: String? = null, onSaved: () -> Unit = {}) {
        val state = mutable.value
        val author = currentPrincipal?.userId ?: return
        val active = session ?: return
        if (!state.conversationsVisible || state.replySaving || state.offline || state.access !in setOf("comment", "edit", "full")) return
        if (action != "create" && state.conversations.none { it.id == thread }) return
        if (action in setOf("create", "reply", "edit") && (body == null || body.isBlank() || body.length > 10_000)) return
        if (action == "edit") {
            val item = state.conversations.singleOrNull { it.id == thread }?.comments?.singleOrNull { it.id == comment }
            if (item == null || !canEditComment(item) || item.body != expectedBody) {
                mutable.update { it.copy(conversationsError = true) }; return
            }
        }
        if (action == "delete") {
            val parent = state.conversations.singleOrNull { it.id == thread } ?: return
            val item = parent.comments.singleOrNull { it.id == comment } ?: return
            if (!canDeleteComment(parent, item)) return
        }
        mutable.update { it.copy(replySaving = true, conversationsError = false) }
        val principal = currentPrincipal; val endpoint = currentServer; val page = currentPage
        active.changeComment(action, thread, author, body, resolved, comment, expectedBody) { saved ->
            if (saved && principal != null) scheduleOutbox(principal, endpoint, page)
            if (!closed.get()) {
                mutable.update { it.copy(replySaving = false, conversationsError = !saved) }
                if (saved) scope.launch(Dispatchers.Main) { if (!closed.get()) onSaved() }
            }
        }
    }

    private fun listener(ended: CompletableDeferred<Int>, ready: CompletableDeferred<Unit>, rejected: AtomicBoolean, localFailed: AtomicBoolean) = object : SyncSession.Listener {
        override fun onSynchronized(channel: Int) { if (channel == SyncWire.COMMENTS && !closed.get()) mutable.update { it.copy(commentsSynced = true) } }
        override fun onState(channel: Int, snapshot: ByteArray) {
            if (channel == SyncWire.CONTENT) acceptSnapshot(snapshot) else if (channel == SyncWire.COMMENTS) acceptConversations(snapshot)
        }
        override fun onAccess(level: String) { if (!closed.get()) { ready.complete(Unit); mutable.update { it.copy(opening = false, reconnecting = false, offline = false, access = level) } } }
        override fun onAttention(channel: Int, archiveId: String, reason: String) { rejected.set(true); if (!closed.get()) { mutable.update { it.copy(error = true, saving = false, needsAttention = true) }; refreshRecovery() } }
        override fun onError() { localFailed.set(true); if (!closed.get()) mutable.update { it.copy(error = true, saving = false) } }
        override fun onTransportFailure() { if (!closed.get()) mutable.update { it.copy(saving = false) } }
        override fun onClosed(code: Int?) {
            historyGeneration.incrementAndGet()
            noticeGeneration.incrementAndGet()
            val draft = mutable.value.draft
            val needsRecovery = code == 4403 && draft != null && draft.text != draft.block.text
            val recoveredDraft = if (needsRecovery) runCatching {
                runtime.saveUnfinished(requireNotNull(currentPrincipal), workspace, currentPage, requireNotNull(draft!!.block.id), draft.text)
            }.isSuccess else true
            if (code == 4403 && recoveredDraft) discardDraftBackup(refresh = true)
            if (!closed.get()) mutable.update {
                val terminal = code == 4403 || code == -1 || code == -2 || rejected.get() || localFailed.get()
                val canStayOffline = !terminal && it.access != null && it.snapshot != null
                it.copy(access = if (canStayOffline) it.access else null, blocks = if (canStayOffline) it.blocks else emptyList(),
                    snapshot = if (canStayOffline) it.snapshot else null, offline = canStayOffline, saving = if (pendingLocalSave.get()) it.saving else false,
                    draftRecoveryFailed = !recoveredDraft, error = it.error || !recoveredDraft, conversationsVisible = false, commentsSynced = false, focusedThread = null, focusedComment = null, conversations = emptyList(), people = emptyMap(), replySaving = false, noticesVisible = false, notices = emptyList(), unread = 0, historyVisible = false, historyUncertain = it.historyUncertain || it.historySaving, historySaving = false, versions = emptyList(), historyPreview = null, historyPreviewId = null, historyPreviewBytes = null,
                    draft = if (code == -1 || (code == 4403 && recoveredDraft)) null else if (code == 4403) it.draft?.copy(base = byteArrayOf()) else it.draft)
            }
            if (code == 4403) refreshRecovery()
            ended.complete(code ?: 0)
        }
    }

    fun closeNotices() {
        noticeGeneration.incrementAndGet()
        mutable.update { it.copy(noticesVisible = false, noticesLoading = false, noticesError = false, notices = emptyList(), unread = 0) }
    }

    fun openNotices() {
        if (currentPrincipal == null || mutable.value.access == null || mutable.value.offline || mutable.value.disconnected) return
        mutable.update { it.copy(noticesVisible = true) }
        refreshNotices()
    }

    fun refreshNotices(mark: Boolean = false, ids: List<String>? = null, open: SyncNotice? = null, onOpen: ((NotificationTarget) -> Unit)? = null) {
        val principal = currentPrincipal ?: return
        if (!mutable.value.noticesVisible || mutable.value.noticesLoading || mutable.value.offline || mutable.value.disconnected) return
        val generation = noticeGeneration.incrementAndGet()
        mutable.update { it.copy(noticesLoading = true, noticesError = false) }
        scope.launch {
            val result = runCatching { runtime.notices(principal, currentServer, workspace, currentPage, mark, ids) }
            if (!closed.get() && generation == noticeGeneration.get()) {
                result.onSuccess { feed ->
                    mutable.update { it.copy(noticesLoading = false, notices = feed.items, unread = feed.unread) }
                    if (open != null && onOpen != null) withContext(Dispatchers.Main) {
                        if (!closed.get() && generation == noticeGeneration.get()) {
                            if (open.workspace == workspace && open.page == currentPage) showConversation(open.thread, open.comment)
                            else onOpen(NotificationTarget(open.workspace, open.page, currentServer, open.thread, open.comment))
                        }
                    }
                }.onFailure { mutable.update { it.copy(noticesLoading = false, noticesError = true) } }
            }
        }
    }

    fun closeHistory() {
        if (mutable.value.historySaving) return
        historyGeneration.incrementAndGet()
        mutable.update { it.copy(historyVisible = false, historyLoading = false, historyError = false, versions = emptyList(), historyPreview = null, historyPreviewId = null, historyPreviewBytes = null) }
    }

    fun openHistory(version: String? = null) {
        if (mutable.value.historySaving) return
        val principal = currentPrincipal ?: return
        if (mutable.value.access == null || mutable.value.offline || mutable.value.disconnected) return
        val generation = historyGeneration.incrementAndGet()
        mutable.update { it.copy(historyVisible = true, historyLoading = true, historyError = false, historySyncFailed = false, historyRestoring = false, historyRestoreConflict = false, historyPreview = null, historyPreviewId = null, historyPreviewBytes = null) }
        scope.launch {
            val result = runCatching {
                val (versions, bytes) = runtime.history(principal, currentServer, workspace, currentPage, version)
                val blocks = bytes?.let { snapshot ->
                    val content = JSONObject(YrsNative.editorJson(snapshot)).getJSONArray("content")
                    require(content.length() <= 10_000)
                    (0 until content.length()).map { content.getJSONObject(it).toString() }
                }
                Triple(versions, blocks, bytes)
            }
            if (!closed.get() && generation == historyGeneration.get()) {
                result.onSuccess { (versions, blocks, bytes) -> mutable.update { it.copy(historyLoading = false, versions = versions ?: it.versions, historyPreview = blocks, historyPreviewId = if (blocks != null) version else null, historyPreviewBytes = bytes, historyUncertain = if (versions != null) false else it.historyUncertain) } }
                    .onFailure { mutable.update { it.copy(historyLoading = false, historyError = true) } }
            }
        }
    }

    fun createVersion(label: String) {
        val principal = currentPrincipal ?: return
        val active = session ?: return
        val state = mutable.value
        if (!state.historyVisible || state.historyLoading || state.historySaving || state.historyUncertain || state.offline || state.access !in setOf("edit", "full")) return
        if (!historyCreating.compareAndSet(false, true)) return
        val generation = historyGeneration.incrementAndGet()
        mutable.update { it.copy(historySaving = true, historyError = false, historySyncFailed = false) }
        scope.launch {
            try {
                val synced = withTimeoutOrNull(15_000) {
                    val done = CompletableDeferred<Boolean>()
                    active.whenContentSynced { done.complete(it) }
                    done.await()
                } == true
                if (!synced) {
                    if (!closed.get() && generation == historyGeneration.get()) mutable.update { it.copy(historySaving = false, historyError = true, historySyncFailed = true) }
                    return@launch
                }
                val result = runCatching { runtime.createVersion(principal, currentServer, workspace, currentPage, active, label.trim().takeIf { it.isNotEmpty() }) }
                if (!closed.get() && generation == historyGeneration.get()) {
                    result.onSuccess { saved -> mutable.update { it.copy(historySaving = false, versions = listOf(saved) + it.versions.filterNot { old -> old.id == saved.id }) } }
                        .onFailure { mutable.update { it.copy(historySaving = false, historyError = true, historyUncertain = true) } }
                }
            } finally { historyCreating.set(false) }
        }
    }

    fun restoreVersion() {
        val principal = currentPrincipal ?: return
        val active = session ?: return
        val state = mutable.value; val version = state.historyPreviewBytes?.copyOf() ?: return
        if (!state.historyVisible || state.historyLoading || state.historySaving || state.historyUncertain || state.offline || state.disconnected || state.draft != null || state.access !in setOf("edit", "full")) return
        if (!historyCreating.compareAndSet(false, true)) return
        val generation = historyGeneration.incrementAndGet()
        mutable.update { it.copy(historySaving = true, historyRestoring = true, historyError = false, historySyncFailed = false, historyRestoreConflict = false) }
        scope.launch {
            try {
                val synced = withTimeoutOrNull(15_000) {
                    val done = CompletableDeferred<Boolean>(); active.whenContentSynced { done.complete(it) }; done.await()
                } == true
                if (!synced) {
                    if (!closed.get() && generation == historyGeneration.get()) mutable.update { it.copy(historySaving = false, historyError = true, historySyncFailed = true) }
                    return@launch
                }
                val base = mutable.value.snapshot?.copyOf()
                if (base == null) {
                    if (!closed.get() && generation == historyGeneration.get()) mutable.update { it.copy(historySaving = false, historyError = true, historySyncFailed = true) }
                    return@launch
                }
                val supported = runCatching { YrsNative.restoreVersion(base, version) }.isSuccess
                if (!supported) {
                    if (!closed.get() && generation == historyGeneration.get()) mutable.update { it.copy(historySaving = false, historyError = true, historyRestoreConflict = true) }
                    return@launch
                }
                val backup = runCatching { runtime.createVersion(principal, currentServer, workspace, currentPage, active, "Before restore") }
                if (backup.isFailure) {
                    if (!closed.get() && generation == historyGeneration.get()) mutable.update { it.copy(historySaving = false, historyError = true, historyUncertain = true) }
                    return@launch
                }
                val saved = withTimeoutOrNull(15_000) {
                    val done = CompletableDeferred<Boolean>(); active.restoreVersion(base, version) { done.complete(it) }; done.await()
                }
                if (saved == true) scheduleOutbox(principal, currentServer, currentPage)
                if (!closed.get() && generation == historyGeneration.get()) {
                    if (saved == true) mutable.update { it.copy(historySaving = false, historyRestoring = false, historyVisible = false, historyPreview = null, historyPreviewId = null, historyPreviewBytes = null) }
                    else mutable.update { it.copy(historySaving = false, historyError = true, historyRestoreConflict = saved == false, historyUncertain = saved == null) }
                }
            } finally { historyCreating.set(false) }
        }
    }

    private fun refreshRecovery() {
        val principal = currentPrincipal ?: return
        scope.launch {
            val result = runCatching { runtime.recovered(principal, workspace, currentPage) }
            if (!closed.get()) result.onSuccess { entries -> mutable.update { it.copy(recovered = entries) } }
        }
    }

    fun deleteRecovered(id: Long) {
        val principal = currentPrincipal ?: return
        scope.launch {
            val deleted = runCatching { runtime.deleteRecovered(principal, workspace, currentPage, id) }.getOrDefault(false)
            if (!closed.get()) {
                if (deleted) refreshRecovery() else mutable.update { it.copy(error = true) }
            }
        }
    }

    /** Open the recovery text as a draft on its original block; no shared update is sent here. */
    fun editRecovered(id: Long) {
        val current = mutable.value
        val entry = current.recovered.firstOrNull { it.id == id } ?: return
        if (current.draft != null || current.saving || current.access !in setOf("edit", "full") || current.snapshot == null) return
        val target = current.blocks.singleOrNull { it.id == entry.blockId && it.canEdit } ?: return
        edit(target)
        if (mutable.value.draft?.block?.id == entry.blockId) updateDraft(entry.text)
    }

    fun edit(block: SharedBlock) = synchronized(draftLock) {
        val state = mutable.value
        if (closed.get() || state.draft != null || currentPrincipal == null || state.saving || state.historySaving || state.access !in setOf("edit", "full") || !block.canEdit || state.snapshot == null) return
        draftToken = UUID.randomUUID().toString()
        mutable.update { it.copy(draft = SharedDraft(block, state.snapshot.copyOf(), block.text.orEmpty()), error = false, draftBackupFailed = false) }
    }
    fun addTextBlock(kind: String, after: String? = null) = synchronized(draftLock) {
        val state = mutable.value
        if (closed.get() || state.draft != null || currentPrincipal == null || state.saving || state.historySaving || state.disconnected || state.access !in setOf("edit", "full") || state.snapshot == null) return
        if (kind !in setOf("paragraph", "heading") || (after != null && state.blocks.count { it.id == after } != 1)) return
        val id = UUID.randomUUID().toString().replace("-", "").take(26)
        draftToken = UUID.randomUUID().toString()
        val block = SharedBlock(id, "", "", true)
        mutable.update { it.copy(draft = SharedDraft(block, state.snapshot.copyOf(), "", isNew = true, kind = kind, after = after), error = false, draftBackupFailed = false) }
    }
    fun setHeadingLevel(level: Int) { if (level in 1..3) mutable.update { state -> state.copy(draft = state.draft?.let { if (it.isNew && it.kind == "heading") it.copy(level = level) else it }) } }
    fun updateDraft(text: String) = synchronized(draftLock) {
        if (closed.get()) return
        val draft = mutable.value.draft ?: return
        val principal = currentPrincipal ?: return
        val token = draftToken ?: return
        val page = currentPage
        val version = draftBackupVersion.incrementAndGet()
        mutable.update { state -> state.copy(draft = state.draft?.copy(text = text)) }
        val accepted = draftQueue.update(token, action = {
                if (text == draft.block.text.orEmpty()) runtime.discardWorkingDraft(principal, workspace, page, token)
                else runtime.backupWorkingDraft(principal, workspace, page, token, DraftCapture(requireNotNull(draft.block.id), text))
            }, completed = { ok ->
                synchronized(draftLock) {
                    if (!closed.get() && draftToken == token && draftBackupVersion.get() == version) mutable.update { it.copy(draftBackupFailed = !ok) }
                }
            })
        if (!accepted && !closed.get()) mutable.update { it.copy(draftBackupFailed = true) }
    }
    private fun discardDraftBackup(refresh: Boolean = false) = synchronized(draftLock) {
        val token = draftToken ?: return
        val principal = currentPrincipal ?: return
        val page = currentPage
        draftToken = null
        draftQueue.barrier(token) {
            runCatching { runtime.discardWorkingDraft(principal, workspace, page, token) }
            if (refresh && !closed.get()) refreshRecovery()
        }
        Unit
    }
    fun cancelDraft() {
        if (mutable.value.saving) return
        discardDraftBackup()
        mutable.update { it.copy(draft = null, draftBackupFailed = false) }
    }
    fun duplicateBlock(block: SharedBlock): Unit = synchronized(draftLock) {
        val state = mutable.value
        val principal = currentPrincipal ?: return
        val source = block.id ?: return
        val base = state.snapshot?.copyOf() ?: return
        if (closed.get() || state.saving || state.historySaving || state.draft != null || state.disconnected || state.access !in setOf("edit", "full") || !block.canEdit || state.blocks.count { it.id == source } != 1) return
        val id = UUID.randomUUID().toString().replace("-", "").take(26)
        mutable.update { it.copy(saving = true, duplicateError = false) }
        pendingLocalSave.set(true)
        scope.launch {
            while (isActive && !closed.get()) {
                val current = mutable.value
                val active = session
                if (current.disconnected || (!current.offline && current.access != null && current.access !in setOf("edit", "full"))) {
                    pendingLocalSave.set(false)
                    mutable.update { it.copy(saving = false, duplicateError = true) }
                    break
                }
                if (!current.offline && current.access in setOf("edit", "full") && active != null) {
                    pendingLocalSave.set(false)
                    active.duplicateTextBlock(base, source, id) { saved ->
                        if (saved && !closed.get()) scheduleOutbox(principal, currentServer, currentPage)
                        if (!closed.get()) mutable.update { it.copy(saving = false, duplicateError = !saved) }
                    }
                    break
                }
                if (!current.offline) { delay(50); continue }
                try {
                    val updated = runtime.duplicateOffline(principal, workspace, currentPage, base, source, id) { !closed.get() }
                    acceptSnapshot(updated)
                    scheduleOutbox(principal, currentServer, currentPage)
                    pendingLocalSave.set(false)
                    if (!closed.get()) mutable.update { it.copy(saving = false, duplicateError = false) }
                    break
                } catch (_: AccountSyncRuntime.SessionActive) { delay(50) }
                catch (_: Exception) {
                    pendingLocalSave.set(false)
                    if (!closed.get()) mutable.update { it.copy(saving = false, duplicateError = true) }
                    break
                }
            }
        }
    }
    fun save() {
        val state = mutable.value; val draft = state.draft ?: return
        if (state.saving || state.snapshot == null || state.access !in setOf("edit", "full")) return
        val original = draft.block.text.orEmpty(); val next = draft.text
        if (original == next) { cancelDraft(); return }
        var start = 0
        while (start < original.length && start < next.length && original[start] == next[start]) start++
        if (start > 0 && start < original.length && original[start].isLowSurrogate()) start--
        var oldEnd = original.length; var newEnd = next.length
        while (oldEnd > start && newEnd > start && original[oldEnd - 1] == next[newEnd - 1]) { oldEnd--; newEnd-- }
        if (oldEnd < original.length && original[oldEnd].isLowSurrogate()) { oldEnd++; newEnd++ }
        mutable.update { it.copy(saving = true, error = false) }
        pendingLocalSave.set(true)
        val inserted = next.substring(start, newEnd)
        scope.launch {
            while (isActive && !closed.get()) {
                val current = mutable.value
                val active = session
                if (current.disconnected || (!current.offline && current.access != null && current.access !in setOf("edit", "full"))) {
                    pendingLocalSave.set(false)
                    mutable.update { it.copy(saving = false, error = true) }
                    break
                }
                if (!current.offline && current.access in setOf("edit", "full") && active != null) {
                    pendingLocalSave.set(false)
                    val completion: (Boolean) -> Unit = { saved ->
                        if (saved) {
                            discardDraftBackup()
                            currentPrincipal?.let { principal -> scheduleOutbox(principal, currentServer, currentPage) }
                        }
                        if (!closed.get()) mutable.update { it.copy(saving = false, draft = if (saved) null else it.draft, error = !saved) }
                    }
                    if (draft.isNew) active.insertTextBlock(draft.base, requireNotNull(draft.block.id), next, draft.kind, draft.level, draft.after, completion)
                    else active.replaceBlockText(draft.base, requireNotNull(draft.block.id), start, oldEnd, inserted, next, completion)
                    break
                }
                if (!current.offline) { delay(50); continue }
                try {
                    val updated = if (draft.isNew && draft.kind == "paragraph" && draft.after == null) runtime.appendOffline(requireNotNull(currentPrincipal), workspace, currentPage, requireNotNull(draft.block.id), next) { !closed.get() }
                    else if (draft.isNew) runtime.insertOffline(requireNotNull(currentPrincipal), workspace, currentPage, draft.base, requireNotNull(draft.block.id), next, draft.kind, draft.level, draft.after) { !closed.get() }
                    else runtime.editOffline(requireNotNull(currentPrincipal), workspace, currentPage, draft.base, requireNotNull(draft.block.id), start, oldEnd, inserted, next) { !closed.get() }
                    acceptSnapshot(updated)
                    currentPrincipal?.let { principal -> scheduleOutbox(principal, currentServer, currentPage) }
                    pendingLocalSave.set(false)
                    discardDraftBackup()
                    if (!closed.get()) mutable.update { it.copy(saving = false, draft = null, error = false) }
                    break
                } catch (_: AccountSyncRuntime.SessionActive) { delay(50) }
                catch (_: Exception) {
                    pendingLocalSave.set(false)
                    if (!closed.get()) mutable.update { it.copy(saving = false, error = true) }
                    break
                }
            }
        }
    }
    override fun close() {
        val shouldClose = synchronized(draftLock) {
            if (!closed.compareAndSet(false, true)) false else { markdownSnapshot = null; draftQueue.close(); true }
        }
        if (shouldClose) { accountObserver.close(); session?.close(); scope.cancel() }
    }
    internal fun awaitDraftBackups(timeoutMillis: Long = 5_000): Boolean = draftQueue.awaitTermination(timeoutMillis)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SharedPageTool(icon: Int, label: String, enabled: Boolean, tag: String, action: () -> Unit) {
    TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text(label) } }, state = rememberTooltipState()) {
        IconButton(enabled = enabled, onClick = action, modifier = Modifier.testTag(tag)) {
            Icon(painterResource(icon), contentDescription = label)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun SharedPageScreen(identity: String, workspace: Workspace, onBack: () -> Unit, controllerOverride: SharedPageController? = null, initialServer: String = "", initialPage: String = "", initialThread: String? = null, initialComment: String? = null, onOpenNotification: ((NotificationTarget) -> Unit)? = null) {
    val context = LocalContext.current
    val app = context.applicationContext
    val sharedPageTitle = stringResource(R.string.shared_page_title)
    val controller = remember(identity, workspace.id, controllerOverride) { controllerOverride ?: SharedPageController(WorldsAccountSync.get(app), identity, workspace.id) }
    DisposableEffect(controller) { onDispose { controller.close() } }
    val state by controller.state.collectAsState()
    val markdownPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/markdown")) { uri -> controller.finishMarkdownExport(app, uri) }
    var showMarkdown by remember(controller) { mutableStateOf(false) }
    LaunchedEffect(state.access, state.disconnected) { if (state.access == null || state.disconnected) showMarkdown = false }
    if (showMarkdown && state.access != null && !state.disconnected) AlertDialog(onDismissRequest = { showMarkdown = false },
        title = { Text(stringResource(R.string.markdown_export)) },
        text = { Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
            Text(stringResource(R.string.shared_markdown_explanation))
            TextButton(onClick = { showMarkdown = false; controller.deliverMarkdown(copy = true) { clipboardText ->
                val service = app.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                service.setPrimaryClip(android.content.ClipData.newPlainText(sharedPageTitle, clipboardText))
            } }, modifier = Modifier.testTag("shared_markdown_copy")) { WorldsActionLabel(R.drawable.ic_files, stringResource(R.string.markdown_copy)) }
            TextButton(onClick = { showMarkdown = false; controller.deliverMarkdown(copy = false) { text ->
                context.startActivity(markdownShareIntent(sharedPageTitle, text))
            } }, modifier = Modifier.testTag("shared_markdown_share")) { WorldsActionLabel(R.drawable.ic_share_2, stringResource(R.string.markdown_share)) }
        } },
        confirmButton = { TextButton(onClick = {
            showMarkdown = false
            if (controller.beginMarkdownExport()) runCatching { markdownPicker.launch("page.md") }.onFailure { controller.markdownPickerFailed() }
        }, modifier = Modifier.testTag("shared_markdown_save")) { Text(stringResource(R.string.markdown_save)) } },
        dismissButton = { TextButton(onClick = { showMarkdown = false }) { Text(stringResource(R.string.cancel)) } })
    var showPermissions by remember { mutableStateOf(false) }
    LaunchedEffect(state.access, state.offline, state.disconnected) { if (state.access == null || state.offline || state.disconnected) showPermissions = false }
    if (showPermissions && state.access != null && !state.offline && !state.disconnected) {
        PagePermissionsScreen(identity, workspace, controller.currentPageId(), onBack = { showPermissions = false })
        return
    }
    val keyboard = LocalSoftwareKeyboardController.current
    val clipboard = LocalClipboardManager.current
    var server by rememberSaveable { mutableStateOf(initialServer) }
    var page by rememberSaveable { mutableStateOf(initialPage) }
    LaunchedEffect(controller) { if (initialServer.isNotBlank() && initialPage.isNotBlank()) controller.open(initialServer, initialPage) }
    var deleteRecovery by remember { mutableStateOf<RecoveredText?>(null) }
    var restoreRecovery by remember { mutableStateOf<RecoveredText?>(null) }
    var showVersionName by remember { mutableStateOf(false) }
    var confirmVersionRestore by remember { mutableStateOf(false) }
    var versionName by remember { mutableStateOf("") }
    var confirmDiscardDraft by remember { mutableStateOf(false) }
    var initialTargetConsumed by remember(controller, initialThread, initialComment) { mutableStateOf(false) }
    LaunchedEffect(controller, state.access, state.offline, initialThread, initialComment) {
        if (!initialTargetConsumed && state.access != null && !state.offline && initialThread != null && initialComment != null) {
            controller.showConversation(initialThread, initialComment); initialTargetConsumed = true
        }
    }
    LaunchedEffect(state.historyVisible) { if (!state.historyVisible) { showVersionName = false; confirmVersionRestore = false } }
    LaunchedEffect(state.draft) { if (state.draft == null) confirmDiscardDraft = false }
    LaunchedEffect(state.access, state.snapshot) { if (state.access !in setOf("edit", "full") || state.snapshot == null) restoreRecovery = null }
    fun dismissDraft() {
        if (state.saving) return
        val draft = state.draft ?: return
        if (draft.text != draft.block.text.orEmpty()) confirmDiscardDraft = true else controller.cancelDraft()
    }
    BackHandler { if (state.draft != null) dismissDraft() else onBack() }
    LaunchedEffect(state.noticesVisible) {
        while (state.noticesVisible) { delay(60_000); controller.refreshNotices() }
    }
    var deleteComment by remember { mutableStateOf<Pair<String, String>?>(null) }
    LaunchedEffect(state.conversationsVisible) { if (!state.conversationsVisible) deleteComment = null }
    deleteComment?.let { (thread, comment) ->
        AlertDialog(onDismissRequest = { deleteComment = null }, title = { Text(stringResource(R.string.conversations_delete)) },
            text = { Text(stringResource(R.string.conversations_delete_confirm)) },
            confirmButton = { TextButton(enabled = !state.replySaving, onClick = { deleteComment = null; controller.changeConversation("delete", thread, comment = comment) }, modifier = Modifier.testTag("conversation_delete_confirm")) { Text(stringResource(R.string.conversations_delete)) } },
            dismissButton = { TextButton(onClick = { deleteComment = null }) { Text(stringResource(R.string.cancel)) } })
    }
    var editTarget by remember { mutableStateOf<Triple<String, String, String>?>(null) }
    var editText by remember { mutableStateOf("") }
    LaunchedEffect(state.conversationsVisible) { if (!state.conversationsVisible) { editTarget = null; editText = "" } }
    var replyThread by remember { mutableStateOf<String?>(null) }
    var replyText by remember { mutableStateOf("") }
    var newConversation by remember { mutableStateOf(false) }
    var newConversationText by remember { mutableStateOf("") }
    LaunchedEffect(state.conversationsVisible) { if (!state.conversationsVisible) { replyThread = null; replyText = ""; newConversation = false; newConversationText = "" } }
    if (state.conversationsVisible) AlertDialog(onDismissRequest = controller::closeConversations,
        title = { Text(stringResource(R.string.conversations_title)) },
        text = { Column(Modifier.fillMaxWidth().heightIn(max = 440.dp).verticalScroll(rememberScrollState())) {
            if (state.conversationsError) Text(stringResource(R.string.conversations_error), color = MaterialTheme.colorScheme.error)
            val focused = state.focusedThread
            if (focused != null) {
                TextButton(onClick = controller::showAllConversations, modifier = Modifier.testTag("conversation_show_all")) { WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.conversations_show_all)) }
                if (!state.commentsSynced) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                else if (state.conversations.none { it.id == focused }) Text(stringResource(R.string.conversations_missing), modifier = Modifier.testTag("conversation_missing"))
                else if (state.focusedComment != null && state.conversations.first { it.id == focused }.comments.none { it.id == state.focusedComment }) Text(stringResource(R.string.conversations_message_missing), modifier = Modifier.testTag("conversation_message_missing"))
            }
            if (state.access in setOf("comment", "edit", "full")) {
                if (newConversation) {
                    OutlinedTextField(value = newConversationText, onValueChange = { if (it.length <= 10_000) newConversationText = it }, enabled = !state.replySaving, label = { Text(stringResource(R.string.conversations_new_body)) }, minLines = 2, modifier = Modifier.fillMaxWidth().testTag("conversation_new_text"))
                    Text(stringResource(R.string.conversations_page_level), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row {
                        TextButton(enabled = newConversationText.isNotBlank() && !state.replySaving, onClick = { controller.changeConversation("create", UUID.randomUUID().toString(), body = newConversationText) { newConversation = false; newConversationText = "" } }, modifier = Modifier.testTag("conversation_new_send")) { WorldsActionLabel(R.drawable.ic_send_horizontal, stringResource(R.string.conversations_send)) }
                        TextButton(enabled = !state.replySaving, onClick = { newConversation = false; newConversationText = "" }) { Text(stringResource(R.string.cancel)) }
                    }
                } else TextButton(enabled = !state.replySaving, onClick = { newConversation = true; replyThread = null }, modifier = Modifier.testTag("conversation_new")) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.conversations_new)) }
            }
            if (state.focusedThread == null && state.conversations.isEmpty() && !state.conversationsError) Text(stringResource(R.string.conversations_empty))
            state.conversations.filter { state.focusedThread == null || (state.commentsSynced && it.id == state.focusedThread) }.forEach { thread ->
                Column(Modifier.fillMaxWidth().padding(vertical = 10.dp).testTag("conversation_${thread.id}")) {
                    if (thread.quote.isNotBlank()) Text(thread.quote, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (thread.resolved) Text(stringResource(R.string.conversations_resolved), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    thread.comments.forEach { comment ->
                        val bringIntoView = remember(comment.id) { BringIntoViewRequester() }
                        LaunchedEffect(state.focusedComment, state.commentsSynced) {
                            if (state.commentsSynced && state.focusedComment == comment.id) { delay(100); bringIntoView.bringIntoView() }
                        }
                        Column(Modifier.fillMaxWidth().bringIntoViewRequester(bringIntoView).testTag("conversation_message_${comment.id}").padding(vertical = 6.dp)) {
                            if (state.focusedComment == comment.id) Text(stringResource(R.string.conversations_target), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium, modifier = Modifier.testTag("conversation_target"))
                            Text(state.people[comment.author] ?: comment.author, style = MaterialTheme.typography.labelLarge)
                            if (editTarget?.first == thread.id && editTarget?.second == comment.id) {
                                OutlinedTextField(value = editText, onValueChange = { if (it.length <= 10_000) editText = it }, enabled = !state.replySaving, label = { Text(stringResource(R.string.conversations_edit)) }, minLines = 2, modifier = Modifier.fillMaxWidth().testTag("conversation_edit_text"))
                                if (editTarget?.third != comment.body) Text(stringResource(R.string.conversations_edit_changed), color = MaterialTheme.colorScheme.error)
                                Row {
                                    TextButton(enabled = editText.isNotBlank() && editText != editTarget?.third && editTarget?.third == comment.body && !state.replySaving && !state.offline && !state.disconnected, onClick = { controller.changeConversation("edit", thread.id, body = editText, comment = comment.id, expectedBody = editTarget?.third) { editTarget = null; editText = "" } }, modifier = Modifier.testTag("conversation_edit_save")) { WorldsActionLabel(R.drawable.ic_pencil, stringResource(R.string.save)) }
                                    TextButton(enabled = !state.replySaving, onClick = { editTarget = null; editText = "" }) { Text(stringResource(R.string.cancel)) }
                                }
                                Text(stringResource(R.string.conversations_edit_queue), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            } else {
                                Text(if (comment.deleted) stringResource(R.string.conversations_deleted) else comment.body, style = MaterialTheme.typography.bodyMedium)
                                if (comment.editedAt > 0 && !comment.deleted) Text(stringResource(R.string.conversations_edited), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                if (state.access in setOf("comment", "edit", "full") && controller.canEditComment(comment)) {
                                    TextButton(enabled = !state.replySaving && !state.offline && !state.disconnected, onClick = { editTarget = Triple(thread.id, comment.id, comment.body); editText = comment.body }, modifier = Modifier.testTag("conversation_edit_${comment.id}")) { WorldsActionLabel(R.drawable.ic_pencil, stringResource(R.string.conversations_edit)) }
                                }
                            }
                            if (state.access in setOf("comment", "edit", "full") && controller.canDeleteComment(thread, comment)) {
                                TextButton(enabled = !state.replySaving, onClick = { deleteComment = thread.id to comment.id }, modifier = Modifier.testTag("conversation_delete_${comment.id}")) {
                                    WorldsActionLabel(R.drawable.ic_trash_2, stringResource(R.string.conversations_delete))
                                }
                            }
                        }
                    }
                    if (state.access in setOf("comment", "edit", "full")) {
                        if (replyThread == thread.id) {
                            OutlinedTextField(value = replyText, onValueChange = { if (it.length <= 10_000) replyText = it }, enabled = !state.replySaving, label = { Text(stringResource(R.string.conversations_reply)) }, modifier = Modifier.fillMaxWidth().testTag("conversation_reply_text"), minLines = 2)
                            Row { TextButton(enabled = replyText.isNotBlank() && !state.replySaving, onClick = { controller.changeConversation("reply", thread.id, body = replyText) { replyText = ""; replyThread = null } }, modifier = Modifier.testTag("conversation_send")) { WorldsActionLabel(R.drawable.ic_send_horizontal, stringResource(R.string.conversations_send)) }
                                TextButton(enabled = !state.replySaving, onClick = { replyThread = null; replyText = "" }) { Text(stringResource(R.string.cancel)) } }
                            Text(stringResource(R.string.conversations_queue), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else TextButton(enabled = !state.replySaving, onClick = { replyThread = thread.id; replyText = ""; newConversation = false }, modifier = Modifier.testTag("conversation_reply_${thread.id}")) { WorldsActionLabel(R.drawable.ic_message_circle, stringResource(R.string.conversations_reply)) }
                        TextButton(enabled = !state.replySaving, onClick = { controller.changeConversation("resolve", thread.id, resolved = !thread.resolved) }, modifier = Modifier.testTag("conversation_resolve_${thread.id}")) {
                            WorldsActionLabel(R.drawable.ic_circle_check, stringResource(if (thread.resolved) R.string.conversations_reopen else R.string.conversations_resolve))
                        }
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        } }, confirmButton = { TextButton(enabled = !state.replySaving, onClick = controller::closeConversations) { Text(stringResource(R.string.close)) } })
    if (state.noticesVisible) AlertDialog(onDismissRequest = controller::closeNotices,
        title = { Text(stringResource(R.string.notices_title)) },
        text = { Column(Modifier.fillMaxWidth().heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
            Text(stringResource(R.string.notices_explanation), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            Row { TextButton(enabled = !state.noticesLoading, onClick = { controller.refreshNotices() }, modifier = Modifier.testTag("notices_refresh")) { WorldsActionLabel(R.drawable.ic_refresh_cw, stringResource(R.string.workspace_reload)) }
                TextButton(enabled = !state.noticesLoading && state.unread > 0, onClick = { controller.refreshNotices(mark = true) }, modifier = Modifier.testTag("notices_read_all")) { Text(stringResource(R.string.notices_read_all)) } }
            if (state.noticesLoading) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            if (state.noticesError) Text(stringResource(R.string.notices_error), color = MaterialTheme.colorScheme.error)
            if (!state.noticesLoading && !state.noticesError && state.notices.isEmpty()) Text(stringResource(R.string.notices_empty))
            state.notices.forEach { notice ->
                Column(Modifier.fillMaxWidth().testTag("notice_${notice.id}").clickable(enabled = !state.noticesLoading && onOpenNotification != null) { controller.refreshNotices(mark = true, ids = listOf(notice.id), open = notice, onOpen = onOpenNotification) }.padding(horizontal = 4.dp, vertical = 12.dp)) {
                    Column(Modifier.fillMaxWidth()) {
                        Text(stringResource(if (notice.kind == "mention") R.string.notices_mention else R.string.notices_reply, notice.senderName ?: notice.sender), color = MaterialTheme.colorScheme.onSurface, fontWeight = if (notice.readAt == null) FontWeight.Bold else FontWeight.Normal)
                        if (notice.excerpt.isNotBlank()) Text(notice.excerpt, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        Text(DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(notice.createdAt)) + if (notice.readAt == null) " · " + stringResource(R.string.notices_unread) else "", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        } },
        confirmButton = { TextButton(onClick = controller::closeNotices) { Text(stringResource(R.string.close)) } })
    if (state.historyVisible) AlertDialog(onDismissRequest = controller::closeHistory,
        title = { Text(stringResource(if (state.historyPreview == null) R.string.shared_history_title else R.string.shared_history_preview)) },
        text = {
            Column(Modifier.fillMaxWidth().heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                if (state.historyLoading || state.historySaving) {
                    CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                    if (state.historySaving) Text(stringResource(if (state.historyRestoring) R.string.shared_history_restoring else R.string.shared_history_saving), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                }
                else if (state.historyError) Text(stringResource(if (state.historyUncertain) (if (state.historyRestoring) R.string.shared_history_restore_uncertain else R.string.shared_history_uncertain) else if (state.historyRestoreConflict) R.string.shared_history_restore_failed else if (state.historySyncFailed) (if (state.historyRestoring) R.string.shared_history_restore_sync_error else R.string.shared_history_sync_error) else R.string.shared_history_error), color = MaterialTheme.colorScheme.error)
                else if (state.historyPreview != null) {
                    if (state.access in setOf("edit", "full") && state.draft == null && !state.offline && !state.disconnected) {
                        TextButton(onClick = { confirmVersionRestore = true }, modifier = Modifier.testTag("shared_version_restore")) { WorldsActionLabel(R.drawable.ic_history, stringResource(R.string.shared_history_restore)) }
                    }
                    state.historyPreview!!.forEach { raw ->
                        val preview = remember(raw) { runCatching { previewBlock(raw) }.getOrNull() }
                        if (preview == null || (preview.incomplete && preview.text.isEmpty())) Text(stringResource(R.string.shared_unsupported), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        else {
                            Text(preview.text, style = if (preview.headingLevel != null) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(vertical = 6.dp).testTag("shared_history_preview_block"))
                            if (preview.incomplete) Text(stringResource(R.string.shared_unsupported), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                } else {
                  if (state.access in setOf("edit", "full") && !state.historyUncertain) TextButton(onClick = { versionName = ""; showVersionName = true }, modifier = Modifier.testTag("shared_version_create")) {
                      WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.shared_history_create))
                  }
                  if (state.versions.isEmpty()) Text(stringResource(R.string.shared_history_empty))
                  else state.versions.forEach { version ->
                    TextButton(onClick = { controller.openHistory(version.id) }, modifier = Modifier.fillMaxWidth().testTag("shared_version_${version.id}"), contentPadding = PaddingValues(vertical = 8.dp)) {
                        Column(Modifier.fillMaxWidth()) {
                            Text(version.label?.takeIf { it.isNotBlank() } ?: stringResource(R.string.shared_history_version), color = MaterialTheme.colorScheme.onSurface)
                            Text(DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(version.createdAt)), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                  }
                }
            }
        },
        confirmButton = { TextButton(enabled = !state.historySaving, onClick = controller::closeHistory) { Text(stringResource(R.string.close)) } },
        dismissButton = { if (state.historyPreview != null || state.historyError) TextButton(enabled = !state.historySaving, onClick = { controller.openHistory() }) { Text(stringResource(if (state.historyError) R.string.workspace_reload else R.string.back)) } })
    if (confirmVersionRestore && state.historyVisible) AlertDialog(onDismissRequest = { confirmVersionRestore = false },
        title = { Text(stringResource(R.string.shared_history_restore)) },
        text = { Text(stringResource(R.string.shared_history_restore_confirm)) },
        confirmButton = { TextButton(onClick = { confirmVersionRestore = false; controller.restoreVersion() }, modifier = Modifier.testTag("shared_version_restore_confirm")) { Text(stringResource(R.string.shared_history_restore)) } },
        dismissButton = { TextButton(onClick = { confirmVersionRestore = false }) { Text(stringResource(R.string.cancel)) } })
    if (showVersionName && state.historyVisible) AlertDialog(onDismissRequest = { showVersionName = false },
        title = { Text(stringResource(R.string.shared_history_create)) },
        text = { OutlinedTextField(value = versionName, onValueChange = { versionName = it.take(200) }, label = { Text(stringResource(R.string.shared_history_label)) }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("shared_version_name")) },
        confirmButton = { TextButton(onClick = { showVersionName = false; controller.createVersion(versionName) }, modifier = Modifier.testTag("shared_version_confirm")) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(onClick = { showVersionName = false }) { Text(stringResource(R.string.cancel)) } })
    deleteRecovery?.let { entry ->
        AlertDialog(onDismissRequest = { deleteRecovery = null }, title = { Text(stringResource(R.string.shared_recovered_delete)) },
            text = { Text(stringResource(R.string.shared_recovered_delete_confirm)) },
            confirmButton = { TextButton(onClick = { deleteRecovery = null; controller.deleteRecovered(entry.id) }) { Text(stringResource(R.string.shared_recovered_delete)) } },
            dismissButton = { TextButton(onClick = { deleteRecovery = null }) { Text(stringResource(R.string.cancel)) } })
    }
    restoreRecovery?.let { entry ->
        val current = state.blocks.singleOrNull { it.id == entry.blockId && it.canEdit }
        if (current != null && state.access in setOf("edit", "full") && state.snapshot != null) {
            AlertDialog(onDismissRequest = { restoreRecovery = null }, title = { Text(stringResource(R.string.shared_recovered_edit)) },
                text = { Column { Text(stringResource(R.string.shared_recovered_edit_explanation)); Spacer(Modifier.height(12.dp))
                    Text(stringResource(R.string.shared_recovered_current), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(current.text.orEmpty(), maxLines = 4, overflow = TextOverflow.Ellipsis) } },
                confirmButton = { TextButton(onClick = { restoreRecovery = null; controller.editRecovered(entry.id) }, modifier = Modifier.testTag("confirm_restore_recovery")) { Text(stringResource(R.string.shared_recovered_edit)) } },
                dismissButton = { TextButton(onClick = { restoreRecovery = null }) { Text(stringResource(R.string.cancel)) } })
        }
    }
    state.draft?.let { draft ->
        var showPartPicker by rememberSaveable(draft.block.id) { mutableStateOf(false) }
        var partNumber by rememberSaveable(draft.block.id) { mutableStateOf("") }
        var draftComposing by remember(draft.block.id) { mutableStateOf(false) }
        val shortcutEnabled = !draftComposing && !state.saving && !state.disconnected && state.snapshot != null && !confirmDiscardDraft && !showPartPicker
        EditorShortcutRegistration(shortcutEnabled)
        AlertDialog(modifier = Modifier.imePadding().editorSaveShortcut(shortcutEnabled, controller::save), onDismissRequest = ::dismissDraft, title = { Text(stringResource(if (!draft.isNew) R.string.edit_text else if (draft.kind == "heading") R.string.add_heading else R.string.add_paragraph)) },
            text = { Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                val editorSettings = LocalAppearancePreferences.current
                val focusRequester = remember { BringIntoViewRequester() }
                val focusScope = rememberCoroutineScope()
                var fieldFocused by remember { mutableStateOf(false) }
                val mayHaveMarks = remember(draft.block.raw, draft.isNew) { !draft.isNew && draft.block.raw.contains("\"marks\"") }
                val styled by produceState<AnnotatedString?>(null, draft.block.raw, draft.text, mayHaveMarks) {
                    value = if (mayHaveMarks) withContext(Dispatchers.Default) { sharedDraftPreview(draft) } else null
                }
                if (draft.isNew && draft.kind == "heading") FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    (1..3).forEach { level -> FilterChip(selected = draft.level == level, enabled = !state.saving,
                        onClick = { controller.setHeadingLevel(level) }, label = { Text(stringResource(R.string.heading_level, level)) },
                        modifier = Modifier.testTag("shared_heading_level_$level")) }
                }
                val offsets = remember(draft.text) { sharedTextPageOffsets(draft.text) }
                var pageIndex by rememberSaveable(draft.block.id) { mutableIntStateOf(0) }
                val currentPage = pageIndex.coerceIn(0, offsets.size - 2)
                val from = offsets[currentPage]; val to = offsets[currentPage + 1]
                val part = draft.text.substring(from, to)
                val styledPart = remember(styled, draft.text, from, to) {
                    styled?.takeIf { it.text == draft.text }?.subSequence(from, to)
                }
                val visual = remember(styledPart) { annotatedVisualTransformation(styledPart) }
                var field by remember(draft.block.id, currentPage) { mutableStateOf(TextFieldValue(part, TextRange(part.length))) }
                val shown = if (field.text == part) field else TextFieldValue(part, TextRange(field.selection.start.coerceIn(0, part.length), field.selection.end.coerceIn(0, part.length)))
                if (offsets.size > 2) {
                    TextButton(onClick = { partNumber = (currentPage + 1).toString(); showPartPicker = true }, enabled = !state.saving, modifier = Modifier.testTag("shared_text_jump")) {
                        WorldsActionLabel(R.drawable.ic_search, stringResource(R.string.shared_text_part, currentPage + 1, offsets.size - 1))
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(enabled = !state.saving && currentPage > 0, onClick = { pageIndex = currentPage - 1 }, modifier = Modifier.testTag("shared_text_previous")) {
                            WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.find_previous))
                        }
                        TextButton(enabled = !state.saving && currentPage < offsets.size - 2, onClick = { pageIndex = currentPage + 1 }, modifier = Modifier.testTag("shared_text_next")) {
                            WorldsActionLabel(R.drawable.ic_chevron_right, stringResource(R.string.find_next))
                        }
                    }
                }
                OutlinedTextField(value = shown, visualTransformation = visual, onValueChange = { next ->
                    draftComposing = next.composition != null
                    field = next
                    if (next.text != part) {
                        val full = draft.text.replaceRange(from, to, next.text)
                        val updatedOffsets = sharedTextPageOffsets(full)
                        val caret = (from + next.selection.end).coerceIn(0, full.length)
                        pageIndex = sharedTextPageForCaret(updatedOffsets, caret, currentPage)
                        controller.updateDraft(full)
                    }
                }, enabled = !state.saving, label = { Text(stringResource(R.string.text_content)) }, modifier = Modifier.fillMaxWidth().testTag("shared_draft")
                        .bringIntoViewRequester(focusRequester).onFocusChanged { focus ->
                            fieldFocused = focus.isFocused
                            if (focus.isFocused) focusScope.launch { delay(350); if (fieldFocused) focusRequester.bringIntoView() }
                        }, minLines = 3, maxLines = 10,
                    textStyle = LocalTextStyle.current.copy(textDirection = editorDirection(editorSettings.direction)), keyboardOptions = editorKeyboardOptions(editorSettings.suggestions))
                if (showPartPicker) AlertDialog(onDismissRequest = { showPartPicker = false },
                    title = { Text(stringResource(R.string.shared_text_go)) },
                    text = { OutlinedTextField(value = partNumber, onValueChange = { value ->
                        partNumber = value.mapNotNull { Character.digit(it, 10).takeIf { digit -> digit >= 0 }?.let { digit -> ('0'.code + digit).toChar() } }.take(8).joinToString("")
                    },
                        label = { Text(stringResource(R.string.shared_text_part_number)) }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), textStyle = LocalTextStyle.current.copy(textDirection = TextDirection.Ltr),
                        modifier = Modifier.fillMaxWidth().testTag("shared_text_part_number")) },
                    confirmButton = { TextButton(enabled = partNumber.toIntOrNull()?.let { it in 1 until offsets.size } == true, onClick = {
                        pageIndex = partNumber.toInt() - 1; showPartPicker = false
                    }, modifier = Modifier.testTag("shared_text_go_confirm")) { Text(stringResource(R.string.shared_text_go)) } },
                    dismissButton = { TextButton(onClick = { showPartPicker = false }) { Text(stringResource(R.string.cancel)) } })
                if (state.error) Text(stringResource(R.string.shared_edit_error), color = MaterialTheme.colorScheme.error)
                if (state.draftBackupFailed) Text(stringResource(R.string.shared_draft_backup_error), color = MaterialTheme.colorScheme.error) } },
            confirmButton = { TextButton(enabled = !state.saving && !state.disconnected && state.snapshot != null, onClick = controller::save) { Text(stringResource(R.string.save)) } },
            dismissButton = { TextButton(enabled = !state.saving, onClick = ::dismissDraft) { Text(stringResource(R.string.cancel)) } })
    }
    if (confirmDiscardDraft && state.draft != null) AlertDialog(onDismissRequest = { confirmDiscardDraft = false },
        title = { Text(stringResource(R.string.shared_draft_discard_title), modifier = Modifier.testTag("shared_discard_title")) }, text = { Text(stringResource(R.string.shared_draft_discard_body)) },
        confirmButton = { TextButton(onClick = { confirmDiscardDraft = false; controller.cancelDraft() }) { Text(stringResource(R.string.shared_draft_discard_action)) } },
        dismissButton = { TextButton(onClick = { confirmDiscardDraft = false }, modifier = Modifier.testTag("shared_discard_cancel")) { Text(stringResource(R.string.cancel)) } })
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 900.dp).fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp)) {
            TextButton(onClick = onBack) { WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.back)) }
            Text(workspace.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            Text(stringResource(R.string.shared_page_title), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(18.dp))
            if (state.reconnecting && !state.offline) {
                Text(stringResource(R.string.shared_reconnecting), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(12.dp)); CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            }
            if (state.access == null && !state.disconnected && !state.reconnecting) {
                OutlinedTextField(value = server, onValueChange = { server = it.take(2048) }, label = { Text(stringResource(R.string.shared_server)) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next, autoCorrectEnabled = false), textStyle = LocalTextStyle.current.copy(textDirection = TextDirection.Ltr), modifier = Modifier.fillMaxWidth().testTag("shared_server"))
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = page, onValueChange = { page = it.take(128) }, label = { Text(stringResource(R.string.shared_page_id)) }, singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done, autoCorrectEnabled = false), textStyle = LocalTextStyle.current.copy(textDirection = TextDirection.Ltr), modifier = Modifier.fillMaxWidth().testTag("shared_page_id"))
                Spacer(Modifier.height(12.dp))
                Button(enabled = !state.opening && server.isNotBlank() && page.isNotBlank(), onClick = { keyboard?.hide(); controller.open(server, page) }) { WorldsActionLabel(R.drawable.ic_files, stringResource(R.string.shared_open)) }
                if (state.opening) { Spacer(Modifier.height(12.dp)); CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp) }
            }
            if (state.backgroundScheduleFailed && state.access != null) {
                Text(stringResource(R.string.shared_background_schedule_error), color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("shared_background_error"))
                TextButton(enabled = !state.backgroundScheduleRetrying, onClick = controller::retryBackgroundSchedule, modifier = Modifier.testTag("shared_background_retry")) {
                    WorldsActionLabel(R.drawable.ic_refresh_cw, stringResource(R.string.retry))
                }
            }
            if (state.access != null) {
                if (state.offline) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        WorldsGlyph(R.drawable.ic_refresh_cw, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                        Text(stringResource(if (state.access in setOf("edit", "full")) R.string.shared_offline else R.string.shared_offline_read_only), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else Text(stringResource(if (state.access in setOf("edit", "full")) R.string.shared_editable else if (state.access == "comment") R.string.shared_comment_access else R.string.shared_read_only), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).testTag("shared_action_strip"), verticalAlignment = Alignment.CenterVertically) {
                    SharedPageTool(R.drawable.ic_lock_keyhole, stringResource(R.string.access_title), !state.offline && !state.opening, "shared_permissions") { showPermissions = true }
                    SharedPageTool(R.drawable.ic_message_circle, stringResource(R.string.conversations_title), !state.offline && !state.opening, "shared_conversations", controller::openConversations)
                    SharedPageTool(R.drawable.ic_bell, stringResource(R.string.notices_title), !state.offline && !state.opening, "shared_notices", controller::openNotices)
                    SharedPageTool(R.drawable.ic_history, stringResource(R.string.shared_history_title), !state.offline && !state.opening, "shared_history") { controller.openHistory() }
                    SharedPageTool(R.drawable.ic_download, stringResource(R.string.markdown_export), !state.disconnected && state.snapshot != null && !state.markdownExporting, "shared_markdown") { showMarkdown = true }
                }
                state.markdownStatus?.let { Text(stringResource(it), color = if (it in setOf(R.string.markdown_export_success, R.string.markdown_copy_success)) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error) }
                Spacer(Modifier.height(12.dp))
                val blockIdCounts = remember(state.blocks) { state.blocks.mapNotNull { it.id }.groupingBy { it }.eachCount() }
                state.blocks.forEach { block ->
                    val preview = remember(block.raw) { runCatching { previewBlock(block.raw) }.getOrNull() }
                    val editable = block.canEdit && state.access in setOf("edit", "full")
                    Row(Modifier.fillMaxWidth().testTag("shared_block_${block.id.orEmpty()}").clickable(enabled = editable) { controller.edit(block) }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            if (preview == null || preview.incomplete && preview.text.isEmpty()) Text(stringResource(R.string.shared_unsupported), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            else Text(preview.text, style = if (preview.headingLevel != null) MaterialTheme.typography.titleLarge else MaterialTheme.typography.bodyLarge)
                        }
                        if (editable) WorldsGlyph(R.drawable.ic_pencil)
                        if (state.access in setOf("edit", "full") && !state.disconnected && block.id != null && blockIdCounts[block.id] == 1) {
                            var menu by remember(block.id) { mutableStateOf(false) }
                            Box {
                                IconButton(enabled = !state.saving && !state.historySaving, onClick = { menu = true }, modifier = Modifier.testTag("shared_block_actions_${block.id}")) {
                                    Icon(painterResource(R.drawable.ic_ellipsis_vertical), contentDescription = stringResource(R.string.block_actions), modifier = Modifier.size(20.dp))
                                }
                                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                    if (block.canEdit) DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_files) }, text = { Text(stringResource(R.string.duplicate_block)) }, onClick = { menu = false; controller.duplicateBlock(block) }, modifier = Modifier.testTag("shared_duplicate_${block.id}"))
                                    DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_plus) }, text = { Text(stringResource(R.string.insert_paragraph_after)) }, onClick = { menu = false; controller.addTextBlock("paragraph", block.id) })
                                    DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_heading_1) }, text = { Text(stringResource(R.string.insert_heading_after)) }, onClick = { menu = false; controller.addTextBlock("heading", block.id) })
                                }
                            }
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
                if (state.access in setOf("edit", "full") && !state.disconnected && state.snapshot != null) {
                    TextButton(enabled = !state.saving && !state.historySaving, onClick = { controller.addTextBlock("paragraph") }, modifier = Modifier.testTag("shared_add_paragraph")) {
                        WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.add_paragraph))
                    }
                    TextButton(enabled = !state.saving && !state.historySaving, onClick = { controller.addTextBlock("heading") }, modifier = Modifier.testTag("shared_add_heading")) {
                        WorldsActionLabel(R.drawable.ic_heading_1, stringResource(R.string.add_heading))
                    }
                }
            }
            if (state.duplicateError) Text(stringResource(R.string.shared_duplicate_error), color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("shared_duplicate_error"))
            if (state.endpointProblem != null) Text(stringResource(if (state.endpointProblem == EndpointProblem.DIFFERENT_SERVER) R.string.shared_endpoint_conflict else R.string.shared_endpoint_unknown), color = MaterialTheme.colorScheme.error)
            else if (state.needsAttention) Text(stringResource(R.string.shared_attention), color = MaterialTheme.colorScheme.error)
            else if (state.reauth) Text(stringResource(R.string.shared_reauth), color = MaterialTheme.colorScheme.error)
            else if (state.disconnected) Text(stringResource(if (state.revoked && state.error) R.string.shared_revoked_error else if (state.revoked) R.string.shared_revoked else R.string.shared_disconnected), color = MaterialTheme.colorScheme.error)
            else if (state.error && state.draft == null) Text(stringResource(R.string.shared_error), color = MaterialTheme.colorScheme.error)
            if (state.recovered.isNotEmpty()) {
                Spacer(Modifier.height(20.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Spacer(Modifier.height(16.dp))
                Text(stringResource(R.string.shared_recovered_title), style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.shared_recovered_note), color = MaterialTheme.colorScheme.onSurfaceVariant)
                state.recovered.forEach { entry ->
                    Spacer(Modifier.height(12.dp))
                    val canRestore = state.access in setOf("edit", "full") && state.snapshot != null && state.blocks.count { it.id == entry.blockId && it.canEdit } == 1
                    RecoveryItem(entry, tagPrefix = "recovered", onCopy = { clipboard.setText(AnnotatedString(entry.text)) }, onDelete = { deleteRecovery = entry },
                        onRestore = if (canRestore) { { restoreRecovery = entry } } else null)
                }
            }
        }
    }
    }
}
