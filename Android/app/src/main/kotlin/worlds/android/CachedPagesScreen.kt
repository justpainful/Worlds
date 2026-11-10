package worlds.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import worlds.sync.CachedPage
import java.util.concurrent.atomic.AtomicBoolean

@Composable internal fun CachedPagesScreen(identity: String, onBack: () -> Unit, onOpen: (CachedPage) -> Unit, runtimeOverride: AccountSyncRuntime? = null) {
    val app = LocalContext.current.applicationContext
    val runtime = remember(runtimeOverride) { runtimeOverride ?: WorldsAccountSync.get(app) }
    val scope = rememberCoroutineScope()
    val active = remember { AtomicBoolean(true) }
    var pages by remember { mutableStateOf<List<CachedPage>?>(null) }
    var error by remember { mutableStateOf(false) }
    DisposableEffect(runtime) {
        val observer = runtime.observeAccountChanges { active.set(false); scope.launch { pages = null; onBack() } }
        onDispose { active.set(false); observer.close() }
    }
    LaunchedEffect(identity) {
        val result = runCatching { withContext(Dispatchers.IO) { runtime.cachedPageList(identity) } }
        if (active.get()) result.onSuccess { pages = it }.onFailure { error = true }
    }
    BackHandler(onBack = onBack)
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = 900.dp).fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(horizontal = 24.dp, vertical = 20.dp)) {
                TextButton(onClick = onBack) { WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.back)) }
                Text(stringResource(R.string.cached_pages_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.cached_pages_note), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(20.dp))
                if (error) Text(stringResource(R.string.cached_pages_error), color = MaterialTheme.colorScheme.error)
                else if (pages == null) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                else if (pages!!.isEmpty()) Text(stringResource(R.string.cached_pages_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
                else LazyColumn(Modifier.weight(1f)) {
                    items(pages!!, key = { "${it.workspace.length}:${it.workspace}${it.page}" }) { item ->
                        Row(Modifier.fillMaxWidth().clickable { onOpen(item) }.testTag("cached_page_${item.page}").padding(vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(40.dp)) {
                                Box(contentAlignment = Alignment.Center) { WorldsGlyph(R.drawable.ic_file_text, tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                            Column(Modifier.weight(1f)) {
                                Text(stringResource(R.string.shared_recovered_page, item.page), maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(stringResource(R.string.shared_recovered_workspace, item.workspace), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
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
