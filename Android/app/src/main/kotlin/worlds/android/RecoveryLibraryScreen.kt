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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import worlds.sync.AccountRecovery
import java.util.concurrent.atomic.AtomicBoolean

@Composable internal fun RecoveryLibraryScreen(identity: String, onBack: () -> Unit, runtimeOverride: AccountSyncRuntime? = null) {
    val app = LocalContext.current.applicationContext
    val runtime = remember(runtimeOverride) { runtimeOverride ?: WorldsAccountSync.get(app) }
    val scope = rememberCoroutineScope()
    val valid = remember { AtomicBoolean(true) }
    val clipboard = LocalClipboardManager.current
    var principal by remember { mutableStateOf<SyncPrincipal?>(null) }
    var items by remember { mutableStateOf<List<AccountRecovery>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    var more by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<AccountRecovery?>(null) }

    fun load(reset: Boolean) {
        if (loading || !valid.get()) return
        loading = true; error = false
        val before = if (reset) null else items.lastOrNull()?.entry?.id
        scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { runtime.recoveryPage(identity, principal, before) } }
            if (valid.get()) {
                result.onSuccess { (owner, page) -> principal = owner; items = if (reset) page else items + page; more = page.size == 50 }
                    .onFailure { error = true }
                loading = false
            }
        }
    }
    DisposableEffect(runtime) {
        val observer = runtime.observeAccountChanges {
            valid.set(false)
            scope.launch { items = emptyList(); selected = null; onBack() }
        }
        onDispose { valid.set(false); observer.close() }
    }
    LaunchedEffect(identity) { load(true) }
    BackHandler { onBack() }
    selected?.let { item ->
        AlertDialog(onDismissRequest = { selected = null }, title = { Text(stringResource(R.string.shared_recovered_delete)) },
            text = { Text(stringResource(R.string.shared_recovered_delete_confirm), modifier = Modifier.testTag("delete_recovery_message")) },
            confirmButton = { TextButton(modifier = Modifier.testTag("confirm_delete_recovery"), onClick = {
                selected = null
                val owner = principal ?: return@TextButton
                scope.launch {
                    val deleted = runCatching { withContext(Dispatchers.IO) { runtime.deleteRecovered(owner, item.workspace, item.page, item.entry.id) } }.getOrDefault(false)
                    if (valid.get()) { if (deleted) items = items.filterNot { it.entry.id == item.entry.id } else error = true }
                }
            }) { Text(stringResource(R.string.shared_recovered_delete)) } },
            dismissButton = { TextButton(modifier = Modifier.testTag("cancel_delete_recovery"), onClick = { selected = null }) { Text(stringResource(R.string.cancel)) } })
    }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = 900.dp).fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp)) {
                WorldsBackButton(onBack)
                Text(stringResource(R.string.shared_recovered_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.shared_recovered_note), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(20.dp))
                if (!loading && items.isEmpty() && !error) Text(stringResource(R.string.shared_recovered_none), color = MaterialTheme.colorScheme.onSurfaceVariant)
                items.forEach { item ->
                    RecoveryItem(item.entry, page = item.page, workspace = item.workspace, tagPrefix = "recovery_item",
                        onCopy = { clipboard.setText(AnnotatedString(item.entry.text)) }, onDelete = { selected = item })
                    Spacer(Modifier.height(12.dp))
                }
                if (loading) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                if (error) Text(stringResource(R.string.shared_recovered_error), color = MaterialTheme.colorScheme.error)
                if (more && !loading) TextButton(onClick = { load(false) }) { Text(stringResource(R.string.shared_recovered_more)) }
            }
        }
    }
}
