package worlds.android.automations

import worlds.android.Switch
import worlds.android.OutlinedTextField
import worlds.android.AlertDialog
import worlds.android.DropdownMenu
import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import worlds.android.R
import worlds.android.WorldsActionLabel
import worlds.android.WorldsGlyph
import worlds.content.*
import java.util.UUID

/** True when Android will show this app's notifications: the Android 13 permission, and notifications not turned off. */
internal fun notificationsAllowed(context: Context): Boolean {
    val granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    val manager = context.getSystemService(NotificationManager::class.java)
    return granted && (manager?.areNotificationsEnabled() ?: true)
}

@OptIn(ExperimentalLayoutApi::class)
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
    var transformKind by remember { mutableStateOf(automation?.spec?.transformKind ?: AutomationSteps.TRANSFORM_NONE) }
    val defaultInstructions = stringResource(R.string.automation_ai_default_instructions)
    var transformPrompt by remember { mutableStateOf(automation?.spec?.transformInstructions ?: defaultInstructions) }
    var actionKind by remember { mutableStateOf(automation?.spec?.actionKind ?: AutomationSteps.ACTION_DISCORD) }
    var webhookUrl by remember { mutableStateOf(automation?.spec?.destinationWebhook.orEmpty()) }

    val context = LocalContext.current
    var canNotify by remember { mutableStateOf(notificationsAllowed(context)) }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        canNotify = notificationsAllowed(context)
    }
    // Back from Android settings, read the state again.
    LifecycleResumeEffect(Unit) {
        canNotify = notificationsAllowed(context)
        onPauseOrDispose { }
    }
    fun chooseNotification() {
        actionKind = AutomationSteps.ACTION_NOTIFICATION
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
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

                Text(stringResource(R.string.automation_transform), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onBackground)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = transformKind == AutomationSteps.TRANSFORM_NONE,
                        onClick = { transformKind = AutomationSteps.TRANSFORM_NONE },
                        label = { Text(stringResource(R.string.automation_transform_none)) }
                    )
                    FilterChip(
                        selected = transformKind == AutomationSteps.TRANSFORM_AI,
                        onClick = { transformKind = AutomationSteps.TRANSFORM_AI },
                        label = { Text(stringResource(R.string.automation_transform_ai)) }
                    )
                }

                if (transformKind == AutomationSteps.TRANSFORM_AI) {
                    OutlinedTextField(
                        value = transformPrompt,
                        onValueChange = { transformPrompt = it },
                        label = { Text(stringResource(R.string.automation_ai_instructions)) },
                        modifier = Modifier.fillMaxWidth(),
                        maxLines = 3,
                        shape = RoundedCornerShape(12.dp)
                    )
                    Text(
                        stringResource(R.string.automation_ai_uses_settings),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Text(stringResource(R.string.automation_action), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onBackground)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = actionKind == AutomationSteps.ACTION_DISCORD,
                        onClick = { actionKind = AutomationSteps.ACTION_DISCORD },
                        label = { Text(stringResource(R.string.automation_action_discord)) }
                    )
                    FilterChip(
                        selected = actionKind == AutomationSteps.ACTION_NOTIFICATION,
                        onClick = { chooseNotification() },
                        label = { Text(stringResource(R.string.automation_action_notification)) }
                    )
                }

                if (actionKind == AutomationSteps.ACTION_DISCORD) {
                    OutlinedTextField(
                        value = webhookUrl,
                        onValueChange = { webhookUrl = it },
                        label = { Text(stringResource(R.string.automation_webhook_url)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    )
                }

                if (actionKind == AutomationSteps.ACTION_NOTIFICATION && !canNotify) {
                    Text(
                        stringResource(R.string.automation_notifications_off),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                    OutlinedButton(
                        onClick = {
                            val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            runCatching { context.startActivity(intent) }
                        },
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        WorldsActionLabel(R.drawable.ic_bell, stringResource(R.string.automation_open_notification_settings))
                    }
                }

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
                // Discord needs a webhook here, unless desktop set a bot channel for this automation.
                enabled = name.isNotBlank() && selectedPageId.isNotBlank() &&
                    (actionKind != AutomationSteps.ACTION_DISCORD || webhookUrl.isNotBlank() || automation?.spec?.destinationChannel != null),
                onClick = {
                    val trigger = when (triggerKind) {
                        "daily" -> Trigger.Daily(timeStr)
                        "weekly" -> Trigger.Weekly(listOf(1), timeStr)
                        "monthly" -> Trigger.Monthly(1, timeStr)
                        else -> Trigger.Manual
                    }
                    val now = System.currentTimeMillis()
                    val next = Automations.nextRun(trigger, now)
                    // Start from the saved spec so fields this editor does not show (set on desktop) are kept.
                    val spec = (automation?.spec ?: AutomationSpec(trigger = trigger, sourcePageId = selectedPageId)).copy(
                        trigger = trigger,
                        sourcePageId = selectedPageId,
                        transformKind = transformKind,
                        transformInstructions = if (transformKind == AutomationSteps.TRANSFORM_AI) transformPrompt.trim().ifBlank { defaultInstructions } else null,
                        actionKind = actionKind,
                        destinationWebhook = webhookUrl.trim().ifBlank { null },
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
