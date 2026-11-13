package worlds.android.planning

import org.json.JSONArray
import org.json.JSONObject

/*
 * A pack's conditions, figures and alerts, ported from the desktop's
 * src/packs/rules.ts so both apps count the same items the same way.
 * Today's date is passed in, as on desktop, so nothing depends on the clock
 * by accident. Weeks start on Saturday, as in Saudi Arabia.
 */

internal data class PackCondition(
    val field: String,
    val inValues: List<Any?>?,
    val notIn: List<Any?>?,
    val empty: Boolean?,
    val overdue: Boolean?,
    val within: Int?,
    val period: String?,
    val atMostNumber: Double?,
    val atMostField: String?,
    val clashesOn: List<String>?,
) {
    companion object {
        fun parse(o: JSONObject): PackCondition {
            fun list(key: String): List<Any?>? = o.optJSONArray(key)?.let { a -> (0 until a.length()).map { if (a.isNull(it)) null else a.get(it) } }
            val atMost = if (o.has("atMost") && !o.isNull("atMost")) o.get("atMost") else null
            return PackCondition(
                field = o.getString("field"),
                inValues = list("in"),
                notIn = list("notIn"),
                empty = if (o.has("empty")) o.getBoolean("empty") else null,
                overdue = if (o.has("overdue")) o.getBoolean("overdue") else null,
                within = if (o.has("within")) o.getInt("within") else null,
                period = if (o.has("period")) o.getString("period") else null,
                atMostNumber = (atMost as? Number)?.toDouble(),
                atMostField = atMost as? String,
                clashesOn = list("clashesOn")?.map { it.toString() },
            )
        }

        fun parseAll(a: JSONArray?): List<PackCondition> = if (a == null) emptyList() else (0 until a.length()).map { parse(a.getJSONObject(it)) }
    }
}

internal data class PackStat(val label: Both, val kind: String, val agg: String, val field: String?, val where: List<PackCondition>)
internal data class PackAlert(val label: Both, val kind: String, val where: List<PackCondition>)
internal data class PackPrompt(val label: Both, val prompt: Both)

internal object PackRules {
    private fun value(data: JSONObject, key: String): Any? = if (!data.has(key) || data.isNull(key)) null else data.get(key)
    private fun isEmpty(v: Any?) = v == null || v == "" || (v is JSONArray && v.length() == 0)
    private fun same(a: Any?, b: Any?): Boolean = when {
        a is Number && b is Number -> a.toDouble() == b.toDouble()
        else -> a == b
    }

    fun weekStart(today: String): String {
        // Saturday is the first day: java's Monday=1 .. Sunday=7, so Saturday (6) goes back 0 days.
        val dow = java.time.LocalDate.parse(today).dayOfWeek.value
        return PlanDates.addDays(today, -((dow + 1) % 7))
    }

    /** Whether one item's fields pass a condition (the clash test needs the other items: see [filter]). */
    fun matches(c: PackCondition, data: JSONObject, today: String): Boolean {
        val v = value(data, c.field)
        if (c.empty != null && isEmpty(v) != c.empty) return false
        // A checkbox that was never ticked counts as false.
        val checked = if (v == null && (c.inValues?.contains(false) == true || c.notIn?.contains(false) == true)) false else v
        if (c.inValues != null && c.inValues.none { same(it, checked) }) return false
        if (c.notIn != null && c.notIn.any { same(it, checked) }) return false
        if (c.overdue != null || c.within != null || c.period != null) {
            val day = v as? String ?: return false
            if (!PlanDates.isIso(day)) return false
            if (c.overdue != null && (day < today) != c.overdue) return false
            if (c.within != null && (day < today || day > PlanDates.addDays(today, c.within))) return false
            if (c.period == "month" && day.take(7) != today.take(7)) return false
            if (c.period == "week") {
                val start = weekStart(today)
                if (day < start || day > PlanDates.addDays(start, 6)) return false
            }
        }
        if (c.atMostNumber != null || c.atMostField != null) {
            val n = (v as? Number)?.toDouble() ?: return false
            val limit = c.atMostNumber ?: (value(data, c.atMostField!!) as? Number)?.toDouble() ?: return false
            if (n > limit) return false
        }
        return true
    }

    /** Rows that pass every condition, including clashes with each other (a double booking). */
    fun filter(rows: List<PlanRow>, where: List<PackCondition>, today: String): List<PlanRow> {
        var list = rows.filter { r -> where.all { matches(it, r.data, today) } }
        for (c in where) {
            val others = c.clashesOn ?: continue
            val fields = listOf(c.field) + others
            fun key(r: PlanRow): String? = if (fields.any { isEmpty(value(r.data, it)) }) null else fields.joinToString("|#|") { value(r.data, it).toString() }
            val counts = rows.mapNotNull { key(it) }.groupingBy { it }.eachCount()
            list = list.filter { r -> key(r)?.let { (counts[it] ?: 0) > 1 } == true }
        }
        return list
    }

    fun sum(rows: List<PlanRow>, field: String): Double = Math.round(rows.sumOf { (value(it.data, field) as? Number)?.toDouble() ?: 0.0 } * 100) / 100.0

    fun average(rows: List<PlanRow>, field: String): Double? {
        val nums = rows.mapNotNull { (value(it.data, field) as? Number)?.toDouble() }
        return if (nums.isEmpty()) null else Math.round(nums.average() * 10) / 10.0
    }

    /** A figure's value: how many items match, or the sum or average of a field across them. */
    fun stat(rows: List<PlanRow>, stat: PackStat, today: String): Double? {
        val items = filter(rows, stat.where, today)
        return when {
            stat.agg == "sum" && stat.field != null -> sum(items, stat.field)
            stat.agg == "average" && stat.field != null -> average(items, stat.field)
            else -> items.size.toDouble()
        }
    }
}
