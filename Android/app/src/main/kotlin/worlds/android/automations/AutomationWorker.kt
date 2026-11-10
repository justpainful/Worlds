package worlds.android.automations

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import worlds.content.Automation
import worlds.content.AutomationRun
import worlds.content.Automations
import worlds.content.ContentStore
import worlds.content.MarkdownExport
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.TimeUnit

class AutomationWorker(
    context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val databaseName = inputData.getString(KEY_DATABASE_NAME) ?: "worlds-content.db"
        val specificId = inputData.getString(KEY_AUTOMATION_ID)
        val store = ContentStore(applicationContext, databaseName)

        val automationsToRun = if (specificId != null) {
            listOfNotNull(store.getAutomation(specificId))
        } else {
            val now = System.currentTimeMillis()
            store.listAutomations().filter { it.enabled && (it.nextRunAt ?: Long.MAX_VALUE) <= now }
        }

        var anyFailed = false

        for (auto in automationsToRun) {
            val runId = UUID.randomUUID().toString()
            val now = System.currentTimeMillis()
            val nextRunAt = auto.nextRunAt
            val scheduledFor = nextRunAt ?: now

            // Check grace window
            val graceMs = (auto.spec.policy.graceMinutes ?: 60L) * 60 * 1000L
            if (specificId == null && nextRunAt != null && now - scheduledFor > graceMs) {
                // Grace window exceeded: mark as skipped
                val skippedRun = AutomationRun(
                    id = runId,
                    automationId = auto.id,
                    status = "skipped",
                    trigger = "scheduled",
                    scheduledFor = scheduledFor,
                    startedAt = now,
                    finishedAt = now,
                    versionId = null,
                    output = null,
                    error = "Missed grace window of ${auto.spec.policy.graceMinutes} minutes",
                )
                store.recordAutomationRun(skippedRun)
                // Schedule next run
                val next = Automations.nextRun(auto.spec.trigger, now)
                store.saveAutomation(auto.copy(nextRunAt = next, lastRunAt = now, lastStatus = "skipped", updatedAt = now))
                continue
            }

            // Execute run
            var runStatus = "success"
            var runOutput: String? = null
            var runError: String? = null

            try {
                // 1. Source extraction
                val sourceDoc = store.load(auto.spec.sourcePageId)
                val sourceText = if (sourceDoc != null) {
                    MarkdownExport.page(sourceDoc)
                } else {
                    "Empty or missing page"
                }

                // 2. Transform
                val transformedText = when (auto.spec.transformKind) {
                    "claude" -> {
                        val prompt = auto.spec.transformInstructions ?: "Summarize the following document:"
                        "$prompt\n\n---\n$sourceText"
                    }
                    else -> sourceText
                }

                // 3. Action dispatch
                val webhook = auto.spec.destinationWebhook
                if (auto.spec.actionKind == "discord.send" && !webhook.isNullOrBlank()) {
                    dispatchDiscordWebhook(webhook, auto.name, transformedText)
                }

                runOutput = "Dispatched ${transformedText.length} characters to destination."
            } catch (e: Exception) {
                runStatus = "failed"
                runError = e.message ?: e.toString()
                anyFailed = true
            }

            val finishedAt = System.currentTimeMillis()
            val run = AutomationRun(
                id = runId,
                automationId = auto.id,
                status = runStatus,
                trigger = if (specificId != null) "manual" else "scheduled",
                scheduledFor = scheduledFor,
                startedAt = now,
                finishedAt = finishedAt,
                versionId = null,
                output = runOutput,
                error = runError,
            )
            store.recordAutomationRun(run)

            val next = Automations.nextRun(auto.spec.trigger, finishedAt)
            store.saveAutomation(auto.copy(nextRunAt = next, lastRunAt = finishedAt, lastStatus = runStatus, updatedAt = finishedAt))
        }

        if (anyFailed) Result.retry() else Result.success()
    }

    private fun dispatchDiscordWebhook(webhookUrl: String, title: String, content: String) {
        val url = URL(webhookUrl)
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("User-Agent", "Worlds-Android/1.0")
        conn.doOutput = true
        conn.connectTimeout = 15000
        conn.readTimeout = 15000

        val payload = JSONObject().apply {
            put("content", "**$title** (Automated Update)")
            val embed = JSONObject().apply {
                put("title", title)
                put("description", content.take(4000))
                put("color", 0xD2A46E) // Worlds Gold
                put("footer", JSONObject().put("text", "Automated by Worlds Android"))
            }
            put("embeds", org.json.JSONArray().put(embed))
        }

        OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
            writer.write(payload.toString())
            writer.flush()
        }

        val code = conn.responseCode
        if (code !in 200..299) {
            val errorStream = conn.errorStream?.bufferedReader()?.readText().orEmpty()
            throw IllegalStateException("Discord webhook failed with HTTP $code: $errorStream")
        }
    }

    companion object {
        const val KEY_DATABASE_NAME = "database_name"
        const val KEY_AUTOMATION_ID = "automation_id"
        private const val PERIODIC_WORK_TAG = "worlds_automations_periodic"

        fun schedulePeriodic(context: Context, databaseName: String = "worlds-content.db") {
            val request = PeriodicWorkRequestBuilder<AutomationWorker>(15, TimeUnit.MINUTES)
                .addTag(PERIODIC_WORK_TAG)
                .setInputData(
                    androidx.work.Data.Builder()
                        .putString(KEY_DATABASE_NAME, databaseName)
                        .build()
                )
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_WORK_TAG,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            )
        }

        fun runNow(context: Context, automationId: String, databaseName: String = "worlds-content.db") {
            val request = androidx.work.OneTimeWorkRequestBuilder<AutomationWorker>()
                .setInputData(
                    androidx.work.Data.Builder()
                        .putString(KEY_DATABASE_NAME, databaseName)
                        .putString(KEY_AUTOMATION_ID, automationId)
                        .build()
                )
                .build()
            WorkManager.getInstance(context).enqueue(request)
        }
    }
}
