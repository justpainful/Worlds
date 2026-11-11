package worlds.android

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import org.json.JSONObject
import worlds.content.Resource

internal data class DocumentTypography(val size: Float = 12f, val leading: Float = 1.5f)

internal fun documentTypography(metadata: String): DocumentTypography {
    val doc = runCatching { JSONObject(metadata).optJSONObject("doc") }.getOrNull()
    val size = doc?.optDouble("fontSize", 12.0)?.toFloat()?.takeIf { it.isFinite() && it in 6f..48f } ?: 12f
    val leading = doc?.optDouble("lineHeight", 1.5)?.toFloat()?.takeIf { it.isFinite() && it in 1f..3f } ?: 1.5f
    return DocumentTypography(size, leading)
}

@Composable internal fun DocumentTypographyDialog(target: Resource, busy: Boolean, onDismiss: () -> Unit, onSave: (Double, Double, (Boolean) -> Unit) -> Unit) {
    val initial = documentTypography(target.metadata)
    var size by rememberSaveable(target.id, target.revision) { mutableFloatStateOf(initial.size) }
    var leading by rememberSaveable(target.id, target.revision) { mutableFloatStateOf(initial.leading) }
    var error by rememberSaveable(target.id, target.revision) { mutableStateOf(false) }
    val sizeLabel = stringResource(R.string.document_body_size)
    val spacingLabel = stringResource(R.string.document_line_spacing)
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { WorldsActionLabel(R.drawable.ic_type, stringResource(R.string.document_typography)) },
        text = { Column {
            Text(stringResource(R.string.document_body_size_value, size), style = MaterialTheme.typography.bodyMedium)
            Slider(value = size, onValueChange = { size = kotlin.math.round(it * 2f) / 2f; error = false }, valueRange = 6f..48f, enabled = !busy,
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = sizeLabel })
            Text(stringResource(R.string.document_line_spacing_value, leading), style = MaterialTheme.typography.bodyMedium)
            Slider(value = leading, onValueChange = { leading = kotlin.math.round(it * 20f) / 20f; error = false }, valueRange = 1f..3f, enabled = !busy,
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = spacingLabel })
            if (error) Text(stringResource(R.string.document_running_error), color = MaterialTheme.colorScheme.error)
        } },
        confirmButton = { TextButton(enabled = !busy, onClick = {
            val sizeValue = kotlin.math.round(size * 2f).toDouble() / 2.0
            val lineValue = kotlin.math.round(leading * 20f).toDouble() / 20.0
            onSave(sizeValue, lineValue) { success -> if (success) onDismiss() else error = true }
        }) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}
