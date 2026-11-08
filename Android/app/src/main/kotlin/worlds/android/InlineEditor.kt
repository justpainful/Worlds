package worlds.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import worlds.content.InlineEditing
import worlds.content.LinkAddress
import org.json.JSONObject

private fun splitsPair(text: String, index: Int): Boolean =
    index > 0 && index < text.length && text[index - 1].isHighSurrogate() && text[index].isLowSurrogate()

internal fun replaceChangedText(raw: String, old: String, new: String): String {
    var prefix = 0
    while (prefix < old.length && prefix < new.length && old[prefix] == new[prefix]) prefix++
    while (splitsPair(old, prefix) || splitsPair(new, prefix)) prefix--
    var suffix = 0
    while (suffix < old.length - prefix && suffix < new.length - prefix && old[old.length - 1 - suffix] == new[new.length - 1 - suffix]) suffix++
    while (splitsPair(old, old.length - suffix) || splitsPair(new, new.length - suffix)) suffix--
    return InlineEditing.replace(raw, prefix, old.length - suffix, new.substring(prefix, new.length - suffix))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun InlineEditorDialog(target: EditorTarget, busy: Boolean, saveError: Boolean, onCancel: () -> Unit, onSave: (String) -> Unit) {
    var raw by rememberSaveable(target.pageId, target.blockId) { mutableStateOf(target.initial) }
    var value by rememberSaveable(target.pageId, target.blockId, stateSaver = TextFieldValue.Saver) { mutableStateOf(TextFieldValue(previewBlock(raw, false).text)) }
    var inputError by rememberSaveable { mutableStateOf(false) }
    var discardPrompt by rememberSaveable { mutableStateOf(false) }
    var linkDialog by rememberSaveable { mutableStateOf(false) }
    var linkValue by rememberSaveable { mutableStateOf("") }
    var linkStart by rememberSaveable { mutableIntStateOf(0) }
    var linkEnd by rememberSaveable { mutableIntStateOf(0) }
    var linkError by rememberSaveable { mutableStateOf(false) }
    var colorDialog by rememberSaveable { mutableStateOf(false) }
    var colorStart by rememberSaveable { mutableIntStateOf(0) }
    var colorEnd by rememberSaveable { mutableIntStateOf(0) }
    var sizeDialog by rememberSaveable { mutableStateOf(false) }
    var sizeStart by rememberSaveable { mutableIntStateOf(0) }
    var sizeEnd by rememberSaveable { mutableIntStateOf(0) }
    fun dismiss() { if (!busy) { if (raw != target.initial) discardPrompt = true else onCancel() } }
    if (discardPrompt) {
        AlertDialog(onDismissRequest = { discardPrompt = false }, title = { Text(stringResource(R.string.discard_title)) },
            text = { Text(stringResource(R.string.discard_body)) },
            confirmButton = { TextButton(onClick = { discardPrompt = false; onCancel() }) { Text(stringResource(R.string.discard)) } },
            dismissButton = { TextButton(onClick = { discardPrompt = false }) { Text(stringResource(R.string.keep_editing)) } })
    } else AlertDialog(onDismissRequest = { dismiss() }, title = { Text(stringResource(R.string.edit_text)) },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                Text(stringResource(R.string.limited_editing), style = MaterialTheme.typography.bodySmall)
                val node = remember(raw) { JSONObject(raw) }
                val level = if (node.optString("type") == "heading") node.optJSONObject("attrs")?.optInt("level", 1) ?: 1 else 0
                if (target.listType == null && target.listItemPath == null && target.containerType == null && target.containerIndex == null && target.tablePath == null) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    (0..3).forEach { choice ->
                        FilterChip(selected = level == choice, enabled = !busy,
                            colors = FilterChipDefaults.filterChipColors(selectedContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.22f), selectedLabelColor = MaterialTheme.colorScheme.onSurface), onClick = {
                            val updated = JSONObject(raw)
                            val attrs = updated.optJSONObject("attrs") ?: JSONObject().also { updated.put("attrs", it) }
                            updated.put("type", if (choice == 0) "paragraph" else "heading")
                            if (choice == 0) attrs.remove("level") else attrs.put("level", choice)
                            raw = updated.toString()
                            value = TextFieldValue(previewBlock(raw, false).text, value.selection, value.composition)
                        }, label = { Text(if (choice == 0) stringResource(R.string.paragraph_style) else stringResource(R.string.heading_level, choice)) })
                    }
                }
                if (target.documentFormatting) {
                    if (node.optString("type") == "paragraph") {
                        Text(stringResource(R.string.document_paragraph_style), style = MaterialTheme.typography.bodySmall)
                        val selectedStyle = node.optJSONObject("attrs")?.optString("pstyle")?.takeIf { it.isNotBlank() && it != "null" } ?: "normal"
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            listOf("normal" to R.string.document_style_normal, "title" to R.string.document_style_title, "subtitle" to R.string.document_style_subtitle, "caption" to R.string.document_style_caption).forEach { (style, label) ->
                                FilterChip(selected = selectedStyle == style, enabled = !busy, onClick = { raw = InlineEditing.setParagraphStyle(raw, style) }, label = { Text(stringResource(label)) })
                            }
                        }
                    }
                    Text(stringResource(R.string.paragraph_alignment), style = MaterialTheme.typography.bodySmall)
                    val alignment = node.optJSONObject("attrs")?.optString("textAlign")?.takeUnless { it.isBlank() || it == "null" }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        listOf(Triple(null, R.string.color_default, R.drawable.ic_type), Triple("left", R.string.image_align_left, R.drawable.ic_align_left), Triple("center", R.string.image_align_center, R.drawable.ic_align_center), Triple("right", R.string.image_align_right, R.drawable.ic_align_right), Triple("justify", R.string.align_justify, R.drawable.ic_align_justify)).forEach { (choice, label, icon) ->
                            FilterChip(selected = alignment == choice, enabled = !busy, onClick = { raw = InlineEditing.setAlignment(raw, choice) }, label = { Text(stringResource(label)) }, leadingIcon = { WorldsGlyph(icon) })
                        }
                    }
                }
                val editorSettings = LocalAppearancePreferences.current
                OutlinedTextField(value = value, enabled = !busy, onValueChange = { next ->
                    val result = runCatching { if (next.text != value.text) replaceChangedText(raw, value.text, next.text) else raw }
                    if (result.isSuccess) {
                        raw = result.getOrThrow()
                        value = TextFieldValue(previewBlock(raw, false).text, next.selection, next.composition)
                        inputError = false
                    } else inputError = true
                }, label = { Text(stringResource(R.string.text_content)) }, textStyle = LocalTextStyle.current.copy(textDirection = editorDirection(editorSettings.direction)),
                    keyboardOptions = editorKeyboardOptions(editorSettings.suggestions), modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 240.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf(Triple("bold", R.string.bold, R.drawable.ic_bold), Triple("italic", R.string.italic, R.drawable.ic_italic), Triple("underline", R.string.underline, R.drawable.ic_underline), Triple("strike", R.string.strike, R.drawable.ic_strikethrough), Triple("code", R.string.inline_code, R.drawable.ic_code_2), Triple("highlight", R.string.inline_highlight, R.drawable.ic_highlighter)).forEach { (mark, label, icon) ->
                        TextButton(enabled = !busy && !value.selection.collapsed && value.composition == null, onClick = {
                            val start = value.selection.min; val end = value.selection.max
                            val result = runCatching { InlineEditing.setMark(raw, start, end, "{\"type\":\"$mark\"}", !InlineEditing.hasMark(raw, start, end, mark)) }
                            if (result.isSuccess) { raw = result.getOrThrow(); value = TextFieldValue(previewBlock(raw, false).text, value.selection); inputError = false } else inputError = true
                        }) { WorldsActionLabel(icon, stringResource(label)) }
                    }
                    TextButton(enabled = !busy && !value.selection.collapsed && value.composition == null, onClick = {
                        colorStart = value.selection.min; colorEnd = value.selection.max; colorDialog = true
                    }) { WorldsActionLabel(R.drawable.ic_type, stringResource(R.string.inline_color)) }
                    if (target.documentFormatting) TextButton(enabled = !busy && !value.selection.collapsed && value.composition == null, onClick = {
                        sizeStart = value.selection.min; sizeEnd = value.selection.max; sizeDialog = true
                    }) { WorldsActionLabel(R.drawable.ic_type, stringResource(R.string.document_text_size)) }
                    TextButton(enabled = !busy && !value.selection.collapsed && value.composition == null, onClick = {
                        val start = value.selection.min; val end = value.selection.max
                        if (InlineEditing.hasMark(raw, start, end, "link")) {
                            val result = runCatching { InlineEditing.setMark(raw, start, end, "{\"type\":\"link\"}", false) }
                            if (result.isSuccess) { raw = result.getOrThrow(); value = TextFieldValue(previewBlock(raw, false).text, value.selection); inputError = false } else inputError = true
                        } else { linkStart = start; linkEnd = end; linkValue = ""; linkError = false; linkDialog = true }
                    }) { WorldsActionLabel(R.drawable.ic_link, stringResource(R.string.inline_link)) }
                }
                if (inputError) Text(stringResource(R.string.input_error), color = MaterialTheme.colorScheme.error)
                if (saveError) Text(stringResource(R.string.editor_error), color = MaterialTheme.colorScheme.error)
            }
        }, confirmButton = { TextButton(enabled = !busy && !inputError, onClick = { onSave(raw) }) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(enabled = !busy, onClick = { dismiss() }) { Text(stringResource(R.string.cancel)) } })
    if (linkDialog) AlertDialog(onDismissRequest = { linkDialog = false }, title = { Text(stringResource(R.string.inline_link)) },
        text = {
            Column {
                OutlinedTextField(value = linkValue, onValueChange = { linkValue = it; linkError = false }, label = { Text(stringResource(R.string.inline_link_address)) }, singleLine = true, isError = linkError, modifier = Modifier.fillMaxWidth())
                if (linkError) Text(stringResource(R.string.inline_link_invalid), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { TextButton(onClick = {
            val href = linkValue.trim()
            if (!LinkAddress.isSupported(href)) linkError = true else {
                val mark = JSONObject().put("type", "link").put("attrs", JSONObject().put("href", href)).toString()
                val result = runCatching { InlineEditing.setMark(raw, linkStart, linkEnd, mark, true) }
                if (result.isSuccess) { raw = result.getOrThrow(); value = TextFieldValue(previewBlock(raw, false).text, value.selection); inputError = false; linkDialog = false } else linkError = true
            }
        }) { Text(stringResource(R.string.inline_link_apply)) } },
        dismissButton = { TextButton(onClick = { linkDialog = false }) { Text(stringResource(R.string.cancel)) } })
    if (colorDialog) {
        val colors = listOf(null to R.string.color_default, "#a1a1a8" to R.string.color_gray, "#c8a27c" to R.string.color_brown,
            "#ff9f50" to R.string.color_orange, "#f2c94c" to R.string.color_yellow, "#4cd38a" to R.string.color_green,
            "#64a8ff" to R.string.color_blue, "#b28dff" to R.string.color_purple, "#f582c0" to R.string.color_pink, "#ff6f6f" to R.string.color_red)
        fun applyColor(attribute: String, color: String?) {
            val actual = if (color == null || attribute == "color") color else {
                val n = color.substring(1).toInt(16)
                "rgba(${(n shr 16) and 255}, ${(n shr 8) and 255}, ${n and 255}, 0.24)"
            }
            val result = runCatching { InlineEditing.setTextStyleAttribute(raw, colorStart, colorEnd, attribute, actual) }
            if (result.isSuccess) { raw = result.getOrThrow(); value = TextFieldValue(previewBlock(raw, false).text, value.selection); inputError = false; colorDialog = false }
            else { inputError = true; colorDialog = false }
        }
        AlertDialog(onDismissRequest = { colorDialog = false }, title = { WorldsActionLabel(R.drawable.ic_type, stringResource(R.string.inline_color)) },
            text = {
                Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState())) {
                    listOf("color" to R.string.inline_text_color, "backgroundColor" to R.string.inline_background_color).forEach { (attribute, heading) ->
                        Text(stringResource(heading), style = MaterialTheme.typography.titleSmall)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            colors.forEach { (color, label) ->
                                TextButton(onClick = { applyColor(attribute, color) }, contentPadding = PaddingValues(horizontal = 8.dp)) {
                                    if (color != null) { Box(Modifier.size(14.dp).background(androidx.compose.ui.graphics.Color(android.graphics.Color.parseColor(color)), CircleShape)); Spacer(Modifier.width(5.dp)) }
                                    Text(stringResource(label))
                                }
                            }
                        }
                    }
                }
            }, confirmButton = { TextButton(onClick = { colorDialog = false }) { Text(stringResource(R.string.close)) } })
    }
    if (sizeDialog) {
        fun applySize(size: String?) {
            val result = runCatching { InlineEditing.setTextStyleAttribute(raw, sizeStart, sizeEnd, "fontSize", size?.let { "${it}pt" }) }
            if (result.isSuccess) { raw = result.getOrThrow(); value = TextFieldValue(previewBlock(raw, false).text, value.selection); inputError = false } else inputError = true
            sizeDialog = false
        }
        AlertDialog(onDismissRequest = { sizeDialog = false }, title = { WorldsActionLabel(R.drawable.ic_type, stringResource(R.string.document_text_size)) },
            text = { Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState())) {
                TextButton(onClick = { applySize(null) }) { Text(stringResource(R.string.document_size_default)) }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf("8", "9", "10", "10.5", "11", "12", "14", "16", "18", "20", "24", "28", "32", "36", "48", "60", "72").forEach { size ->
                        TextButton(onClick = { applySize(size) }) { Text(stringResource(R.string.document_size_value, size)) }
                    }
                }
            } }, confirmButton = { TextButton(onClick = { sizeDialog = false }) { Text(stringResource(R.string.cancel)) } })
    }
}
