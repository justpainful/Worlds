package worlds.android.automations

import worlds.android.Switch
import worlds.android.WorldsTile
import worlds.android.WorldsBackButton
import worlds.android.AlertDialog
import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import worlds.android.R
import worlds.android.WorldsActionLabel
import worlds.android.WorldsGlyph
import worlds.content.*
import java.text.DateFormat
import java.util.Date

@Composable
fun AutomationsScreen(
    databaseName: String = "worlds-content.db",
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val store = remember { ContentStore(context, databaseName) }
    val scope = rememberCoroutineScope()

    var automations by remember { mutableStateOf<List<Automation>>(emptyList()) }
    var pages by remember { mutableStateOf<List<Resource>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf(false) }

    var editingAutomation by remember { mutableStateOf<Automation?>(null) }
    var showEditor by remember { mutableStateOf(false) }
    var historyAutomationId by remember { mutableStateOf<String?>(null) }
    var historyRuns by remember { mutableStateOf<List<AutomationRun>>(emptyList()) }

    fun refresh() {
        loading = true
        scope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    val autos = store.listAutomations()
                    val allPages = store.list()
                    autos to allPages
                }
            }
            if (result.isSuccess) {
                val (autos, allPages) = result.getOrThrow()
                automations = autos
                pages = allPages
                loading = false
                error = false
            } else {
                loading = false
                error = true
            }
        }
    }

    LaunchedEffect(Unit) {
        refresh()
        // Ensure periodic worker is registered with WorkManager
        AutomationWorker.schedulePeriodic(context, databaseName)
    }

    BackHandler(onBack = onBack)

    if (showEditor) {
        AutomationEditor(
            automation = editingAutomation,
            pages = pages,
            onSave = { auto ->
                scope.launch {
                    withContext(Dispatchers.IO) {
                        store.saveAutomation(auto)
                    }
                    showEditor = false
                    editingAutomation = null
                    refresh()
                }
            },
            onDismiss = {
                showEditor = false
                editingAutomation = null
            }
        )
    }

    if (historyAutomationId != null) {
        AlertDialog(
            onDismissRequest = { historyAutomationId = null },
            title = { WorldsActionLabel(R.drawable.ic_history, "Execution history") },
            text = {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    if (historyRuns.isEmpty()) {
                        Text("No runs recorded yet for this automation.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        historyRuns.forEach { run ->
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(run.startedAt ?: run.scheduledFor ?: 0L)),
                                            style = MaterialTheme.typography.bodySmall,
                                            fontWeight = FontWeight.Medium
                                        )
                                        RunStatusChip(run.status)
                                    }
                                    val output = run.output
                                    if (!output.isNullOrBlank()) {
                                        Text(output, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface)
                                    }
                                    val err = run.error
                                    if (!err.isNullOrBlank()) {
                                        Text(err, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                                    }
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { historyAutomationId = null }) {
                    Text(stringResource(R.string.close))
                }
            }
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(horizontal = 24.dp, vertical = 20.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            WorldsBackButton(onBack)
            Button(
                onClick = {
                    editingAutomation = null
                    showEditor = true
                }
            ) {
                WorldsActionLabel(R.drawable.ic_plus, "New automation")
            }
        }

        Spacer(Modifier.height(16.dp))

        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            WorldsTile(R.drawable.pi_automations, 44.dp)
            Text(
                "Automations",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground,
                fontWeight = FontWeight.SemiBold
            )
        }

        Text(
            "Scheduled triggers, AI transforms, and Discord webhooks.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(Modifier.height(20.dp))

        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            error -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text("Failed to load automations", color = MaterialTheme.colorScheme.error)
                Spacer(Modifier.height(8.dp))
                Button(onClick = ::refresh) { Text("Retry") }
            }
            automations.isEmpty() -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(56.dp)) {
                        Box(contentAlignment = Alignment.Center) { WorldsGlyph(R.drawable.ic_sliders_horizontal) }
                    }
                    Text("No automations configured", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground)
                    Text("Create an automation to schedule periodic updates or actions.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            else -> LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(automations, key = { it.id }) { auto ->
                    AutomationCard(
                        automation = auto,
                        onToggle = { enabled ->
                            scope.launch {
                                withContext(Dispatchers.IO) {
                                    store.toggleAutomation(auto.id, enabled)
                                }
                                refresh()
                            }
                        },
                        onRunNow = {
                            AutomationWorker.runNow(context, auto.id, databaseName)
                            scope.launch {
                                kotlinx.coroutines.delay(1000)
                                refresh()
                            }
                        },
                        onEdit = {
                            editingAutomation = auto
                            showEditor = true
                        },
                        onHistory = {
                            scope.launch {
                                val runs = withContext(Dispatchers.IO) {
                                    store.listAutomationRuns(auto.id)
                                }
                                historyRuns = runs
                                historyAutomationId = auto.id
                            }
                        },
                        onDelete = {
                            scope.launch {
                                withContext(Dispatchers.IO) {
                                    store.deleteAutomation(auto.id)
                                }
                                refresh()
                            }
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun AutomationCard(
    automation: Automation,
    onToggle: (Boolean) -> Unit,
    onRunNow: () -> Unit,
    onEdit: () -> Unit,
    onHistory: () -> Unit,
    onDelete: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        automation.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    val triggerDesc = when (val t = automation.spec.trigger) {
                        is Trigger.Once -> "Once at ${DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(t.at))}"
                        is Trigger.Daily -> "Daily at ${t.time}"
                        is Trigger.Weekly -> "Weekly at ${t.time}"
                        is Trigger.Monthly -> "Monthly on day ${t.day} at ${t.time}"
                        is Trigger.Manual -> "Manual execution"
                    }
                    Text(triggerDesc, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = automation.enabled, onCheckedChange = onToggle)
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                val lastStatus = automation.lastStatus
                if (lastStatus != null) {
                    RunStatusChip(lastStatus)
                }
                val nextRunAt = automation.nextRunAt
                if (nextRunAt != null && automation.enabled) {
                    Text(
                        "Next: ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(nextRunAt))}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                if (automation.spec.transformKind == "claude") {
                    Surface(shape = RoundedCornerShape(6.dp), color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)) {
                        Text("Claude AI", modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = onRunNow) {
                        WorldsActionLabel(R.drawable.ic_send_horizontal, "Run now")
                    }
                    TextButton(onClick = onHistory) {
                        WorldsActionLabel(R.drawable.ic_history, "History")
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    IconButton(onClick = onEdit) {
                        WorldsGlyph(R.drawable.ic_pencil)
                    }
                    IconButton(onClick = onDelete) {
                        WorldsGlyph(R.drawable.ic_trash_2, tint = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
}

@Composable
private fun RunStatusChip(status: String) {
    val (bgColor, textColor, label) = when (status) {
        "success" -> Triple(Color(0xFF2E7D32).copy(alpha = 0.15f), Color(0xFF2E7D32), "Success")
        "failed" -> Triple(MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.error, "Failed")
        "skipped" -> Triple(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant, "Skipped")
        else -> Triple(MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.primary, "Pending")
    }
    Surface(shape = RoundedCornerShape(6.dp), color = bgColor) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Medium,
            color = textColor
        )
    }
}
