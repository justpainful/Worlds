package worlds.content

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.TimeZone
import java.util.UUID

sealed interface Trigger {
    data class Once(val at: Long) : Trigger
    data class Daily(val time: String) : Trigger
    data class Weekly(val days: List<Int>, val time: String) : Trigger
    data class Monthly(val day: Int, val time: String) : Trigger
    data object Manual : Trigger
}

data class AutomationPolicy(
    val unattended: Boolean = false,
    val graceMinutes: Long? = 60L,
)

data class AutomationSpec(
    val trigger: Trigger,
    val sourcePageId: String,
    val transformKind: String = "none", // "none" | "claude"
    val transformInstructions: String? = null,
    val transformModel: String? = null,
    val actionKind: String = "discord.send",
    val actionOptions: String? = null,
    val destinationWebhook: String? = null,
    val destinationChannel: String? = null,
    val policy: AutomationPolicy = AutomationPolicy(),
)

data class Automation(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val spec: AutomationSpec,
    val nextRunAt: Long?,
    val lastRunAt: Long?,
    val createdAt: Long,
    val updatedAt: Long,
    val lastStatus: String?,
)

data class AutomationRun(
    val id: String,
    val automationId: String,
    val status: String, // "running" | "success" | "failed" | "skipped"
    val trigger: String,
    val scheduledFor: Long?,
    val startedAt: Long?,
    val finishedAt: Long?,
    val versionId: String?,
    val output: String?,
    val error: String?,
)

object Automations {
    fun parseTime(timeStr: String): Pair<Int, Int> {
        val parts = timeStr.trim().split(":")
        val hour = parts.getOrNull(0)?.toIntOrNull()?.coerceIn(0, 23) ?: 9
        val minute = parts.getOrNull(1)?.toIntOrNull()?.coerceIn(0, 59) ?: 0
        return hour to minute
    }

    fun nextRun(trigger: Trigger, after: Long): Long? {
        val cal = Calendar.getInstance().apply { timeInMillis = after }
        return when (trigger) {
            is Trigger.Once -> if (trigger.at > after) trigger.at else null
            is Trigger.Manual -> null
            is Trigger.Daily -> {
                val (hour, minute) = parseTime(trigger.time)
                for (offset in 0..7) {
                    val candidate = Calendar.getInstance().apply {
                        timeInMillis = after
                        add(Calendar.DAY_OF_YEAR, offset)
                        set(Calendar.HOUR_OF_DAY, hour)
                        set(Calendar.MINUTE, minute)
                        set(Calendar.SECOND, 0)
                        set(Calendar.MILLISECOND, 0)
                    }.timeInMillis
                    if (candidate > after) return candidate
                }
                null
            }
            is Trigger.Weekly -> {
                val (hour, minute) = parseTime(trigger.time)
                val targetDays = trigger.days.ifEmpty { listOf(1) } // 1=Mon..7=Sun
                for (offset in 0..14) {
                    val targetCal = Calendar.getInstance().apply {
                        timeInMillis = after
                        add(Calendar.DAY_OF_YEAR, offset)
                        set(Calendar.HOUR_OF_DAY, hour)
                        set(Calendar.MINUTE, minute)
                        set(Calendar.SECOND, 0)
                        set(Calendar.MILLISECOND, 0)
                    }
                    val dayOfWeek = when (targetCal.get(Calendar.DAY_OF_WEEK)) {
                        Calendar.MONDAY -> 1
                        Calendar.TUESDAY -> 2
                        Calendar.WEDNESDAY -> 3
                        Calendar.THURSDAY -> 4
                        Calendar.FRIDAY -> 5
                        Calendar.SATURDAY -> 6
                        Calendar.SUNDAY -> 7
                        else -> 1
                    }
                    if (dayOfWeek in targetDays && targetCal.timeInMillis > after) {
                        return targetCal.timeInMillis
                    }
                }
                null
            }
            is Trigger.Monthly -> {
                val (hour, minute) = parseTime(trigger.time)
                val dayOfMonth = trigger.day.coerceIn(1, 31)
                for (offset in 0..3) {
                    val targetCal = Calendar.getInstance().apply {
                        timeInMillis = after
                        add(Calendar.MONTH, offset)
                        val maxDay = getActualMaximum(Calendar.DAY_OF_MONTH)
                        set(Calendar.DAY_OF_MONTH, dayOfMonth.coerceAtMost(maxDay))
                        set(Calendar.HOUR_OF_DAY, hour)
                        set(Calendar.MINUTE, minute)
                        set(Calendar.SECOND, 0)
                        set(Calendar.MILLISECOND, 0)
                    }
                    if (targetCal.timeInMillis > after) return targetCal.timeInMillis
                }
                null
            }
        }
    }

    fun triggerToJson(trigger: Trigger): JSONObject {
        val json = JSONObject()
        when (trigger) {
            is Trigger.Once -> {
                json.put("kind", "once")
                json.put("at", trigger.at)
            }
            is Trigger.Daily -> {
                json.put("kind", "daily")
                json.put("time", trigger.time)
            }
            is Trigger.Weekly -> {
                json.put("kind", "weekly")
                val daysArr = JSONArray()
                trigger.days.forEach { daysArr.put(it) }
                json.put("days", daysArr)
                json.put("time", trigger.time)
            }
            is Trigger.Monthly -> {
                json.put("kind", "monthly")
                json.put("day", trigger.day)
                json.put("time", trigger.time)
            }
            is Trigger.Manual -> {
                json.put("kind", "manual")
            }
        }
        return json
    }

    fun triggerFromJson(json: JSONObject): Trigger {
        return when (json.optString("kind", "manual")) {
            "once" -> Trigger.Once(json.optLong("at", System.currentTimeMillis()))
            "daily" -> Trigger.Daily(json.optString("time", "09:00"))
            "weekly" -> {
                val arr = json.optJSONArray("days")
                val days = if (arr != null) (0 until arr.length()).map { arr.getInt(it) } else listOf(1)
                Trigger.Weekly(days, json.optString("time", "09:00"))
            }
            "monthly" -> Trigger.Monthly(json.optInt("day", 1), json.optString("time", "09:00"))
            else -> Trigger.Manual
        }
    }

    fun specToJson(spec: AutomationSpec): JSONObject {
        val json = JSONObject()
        json.put("trigger", triggerToJson(spec.trigger))
        json.put("source", JSONObject().put("pageId", spec.sourcePageId))
        json.put("transform", JSONObject().apply {
            put("kind", spec.transformKind)
            if (spec.transformInstructions != null) put("instructions", spec.transformInstructions)
            if (spec.transformModel != null) put("model", spec.transformModel)
        })
        json.put("action", JSONObject().apply {
            put("kind", spec.actionKind)
            if (spec.actionOptions != null) put("options", spec.actionOptions)
        })
        if (spec.destinationWebhook != null || spec.destinationChannel != null) {
            json.put("destination", JSONObject().apply {
                if (spec.destinationWebhook != null) put("webhookUrl", spec.destinationWebhook)
                if (spec.destinationChannel != null) put("channelId", spec.destinationChannel)
            })
        }
        json.put("policy", JSONObject().apply {
            put("unattended", spec.policy.unattended)
            if (spec.policy.graceMinutes != null) put("graceMinutes", spec.policy.graceMinutes)
        })
        return json
    }

    fun specFromJson(json: JSONObject): AutomationSpec {
        val triggerObj = json.optJSONObject("trigger") ?: JSONObject()
        val trigger = triggerFromJson(triggerObj)
        val sourceObj = json.optJSONObject("source") ?: JSONObject()
        val pageId = sourceObj.optString("pageId", "")
        val transformObj = json.optJSONObject("transform")
        val transformKind = transformObj?.optString("kind", "none") ?: "none"
        val transformInstructions = transformObj?.optString("instructions")?.takeIf { it.isNotBlank() }
        val transformModel = transformObj?.optString("model")?.takeIf { it.isNotBlank() }
        val actionObj = json.optJSONObject("action")
        val actionKind = actionObj?.optString("kind", "discord.send") ?: "discord.send"
        val actionOptions = actionObj?.optString("options")?.takeIf { it.isNotBlank() }
        val destObj = json.optJSONObject("destination")
        val destWebhook = destObj?.optString("webhookUrl")?.takeIf { it.isNotBlank() }
        val destChannel = destObj?.optString("channelId")?.takeIf { it.isNotBlank() }
        val policyObj = json.optJSONObject("policy")
        val unattended = policyObj?.optBoolean("unattended", false) ?: false
        val graceMinutes = if (policyObj != null && policyObj.has("graceMinutes")) policyObj.optLong("graceMinutes") else 60L
        return AutomationSpec(
            trigger = trigger,
            sourcePageId = pageId,
            transformKind = transformKind,
            transformInstructions = transformInstructions,
            transformModel = transformModel,
            actionKind = actionKind,
            actionOptions = actionOptions,
            destinationWebhook = destWebhook,
            destinationChannel = destChannel,
            policy = AutomationPolicy(unattended, graceMinutes),
        )
    }

    fun createTables(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS automations (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                spec TEXT NOT NULL,
                next_run_at INTEGER,
                last_run_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_status TEXT
            )"""
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS automations_enabled ON automations(enabled, next_run_at)")
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS automation_runs (
                id TEXT PRIMARY KEY,
                automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
                status TEXT NOT NULL,
                trigger TEXT NOT NULL,
                scheduled_for INTEGER,
                started_at INTEGER,
                finished_at INTEGER,
                version_id TEXT,
                output TEXT,
                error TEXT
            )"""
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS automation_runs_auto ON automation_runs(automation_id, started_at)")
    }
}
