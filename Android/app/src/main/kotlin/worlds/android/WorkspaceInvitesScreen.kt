package worlds.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import worlds.identity.*
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.atomic.AtomicBoolean

internal data class InviteSnapshot(val profile: AccountProfile, val actorRole: String, val invites: List<WorkspaceInvite>)
internal interface WorkspaceInvitesGateway {
    fun list(expected: AccountProfile?): InviteSnapshot
    fun create(expected: AccountProfile, role: String): CreatedInvite
    fun revoke(expected: AccountProfile, id: String)
}
private class DeviceInvitesGateway(private val identity: String, private val workspace: String, private val app: android.content.Context, private val sync: AccountSyncRuntime) : WorkspaceInvitesGateway {
    private fun service() = IdentityService(identity, EncryptedSessionStore(app), networkAvailable = { networkAvailable(app) })
    private fun <T> guarded(action: () -> T): T = try { action() } catch (e: Exception) {
        if (e is ReauthenticationRequired || e is RefreshUncertain || (e is IdentityApiException && e.status == 401)) sync.accountChange { }
        throw e
    }
    override fun list(expected: AccountProfile?) = guarded {
        val client = service(); val members = client.workspaceMembers(workspace, expected)
        val role = members.members.single { it.userId == members.profile.userId }.role
        require(role in setOf("owner", "admin"))
        InviteSnapshot(members.profile, role, client.listInvites(workspace, members.profile))
    }
    override fun create(expected: AccountProfile, role: String) = guarded { service().createInvite(workspace, role, expected) }
    override fun revoke(expected: AccountProfile, id: String) = guarded { service().revokeInvite(workspace, id, expected) }
}

@Composable internal fun WorkspaceInvitesScreen(identity: String, workspace: Workspace, onBack: () -> Unit,
    gatewayOverride: WorkspaceInvitesGateway? = null, runtimeOverride: AccountSyncRuntime? = null) {
    val app = LocalContext.current.applicationContext
    val runtime = remember(runtimeOverride) { runtimeOverride ?: WorldsAccountSync.get(app) }
    val gateway = remember(identity, workspace.id, gatewayOverride) { gatewayOverride ?: DeviceInvitesGateway(identity, workspace.id, app, runtime) }
    val clipboard = LocalClipboardManager.current; val scope = rememberCoroutineScope(); val valid = remember { AtomicBoolean(true) }
    var data by remember { mutableStateOf<InviteSnapshot?>(null) }; var secret by remember { mutableStateOf<CreatedInvite?>(null) }
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf(false) }; var uncertain by remember { mutableStateOf(false) }
    var chooseRole by remember { mutableStateOf(false) }; var selectedRole by remember { mutableStateOf("member") }; var revoke by remember { mutableStateOf<WorkspaceInvite?>(null) }
    fun load() {
        if (busy || !valid.get()) return
        busy = true; error = false; val expected = data?.profile
        scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { gateway.list(expected) } }
            if (valid.get()) { result.onSuccess { data = it; uncertain = false }.onFailure { error = true }; busy = false }
        }
    }
    fun create() {
        val current = data ?: return
        val permitted = if (current.actorRole == "owner") setOf("admin", "member", "guest") else if (current.actorRole == "admin") setOf("member", "guest") else emptySet()
        if (busy || uncertain || !valid.get() || selectedRole !in permitted) return
        chooseRole = false; busy = true; error = false
        scope.launch {
            val created = runCatching { withContext(Dispatchers.IO) { gateway.create(current.profile, selectedRole) } }
            if (!valid.get()) return@launch
            created.onSuccess { secret = it }.onFailure { error = true; uncertain = true }
            if (created.isSuccess) {
                val refreshed = runCatching { withContext(Dispatchers.IO) { gateway.list(current.profile) } }
                if (!valid.get()) return@launch
                refreshed.onSuccess { data = it; uncertain = false }.onFailure { error = true; uncertain = true }
            }
            busy = false
        }
    }
    fun revokeInvite(invite: WorkspaceInvite) {
        val current = data ?: return
        if (busy || uncertain || !valid.get() || !invite.active || current.actorRole !in setOf("owner", "admin")) return
        revoke = null; busy = true; error = false
        scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { gateway.revoke(current.profile, invite.id); gateway.list(current.profile) } }
            if (valid.get()) { result.onSuccess { data = it; uncertain = false; if (secret?.id == invite.id) secret = null }.onFailure { error = true; uncertain = true }; busy = false }
        }
    }
    DisposableEffect(runtime) {
        val observer = runtime.observeAccountChanges { valid.set(false); scope.launch { secret = null; data = null; revoke = null; onBack() } }
        onDispose { valid.set(false); observer.close() }
    }
    LaunchedEffect(gateway) { load() }
    BackHandler(enabled = !busy && secret == null && !chooseRole && revoke == null) { onBack() }
    if (chooseRole) AlertDialog(onDismissRequest = { chooseRole = false }, title = { Text(stringResource(R.string.invites_create)) },
        text = { Column {
            Text(stringResource(R.string.invites_default))
            val roles = if (data?.actorRole == "owner") listOf("member", "guest", "admin") else listOf("member", "guest")
            roles.forEach { role -> Row(verticalAlignment = Alignment.CenterVertically) {
                RadioButton(selected = selectedRole == role, onClick = { selectedRole = role }, modifier = Modifier.testTag("invite_role_$role"))
                Text(stringResource(roleLabel(role)))
            } }
        } }, confirmButton = { TextButton(enabled = !busy, onClick = ::create, modifier = Modifier.testTag("invite_create_confirm")) { Text(stringResource(R.string.create)) } },
        dismissButton = { TextButton(onClick = { chooseRole = false }) { Text(stringResource(R.string.cancel)) } })
    secret?.let { link -> AlertDialog(onDismissRequest = { secret = null }, title = { Text(stringResource(R.string.invites_link_title)) },
        text = { Column { Text(stringResource(R.string.invites_link_once)); Spacer(Modifier.height(12.dp)); Text(link.url, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("invite_secret")) } },
        confirmButton = { TextButton(onClick = { clipboard.setText(AnnotatedString(link.url)); secret = null }, modifier = Modifier.testTag("invite_copy")) { Text(stringResource(R.string.invites_copy)) } },
        dismissButton = { TextButton(onClick = { secret = null }) { Text(stringResource(R.string.close)) } }) }
    revoke?.let { item -> AlertDialog(onDismissRequest = { revoke = null }, title = { Text(stringResource(R.string.invites_revoke)) },
        text = { Text(stringResource(R.string.invites_revoke_confirm)) },
        confirmButton = { TextButton(enabled = !busy, onClick = { revokeInvite(item) }, modifier = Modifier.testTag("invite_revoke_confirm")) { Text(stringResource(R.string.invites_revoke)) } },
        dismissButton = { TextButton(onClick = { revoke = null }) { Text(stringResource(R.string.cancel)) } }) }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = 900.dp).fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp)) {
                WorldsBackButton(onBack, enabled = !busy)
                Text(workspace.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.invites_title), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(16.dp))
                if (busy) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                if (error) Text(stringResource(if (uncertain) R.string.invites_uncertain else R.string.invites_error), color = MaterialTheme.colorScheme.error)
                TextButton(enabled = !busy, onClick = ::load, modifier = Modifier.testTag("invites_refresh")) { WorldsActionLabel(R.drawable.ic_refresh_cw, stringResource(R.string.workspace_reload)) }
                if (data != null) TextButton(enabled = !busy && !uncertain, onClick = { selectedRole = "member"; chooseRole = true }, modifier = Modifier.testTag("invite_create")) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.invites_create)) }
                data?.let { snapshot ->
                    if (snapshot.invites.isEmpty() && !busy) Text(stringResource(R.string.invites_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    snapshot.invites.forEach { item ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp).testTag("invite_${item.id}"), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(stringResource(roleLabel(item.role)), style = MaterialTheme.typography.bodyLarge)
                                Text(stringResource(if (item.active) R.string.invites_active else R.string.invites_inactive), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(stringResource(R.string.invites_expires, DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(item.expiresAt))), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(if (item.maxUses == null) stringResource(R.string.invites_uses, item.uses) else stringResource(R.string.invites_uses_limit, item.uses, requireNotNull(item.maxUses)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                if (item.pageId != null) Text(stringResource(R.string.invites_page), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (item.active) TextButton(enabled = !busy && !uncertain, onClick = { revoke = item }, modifier = Modifier.testTag("invite_revoke_${item.id}")) { WorldsActionLabel(R.drawable.ic_trash_2, stringResource(R.string.invites_revoke)) }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }
    }
}
