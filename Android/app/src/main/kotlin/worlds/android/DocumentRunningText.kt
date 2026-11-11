package worlds.android

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import worlds.content.Resource

@Composable internal fun DocumentRunningTextDialog(target: Resource, busy: Boolean, onDismiss: () -> Unit, onSave: (String, String, (Boolean) -> Unit) -> Unit) {
    val attrs = runCatching { JSONObject(target.metadata).optJSONObject("doc") }.getOrNull()
    var header by rememberSaveable(target.id, target.revision) { mutableStateOf(attrs?.optString("header").orEmpty()) }
    var footer by rememberSaveable(target.id, target.revision) { mutableStateOf(attrs?.optString("footer").orEmpty()) }
    var error by rememberSaveable(target.id, target.revision) { mutableStateOf(false) }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() },
        title = { WorldsActionLabel(R.drawable.ic_settings_2, stringResource(R.string.document_running_text)) },
        text = {
            Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState())) {
                Text(stringResource(R.string.document_running_explanation), style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(value = header, onValueChange = { header = it.take(2000); error = false }, enabled = !busy,
                    label = { Text(stringResource(R.string.document_header)) }, modifier = Modifier.fillMaxWidth(), maxLines = 3)
                OutlinedTextField(value = footer, onValueChange = { footer = it.take(2000); error = false }, enabled = !busy,
                    label = { Text(stringResource(R.string.document_footer)) }, modifier = Modifier.fillMaxWidth(), maxLines = 3)
                if (error) Text(stringResource(R.string.document_running_error), color = MaterialTheme.colorScheme.error)
            }
        }, confirmButton = { TextButton(enabled = !busy, onClick = { onSave(header, footer) { success -> if (success) onDismiss() else error = true } }) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}
