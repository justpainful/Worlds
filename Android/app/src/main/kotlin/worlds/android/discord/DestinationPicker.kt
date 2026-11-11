package worlds.android.discord

import worlds.android.DropdownMenu
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import worlds.android.R
import worlds.android.WorldsActionLabel
import worlds.android.WorldsGlyph

@Composable
fun DestinationPicker(
    webhookUrl: String,
    onWebhookUrlChange: (String) -> Unit,
    destinations: List<DiscordDestination>,
    onSelectDestination: (DiscordDestination) -> Unit,
    modifier: Modifier = Modifier
) {
    var expandedPresets by remember { mutableStateOf(false) }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Destination", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onBackground)

        if (destinations.isNotEmpty()) {
            Box {
                OutlinedButton(
                    onClick = { expandedPresets = true },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        WorldsActionLabel(R.drawable.ic_server, "Saved Discord Channels")
                        WorldsGlyph(R.drawable.ic_chevron_right)
                    }
                }
                DropdownMenu(
                    expanded = expandedPresets,
                    onDismissRequest = { expandedPresets = false }
                ) {
                    destinations.forEach { dest ->
                        DropdownMenuItem(
                            text = {
                                Column {
                                    Text(dest.name, style = MaterialTheme.typography.bodyMedium)
                                    if (dest.guildName != null) {
                                        Text(dest.guildName, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            },
                            onClick = {
                                onSelectDestination(dest)
                                expandedPresets = false
                            }
                        )
                    }
                }
            }
        }

        OutlinedTextField(
            value = webhookUrl,
            onValueChange = onWebhookUrlChange,
            label = { Text("Webhook URL") },
            placeholder = { Text("https://discord.com/api/webhooks/...") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            isError = webhookUrl.isNotBlank() && !webhookUrl.startsWith("http")
        )
    }
}
