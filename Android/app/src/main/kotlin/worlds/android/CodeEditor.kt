package worlds.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import worlds.content.CodeEditing

@Composable internal fun CodeEditorDialog(target: EditorTarget, busy: Boolean, saveError: Boolean, onCancel: () -> Unit, onSave: (String) -> Unit) {
    val original = remember(target.initial) { CodeEditing.read(target.initial) }
    var text by rememberSaveable(target.pageId, target.blockId) { mutableStateOf(original.text) }
    var language by rememberSaveable(target.pageId, target.blockId) { mutableStateOf(original.language) }
    var discard by rememberSaveable { mutableStateOf(false) }
    fun dismiss() { if (!busy) { if (text != original.text || language != original.language) discard = true else onCancel() } }
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text(stringResource(R.string.discard_title)) },
        text = { Text(stringResource(R.string.discard_body)) },
        confirmButton = { TextButton(onClick = { discard = false; onCancel() }) { Text(stringResource(R.string.discard)) } },
        dismissButton = { TextButton(onClick = { discard = false }) { Text(stringResource(R.string.keep_editing)) } })
    else AlertDialog(onDismissRequest = { dismiss() }, title = { Text(stringResource(R.string.edit_code)) },
        text = { Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(value = language, onValueChange = { language = it }, enabled = !busy, singleLine = true,
                label = { Text(stringResource(R.string.code_language)) }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = text, onValueChange = { text = it }, enabled = !busy,
                label = { Text(stringResource(R.string.code_content)) }, textStyle = LocalTextStyle.current.copy(fontFamily = FontFamily.Monospace),
                modifier = Modifier.fillMaxWidth().heightIn(min = 150.dp, max = 260.dp))
            if (saveError) Text(stringResource(R.string.editor_error), color = MaterialTheme.colorScheme.error)
        } }, confirmButton = { TextButton(enabled = !busy, onClick = { onSave(CodeEditing.update(target.initial, text, language)) }) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(enabled = !busy, onClick = { dismiss() }) { Text(stringResource(R.string.cancel)) } })
}
