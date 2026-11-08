package worlds.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import worlds.identity.*
import worlds.sync.CachedPage
import java.util.concurrent.atomic.AtomicBoolean

internal interface WorkspacePagesGateway { fun list(expected: AccountProfile?): WorkspacePages }
private class DevicePagesGateway(private val identity: String, private val workspace: String, private val app: android.content.Context, private val sync: AccountSyncRuntime) : WorkspacePagesGateway {
    override fun list(expected: AccountProfile?): WorkspacePages = try {
        IdentityService(identity, EncryptedSessionStore(app), networkAvailable = { networkAvailable(app) }).workspacePages(workspace, expected)
    } catch (e: Exception) {
        if (e is ReauthenticationRequired || e is RefreshUncertain || (e is IdentityApiException && e.status == 401)) sync.accountChange { }
        throw e
    }
}

@Composable internal fun WorkspacePagesScreen(identity: String, workspace: Workspace, endpoint: String, onEndpointChange: (String) -> Unit,
    onBack: () -> Unit, onOpen: (CachedPage) -> Unit, onManual: () -> Unit, gatewayOverride: WorkspacePagesGateway? = null, runtimeOverride: AccountSyncRuntime? = null) {
    val app = LocalContext.current.applicationContext
    val runtime = remember(runtimeOverride) { runtimeOverride ?: WorldsAccountSync.get(app) }
    val gateway = remember(identity, workspace.id, gatewayOverride) { gatewayOverride ?: DevicePagesGateway(identity, workspace.id, app, runtime) }
    val scope = rememberCoroutineScope(); val active = remember { AtomicBoolean(true) }; val keyboard = LocalSoftwareKeyboardController.current
    var snapshot by remember { mutableStateOf<WorkspacePages?>(null) }; var owner by remember { mutableStateOf<AccountProfile?>(null) }; var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }; var invalidEndpoint by remember { mutableStateOf(false) }
    fun load() {
        if (loading || !active.get()) return
        loading = true; error = false; val expected = owner
        scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { gateway.list(expected) } }
            if (active.get()) { result.onSuccess { snapshot = it; owner = it.profile }.onFailure { error = true; snapshot = null }; loading = false }
        }
    }
    DisposableEffect(runtime) {
        val observer = runtime.observeAccountChanges { active.set(false); scope.launch { snapshot = null; owner = null; onBack() } }
        onDispose { active.set(false); observer.close() }
    }
    LaunchedEffect(gateway) { load() }
    BackHandler { onBack() }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = 900.dp).fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding().padding(horizontal = 24.dp, vertical = 20.dp)) {
                TextButton(onClick = onBack) { WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.back)) }
                Text(workspace.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.pages_title), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = endpoint, onValueChange = { onEndpointChange(it.take(2048)); invalidEndpoint = false }, label = { Text(stringResource(R.string.shared_server)) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done, autoCorrectEnabled = false), keyboardActions = KeyboardActions(onDone = { keyboard?.hide() }), textStyle = LocalTextStyle.current.copy(textDirection = TextDirection.Ltr), modifier = Modifier.fillMaxWidth().testTag("pages_server"))
                if (invalidEndpoint) Text(stringResource(R.string.pages_invalid_server), color = MaterialTheme.colorScheme.error)
                Text(stringResource(R.string.pages_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(enabled = !loading, onClick = ::load, modifier = Modifier.testTag("pages_refresh")) { WorldsActionLabel(R.drawable.ic_refresh_cw, stringResource(R.string.workspace_reload)) }
                    TextButton(onClick = onManual, modifier = Modifier.testTag("pages_manual")) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.pages_manual)) }
                }
                if (loading) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                if (error) Text(stringResource(R.string.pages_error), color = MaterialTheme.colorScheme.error)
                val pages = snapshot?.pages
                if (!loading && !error && pages != null && pages.isEmpty()) Text(stringResource(R.string.pages_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (pages != null) LazyColumn(Modifier.weight(1f)) {
                    items(pages, key = { it.id }) { page ->
                        Row(Modifier.fillMaxWidth().clickable(enabled = !loading && !error) {
                            val server = runCatching { canonicalSyncEndpoint(endpoint, false) }.getOrNull()
                            if (server == null) invalidEndpoint = true else { keyboard?.hide(); onOpen(CachedPage(workspace.id, page.id, server, page.level)) }
                        }.testTag("workspace_page_${page.id}").padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            WorldsGlyph(R.drawable.ic_file_text, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Column(Modifier.weight(1f)) {
                                Text(stringResource(R.string.pages_identifier, page.id), maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(stringResource(pageAccessLabel(page.level)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            WorldsGlyph(R.drawable.ic_chevron_right, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }
    }
}
@androidx.annotation.StringRes private fun pageAccessLabel(level: String) = when (level) {
    "view" -> R.string.pages_view; "comment" -> R.string.pages_comment; "edit" -> R.string.pages_edit; "full" -> R.string.pages_full; else -> R.string.workspace_role_unknown
}
