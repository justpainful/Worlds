package worlds.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import worlds.content.ProjectEditing
import worlds.content.ProjectInfo
import worlds.content.Resource
import java.text.DateFormat
import java.util.Date

private fun projectKindLabel(kind: String): Int = when (kind) {
    "document" -> R.string.project_kind_document
    "drawing" -> R.string.project_kind_drawing
    "project" -> R.string.project_kind_project
    "gallery" -> R.string.gallery_kind
    "presentation" -> R.string.presentation_kind
    "file" -> R.string.file_kind
    "stream" -> R.string.stream_kind
    "page" -> R.string.project_kind_page
    else -> R.string.project_kind_other
}
private fun projectStatusLabel(status: String): Int = when (status) {
    "planned" -> R.string.project_status_planned
    "paused" -> R.string.project_status_paused
    "done" -> R.string.project_status_done
    else -> R.string.project_status_active
}

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun ProjectScreen(project: Resource, children: List<Resource>, resources: List<Resource>, activity: List<ProjectActivity>, busy: Boolean,
    onBack: () -> Unit, onOpen: (String) -> Unit, onRename: () -> Unit, onTrash: () -> Unit,
    onCreateChild: (Resource, String, String, (Boolean) -> Unit) -> Unit,
    onUpdate: (Resource, String, String?, String?, String, (Boolean) -> Unit) -> Unit,
    onLinkChange: (Resource, String, Boolean, (Boolean) -> Unit) -> Unit, onImportFile: (Resource) -> Unit, onAddStream: (Resource) -> Unit, modifier: Modifier = Modifier) {
    val info = remember(project.metadata) { runCatching { ProjectEditing.read(project.metadata) }.getOrNull() }
    val byId = remember(resources) { resources.associateBy { it.id } }
    val links = info?.links.orEmpty().mapNotNull(byId::get).filter { it.deletedAt == null }
    val missing = info?.links.orEmpty().size - links.size
    var editTarget by remember(project.id) { mutableStateOf<Resource?>(null) }
    var createTarget by remember(project.id) { mutableStateOf<Resource?>(null) }
    var linkTarget by remember(project.id) { mutableStateOf<Resource?>(null) }
    var unlinkTarget by remember(project.id) { mutableStateOf<Pair<Resource, Resource>?>(null) }
    var trashConfirm by remember(project.id) { mutableStateOf(false) }
    var actionError by remember(project.id) { mutableStateOf(false) }

    editTarget?.let { target -> ProjectDetailsDialog(target, busy, { editTarget = null }, onUpdate) }
    createTarget?.let { target -> ProjectCreateDialog(target, busy, { createTarget = null }, onCreateChild) }
    linkTarget?.let { target -> ProjectLinkDialog(target, children, resources, busy, { linkTarget = null }, onLinkChange) }
    unlinkTarget?.let { (snapshot, target) ->
        AlertDialog(onDismissRequest = { if (!busy) unlinkTarget = null }, title = { Text(stringResource(R.string.project_unlink)) },
            text = { Text(stringResource(R.string.project_unlink_confirm, target.title.ifBlank { stringResource(R.string.untitled) })) },
            confirmButton = { TextButton(enabled = !busy, onClick = { onLinkChange(snapshot, target.id, false) { success -> unlinkTarget = null; actionError = !success } }) { Text(stringResource(R.string.project_unlink)) } },
            dismissButton = { TextButton(enabled = !busy, onClick = { unlinkTarget = null }) { Text(stringResource(R.string.cancel)) } })
    }
    if (trashConfirm) AlertDialog(onDismissRequest = { trashConfirm = false }, title = { Text(stringResource(R.string.move_to_trash)) },
        text = { Text(stringResource(R.string.project_trash_confirm)) },
        confirmButton = { TextButton(enabled = !busy, onClick = { trashConfirm = false; onTrash() }) { Text(stringResource(R.string.move_to_trash)) } },
        dismissButton = { TextButton(enabled = !busy, onClick = { trashConfirm = false }) { Text(stringResource(R.string.cancel)) } })

    CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface) {
    Box(modifier.fillMaxHeight(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 900.dp).fillMaxSize().padding(horizontal = 28.dp, vertical = 24.dp)) {
            TextButton(onClick = onBack) { WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.back)) }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                WorldsGlyph(R.drawable.ic_folder, tint = MaterialTheme.colorScheme.primary)
                Text(project.title.ifBlank { stringResource(R.string.untitled) }, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                FilledTonalButton(enabled = !busy, onClick = { createTarget = project }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.project_add)) }
                TextButton(enabled = !busy && info != null, onClick = { editTarget = project }) { WorldsActionLabel(R.drawable.ic_pen_line, stringResource(R.string.project_edit)) }
                TextButton(enabled = !busy, onClick = { onImportFile(project) }) { WorldsActionLabel(R.drawable.ic_upload, stringResource(R.string.file_import)) }
                TextButton(enabled = !busy, onClick = { onAddStream(project) }) { WorldsActionLabel(R.drawable.ic_link, stringResource(R.string.stream_add)) }
                var menu by remember { mutableStateOf(false) }
                Box {
                    TextButton(enabled = !busy, onClick = { menu = true }) { WorldsActionLabel(R.drawable.ic_ellipsis_vertical, stringResource(R.string.page_actions)) }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_pen_line) }, text = { Text(stringResource(R.string.rename)) }, onClick = { menu = false; onRename() })
                        DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_trash_2) }, text = { Text(stringResource(R.string.move_to_trash)) }, onClick = { menu = false; trashConfirm = true })
                    }
                }
            }
            if (actionError) Text(stringResource(R.string.project_action_error), color = MaterialTheme.colorScheme.error)
            if (info == null) Text(stringResource(R.string.project_metadata_error), color = MaterialTheme.colorScheme.error)
            LazyColumn(Modifier.weight(1f).testTag("project-resources"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (info != null) item(key = "overview") {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(Modifier.height(12.dp))
                    Text(stringResource(projectStatusLabel(info.status)), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.titleSmall)
                    info.start?.let { Text(stringResource(R.string.project_start_value, it), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    info.due?.let { Text(stringResource(R.string.project_due_value, it), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    if (info.description.isNotBlank()) Text(info.description, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp))
                }
                item(key = "children-heading") {
                    Spacer(Modifier.height(12.dp)); Text(stringResource(R.string.project_inside), style = MaterialTheme.typography.titleSmall)
                    if (children.isEmpty()) Text(stringResource(R.string.project_empty), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
                itemsIndexed(children, key = { _, child -> "child-${child.id}" }) { _, child ->
                    ProjectResourceRow(child, busy, { onOpen(child.id) })
                }
                item(key = "links-heading") {
                    Spacer(Modifier.height(12.dp)); HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(stringResource(R.string.project_linked), style = MaterialTheme.typography.titleSmall)
                        TextButton(enabled = !busy && info != null, onClick = { linkTarget = project }) { WorldsActionLabel(R.drawable.ic_link, stringResource(R.string.project_link_existing)) }
                    }
                    if (links.isEmpty()) Text(stringResource(R.string.project_link_hint), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    if (missing > 0) Text(stringResource(R.string.project_missing_links, missing), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
                itemsIndexed(links, key = { index, item -> "linked-$index-${item.id}" }) { _, item ->
                    ProjectResourceRow(item, busy, { onOpen(item.id) }, { unlinkTarget = project to item })
                }
                if (activity.isNotEmpty()) {
                    item(key = "activity-heading") { Spacer(Modifier.height(12.dp)); HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant); Text(stringResource(R.string.project_activity), style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 12.dp)) }
                    itemsIndexed(activity, key = { _, entry -> "event-${entry.event.id}" }) { _, entry ->
                        val eventLabel = when (entry.event.kind) {
                            "created" -> R.string.project_event_created
                            "renamed" -> R.string.project_event_renamed
                            "moved" -> R.string.project_event_moved
                            "trashed" -> R.string.project_event_trashed
                            "restored" -> R.string.project_event_restored
                            "version_restored" -> R.string.project_event_version_restored
                            else -> R.string.project_event_updated
                        }
                        Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            Text(entry.resource.title.ifBlank { stringResource(R.string.untitled) }, style = MaterialTheme.typography.bodyMedium)
                            Text(stringResource(eventLabel), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                            Text(DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(entry.event.createdAt)), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }
    }
    }
}

@Composable private fun ProjectResourceRow(item: Resource, busy: Boolean, open: () -> Unit, unlink: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TextButton(enabled = !busy && item.kind in ProjectEditing.childKinds, onClick = open, modifier = Modifier.weight(1f), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                WorldsGlyph(when (item.kind) { "project" -> R.drawable.ic_folder; "drawing" -> R.drawable.ic_pen_line; "gallery" -> R.drawable.ic_image; "presentation" -> R.drawable.ic_maximize; else -> R.drawable.ic_file_text })
                Column(Modifier.weight(1f)) {
                    Text(item.title.ifBlank { stringResource(R.string.untitled) }, maxLines = 2, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurface)
                    Text(stringResource(projectKindLabel(item.kind)), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (unlink != null) TextButton(enabled = !busy, onClick = unlink) { WorldsActionLabel(R.drawable.ic_link, stringResource(R.string.project_unlink)) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun ProjectDetailsDialog(target: Resource, busy: Boolean, dismiss: () -> Unit,
    save: (Resource, String, String?, String?, String, (Boolean) -> Unit) -> Unit) {
    val info = remember(target.metadata) { ProjectEditing.read(target.metadata) }
    var status by rememberSaveable(target.id, target.revision) { mutableStateOf(info.status) }
    var start by rememberSaveable(target.id, target.revision) { mutableStateOf(info.start.orEmpty()) }
    var due by rememberSaveable(target.id, target.revision) { mutableStateOf(info.due.orEmpty()) }
    var description by rememberSaveable(target.id, target.revision) { mutableStateOf(info.description) }
    var error by rememberSaveable(target.id, target.revision) { mutableStateOf(false) }
    val validDates = ProjectEditing.validDate(start.ifBlank { null }) && ProjectEditing.validDate(due.ifBlank { null })
    AlertDialog(onDismissRequest = { if (!busy) dismiss() }, title = { WorldsActionLabel(R.drawable.ic_pen_line, stringResource(R.string.project_edit)) },
        text = { Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState())) {
            Text(stringResource(R.string.project_status), style = MaterialTheme.typography.bodySmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("planned", "active", "paused", "done").forEach { choice -> FilterChip(selected = status == choice, enabled = !busy, onClick = { status = choice }, label = { Text(stringResource(projectStatusLabel(choice))) }) }
            }
            OutlinedTextField(value = start, onValueChange = { if (it.length <= 10) start = it }, enabled = !busy, label = { Text(stringResource(R.string.project_start)) }, placeholder = { Text("YYYY-MM-DD") }, isError = !ProjectEditing.validDate(start.ifBlank { null }), singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = due, onValueChange = { if (it.length <= 10) due = it }, enabled = !busy, label = { Text(stringResource(R.string.project_due)) }, placeholder = { Text("YYYY-MM-DD") }, isError = !ProjectEditing.validDate(due.ifBlank { null }), singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = description, onValueChange = { if (it.length <= 10_000) description = it }, enabled = !busy, label = { Text(stringResource(R.string.project_description)) }, maxLines = 5, modifier = Modifier.fillMaxWidth())
            if (!validDates) Text(stringResource(R.string.project_date_error), color = MaterialTheme.colorScheme.error)
            if (error) Text(stringResource(R.string.project_save_error), color = MaterialTheme.colorScheme.error)
        } }, confirmButton = { TextButton(enabled = !busy && validDates, onClick = { save(target, status, start.ifBlank { null }, due.ifBlank { null }, description) { success -> if (success) dismiss() else error = true } }) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(enabled = !busy, onClick = dismiss) { Text(stringResource(R.string.cancel)) } })
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun ProjectCreateDialog(target: Resource, busy: Boolean, dismiss: () -> Unit, create: (Resource, String, String, (Boolean) -> Unit) -> Unit) {
    var kind by rememberSaveable(target.id, target.revision) { mutableStateOf("page") }
    var title by rememberSaveable(target.id, target.revision) { mutableStateOf("") }
    var error by rememberSaveable(target.id, target.revision) { mutableStateOf(false) }
    AlertDialog(onDismissRequest = { if (!busy) dismiss() }, title = { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.project_add)) },
        text = { Column {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("page", "document", "drawing", "project", "gallery", "presentation").forEach { choice -> FilterChip(selected = kind == choice, enabled = !busy, onClick = { kind = choice }, label = { Text(stringResource(projectKindLabel(choice))) }) }
            }
            OutlinedTextField(value = title, onValueChange = { if (it.length <= 512) title = it }, enabled = !busy, label = { Text(stringResource(R.string.project_item_title)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            if (error) Text(stringResource(R.string.project_save_error), color = MaterialTheme.colorScheme.error)
        } }, confirmButton = { TextButton(enabled = !busy, onClick = { create(target, kind, title) { success -> if (success) dismiss() else error = true } }) { Text(stringResource(R.string.create)) } },
        dismissButton = { TextButton(enabled = !busy, onClick = dismiss) { Text(stringResource(R.string.cancel)) } })
}

@Composable private fun ProjectLinkDialog(target: Resource, children: List<Resource>, resources: List<Resource>, busy: Boolean, dismiss: () -> Unit,
    change: (Resource, String, Boolean, (Boolean) -> Unit) -> Unit) {
    val info = remember(target.metadata) { ProjectEditing.read(target.metadata) }
    var query by rememberSaveable(target.id, target.revision) { mutableStateOf("") }
    var error by rememberSaveable(target.id, target.revision) { mutableStateOf(false) }
    val excluded = remember(target.id, children, info.links) { (children.map { it.id } + info.links + target.id).toSet() }
    val candidates = remember(resources, excluded, query) { resources.filter { it.id !in excluded && it.kind in ProjectEditing.childKinds && it.title.contains(query.trim(), ignoreCase = true) }.sortedByDescending { it.updatedAt } }
    AlertDialog(onDismissRequest = { if (!busy) dismiss() }, title = { WorldsActionLabel(R.drawable.ic_link, stringResource(R.string.project_link_existing)) },
        text = { Column {
            Text(stringResource(R.string.project_link_hint), style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(value = query, onValueChange = { query = it }, enabled = !busy, label = { Text(stringResource(R.string.search)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            if (error) Text(stringResource(R.string.project_save_error), color = MaterialTheme.colorScheme.error)
            if (candidates.isEmpty()) Text(stringResource(R.string.no_results), color = MaterialTheme.colorScheme.onSurfaceVariant)
            else Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
                candidates.forEach { item -> ProjectResourceRow(item, busy, { change(target, item.id, true) { success -> if (success) dismiss() else error = true } }) }
            }
        } }, confirmButton = { TextButton(enabled = !busy, onClick = dismiss) { Text(stringResource(R.string.cancel)) } })
}
