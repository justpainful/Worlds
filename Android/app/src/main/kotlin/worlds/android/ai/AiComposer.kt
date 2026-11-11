package worlds.android.ai

import worlds.android.OutlinedTextField
import worlds.android.DropdownMenu
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import worlds.android.R
import worlds.android.WorldsGlyph

/** One entry in the model menu: a model offered by a provider that is set up on this device. */
data class AiModelChoice(val providerId: String, val providerName: String, val modelId: String, val modelName: String)

@Composable
fun AiComposer(
    text: String,
    onTextChange: (String) -> Unit,
    modelLabel: String,
    choices: List<AiModelChoice>,
    selectedProviderId: String,
    selectedModelId: String,
    onChoose: (AiModelChoice) -> Unit,
    onOpenSettings: () -> Unit,
    attachments: List<ChatAttachment>,
    onRemoveAttachment: (ChatAttachment) -> Unit,
    onAddAttachment: () -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    isStreaming: Boolean,
    modifier: Modifier = Modifier
) {
    var modelMenuExpanded by remember { mutableStateOf(false) }
    val canSend = (text.isNotBlank() || attachments.isNotEmpty()) && !isStreaming
    val attachLabel = stringResource(R.string.ai_attach_page)
    val stopLabel = stringResource(R.string.ai_stop_reply)
    val sendLabel = stringResource(R.string.ai_send)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (attachments.isNotEmpty()) {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                attachments.forEach { att ->
                    InputChip(
                        selected = true,
                        onClick = { onRemoveAttachment(att) },
                        label = { Text(att.name, maxLines = 1) },
                        trailingIcon = { WorldsGlyph(R.drawable.ic_x, modifier = Modifier.size(16.dp)) }
                    )
                }
            }
        }

        OutlinedTextField(
            value = text,
            onValueChange = onTextChange,
            placeholder = { Text(stringResource(R.string.ai_message_placeholder)) },
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp, max = 140.dp),
            shape = RoundedCornerShape(14.dp)
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f, fill = false)) {
                    AssistChip(
                        onClick = { modelMenuExpanded = true },
                        enabled = !isStreaming,
                        label = { Text(modelLabel, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        leadingIcon = { WorldsGlyph(R.drawable.ic_sparkles, modifier = Modifier.size(16.dp)) }
                    )
                    DropdownMenu(
                        expanded = modelMenuExpanded,
                        onDismissRequest = { modelMenuExpanded = false },
                        modifier = Modifier.heightIn(max = 420.dp)
                    ) {
                        var lastProvider: String? = null
                        choices.forEach { choice ->
                            if (choice.providerId != lastProvider) {
                                lastProvider = choice.providerId
                                Text(
                                    choice.providerName,
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            val selected = choice.providerId == selectedProviderId && choice.modelId == selectedModelId
                            DropdownMenuItem(
                                text = { Text(choice.modelName, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                trailingIcon = { if (selected) WorldsGlyph(R.drawable.ic_check, tint = MaterialTheme.colorScheme.primary) },
                                onClick = {
                                    onChoose(choice)
                                    modelMenuExpanded = false
                                }
                            )
                        }
                        if (choices.isNotEmpty()) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.ai_providers_and_keys)) },
                            leadingIcon = { WorldsGlyph(R.drawable.ic_key_round) },
                            onClick = { modelMenuExpanded = false; onOpenSettings() }
                        )
                    }
                }

                IconButton(onClick = onAddAttachment, enabled = !isStreaming, modifier = Modifier.semantics { contentDescription = attachLabel }) {
                    WorldsGlyph(R.drawable.ic_link)
                }
            }

            if (isStreaming) {
                IconButton(
                    onClick = onStop,
                    modifier = Modifier
                        .background(MaterialTheme.colorScheme.surfaceContainerHigh, CircleShape)
                        .size(44.dp)
                        .semantics { contentDescription = stopLabel }
                ) {
                    WorldsGlyph(R.drawable.ic_pause, tint = MaterialTheme.colorScheme.onSurface)
                }
            } else {
                IconButton(
                    onClick = onSend,
                    enabled = canSend,
                    modifier = Modifier
                        .background(if (canSend) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant, CircleShape)
                        .size(44.dp)
                        .semantics { contentDescription = sendLabel }
                ) {
                    WorldsGlyph(
                        R.drawable.ic_send_horizontal,
                        tint = if (canSend) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}
