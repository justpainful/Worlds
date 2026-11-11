package worlds.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import worlds.identity.*
import java.util.concurrent.atomic.AtomicBoolean

internal interface WorkspaceMembersGateway {
    fun list(expected: AccountProfile?): WorkspaceMembers
    fun setRole(expected: AccountProfile, target: String, role: String)
    fun remove(expected: AccountProfile, target: String)
}

private class DeviceWorkspaceMembersGateway(private val identity: String, private val workspace: String, private val app: android.content.Context, private val sync: AccountSyncRuntime) : WorkspaceMembersGateway {
    private fun service() = IdentityService(identity, EncryptedSessionStore(app), networkAvailable = { networkAvailable(app) })
    private fun <T> guarded(action: () -> T): T = try { action() } catch (e: Exception) {
        if (e is ReauthenticationRequired || e is RefreshUncertain || (e is IdentityApiException && e.status == 401)) sync.accountChange { }
        throw e
    }
    override fun list(expected: AccountProfile?) = guarded { service().workspaceMembers(workspace, expected) }
    override fun setRole(expected: AccountProfile, target: String, role: String) = guarded { service().setMemberRole(workspace, target, role, expected) }
    override fun remove(expected: AccountProfile, target: String) = guarded { service().removeMember(workspace, target, expected) }
}

internal fun allowedMemberRoles(actor: String, target: String, self: Boolean): List<String> = when {
    self || target == "owner" -> emptyList()
    actor == "owner" -> listOf("admin", "member", "guest").filterNot { it == target }
    actor == "admin" && target in setOf("member", "guest") -> listOf("member", "guest").filterNot { it == target }
    else -> emptyList()
}
internal fun canRemoveMember(actor: String, target: String, self: Boolean) = !self && target != "owner" && (actor == "owner" || (actor == "admin" && target in setOf("member", "guest")))

@Composable internal fun WorkspaceMembersScreen(identity: String, workspace: Workspace, onBack: () -> Unit,
    gatewayOverride: WorkspaceMembersGateway? = null, runtimeOverride: AccountSyncRuntime? = null, onOpenInvites: (() -> Unit)? = null) {
    val app = LocalContext.current.applicationContext
    val runtime = remember(runtimeOverride) { runtimeOverride ?: WorldsAccountSync.get(app) }
    val gateway = remember(identity, workspace.id, gatewayOverride) { gatewayOverride ?: DeviceWorkspaceMembersGateway(identity, workspace.id, app, runtime) }
    val scope = rememberCoroutineScope(); val valid = remember { AtomicBoolean(true) }
    var data by remember { mutableStateOf<WorkspaceMembers?>(null) }
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf(false) }; var uncertain by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf<String?>(null) }; var pending by remember { mutableStateOf<Pair<WorkspaceMember, String?>?>(null) }
    fun load() {
        if (busy || !valid.get()) return
        busy = true; error = false
        val expected = data?.profile
        scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { gateway.list(expected) } }
            if (valid.get()) {
                result.onSuccess { data = it; uncertain = false }.onFailure { error = true }
                busy = false
            }
        }
    }
    fun change(member: WorkspaceMember, role: String?) {
        val current = data ?: return
        if (busy || uncertain || !valid.get()) return
        val actor = current.members.singleOrNull { it.userId == current.profile.userId }?.role ?: return
        val self = member.userId == current.profile.userId
        if (role == null && !canRemoveMember(actor, member.role, self)) return
        if (role != null && role !in allowedMemberRoles(actor, member.role, self)) return
        busy = true; error = false; pending = null
        scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                if (role == null) gateway.remove(current.profile, member.userId) else gateway.setRole(current.profile, member.userId, role)
                gateway.list(current.profile)
            } }
            if (valid.get()) {
                result.onSuccess { data = it; uncertain = false }.onFailure { error = true; uncertain = true }
                busy = false
            }
        }
    }
    DisposableEffect(runtime) {
        val observer = runtime.observeAccountChanges { valid.set(false); scope.launch { data = null; pending = null; onBack() } }
        onDispose { valid.set(false); observer.close() }
    }
    LaunchedEffect(gateway) { load() }
    BackHandler(enabled = !busy) { onBack() }
    pending?.let { (member, role) ->
        val label = member.name.ifBlank { member.email.ifBlank { member.userId } }
        AlertDialog(onDismissRequest = { pending = null }, title = { Text(stringResource(if (role == null) R.string.members_remove else R.string.members_change_role)) },
            text = { Text(if (role == null) stringResource(R.string.members_remove_confirm, label) else stringResource(R.string.members_role_confirm, label, stringResource(roleLabel(role)))) },
            confirmButton = { TextButton(enabled = !busy, onClick = { change(member, role) }, modifier = Modifier.testTag("members_confirm")) { Text(stringResource(if (role == null) R.string.members_remove else R.string.members_change_role)) } },
            dismissButton = { TextButton(onClick = { pending = null }) { Text(stringResource(R.string.cancel)) } })
    }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = 900.dp).fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp)) {
                WorldsBackButton(onBack, enabled = !busy)
                Text(workspace.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.members_title), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(16.dp))
                if (busy) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                if (error) Text(stringResource(if (uncertain) R.string.members_uncertain else R.string.members_error), color = MaterialTheme.colorScheme.error)
                TextButton(enabled = !busy, onClick = ::load, modifier = Modifier.testTag("members_refresh")) { WorldsActionLabel(R.drawable.ic_refresh_cw, stringResource(R.string.workspace_reload)) }
                data?.let { snapshot ->
                    val actor = snapshot.members.single { it.userId == snapshot.profile.userId }.role
                    if (actor in setOf("owner", "admin") && onOpenInvites != null) TextButton(enabled = !busy && !uncertain, onClick = onOpenInvites, modifier = Modifier.testTag("members_invites")) {
                        WorldsActionLabel(R.drawable.ic_mail, stringResource(R.string.invites_title))
                    }
                    snapshot.members.forEach { member ->
                        val self = member.userId == snapshot.profile.userId
                        val roles = allowedMemberRoles(actor, member.role, self)
                        val removable = canRemoveMember(actor, member.role, self)
                        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp).testTag("member_${member.userId}"), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(member.name.ifBlank { member.email.ifBlank { member.userId } }, style = MaterialTheme.typography.bodyLarge)
                                if (member.name.isNotBlank() && member.email.isNotBlank()) Text(member.email, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(stringResource(roleLabel(member.role)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (roles.isNotEmpty() || removable) Box {
                                IconButton(enabled = !busy && !uncertain, onClick = { menu = member.userId }, modifier = Modifier.testTag("member_actions_${member.userId}")) { Icon(painter = androidx.compose.ui.res.painterResource(R.drawable.ic_ellipsis_vertical), contentDescription = stringResource(R.string.members_actions), modifier = Modifier.size(20.dp)) }
                                DropdownMenu(expanded = menu == member.userId, onDismissRequest = { menu = null }) {
                                    roles.forEach { role -> DropdownMenuItem(text = { Text(stringResource(R.string.members_set_role, stringResource(roleLabel(role)))) }, leadingIcon = { WorldsGlyph(R.drawable.ic_users) }, onClick = { menu = null; pending = member to role }, modifier = Modifier.testTag("member_role_${member.userId}_$role")) }
                                    if (removable) DropdownMenuItem(text = { Text(stringResource(R.string.members_remove)) }, leadingIcon = { WorldsGlyph(R.drawable.ic_trash_2) }, onClick = { menu = null; pending = member to null }, modifier = Modifier.testTag("member_remove_${member.userId}"))
                                }
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }
    }
}

@androidx.annotation.StringRes internal fun roleLabel(role: String) = when (role) {
    "owner" -> R.string.workspace_owner; "admin" -> R.string.workspace_admin; "member" -> R.string.workspace_member; "guest" -> R.string.workspace_guest; else -> R.string.workspace_role_unknown
}
