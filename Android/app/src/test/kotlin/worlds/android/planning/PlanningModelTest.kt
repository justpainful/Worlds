package worlds.android.planning

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime

/** Mirrors the desktop's src/planning/model.test.ts, so both apps read the same files the same way. */
class PlanningModelTest {
    // Wednesday 11 November 2026, 10:00 local.
    private val now = LocalDateTime.of(2026, 11, 11, 10, 0)
    private val today = "2026-11-11"

    private var seq = 0
    private fun row(kind: String, data: String = "{}", parentId: String? = null): PlanRow {
        seq++
        return PlanRow("p$seq", "$kind $seq", kind, parentId, seq.toDouble(), seq.toLong(), JSONObject(data))
    }

    private fun parse(text: String) = QuickAdd.parse(text, now)

    // ------------------------------------------------------------ quick add

    @Test fun quickAddTakesDatesTimesAndPriorityOutOfTheTitle() {
        assertEquals(QuickAddResult("Call the bank", "2026-11-12", "16:00", 2), parse("Call the bank tomorrow 4pm !!"))
        parse("Pay rent today").let { assertEquals("Pay rent", it.title); assertEquals("2026-11-11", it.due); assertNull(it.time) }
        parse("Standup at 9:30").let { assertEquals("Standup", it.title); assertEquals("2026-11-12", it.due); assertEquals("09:30", it.time) }
        parse("Review deck sunday").let { assertEquals("Review deck", it.title); assertEquals("2026-11-15", it.due) }
        parse("Renew passport in 3 days !1").let { assertEquals("Renew passport", it.title); assertEquals("2026-11-14", it.due); assertEquals(1, it.priority) }
        parse("Invoice 5/12").let { assertEquals("Invoice", it.title); assertEquals("2026-12-05", it.due) }
    }

    @Test fun quickAddUnderstandsArabic() {
        parse("أراجع العرض بكرة").let { assertEquals("أراجع العرض", it.title); assertEquals("2026-11-12", it.due) }
        parse("اجتماع الفريق الخميس الساعة 5 مساء").let { assertEquals("اجتماع الفريق", it.title); assertEquals("2026-11-12", it.due); assertEquals("17:00", it.time) }
        parse("حل الواجب اليوم").let { assertEquals("حل الواجب", it.title); assertEquals("2026-11-11", it.due) }
    }

    @Test fun quickAddLeavesOrdinaryWordsAlone() {
        assertEquals("Read Morning by Alex", parse("Read Monday Morning by Alex").title)
        assertEquals(QuickAddResult("Buy 3 apples", null, null, 0), parse("Buy 3 apples"))
    }

    @Test fun quickAddReadsMorePhrases() {
        parse("Dinner tonight").let { assertEquals("Dinner", it.title); assertEquals(today, it.due); assertEquals("20:00", it.time) }
        parse("Dinner tonight 7pm").let { assertEquals(today, it.due); assertEquals("19:00", it.time) }
        parse("Call mum at 11").let { assertEquals("Call mum", it.title); assertEquals(today, it.due); assertEquals("11:00", it.time) }
        parse("Pitch next week !!!").let { assertEquals("Pitch", it.title); assertEquals("2026-11-18", it.due); assertEquals(3, it.priority) }
        parse("Report in 2 weeks").let { assertEquals("Report", it.title); assertEquals("2026-11-25", it.due) }
        parse("Trip 2027-01-04").let { assertEquals("Trip", it.title); assertEquals("2027-01-04", it.due) }
        // A day and month already past this year means next year.
        parse("Renew 3/2").let { assertEquals("Renew", it.title); assertEquals("2027-02-03", it.due) }
        // The same weekday as today means next week, not today.
        parse("Gym wednesday").let { assertEquals("2026-11-18", it.due) }
        // 12am is midnight and 12pm is noon.
        assertEquals("00:00", parse("x 12am").time)
        assertEquals("12:00", parse("x 12pm").time)
        // Out of range times are left in the title.
        parse("Room 25:00").let { assertEquals("Room 25:00", it.title); assertNull(it.time) }
        parse("بعد 3 أيام مراجعة").let { assertEquals("مراجعة", it.title); assertEquals("2026-11-14", it.due) }
        parse("درس 9 صباحا").let { assertEquals("درس", it.title); assertEquals("09:00", it.time); assertEquals("2026-11-12", it.due) }
    }

    @Test fun clockFieldsAcceptTypedTimes() {
        assertEquals("09:00", QuickAdd.clock("9"))
        assertEquals("09:30", QuickAdd.clock("9:30"))
        assertEquals("16:00", QuickAdd.clock("4pm"))
        assertEquals("16:05", QuickAdd.clock(" 16:05 "))
        assertEquals("16:00", QuickAdd.clock("4 مساء"))
        assertNull(QuickAdd.clock("25:00"))
        assertNull(QuickAdd.clock("soon"))
    }

    // ------------------------------------------------------------ dates and repeats

    @Test fun addsMonthsWithoutOverflowingShortMonths() {
        assertEquals("2026-02-28", PlanDates.addMonths("2026-01-31", 1))
        assertEquals("2026-11-25", nextRepeat("2026-11-11", Repeat(2, "week")))
        assertEquals("2026-11-12", nextRepeat("2026-11-11", Repeat(0, "day")))
    }

    @Test fun startsWeeksOnTheChosenDay() {
        assertEquals("2026-11-08", PlanDates.startOfWeek("2026-11-11", 0))
        assertEquals("2026-11-07", PlanDates.startOfWeek("2026-11-11", 6))
        assertEquals(3, PlanDates.weekday("2026-11-11"))
    }

    @Test fun readsDatesLenientlyLikeJavaScript() {
        assertEquals("2026-03-02", PlanDates.format(PlanDates.parse("2026-02-30")))
        assertTrue(PlanDates.isIso("2026-11-11"))
        assertFalse(PlanDates.isIso("2026-11-11\n"))
        assertFalse(PlanDates.isIso("11/11/2026"))
    }

    @Test fun namesDaysRelativeToToday() {
        assertEquals(DayLabel.Today, dayLabel(today, today))
        assertEquals(DayLabel.Tomorrow, dayLabel("2026-11-12", today))
        assertEquals(DayLabel.Yesterday, dayLabel("2026-11-10", today))
        assertEquals(DayLabel.Weekday(0), dayLabel("2026-11-15", today))
        assertEquals(DayLabel.Date("2026-11-20", false), dayLabel("2026-11-20", today))
        assertEquals(DayLabel.Date("2027-01-20", true), dayLabel("2027-01-20", today))
    }

    @Test fun repeatsWeeklyEventsUntilTheirEndSkippingCancelledDays() {
        val d = EventData(JSONObject("""{"date":"2026-09-06","weekly":[0,2],"until":"2026-12-31","skip":["2026-11-15"]}"""))
        assertTrue(eventOn(d, "2026-11-10"))
        assertFalse(eventOn(d, "2026-11-15"))
        assertFalse(eventOn(d, "2026-11-11"))
        assertFalse(eventOn(d, "2027-01-03"))
        assertFalse(eventOn(d, "2026-09-01"))
    }

    // ------------------------------------------------------------ lists and calendar

    @Test fun sortsTasksIntoSmartLists() {
        val overdue = row("task", """{"due":"2026-11-09"}""")
        val todayTask = row("task", """{"due":"2026-11-11","priority":3}""")
        val later = row("task", """{"due":"2026-11-20"}""")
        val someday = row("task", """{"someday":true}""")
        val done = row("task", """{"due":"2026-11-10","done":true,"doneAt":5}""")
        val undated = row("task", """{"due":null}""")
        val rows = listOf(overdue, todayTask, later, someday, done, undated, row("page"))

        assertEquals(listOf(overdue.id, todayTask.id), tasksFor(rows, TaskList.Today, today).map { it.id })
        assertEquals(listOf(later.id), tasksFor(rows, TaskList.Upcoming, today).map { it.id })
        assertEquals(listOf(someday.id), tasksFor(rows, TaskList.Someday, today).map { it.id })
        assertEquals(listOf(done.id), tasksFor(rows, TaskList.Done, today).map { it.id })
        assertEquals(listOf(overdue.id, todayTask.id, later.id, undated.id), tasksFor(rows, TaskList.All, today).map { it.id })
    }

    @Test fun ordersTasksByDayThenTimeThenPriority() {
        val late = row("task", """{"due":"2026-11-11","time":"18:00"}""")
        val low = row("task", """{"due":"2026-11-11","priority":1}""")
        val high = row("task", """{"due":"2026-11-11","priority":3}""")
        val early = row("task", """{"due":"2026-11-11","time":"08:00"}""")
        assertEquals(listOf(early.id, late.id, high.id, low.id), tasksFor(listOf(late, low, high, early), TaskList.Today, today).map { it.id })
    }

    @Test fun groupsTasksIntoSections() {
        val overdue = row("task", """{"due":"2026-11-09"}""")
        val todayTask = row("task", """{"due":"2026-11-11"}""")
        val friday = row("task", """{"due":"2026-11-13"}""")
        val friday2 = row("task", """{"due":"2026-11-13"}""")
        val monday = row("task", """{"due":"2026-11-16"}""")
        val project = row("project")
        val inProject = row("task", """{"due":"2026-11-30"}""", parentId = project.id)
        val rows = listOf(overdue, todayTask, friday, friday2, monday, project, inProject)

        val todayGroups = taskGroups(rows, TaskList.Today, today)
        assertEquals(listOf(GroupKind.Overdue, GroupKind.Today), todayGroups.map { it.kind })
        assertEquals(listOf(overdue.id), todayGroups[0].items.map { it.id })

        val upcoming = taskGroups(rows, TaskList.Upcoming, today)
        assertEquals(listOf("2026-11-13", "2026-11-16", "2026-11-30"), upcoming.map { it.day })
        assertEquals(2, upcoming[0].items.size)

        val all = taskGroups(rows, TaskList.All, today)
        assertEquals(listOf(GroupKind.NoParent, GroupKind.Parent), all.map { it.kind })
        assertEquals(project.id, all[1].parentId)

        assertTrue(taskGroups(rows, TaskList.Done, today).isEmpty())
    }

    @Test fun keepsStudyPackItemsOutWhileThePackIsOff() {
        val todayTask = row("task", """{"due":"2026-11-11","priority":3}""")
        val subject = row("subject", """{"color":"green"}""")
        val exam = row("exam", """{"date":"2026-11-12"}""", parentId = subject.id)
        val cls = row("event", """{"date":"2026-09-06","start":"08:00","weekly":[4]}""", parentId = subject.id)
        val all = listOf(subject, exam, cls, todayTask)

        var occ = occurrences(all, "2026-11-11", "2026-11-12", studyOn = false)
        assertEquals(listOf("task", "event"), occ.map { it.kind })
        // The class still shows (events are for everyone) but has no subject colour while Study is off.
        assertNull(occ[1].color)

        occ = occurrences(all, "2026-11-11", "2026-11-12", studyOn = true)
        assertEquals(listOf("event", "exam", "task"), occ.map { it.kind }.sorted())
        assertEquals("green", occ.first { it.kind == "event" }.color)
    }

    @Test fun listsEverythingDatedInARange() {
        val event = row("event", """{"date":"2026-11-12","start":"14:00","end":"15:00"}""")
        val morning = row("event", """{"date":"2026-11-12","start":"09:00"}""")
        val allDay = row("event", """{"date":"2026-11-12","allDay":true}""")
        val outside = row("event", """{"date":"2026-12-25"}""")
        val doneTask = row("task", """{"due":"2026-11-12","done":true}""")
        val somedayTask = row("task", """{"due":"2026-11-12","someday":true}""")
        val rows = listOf(event, morning, allDay, outside, doneTask, somedayTask)

        val occ = occurrences(rows, today, "2026-11-20", studyOn = false)
        assertEquals(listOf(allDay.id, morning.id, event.id), occ.map { it.row.id })
        assertTrue(occ[0].allDay)
        assertEquals("15:00", occ[2].end)
        assertEquals(4, occurrences(rows, today, "2026-11-20", studyOn = false, includeDone = true).size)
    }

    @Test fun expandsRepeatingEventsIntoEachDay() {
        val cls = row("event", """{"date":"2026-11-01","start":"08:00","weekly":[0,3]}""")
        val occ = occurrences(listOf(cls), "2026-11-08", "2026-11-21", studyOn = false)
        assertEquals(listOf("2026-11-08", "2026-11-11", "2026-11-15", "2026-11-18"), occ.map { it.date })
        assertEquals(listOf("${cls.id}:2026-11-08", "${cls.id}:2026-11-11"), occ.take(2).map { it.key })
    }

    @Test fun collectsOpenStudyWork() {
        val subject = row("subject", """{"color":"blue"}""")
        val lateWork = row("assignment", """{"due":"2026-11-01"}""", parentId = subject.id)
        val handedIn = row("assignment", """{"due":"2026-11-12","submitted":true}""", parentId = subject.id)
        val pastExam = row("exam", """{"date":"2026-11-02"}""", parentId = subject.id)
        val exam = row("exam", """{"date":"2026-11-20"}""", parentId = subject.id)
        val farExam = row("exam", """{"date":"2027-02-01"}""", parentId = subject.id)
        val rows = listOf(subject, lateWork, handedIn, pastExam, exam, farExam)

        assertEquals(listOf(lateWork.id, exam.id), openStudyWork(rows, today).map { it.row.id })
        assertEquals("blue", openStudyWork(rows, today).first().color)
        assertEquals(1, openCount(rows, subject.id))
        assertEquals("2026-11-20", nextExam(rows, subject.id, today))
        assertEquals(listOf(lateWork.id, handedIn.id), subjectAssignments(rows, subject.id).map { it.id })
    }

    @Test fun ordersSubjectsAndLessons() {
        val a = row("subject")
        val b = row("subject")
        val first = row("lesson", """{"taughtOn":"2026-11-01","number":1}""", parentId = a.id)
        val second = row("lesson", """{"taughtOn":"2026-11-08","number":2}""", parentId = a.id)
        val rows = listOf(b.copy(sortKey = 0.5), a, first, second)
        assertEquals(listOf(b.id, a.id), subjects(rows).map { it.id })
        assertEquals(listOf(second.id, first.id), subjectLessons(rows, a.id).map { it.id })
        // The desktop's colour order, starting again after the last one.
        assertEquals("yellow", nextSubjectColor(rows + row("subject")))
    }

    @Test fun findsTheNearestSubjectAncestor() {
        val subject = row("subject", """{"color":"red"}""")
        val folder = row("page", parentId = subject.id)
        val task = row("task", parentId = folder.id)
        val byId = listOf(subject, folder, task).associateBy { it.id }
        assertEquals(subject.id, subjectOf(byId, task, true)?.id)
        assertNull(subjectOf(byId, task, false))
    }

    // ------------------------------------------------------------ stored shape

    @Test fun mergesIntoTheKindObjectAndKeepsEverythingElse() {
        val metadata = """{"task":{"due":"2026-11-11","steps":[{"id":"s1","text":"a","done":false}],"notes":"keep"},"properties":[{"name":"x"}]}"""
        val merged = JSONObject(mergeKindData(metadata, "task", mapOf("due" to null, "priority" to 2)))
        val task = merged.getJSONObject("task")
        assertTrue(task.isNull("due"))
        assertTrue(task.has("due"))
        assertEquals(2, task.getInt("priority"))
        assertEquals("keep", task.getString("notes"))
        assertEquals(1, task.getJSONArray("steps").length())
        assertEquals("x", merged.getJSONArray("properties").getJSONObject(0).getString("name"))
    }

    @Test fun writesNewItemsInTheDesktopShape() {
        val created = JSONObject(newKindMetadata("task", mapOf("due" to "2026-11-11", "time" to null, "priority" to 0, "someday" to false)))
        assertEquals(setOf("task"), created.keys().asSequence().toSet())
        val task = created.getJSONObject("task")
        assertEquals("2026-11-11", task.getString("due"))
        assertTrue(task.has("time") && task.isNull("time"))
        assertFalse(task.getBoolean("someday"))
        val event = JSONObject(newKindMetadata("event", mapOf("weekly" to listOf(0, 2)))).getJSONObject("event")
        assertEquals(JSONArray("[0,2]").toString(), event.getJSONArray("weekly").toString())
        assertEquals(0, kindData("not json", "task").length())
        assertEquals(0, kindData("""{"task":{"due":"2026-11-11"}}""", "page").length())
        assertEquals("2026-11-11", kindData("""{"task":{"due":"2026-11-11"}}""", "task").getString("due"))
    }

    @Test fun ticksTasksAndMovesRepeatingOnes() {
        val done = toggledTask(JSONObject("""{"due":"2026-11-11"}"""), 42L)
        assertTrue(done.getBoolean("done"))
        assertEquals(42L, done.getLong("doneAt"))
        val undone = toggledTask(done, 50L)
        assertFalse(undone.getBoolean("done"))
        assertTrue(undone.isNull("doneAt"))

        val repeating = toggledTask(JSONObject("""{"due":"2026-11-11","repeat":{"every":1,"unit":"week"},"steps":[{"id":"s1","text":"a","done":true}]}"""), 42L)
        assertEquals("2026-11-18", repeating.getString("due"))
        assertFalse(repeating.has("done"))
        assertFalse(repeating.getJSONArray("steps").getJSONObject(0).getBoolean("done"))
    }

    @Test fun readsDesktopValuesLikeJavaScript() {
        val d = TaskData(JSONObject("""{"done":1,"someday":"","priority":2.0,"due":null}"""))
        assertTrue(d.done)
        assertFalse(d.someday)
        assertEquals(2, d.priority)
        assertNull(d.due)
        assertEquals("09:00", hourAfter("08:00"))
        assertEquals("23:30", hourAfter("23:30"))
    }
}
