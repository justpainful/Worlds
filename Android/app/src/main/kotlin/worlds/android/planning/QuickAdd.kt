package worlds.android.planning

import java.time.LocalDateTime
import java.util.Locale

/**
 * Quick add: "Call the bank tomorrow 4pm !!" becomes a title, a due date, a
 * time and a priority. A faithful port of the desktop's src/planning/quickAdd.ts:
 * words it understands are taken out of the title, anything else stays exactly
 * as typed, and Arabic and English both work, with Western or Arabic digits.
 */
internal data class QuickAddResult(val title: String, val due: String?, val time: String?, val priority: Int)

internal object QuickAdd {
    /** JavaScript's `\s`, which also covers no break and other Unicode spaces. */
    private const val S = "[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]"
    /** A digit, Western or Arabic ("٥" and "۵" are 5). */
    private const val N = "[0-9\\u0660-\\u0669\\u06F0-\\u06F9]"
    private val I = setOf(RegexOption.IGNORE_CASE)

    // Morning, afternoon and evening words, with and without tanween.
    private const val AM = "am|a\\.m\\.|ص|صباحا|صباحًا|صباحاً|صباح|الصبح|الصباح|فجرا|فجراً|الفجر"
    private const val PM_WORDS = "pm|p\\.m\\.|م|مساء|مساءً|مساءا|المساء|العصر|عصرا|عصراً|الليل|ليلا|ليلاً|بالليل"
    private const val NOON = "ظهرا|ظهرًا|ظهراً|الظهر"

    private val DAYS = mapOf(
        "sun" to 0, "sunday" to 0, "الأحد" to 0, "الاحد" to 0, "احد" to 0,
        "mon" to 1, "monday" to 1, "الاثنين" to 1, "الإثنين" to 1, "اثنين" to 1,
        "tue" to 2, "tues" to 2, "tuesday" to 2, "الثلاثاء" to 2, "ثلاثاء" to 2,
        "wed" to 3, "wednesday" to 3, "الأربعاء" to 3, "الاربعاء" to 3, "اربعاء" to 3,
        "thu" to 4, "thur" to 4, "thurs" to 4, "thursday" to 4, "الخميس" to 4, "خميس" to 4,
        "fri" to 5, "friday" to 5, "الجمعة" to 5, "جمعة" to 5, "الجمعه" to 5,
        "sat" to 6, "saturday" to 6, "السبت" to 6, "سبت" to 6,
    )

    private val MONTHS = mapOf(
        "jan" to 1, "january" to 1, "يناير" to 1,
        "feb" to 2, "february" to 2, "فبراير" to 2,
        "mar" to 3, "march" to 3, "مارس" to 3,
        "apr" to 4, "april" to 4, "أبريل" to 4, "ابريل" to 4, "إبريل" to 4,
        "may" to 5, "مايو" to 5,
        "jun" to 6, "june" to 6, "يونيو" to 6, "يونيه" to 6,
        "jul" to 7, "july" to 7, "يوليو" to 7, "يوليه" to 7,
        "aug" to 8, "august" to 8, "أغسطس" to 8, "اغسطس" to 8,
        "sep" to 9, "sept" to 9, "september" to 9, "سبتمبر" to 9,
        "oct" to 10, "october" to 10, "أكتوبر" to 10, "اكتوبر" to 10,
        "nov" to 11, "november" to 11, "نوفمبر" to 11,
        "dec" to 12, "december" to 12, "ديسمبر" to 12,
    )

    private val LEAD = "$S(?:at$S+|@|الساعة$S+|الساعه$S+)?"
    private const val WEEKDAY_NAMES = "(?:ال)?(?:أحد|احد|اثنين|إثنين|ثلاثاء|أربعاء|اربعاء|خميس|جمعة|سبت)"
    private const val MONTH = "([A-Za-z]{3,9}|[\\u0600-\\u06FF]{3,7})"

    private val PRIORITY_NUMBER = Regex("$S!([1-3])(?=$S)")
    private val PRIORITY_MARKS = Regex("$S(!{1,3})(?=$S)")
    private val CLOCK = Regex("$LEAD($N{1,2})[:\\u066B]($N{2})$S*($AM|$PM_WORDS|$NOON|a|p)?(?=$S)", I)
    private val HOUR_MERIDIEM = Regex("$LEAD($N{1,2})$S*($AM|$PM_WORDS|$NOON)(?=$S)", I)
    private val AT_HOUR = Regex("$S(?:at|الساعة|الساعه)$S+($N{1,2})(?=$S)", I)
    private val TODAY = Regex("$S(today|tod|اليوم)(?=$S)", I)
    private val TONIGHT = Regex("$S(?:tonight|الليلة|الليله)(?:$S+(?:at$S+|الساعة$S+)?($N{1,2}))?(?=$S)", I)
    private val AFTER_TOMORROW = Regex("$S(?:after tomorrow|بعد بكرة|بعد بكره|بعد بكرا|بعد غد|بعد الغد)(?=$S)", I)
    private val TOMORROW = Regex("$S(tomorrow|tmr|tmrw|بكرة|بكره|بكرا|غدا|غدًا|غداً)(?=$S)", I)
    private val NEXT_WEEK = Regex("$S(?:next week|(?:الأسبوع|الاسبوع)$S+(?:الجاي|القادم|المقبل))(?=$S)", I)
    private val IN_DAYS = Regex("$S(?:in$S+($N{1,3})$S+(day|days|week|weeks)|بعد$S+($N{1,3})$S+(يوم|أيام|ايام|أسبوع|اسبوع|أسابيع|اسابيع))(?=$S)", I)
    private val IN_WORDS = Regex("$S(?:in$S+a$S+(day|week)|بعد$S+(يوم|يومين|أسبوع|اسبوع|أسبوعين|اسبوعين))(?=$S)(?!$S+$WEEKDAY_NAMES)", I)
    private val WORD_DAYS = mapOf("day" to 1, "week" to 7, "يوم" to 1, "يومين" to 2, "أسبوع" to 7, "اسبوع" to 7, "أسبوعين" to 14, "اسبوعين" to 14)
    private val WEEK_UNIT = Regex("week|سبوع|سابيع")
    private val WEEKDAY = Regex("$S(?:(on|next|يوم)$S+)?([A-Za-z]{3,9}|[\\u0600-\\u06FF]{3,9})(?:$S+(القادم|القادمة|الجاي|الجاية|المقبل|المقبلة))?(?=$S)", I)
    private val DAY_MONTH_NAME = Regex("$S($N{1,2})$S+$MONTH(?:$S+($N{4}))?(?=$S)", I)
    private val MONTH_NAME_DAY = Regex("$S$MONTH$S+($N{1,2})(?:,?$S+($N{4}))?(?=$S)", I)
    private val ISO_DATE = Regex("$S($N{4})-($N{2})-($N{2})(?=$S)")
    private val DAY_MONTH = Regex("$S($N{1,2})/($N{1,2})(?=$S)")
    private val PM = Regex("p|$PM_WORDS", I)
    private val NOON_WORD = Regex(NOON)
    private val SPACES = Regex("$S+")

    private fun pad(n: Int) = "%02d".format(Locale.ROOT, n)

    /** "٥" and "۵" count as 5. */
    private fun num(s: String): Int = s.map { c ->
        when (c) {
            in '٠'..'٩' -> '0' + (c - '٠')
            in '۰'..'۹' -> '0' + (c - '۰')
            else -> c
        }
    }.joinToString("").toInt()

    /** 24 hour "HH:MM", or null when the hour or minute is out of range. */
    fun to24(hour: Int, minute: Int, ampm: String?): String? {
        var h = hour
        if (!ampm.isNullOrEmpty()) {
            val word = ampm.lowercase(Locale.ROOT)
            val pm = PM.matches(word)
            h = when {
                NOON_WORD.matches(word) -> if (h >= 11) h else h + 12
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
        val nowHM = "${pad(now.hour)}:${pad(now.minute)}"
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

        // Time: "at 5pm", "5:30pm", "17:00", "الساعة 5 مساء", "٥:٣٠ م"
        take(CLOCK) { m -> to24(num(m.groupValues[1]), num(m.groupValues[2]), group(m, 3))?.also { time = it } != null }
        if (time == null) take(HOUR_MERIDIEM) { m -> to24(num(m.groupValues[1]), 0, m.groupValues[2])?.also { time = it } != null }
        if (time == null) take(AT_HOUR) { m -> to24(num(m.groupValues[1]), 0, null)?.also { time = it } != null }

        // Dates
        take(TODAY) { due = base; true }
        if (due == null) take(TONIGHT) { m ->
            due = base
            // "الليلة 9" is nine in the evening.
            val hour = group(m, 1)?.let { num(it) }
            if (time == null && hour != null && hour in 1..11) time = to24(hour, 0, "pm")
            if (time == null) time = "20:00"
            true
        }
        if (due == null) take(AFTER_TOMORROW) { due = PlanDates.addDays(base, 2); true }
        if (due == null) take(TOMORROW) { due = PlanDates.addDays(base, 1); true }
        if (due == null) take(NEXT_WEEK) { due = PlanDates.addDays(base, 7); true }
        if (due == null) take(IN_DAYS) { m ->
            val n = num((group(m, 1) ?: group(m, 3))!!)
            val unit = (group(m, 2) ?: group(m, 4))!!.lowercase(Locale.ROOT)
            due = PlanDates.addDays(base, if (WEEK_UNIT.containsMatchIn(unit)) n * 7 else n)
            true
        }
        if (due == null) take(IN_WORDS) { m ->
            val unit = (group(m, 1) ?: group(m, 2))!!.lowercase(Locale.ROOT)
            due = PlanDates.addDays(base, WORD_DAYS.getValue(unit))
            true
        }
        if (due == null) {
            // A weekday anywhere in the text: "review deck sunday", "on Mon", "يوم الخميس", "الأحد الجاي".
            for (m in WEEKDAY.findAll(text)) {
                val day = DAYS[m.groupValues[2].lowercase(Locale.ROOT)] ?: continue
                val next = group(m, 1)?.lowercase(Locale.ROOT) == "next" || group(m, 3) != null
                var diff = (day - PlanDates.weekday(base) + 7) % 7
                // Today's own weekday means next week, unless a time later today is given:
                // "meeting Thursday 5 pm" typed on Thursday morning is this afternoon.
                val at = time
                if (diff == 0 && (next || at == null || at <= nowHM)) diff = 7
                due = PlanDates.addDays(base, diff)
                text = text.replaceFirst(m.value, " ")
                break
            }
        }
        if (due == null) {
            // "15 نوفمبر", "Nov 15", "15 Nov 2027". Every number in the text is tried.
            fun dated(d: Int, mo: Int, y: Int?): Boolean {
                if (d == 0 || d > 31) return false
                var iso = "${y ?: now.year}-${pad(mo)}-${pad(d)}"
                if (y == null && iso < base) iso = "${now.year + 1}-${iso.substring(5)}"
                due = iso
                return true
            }
            val forms = listOf(
                DAY_MONTH_NAME to { m: MatchResult -> Triple(m.groupValues[1], m.groupValues[2], group(m, 3)) },
                MONTH_NAME_DAY to { m: MatchResult -> Triple(m.groupValues[2], m.groupValues[1], group(m, 3)) },
            )
            loop@ for ((pattern, parts) in forms) {
                for (m in pattern.findAll(text)) {
                    val (d, name, y) = parts(m)
                    val mo = MONTHS[name.lowercase(Locale.ROOT)] ?: continue
                    if (!dated(num(d), mo, y?.let { num(it) })) continue
                    text = text.replaceFirst(m.value, " ")
                    break@loop
                }
            }
        }
        if (due == null) take(ISO_DATE) { m -> due = "${num(m.groupValues[1])}-${pad(num(m.groupValues[2]))}-${pad(num(m.groupValues[3]))}"; true }
        if (due == null) take(DAY_MONTH) { m ->
            // Day/month, the way most of the world writes it.
            val d = num(m.groupValues[1])
            val mo = num(m.groupValues[2])
            if (d == 0 || mo == 0 || d > 31 || mo > 12) return@take false
            val y = now.year
            var iso = "$y-${pad(mo)}-${pad(d)}"
            if (iso < base) iso = "${y + 1}-${iso.substring(5)}"
            due = iso
            true
        }

        // A time on its own means today, or tomorrow if that time has passed.
        val at = time
        if (at != null && due == null) due = if (at > nowHM) base else PlanDates.addDays(base, 1)

        return QuickAddResult(text.replace(SPACES, " ").trim(), due, time, priority)
    }

    private val CLOCK_INPUT = Regex("($N{1,2})(?:[:\\u066B]($N{2}))?$S*($AM|$PM_WORDS|$NOON|a|p)?", I)

    /** A time typed into a field: "9", "9:30", "4pm", "16:00", "4 مساء" or "٤ م". Null when it is not a time. */
    fun clock(input: String): String? {
        val m = CLOCK_INPUT.matchEntire(input.trim()) ?: return null
        return to24(num(m.groupValues[1]), m.groups[2]?.value?.let { num(it) } ?: 0, m.groups[3]?.value)
    }
}
