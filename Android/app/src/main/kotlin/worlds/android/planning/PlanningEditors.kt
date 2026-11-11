package worlds.android.planning

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import worlds.android.AlertDialog
import worlds.android.OutlinedTextField
import worlds.android.R
import worlds.android.Switch
import worlds.android.WorldsActionLabel
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.TextStyle

/* Editors for planning items, after the desktop's detail views (src/planning/ItemViews.tsx and src/study). */

@Composable private fun EditorDialog(title: String, onDismiss: () -> Unit, onSave: () -> Unit, saveEnabled: Boolean = true, onDelete: (() -> Unit)? = null, deleteLabel: String? = null, content: @Composable ColumnScope.() -> Unit) {
    AlertDialog(onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                content()
                if (onDelete != null) TextButton(onClick = onDelete, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                    WorldsActionLabel(R.drawable.ic_trash_2, deleteLabel ?: stringResource(R.string.plan_delete))
                }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
        confirmButton = { TextButton(onClick = onSave, enabled = saveEnabled) { Text(stringResource(R.string.save)) } })
}

@Composable private fun PlanTextField(value: String, onChange: (String) -> Unit, label: String, isError: Boolean = false, number: Boolean = false, multiline: Boolean = false, placeholder: String? = null) {
    OutlinedTextField(value = value, onValueChange = onChange, modifier = Modifier.fillMaxWidth(), label = { Text(label) }, singleLine = !multiline, minLines = if (multiline) 3 else 1, isError = isError,
        placeholder = { if (placeholder != null) Text(placeholder, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        keyboardOptions = KeyboardOptions(keyboardType = if (number) KeyboardType.Decimal else KeyboardType.Text))
}

@Composable private fun FieldLabel(text: String, value: String? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurface)
        if (value != null) Text(value, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A small capsule choice inside an editor. */
@Composable private fun Choice(label: String, selected: Boolean, onClick: () -> Unit) {
    Text(label, modifier = Modifier.clip(CircleShape).background(if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHighest)
        .toggleable(value = selected, role = Role.RadioButton, onValueChange = { onClick() }).padding(horizontal = 12.dp, vertical = 8.dp),
        style = MaterialTheme.typography.labelLarge, color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface, maxLines = 1)
}

@Composable private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().toggleable(value = checked, role = Role.Switch, onValueChange = onChange).heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Switch(checked = checked, onCheckedChange = null)
    }
}

/** The desktop's calendar picker, in a dialog. Dates are local days, so the picker's UTC midnight is read as a plain day. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun PlanDatePicker(initial: String?, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = (initial ?: PlanDates.today()).let { PlanDates.parse(it).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() })
    val colors = DatePickerDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh)
    DatePickerDialog(onDismissRequest = onDismiss, colors = colors, shape = MaterialTheme.shapes.extraLarge,
        confirmButton = {
            TextButton(enabled = state.selectedDateMillis != null, onClick = {
                state.selectedDateMillis?.let { onPick(PlanDates.format(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate())) }
            }) { Text(stringResource(R.string.plan_choose)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } }) {
        DatePicker(state = state, colors = colors, showModeToggle = false)
    }
}

/**
 * A date with the quick choices from the desktop's item menu: no date, today,
 * tomorrow, next week and, for tasks, someday; or any day from the picker.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable private fun DateField(label: String, value: String?, now: String, allowNone: Boolean, onChange: (String?) -> Unit, someday: Boolean? = null, onSomeday: (() -> Unit)? = null) {
    var picking by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FieldLabel(label, when {
            someday == true -> stringResource(R.string.plan_someday)
            value != null && PlanDates.isIso(value) -> dayName(value, now)
            else -> stringResource(R.string.plan_no_date)
        })
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (allowNone) Choice(stringResource(R.string.plan_no_date), value == null && someday != true) { onChange(null) }
            Choice(stringResource(R.string.plan_today), value == now && someday != true) { onChange(now) }
            Choice(stringResource(R.string.plan_tomorrow), value == PlanDates.addDays(now, 1) && someday != true) { onChange(PlanDates.addDays(now, 1)) }
            Choice(stringResource(R.string.plan_next_week), value == PlanDates.addDays(now, 7) && someday != true) { onChange(PlanDates.addDays(now, 7)) }
            if (onSomeday != null) Choice(stringResource(R.string.plan_someday), someday == true, onSomeday)
            Choice(stringResource(R.string.plan_choose_date), false) { picking = true }
        }
    }
    if (picking) PlanDatePicker(value, onDismiss = { picking = false }) { picking = false; onChange(it) }
}

/** Numbers typed into a field: whole numbers are stored as whole numbers. */
private fun numberOf(text: String): Any? {
    val v = text.trim().replace(',', '.').toDoubleOrNull() ?: return null
    return if (v == Math.floor(v) && !v.isInfinite() && kotlin.math.abs(v) < 1e15) v.toLong() else v
}

private fun numberText(v: Double?): String = when {
    v == null -> ""
    v == Math.floor(v) && !v.isInfinite() -> v.toLong().toString()
    else -> v.toString()
}

private fun numberValid(text: String) = text.isBlank() || numberOf(text) != null
private fun clockValid(text: String) = text.isBlank() || QuickAdd.clock(text) != null
private fun clockOf(text: String): String? = if (text.isBlank()) null else QuickAdd.clock(text)

/** Edit a task's title, date, time and priority, or move it to Trash. */
@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun TaskEditor(row: PlanRow, now: String, repo: PlanningRepository, onClose: () -> Unit) {
    val d = row.task
    var title by rememberSaveable(row.id) { mutableStateOf(row.title) }
    var due by rememberSaveable(row.id) { mutableStateOf(d.due) }
    var someday by rememberSaveable(row.id) { mutableStateOf(d.someday) }
    var time by rememberSaveable(row.id) { mutableStateOf(d.time.orEmpty()) }
    var priority by rememberSaveable(row.id) { mutableIntStateOf(d.priority) }
    EditorDialog(stringResource(R.string.plan_edit_task), onDismiss = onClose, saveEnabled = clockValid(time),
        onSave = {
            repo.rename(row.id, title)
            repo.update(row.id, "task", mapOf("due" to due, "someday" to someday, "time" to clockOf(time), "priority" to priority))
            onClose()
        },
        onDelete = { repo.trash(row.id); onClose() }) {
        PlanTextField(title, { title = it }, stringResource(R.string.plan_field_title))
        DateField(stringResource(R.string.plan_field_due), due, now, allowNone = true, onChange = { due = it; someday = false }, someday = someday, onSomeday = { due = null; someday = true })
        if (due != null) PlanTextField(time, { time = it }, stringResource(R.string.plan_field_time), isError = !clockValid(time), placeholder = stringResource(R.string.plan_time_hint))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FieldLabel(stringResource(R.string.plan_field_priority))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(0, 1, 2, 3).forEach { n -> Choice(priorityName(n), priority == n) { priority = n } }
            }
        }
    }
}

/** Days of the week as small toggles, Sunday first like the desktop. */
@Composable private fun WeekdayToggles(selected: List<Int>, onChange: (List<Int>) -> Unit) {
    val locale = currentLocale()
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        (0..6).forEach { day ->
            val on = day in selected
            val full = weekdayName(day, TextStyle.FULL, locale)
            Box(Modifier.weight(1f).height(38.dp).clip(CircleShape).background(if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHighest)
                .toggleable(value = on, role = Role.Checkbox, onValueChange = { onChange(if (on) selected - day else (selected + day).sorted()) })
                .semantics { contentDescription = full }, contentAlignment = Alignment.Center) {
                Text(weekdayName(day, TextStyle.NARROW, locale), style = MaterialTheme.typography.labelLarge, color = if (on) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}

/** Create or edit an event: its day, times, place and the weekdays it repeats on. */
@Composable internal fun EventEditor(row: PlanRow?, initialDate: String, now: String, repo: PlanningRepository, onClose: () -> Unit) {
    val d = row?.event
    val key = row?.id ?: "new-event"
    var title by rememberSaveable(key) { mutableStateOf(row?.title.orEmpty()) }
    var date by rememberSaveable(key) { mutableStateOf(d?.date?.takeIf { PlanDates.isIso(it) } ?: initialDate) }
    var allDay by rememberSaveable(key) { mutableStateOf(d?.allDay ?: false) }
    var start by rememberSaveable(key) { mutableStateOf(if (row == null) "09:00" else d?.start.orEmpty()) }
    var end by rememberSaveable(key) { mutableStateOf(if (row == null) "10:00" else d?.end.orEmpty()) }
    var location by rememberSaveable(key) { mutableStateOf(d?.location.orEmpty()) }
    // Kept as text so it survives rotation in a Bundle.
    var weeklyText by rememberSaveable(key) { mutableStateOf(d?.weekly.orEmpty().joinToString(",")) }
    val weekly = weeklyText.split(",").mapNotNull { it.toIntOrNull() }
    val valid = clockValid(start) && clockValid(end)
    EditorDialog(stringResource(if (row == null) R.string.plan_new_event else R.string.plan_edit_event), onDismiss = onClose, saveEnabled = valid,
        onSave = {
            val startTime = clockOf(start)
            val fields = linkedMapOf<String, Any?>("date" to date, "start" to startTime, "end" to clockOf(end), "allDay" to (allDay || startTime == null))
            if (location.isNotBlank() || !d?.location.isNullOrEmpty()) fields["location"] = location.trim()
            if (weekly.isNotEmpty() || (d?.weekly?.isNotEmpty() == true)) fields["weekly"] = weekly
            if (row == null) repo.create("event", title, null, fields)
            else { repo.rename(row.id, title); repo.update(row.id, "event", fields) }
            onClose()
        },
        onDelete = row?.let { { repo.trash(it.id); onClose() } }) {
        PlanTextField(title, { title = it }, stringResource(R.string.plan_field_title))
        DateField(stringResource(if (weekly.isNotEmpty()) R.string.plan_field_starts else R.string.plan_field_date), date, now, allowNone = false, onChange = { if (it != null) date = it })
        SwitchRow(stringResource(R.string.plan_all_day), allDay) { allDay = it }
        if (!allDay) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) { PlanTextField(start, { start = it }, stringResource(R.string.plan_field_from), isError = !clockValid(start)) }
            Box(Modifier.weight(1f)) { PlanTextField(end, { end = it }, stringResource(R.string.plan_field_to), isError = !clockValid(end)) }
        }
        PlanTextField(location, { location = it }, stringResource(R.string.plan_field_location))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FieldLabel(stringResource(R.string.plan_field_repeats))
            WeekdayToggles(weekly) { weeklyText = it.joinToString(",") }
        }
    }
}

/** Edit an assignment, an exam or something to bring. */
@Composable internal fun StudyItemEditor(row: PlanRow, now: String, repo: PlanningRepository, onClose: () -> Unit) {
    when (row.kind) {
        "assignment" -> AssignmentEditor(row, now, repo, onClose)
        "exam" -> ExamEditor(row, now, repo, onClose)
        else -> RequirementEditor(row, now, repo, onClose)
    }
}

@Composable private fun AssignmentEditor(row: PlanRow, now: String, repo: PlanningRepository, onClose: () -> Unit) {
    val d = row.assignment
    var title by rememberSaveable(row.id) { mutableStateOf(row.title) }
    var due by rememberSaveable(row.id) { mutableStateOf(d.due) }
    var time by rememberSaveable(row.id) { mutableStateOf(d.time.orEmpty()) }
    var points by rememberSaveable(row.id) { mutableStateOf(numberText(d.points)) }
    var earned by rememberSaveable(row.id) { mutableStateOf(numberText(d.earned)) }
    var submitted by rememberSaveable(row.id) { mutableStateOf(d.submitted) }
    var instructions by rememberSaveable(row.id) { mutableStateOf(d.instructions.orEmpty()) }
    EditorDialog(stringResource(R.string.plan_edit_assignment), onDismiss = onClose, saveEnabled = clockValid(time) && numberValid(points) && numberValid(earned),
        onSave = {
            val fields = linkedMapOf<String, Any?>("due" to due, "time" to clockOf(time), "points" to numberOf(points), "earned" to numberOf(earned))
            if (submitted != d.submitted) { fields["submitted"] = submitted; fields["submittedAt"] = if (submitted) System.currentTimeMillis() else null }
            if (instructions.isNotBlank() || d.instructions != null) fields["instructions"] = instructions
            repo.rename(row.id, title)
            repo.update(row.id, "assignment", fields)
            onClose()
        },
        onDelete = { repo.trash(row.id); onClose() }) {
        PlanTextField(title, { title = it }, stringResource(R.string.plan_field_title))
        DateField(stringResource(R.string.plan_field_due), due, now, allowNone = true, onChange = { due = it })
        if (due != null) PlanTextField(time, { time = it }, stringResource(R.string.plan_field_time), isError = !clockValid(time), placeholder = stringResource(R.string.plan_time_hint))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) { PlanTextField(points, { points = it }, stringResource(R.string.plan_field_out_of), isError = !numberValid(points), number = true) }
            Box(Modifier.weight(1f)) { PlanTextField(earned, { earned = it }, stringResource(R.string.plan_field_grade), isError = !numberValid(earned), number = true) }
        }
        SwitchRow(stringResource(R.string.plan_handed_in), submitted) { submitted = it }
        PlanTextField(instructions, { instructions = it }, stringResource(R.string.plan_field_instructions), multiline = true)
    }
}

@Composable private fun ExamEditor(row: PlanRow, now: String, repo: PlanningRepository, onClose: () -> Unit) {
    val d = row.exam
    var title by rememberSaveable(row.id) { mutableStateOf(row.title) }
    var date by rememberSaveable(row.id) { mutableStateOf(d.date) }
    var time by rememberSaveable(row.id) { mutableStateOf(d.time.orEmpty()) }
    var scope by rememberSaveable(row.id) { mutableStateOf(d.scope.orEmpty()) }
    var maxScore by rememberSaveable(row.id) { mutableStateOf(numberText(d.maxScore)) }
    var score by rememberSaveable(row.id) { mutableStateOf(numberText(d.score)) }
    var location by rememberSaveable(row.id) { mutableStateOf(d.location.orEmpty()) }
    EditorDialog(stringResource(R.string.plan_edit_exam), onDismiss = onClose, saveEnabled = clockValid(time) && numberValid(maxScore) && numberValid(score),
        onSave = {
            val fields = linkedMapOf<String, Any?>("date" to date, "time" to clockOf(time), "maxScore" to numberOf(maxScore), "score" to numberOf(score))
            if (scope.isNotBlank() || d.scope != null) fields["scope"] = scope
            if (location.isNotBlank() || d.location != null) fields["location"] = location
            repo.rename(row.id, title)
            repo.update(row.id, "exam", fields)
            onClose()
        },
        onDelete = { repo.trash(row.id); onClose() }) {
        PlanTextField(title, { title = it }, stringResource(R.string.plan_field_title))
        DateField(stringResource(R.string.plan_field_date), date, now, allowNone = true, onChange = { date = it })
        if (date != null) PlanTextField(time, { time = it }, stringResource(R.string.plan_field_time), isError = !clockValid(time), placeholder = stringResource(R.string.plan_time_hint))
        PlanTextField(scope, { scope = it }, stringResource(R.string.plan_field_scope))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) { PlanTextField(score, { score = it }, stringResource(R.string.plan_field_score), isError = !numberValid(score), number = true) }
            Box(Modifier.weight(1f)) { PlanTextField(maxScore, { maxScore = it }, stringResource(R.string.plan_field_out_of), isError = !numberValid(maxScore), number = true) }
        }
        PlanTextField(location, { location = it }, stringResource(R.string.plan_field_location))
    }
}

@Composable private fun RequirementEditor(row: PlanRow, now: String, repo: PlanningRepository, onClose: () -> Unit) {
    val d = row.requirement
    var title by rememberSaveable(row.id) { mutableStateOf(row.title) }
    var due by rememberSaveable(row.id) { mutableStateOf(d.due) }
    var ready by rememberSaveable(row.id) { mutableStateOf(d.ready) }
    EditorDialog(stringResource(R.string.plan_edit_item), onDismiss = onClose,
        onSave = { repo.rename(row.id, title); repo.update(row.id, "requirement", mapOf("due" to due, "ready" to ready)); onClose() },
        onDelete = { repo.trash(row.id); onClose() }) {
        PlanTextField(title, { title = it }, stringResource(R.string.plan_field_title))
        DateField(stringResource(R.string.plan_field_due), due, now, allowNone = true, onChange = { due = it })
        SwitchRow(stringResource(R.string.plan_ready), ready) { ready = it }
    }
}

/** Create or edit a subject: its name, teacher, room, code and colour. */
@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun SubjectEditor(row: PlanRow?, rows: List<PlanRow>, repo: PlanningRepository, onClose: () -> Unit, onCreated: (PlanRow) -> Unit = {}, onDeleted: () -> Unit = {}) {
    val d = row?.subject
    val key = row?.id ?: "new-subject"
    var name by rememberSaveable(key) { mutableStateOf(row?.title.orEmpty()) }
    var teacher by rememberSaveable(key) { mutableStateOf(d?.teacher.orEmpty()) }
    var room by rememberSaveable(key) { mutableStateOf(d?.room.orEmpty()) }
    var code by rememberSaveable(key) { mutableStateOf(d?.code.orEmpty()) }
    var color by rememberSaveable(key) { mutableStateOf(d?.color ?: nextSubjectColor(rows)) }
    var confirmDelete by remember { mutableStateOf(false) }
    EditorDialog(stringResource(if (row == null) R.string.plan_new_subject else R.string.plan_edit_subject), onDismiss = onClose, saveEnabled = row != null || name.isNotBlank(),
        onSave = {
            val fields = linkedMapOf<String, Any?>("color" to color)
            if (teacher.isNotBlank() || d?.teacher != null) fields["teacher"] = teacher.trim()
            if (room.isNotBlank() || d?.room != null) fields["room"] = room.trim()
            if (code.isNotBlank() || d?.code != null) fields["code"] = code.trim()
            if (row == null) repo.create("subject", name, null, fields) { onCreated(it) }
            else { repo.rename(row.id, name); repo.update(row.id, "subject", fields) }
            onClose()
        },
        onDelete = row?.let { { confirmDelete = true } }, deleteLabel = stringResource(R.string.plan_delete_subject)) {
        PlanTextField(name, { name = it }, stringResource(R.string.plan_field_name))
        PlanTextField(teacher, { teacher = it }, stringResource(R.string.plan_field_teacher))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) { PlanTextField(room, { room = it }, stringResource(R.string.plan_field_room)) }
            Box(Modifier.weight(1f)) { PlanTextField(code, { code = it }, stringResource(R.string.plan_field_code)) }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FieldLabel(stringResource(R.string.plan_field_colour))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SUBJECT_COLORS.forEach { (id, _) ->
                    val on = id == color
                    val swatch = subjectColor(id) ?: Color.Gray
                    val label = stringResource(colourName(id))
                    Box(Modifier.size(34.dp).clip(CircleShape).background(swatch)
                        .border(if (on) 3.dp else 0.dp, if (on) MaterialTheme.colorScheme.onSurface else Color.Transparent, CircleShape)
                        .toggleable(value = on, role = Role.RadioButton, onValueChange = { color = id }).semantics { contentDescription = label })
                }
            }
        }
    }
    if (confirmDelete && row != null) AlertDialog(onDismissRequest = { confirmDelete = false },
        title = { Text(stringResource(R.string.plan_delete_subject)) },
        text = { Text(stringResource(R.string.plan_delete_subject_body)) },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.cancel)) } },
        confirmButton = { TextButton(onClick = { confirmDelete = false; repo.trash(row.id); onClose(); onDeleted() }, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text(stringResource(R.string.move_to_trash)) } })
}

internal fun colourName(id: String): Int = when (id) {
    "blue" -> R.string.plan_colour_blue
    "green" -> R.string.plan_colour_green
    "yellow" -> R.string.plan_colour_yellow
    "orange" -> R.string.plan_colour_orange
    "red" -> R.string.plan_colour_red
    "purple" -> R.string.plan_colour_purple
    "pink" -> R.string.plan_colour_pink
    else -> R.string.plan_colour_gray
}
