package worlds.android.automations

import worlds.android.AlertDialog
import worlds.android.DropdownMenu
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import worlds.content.*
import java.util.UUID

@Composable
fun AutomationEditor(
    automation: Automation?,
    pages: List<Resource>,
    onSave: (Automation) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(automation?.name.orEmpty()) }
    var triggerKind by remember {
        mutableStateOf(
            when (automation?.spec?.trigger) {
                is Trigger.Once -> "once"
                is Trigger.Daily -> "daily"
                is Trigger.Weekly -> "weekly"
                is Trigger.Monthly -> "monthly"
                else -> "daily"
            }
        )
    }
    var timeStr by remember {
        mutableStateOf(
            when (val t = automation?.spec?.trigger) {
                is Trigger.Daily -> t.time
                is Trigger.Weekly -> t.time
                is Trigger.Monthly -> t.time
                else -> "09:00"
            }
        )
    }
    var selectedPageId by remember { mutableStateOf(automation?.spec?.sourcePageId ?: pages.firstOrNull()?.id.orEmpty()) }
    var transformKind by remember { mutableStateOf(automation?.spec?.transformKind ?: "none") }
    var transformPrompt by remember { mutableStateOf(automation?.spec?.transformInstructions ?: "Summarize this page for Discord:") }
    var webhookUrl by remember { mutableStateOf(automation?.spec?.destinationWebhook.orEmpty()) }
    var unattended by remember { mutableStateOf(automation?.spec?.policy?.unattended ?: false) }
    var graceMinutesStr by remember { mutableStateOf((automation?.spec?.policy?.graceMinutes ?: 60L).toString()) }

    var expandedPages by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            WorldsActionLabel(
                R.drawable.ic_sliders_horizontal,
                if (automation == null) "New automation" else "Edit automation"
            )
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 480.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Automation name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                )

                Text("Trigger", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onBackground)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("daily" to "Daily", "weekly" to "Weekly", "manual" to "Manual").forEach { (kind, label) ->
                        FilterChip(
                            selected = triggerKind == kind,
                            onClick = { triggerKind = kind },
                            label = { Text(label) }
                        )
                    }
                }

                if (triggerKind in setOf("daily", "weekly", "monthly")) {
                    OutlinedTextField(
                        value = timeStr,
                        onValueChange = { timeStr = it },
                        label = { Text("Execution time (HH:MM)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    )
                }

                Text("Source page", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onBackground)
                Box {
                    val selectedPage = pages.firstOrNull { it.id == selectedPageId }
                    OutlinedButton(
                        onClick = { expandedPages = true },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text(selectedPage?.title?.ifBlank { "Untitled" } ?: "Select page", maxLines = 1)
                            WorldsGlyph(R.drawable.ic_chevron_right)
                        }
                    }
                    DropdownMenu(expanded = expandedPages, onDismissRequest = { expandedPages = false }) {
                        pages.forEach { p ->
                            DropdownMenuItem(
                                text = { Text(p.title.ifBlank { "Untitled" }) },
                                onClick = {
                                    selectedPageId = p.id
                                    expandedPages = false
                                }
                            )
                        }
                    }
                }

                Text("Transform", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onBackground)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = transformKind == "none",
                        onClick = { transformKind = "none" },
                        label = { Text("None (Raw)") }
                    )
                    FilterChip(
                        selected = transformKind == "claude",
                        onClick = { transformKind = "claude" },
                        label = { Text("Claude AI") }
                    )
                }

                if (transformKind == "claude") {
                    OutlinedTextField(
                        value = transformPrompt,
                        onValueChange = { transformPrompt = it },
                        label = { Text("AI prompt / instructions") },
                        modifier = Modifier.fillMaxWidth(),
                        maxLines = 3,
                        shape = RoundedCornerShape(12.dp)
                    )
                }

                Text("Destination", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onBackground)
                OutlinedTextField(
                    value = webhookUrl,
                    onValueChange = { webhookUrl = it },
                    label = { Text("Discord webhook URL") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Unattended execution", style = MaterialTheme.typography.bodyMedium)
                        Text("Run automatically without manual approval", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = unattended, onCheckedChange = { unattended = it })
                }
            }
        },
        confirmButton = {
            Button(
                enabled = name.isNotBlank() && selectedPageId.isNotBlank(),
                onClick = {
                    val trigger = when (triggerKind) {
                        "daily" -> Trigger.Daily(timeStr)
                        "weekly" -> Trigger.Weekly(listOf(1), timeStr)
                        "monthly" -> Trigger.Monthly(1, timeStr)
                        else -> Trigger.Manual
                    }
                    val now = System.currentTimeMillis()
                    val next = Automations.nextRun(trigger, now)
                    val spec = AutomationSpec(
                        trigger = trigger,
                        sourcePageId = selectedPageId,
                        transformKind = transformKind,
                        transformInstructions = if (transformKind == "claude") transformPrompt else null,
                        actionKind = "discord.send",
                        destinationWebhook = webhookUrl.ifBlank { null },
                        policy = AutomationPolicy(
                            unattended = unattended,
                            graceMinutes = graceMinutesStr.toLongOrNull() ?: 60L
                        )
                    )
                    val auto = automation?.copy(
                        name = name.trim(),
                        spec = spec,
                        nextRunAt = next,
                        updatedAt = now
                    ) ?: Automation(
                        id = UUID.randomUUID().toString(),
                        name = name.trim(),
                        enabled = true,
                        spec = spec,
                        nextRunAt = next,
                        lastRunAt = null,
                        createdAt = now,
                        updatedAt = now,
                        lastStatus = null
                    )
                    onSave(auto)
                }
            ) {
                Text(stringResource(R.string.save))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.cancel))
            }
        }
    )
}
