package worlds.android.planning

import java.time.LocalDateTime
import java.util.Locale

/**
 * Quick add: "Call the bank tomorrow 4pm !!" becomes a title, a due date, a
 * time and a priority. A faithful port of the desktop's src/planning/quickAdd.ts:
 * words it understands are taken out of the title, anything else stays exactly
 * as typed, and Arabic and English both work.
 */
internal data class QuickAddResult(val title: String, val due: String?, val time: String?, val priority: Int)

internal object QuickAdd {
    /** JavaScript's `\s`, which also covers no break and other Unicode spaces. */
    private const val S = "[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]"
    private val I = setOf(RegexOption.IGNORE_CASE)

    private val DAYS = mapOf(
        "sun" to 0, "sunday" to 0, "الأحد" to 0, "الاحد" to 0, "احد" to 0,
        "mon" to 1, "monday" to 1, "الاثنين" to 1, "الإثنين" to 1, "اثنين" to 1,
        "tue" to 2, "tues" to 2, "tuesday" to 2, "الثلاثاء" to 2, "ثلاثاء" to 2,
        "wed" to 3, "wednesday" to 3, "الأربعاء" to 3, "الاربعاء" to 3, "اربعاء" to 3,
        "thu" to 4, "thur" to 4, "thurs" to 4, "thursday" to 4, "الخميس" to 4, "خميس" to 4,
        "fri" to 5, "friday" to 5, "الجمعة" to 5, "جمعة" to 5,
        "sat" to 6, "saturday" to 6, "السبت" to 6, "سبت" to 6,
    )

    private val PRIORITY_NUMBER = Regex("$S!([1-3])(?=$S)")
    private val PRIORITY_MARKS = Regex("$S(!{1,3})(?=$S)")
    private val CLOCK = Regex("$S(?:at$S+|@|الساعة$S+)?(\\d{1,2}):(\\d{2})$S*(am|pm|a|p|ص|م)?(?=$S)", I)
    private val HOUR_MERIDIEM = Regex("$S(?:at$S+|@|الساعة$S+)?(\\d{1,2})$S*(am|pm|ص|م|مساء|مساءً|صباحا|صباحًا)(?=$S)", I)
    private val AT_HOUR = Regex("$S(?:at|الساعة)$S+(\\d{1,2})(?=$S)", I)
    private val TODAY = Regex("$S(today|tod|اليوم)(?=$S)", I)
    private val TONIGHT = Regex("$S(tonight|الليلة)(?=$S)", I)
    private val TOMORROW = Regex("$S(tomorrow|tmr|tmrw|بكرة|بكره|غدا|غدًا|غداً)(?=$S)", I)
    private val AFTER_TOMORROW = Regex("$S(?:after tomorrow|بعد بكرة|بعد بكره|بعد غد)(?=$S)", I)
    private val NEXT_WEEK = Regex("$S(?:next week|الأسبوع الجاي|الاسبوع الجاي|الأسبوع القادم)(?=$S)", I)
    private val IN_DAYS = Regex("$S(?:in$S+(\\d{1,3})$S+(day|days|week|weeks)|بعد$S+(\\d{1,3})$S+(يوم|أيام|ايام|أسبوع|اسبوع|أسابيع))(?=$S)", I)
    private val WEEK_UNIT = Regex("week|سبوع|سابيع")
    private val WEEKDAY = Regex("$S(?:on$S+|next$S+|يوم$S+)?([A-Za-z]{3,9}|[\\u0600-\\u06FF]{3,9})(?=$S)")
    private val ISO_DATE = Regex("$S(\\d{4})-(\\d{2})-(\\d{2})(?=$S)")
    private val DAY_MONTH = Regex("$S(\\d{1,2})/(\\d{1,2})(?=$S)")
    private val PM = Regex("pm|p|م|مساء|مساءً|العصر|الليل", I)
    private val SPACES = Regex("$S+")

    private fun pad(n: Int) = "%02d".format(Locale.ROOT, n)

    private fun nextWeekday(from: String, day: Int): String {
        val diff = ((day - PlanDates.weekday(from) + 7) % 7).let { if (it == 0) 7 else it }
        return PlanDates.addDays(from, diff)
    }

    /** 24 hour "HH:MM", or null when the hour or minute is out of range. */
    fun to24(hour: Int, minute: Int, ampm: String?): String? {
        var h = hour
        if (!ampm.isNullOrEmpty()) {
            val pm = PM.matches(ampm)
            h = when {
                h == 12 -> if (pm) 12 else 0
                pm -> h + 12
                else -> h
            }
        }
        if (h > 23 || minute > 59) return null
        return "${pad(h)}:${pad(minute)}"
    }

    fun parse(input: String, now: LocalDateTime = LocalDateTime.now()): QuickAddResult {
        val base = PlanDates.today(now.toLocalDate())
        var text = " ${input.trim()} "
        var due: String? = null
        var time: String? = null
        var priority = 0

        fun take(re: Regex, fn: (MatchResult) -> Boolean) {
            val m = re.find(text) ?: return
            if (!fn(m)) return
            text = text.replaceFirst(m.value, " ")
        }
        fun group(m: MatchResult, i: Int): String? = m.groups[i]?.value

        // Priority: !, !!, !!! or !1..!3
        take(PRIORITY_NUMBER) { priority = it.groupValues[1].toInt(); true }
        if (priority == 0) take(PRIORITY_MARKS) { priority = it.groupValues[1].length; true }

        // Time: "at 5pm", "5:30pm", "17:00", "الساعة 5 مساء"
        take(CLOCK) { m -> to24(m.groupValues[1].toInt(), m.groupValues[2].toInt(), group(m, 3))?.also { time = it } != null }
        if (time == null) take(HOUR_MERIDIEM) { m ->
            val word = m.groupValues[2]
            to24(m.groupValues[1].toInt(), 0, if (word.startsWith("صباح")) "am" else word)?.also { time = it } != null
        }
        if (time == null) take(AT_HOUR) { m -> to24(m.groupValues[1].toInt(), 0, null)?.also { time = it } != null }

        // Dates
        take(TODAY) { due = base; true }
        if (due == null) take(TONIGHT) { due = base; if (time == null) time = "20:00"; true }
        if (due == null) take(TOMORROW) { due = PlanDates.addDays(base, 1); true }
        if (due == null) take(AFTER_TOMORROW) { due = PlanDates.addDays(base, 2); true }
        if (due == null) take(NEXT_WEEK) { due = PlanDates.addDays(base, 7); true }
        if (due == null) take(IN_DAYS) { m ->
            val n = (group(m, 1) ?: group(m, 3))!!.toInt()
            val unit = (group(m, 2) ?: group(m, 4))!!.lowercase(Locale.ROOT)
            due = PlanDates.addDays(base, if (WEEK_UNIT.containsMatchIn(unit)) n * 7 else n)
            true
        }
        if (due == null) {
            // A weekday anywhere in the text: "review deck sunday", "on Mon", "يوم الخميس".
            for (m in WEEKDAY.findAll(text)) {
                val day = DAYS[m.groupValues[1].lowercase(Locale.ROOT)] ?: continue
                due = nextWeekday(base, day)
                text = text.replaceFirst(m.value, " ")
                break
            }
        }
        if (due == null) take(ISO_DATE) { m -> due = "${m.groupValues[1]}-${m.groupValues[2]}-${m.groupValues[3]}"; true }
        if (due == null) take(DAY_MONTH) { m ->
            // Day/month, the way most of the world writes it.
            val d = m.groupValues[1].toInt()
            val mo = m.groupValues[2].toInt()
            if (d == 0 || mo == 0 || d > 31 || mo > 12) return@take false
            val y = now.year
            var iso = "$y-${pad(mo)}-${pad(d)}"
            if (iso < base) iso = "${y + 1}-${iso.substring(5)}"
            due = iso
            true
        }

        // A time on its own means today, or tomorrow if that time has passed.
        val at = time
        if (at != null && due == null) {
            val nowHM = "${pad(now.hour)}:${pad(now.minute)}"
            due = if (at > nowHM) base else PlanDates.addDays(base, 1)
        }

        return QuickAddResult(text.replace(SPACES, " ").trim(), due, time, priority)
    }

    private val CLOCK_INPUT = Regex("(\\d{1,2})(?::(\\d{2}))?$S*(am|pm|a|p|ص|م|مساء|مساءً|صباحا|صباحًا)?", I)

    /** A time typed into a field: "9", "9:30", "4pm", "16:00" or "4 مساء". Null when it is not a time. */
    fun clock(input: String): String? {
        val m = CLOCK_INPUT.matchEntire(input.trim()) ?: return null
        val word = m.groups[3]?.value
        return to24(m.groupValues[1].toInt(), m.groups[2]?.value?.toInt() ?: 0, if (word != null && word.startsWith("صباح")) "am" else word)
    }
}
