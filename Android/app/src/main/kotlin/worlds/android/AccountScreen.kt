package worlds.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import worlds.identity.Workspace
import worlds.sync.CachedPage
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable internal fun AccountScreen(model: AccountModel, pagesGatewayOverride: WorkspacePagesGateway? = null, onBack: () -> Unit) {
    val state by model.state.collectAsStateWithLifecycle()
    var sharedWorkspace by remember { mutableStateOf<Workspace?>(null) }
    var discoverWorkspace by remember { mutableStateOf<Workspace?>(null) }
    val workspaceEndpoints = remember { mutableStateMapOf<String, String>() }
    var membersWorkspace by remember { mutableStateOf<Workspace?>(null) }
    var invitesWorkspace by remember { mutableStateOf<Workspace?>(null) }
    var joinWorkspace by remember { mutableStateOf(false) }
    var showCached by remember { mutableStateOf(false) }
    var cachedSelection by remember { mutableStateOf<CachedPage?>(null) }
    var noticeTarget by remember { mutableStateOf<NotificationTarget?>(null) }
    noticeTarget?.let { page ->
        androidx.compose.runtime.key(page.workspace, page.page, page.endpoint, page.thread, page.comment) {
            SharedPageScreen(state.server, Workspace(page.workspace, page.workspace, "", 0), onBack = { noticeTarget = null }, initialServer = page.endpoint, initialPage = page.page, initialThread = page.thread, initialComment = page.comment, onOpenNotification = { noticeTarget = it })
        }
        return
    }
    if (joinWorkspace) {
        JoinWorkspaceScreen(state.server, onBack = { joinWorkspace = false; model.loadWorkspaces() }, onOpenPages = { joined -> joinWorkspace = false; discoverWorkspace = joined; model.loadWorkspaces() })
        return
    }
    invitesWorkspace?.let { workspace ->
        WorkspaceInvitesScreen(state.server, workspace, onBack = { invitesWorkspace = null })
        return
    }
    membersWorkspace?.let { workspace ->
        WorkspaceMembersScreen(state.server, workspace, onBack = { membersWorkspace = null; model.loadWorkspaces() }, onOpenInvites = { invitesWorkspace = workspace })
        return
    }
    cachedSelection?.let { page ->
        SharedPageScreen(state.server, Workspace(page.workspace, page.workspace, "", 0), onBack = { cachedSelection = null }, initialServer = page.endpoint, initialPage = page.page, onOpenNotification = { noticeTarget = it })
        return
    }
    discoverWorkspace?.let { workspace ->
        WorkspacePagesScreen(state.server, workspace, endpoint = workspaceEndpoints[workspace.id].orEmpty(), onEndpointChange = { workspaceEndpoints[workspace.id] = it }, onBack = { discoverWorkspace = null }, onOpen = { cachedSelection = it }, onManual = { discoverWorkspace = null; sharedWorkspace = workspace }, gatewayOverride = pagesGatewayOverride)
        return
    }
    if (showCached) {
        CachedPagesScreen(state.server, onBack = { showCached = false }, onOpen = { cachedSelection = it })
        return
    }
    var showRecovery by remember { mutableStateOf(false) }
    if (showRecovery) {
        RecoveryLibraryScreen(state.server, onBack = { showRecovery = false })
        return
    }
    sharedWorkspace?.let { workspace ->
        SharedPageScreen(state.server, workspace, onBack = { sharedWorkspace = null }, initialServer = workspaceEndpoints[workspace.id].orEmpty(), onOpenNotification = { noticeTarget = it })
        return
    }
    val keyboard = LocalSoftwareKeyboardController.current
    var server by remember(state.server) { mutableStateOf(state.server) }
    var email by remember { mutableStateOf("") }
    var code by remember(state.challengeId) { mutableStateOf("") }
    var confirmLogout by remember { mutableStateOf(false) }
    var createWorkspace by remember { mutableStateOf(false) }
    var workspaceName by remember { mutableStateOf("") }
    LaunchedEffect(state.stage, state.workspaceAttempted) {
        if (state.stage == AccountStage.CONNECTED && !state.workspaceAttempted) model.loadWorkspaces()
    }
    BackHandler(enabled = !state.busy && !confirmLogout && !createWorkspace) { onBack() }
    if (createWorkspace) AlertDialog(onDismissRequest = { createWorkspace = false },
        title = { Text(stringResource(R.string.workspace_create)) },
        text = { OutlinedTextField(value = workspaceName, onValueChange = { workspaceName = it.take(80) }, label = { Text(stringResource(R.string.workspace_name)) }, singleLine = true) },
        confirmButton = { TextButton(enabled = workspaceName.isNotBlank(), onClick = { createWorkspace = false; model.createWorkspace(workspaceName) }) { Text(stringResource(R.string.create)) } },
        dismissButton = { TextButton(onClick = { createWorkspace = false }) { Text(stringResource(R.string.cancel)) } })
    if (confirmLogout) AlertDialog(onDismissRequest = { confirmLogout = false },
        title = { Text(stringResource(R.string.account_logout)) }, text = { Text(stringResource(R.string.account_logout_confirm)) },
        confirmButton = { TextButton(modifier = Modifier.testTag("confirm_account_logout"), onClick = { confirmLogout = false; model.logout() }) { Text(stringResource(R.string.account_logout)) } },
        dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text(stringResource(R.string.cancel)) } })
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(Modifier.fillMaxHeight().widthIn(max = 640.dp).fillMaxWidth().windowInsetsPadding(WindowInsets.safeDrawing).imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp, vertical = 24.dp)) {
        TextButton(enabled = !state.busy, onClick = onBack) { WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.back)) }
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(48.dp)) {
                Box(contentAlignment = Alignment.Center) { androidx.compose.runtime.CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurfaceVariant) { WorldsGlyph(R.drawable.ic_circle_user) } }
            }
            Text(stringResource(R.string.account_title), fontSize = 28.sp, lineHeight = 36.sp, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(12.dp))
        Text(stringResource(R.string.account_local_note), color = MaterialTheme.colorScheme.onSurfaceVariant, lineHeight = 26.sp)
        Spacer(Modifier.height(24.dp))
        when (state.stage) {
            AccountStage.LOADING -> CircularProgressIndicator()
            AccountStage.SIGN_IN -> Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                Text(stringResource(R.string.account_connect), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = server, onValueChange = { server = it }, enabled = !state.busy,
                    label = { Text(stringResource(R.string.account_server)) }, leadingIcon = { WorldsGlyph(R.drawable.ic_server) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next, autoCorrectEnabled = false), textStyle = LocalTextStyle.current.copy(textDirection = TextDirection.Ltr), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = email, onValueChange = { email = it }, enabled = !state.busy,
                    label = { Text(stringResource(R.string.account_email)) }, leadingIcon = { WorldsGlyph(R.drawable.ic_mail) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Done, autoCorrectEnabled = false), textStyle = LocalTextStyle.current.copy(textDirection = TextDirection.Ltr), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(16.dp))
                Button(enabled = !state.busy, onClick = { keyboard?.hide(); model.sendCode(server, email) }) { WorldsActionLabel(R.drawable.ic_send_horizontal, stringResource(R.string.account_send_code)) }
                }
            }
            AccountStage.CODE -> {
                Text(stringResource(R.string.account_code_hint), color = MaterialTheme.colorScheme.onSurfaceVariant, lineHeight = 26.sp)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = code, onValueChange = { value -> code = value.mapNotNull { c -> Character.digit(c, 10).takeIf { it >= 0 }?.let { ('0'.code + it).toChar() } }.take(6).joinToString("") },
                    enabled = !state.busy, label = { Text(stringResource(R.string.account_code)) }, leadingIcon = { WorldsGlyph(R.drawable.ic_key_round) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done, autoCorrectEnabled = false), textStyle = LocalTextStyle.current.copy(textDirection = TextDirection.Ltr), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = !state.busy, onClick = { keyboard?.hide(); model.verify(code) }) { WorldsActionLabel(R.drawable.ic_check, stringResource(R.string.account_verify)) }
                    TextButton(enabled = !state.busy, onClick = model::changeEmail) { Text(stringResource(R.string.account_change_email)) }
                }
            }
            AccountStage.CONNECTED -> {
                Text(stringResource(R.string.account_saved), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(12.dp))
                state.info?.let { info ->
                    if (info.name.isNotBlank()) Text(info.name, style = MaterialTheme.typography.bodyLarge)
                    Text(info.server, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(enabled = !state.busy && !state.workspaceBusy, onClick = model::refresh) { WorldsActionLabel(R.drawable.ic_refresh_cw, stringResource(R.string.account_refresh)) }
                    TextButton(enabled = !state.busy && !state.workspaceBusy, onClick = { confirmLogout = true }) { WorldsActionLabel(R.drawable.ic_log_out, stringResource(R.string.account_logout)) }
                }
                TextButton(enabled = !state.busy && !state.workspaceBusy, onClick = { joinWorkspace = true }, modifier = Modifier.testTag("join_workspace")) {
                    WorldsActionLabel(R.drawable.ic_users, stringResource(R.string.join_title))
                }
                TextButton(enabled = !state.busy, onClick = { showRecovery = true }, modifier = Modifier.testTag("open_recovery_library")) {
                    WorldsActionLabel(R.drawable.ic_files, stringResource(R.string.shared_recovered_title))
                }
                TextButton(enabled = !state.busy, onClick = { showCached = true }, modifier = Modifier.testTag("open_cached_pages")) {
                    WorldsActionLabel(R.drawable.ic_files, stringResource(R.string.cached_pages_title))
                }
                Spacer(Modifier.height(20.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Spacer(Modifier.height(20.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    WorldsGlyph(R.drawable.ic_users)
                    Text(stringResource(R.string.workspace_title), style = MaterialTheme.typography.titleMedium)
                }
                Text(stringResource(R.string.workspace_note), color = MaterialTheme.colorScheme.onSurfaceVariant, lineHeight = 26.sp)
                Spacer(Modifier.height(8.dp))
                if (state.workspaceBusy) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                val workspaces = state.workspaces
                if (workspaces != null && workspaces.isEmpty() && !state.workspaceBusy) Text(stringResource(R.string.workspace_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
                workspaces?.forEach { workspace ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(40.dp)) {
                            Box(contentAlignment = Alignment.Center) { androidx.compose.runtime.CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurfaceVariant) { WorldsGlyph(R.drawable.ic_folder) } }
                        }
                        Column(Modifier.weight(1f)) {
                        Text(workspace.name, style = MaterialTheme.typography.bodyLarge)
                        val role = when (workspace.role) { "owner" -> R.string.workspace_owner; "admin" -> R.string.workspace_admin; "member" -> R.string.workspace_member; "guest" -> R.string.workspace_guest; else -> R.string.workspace_role_unknown }
                        Text(stringResource(role), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        }
                        IconButton(enabled = !state.busy && !state.workspaceBusy, onClick = { membersWorkspace = workspace }, modifier = Modifier.testTag("workspace_members_${workspace.id}")) {
                            Icon(painter = androidx.compose.ui.res.painterResource(R.drawable.ic_users), contentDescription = stringResource(R.string.members_title), modifier = Modifier.size(20.dp))
                        }
                        TextButton(enabled = !state.busy && !state.workspaceBusy, onClick = { discoverWorkspace = workspace }, modifier = Modifier.testTag("open_shared_${workspace.id}")) {
                            WorldsActionLabel(R.drawable.ic_files, stringResource(R.string.shared_open))
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
                if (state.workspaceError != null) {
                    val message = if (state.creationUncertain) R.string.workspace_create_uncertain else when (state.workspaceError) {
                        AccountError.NETWORK -> R.string.account_network_error
                        AccountError.RATE_LIMIT -> R.string.account_rate_limit
                        AccountError.INVALID_INPUT -> R.string.workspace_invalid_name
                        else -> R.string.workspace_load_error
                    }
                    Text(stringResource(message), color = MaterialTheme.colorScheme.error, lineHeight = 26.sp)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(enabled = !state.busy && !state.workspaceBusy, onClick = model::loadWorkspaces) { WorldsActionLabel(R.drawable.ic_refresh_cw, stringResource(R.string.workspace_reload)) }
                    TextButton(enabled = !state.busy && !state.workspaceBusy && state.workspaces != null && !state.needsReconcile, onClick = { workspaceName = ""; createWorkspace = true }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.workspace_create)) }
                }
            }
        }
        if (state.busy) { Spacer(Modifier.height(16.dp)); CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp) }
        state.error?.let { error ->
            val message = when (error) {
                AccountError.INVALID_INPUT -> R.string.account_invalid_input
                AccountError.INVALID_CODE -> R.string.account_invalid_code
                AccountError.EXPIRED_CODE -> R.string.account_expired_code
                AccountError.RATE_LIMIT -> R.string.account_rate_limit
                AccountError.NETWORK -> R.string.account_network_error
                AccountError.REAUTH -> R.string.account_reauth
                AccountError.FAILURE -> R.string.account_failure
            }
            Spacer(Modifier.height(16.dp)); Text(stringResource(message), color = MaterialTheme.colorScheme.error, lineHeight = 26.sp)
        }
    }
    }
    }
}
