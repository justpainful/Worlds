package worlds.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import worlds.content.PageFind
import worlds.content.PageFindResult
import worlds.content.PageMatch
import worlds.content.ResourceDocument
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private data class FindComputation(val revision: Long, val query: String, val matchCase: Boolean, val result: PageFindResult?)

internal class PageFindSession(query: String = "", replacement: String = "", matchCase: Boolean = false, index: Int = 0) {
    var query by mutableStateOf(query)
    var replacement by mutableStateOf(replacement)
    var matchCase by mutableStateOf(matchCase)
    var index by mutableIntStateOf(index)
}

internal val PageFindSessionSaver = listSaver<PageFindSession, Any>(
    save = { listOf(it.query, it.replacement, it.matchCase, it.index) },
    restore = { PageFindSession(it[0] as String, it[1] as String, it[2] as Boolean, it[3] as Int) })

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun PageFindDialog(initial: ResourceDocument, session: PageFindSession, busy: Boolean, onDismiss: () -> Unit,
    onReplace: (ResourceDocument, String, String, Boolean, Int?, (ResourceDocument?) -> Unit) -> Unit,
    onShowBlock: (ResourceDocument, PageMatch) -> Boolean) {
    var document by remember(initial.resource.id) { mutableStateOf(initial) }
    var query by session::query
    var replacement by session::replacement
    var matchCase by session::matchCase
    var index by session::index
    var error by rememberSaveable(initial.resource.id) { mutableStateOf(false) }
    var confirmAll by rememberSaveable(initial.resource.id) { mutableStateOf(false) }
    val computed by produceState<FindComputation?>(null, document, query, matchCase) {
        val snapshot = document; val search = query; val case = matchCase
        val result = withContext(Dispatchers.Default) { runCatching { PageFind.scan(snapshot.blocks, search, case) }.getOrNull() }
        value = FindComputation(snapshot.resource.revision, search, case, result)
    }
    val searching = computed?.let { it.revision != document.resource.revision || it.query != query || it.matchCase != matchCase } ?: true
    val result = if (searching) null else computed?.result
    val matches = result?.matches.orEmpty()
    val current = index.coerceIn(0, (matches.size - 1).coerceAtLeast(0))
    fun replace(which: Int?) {
        onReplace(document, query, replacement, matchCase, which) { updated ->
            if (updated == null) error = true else { document = updated; index = 0; error = false }
        }
    }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { WorldsActionLabel(R.drawable.ic_search, stringResource(R.string.find_replace)) },
        text = { Column(Modifier.heightIn(max = 450.dp).verticalScroll(rememberScrollState())) {
            Text(stringResource(R.string.find_scope), style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(value = query, onValueChange = { if (it.length <= 256 && it != query) { query = it; index = 0; error = false } }, enabled = !busy,
                label = { Text(stringResource(R.string.find_query)) }, modifier = Modifier.fillMaxWidth().onPreviewKeyEvent { event ->
                    if (!busy && matches.isNotEmpty() && result?.truncated == false && event.type == KeyEventType.KeyDown && event.nativeKeyEvent.repeatCount == 0 && event.key == Key.Enter && !event.isCtrlPressed && !event.isAltPressed && !event.isMetaPressed) {
                        index = if (event.isShiftPressed) (current + matches.size - 1) % matches.size else (current + 1) % matches.size
                        true
                    } else false
                }, singleLine = true)
            OutlinedTextField(value = replacement, onValueChange = { if (it.length <= 2000) { replacement = it; error = false } }, enabled = !busy,
                label = { Text(stringResource(R.string.find_replacement)) }, modifier = Modifier.fillMaxWidth(), maxLines = 3)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(stringResource(R.string.find_match_case))
                val label = stringResource(R.string.find_match_case)
                Switch(checked = matchCase, onCheckedChange = { matchCase = it; index = 0 }, enabled = !busy,
                    modifier = Modifier.semantics { contentDescription = label })
            }
            if (searching) Text(stringResource(R.string.find_loading), style = MaterialTheme.typography.bodySmall)
            else if (result == null) Text(stringResource(R.string.find_invalid), color = MaterialTheme.colorScheme.error)
            else if (result.truncated) Text(stringResource(R.string.find_too_many), color = MaterialTheme.colorScheme.error)
            else {
                Text(stringResource(R.string.find_count, if (matches.isEmpty()) 0 else current + 1, matches.size), style = MaterialTheme.typography.bodySmall)
                if (matches.isNotEmpty()) {
                    val match = matches[current]
                    Text(stringResource(R.string.find_location, match.blockIndex + 1), style = MaterialTheme.typography.labelSmall)
                    val highlight = MaterialTheme.colorScheme.primary.copy(alpha = 0.30f)
                    val text = androidx.compose.ui.text.buildAnnotatedString {
                        append(match.context)
                        addStyle(androidx.compose.ui.text.SpanStyle(background = highlight, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold), match.contextStart, match.contextEnd)
                    }
                    Text(text, style = MaterialTheme.typography.bodyMedium)
                }
                if (result.skippedBlocks > 0) Text(stringResource(R.string.find_skipped, result.skippedBlocks), style = MaterialTheme.typography.bodySmall)
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(enabled = !busy && matches.size > 1, onClick = { index = (current + matches.size - 1) % matches.size }) { WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.find_previous)) }
                TextButton(enabled = !busy && matches.size > 1, onClick = { index = (current + 1) % matches.size }) { WorldsActionLabel(R.drawable.ic_chevron_right, stringResource(R.string.find_next)) }
                TextButton(enabled = !busy && matches.isNotEmpty() && result?.truncated == false, onClick = { if (!onShowBlock(document, matches[current])) error = true }) { WorldsActionLabel(R.drawable.ic_search, stringResource(R.string.find_show_block)) }
                TextButton(enabled = !busy && matches.isNotEmpty() && result?.truncated == false, onClick = { replace(current) }) { WorldsActionLabel(R.drawable.ic_pen_line, stringResource(R.string.find_replace_one)) }
                TextButton(enabled = !busy && matches.isNotEmpty() && result?.truncated == false, onClick = { confirmAll = true }) { WorldsActionLabel(R.drawable.ic_files, stringResource(R.string.find_replace_all)) }
            }
            if (error) Text(stringResource(R.string.find_error), color = MaterialTheme.colorScheme.error)
        } }, confirmButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(stringResource(R.string.close)) } })
    if (confirmAll) AlertDialog(onDismissRequest = { confirmAll = false }, title = { Text(stringResource(R.string.find_replace_all)) },
        text = { Text(stringResource(R.string.find_confirm_all, matches.size)) },
        confirmButton = { TextButton(enabled = !busy, onClick = { confirmAll = false; replace(null) }) { Text(stringResource(R.string.find_replace_all)) } },
        dismissButton = { TextButton(onClick = { confirmAll = false }) { Text(stringResource(R.string.cancel)) } })
}
