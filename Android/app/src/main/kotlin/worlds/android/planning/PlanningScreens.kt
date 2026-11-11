package worlds.android.planning

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import worlds.android.LocalAppearanceStore
import worlds.android.R
import worlds.android.WorldsActionButton
import worlds.android.WorldsActionLabel
import worlds.android.WorldsGlyph
import java.time.format.DateTimeFormatter

/** The planning sections the app opens as pushed screens. */
internal enum class PlanningSection { Tasks, Calendar, Study }

/**
 * Tasks, Calendar and Study over one ContentStore connection. Lesson notes are
 * pages, so they open in the page editor through [onOpenPage].
 */
@Composable internal fun PlanningScreen(section: PlanningSection, databaseName: String, studyEnabled: Boolean, onBack: () -> Unit, onOpenPage: (String) -> Unit) {
    val context = LocalContext.current
    val repo = remember(databaseName) { PlanningRepository(context, databaseName) }
    DisposableEffect(repo) {
        repo.load()
        onDispose { repo.close() }
    }
    when (section) {
        PlanningSection.Tasks -> TasksScreen(repo, studyEnabled, onBack)
        PlanningSection.Calendar -> CalendarScreen(repo, studyEnabled, onBack)
        PlanningSection.Study -> StudyScreen(repo, studyEnabled, onBack, onOpenPage)
    }
}

/* ------------------------------------------------------------------ tasks */

@Composable private fun TasksScreen(repo: PlanningRepository, studyOn: Boolean, onBack: () -> Unit) {
    var list by rememberSaveable { mutableStateOf(TaskList.Today) }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    val now = PlanDates.today()
    val rows = repo.rows
    val todayCount = remember(rows, now) { tasksFor(rows, TaskList.Today, now).size }
    val groups = remember(rows, list, now) { taskGroups(rows, list, now) }
    val byId = remember(rows) { rows.associateBy { it.id } }
    PlanScaffold(R.drawable.pi_checklist, stringResource(R.string.plan_tasks),
        if (todayCount > 0) stringResource(R.string.plan_tasks_today_count, todayCount) else stringResource(R.string.plan_tasks_clear), onBack) {
        item(key = "lists") {
            PlanPills(listOf(TaskList.Today to stringResource(R.string.plan_today), TaskList.Upcoming to stringResource(R.string.plan_upcoming), TaskList.All to stringResource(R.string.plan_all),
                TaskList.Someday to stringResource(R.string.plan_someday), TaskList.Done to stringResource(R.string.plan_done)), list) { list = it }
        }
        if (list != TaskList.Done) item(key = "add-$list") {
            QuickAddField(stringResource(if (list == TaskList.Someday) R.string.plan_add_someday_hint else R.string.plan_add_task_hint), now) { p ->
                repo.create("task", p.title, null, mapOf(
                    "due" to (p.due ?: if (list == TaskList.Today) now else null), "time" to p.time, "priority" to p.priority,
                    "someday" to (list == TaskList.Someday && p.due == null)))
            }
        }
        planStatus(repo)
        if (!repo.loading && !repo.loadFailed && groups.isEmpty()) item(key = "empty") {
            val (title, body) = when (list) {
                TaskList.Today -> R.string.plan_empty_today to R.string.plan_empty_today_body
                TaskList.Upcoming -> R.string.plan_empty_upcoming to R.string.plan_empty_upcoming_body
                TaskList.All -> R.string.plan_empty_all to R.string.plan_empty_all_body
                TaskList.Someday -> R.string.plan_empty_someday to R.string.plan_empty_someday_body
                TaskList.Done -> R.string.plan_empty_done to R.string.plan_empty_done_body
            }
            PlanEmpty(R.drawable.pi_checklist, stringResource(title), stringResource(body))
        }
        groups.forEach { group ->
            val groupKey = "${group.kind}:${group.day ?: group.parentId ?: ""}"
            item(key = "title-$groupKey") {
                val title = when (group.kind) {
                    GroupKind.Overdue -> stringResource(R.string.plan_overdue)
                    GroupKind.Today -> stringResource(R.string.plan_today)
                    GroupKind.Day -> dayName(group.day!!, now)
                    GroupKind.Parent -> group.parentId?.let { byId[it] }?.title?.ifBlank { null } ?: stringResource(R.string.untitled)
                    GroupKind.NoParent -> stringResource(R.string.plan_no_project)
                    GroupKind.Someday -> stringResource(R.string.plan_someday)
                    GroupKind.Done -> stringResource(R.string.plan_completed)
                }
                PlanGroupTitle(title, group.items.size, if (group.kind == GroupKind.Overdue) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onBackground)
            }
            item(key = "group-$groupKey") {
                PlanGroup(group.items) { row, divider -> TaskRow(row, byId, now, studyOn, showParent = list != TaskList.All, divider = divider, repo = repo) { editing = row.id } }
            }
        }
    }
    val target = editing?.let { id -> repo.rows.firstOrNull { it.id == id } }
    if (target != null) TaskEditor(target, now, repo) { editing = null }
}

@Composable private fun TaskRow(row: PlanRow, byId: Map<String, PlanRow>, now: String, studyOn: Boolean, showParent: Boolean, divider: Boolean, repo: PlanningRepository, onOpen: () -> Unit) {
    val d = row.task
    val subject = subjectOf(byId, row, studyOn)
    val tint = subjectColor(subject?.subject?.color) ?: priorityColor(d.priority)
    val parent = row.parentId?.let { byId[it] }?.takeIf { studyOn || it.kind !in STUDY_KINDS }
    val meta = listOfNotNull(
        dueMeta(d.due, d.time, d.done, now),
        if (d.priority > 0 && !d.done) priorityName(d.priority) to priorityColor(d.priority) else null,
        if (showParent && parent != null) parent.title.ifBlank { stringResource(R.string.untitled) } to subjectColor(subject?.subject?.color) else null,
    )
    PlanRowItem(row.title, d.done, divider, onOpen, leading = { PlanCheck(d.done, tint) { repo.change(row.id, "task") { toggledTask(it, System.currentTimeMillis()) } } }, meta = meta)
}

/* --------------------------------------------------------------- calendar */

/** How far the agenda looks ahead, as on the desktop. */
private const val AGENDA_DAYS = 35

@Composable private fun CalendarScreen(repo: PlanningRepository, studyOn: Boolean, onBack: () -> Unit) {
    val now = PlanDates.today()
    var anchor by rememberSaveable { mutableStateOf(now) }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    var creatingOn by rememberSaveable { mutableStateOf<String?>(null) }
    val rows = repo.rows
    val to = PlanDates.addDays(anchor, AGENDA_DAYS - 1)
    val occ = remember(rows, anchor, studyOn) { occurrences(rows, anchor, to, studyOn, includeDone = true) }
    val todayOpen = remember(rows, now, studyOn) { occurrences(rows, now, now, studyOn).size }
    val byDay = remember(occ) { occ.groupBy { it.date } }
    PlanScaffold(R.drawable.pi_calendar, stringResource(R.string.plan_calendar),
        if (todayOpen > 0) stringResource(R.string.plan_calendar_today_count, todayOpen) else stringResource(R.string.plan_calendar_nothing_today), onBack,
        trailing = { Button(onClick = { creatingOn = anchor }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.plan_event)) } }) {
        item(key = "range") { RangeBar(anchor, to, onPrevious = { anchor = PlanDates.addDays(anchor, -AGENDA_DAYS) }, onToday = { anchor = now }, onNext = { anchor = PlanDates.addDays(anchor, AGENDA_DAYS) }) }
        item(key = "add-event") {
            QuickAddField(stringResource(R.string.plan_add_event_hint), now) { p ->
                val date = p.due ?: anchor
                val start = p.time
                repo.create("event", p.title, null, mapOf("date" to date, "start" to start, "end" to start?.let(::hourAfter), "allDay" to (start == null)))
                if (date < anchor || date > to) anchor = date
            }
        }
        planStatus(repo)
        if (!repo.loading && !repo.loadFailed && occ.isEmpty()) item(key = "empty") {
            PlanEmpty(R.drawable.pi_calendar, stringResource(R.string.plan_empty_calendar), stringResource(if (studyOn) R.string.plan_empty_calendar_study_body else R.string.plan_empty_calendar_body))
        }
        byDay.forEach { (day, items) ->
            item(key = "day-$day") {
                Row(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp).semantics(mergeDescendants = true) { heading() }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(dayName(day, now), modifier = Modifier.weight(1f, fill = false), style = MaterialTheme.typography.titleMedium, color = if (day == now) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onBackground, maxLines = 1)
                    Text(shortDate(day, false, currentLocale()), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
            item(key = "items-$day") {
                PlanGroup(items) { o, divider -> OccurrenceRow(o, now, divider, repo) { editing = o.row.id } }
            }
        }
    }
    val target = editing?.let { id -> repo.rows.firstOrNull { it.id == id } }
    if (target != null) when (target.kind) {
        "task" -> TaskEditor(target, now, repo) { editing = null }
        "event" -> EventEditor(target, target.event.date ?: now, now, repo) { editing = null }
        "assignment", "exam", "requirement" -> StudyItemEditor(target, now, repo) { editing = null }
        else -> {}
    }
    creatingOn?.let { day -> EventEditor(null, day, now, repo) { creatingOn = null } }
}

@Composable private fun RangeBar(from: String, to: String, onPrevious: () -> Unit, onToday: () -> Unit, onNext: () -> Unit) {
    val locale = currentLocale()
    val a = PlanDates.parse(from)
    val b = PlanDates.parse(to)
    val title = if (a.year == b.year && a.month == b.month) DateTimeFormatter.ofPattern("LLLL yyyy", locale).format(a)
        else stringResource(R.string.plan_range, DateTimeFormatter.ofPattern("LLL", locale).format(a), DateTimeFormatter.ofPattern("LLL yyyy", locale).format(b))
    val previous = stringResource(R.string.plan_previous)
    val next = stringResource(R.string.plan_next)
    Row(Modifier.fillMaxWidth().padding(bottom = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground)
        WorldsActionButton(onClick = onPrevious) { Icon(painterResource(R.drawable.ic_chevron_left), contentDescription = previous, modifier = Modifier.size(18.dp)) }
        WorldsActionButton(onClick = onToday) { Text(stringResource(R.string.plan_today)) }
        WorldsActionButton(onClick = onNext) { Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = next, modifier = Modifier.size(18.dp)) }
    }
}

@Composable private fun kindName(kind: String): String = stringResource(when (kind) {
    "assignment" -> R.string.plan_kind_assignment
    "exam" -> R.string.plan_kind_exam
    "requirement" -> R.string.plan_kind_requirement
    "task" -> R.string.plan_kind_task
    else -> R.string.plan_kind_event
})

@Composable private fun timeRange(start: String?, end: String?, allDay: Boolean): String? = when {
    allDay || start == null -> null
    end != null -> stringResource(R.string.plan_time_range, clockName(start), clockName(end))
    else -> clockName(start)
}

/** One thing on the calendar. Tasks and work can be ticked right here. */
@Composable private fun OccurrenceRow(o: Occurrence, now: String, divider: Boolean, repo: PlanningRepository, onOpen: () -> Unit) {
    val tint = subjectColor(o.color)
    val meta = buildList<Pair<String, Color?>> {
        add((timeRange(o.start, o.end, o.allDay) ?: stringResource(R.string.plan_all_day)) to null)
        if (o.kind != "event") add(kindName(o.kind) to tint)
        if (o.kind == "event") o.row.event.location?.takeIf { it.isNotBlank() }?.let { add(it to null) }
    }
    PlanRowItem(o.row.title, o.done, divider, onOpen, leading = {
        when (o.kind) {
            "task" -> PlanCheck(o.done, tint ?: priorityColor(o.row.task.priority)) { repo.change(o.row.id, "task") { toggledTask(it, System.currentTimeMillis()) } }
            "assignment" -> PlanCheck(o.done, tint) { toggleAssignment(repo, o.row) }
            "requirement" -> PlanCheck(o.done, tint) { repo.update(o.row.id, "requirement", mapOf("ready" to !o.done)) }
            "exam" -> PlanMark(R.drawable.ic_graduation_cap, tint)
            else -> PlanMark(null, tint)
        }
    }, meta = meta)
}

private fun toggleAssignment(repo: PlanningRepository, row: PlanRow) {
    val submitted = !row.assignment.submitted
    repo.update(row.id, "assignment", mapOf("submitted" to submitted, "submittedAt" to if (submitted) System.currentTimeMillis() else null))
}

/* ------------------------------------------------------------------ study */

@Composable private fun StudyScreen(repo: PlanningRepository, studyOn: Boolean, onBack: () -> Unit, onOpenPage: (String) -> Unit) {
    var subjectId by rememberSaveable { mutableStateOf<String?>(null) }
    if (!studyOn) {
        StudyOff(onBack)
        return
    }
    val subject = subjectId?.let { id -> repo.rows.firstOrNull { it.id == id && it.kind == "subject" } }
    if (subject != null) SubjectScreen(subject, repo, onBack = { subjectId = null }, onOpenPage = onOpenPage)
    else StudyHome(repo, onBack, onOpenSubject = { subjectId = it })
}

@Composable private fun StudyOff(onBack: () -> Unit) {
    val store = LocalAppearanceStore.current
    val scope = rememberCoroutineScope()
    PlanScaffold(R.drawable.pi_graduation, stringResource(R.string.plan_study), null, onBack) {
        item(key = "off") {
            PlanEmpty(R.drawable.pi_graduation, stringResource(R.string.plan_study_off), stringResource(R.string.plan_study_off_body)) {
                Button(onClick = { scope.launch { runCatching { store.setStudyPack(true) } } }) { Text(stringResource(R.string.plan_study_turn_on)) }
            }
        }
    }
}

@Composable private fun StudyHome(repo: PlanningRepository, onBack: () -> Unit, onOpenSubject: (String) -> Unit) {
    val now = PlanDates.today()
    val rows = repo.rows
    val subs = remember(rows) { subjects(rows) }
    val byId = remember(rows) { rows.associateBy { it.id } }
    val classes = remember(rows, now) { occurrences(rows, now, now, studyOn = true).filter { it.kind == "event" && subjectOf(byId, it.row, true) != null } }
    val work = remember(rows, now) { openStudyWork(rows, now, 14).filter { !it.done } }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    var creating by rememberSaveable { mutableStateOf(false) }
    val subtitle = if (subs.isEmpty()) null else listOf(
        if (classes.isEmpty()) stringResource(R.string.plan_no_classes_today) else stringResource(R.string.plan_classes_today_count, classes.size),
        if (work.isEmpty()) stringResource(R.string.plan_nothing_due_soon) else stringResource(R.string.plan_open_count, work.size),
    ).joinToString(" · ")
    PlanScaffold(R.drawable.pi_graduation, stringResource(R.string.plan_study), subtitle, onBack,
        trailing = { if (subs.isNotEmpty()) Button(onClick = { creating = true }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.plan_subject)) } }) {
        planStatus(repo)
        if (!repo.loading && !repo.loadFailed && subs.isEmpty()) item(key = "empty") {
            PlanEmpty(R.drawable.pi_graduation, stringResource(R.string.plan_empty_subjects), stringResource(R.string.plan_empty_subjects_body)) {
                Button(onClick = { creating = true }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.plan_add_subject)) }
            }
        }
        if (subs.isNotEmpty()) {
            if (classes.isNotEmpty()) {
                item(key = "classes-title") { PlanGroupTitle(stringResource(R.string.plan_todays_classes), classes.size) }
                item(key = "classes") {
                    PlanGroup(classes) { o, divider ->
                        val subject = subjectOf(byId, o.row, true)
                        val room = o.row.event.location?.takeIf { it.isNotBlank() } ?: subject?.subject?.room?.takeIf { it.isNotBlank() }
                        PlanRowItem(subject?.title ?: o.row.title, false, divider, onClick = { subject?.let { onOpenSubject(it.id) } }, leading = { PlanMark(null, subjectColor(o.color)) },
                            meta = listOfNotNull((timeRange(o.start, o.end, o.allDay) ?: stringResource(R.string.plan_all_day)) to null, room?.let { it to null }))
                    }
                }
            }
            item(key = "work-title") { PlanGroupTitle(stringResource(R.string.plan_due_two_weeks), work.size) }
            if (work.isEmpty()) item(key = "work-empty") { PlanHint(stringResource(R.string.plan_due_two_weeks_empty)) }
            else item(key = "work") { PlanGroup(work) { o, divider -> StudyWorkRow(o.row, byId, now, showSubject = true, divider = divider, repo = repo) { editing = o.row.id } } }
            item(key = "subjects-title") { PlanGroupTitle(stringResource(R.string.plan_subjects), subs.size) }
            item(key = "subjects") {
                PlanGroup(subs) { s, divider ->
                    val d = s.subject
                    val open = openCount(rows, s.id)
                    val exam = nextExam(rows, s.id, now)
                    PlanRowItem(s.title, false, divider, onClick = { onOpenSubject(s.id) }, leading = { PlanMark(null, subjectColor(d.color)) },
                        meta = listOfNotNull(
                            listOfNotNull(d.teacher, d.room).filter { it.isNotBlank() }.joinToString(" · ").ifEmpty { null }?.let { it to null },
                            (if (open > 0) stringResource(R.string.plan_open_count, open) else stringResource(R.string.plan_all_done)) to null,
                            exam?.let { stringResource(R.string.plan_exam_on, dayName(it, now)) to MaterialTheme.colorScheme.primary },
                        ))
                }
            }
        }
    }
    val target = editing?.let { id -> repo.rows.firstOrNull { it.id == id } }
    if (target != null) StudyItemEditor(target, now, repo) { editing = null }
    if (creating) SubjectEditor(null, rows, repo, onClose = { creating = false }, onCreated = { onOpenSubject(it.id) })
}

/** An assignment, exam or thing to bring, with its subject when listed outside it. */
@Composable private fun StudyWorkRow(row: PlanRow, byId: Map<String, PlanRow>, now: String, showSubject: Boolean, divider: Boolean, repo: PlanningRepository, onOpen: () -> Unit) {
    val subject = subjectOf(byId, row, true)
    val tint = subjectColor(subject?.subject?.color)
    val subjectMeta = if (showSubject && subject != null) subject.title.ifBlank { stringResource(R.string.untitled) } to tint else null
    when (row.kind) {
        "assignment" -> {
            val d = row.assignment
            val points = d.points?.let { p -> stringResource(R.string.plan_points, listOfNotNull(d.earned?.let(::plainNumber), plainNumber(p)).joinToString("/")) }
            PlanRowItem(row.title, d.submitted, divider, onOpen, leading = { PlanCheck(d.submitted, tint) { toggleAssignment(repo, row) } },
                meta = listOfNotNull(kindName("assignment") to null, dueMeta(d.due, d.time, d.submitted, now), points?.let { it to null }, subjectMeta))
        }
        "exam" -> {
            val d = row.exam
            val result = d.score?.let { s -> listOfNotNull(plainNumber(s), d.maxScore?.let(::plainNumber)).joinToString("/") } ?: d.scope?.takeIf { it.isNotBlank() }
            PlanRowItem(row.title, d.score != null, divider, onOpen, leading = { PlanMark(R.drawable.ic_graduation_cap, tint) },
                meta = listOfNotNull(kindName("exam") to null, dueMeta(d.date, d.time, d.score != null, now), result?.let { it to null }, subjectMeta))
        }
        else -> {
            val d = row.requirement
            PlanRowItem(row.title, d.ready, divider, onOpen, leading = { PlanCheck(d.ready, tint) { repo.update(row.id, "requirement", mapOf("ready" to !d.ready)) } },
                meta = listOfNotNull(kindName("requirement") to null, dueMeta(d.due, null, d.ready, now), subjectMeta))
        }
    }
}

private fun plainNumber(v: Double): String = if (v == Math.floor(v) && !v.isInfinite()) v.toLong().toString() else v.toString()

/** A subject: details, and everything filed under it. */
@Composable private fun SubjectScreen(subject: PlanRow, repo: PlanningRepository, onBack: () -> Unit, onOpenPage: (String) -> Unit) {
    val now = PlanDates.today()
    val rows = repo.rows
    val byId = remember(rows) { rows.associateBy { it.id } }
    val d = subject.subject
    val assignments = remember(rows, subject.id) { subjectAssignments(rows, subject.id) }
    val exams = remember(rows, subject.id) { subjectExams(rows, subject.id) }
    val lessons = remember(rows, subject.id) { subjectLessons(rows, subject.id) }
    val openWork = assignments.filter { !it.assignment.submitted }
    val doneWork = assignments.filter { it.assignment.submitted }
    var showDone by rememberSaveable(subject.id) { mutableStateOf(false) }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    var editingSubject by rememberSaveable { mutableStateOf(false) }
    val graded = assignments.mapNotNull { a -> a.assignment.let { x -> if (x.points != null && x.points != 0.0 && x.earned != null) x.earned to x.points else null } } +
        exams.mapNotNull { e -> e.exam.let { x -> if (x.maxScore != null && x.maxScore != 0.0 && x.score != null) x.score to x.maxScore else null } }
    val average = if (graded.isEmpty()) null else Math.round(graded.sumOf { it.first } / graded.sumOf { it.second } * 100).toInt()
    val details = listOfNotNull(d.teacher, d.room, d.code).filter { it.isNotBlank() }
    PlanScaffold(R.drawable.pi_graduation, subject.title.ifBlank { stringResource(R.string.untitled) },
        listOfNotNull(details.joinToString(" · ").ifEmpty { null }, average?.let { stringResource(R.string.plan_average, it) }).joinToString(" · ").ifEmpty { null }, onBack,
        trailing = { WorldsActionButton(onClick = { editingSubject = true }) { WorldsActionLabel(R.drawable.ic_pencil, stringResource(R.string.plan_edit)) } }) {
        planStatus(repo)
        item(key = "assignments-title") { SubjectSectionTitle(stringResource(R.string.plan_assignments), openWork.size, subjectColor(d.color)) }
        item(key = "assignments-add") {
            QuickAddField(stringResource(R.string.plan_add_assignment_hint), now) { p ->
                val fields = linkedMapOf<String, Any?>("due" to p.due, "time" to p.time)
                if (d.teacher != null) fields["teacher"] = d.teacher
                repo.create("assignment", p.title, subject.id, fields)
            }
        }
        if (openWork.isNotEmpty()) item(key = "assignments") { PlanGroup(openWork) { row, divider -> StudyWorkRow(row, byId, now, showSubject = false, divider = divider, repo = repo) { editing = row.id } } }
        if (doneWork.isNotEmpty()) {
            item(key = "handed-in-toggle") {
                TextButton(onClick = { showDone = !showDone }) { Text(stringResource(if (showDone) R.string.plan_hide_handed_in else R.string.plan_show_handed_in, doneWork.size)) }
            }
            if (showDone) item(key = "handed-in") { PlanGroup(doneWork) { row, divider -> StudyWorkRow(row, byId, now, showSubject = false, divider = divider, repo = repo) { editing = row.id } } }
        }
        item(key = "exams-title") { SubjectSectionTitle(stringResource(R.string.plan_exams), exams.size, subjectColor(d.color)) }
        item(key = "exams-add") {
            QuickAddField(stringResource(R.string.plan_add_exam_hint), now) { p -> repo.create("exam", p.title, subject.id, mapOf("date" to p.due, "time" to p.time)) }
        }
        if (exams.isNotEmpty()) item(key = "exams") { PlanGroup(exams) { row, divider -> StudyWorkRow(row, byId, now, showSubject = false, divider = divider, repo = repo) { editing = row.id } } }
        item(key = "lessons-title") {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) { SubjectSectionTitle(stringResource(R.string.plan_lessons), lessons.size, subjectColor(d.color)) }
                WorldsActionButton(onClick = {
                    repo.create("lesson", "", subject.id, mapOf("taughtOn" to now, "number" to lessons.size + 1)) { onOpenPage(it.id) }
                }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.plan_lesson_notes)) }
            }
        }
        if (lessons.isEmpty()) item(key = "lessons-empty") { PlanHint(stringResource(R.string.plan_lessons_empty)) }
        else item(key = "lessons") {
            PlanGroup(lessons) { lesson, divider ->
                val ld = lesson.lesson
                val title = lesson.title.ifBlank { stringResource(R.string.untitled) }
                PlanRowItem(if (ld.number != null) stringResource(R.string.plan_lesson_numbered, ld.number, title) else title, false, divider, onClick = { onOpenPage(lesson.id) },
                    leading = { PlanMark(R.drawable.ic_file_text, subjectColor(d.color)) }, meta = listOfNotNull(ld.taughtOn?.takeIf { PlanDates.isIso(it) }?.let { dayName(it, now) to null }))
            }
        }
    }
    val target = editing?.let { id -> repo.rows.firstOrNull { it.id == id } }
    if (target != null) StudyItemEditor(target, now, repo) { editing = null }
    if (editingSubject) SubjectEditor(subject, rows, repo, onClose = { editingSubject = false }, onDeleted = onBack)
}

@Composable private fun SubjectSectionTitle(title: String, count: Int, color: Color?) {
    Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (color != null) WorldsGlyph(R.drawable.ic_list, tint = color)
        PlanGroupTitle(title, count.takeIf { it > 0 })
    }
}

