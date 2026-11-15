package worlds.sync

import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** A document's two Yjs channels, local journal and one authenticated connection. */
class SyncSession(
    private val store: AndroidSyncStore,
    private val document: SyncDocumentKey,
    private val transportFactory: (SyncSocket.Listener) -> SyncTransport,
    private val listener: Listener,
) {
    companion object {
        fun connect(store: AndroidSyncStore, document: SyncDocumentKey, baseUrl: String, token: String, listener: Listener): SyncSession =
            SyncSession(store, document, { callback ->
                SyncSocket(baseUrl, document.workspace, document.page, document.account, token, callback)
            }, listener)
    }

    interface Listener {
        fun onSynchronized(channel: Int) { }
        fun onState(channel: Int, snapshot: ByteArray)
        fun onAccess(level: String)
        fun onAttention(channel: Int, archiveId: String, reason: String)
        fun onClosed(code: Int?)
        fun onError()
        fun onTransportFailure() = onError()
    }

    private data class Flight(val batch: Long, val through: Long)
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val states = arrayOf(byteArrayOf(), byteArrayOf())
    private val flights = arrayOfNulls<Flight>(2)
    private val handshakes = BooleanArray(2)
    private val initialRemoteState = BooleanArray(2)
    private val peerVectors = arrayOfNulls<ByteArray>(2)
    private var transport: SyncTransport? = null
    private var access: String? = null
    private var started = false
    private var stopped = false
    private var nextBatch = 1L
    private val completion = CountDownLatch(1)
    private val contentSyncWaiters = mutableListOf<(Boolean) -> Unit>()
    private val outboxSyncWaiters = mutableListOf<(Boolean) -> Unit>()

    private fun key(channel: Int) = document.copy(channel = channel)
    private fun post(task: () -> Unit) {
        try { executor.execute { if (!stopped) try { task() } catch (_: TransportFailure) { fail(transport = true) } catch (_: Exception) { fail() } } }
        catch (_: RejectedExecutionException) { }
    }

    fun start() = post {
        check(!started)
        started = true
        for (channel in 0..1) {
            val replica = store.load(key(channel))
            var state = replica.snapshot ?: byteArrayOf()
            for (update in replica.updates) state = YrsNative.merge(state, update.bytes)
            states[channel] = state
            listener.onState(channel, state.copyOf())
        }
        transport = transportFactory(socketListener).also { it.start() }
    }

    /** The update is validated, journaled and queued atomically before it can be sent. */
    fun applyLocal(channel: Int, update: ByteArray) {
        val copy = update.copyOf()
        post { applyLocalNow(channel, copy) }
    }

    /** Append using the latest serialized replica and retain text for rejection recovery. */
    fun appendParagraph(blockId: String, text: String, completion: (Boolean) -> Unit = {}) =
        insertTextBlock(byteArrayOf(), blockId, text, "paragraph", 1, null, completion)

    fun insertTextBlock(baseSnapshot: ByteArray, blockId: String, text: String, kind: String, level: Int, after: String?, completion: (Boolean) -> Unit = {}) {
      val base = baseSnapshot.copyOf()
      post {
        val update = try {
            require(canWrite(SyncWire.CONTENT))
            if (after != null) require(YrsNative.blockIdentity(base, after).contentEquals(YrsNative.blockIdentity(states[SyncWire.CONTENT], after)))
            YrsNative.insertTextBlock(states[SyncWire.CONTENT], blockId, text, kind, level, after)
        } catch (_: IllegalArgumentException) { completion(false); return@post }
        var persisted = false
        try { applyLocalNow(SyncWire.CONTENT, update, DraftCapture(blockId, text)) { persisted = true; completion(true) } }
        catch (e: Exception) { if (!persisted) completion(false); throw e }
      }
    }

    /** Copy the latest text block only if it is still the same Yjs node. */
    fun duplicateTextBlock(baseSnapshot: ByteArray, source: String, blockId: String, completion: (Boolean) -> Unit = {}) {
        val base = baseSnapshot.copyOf()
        post {
            val duplicate = try {
                require(canWrite(SyncWire.CONTENT))
                require(YrsNative.blockIdentity(base, source).contentEquals(YrsNative.blockIdentity(states[SyncWire.CONTENT], source)))
                YrsNative.duplicateTextBlock(states[SyncWire.CONTENT], source, blockId)
            } catch (_: IllegalArgumentException) { completion(false); return@post }
            var persisted = false
            try { applyLocalNow(SyncWire.CONTENT, duplicate.update, DraftCapture(blockId, duplicate.text)) { persisted = true; completion(true) } }
            catch (e: Exception) { if (!persisted) completion(false); throw e }
        }
    }

    /** Sets and removes a shared pack item's fields (docs/PACKS.md); other fields stay as others left them. */
    fun setFields(set: org.json.JSONObject, remove: List<String>, completion: (Boolean) -> Unit = {}) {
        val values = org.json.JSONObject(set.toString())
        val removed = remove.toList()
        post {
            val update = try {
                require(canWrite(SyncWire.CONTENT))
                YrsNative.setFields(states[SyncWire.CONTENT], values, removed)
            } catch (_: IllegalArgumentException) { completion(false); return@post }
            var persisted = false
            try { applyLocalNow(SyncWire.CONTENT, update, null) { persisted = true; completion(true) } }
            catch (e: Exception) { if (!persisted) completion(false); throw e }
        }
    }

    /** Rebases the UI's edit from its captured state onto the current shared document. */
    fun replaceBlockText(baseSnapshot: ByteArray, blockId: String, start: Int, end: Int, text: String, draftText: String? = null, completion: (Boolean) -> Unit = {}) {
        val base = baseSnapshot.copyOf()
        post {
            val update = try {
                require(canWrite(SyncWire.CONTENT))
                require(YrsNative.blockIdentity(base, blockId).contentEquals(YrsNative.blockIdentity(states[SyncWire.CONTENT], blockId)))
                YrsNative.replaceBlockText(base, blockId, start, end, text)
            } catch (_: IllegalArgumentException) {
                completion(false)
                return@post
            }
            var persisted = false
            try {
                applyLocalNow(SyncWire.CONTENT, update, draftText?.let { DraftCapture(blockId, it) }) { persisted = true; completion(true) }
            } catch (e: Exception) {
                if (!persisted) completion(false)
                throw e
            }
        }
    }

    /** Computes a version restore against the exact state captured before confirmation. */
    fun restoreVersion(baseSnapshot: ByteArray, version: ByteArray, completion: (Boolean) -> Unit) {
        val base = baseSnapshot.copyOf(); val old = version.copyOf()
        post {
            val update = try {
                require(canWrite(SyncWire.CONTENT))
                require(states[SyncWire.CONTENT].contentEquals(base))
                YrsNative.restoreVersion(base, old)
            } catch (_: IllegalArgumentException) { completion(false); return@post }
            var persisted = false
            try { applyLocalNow(SyncWire.CONTENT, update) { persisted = true; completion(true) } }
            catch (e: Exception) { if (!persisted) completion(false); throw e }
        }
    }

    /** Creates the reply against the latest serialized channel state, then journals it. */
    fun changeComment(action: String, thread: String, author: String, body: String? = null, resolved: Boolean? = null, comment: String? = null, expectedBody: String? = null, completion: (Boolean) -> Unit) = post {
        val update = try {
            require(canWrite(SyncWire.COMMENTS))
            YrsNative.changeComment(states[SyncWire.COMMENTS], action, thread, author, body, resolved, comment, expectedBody)
        } catch (_: IllegalArgumentException) { completion(false); return@post }
        var persisted = false
        try { applyLocalNow(SyncWire.COMMENTS, update) { persisted = true; completion(true) } }
        catch (e: Exception) { if (!persisted) completion(false); throw e }
    }

    private fun applyLocalNow(channel: Int, update: ByteArray, draft: DraftCapture? = null, persisted: () -> Unit = {}) {
        require(channel in 0..1 && canWrite(channel))
        val state = YrsNative.merge(states[channel], update)
        store.append(key(channel), update, local = true, draft = draft)
        states[channel] = state
        persisted()
        listener.onState(channel, state.copyOf())
        drain(channel)
    }

    fun refreshToken(token: String) = post {
        require(token.isNotBlank())
        send(SyncWire.Frame.AuthRefresh(token))
    }

    /** Wait until the initial handshake and every earlier content write are acknowledged. */
    fun whenContentSynced(callback: (Boolean) -> Unit) = post {
        if (!canWrite(SyncWire.CONTENT)) callback(false)
        else { contentSyncWaiters.add(callback); notifyContentSynced() }
    }

    private fun notifyContentSynced() {
        if (!handshakes[SyncWire.CONTENT] || !initialRemoteState[SyncWire.CONTENT] || flights[SyncWire.CONTENT] != null || store.pending(key(SyncWire.CONTENT)).isNotEmpty()) return
        val waiters = contentSyncWaiters.toList(); contentSyncWaiters.clear()
        waiters.forEach { runCatching { it(true) } }
    }

    /** Wait for both channel handshakes and all currently queued writes to be acknowledged. */
    fun whenOutboxSynced(callback: (Boolean) -> Unit) = post {
        outboxSyncWaiters.add(callback); notifyOutboxSynced()
    }
    private fun notifyOutboxSynced() {
        if (access == null || (0..1).any { !handshakes[it] || flights[it] != null || store.pending(key(it)).isNotEmpty() }) return
        val waiters = outboxSyncWaiters.toList(); outboxSyncWaiters.clear()
        waiters.forEach { runCatching { it(true) } }
    }

    fun close() = post { stop(null, purge = false) }

    /** Stop before credentials are replaced, so observers can hide account-bound drafts. */
    fun closeForAccountChange() = post { stop(-1, purge = false) }

    /** Call from a thread other than the session callback thread. */
    fun closeAndWait(timeoutMillis: Long = 10_000): Boolean {
        require(timeoutMillis > 0)
        close()
        return completion.await(timeoutMillis, TimeUnit.MILLISECONDS)
    }

    private val socketListener = object : SyncSocket.Listener {
        override fun onAuthenticated(level: String) = post {
            val first = access == null
            val couldWrite = BooleanArray(2) { canWrite(it) }
            access = level
            listener.onAccess(level)
            if (!canWrite(SyncWire.CONTENT)) {
                val waiters = contentSyncWaiters.toList(); contentSyncWaiters.clear()
                waiters.forEach { runCatching { it(false) } }
            }
            for (channel in 0..1) {
                if (!canWrite(channel) && store.pending(key(channel)).isNotEmpty()) {
                    val archive = UUID.randomUUID().toString()
                    store.archiveRejection(key(channel), archive, states[channel], byteArrayOf(0, 0), "Access no longer permits these edits")
                    listener.onAttention(channel, archive, "Access no longer permits these edits")
                    stop(-2, purge = false)
                    return@post
                }
            }
            if (first) for (channel in 0..1) send(SyncWire.Frame.Sync(channel, 0, YrsNative.stateVector(states[channel])))
            else for (channel in 0..1) {
                val vector = peerVectors[channel]
                if (!couldWrite[channel] && canWrite(channel) && vector != null && flights[channel] == null) {
                    sendUpdate(channel, YrsNative.diff(states[channel], vector), store.pending(key(channel)).lastOrNull()?.id ?: 0)
                }
            }
        }
        override fun onFrame(frame: SyncWire.Frame) = post { receive(frame) }
        override fun onClosed(code: Int) = post { stop(code, purge = code == 4403) }
        override fun onFailure() = post { fail(transport = true) }
    }

    private fun canWrite(channel: Int) = access == "full" || access == "edit" || (access == "comment" && channel == SyncWire.COMMENTS)

    private fun receive(frame: SyncWire.Frame) {
        when (frame) {
            is SyncWire.Frame.Sync -> {
                val channel = frame.channel
                when (frame.kind) {
                    0 -> {
                        check(!handshakes[channel])
                        handshakes[channel] = true
                        peerVectors[channel] = frame.data.copyOf()
                        if (canWrite(channel)) {
                            val through = store.pending(key(channel)).lastOrNull()?.id ?: 0
                            sendUpdate(channel, YrsNative.diff(states[channel], frame.data), through)
                        }
                        notifyOutboxSynced()
                    }
                    1, 2 -> {
                        val merged = YrsNative.merge(states[channel], frame.data)
                        store.append(key(channel), frame.data, local = false)
                        states[channel] = merged
                        listener.onState(channel, merged.copyOf())
                        if (frame.kind == 1) {
                            initialRemoteState[channel] = true
                            listener.onSynchronized(channel)
                            if (channel == SyncWire.CONTENT) notifyContentSynced()
                        }
                    }
                }
            }
            is SyncWire.Frame.Ack -> {
                val channel = flights.indexOfFirst { it?.batch == frame.batchId }
                check(channel >= 0)
                val flight = requireNotNull(flights[channel])
                flights[channel] = null
                if (frame.status == 0) {
                    store.acknowledgeThrough(key(channel), flight.through)
                    drain(channel)
                    if (channel == SyncWire.CONTENT) notifyContentSynced()
                    notifyOutboxSynced()
                } else {
                    val archive = UUID.randomUUID().toString()
                    store.archiveRejection(key(channel), archive, states[channel], byteArrayOf(0, 0), frame.reason.take(10_000))
                    listener.onAttention(channel, archive, frame.reason)
                    stop(null, purge = false)
                }
            }
            is SyncWire.Frame.Notice -> when (frame.code) {
                "expired" -> stop(4401, purge = false)
                "denied" -> stop(-2, purge = false)
            }
            is SyncWire.Frame.Awareness -> Unit // Presence is not persisted in document state.
            else -> error("Unexpected server frame")
        }
    }

    private fun drain(channel: Int) {
        if (!handshakes[channel] || flights[channel] != null || !canWrite(channel)) return
        val pending = store.pending(key(channel)).firstOrNull() ?: return
        sendUpdate(channel, pending.bytes, pending.id)
    }

    private fun sendUpdate(channel: Int, bytes: ByteArray, through: Long) {
        check(flights[channel] == null)
        val batch = nextBatch++
        flights[channel] = Flight(batch, through)
        send(SyncWire.Frame.Update(batch, channel, bytes))
    }

    private class TransportFailure : Exception()
    private fun send(frame: SyncWire.Frame) { if (transport?.send(frame) != true) throw TransportFailure() }

    private fun fail(transport: Boolean = false) {
        if (stopped) return
        try { if (transport) listener.onTransportFailure() else listener.onError() } finally { stop(null, purge = false) }
    }

    private fun stop(code: Int?, purge: Boolean) {
        if (stopped) return
        stopped = true
        val waiters = contentSyncWaiters.toList(); contentSyncWaiters.clear()
        waiters.forEach { runCatching { it(false) } }
        val pendingWaiters = outboxSyncWaiters.toList(); outboxSyncWaiters.clear()
        pendingWaiters.forEach { runCatching { it(false) } }
        runCatching { transport?.close() }
        var purgeFailed = false
        if (purge) {
            purgeFailed = runCatching { store.purgeRevokedPage(document) }.isFailure
            states[0] = byteArrayOf()
            states[1] = byteArrayOf()
        }
        if (purgeFailed) runCatching { listener.onError() }
        try { listener.onClosed(code) } finally { completion.countDown(); executor.shutdown() }
    }
}
