package worlds.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import worlds.sync.RecoveredText
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun RecoveryItem(entry: RecoveredText, page: String? = null, workspace: String? = null, tagPrefix: String,
    onCopy: () -> Unit, onDelete: () -> Unit, onRestore: (() -> Unit)? = null) {
    Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp)) {
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(10.dp), modifier = Modifier.size(40.dp)) {
                    Box(contentAlignment = Alignment.Center) { WorldsGlyph(R.drawable.ic_file_text, tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                Column(Modifier.weight(1f)) {
                    if (page != null) Text(stringResource(R.string.shared_recovered_page, page), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (workspace != null) Text(stringResource(R.string.shared_recovered_workspace, workspace), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    val reason = when (entry.reason) { "revoked" -> R.string.shared_recovery_revoked; "rejected" -> R.string.shared_recovery_rejected; "unfinished" -> R.string.shared_recovery_unfinished; else -> R.string.shared_recovered_title }
                    Text(stringResource(reason), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(entry.createdAt)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Spacer(Modifier.height(16.dp))
            Text(entry.text.ifEmpty { stringResource(R.string.shared_recovered_empty) }, style = MaterialTheme.typography.bodyLarge,
                maxLines = 6, overflow = TextOverflow.Ellipsis, modifier = Modifier.testTag("${tagPrefix}_${entry.id}"))
            Spacer(Modifier.height(8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (onRestore != null) TextButton(onClick = onRestore, modifier = Modifier.testTag("restore_recovery_${entry.id}")) {
                    WorldsActionLabel(R.drawable.ic_pencil, stringResource(R.string.shared_recovered_edit))
                }
                TextButton(onClick = onCopy) { WorldsActionLabel(R.drawable.ic_files, stringResource(R.string.shared_recovered_copy)) }
                TextButton(onClick = onDelete) { WorldsActionLabel(R.drawable.ic_trash_2, stringResource(R.string.shared_recovered_delete)) }
            }
        }
    }
}
