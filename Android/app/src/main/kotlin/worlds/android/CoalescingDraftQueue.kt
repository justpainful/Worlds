package worlds.android

import java.util.ArrayDeque
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit

/** Serializes draft writes while replacing obsolete queued writes for the same draft. */
internal class CoalescingDraftQueue {
    private sealed interface Work {
        data class Update(val key: String, val action: () -> Unit, val completed: (Boolean) -> Unit) : Work
        data class Barrier(val action: () -> Unit) : Work
    }

    private val lock = Any()
    private val executor = Executors.newSingleThreadExecutor()
    private val pending = ArrayDeque<Work>()
    private var running = false
    private var closed = false

    fun update(key: String, action: () -> Unit, completed: (Boolean) -> Unit): Boolean = synchronized(lock) {
        if (closed) return false
        val last = pending.peekLast()
        if (last is Work.Update && last.key == key) pending.removeLast()
        pending.addLast(Work.Update(key, action, completed))
        scheduleLocked()
    }

    fun barrier(key: String, action: () -> Unit): Boolean = synchronized(lock) {
        if (closed) return false
        val last = pending.peekLast()
        if (last is Work.Update && last.key == key) pending.removeLast()
        pending.addLast(Work.Barrier(action))
        scheduleLocked()
    }

    private fun scheduleLocked(): Boolean {
        if (running) return true
        running = true
        return try { executor.execute(::drain); true } catch (_: RejectedExecutionException) {
            running = false; pending.clear(); false
        }
    }

    private fun drain() {
        while (true) {
            val work = synchronized(lock) {
                if (pending.isEmpty()) { running = false; return }
                pending.removeFirst()
            }
            when (work) {
                is Work.Update -> {
                    val success = runCatching { work.action() }.isSuccess
                    runCatching { work.completed(success) }
                }
                is Work.Barrier -> runCatching { work.action() }
            }
        }
    }

    fun close() = synchronized(lock) { if (!closed) { closed = true; executor.shutdown() } }
    fun awaitTermination(timeoutMillis: Long): Boolean = executor.awaitTermination(timeoutMillis, TimeUnit.MILLISECONDS)
}
