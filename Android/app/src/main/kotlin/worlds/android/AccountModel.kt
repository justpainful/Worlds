package worlds.android

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import worlds.identity.EmailChallenge
import worlds.identity.EncryptedSessionStore
import worlds.identity.IdentityApiException
import worlds.identity.IdentityService
import worlds.identity.ReauthenticationRequired
import worlds.identity.RefreshUncertain
import worlds.identity.Workspace
import worlds.identity.canonicalBaseUrl
import java.io.IOException

internal data class AccountInfo(val server: String, val name: String, val expiresAt: Long)
internal data class RestoredAccount(val server: String?, val info: AccountInfo?, val needsLogin: Boolean = false)
internal enum class AccountStage { LOADING, SIGN_IN, CODE, CONNECTED }
internal enum class AccountError { INVALID_INPUT, INVALID_CODE, EXPIRED_CODE, RATE_LIMIT, NETWORK, REAUTH, FAILURE }
internal data class AccountState(val stage: AccountStage = AccountStage.LOADING, val busy: Boolean = false,
    val server: String = "", val challengeId: String? = null, val info: AccountInfo? = null, val error: AccountError? = null,
    val workspaces: List<Workspace>? = null, val workspaceBusy: Boolean = false, val workspaceAttempted: Boolean = false,
    val workspaceError: AccountError? = null, val needsReconcile: Boolean = false, val creationUncertain: Boolean = false)

internal interface AccountGateway {
    fun restore(): RestoredAccount
    fun start(server: String, email: String): EmailChallenge
    fun verify(server: String, challenge: String, code: String): AccountInfo
    fun refresh(server: String): AccountInfo
    fun logout(server: String)
    fun listWorkspaces(server: String): List<Workspace>
    fun createWorkspace(server: String, name: String): Workspace
}

internal class DeviceAccountGateway(application: Application) : AccountGateway {
    private val app = application.applicationContext
    private val vault = EncryptedSessionStore(application)
    private val sync = WorldsAccountSync.get(application)
    private fun service(server: String) = IdentityService(server, vault, networkAvailable = { networkAvailable(app) })
    override fun restore(): RestoredAccount {
        val server = vault.storedServer() ?: return RestoredAccount(null, null)
        return try {
            val session = service(server).session()
            if (session != null) runCatching { sync.ensureBackgroundSweep() }
            RestoredAccount(server, session?.let { AccountInfo(server, it.profile.displayName, it.expiresAt) })
        }
        catch (_: ReauthenticationRequired) { RestoredAccount(server, null, true) }
    }
    override fun start(server: String, email: String) = service(server).startEmail(email)
    override fun verify(server: String, challenge: String, code: String): AccountInfo {
        val device = Build.MODEL?.trim()?.take(80)?.takeIf { it.isNotEmpty() } ?: "Android"
        val value = sync.accountChange { service(server).verifyEmail(challenge, code, device) }
        runCatching { sync.ensureBackgroundSweep() }
        return AccountInfo(server, value.profile.displayName, value.expiresAt)
    }
    override fun refresh(server: String): AccountInfo {
        val value = stopOnIdentityLoss { service(server).refresh() }
        return AccountInfo(server, value.profile.displayName, value.expiresAt)
    }
    override fun listWorkspaces(server: String): List<Workspace> = stopOnIdentityLoss { service(server).listWorkspaces() }
    override fun createWorkspace(server: String, name: String): Workspace = stopOnIdentityLoss { service(server).createWorkspace(name) }
    override fun logout(server: String) = sync.accountChange {
        val client = service(server)
        val session = try { client.session() } catch (_: ReauthenticationRequired) { null }
        if (session != null && session.expiresAt <= System.currentTimeMillis() + 30_000) client.refresh()
        client.logout()
    }

    private fun <T> stopOnIdentityLoss(action: () -> T): T = try { action() } catch (e: Exception) {
        if (e is ReauthenticationRequired || e is RefreshUncertain || (e is IdentityApiException && e.status == 401)) {
            sync.accountChange { }
        }
        throw e
    }
}

internal class AccountModel(application: Application, private val gateway: AccountGateway) : AndroidViewModel(application) {
    constructor(application: Application) : this(application, DeviceAccountGateway(application))
    private val mutable = MutableStateFlow(AccountState())
    val state = mutable.asStateFlow()

    init {
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { gateway.restore() } }
            mutable.value = result.fold({ restored ->
                AccountState(stage = if (restored.info == null) AccountStage.SIGN_IN else AccountStage.CONNECTED,
                    server = restored.server.orEmpty(), info = restored.info, error = if (restored.needsLogin) AccountError.REAUTH else null)
            }, { AccountState(stage = AccountStage.SIGN_IN, error = AccountError.FAILURE) })
        }
    }
    fun sendCode(server: String, email: String) {
        if (mutable.value.busy || mutable.value.stage == AccountStage.LOADING) return
        val base = runCatching { canonicalBaseUrl(server) }.getOrElse { mutable.update { state -> state.copy(error = AccountError.INVALID_INPUT) }; return }
        if (email.isBlank() || email.length > 320) { mutable.update { it.copy(error = AccountError.INVALID_INPUT) }; return }
        mutable.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { gateway.start(base, email.trim()) } }
            mutable.update { state -> result.fold({ state.copy(stage = AccountStage.CODE, busy = false, server = base, challengeId = it.id, error = null) },
                { state.copy(busy = false, error = classify(it)) }) }
        }
    }
    fun verify(code: String) {
        val state = mutable.value
        val challenge = state.challengeId ?: return
        if (state.busy || state.stage != AccountStage.CODE) return
        if (!code.matches(Regex("[0-9]{6}"))) { mutable.update { it.copy(error = AccountError.INVALID_CODE) }; return }
        mutable.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { gateway.verify(state.server, challenge, code) } }
            mutable.update { old -> result.fold({ old.copy(stage = AccountStage.CONNECTED, busy = false, info = it, challengeId = null, error = null, workspaces = null, workspaceAttempted = false, workspaceError = null, needsReconcile = false, creationUncertain = false) },
                { old.copy(busy = false, error = classify(it)) }) }
        }
    }
    fun changeEmail() { if (!mutable.value.busy) mutable.update { it.copy(stage = AccountStage.SIGN_IN, challengeId = null, error = null) } }
    fun refresh() = accountAction { gateway.refresh(it) }
    fun logout() = accountAction { gateway.logout(it); null }
    private fun accountAction(action: (String) -> AccountInfo?) {
        val state = mutable.value
        if (state.busy || state.workspaceBusy || state.stage != AccountStage.CONNECTED) return
        mutable.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { action(state.server) } }
            mutable.update { old -> result.fold({ info -> old.copy(stage = if (info == null) AccountStage.SIGN_IN else AccountStage.CONNECTED, busy = false, info = info, error = null, workspaces = if (info == null) null else old.workspaces, workspaceAttempted = if (info == null) false else old.workspaceAttempted, workspaceError = if (info == null) null else old.workspaceError, needsReconcile = if (info == null) false else old.needsReconcile, creationUncertain = if (info == null) false else old.creationUncertain) },
                { failure -> if (requiresSignIn(failure)) old.copy(stage = AccountStage.SIGN_IN, busy = false, info = null, error = AccountError.REAUTH)
                    else old.copy(busy = false, error = classify(failure)) }) }
        }
    }
    fun loadWorkspaces() {
        val state = mutable.value
        if (state.stage != AccountStage.CONNECTED || state.busy || state.workspaceBusy) return
        mutable.update { it.copy(workspaceBusy = true, workspaceAttempted = true, workspaceError = null) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { gateway.listWorkspaces(state.server) } }
            mutable.update { old -> result.fold({ old.copy(workspaceBusy = false, workspaces = it, workspaceError = null, needsReconcile = false, creationUncertain = false) },
                { failure -> if (requiresSignIn(failure)) old.copy(stage = AccountStage.SIGN_IN, info = null, workspaceBusy = false, workspaces = null, workspaceAttempted = false, error = AccountError.REAUTH)
                    else old.copy(workspaceBusy = false, workspaceError = classify(failure), needsReconcile = true) }) }
        }
    }
    fun createWorkspace(name: String) {
        val state = mutable.value
        if (state.stage != AccountStage.CONNECTED || state.busy || state.workspaceBusy || state.workspaces == null || state.needsReconcile) return
        val clean = name.trim()
        if (clean.isEmpty() || clean.length > 80) { mutable.update { it.copy(workspaceError = AccountError.INVALID_INPUT) }; return }
        mutable.update { it.copy(workspaceBusy = true, workspaceError = null) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { gateway.createWorkspace(state.server, clean) } }
            mutable.update { old -> result.fold({ created -> old.copy(workspaceBusy = false, workspaces = (old.workspaces.orEmpty().filterNot { it.id == created.id } + created).sortedBy { it.name.lowercase() }, workspaceError = null) },
                { failure -> if (requiresSignIn(failure)) old.copy(stage = AccountStage.SIGN_IN, info = null, workspaceBusy = false, workspaces = null, workspaceAttempted = false, error = AccountError.REAUTH)
                    else old.copy(workspaceBusy = false, workspaceError = classify(failure), needsReconcile = failure !is IdentityApiException || failure.status !in 400..499, creationUncertain = failure !is IdentityApiException || failure.status !in 400..499) }) }
        }
    }
    private fun requiresSignIn(error: Throwable): Boolean = error is RefreshUncertain || error is ReauthenticationRequired ||
        (error is IdentityApiException && error.status == 401)

    private fun classify(error: Throwable): AccountError = when (error) {
        is ReauthenticationRequired, is RefreshUncertain -> AccountError.REAUTH
        is IdentityApiException -> when (error.code) { "invalid_code" -> AccountError.INVALID_CODE; "code_expired" -> AccountError.EXPIRED_CODE; "too_many_attempts", "rate_limited" -> AccountError.RATE_LIMIT; else -> AccountError.FAILURE }
        is IllegalArgumentException -> AccountError.INVALID_INPUT
        is IOException -> AccountError.NETWORK
        else -> AccountError.FAILURE
    }
}
