package worlds.android.ai

import worlds.android.OutlinedTextField
import worlds.android.DropdownMenu
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import worlds.android.R
import worlds.android.WorldsActionLabel
import worlds.android.WorldsGlyph
import worlds.content.Resource

@Composable
fun AiComposer(
    text: String,
    onTextChange: (String) -> Unit,
    selectedModel: AiModelInfo,
    models: List<AiModelInfo>,
    onSelectModel: (AiModelInfo) -> Unit,
    attachments: List<ChatAttachment>,
    onRemoveAttachment: (ChatAttachment) -> Unit,
    onAddAttachment: () -> Unit,
    onSend: () -> Unit,
    isStreaming: Boolean,
    modifier: Modifier = Modifier
) {
    var modelMenuExpanded by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Attachment chips
        if (attachments.isNotEmpty()) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                attachments.forEach { att ->
                    InputChip(
                        selected = true,
                        onClick = { onRemoveAttachment(att) },
                        label = { Text(att.name, maxLines = 1) },
                        trailingIcon = { WorldsGlyph(R.drawable.ic_trash_2, modifier = Modifier.size(16.dp)) }
                    )
                }
            }
        }

        // Text area
        OutlinedTextField(
            value = text,
            onValueChange = onTextChange,
            placeholder = { Text("Ask Worlds Assistant or prompt...") },
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp, max = 140.dp),
            shape = RoundedCornerShape(14.dp)
        )

        // Actions row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                // Model picker
                Box {
                    AssistChip(
                        onClick = { modelMenuExpanded = true },
                        label = { Text(selectedModel.name, style = MaterialTheme.typography.labelMedium) },
                        leadingIcon = { WorldsGlyph(R.drawable.ic_lightbulb, modifier = Modifier.size(16.dp)) }
                    )
                    DropdownMenu(
                        expanded = modelMenuExpanded,
                        onDismissRequest = { modelMenuExpanded = false }
                    ) {
                        models.forEach { m ->
                            DropdownMenuItem(
                                text = {
                                    Column {
                                        Text(m.name, style = MaterialTheme.typography.bodyMedium)
                                        Text(m.provider, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                },
                                onClick = {
                                    onSelectModel(m)
                                    modelMenuExpanded = false
                                }
                            )
                        }
                    }
                }

                // Add context button
                IconButton(onClick = onAddAttachment) {
                    WorldsGlyph(R.drawable.ic_link)
                }
            }

            // Send button
            IconButton(
                onClick = onSend,
                enabled = (text.isNotBlank() || attachments.isNotEmpty()) && !isStreaming,
                modifier = Modifier
                    .background(
                        if ((text.isNotBlank() || attachments.isNotEmpty()) && !isStreaming) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                        CircleShape
                    )
                    .size(44.dp)
            ) {
                WorldsGlyph(
                    R.drawable.ic_send_horizontal,
                    tint = if ((text.isNotBlank() || attachments.isNotEmpty()) && !isStreaming) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
