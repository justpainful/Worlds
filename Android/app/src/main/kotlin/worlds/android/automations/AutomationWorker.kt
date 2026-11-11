package worlds.android.automations

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.fold
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import worlds.android.R
import worlds.android.ai.AI_PROVIDER_PRESETS
import worlds.android.ai.AiClient
import worlds.android.ai.AiError
import worlds.android.ai.AiProviderStore
import worlds.android.ai.AiTurn
import worlds.android.ai.aiPreset
import worlds.android.ai.label
import worlds.android.ai.localized
import worlds.content.Automation
import worlds.content.AutomationRun
import worlds.content.Automations
import worlds.content.ContentStore
import worlds.content.MarkdownExport
import java.io.IOException
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.MalformedURLException
import java.net.URL
import java.util.UUID
import java.util.concurrent.TimeUnit

/** A run failure whose message is already in the interface language. */
private class AutomationFailure(message: String) : Exception(message)

class AutomationWorker(
    context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    private fun text(id: Int, vararg args: Any): String = applicationContext.getString(id, *args)

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

            var runStatus = "success"
            var runOutput: String? = null
            var runError: String? = null

            try {
                runOutput = execute(store, auto)
            } catch (e: CancellationException) {
                // WorkManager stopped the worker; nothing finished, so nothing is recorded.
                throw e
            } catch (e: AiError) {
                runStatus = "failed"
                runError = text(R.string.automation_error_ai_failed, e.localized(applicationContext))
                anyFailed = true
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

        // Failures are kept in the run history. Retrying would repeat AI calls and
        // sends, and a scheduled automation has already moved on to its next time.
        if (anyFailed && specificId != null) Result.failure() else Result.success()
    }

    /**
     * Runs the three steps for one automation and returns what was done.
     * Everything this device cannot do is refused before any provider is called
     * or anything is sent, and every failure throws.
     */
    private suspend fun execute(store: ContentStore, auto: Automation): String {
        val transform = AutomationSteps.transform(auto.spec)
        val action = AutomationSteps.action(auto.spec)

        if (transform is AutomationSteps.Transform.Unknown) {
            throw AutomationFailure(text(R.string.automation_error_unknown_transform, transform.kind))
        }
        when (action) {
            is AutomationSteps.Action.Unknown -> throw AutomationFailure(text(R.string.automation_error_unknown_action, action.kind))
            AutomationSteps.Action.DiscordWithoutWebhook -> throw AutomationFailure(text(R.string.automation_error_no_webhook))
            is AutomationSteps.Action.Discord -> {
                if (!AutomationSteps.isValidWebhook(action.webhookUrl)) throw AutomationFailure(text(R.string.automation_error_bad_webhook))
            }
            AutomationSteps.Action.Notification -> checkNotificationsAllowed()
        }

        // 1. Source
        val sourceDoc = store.load(auto.spec.sourcePageId) ?: throw AutomationFailure(text(R.string.automation_error_page_missing))
        val sourceText = MarkdownExport.page(sourceDoc)

        // 2. Transform
        val steps = ArrayList<String>()
        val transformedText = when (transform) {
            AutomationSteps.Transform.None -> sourceText
            is AutomationSteps.Transform.Ai -> {
                val (reply, label) = runAi(transform.instructions, sourceDoc.resource.title, sourceText)
                steps.add(text(R.string.automation_output_ai, label))
                reply
            }
            is AutomationSteps.Transform.Unknown -> error("refused above")
        }

        // 3. Action
        when (action) {
            is AutomationSteps.Action.Discord -> {
                dispatchDiscordWebhook(action.webhookUrl, auto.name, transformedText)
                steps.add(text(R.string.automation_output_discord))
            }
            AutomationSteps.Action.Notification -> {
                showNotification(auto, transformedText)
                steps.add(text(R.string.automation_output_notification))
            }
            else -> error("refused above")
        }
        return steps.joinToString(" ")
    }

    /** Calls the provider and model chosen in AI settings. Returns the reply and "Provider (model)". */
    private suspend fun runAi(instructions: String, pageTitle: String, pageMarkdown: String): Pair<String, String> {
        val providers = AiProviderStore(applicationContext)
        val providerId = AutomationSteps.pickProvider(providers.defaultProviderId, AI_PROVIDER_PRESETS.map { it.id }) { providers.isConfigured(it) }
            ?: throw AiError.NoProvider()
        val provider = providers.provider(providerId) ?: throw AiError.NoProvider()
        val model = providers.settings(providerId).model
        if (model.isBlank()) throw AiError.NoModel(provider.displayName)

        val message = AutomationSteps.aiUserMessage(instructions, pageTitle, pageMarkdown)
        val reply = withTimeoutOrNull(AutomationSteps.AI_TIMEOUT_MS) {
            AiClient(provider)
                .streamChat(model, AutomationSteps.AI_SYSTEM_PROMPT, listOf(AiTurn("user", message)))
                .fold(StringBuilder()) { acc, delta -> acc.append(delta) }
                .toString()
        } ?: throw AutomationFailure(text(R.string.automation_error_ai_timeout, AutomationSteps.AI_TIMEOUT_MINUTES.toInt()))
        val result = reply.trim()
        if (result.isEmpty()) throw AutomationFailure(text(R.string.automation_error_ai_empty))
        val name = aiPreset(providerId)?.label(applicationContext) ?: provider.displayName
        return result to "$name ($model)"
    }

    private fun notificationManager(): NotificationManager =
        applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun ensureChannel(manager: NotificationManager) {
        val channel = NotificationChannel(NOTIFICATION_CHANNEL_ID, text(R.string.automations), NotificationManager.IMPORTANCE_DEFAULT)
        channel.description = text(R.string.automation_notification_channel_description)
        // Creating a channel that exists only updates its name and description.
        manager.createNotificationChannel(channel)
    }

    /** Throws a clear failure when Android would drop the notification. */
    private fun checkNotificationsAllowed() {
        val manager = notificationManager()
        val granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            applicationContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (!granted || !manager.areNotificationsEnabled()) throw AutomationFailure(text(R.string.automation_error_notifications_off))
        ensureChannel(manager)
        if (manager.getNotificationChannel(NOTIFICATION_CHANNEL_ID)?.importance == NotificationManager.IMPORTANCE_NONE) {
            throw AutomationFailure(text(R.string.automation_error_channel_off))
        }
    }

    private fun showNotification(auto: Automation, body: String) {
        checkNotificationsAllowed()
        val manager = notificationManager()
        val title = auto.name.trim().ifEmpty { text(R.string.automations) }
        val shown = AutomationSteps.notificationBody(body)
        val launch = applicationContext.packageManager.getLaunchIntentForPackage(applicationContext.packageName)
        val tap = launch?.let {
            PendingIntent.getActivity(applicationContext, auto.id.hashCode(), it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        val builder = Notification.Builder(applicationContext, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_bell)
            .setContentTitle(title)
            .setContentText(shown.lineSequence().firstOrNull { it.isNotBlank() }?.trim() ?: shown)
            .setStyle(Notification.BigTextStyle().bigText(shown))
            .setAutoCancel(true)
        if (tap != null) builder.setContentIntent(tap)
        try {
            // One notification per automation; a new run replaces the last one.
            manager.notify(NOTIFICATION_TAG, auto.id.hashCode(), builder.build())
        } catch (_: SecurityException) {
            throw AutomationFailure(text(R.string.automation_error_notifications_off))
        }
    }

    private fun dispatchDiscordWebhook(webhookUrl: String, title: String, content: String) {
        var conn: HttpURLConnection? = null
        try {
            val connection = URL(webhookUrl).openConnection() as HttpURLConnection
            conn = connection
            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("User-Agent", "Worlds-Android/1.0")
            connection.doOutput = true
            connection.connectTimeout = 15000
            connection.readTimeout = 15000

            val payload = JSONObject().apply {
                put("content", "**$title** (Automated Update)")
                val embed = JSONObject().apply {
                    put("title", title)
                    put("description", content.take(4000))
                    put("color", 0x0A84FF) // Worlds Blue
                    put("footer", JSONObject().put("text", "Automated by Worlds Android"))
                }
                put("embeds", org.json.JSONArray().put(embed))
            }

            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(payload.toString())
                writer.flush()
            }

            val code = connection.responseCode
            if (code !in 200..299) {
                val detail = connection.errorStream?.bufferedReader()?.use { it.readText() }?.trim()?.take(200).orEmpty()
                val sentence = text(R.string.automation_error_discord_http, code)
                throw AutomationFailure(if (detail.isEmpty()) sentence else "$sentence $detail")
            }
        } catch (e: AutomationFailure) {
            throw e
        } catch (_: MalformedURLException) {
            throw AutomationFailure(text(R.string.automation_error_bad_webhook))
        } catch (_: IOException) {
            throw AutomationFailure(text(R.string.automation_error_discord_offline))
        } finally {
            conn?.disconnect()
        }
    }

    companion object {
        const val KEY_DATABASE_NAME = "database_name"
        const val KEY_AUTOMATION_ID = "automation_id"
        const val NOTIFICATION_CHANNEL_ID = "automations"
        private const val NOTIFICATION_TAG = "worlds.automation"
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
