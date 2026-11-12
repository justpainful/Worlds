package worlds.android.planning

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import worlds.content.Resource
import java.time.LocalDateTime
import kotlin.random.Random

/**
 * Goals, Inbox and the Calendar week grid, following the desktop's
 * src/planning/model.ts (goalFraction, goalsFor), InboxView.tsx (what a
 * capture becomes) and CalendarView.tsx (the week from startOfWeek).
 */
class PlanningExtrasTest {
    // Wednesday 11 November 2026, 10:00 local, as in the desktop's model.test.ts.
    private val now = LocalDateTime.of(2026, 11, 11, 10, 0)
    private val today = "2026-11-11"

    private var seq = 0
    private fun row(kind: String, data: String = "{}", parentId: String? = null, title: String? = null): PlanRow {
        seq++
        return PlanRow("p$seq", title ?: "$kind $seq", kind, parentId, seq.toDouble(), seq.toLong(), JSONObject(data))
    }

    private fun resource(kind: String, metadata: String = "{}"): Resource {
        seq++
        return Resource("r$seq", "$kind $seq", kind, null, seq.toDouble(), metadata, "[]", 1L, null, seq.toLong(), seq.toLong())
    }

    // ------------------------------------------------------------ goals

    @Test fun goalProgressComesFromStepsWhenThereAreAny() {
        val steps = GoalData(JSONObject("""{"steps":[{"id":"a","text":"one","done":true},{"id":"b","text":"two","done":false},{"id":"c","text":"three","done":false}],"progress":0.9}"""))
        assertEquals(1.0 / 3, goalFraction(steps), 1e-9)
        assertEquals(33, goalPercent(steps))
        val twoOfThree = GoalData(JSONObject("""{"steps":[{"id":"a","text":"","done":true},{"id":"b","text":"","done":1},{"id":"c","text":"","done":false}]}"""))
        assertEquals(67, goalPercent(twoOfThree))
    }

    @Test fun goalProgressFallsBackToTheManualValueClamped() {
        assertEquals(0.42, goalFraction(GoalData(JSONObject("""{"progress":0.42,"steps":[]}"""))), 1e-9)
        assertEquals(42, goalPercent(GoalData(JSONObject("""{"progress":0.42}"""))))
        assertEquals(1.0, goalFraction(GoalData(JSONObject("""{"progress":3}"""))), 1e-9)
        assertEquals(0.0, goalFraction(GoalData(JSONObject("""{"progress":-1}"""))), 1e-9)
        assertEquals(0.0, goalFraction(GoalData(JSONObject("{}"))), 1e-9)
        // Half a percent rounds up, like Math.round in JavaScript.
        assertEquals(1, goalPercent(GoalData(JSONObject("""{"progress":0.005}"""))))
    }

    @Test fun listsGoalsByTargetThenAge() {
        val late = row("goal", """{"target":"2027-01-01"}""")
        val none = row("goal", "{}")
        val soon = row("goal", """{"target":"2026-12-01"}""")
        val soonToo = row("goal", """{"target":"2026-12-01"}""")
        val task = row("task", """{"due":"2026-11-11"}""")
        assertEquals(listOf(soon.id, soonToo.id, late.id, none.id), goalsFor(listOf(late, none, soon, soonToo, task)).map { it.id })
    }

    @Test fun linksTasksByFilingThemUnderTheGoal() {
        val goal = row("goal")
        val done = row("task", """{"due":"2026-11-09","done":true}""", parentId = goal.id)
        val later = row("task", """{"due":"2026-11-20"}""", parentId = goal.id)
        val sooner = row("task", """{"due":"2026-11-12"}""", parentId = goal.id)
        val free = row("task", """{"due":"2026-11-13"}""")
        val finished = row("task", """{"done":true}""")
        val rows = listOf(goal, done, later, sooner, free, finished)
        assertEquals(listOf(sooner.id, later.id, done.id), goalTasks(rows, goal.id).map { it.id })
        assertEquals(listOf(free.id), linkableTasks(rows, goal.id).map { it.id })
        // Linked tasks do not change the desktop's progress, which comes from steps or the manual value.
        assertEquals(0, goalPercent(goal.goal))
    }

    @Test fun editsStepsAndKeepsEverythingElse() {
        val start = JSONObject("""{"target":"2026-12-01","steps":[{"id":"s1","text":"Draft","done":false,"note":"keep"}],"detail":"why"}""")
        val added = withStepAdded(start, "s2", "  Review  ")
        assertEquals(listOf(Step("s1", "Draft", false), Step("s2", "Review", false)), stepsOf(added))
        assertEquals("why", added.getString("detail"))
        assertEquals(1, start.getJSONArray("steps").length())
        assertEquals(1, stepsOf(withStepAdded(start, "s3", "   ")).size)

        val ticked = withStepToggled(added, "s1")
        assertTrue(stepsOf(ticked).first { it.id == "s1" }.done)
        assertEquals("keep", ticked.getJSONArray("steps").getJSONObject(0).getString("note"))
        assertFalse(stepsOf(withStepToggled(ticked, "s1")).first { it.id == "s1" }.done)
        assertEquals(50, goalPercent(GoalData(ticked)))

        val removed = withStepRemoved(ticked, "s1")
        assertEquals(listOf("s2"), stepsOf(removed).map { it.id })
        assertEquals("2026-12-01", removed.getString("target"))
        assertEquals(listOf(Step("x", "first", false)), stepsOf(withStepAdded(JSONObject("{}"), "x", "first")))
    }

    @Test fun makesStepIdsLikeTheDesktop() {
        val id = newStepId(Random(7))
        assertTrue(id, Regex("s[0-9a-z]{7}").matches(id))
    }

    // ------------------------------------------------------------ inbox

    @Test fun listsCapturesNewestFirst() {
        val a = row("inbox")
        val task = row("task")
        val b = row("inbox")
        assertEquals(listOf(b.id, a.id), inboxItems(listOf(a, task, b)).map { it.id })
    }

    @Test fun turnsACaptureIntoATaskWithQuickAdd() {
        val c = convertCapture("Call the bank tomorrow 4pm !!", CaptureTarget.Task, now)
        assertEquals("task", c.kind)
        assertEquals("Call the bank", c.title)
        val task = JSONObject(c.metadata).getJSONObject("task")
        assertEquals("2026-11-12", task.getString("due"))
        assertEquals("16:00", task.getString("time"))
        assertEquals(2, task.getInt("priority"))
        // Words that are all date keep the capture's own words as the title.
        assertEquals("tomorrow", convertCapture("tomorrow", CaptureTarget.Task, now).title)
        val plain = JSONObject(convertCapture("Buy 3 apples", CaptureTarget.Task, now).metadata).getJSONObject("task")
        assertTrue(plain.isNull("due") && plain.has("due"))
        assertEquals(0, plain.getInt("priority"))
    }

    @Test fun turnsACaptureIntoAnEventOnItsDayOrToday() {
        val timed = convertCapture("Team sync thursday 10am", CaptureTarget.Event, now)
        assertEquals("Team sync", timed.title)
        val event = JSONObject(timed.metadata).getJSONObject("event")
        assertEquals("2026-11-12", event.getString("date"))
        assertEquals("10:00", event.getString("start"))
        assertFalse(event.getBoolean("allDay"))
        val untimed = JSONObject(convertCapture("Dentist", CaptureTarget.Event, now).metadata).getJSONObject("event")
        assertEquals(today, untimed.getString("date"))
        assertTrue(untimed.isNull("start"))
        assertTrue(untimed.getBoolean("allDay"))
    }

    @Test fun turnsACaptureIntoAPageOrStudyItemKeepingItsWords() {
        val page = convertCapture("Ideas for the trip tomorrow", CaptureTarget.Page, now)
        assertEquals(Conversion("page", "Ideas for the trip tomorrow", "{}"), page)
        val assignment = convertCapture("Lab report sunday", CaptureTarget.Assignment, now)
        assertEquals("assignment", assignment.kind)
        assertEquals("Lab report sunday", assignment.title)
        assertEquals("2026-11-15", JSONObject(assignment.metadata).getJSONObject("assignment").getString("due"))
        val bring = convertCapture("Calculator", CaptureTarget.Requirement, now)
        assertEquals(setOf("requirement"), JSONObject(bring.metadata).keys().asSequence().toSet())
        assertTrue(JSONObject(bring.metadata).getJSONObject("requirement").isNull("due"))
    }

    @Test fun countsTheSidebarBadges() {
        val resources = listOf(
            resource("task", """{"task":{"due":"2026-11-10"}}"""),
            resource("task", """{"task":{"due":"2026-11-11"}}"""),
            resource("task", """{"task":{"due":"2026-11-12"}}"""),
            resource("task", """{"task":{"due":"2026-11-11","done":true}}"""),
            resource("inbox", """{"inbox":{}}"""),
            resource("inbox", """{"inbox":{}}"""),
            resource("page"),
        )
        assertEquals(2 to 2, planningBadges(resources, today))
        assertEquals(0 to 0, planningBadges(emptyList(), today))
    }

    // ------------------------------------------------------------ week

    @Test fun readsTimesOfDay() {
        assertEquals(545, minutesOf("9:05"))
        assertEquals(0, minutesOf("00:00"))
        assertEquals(23 * 60 + 59, minutesOf("23:59"))
        assertNull(minutesOf("24:00"))
        assertNull(minutesOf("soon"))
        assertNull(minutesOf(null))
    }

    @Test fun weeksStartOnSundayLikeTheDesktopDefault() {
        assertEquals(listOf("2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"), weekDates(today))
        assertEquals("2026-11-07", weekDates(today, weekStart = 6).first())
    }

    @Test fun placesItemsByTimeWithAllDayOnTop() {
        val a = row("event", """{"date":"2026-11-11","start":"09:00","end":"10:00"}""")
        val b = row("event", """{"date":"2026-11-11","start":"09:30","end":"11:00"}""")
        val c = row("event", """{"date":"2026-11-11","start":"10:00"}""")
        val d = row("event", """{"date":"2026-11-11","start":"13:00","end":"14:00"}""")
        val early = row("task", """{"due":"2026-11-11","time":"08:00"}""")
        val allDay = row("event", """{"date":"2026-11-11","allDay":true,"start":"09:00"}""")
        val noStart = row("event", """{"date":"2026-11-11"}""")
        val untimedTask = row("task", """{"due":"2026-11-11"}""")
        val doneTask = row("task", """{"due":"2026-11-11","time":"18:00","done":true}""")
        val weekly = row("event", """{"date":"2026-09-07","start":"08:00","end":"09:00","weekly":[1]}""")
        val nextWeek = row("event", """{"date":"2026-11-15","start":"09:00"}""")
        val days = weekLayout(listOf(a, b, c, d, early, allDay, noStart, untimedTask, doneTask, weekly, nextWeek), today, studyOn = false)

        assertEquals(7, days.size)
        val wed = days[3]
        assertEquals(today, wed.date)
        assertEquals(setOf(allDay.id, noStart.id, untimedTask.id), wed.allDay.map { it.row.id }.toSet())
        val blocks = wed.timed.associateBy { it.occurrence.row.id }
        // A task with a time is half an hour, an event without an end an hour.
        assertEquals(480 to 510, blocks.getValue(early.id).let { it.start to it.end })
        assertEquals(600 to 660, blocks.getValue(c.id).let { it.start to it.end })
        // a, b and c overlap, so they share two lanes; c takes a's lane once a ends.
        assertEquals(listOf(0, 1, 0), listOf(a, b, c).map { blocks.getValue(it.id).lane })
        assertEquals(listOf(2, 2, 2), listOf(a, b, c).map { blocks.getValue(it.id).lanes })
        assertEquals(1, blocks.getValue(d.id).lanes)
        assertEquals(1, blocks.getValue(early.id).lanes)
        // Done items stay on the grid, as on the desktop.
        assertTrue(blocks.getValue(doneTask.id).occurrence.done)
        // Repeating events land on their weekday only.
        assertEquals(listOf("2026-11-09"), days.filter { day -> day.timed.any { it.occurrence.row.id == weekly.id } }.map { it.date })
        assertTrue(days.none { day -> day.timed.any { it.occurrence.row.id == nextWeek.id } })
    }

    @Test fun keepsShortAndBackwardsItemsVisible() {
        val short = row("event", """{"date":"2026-11-11","start":"09:00","end":"09:10"}""")
        val next = row("event", """{"date":"2026-11-11","start":"09:20","end":"09:40"}""")
        val backwards = row("event", """{"date":"2026-11-11","start":"22:00","end":"01:00"}""")
        val day = weekLayout(listOf(short, next, backwards), today, studyOn = false)[3]
        val blocks = day.timed.associateBy { it.occurrence.row.id }
        // Drawn at least half an hour tall, so the next one moves to its own lane.
        assertEquals(1, blocks.getValue(next.id).lane)
        assertEquals(2, blocks.getValue(short.id).lanes)
        // An end before the start is read as no end.
        assertEquals(22 * 60 + 60, blocks.getValue(backwards.id).end)
    }

    @Test fun showsTheWorkingDayAndStretchesForEarlierOrLaterItems() {
        assertEquals(7 until 22, weekHours(weekLayout(emptyList(), today, studyOn = false)))
        val early = row("event", """{"date":"2026-11-11","start":"06:30","end":"07:30"}""")
        val late = row("event", """{"date":"2026-11-12","start":"22:30","end":"23:30"}""")
        val evening = row("event", """{"date":"2026-11-12","start":"21:00","end":"22:00"}""")
        assertEquals(6 until 24, weekHours(weekLayout(listOf(early, late), today, studyOn = false)))
        assertEquals(7 until 22, weekHours(weekLayout(listOf(evening), today, studyOn = false)))
    }

    @Test fun makesAnHourLongEventFromAnEmptySlot() {
        assertEquals("09:00" to "10:00", slotTimes(9))
        assertEquals("00:00" to "01:00", slotTimes(0))
        assertEquals("23:00" to "23:59", slotTimes(23))
    }
}
