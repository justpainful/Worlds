package worlds.android.planning

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import worlds.android.DropdownMenu
import worlds.android.OutlinedTextField
import worlds.android.R
import worlds.android.WorldsActionButton
import worlds.android.WorldsActionLabel
import worlds.android.WorldsCard
import worlds.android.WorldsGlyph
import java.time.Instant
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/* Inbox, Goals and the Calendar week grid, after the desktop's InboxView.tsx, the Goals list in TasksView.tsx and CalendarView.tsx. */

/* ------------------------------------------------------------------ inbox */

/** Catch a thought now, decide what it is later. */
@Composable internal fun InboxScreen(repo: PlanningRepository, studyOn: Boolean, onBack: () -> Unit, onOpenPage: (String) -> Unit) {
    val now = PlanDates.today()
    val rows = repo.rows
    val items = remember(rows) { inboxItems(rows) }
    val subs = remember(rows, studyOn) { if (studyOn) subjects(rows) else emptyList() }
    var editingEvent by rememberSaveable { mutableStateOf<String?>(null) }
    PlanScaffold(R.drawable.pi_inbox, stringResource(R.string.plan_inbox),
        if (items.isEmpty()) stringResource(R.string.plan_inbox_nothing) else stringResource(R.string.plan_inbox_count, items.size), onBack) {
        item(key = "capture") { CaptureField { text -> repo.create("inbox", text, null, emptyMap()) } }
        planStatus(repo)
        if (!repo.loading && !repo.loadFailed && items.isEmpty()) item(key = "empty") {
            PlanEmpty(R.drawable.pi_inbox, stringResource(R.string.plan_inbox_zero), stringResource(R.string.plan_inbox_zero_body))
        }
        if (items.isNotEmpty()) item(key = "captures") {
            PlanGroup(items) { capture, divider ->
                InboxRow(capture, now, studyOn, subs, divider,
                    onConvert = { target, parentId ->
                        repo.convert(capture.id, convertCapture(capture.title, target, LocalDateTime.now()), parentId) { made ->
                            when (target) {
                                CaptureTarget.Event -> editingEvent = made.id
                                CaptureTarget.Page -> onOpenPage(made.id)
                                else -> {}
                            }
                        }
                    },
                    onDelete = { repo.trash(capture.id) })
            }
        }
    }
    // Like the desktop, a capture turned into an event opens so its time can be set.
    val event = editingEvent?.let { id -> repo.rows.firstOrNull { it.id == id && it.kind == "event" } }
    if (event != null) EventEditor(event, event.event.date ?: now, now, repo) { editingEvent = null }
}

/** The capture field: plain words, no parsing until the capture is turned into something. */
@Composable private fun CaptureField(onCapture: (String) -> Unit) {
    var value by rememberSaveable { mutableStateOf("") }
    fun submit() {
        val text = value.trim()
        if (text.isEmpty()) return
        onCapture(text)
        value = ""
    }
    OutlinedTextField(value = value, onValueChange = { value = it }, modifier = Modifier.fillMaxWidth().padding(bottom = 14.dp), singleLine = true,
        placeholder = { Text(stringResource(R.string.plan_inbox_hint), maxLines = 1, overflow = TextOverflow.Ellipsis) },
        leadingIcon = { WorldsGlyph(R.drawable.ic_inbox) },
        trailingIcon = {
            if (value.isNotBlank()) {
                val label = stringResource(R.string.plan_add)
                IconButton(onClick = { submit() }, modifier = Modifier.semantics { contentDescription = label }) { WorldsGlyph(R.drawable.ic_check, tint = MaterialTheme.colorScheme.primary) }
            }
        },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { submit() }))
}

/** When a capture was made, named like a due date: "Today, 10:42". */
@Composable private fun capturedAt(createdAt: Long, now: String): String {
    val at = Instant.ofEpochMilli(createdAt).atZone(ZoneId.systemDefault()).toLocalDateTime()
    return dueText(PlanDates.format(at.toLocalDate()), "%02d:%02d".format(Locale.ROOT, at.hour, at.minute), now)
}

/** One capture with the desktop's choices: Task, Event and Page, and in More the study items and Delete. */
@OptIn(ExperimentalLayoutApi::class)
@Composable private fun InboxRow(capture: PlanRow, now: String, studyOn: Boolean, subjects: List<PlanRow>, divider: Boolean, onConvert: (CaptureTarget, String?) -> Unit, onDelete: () -> Unit) {
    var menuOpen by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf<CaptureTarget?>(null) }
    val more = stringResource(R.string.plan_capture_more)
    Column {
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, top = 4.dp), verticalAlignment = Alignment.Top) {
            PlanMark(R.drawable.ic_inbox, null)
            Column(Modifier.weight(1f).padding(top = 10.dp, bottom = 8.dp)) {
                Text(capture.title.ifBlank { stringResource(R.string.plan_capture_empty) }, style = MaterialTheme.typography.bodyLarge, maxLines = 4, overflow = TextOverflow.Ellipsis,
                    color = if (capture.title.isBlank()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                Text(capturedAt(capture.createdAt, now), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
            Box {
                IconButton(onClick = { picking = null; menuOpen = true }, modifier = Modifier.semantics { contentDescription = more }) {
                    WorldsGlyph(R.drawable.ic_ellipsis_vertical, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false; picking = null }) {
                    val target = picking
                    if (target == null) {
                        if (studyOn) {
                            DropdownMenuItem(text = { Text(stringResource(R.string.plan_assignment_in)) }, leadingIcon = { WorldsGlyph(R.drawable.ic_graduation_cap) },
                                trailingIcon = { Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, modifier = Modifier.size(16.dp)) },
                                onClick = { picking = CaptureTarget.Assignment })
                            DropdownMenuItem(text = { Text(stringResource(R.string.plan_bring_in)) }, leadingIcon = { WorldsGlyph(R.drawable.ic_list) },
                                trailingIcon = { Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, modifier = Modifier.size(16.dp)) },
                                onClick = { picking = CaptureTarget.Requirement })
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                        DropdownMenuItem(text = { Text(stringResource(R.string.plan_delete), color = MaterialTheme.colorScheme.error) },
                            leadingIcon = { WorldsGlyph(R.drawable.ic_trash_2, tint = MaterialTheme.colorScheme.error) },
                            onClick = { menuOpen = false; onDelete() })
                    } else {
                        if (subjects.isEmpty()) DropdownMenuItem(text = { Text(stringResource(R.string.plan_add_subject_first)) }, onClick = {}, enabled = false)
                        subjects.forEach { s ->
                            DropdownMenuItem(text = { Text(s.title.ifBlank { stringResource(R.string.untitled) }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                leadingIcon = { Box(Modifier.size(12.dp).clip(CircleShape).background(subjectColor(s.subject.color) ?: MaterialTheme.colorScheme.primary)) },
                                onClick = { menuOpen = false; picking = null; onConvert(target, s.id) })
                        }
                    }
                }
            }
        }
        FlowRow(Modifier.fillMaxWidth().padding(start = 54.dp, end = 14.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            WorldsActionButton(onClick = { onConvert(CaptureTarget.Task, null) }) { WorldsActionLabel(R.drawable.ic_list_todo, stringResource(R.string.plan_kind_task)) }
            WorldsActionButton(onClick = { onConvert(CaptureTarget.Event, null) }) { WorldsActionLabel(R.drawable.ic_calendar, stringResource(R.string.plan_kind_event)) }
            WorldsActionButton(onClick = { onConvert(CaptureTarget.Page, null) }) { WorldsActionLabel(R.drawable.ic_file_text, stringResource(R.string.kind_page)) }
        }
        if (divider) HorizontalDivider(Modifier.padding(start = 54.dp), color = MaterialTheme.colorScheme.outlineVariant)
    }
}

/* ------------------------------------------------------------------ goals */

/** The Goals list inside Tasks: add with quick add (a date becomes the target), then each goal with its progress. */
internal fun LazyListScope.goalItems(repo: PlanningRepository, goals: List<PlanRow>, now: String, onOpen: (String) -> Unit) {
    item(key = "add-goal") {
        QuickAddField(stringResource(R.string.plan_add_goal_hint), now) { p ->
            repo.create("goal", p.title, null, mapOf("target" to p.due, "steps" to emptyList<Any>()))
        }
    }
    planStatus(repo)
    if (!repo.loading && !repo.loadFailed && goals.isEmpty()) item(key = "goals-empty") {
        PlanEmpty(R.drawable.pi_target, stringResource(R.string.plan_empty_goals), stringResource(R.string.plan_empty_goals_body))
    }
    if (goals.isNotEmpty()) item(key = "goals") {
        PlanGroup(goals) { goal, divider -> GoalRow(goal, repo.rows, now, divider) { onOpen(goal.id) } }
    }
}

@Composable private fun GoalRow(goal: PlanRow, rows: List<PlanRow>, now: String, divider: Boolean, onOpen: () -> Unit) {
    val d = goal.goal
    val percent = goalPercent(d)
    val linked = remember(rows, goal.id) { goalTasks(rows, goal.id) }
    val meta = listOfNotNull(
        d.target?.takeIf { PlanDates.isIso(it) }?.let { target ->
            stringResource(R.string.plan_goal_target, dayName(target, now)) to (if (target < now && percent < 100) MaterialTheme.colorScheme.error else null)
        },
        if (d.steps.isNotEmpty()) stringResource(R.string.plan_goal_steps_count, d.steps.count { it.done }, d.steps.size) to null else null,
        if (linked.isNotEmpty()) stringResource(R.string.plan_goal_tasks_count, linked.count { it.task.done }, linked.size) to null else null,
    )
    PlanRowItem(goal.title, false, divider, onOpen, leading = { PlanMark(R.drawable.ic_target, MaterialTheme.colorScheme.primary) }, meta = meta, trailing = { GoalProgress(percent) })
}

/* -------------------------------------------------------------- week grid */

private val HOUR_HEIGHT = 44.dp
private val GUTTER = 40.dp

/**
 * Seven days side by side: all day items on top, timed ones placed by their
 * time, today tinted. Rows follow the layout direction, so in Arabic the week
 * runs right to left as the desktop's grid does. Tapping an empty hour makes
 * an event at that time.
 */
@Composable internal fun WeekGrid(days: List<WeekDay>, now: String, onOpen: (String) -> Unit, onCreate: (day: String, hour: Int) -> Unit) {
    val hours = remember(days) { weekHours(days) }
    val locale = currentLocale()
    val hourLabels = hours.map { hourName(it) }
    val outline = MaterialTheme.colorScheme.outlineVariant
    val accent = MaterialTheme.colorScheme.primary
    val nowMinutes = LocalTime.now().let { it.hour * 60 + it.minute }
    WorldsCard(Modifier.fillMaxWidth().padding(bottom = 14.dp)) {
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
            Spacer(Modifier.width(GUTTER))
            days.forEach { day ->
                val today = day.date == now
                val date = PlanDates.parse(day.date)
                val label = "${weekdayName(PlanDates.weekday(day.date), TextStyle.FULL, locale)}, ${shortDate(day.date, false, locale)}"
                Column(Modifier.weight(1f).clearAndSetSemantics { contentDescription = label }, horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(weekdayName(PlanDates.weekday(day.date), TextStyle.SHORT, locale), style = MaterialTheme.typography.labelSmall,
                        color = if (today) accent else MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Clip)
                    Box(Modifier.padding(top = 2.dp).size(28.dp).clip(CircleShape).background(if (today) accent else Color.Transparent), contentAlignment = Alignment.Center) {
                        Text(DateTimeFormatter.ofPattern("d", locale).format(date), style = MaterialTheme.typography.labelLarge,
                            color = if (today) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface, maxLines = 1)
                    }
                }
            }
        }
        if (days.any { it.allDay.isNotEmpty() }) {
            HorizontalDivider(color = outline)
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
                Box(Modifier.width(GUTTER).fillMaxHeight().padding(horizontal = 2.dp, vertical = 4.dp), contentAlignment = Alignment.Center) {
                    Text(stringResource(R.string.plan_all_day), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, maxLines = 2)
                }
                days.forEach { day ->
                    Column(Modifier.weight(1f).fillMaxHeight().background(if (day.date == now) accent.copy(alpha = 0.06f) else Color.Transparent).padding(2.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        day.allDay.forEach { o -> WeekChip(o, null, Modifier.fillMaxWidth().height(22.dp)) { onOpen(o.row.id) } }
                    }
                }
            }
        }
        HorizontalDivider(color = outline)
        val count = hours.last - hours.first + 1
        Row(Modifier.fillMaxWidth().height(HOUR_HEIGHT * count)) {
            Column(Modifier.width(GUTTER)) {
                hourLabels.forEach { label ->
                    Box(Modifier.fillMaxWidth().height(HOUR_HEIGHT).padding(top = 2.dp, start = 2.dp, end = 4.dp), contentAlignment = Alignment.TopEnd) {
                        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Clip)
                    }
                }
            }
            days.forEach { day ->
                DayColumn(day, hours, hourLabels, day.date == now, if (day.date == now) nowMinutes else null, now, onOpen, onCreate, Modifier.weight(1f).fillMaxHeight())
            }
        }
    }
}

/** One day's hours: empty slots to tap, then the timed blocks on top in their lanes. */
@Composable private fun DayColumn(day: WeekDay, hours: IntRange, hourLabels: List<String>, today: Boolean, nowMinutes: Int?, now: String,
                                  onOpen: (String) -> Unit, onCreate: (String, Int) -> Unit, modifier: Modifier) {
    val outline = MaterialTheme.colorScheme.outlineVariant
    val accent = MaterialTheme.colorScheme.primary
    val dayLabel = dayName(day.date, now)
    val first = hours.first * 60
    BoxWithConstraints(modifier.background(if (today) accent.copy(alpha = 0.06f) else Color.Transparent).drawBehind {
        val hour = HOUR_HEIGHT.toPx()
        val line = 0.5.dp.toPx()
        var y = hour
        while (y < size.height) { drawLine(outline, Offset(0f, y), Offset(size.width, y), line); y += hour }
        val edge = if (layoutDirection == LayoutDirection.Rtl) size.width else 0f
        drawLine(outline, Offset(edge, 0f), Offset(edge, size.height), line)
    }) {
        Column(Modifier.fillMaxSize()) {
            hours.forEachIndexed { i, h ->
                val label = stringResource(R.string.plan_add_event_at, dayLabel, hourLabels[i])
                Box(Modifier.fillMaxWidth().height(HOUR_HEIGHT).clickable { onCreate(day.date, h) }.semantics { contentDescription = label })
            }
        }
        day.timed.forEach { b ->
            val width = maxWidth / b.lanes
            val top = HOUR_HEIGHT * ((b.start - first) / 60f)
            val height = HOUR_HEIGHT * (maxOf(b.end - b.start, MIN_BLOCK_MINUTES) / 60f)
            WeekChip(b.occurrence, b, Modifier.offset(x = width * b.lane, y = top).width(width).height(height).padding(1.dp)) { onOpen(b.occurrence.row.id) }
        }
        if (nowMinutes != null && nowMinutes >= first && nowMinutes < (hours.last + 1) * 60) {
            Box(Modifier.offset(y = HOUR_HEIGHT * ((nowMinutes - first) / 60f) - 1.dp).fillMaxWidth().height(2.dp).background(accent))
        }
    }
}

/** An item on the grid: a coloured bar at the start edge, the title, faded and struck through when done. */
@Composable private fun WeekChip(o: Occurrence, block: WeekBlock?, modifier: Modifier, onClick: () -> Unit) {
    val tint = subjectColor(o.color) ?: (if (o.kind == "task") priorityColor(o.row.task.priority) else null) ?: MaterialTheme.colorScheme.primary
    val title = o.row.title.ifBlank { stringResource(R.string.untitled) }
    val start = if (block != null) o.start else null
    val end = o.end
    val endsAfter = block != null && (minutesOf(end) ?: -1) > block.start
    val time = when {
        start == null -> null
        end != null && endsAfter -> stringResource(R.string.plan_time_range, clockName(start), clockName(end))
        else -> clockName(start)
    }
    val label = listOfNotNull(title, time).joinToString(", ")
    Row(modifier.clip(RoundedCornerShape(6.dp)).background(tint.copy(alpha = if (o.done) 0.10f else 0.20f)).clickable(onClick = onClick).clearAndSetSemantics { contentDescription = label }) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(tint.copy(alpha = if (o.done) 0.5f else 1f)))
        Text(title, modifier = Modifier.padding(horizontal = 3.dp, vertical = 2.dp), style = MaterialTheme.typography.labelSmall,
            color = if (o.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            textDecoration = if (o.done) TextDecoration.LineThrough else null, maxLines = if (block == null) 1 else 4, overflow = TextOverflow.Ellipsis)
    }
}
