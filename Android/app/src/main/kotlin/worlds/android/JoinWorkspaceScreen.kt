package worlds.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import worlds.identity.*
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.atomic.AtomicBoolean

internal interface JoinWorkspaceGateway {
    fun preview(link: String): InvitePreview
    fun accept(preview: InvitePreview): AcceptedInvite
}
private class DeviceJoinGateway(private val identity: String, private val app: android.content.Context, private val sync: AccountSyncRuntime) : JoinWorkspaceGateway {
    private fun service() = IdentityService(identity, EncryptedSessionStore(app), networkAvailable = { networkAvailable(app) })
    private fun <T> guarded(action: () -> T): T = try { action() } catch (e: Exception) {
        if (e is ReauthenticationRequired || e is RefreshUncertain || (e is IdentityApiException && e.status == 401)) sync.accountChange { }
        throw e
    }
    override fun preview(link: String) = guarded { service().previewInvite(link) }
    override fun accept(preview: InvitePreview) = guarded { service().acceptInvite(preview) }
}

@Composable internal fun JoinWorkspaceScreen(identity: String, onBack: () -> Unit,
    gatewayOverride: JoinWorkspaceGateway? = null, runtimeOverride: AccountSyncRuntime? = null, onOpenPages: ((Workspace) -> Unit)? = null) {
    val app = LocalContext.current.applicationContext
    val runtime = remember(runtimeOverride) { runtimeOverride ?: WorldsAccountSync.get(app) }
    val gateway = remember(identity, gatewayOverride) { gatewayOverride ?: DeviceJoinGateway(identity, app, runtime) }
    val scope = rememberCoroutineScope(); val keyboard = LocalSoftwareKeyboardController.current; val valid = remember { AtomicBoolean(true) }
    var link by remember { mutableStateOf("") }; var preview by remember { mutableStateOf<InvitePreview?>(null) }
    var accepted by remember { mutableStateOf<AcceptedInvite?>(null) }; var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }; var invalid by remember { mutableStateOf(false) }; var uncertain by remember { mutableStateOf(false) }
    var rejected by remember { mutableStateOf<String?>(null) }
    fun check() {
        if (busy || uncertain || link.isBlank() || !valid.get()) return
        val input = link; busy = true; error = false; invalid = false; rejected = null; preview = null; keyboard?.hide()
        scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { gateway.preview(input) } }
            if (valid.get()) {
                result.onSuccess { preview = it }.onFailure { if (it is IllegalArgumentException) invalid = true else error = true }
                busy = false
            }
        }
    }
    fun accept() {
        val selected = preview ?: return
        if (busy || uncertain || !selected.valid || !valid.get()) return
        busy = true; error = false
        scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { gateway.accept(selected) } }
            if (valid.get()) {
                result.onSuccess { accepted = it; link = ""; preview = null }.onFailure {
                    if (it is IdentityApiException && it.status == 410 && it.code in setOf("invite_not_found", "invite_revoked", "invite_expired", "invite_used_up")) { rejected = it.code; preview = null }
                    else { error = true; uncertain = true }
                }
                busy = false
            }
        }
    }
    DisposableEffect(runtime) {
        val observer = runtime.observeAccountChanges { valid.set(false); scope.launch { link = ""; preview = null; accepted = null; onBack() } }
        onDispose { valid.set(false); observer.close() }
    }
    BackHandler(enabled = !busy) { onBack() }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = 640.dp).fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp)) {
                TextButton(enabled = !busy, onClick = onBack) { WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.back)) }
                Text(stringResource(R.string.join_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(12.dp))
                Text(stringResource(R.string.join_server, identity), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(20.dp))
                if (accepted == null) {
                    OutlinedTextField(value = link, onValueChange = { link = it.take(2048); preview = null; invalid = false; rejected = null; error = false }, enabled = !busy && !uncertain,
                        label = { Text(stringResource(R.string.join_link)) }, leadingIcon = { WorldsGlyph(R.drawable.ic_mail) }, minLines = 2,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done, autoCorrectEnabled = false),
                        textStyle = LocalTextStyle.current.copy(textDirection = TextDirection.Ltr), modifier = Modifier.fillMaxWidth().testTag("join_link"))
                    Spacer(Modifier.height(12.dp))
                    if (busy) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                    if (invalid) Text(stringResource(R.string.join_invalid), color = MaterialTheme.colorScheme.error)
                    rejected?.let { reason -> Text(stringResource(inviteReasonLabel(reason)), color = MaterialTheme.colorScheme.error) }
                    if (error) Text(stringResource(if (uncertain) R.string.join_uncertain else R.string.join_error), color = MaterialTheme.colorScheme.error)
                    preview?.let { item ->
                        if (!item.valid) {
                            Text(stringResource(inviteReasonLabel(item.reason)), color = MaterialTheme.colorScheme.error)
                        } else {
                            Text(requireNotNull(item.workspaceName), style = MaterialTheme.typography.titleMedium, modifier = Modifier.testTag("join_preview_workspace"))
                            Text(stringResource(R.string.join_preview_role, stringResource(roleLabel(requireNotNull(item.role)))))
                            Text(stringResource(R.string.invites_expires, DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(requireNotNull(item.expiresAt)))), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (item.pageLevel != null) Text(stringResource(R.string.join_page_invite), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    if (preview?.valid == true) Button(enabled = !busy && !uncertain, onClick = ::accept, modifier = Modifier.testTag("join_accept")) { WorldsActionLabel(R.drawable.ic_users, stringResource(R.string.join_action)) }
                    else Button(enabled = !busy && !uncertain && link.isNotBlank(), onClick = ::check, modifier = Modifier.testTag("join_preview")) { WorldsActionLabel(R.drawable.ic_search, stringResource(R.string.join_check)) }
                } else {
                    val result = requireNotNull(accepted)
                    Text(stringResource(if (result.alreadyMember) R.string.join_already else R.string.join_success, result.workspace.name), modifier = Modifier.testTag("join_success"))
                    if (result.pageId != null) Text(stringResource(R.string.join_page_received), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                    if (onOpenPages != null) TextButton(onClick = { onOpenPages(result.workspace) }, modifier = Modifier.testTag("join_open_pages")) { WorldsActionLabel(R.drawable.ic_files, stringResource(R.string.pages_title)) }
                    Button(onClick = onBack, modifier = Modifier.testTag("join_done")) { Text(stringResource(R.string.close)) }
                }
            }
        }
    }
}

@androidx.annotation.StringRes private fun inviteReasonLabel(reason: String?) = when (reason) {
    "invite_revoked" -> R.string.join_revoked; "invite_expired" -> R.string.join_expired; "invite_used_up" -> R.string.join_used; else -> R.string.join_invalid
}
