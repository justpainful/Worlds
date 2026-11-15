package worlds.android.planning

import org.json.JSONArray
import org.json.JSONObject
import worlds.content.Resource
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit

/*
 * Planning model, ported from the desktop's src/planning/model.ts so both apps
 * read and write the same files. Every item is a resource whose fields live in
 * `metadata.<kind>`. Dates are local calendar days as "YYYY-MM-DD" and times
 * as "HH:MM", never instants.
 */

/** Kinds that exist only while the Study pack is on (desktop src/packs/registry.ts). */
internal val STUDY_KINDS = setOf("subject", "lesson", "assignment", "exam", "requirement")

/** Every kind whose fields live in `metadata.<kind>` (desktop DATA_KINDS). */
internal val DATA_KINDS = setOf("task", "event", "inbox", "goal", "subject", "lesson", "assignment", "exam", "requirement")

/** A pack kind ("teacher.class") keeps its fields under `metadata.item` (docs/PACKS.md). */
internal fun isPackKind(kind: String): Boolean = worlds.content.ContentStore.isPackKind(kind)

/** Where a kind's fields live in its metadata. */
internal fun dataKeyOf(kind: String): String = if (isPackKind(kind)) "item" else kind

/** Kinds that open in their own screens, not in Home and the Library: planning kinds and pack items. */
internal fun hasOwnView(kind: String): Boolean = kind in OWN_VIEW_KINDS || isPackKind(kind)

/**
 * Things you plan and tick off, plus subjects, live in Tasks, Calendar and
 * Study rather than in Home and the Library (desktop ITEM_KINDS in
 * src/resources/kinds.ts). Lesson notes are pages and stay listed.
 */
internal val OWN_VIEW_KINDS = setOf("task", "event", "inbox", "goal", "assignment", "exam", "requirement", "subject")

/** Subject colours in the desktop's order (`Object.keys(PROP_COLORS)`), with their RGB values. */
internal val SUBJECT_COLORS = listOf(
    "gray" to 0x8E8E96, "blue" to 0x589CFF, "green" to 0x3DC878, "yellow" to 0xF0C440,
    "orange" to 0xFF9648, "red" to 0xFF6363, "purple" to 0xAA80FF, "pink" to 0xF570B4,
)

internal fun subjectColorRgb(name: String?): Int? = SUBJECT_COLORS.firstOrNull { it.first == name }?.second

// ---------------------------------------------------------------- dates

internal object PlanDates {
    private val iso = Regex("\\d{4}-\\d{2}-\\d{2}")

    fun isIso(s: String?): Boolean = s != null && iso.matches(s)

    /** Lenient like JavaScript's Date: 2026-02-30 is 2 March. */
    fun parse(s: String): LocalDate {
        val parts = s.split("-")
        val y = parts.getOrNull(0)?.toIntOrNull() ?: 1970
        val m = parts.getOrNull(1)?.toIntOrNull()?.takeIf { it != 0 } ?: 1
        val d = parts.getOrNull(2)?.toIntOrNull()?.takeIf { it != 0 } ?: 1
        return LocalDate.of(y, 1, 1).plusMonths((m - 1).toLong()).plusDays((d - 1).toLong())
    }

    fun format(d: LocalDate): String = "%04d-%02d-%02d".format(java.util.Locale.ROOT, d.year, d.monthValue, d.dayOfMonth)
    fun today(now: LocalDate = LocalDate.now()): String = format(now)
    fun addDays(s: String, n: Int): String = format(parse(s).plusDays(n.toLong()))

    /** Jan 31 plus one month is the last day of February, not March 3. */
    fun addMonths(s: String, n: Int): String = format(parse(s).plusMonths(n.toLong()))

    /** 0 is Sunday, as in JavaScript. */
    fun weekday(s: String): Int = parse(s).dayOfWeek.value % 7
    fun startOfWeek(s: String, weekStart: Int = 0): String = addDays(s, -((weekday(s) - weekStart + 7) % 7))
    fun daysBetween(a: String, b: String): Int = ChronoUnit.DAYS.between(parse(a), parse(b)).toInt()
}

/** How a day is named relative to today: the desktop's relDay without the words. */
internal sealed interface DayLabel {
    data object Today : DayLabel
    data object Tomorrow : DayLabel
    data object Yesterday : DayLabel
    data class Weekday(val day: Int) : DayLabel
    data class Date(val date: String, val withYear: Boolean) : DayLabel
}

internal fun dayLabel(s: String, now: String): DayLabel {
    val diff = PlanDates.daysBetween(now, s)
    return when {
        diff == 0 -> DayLabel.Today
        diff == 1 -> DayLabel.Tomorrow
        diff == -1 -> DayLabel.Yesterday
        diff in 2..6 -> DayLabel.Weekday(PlanDates.weekday(s))
        else -> DayLabel.Date(s, PlanDates.parse(s).year != PlanDates.parse(now).year)
    }
}

internal data class Repeat(val every: Int, val unit: String)

internal fun nextRepeat(due: String, r: Repeat): String {
    val n = maxOf(1, r.every)
    return when (r.unit) {
        "month" -> PlanDates.addMonths(due, n)
        "week" -> PlanDates.addDays(due, 7 * n)
        else -> PlanDates.addDays(due, n)
    }
}

// ---------------------------------------------------------------- data

/** JavaScript truthiness for a JSON value. */
internal fun truthy(v: Any?): Boolean = when (v) {
    null, JSONObject.NULL -> false
    is Boolean -> v
    is Number -> v.toDouble().let { it != 0.0 && !it.isNaN() }
    is String -> v.isNotEmpty()
    else -> true
}

internal fun JSONObject.text(key: String): String? = if (isNull(key)) null else opt(key) as? String
internal fun JSONObject.number(key: String): Double? = if (isNull(key)) null else (opt(key) as? Number)?.toDouble()

/** One planning row: a resource and its kind's fields. Only planning kinds parse their metadata. */
internal data class PlanRow(
    val id: String, val title: String, val kind: String, val parentId: String?,
    val sortKey: Double, val createdAt: Long, val data: JSONObject,
) {
    val task by lazy { TaskData(data) }
    val event by lazy { EventData(data) }
    val assignment by lazy { AssignmentData(data) }
    val exam by lazy { ExamData(data) }
    val requirement by lazy { RequirementData(data) }
    val subject by lazy { SubjectData(data) }
    val lesson by lazy { LessonData(data) }
    val goal by lazy { GoalData(data) }

    companion object {
        fun of(r: Resource): PlanRow = PlanRow(r.id, r.title, r.kind, r.parentId, r.sortKey, r.createdAt, kindData(r.metadata, r.kind))
    }
}

/** The kind's own object inside a resource's metadata, or an empty one. */
internal fun kindData(metadata: String, kind: String): JSONObject {
    if (kind !in DATA_KINDS && !isPackKind(kind)) return JSONObject()
    return runCatching { JSONObject(metadata).optJSONObject(dataKeyOf(kind)) }.getOrNull() ?: JSONObject()
}

internal class TaskData(d: JSONObject) {
    val due = d.text("due")
    val time = d.text("time")
    val priority = (d.number("priority")?.toInt() ?: 0).coerceIn(0, 3)
    val done = truthy(d.opt("done"))
    val doneAt = d.number("doneAt")?.toLong()
    val someday = truthy(d.opt("someday"))
    val repeat = d.optJSONObject("repeat")?.let { r -> r.text("unit")?.let { Repeat(r.number("every")?.let { e -> Math.round(e).toInt() } ?: 1, it) } }
    val stepsTotal = d.optJSONArray("steps")?.length() ?: 0
}

internal class EventData(d: JSONObject) {
    val date = d.text("date")
    val start = d.text("start")
    val end = d.text("end")
    val allDay = truthy(d.opt("allDay"))
    val location = d.text("location")
    val weekly: List<Int> = d.optJSONArray("weekly")?.let { a -> (0 until a.length()).mapNotNull { (a.opt(it) as? Number)?.toInt() } }.orEmpty()
    val until = d.text("until")
    val skip: List<String> = d.optJSONArray("skip")?.let { a -> (0 until a.length()).mapNotNull { a.opt(it) as? String } }.orEmpty()
}

internal class AssignmentData(d: JSONObject) {
    val due = d.text("due")
    val time = d.text("time")
    val teacher = d.text("teacher")
    val points = d.number("points")
    val earned = d.number("earned")
    val instructions = d.text("instructions")
    val submitted = truthy(d.opt("submitted"))
}

internal class ExamData(d: JSONObject) {
    val date = d.text("date")
    val time = d.text("time")
    val scope = d.text("scope")
    val maxScore = d.number("maxScore")
    val score = d.number("score")
    val location = d.text("location")
}

internal class RequirementData(d: JSONObject) {
    val due = d.text("due")
    val ready = truthy(d.opt("ready"))
    val print = truthy(d.opt("print"))
}

internal class SubjectData(d: JSONObject) {
    val teacher = d.text("teacher")
    val room = d.text("room")
    val code = d.text("code")
    val color = d.text("color")
}

internal class LessonData(d: JSONObject) {
    val number = d.number("number")?.toInt()
    val taughtOn = d.text("taughtOn")
}

/** Builds the stored object for a new item. Null values are kept as JSON null, like the desktop. */
internal fun jsonOf(fields: Map<String, Any?>): JSONObject = JSONObject().also { o ->
    fields.forEach { (k, v) -> o.put(k, toJson(v)) }
}

private fun toJson(v: Any?): Any = when (v) {
    null -> JSONObject.NULL
    is Map<*, *> -> JSONObject().also { o -> v.forEach { (k, x) -> o.put(k.toString(), toJson(x)) } }
    is Iterable<*> -> JSONArray().also { a -> v.forEach { a.put(toJson(it)) } }
    else -> v
}

/** Metadata for a new resource of a planning kind: `{ "<kind>": { ... } }`. */
internal fun newKindMetadata(kind: String, fields: Map<String, Any?>): String = JSONObject().put(dataKeyOf(kind), jsonOf(fields)).toString()

/**
 * Merge a patch into `metadata.<kind>` and leave every other key alone, as the
 * desktop's updateData and set_page_meta do.
 */
internal fun mergeKindData(metadata: String, kind: String, patch: Map<String, Any?>): String =
    replaceKindData(metadata, kind) { current -> current.also { o -> patch.forEach { (k, v) -> o.put(k, toJson(v)) } } }

internal fun replaceKindData(metadata: String, kind: String, change: (JSONObject) -> JSONObject): String {
    require(kind in DATA_KINDS || isPackKind(kind))
    val key = dataKeyOf(kind)
    val root = runCatching { JSONObject(metadata) }.getOrElse { JSONObject() }
    val current = root.optJSONObject(key)?.let { JSONObject(it.toString()) } ?: JSONObject()
    return root.put(key, change(current)).toString()
}

/**
 * Tick a task. A repeating task moves to its next date and its steps reset
 * instead of being marked done, so it never has to be recreated.
 */
internal fun toggledTask(data: JSONObject, nowMillis: Long): JSONObject {
    val d = TaskData(data)
    val next = JSONObject(data.toString())
    val repeat = d.repeat
    if (!d.done && repeat != null && d.due != null) {
        next.put("due", nextRepeat(d.due, repeat))
        val steps = data.optJSONArray("steps")
        if (steps != null) next.put("steps", JSONArray().also { out ->
            for (i in 0 until steps.length()) out.put(steps.optJSONObject(i)?.let { JSONObject(it.toString()).put("done", false) } ?: steps.opt(i))
        })
        return next
    }
    next.put("done", !d.done)
    next.put("doneAt", if (d.done) JSONObject.NULL else nowMillis)
    return next
}

// ---------------------------------------------------------------- tasks

internal enum class TaskList { Today, Upcoming, All, Someday, Done }

private fun live(row: PlanRow, studyOn: Boolean) = studyOn || row.kind !in STUDY_KINDS

/** Overdue or due today, not done. */
internal fun isDueNow(d: TaskData, now: String): Boolean = !d.done && !d.someday && PlanDates.isIso(d.due) && d.due!! <= now

internal val taskOrder = Comparator<PlanRow> { a, b ->
    val da = a.task; val db = b.task
    val dueA = da.due ?: "9999-99-99"; val dueB = db.due ?: "9999-99-99"
    if (dueA != dueB) return@Comparator dueA.compareTo(dueB)
    val ta = da.time ?: "99:99"; val tb = db.time ?: "99:99"
    if (ta != tb) return@Comparator ta.compareTo(tb)
    if (da.priority != db.priority) return@Comparator db.priority - da.priority
    a.createdAt.compareTo(b.createdAt)
}

internal fun tasksFor(rows: List<PlanRow>, list: TaskList, now: String): List<PlanRow> {
    val all = rows.filter { it.kind == "task" }
    return when (list) {
        TaskList.Today -> all.filter { isDueNow(it.task, now) }.sortedWith(taskOrder)
        TaskList.Upcoming -> all.filter { val d = it.task; !d.done && !d.someday && PlanDates.isIso(d.due) && d.due!! > now }.sortedWith(taskOrder)
        TaskList.Someday -> all.filter { !it.task.done && it.task.someday }.sortedBy { it.createdAt }
        TaskList.Done -> all.filter { it.task.done }.sortedByDescending { it.task.doneAt ?: 0L }
        TaskList.All -> all.filter { !it.task.done && !it.task.someday }.sortedWith(taskOrder)
    }
}

internal enum class GroupKind { Overdue, Today, Day, Parent, NoParent, Someday, Done }

/** A titled run of rows. `day` is set for a day group, `parentId` for a project or subject group. */
internal data class TaskGroup(val kind: GroupKind, val items: List<PlanRow>, val day: String? = null, val parentId: String? = null)

/** The desktop's groupFor for the task lists. Groups are never empty. */
internal fun taskGroups(rows: List<PlanRow>, list: TaskList, now: String): List<TaskGroup> {
    val items = tasksFor(rows, list, now)
    if (items.isEmpty()) return emptyList()
    return when (list) {
        TaskList.Today -> {
            val overdue = items.filter { (it.task.due ?: now) < now }
            val due = items.filter { (it.task.due ?: now) >= now }
            listOfNotNull(overdue.takeIf { it.isNotEmpty() }?.let { TaskGroup(GroupKind.Overdue, it) }, due.takeIf { it.isNotEmpty() }?.let { TaskGroup(GroupKind.Today, it) })
        }
        TaskList.Upcoming -> items.groupBy { it.task.due!! }.map { (day, ps) -> TaskGroup(GroupKind.Day, ps, day = day) }
        TaskList.All -> {
            val byId = rows.associateBy { it.id }
            val by = LinkedHashMap<String, MutableList<PlanRow>>()
            for (p in items) by.getOrPut(if (p.parentId != null && byId.containsKey(p.parentId)) p.parentId else "") { mutableListOf() }.add(p)
            by.entries.sortedWith { (a, _), (b, _) ->
                when {
                    a == "" -> -1
                    b == "" -> 1
                    else -> byId.getValue(a).title.compareTo(byId.getValue(b).title, ignoreCase = true)
                }
            }.map { (k, ps) -> if (k == "") TaskGroup(GroupKind.NoParent, ps) else TaskGroup(GroupKind.Parent, ps, parentId = k) }
        }
        TaskList.Someday -> listOf(TaskGroup(GroupKind.Someday, items))
        TaskList.Done -> listOf(TaskGroup(GroupKind.Done, items))
    }
}

// ---------------------------------------------------------------- calendar

internal data class Occurrence(
    val key: String, val row: PlanRow, val kind: String, val date: String,
    val start: String?, val end: String?, val allDay: Boolean, val done: Boolean,
    /** A subject's colour name when the item belongs to one. */
    val color: String?,
)

/** Whether a (possibly repeating) event happens on `day`. */
internal fun eventOn(d: EventData, day: String): Boolean {
    val date = d.date
    if (!PlanDates.isIso(date)) return false
    if (d.weekly.isNotEmpty()) {
        if (day < date!!) return false
        if (PlanDates.isIso(d.until) && day > d.until!!) return false
        if (day in d.skip) return false
        return PlanDates.weekday(day) in d.weekly
    }
    return date == day
}

/** The subject a row belongs to (its nearest subject ancestor), if the Study pack is on. */
internal fun subjectOf(byId: Map<String, PlanRow>, row: PlanRow?, studyOn: Boolean): PlanRow? {
    var cur = row?.parentId?.let { byId[it] }
    var i = 0
    while (cur != null && i < 16) {
        if (cur.kind == "subject") return if (studyOn) cur else null
        cur = cur.parentId?.let { byId[it] }
        i++
    }
    return null
}

/** Everything dated between `from` and `to` (inclusive), in day and time order. */
internal fun occurrences(rows: List<PlanRow>, from: String, to: String, studyOn: Boolean, includeDone: Boolean = false): List<Occurrence> {
    val byId = rows.associateBy { it.id }
    val out = mutableListOf<Occurrence>()
    fun colorOf(p: PlanRow): String? = if (p.kind == "subject") p.subject.color else subjectOf(byId, p, studyOn)?.subject?.color
    fun push(p: PlanRow, kind: String, date: String, start: String?, end: String?, allDay: Boolean, done: Boolean) {
        if (date < from || date > to) return
        if (done && !includeDone) return
        out.add(Occurrence("${p.id}:$date", p, kind, date, start, end, allDay, done, colorOf(p)))
    }
    for (p in rows) {
        if (!live(p, studyOn)) continue
        when (p.kind) {
            "task" -> { val d = p.task; if (PlanDates.isIso(d.due) && !d.someday) push(p, "task", d.due!!, d.time, null, d.time == null, d.done) }
            "event" -> {
                val d = p.event
                if (!PlanDates.isIso(d.date)) continue
                if (d.weekly.isNotEmpty()) {
                    val span = minOf(PlanDates.daysBetween(from, to), 400)
                    for (i in 0..span) {
                        val day = PlanDates.addDays(from, i)
                        if (eventOn(d, day)) push(p, "event", day, d.start, d.end, d.allDay || d.start == null, false)
                    }
                } else push(p, "event", d.date!!, d.start, d.end, d.allDay || d.start == null, false)
            }
            "assignment" -> { val d = p.assignment; if (PlanDates.isIso(d.due)) push(p, "assignment", d.due!!, d.time, null, d.time == null, d.submitted) }
            "exam" -> { val d = p.exam; if (PlanDates.isIso(d.date)) push(p, "exam", d.date!!, d.time, null, d.time == null, false) }
            "requirement" -> { val d = p.requirement; if (PlanDates.isIso(d.due)) push(p, "requirement", d.due!!, null, null, true, d.ready) }
        }
    }
    return out.sortedWith(compareBy<Occurrence> { it.date }.thenBy { it.start ?: "" })
}

/** The end of a one hour event that starts at `start`, as the desktop's calendar quick add does. */
internal fun hourAfter(start: String): String = "%02d%s".format(java.util.Locale.ROOT, minOf(23, (start.take(2).toIntOrNull() ?: 0) + 1), start.drop(2))

// ---------------------------------------------------------------- study

/** Assignments, exams and things to bring that are still open, soonest first. */
internal fun openStudyWork(rows: List<PlanRow>, now: String, horizonDays: Int = 14): List<Occurrence> =
    occurrences(rows, PlanDates.addDays(now, -60), PlanDates.addDays(now, horizonDays), studyOn = true)
        .filter { (it.kind == "assignment" || it.kind == "exam" || it.kind == "requirement") && (it.kind != "exam" || it.date >= now) }

internal fun subjects(rows: List<PlanRow>): List<PlanRow> =
    rows.filter { it.kind == "subject" }.sortedWith(compareBy<PlanRow> { it.sortKey }.thenBy { it.createdAt })

/** Direct children of a subject, of one kind. */
internal fun inSubject(rows: List<PlanRow>, subjectId: String, kind: String): List<PlanRow> = rows.filter { it.parentId == subjectId && it.kind == kind }

internal fun subjectAssignments(rows: List<PlanRow>, subjectId: String) = inSubject(rows, subjectId, "assignment").sortedBy { it.assignment.due ?: "9" }
internal fun subjectExams(rows: List<PlanRow>, subjectId: String) = inSubject(rows, subjectId, "exam").sortedBy { it.exam.date ?: "9" }

/** Lessons newest first: by the day taught, then by when they were made. */
internal fun subjectLessons(rows: List<PlanRow>, subjectId: String) =
    inSubject(rows, subjectId, "lesson").sortedWith(compareByDescending<PlanRow> { it.lesson.taughtOn ?: "" }.thenByDescending { it.createdAt })

/** The next colour for a new subject, cycling through the desktop's list. */
internal fun nextSubjectColor(rows: List<PlanRow>): String = SUBJECT_COLORS[subjects(rows).size % SUBJECT_COLORS.size].first

/** The subject's next exam day from today on, if any. */
internal fun nextExam(rows: List<PlanRow>, subjectId: String, now: String): String? =
    inSubject(rows, subjectId, "exam").mapNotNull { it.exam.date }.filter { it.isNotEmpty() && it >= now }.minOrNull()

/** Open work under a subject: assignments not handed in and things not ready. */
internal fun openCount(rows: List<PlanRow>, subjectId: String): Int =
    inSubject(rows, subjectId, "assignment").count { !it.assignment.submitted } + inSubject(rows, subjectId, "requirement").count { !it.requirement.ready }

// ---------------------------------------------------------------- goals

/** A step or milestone, as the desktop stores it in `steps`. */
internal data class Step(val id: String, val text: String, val done: Boolean)

internal fun stepsOf(d: JSONObject): List<Step> = d.optJSONArray("steps")?.let { a ->
    (0 until a.length()).mapNotNull { i -> a.optJSONObject(i)?.let { s -> Step(s.text("id").orEmpty(), s.text("text").orEmpty(), truthy(s.opt("done"))) } }
}.orEmpty()

internal class GoalData(d: JSONObject) {
    val detail = d.text("detail")
    val target = d.text("target")
    val steps = stepsOf(d)
    /** Manual progress 0..1, used when there are no steps. */
    val progress = d.number("progress")
}

/** The desktop's goalFraction: done steps over all steps, or the manual value when there are none. */
internal fun goalFraction(d: GoalData): Double {
    if (d.steps.isNotEmpty()) return d.steps.count { it.done }.toDouble() / d.steps.size
    val p = d.progress ?: 0.0
    return if (p.isNaN()) 0.0 else p.coerceIn(0.0, 1.0)
}

/** Whole percent, rounded like JavaScript's Math.round. */
internal fun goalPercent(d: GoalData): Int = Math.round(goalFraction(d) * 100).toInt()

/** Goals by target day (none last), then by when they were made, as the desktop's goalsFor. */
internal fun goalsFor(rows: List<PlanRow>): List<PlanRow> =
    rows.filter { it.kind == "goal" }.sortedWith(compareBy<PlanRow> { it.goal.target ?: "9999-99-99" }.thenBy { it.createdAt })

/**
 * Tasks linked to a goal are filed under it, the same parent link the
 * desktop's All list groups by. Open ones first, in the usual order.
 */
internal fun goalTasks(rows: List<PlanRow>, goalId: String): List<PlanRow> =
    rows.filter { it.kind == "task" && it.parentId == goalId }.sortedWith(compareBy<PlanRow> { it.task.done }.then(taskOrder))

/** Open tasks that could be linked to the goal: not done and not already under it. */
internal fun linkableTasks(rows: List<PlanRow>, goalId: String): List<PlanRow> =
    rows.filter { it.kind == "task" && it.parentId != goalId && !it.task.done }.sortedWith(taskOrder)

private const val STEP_ID_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz"

/** "s" and seven base 36 characters, like the desktop's newStepId. */
internal fun newStepId(random: kotlin.random.Random = kotlin.random.Random.Default): String =
    "s" + (1..7).map { STEP_ID_CHARS[random.nextInt(STEP_ID_CHARS.length)] }.joinToString("")

private fun copyOf(o: JSONObject) = JSONObject(o.toString())

private fun stepsArray(data: JSONObject): JSONArray = data.optJSONArray("steps") ?: JSONArray()

/** Add a step at the end. Blank text adds nothing. */
internal fun withStepAdded(data: JSONObject, id: String, text: String): JSONObject {
    val clean = text.trim()
    val next = copyOf(data)
    if (clean.isEmpty()) return next
    val steps = JSONArray(stepsArray(next).toString()).put(JSONObject().put("id", id).put("text", clean).put("done", false))
    return next.put("steps", steps)
}

/** Tick or untick one step, keeping any other field it has. */
internal fun withStepToggled(data: JSONObject, id: String): JSONObject {
    val next = copyOf(data)
    val steps = stepsArray(next)
    val out = JSONArray()
    for (i in 0 until steps.length()) {
        val s = steps.optJSONObject(i)
        out.put(if (s != null && s.text("id") == id) copyOf(s).put("done", !truthy(s.opt("done"))) else steps.opt(i))
    }
    return next.put("steps", out)
}

internal fun withStepRemoved(data: JSONObject, id: String): JSONObject {
    val next = copyOf(data)
    val steps = stepsArray(next)
    val out = JSONArray()
    for (i in 0 until steps.length()) {
        val s = steps.optJSONObject(i)
        if (s == null || s.text("id") != id) out.put(steps.opt(i))
    }
    return next.put("steps", out)
}

// ---------------------------------------------------------------- inbox

/** Captures, newest first, as the desktop's Inbox lists them. */
internal fun inboxItems(rows: List<PlanRow>): List<PlanRow> = rows.filter { it.kind == "inbox" }.sortedByDescending { it.createdAt }

/** The desktop sidebar's badges: tasks due today or overdue, then captures waiting in Inbox. */
internal fun planningBadges(resources: List<Resource>, now: String = PlanDates.today()): Pair<Int, Int> {
    val rows = resources.filter { it.kind == "task" || it.kind == "inbox" }.map { PlanRow.of(it) }
    return tasksFor(rows, TaskList.Today, now).size to rows.count { it.kind == "inbox" }
}

/** What a capture can become. Assignment and Requirement need the Study pack and a subject. */
internal enum class CaptureTarget { Task, Event, Page, Assignment, Requirement }

/** A new resource to create in place of a capture: its kind, title and metadata. */
internal data class Conversion(val kind: String, val title: String, val metadata: String)

/**
 * The desktop's InboxRow actions: a task or an event reads dates and times
 * out of the words with quick add; a page and study items keep the words as
 * they are, and study items take the date quick add finds.
 */
internal fun convertCapture(title: String, target: CaptureTarget, now: LocalDateTime): Conversion {
    val q = QuickAdd.parse(title, now)
    val parsedTitle = q.title.ifEmpty { title }
    return when (target) {
        CaptureTarget.Task -> Conversion("task", parsedTitle, newKindMetadata("task", mapOf("due" to q.due, "time" to q.time, "priority" to q.priority)))
        CaptureTarget.Event -> Conversion("event", parsedTitle,
            newKindMetadata("event", mapOf("date" to (q.due ?: PlanDates.today(now.toLocalDate())), "start" to q.time, "allDay" to (q.time == null))))
        CaptureTarget.Page -> Conversion("page", title, "{}")
        CaptureTarget.Assignment -> Conversion("assignment", title, newKindMetadata("assignment", mapOf("due" to q.due)))
        CaptureTarget.Requirement -> Conversion("requirement", title, newKindMetadata("requirement", mapOf("due" to q.due)))
    }
}

// ---------------------------------------------------------------- week

internal const val DAY_MINUTES = 24 * 60

/** The shortest block the grid draws, so short items stay tappable. Overlaps are worked out at this size too. */
internal const val MIN_BLOCK_MINUTES = 30

private val HHMM = Regex("(\\d{1,2}):(\\d{2})")

/** Minutes after midnight for "HH:MM", or null when it is not a time of day. */
internal fun minutesOf(t: String?): Int? {
    val m = t?.let { HHMM.matchEntire(it.trim()) } ?: return null
    val h = m.groupValues[1].toInt()
    val min = m.groupValues[2].toInt()
    return if (h > 23 || min > 59) null else h * 60 + min
}

/** How long something with a start and no end lasts on the grid: an hour for events, half an hour for the rest. */
internal fun defaultLength(kind: String): Int = if (kind == "event") 60 else MIN_BLOCK_MINUTES

/** One timed item in a day column. Items that overlap share the width in `lanes` columns. */
internal data class WeekBlock(val occurrence: Occurrence, val start: Int, val end: Int, val lane: Int, val lanes: Int)

/** A day of the week grid: all day items for the strip on top, timed ones placed by time. */
internal data class WeekDay(val date: String, val allDay: List<Occurrence>, val timed: List<WeekBlock>)

/** The seven days of the week holding `anchor`. */
internal fun weekDates(anchor: String, weekStart: Int = 0): List<String> {
    val from = PlanDates.startOfWeek(anchor, weekStart)
    return (0..6).map { PlanDates.addDays(from, it) }
}

/** Splits one day's items into all day ones and timed blocks with overlap lanes. */
internal fun layoutDay(date: String, items: List<Occurrence>): WeekDay {
    val allDay = mutableListOf<Occurrence>()
    val timed = mutableListOf<Triple<Occurrence, Int, Int>>()
    for (o in items) {
        val start = if (o.allDay) null else minutesOf(o.start)
        if (start == null) { allDay.add(o); continue }
        val end = minutesOf(o.end)?.takeIf { it > start } ?: minOf(DAY_MINUTES, start + defaultLength(o.kind))
        timed.add(Triple(o, start, end))
    }
    val sorted = timed.sortedWith(compareBy<Triple<Occurrence, Int, Int>> { it.second }.thenByDescending { it.third - it.second }.thenBy { it.first.key })
    val blocks = mutableListOf<WeekBlock>()
    val cluster = mutableListOf<WeekBlock>()
    val laneEnds = mutableListOf<Int>()
    var clusterEnd = -1
    fun flush() {
        cluster.forEach { blocks.add(it.copy(lanes = laneEnds.size)) }
        cluster.clear()
        laneEnds.clear()
    }
    for ((o, start, end) in sorted) {
        val reach = maxOf(end, start + MIN_BLOCK_MINUTES)
        if (cluster.isNotEmpty() && start >= clusterEnd) flush()
        var lane = laneEnds.indexOfFirst { it <= start }
        if (lane < 0) { lane = laneEnds.size; laneEnds.add(reach) } else laneEnds[lane] = reach
        cluster.add(WeekBlock(o, start, end, lane, 0))
        clusterEnd = maxOf(clusterEnd, reach)
    }
    flush()
    return WeekDay(date, allDay, blocks)
}

/** The week holding `anchor`, day by day, with everything dated in it including what is done. */
internal fun weekLayout(rows: List<PlanRow>, anchor: String, studyOn: Boolean, weekStart: Int = 0): List<WeekDay> {
    val days = weekDates(anchor, weekStart)
    val byDay = occurrences(rows, days.first(), days.last(), studyOn, includeDone = true).groupBy { it.date }
    return days.map { layoutDay(it, byDay[it].orEmpty()) }
}

/**
 * The hours the grid shows: 07:00 to 22:00, stretched to fit anything earlier
 * or later, so a quiet week stays compact and nothing is ever cut off.
 */
internal fun weekHours(days: List<WeekDay>, first: Int = 7, last: Int = 22): IntRange {
    val blocks = days.flatMap { it.timed }
    val from = minOf(first, blocks.minOfOrNull { it.start / 60 } ?: first)
    val to = maxOf(last, blocks.maxOfOrNull { (maxOf(it.end, it.start + MIN_BLOCK_MINUTES) + 59) / 60 } ?: last).coerceAtMost(24)
    return from until to
}

/** Start and end for an event made by tapping an empty hour: that hour, one hour long, ending by midnight. */
internal fun slotTimes(hour: Int): Pair<String, String> {
    val h = hour.coerceIn(0, 23)
    val start = "%02d:00".format(java.util.Locale.ROOT, h)
    return start to if (h == 23) "23:59" else hourAfter(start)
}
