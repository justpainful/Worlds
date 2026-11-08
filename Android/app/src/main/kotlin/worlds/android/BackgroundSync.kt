package worlds.android

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import worlds.identity.ReauthenticationRequired
import worlds.identity.EncryptedSessionStore
import worlds.identity.IdentityService
import worlds.sync.AndroidSyncStore
import worlds.identity.RefreshUncertain
import worlds.sync.SyncSession
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

internal object BackgroundSync {
    internal fun workName(principal: SyncPrincipal, endpoint: String, workspace: String, page: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(listOf(principal.authority, principal.userId, principal.deviceId, endpoint, workspace, page).joinToString("\u0000").toByteArray())
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        return "worlds-outbox-$digest"
    }
    /** Persist the reconciler before editing; KEEP leaves an existing schedule intact. */
    fun ensureSweep(context: Context) {
        val request = PeriodicWorkRequestBuilder<OutboxSweepWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("worlds-outbox-sweep", ExistingPeriodicWorkPolicy.KEEP, request).result.get(10, TimeUnit.SECONDS)
    }
    fun enqueue(context: Context, principal: SyncPrincipal, endpoint: String, workspace: String, page: String) {
        val data = workDataOf("authority" to principal.authority, "user" to principal.userId, "device" to principal.deviceId,
            "endpoint" to endpoint, "workspace" to workspace, "page" to page)
        val request = OneTimeWorkRequestBuilder<OutboxSyncWorker>().setInputData(data)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork(workName(principal, endpoint, workspace, page), ExistingWorkPolicy.APPEND_OR_REPLACE, request).result.get(10, TimeUnit.SECONDS)
    }
}

/** A bounded connection for one already-authorized page, without storing tokens in WorkManager. */
class OutboxSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    internal var runtimeProvider: (Context) -> AccountSyncRuntime = { WorldsAccountSync.get(it) }
    override suspend fun doWork(): Result {
        val authority = inputData.getString("authority") ?: return Result.failure()
        val user = inputData.getString("user") ?: return Result.failure()
        val device = inputData.getString("device") ?: return Result.failure()
        val endpoint = inputData.getString("endpoint") ?: return Result.failure()
        val workspace = inputData.getString("workspace") ?: return Result.failure()
        val page = inputData.getString("page") ?: return Result.failure()
        return when (BackgroundDrain.run(runtimeProvider(applicationContext), SyncPrincipal(authority, user, device), endpoint, workspace, page)) {
            DrainResult.DONE -> Result.success()
            DrainResult.RETRY -> Result.retry()
        }
    }
}

/** Finds missed scheduling after a crash or reauthentication without persisting credentials in work data. */
class OutboxSweepWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    internal var runtimeProvider: (Context) -> AccountSyncRuntime = { WorldsAccountSync.get(it) }
    internal var principalProvider: (Context) -> SyncPrincipal? = { app ->
        val vault = EncryptedSessionStore(app)
        val authority = vault.storedServer()
        val session = authority?.let { IdentityService(it, vault).session() }
        if (authority == null || session == null) null else SyncPrincipal(authority, session.profile.userId, session.profile.deviceId)
    }
    internal var scanProvider: (Context, SyncPrincipal, Int) -> Pair<Int, List<worlds.sync.CachedPage>> = { app, principal, previous ->
        AndroidSyncStore(app).use { store ->
            val batch = store.pendingPages(principal.authority, principal.userId, principal.deviceId, 9, previous)
            if (batch.isEmpty() && previous != 0) 0 to store.pendingPages(principal.authority, principal.userId, principal.deviceId, 9, 0) else previous to batch
        }
    }
    override suspend fun doWork(): Result {
        val principal = try { withContext(Dispatchers.IO) { principalProvider(applicationContext) } } catch (e: CancellationException) { throw e }
        catch (_: ReauthenticationRequired) { return Result.success() }
        catch (_: IOException) { return Result.retry() }
        catch (_: Exception) { return Result.retry() }
        if (principal == null) return Result.success()
        val prefs = applicationContext.getSharedPreferences("worlds-outbox-sweep", Context.MODE_PRIVATE)
        val previous = prefs.getInt("offset", 0).coerceIn(0, 1_000_000)
        val scan = try { withContext(Dispatchers.IO) { scanProvider(applicationContext, principal, previous) } } catch (e: CancellationException) { throw e }
        catch (_: Exception) { return Result.retry() }
        val outcome = BackgroundSweep.run(runtimeProvider(applicationContext), principal, scan.second)
        val next = if (scan.second.size > 8 && scan.first <= 999_992) scan.first + 8 else 0
        if (!prefs.edit().putInt("offset", next).commit()) return Result.retry()
        return if (outcome == DrainResult.RETRY) Result.retry() else Result.success()
    }
}

internal object BackgroundSweep {
    suspend fun run(runtime: AccountSyncRuntime, principal: SyncPrincipal, pages: List<worlds.sync.CachedPage>): DrainResult {
        var retry = pages.size > 8
        for (page in pages.take(8)) {
            if (BackgroundDrain.run(runtime, principal, page.endpoint, page.workspace, page.page) == DrainResult.RETRY) retry = true
        }
        return if (retry) DrainResult.RETRY else DrainResult.DONE
    }
}

internal enum class DrainResult { DONE, RETRY }
internal object BackgroundDrain {
    suspend fun run(runtime: AccountSyncRuntime, principal: SyncPrincipal, endpoint: String, workspace: String, page: String, timeoutMs: Long = 45_000): DrainResult {
        val completed = CompletableDeferred<Boolean>()
        val closed = CompletableDeferred<Int?>()
        val attention = java.util.concurrent.atomic.AtomicBoolean(false)
        val listener = object : SyncSession.Listener {
            override fun onState(channel: Int, snapshot: ByteArray) = Unit
            override fun onAccess(level: String) = Unit
            override fun onAttention(channel: Int, archiveId: String, reason: String) { attention.set(true) }
            override fun onClosed(code: Int?) { closed.complete(code); completed.complete(false) }
            override fun onError() = Unit
            override fun onTransportFailure() = Unit
        }
        val opened = try { withContext(Dispatchers.IO) { runtime.openBound(principal.authority, endpoint, workspace, page, listener, principal) } }
        catch (e: CancellationException) { throw e }
        catch (_: AccountSyncRuntime.SessionActive) { return DrainResult.RETRY }
        catch (_: ReauthenticationRequired) { return DrainResult.DONE }
        catch (_: RefreshUncertain) { return DrainResult.DONE }
        catch (_: IllegalArgumentException) { return DrainResult.DONE }
        catch (_: IOException) { return DrainResult.RETRY }
        catch (_: Exception) { return DrainResult.RETRY }
        try {
            opened.session.whenOutboxSynced { completed.complete(it) }
            val ok = withTimeoutOrNull(timeoutMs) { completed.await() }
            if (ok == true) return DrainResult.DONE
            val code = withTimeoutOrNull(1_000) { closed.await() }
            return if (attention.get() || code in setOf(4403, -1, -2)) DrainResult.DONE else DrainResult.RETRY
        } finally {
            withContext(NonCancellable + Dispatchers.IO) { opened.session.closeAndWait() }
        }
    }
}
