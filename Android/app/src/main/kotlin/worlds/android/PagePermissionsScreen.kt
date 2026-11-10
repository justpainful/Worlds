package worlds.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import worlds.identity.*
import java.util.concurrent.atomic.AtomicBoolean

internal data class PageAccessSnapshot(val permissions: PagePermissions, val members: List<WorkspaceMember>, val groups: List<WorkspaceGroup>)
internal interface PageAccessGateway {
    fun list(expected: AccountProfile?): PageAccessSnapshot
    fun set(expected: AccountProfile, type: String, principal: String, level: String)
    fun remove(expected: AccountProfile, type: String, principal: String)
    fun inherit(expected: AccountProfile, value: Boolean)
}
private class DevicePageAccessGateway(private val identity: String, private val workspace: String, private val page: String, private val app: android.content.Context, private val sync: AccountSyncRuntime) : PageAccessGateway {
    private fun service() = IdentityService(identity, EncryptedSessionStore(app), networkAvailable = { networkAvailable(app) })
    private fun <T> guarded(action: () -> T): T = try { action() } catch (e: Exception) {
        if (e is ReauthenticationRequired || e is RefreshUncertain || (e is IdentityApiException && e.status == 401)) sync.accountChange { }
        throw e
    }
    override fun list(expected: AccountProfile?) = guarded {
        val client = service(); val permissions = client.pagePermissions(workspace, page, expected)
        PageAccessSnapshot(permissions, client.workspaceMembers(workspace, permissions.profile).members, client.workspaceGroups(workspace, permissions.profile))
    }
    override fun set(expected: AccountProfile, type: String, principal: String, level: String) = guarded { service().setPagePermission(workspace, page, type, principal, level, expected) }
    override fun remove(expected: AccountProfile, type: String, principal: String) = guarded { service().removePagePermission(workspace, page, type, principal, expected) }
    override fun inherit(expected: AccountProfile, value: Boolean) = guarded { service().setPageInheritance(workspace, page, value, expected) }
}
private data class AccessRow(val type: String, val id: String, val label: String, val level: String?, val inherited: Boolean, val guest: Boolean)
private data class AccessChange(val row: AccessRow? = null, val level: String? = null, val inherit: Boolean? = null)

@Composable internal fun PagePermissionsScreen(identity: String, workspace: Workspace, page: String, onBack: () -> Unit,
    gatewayOverride: PageAccessGateway? = null, runtimeOverride: AccountSyncRuntime? = null) {
    val app = LocalContext.current.applicationContext
    val runtime = remember(runtimeOverride) { runtimeOverride ?: WorldsAccountSync.get(app) }
    val gateway = remember(identity, workspace.id, page, gatewayOverride) { gatewayOverride ?: DevicePageAccessGateway(identity, workspace.id, page, app, runtime) }
    val scope = rememberCoroutineScope(); val valid = remember { AtomicBoolean(true) }
    var data by remember { mutableStateOf<PageAccessSnapshot?>(null) }; var owner by remember { mutableStateOf<AccountProfile?>(null) }
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf(false) }; var uncertain by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf<String?>(null) }; var pending by remember { mutableStateOf<AccessChange?>(null) }
    fun load() {
        if (busy || !valid.get()) return
        busy = true; error = false; val expected = owner
        scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { gateway.list(expected) } }
            if (valid.get()) { result.onSuccess { data = it; owner = it.permissions.profile; uncertain = false }.onFailure { data = null; error = true }; busy = false }
        }
    }
    fun apply(change: AccessChange) {
        val current = data ?: return; val p = current.permissions
        if (busy || uncertain || p.myLevel != "full" || !p.mirrored || !valid.get()) return
        val row = change.row
        if (row != null) {
            if (change.level == "full" && row.guest) return
            if (change.level == null && (row.inherited || row.level == null)) return
        }
        busy = true; error = false; pending = null
        scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                when { change.inherit != null -> gateway.inherit(p.profile, change.inherit)
                    row != null && change.level == null -> gateway.remove(p.profile, row.type, row.id)
                    row != null -> gateway.set(p.profile, row.type, row.id, requireNotNull(change.level))
                    else -> error("Invalid access change") }
                gateway.list(p.profile)
            } }
            if (valid.get()) { result.onSuccess { data = it; owner = it.permissions.profile; uncertain = false }.onFailure { data = null; error = true; uncertain = true }; busy = false }
        }
    }
    DisposableEffect(runtime) {
        val observer = runtime.observeAccountChanges { valid.set(false); scope.launch { data = null; owner = null; pending = null; onBack() } }
        onDispose { valid.set(false); observer.close() }
    }
    LaunchedEffect(gateway) { load() }
    BackHandler(enabled = !busy) { onBack() }
    pending?.let { action -> AlertDialog(onDismissRequest = { pending = null }, title = { Text(stringResource(R.string.access_confirm_title)) },
        text = { Text(when { action.inherit == true -> stringResource(R.string.access_confirm_inherit)
            action.inherit == false -> stringResource(R.string.access_confirm_restrict)
            action.level == null -> stringResource(R.string.access_confirm_remove, action.row?.label.orEmpty())
            else -> stringResource(R.string.access_confirm_set, action.row?.label.orEmpty(), stringResource(accessLevelLabel(action.level))) }) },
        confirmButton = { TextButton(enabled = !busy, onClick = { apply(action) }, modifier = Modifier.testTag("access_confirm")) { Text(stringResource(R.string.confirm)) } },
        dismissButton = { TextButton(onClick = { pending = null }) { Text(stringResource(R.string.cancel)) } }) }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = 900.dp).fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(horizontal = 24.dp, vertical = 20.dp)) {
                TextButton(enabled = !busy, onClick = onBack) { WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.back)) }
                Text(stringResource(R.string.access_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.pages_identifier, page), color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (busy) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                if (error) Text(stringResource(if (uncertain) R.string.access_uncertain else R.string.access_error), color = MaterialTheme.colorScheme.error)
                TextButton(enabled = !busy, onClick = ::load, modifier = Modifier.testTag("access_refresh")) { WorldsActionLabel(R.drawable.ic_refresh_cw, stringResource(R.string.workspace_reload)) }
                data?.let { snapshot ->
                    val p = snapshot.permissions; val editable = p.myLevel == "full" && p.mirrored && !busy && !uncertain
                    val members = snapshot.members.associateBy { it.userId }; val groups = snapshot.groups.associateBy { it.id }
                    val rows = p.entries.map { entry ->
                        val member = members[entry.principalId]
                        val label = when (entry.type) { "workspace" -> stringResource(R.string.access_everyone); "user" -> member?.name?.ifBlank { member.email.ifBlank { member.userId } } ?: entry.principalId; else -> groups[entry.principalId]?.name ?: entry.principalId }
                        AccessRow(entry.type, entry.principalId, label, entry.level, entry.inherited, member?.role == "guest")
                    }.toMutableList()
                    if (rows.none { it.type == "workspace" }) rows.add(0, AccessRow("workspace", "*", stringResource(R.string.access_everyone), null, false, false))
                    val represented = rows.map { it.type to it.id }.toHashSet()
                    snapshot.members.filter { it.role !in setOf("owner", "admin") && ("user" to it.userId) !in represented }.forEach { rows.add(AccessRow("user", it.userId, it.name.ifBlank { it.email.ifBlank { it.userId } }, null, false, it.role == "guest")) }
                    snapshot.groups.filter { group -> ("group" to group.id) !in represented }.forEach { rows.add(AccessRow("group", it.id, it.name, null, false, false)) }
                    Text(stringResource(R.string.access_yours, stringResource(accessLevelLabel(p.myLevel))), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (!p.mirrored) Text(stringResource(R.string.access_not_mirrored), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (p.myLevel != "full") Text(stringResource(R.string.access_read_only), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    val inheritLabel = stringResource(R.string.access_inherit)
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                        Column(Modifier.weight(1f)) { Text(inheritLabel); Text(stringResource(R.string.access_inherit_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        Switch(checked = p.inherit, enabled = editable, onCheckedChange = { pending = AccessChange(inherit = it) }, modifier = Modifier.semantics { contentDescription = inheritLabel }.testTag("access_inherit"))
                    }
                    LazyColumn(Modifier.weight(1f)) {
                        items(rows, key = { "${it.type}:${it.id}" }) { row ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 10.dp).testTag("access_${row.type}_${row.id}"), verticalAlignment = Alignment.CenterVertically) {
                                WorldsGlyph(if (row.type == "user") R.drawable.ic_circle_user else R.drawable.ic_users, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(row.label)
                                    Text(if (row.level == null) stringResource(R.string.access_default) else stringResource(accessLevelLabel(row.level)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    if (row.inherited) Text(stringResource(R.string.access_inherited), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Box {
                                    TextButton(enabled = editable, onClick = { menu = "${row.type}:${row.id}" }, modifier = Modifier.testTag("access_menu_${row.type}_${row.id}")) { WorldsActionLabel(R.drawable.ic_sliders_horizontal, stringResource(R.string.access_change)) }
                                    DropdownMenu(expanded = menu == "${row.type}:${row.id}", onDismissRequest = { menu = null }) {
                                        listOf("view", "comment", "edit", "full", "none").filterNot { it == "full" && row.guest }.forEach { level ->
                                            DropdownMenuItem(text = { Text(stringResource(accessLevelLabel(level))) }, onClick = { menu = null; pending = AccessChange(row = row, level = level) }, modifier = Modifier.testTag("access_set_${row.type}_${row.id}_$level"))
                                        }
                                        if (row.level != null && !row.inherited) DropdownMenuItem(text = { Text(stringResource(R.string.access_remove)) }, onClick = { menu = null; pending = AccessChange(row = row) }, modifier = Modifier.testTag("access_remove_${row.type}_${row.id}"))
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
}
@androidx.annotation.StringRes private fun accessLevelLabel(level: String) = when (level) {
    "view" -> R.string.pages_view; "comment" -> R.string.pages_comment; "edit" -> R.string.pages_edit; "full" -> R.string.pages_full; "none" -> R.string.access_none; else -> R.string.workspace_role_unknown
}
