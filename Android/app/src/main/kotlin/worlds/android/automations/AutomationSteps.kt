package worlds.android.automations

import worlds.content.AutomationSpec

/**
 * The pure parts of an automation run: which transform and action a spec asks
 * for, the text sent to the AI provider, and the trimmed notification body.
 * Nothing here touches Android, so it is covered by JVM unit tests.
 */
object AutomationSteps {
    /** Stored transform kinds. "claude" is the value desktop writes; it is shown as AI summary. */
    const val TRANSFORM_NONE = "none"
    const val TRANSFORM_AI = "claude"

    /** Stored action kinds. */
    const val ACTION_DISCORD = "discord.send"
    const val ACTION_NOTIFICATION = "notification.show"

    const val AI_SYSTEM_PROMPT = "You transform a Worlds page for an automation. Follow the user's instructions and reply with the result only."

    /** Used when an AI step was saved without instructions. */
    const val DEFAULT_AI_INSTRUCTIONS = "Summarize this page."

    /** How long one AI step may take before the run fails. */
    const val AI_TIMEOUT_MINUTES = 3L
    const val AI_TIMEOUT_MS = AI_TIMEOUT_MINUTES * 60_000L

    /** Android keeps only about 5 KB of notification text; this stays well under it. */
    const val NOTIFICATION_MAX_CHARS = 1500

    sealed interface Transform {
        data object None : Transform
        data class Ai(val instructions: String) : Transform
        data class Unknown(val kind: String) : Transform
    }

    sealed interface Action {
        data class Discord(val webhookUrl: String) : Action
        data object Notification : Action
        /** Discord was chosen but no webhook URL is saved (for example a desktop automation that posts through the bot). */
        data object DiscordWithoutWebhook : Action
        data class Unknown(val kind: String) : Action
    }

    fun transform(spec: AutomationSpec): Transform = when (spec.transformKind.trim()) {
        "", TRANSFORM_NONE -> Transform.None
        TRANSFORM_AI -> Transform.Ai(spec.transformInstructions?.trim().orEmpty().ifEmpty { DEFAULT_AI_INSTRUCTIONS })
        else -> Transform.Unknown(spec.transformKind)
    }

    fun action(spec: AutomationSpec): Action = when (spec.actionKind.trim()) {
        ACTION_DISCORD -> spec.destinationWebhook?.trim()?.takeIf { it.isNotEmpty() }?.let { Action.Discord(it) } ?: Action.DiscordWithoutWebhook
        ACTION_NOTIFICATION -> Action.Notification
        else -> Action.Unknown(spec.actionKind)
    }

    /** The one user turn sent to the provider: the instructions, then the page in a document tag. */
    fun aiUserMessage(instructions: String, pageTitle: String, pageMarkdown: String): String {
        val text = StringBuilder()
        text.append(instructions.trim().ifEmpty { DEFAULT_AI_INSTRUCTIONS })
        text.append("\n\n<document name=\"").append(pageTitle.replace("\"", "'")).append("\">\n")
        text.append(pageMarkdown.trimEnd())
        text.append("\n</document>")
        return text.toString()
    }

    /**
     * The provider to use: the default one when it is ready, otherwise the first
     * ready one in preset order, otherwise none. Same rule as a new AI conversation.
     */
    fun pickProvider(defaultId: String?, presetIds: List<String>, isConfigured: (String) -> Boolean): String? =
        defaultId?.takeIf { it in presetIds && isConfigured(it) } ?: presetIds.firstOrNull(isConfigured)

    /** The notification body: trimmed, and cut at a word boundary with an ellipsis when long. */
    fun notificationBody(text: String, max: Int = NOTIFICATION_MAX_CHARS): String {
        val clean = text.trim()
        if (clean.length <= max) return clean
        val cut = clean.take(max - 3)
        val space = cut.lastIndexOf(' ')
        val head = if (space >= max / 2) cut.take(space) else cut
        return head.trimEnd() + "..."
    }

    /** A webhook URL the worker will try: https with a host. */
    fun isValidWebhook(url: String): Boolean {
        val trimmed = url.trim()
        if (!trimmed.startsWith("https://", ignoreCase = true)) return false
        val rest = trimmed.substring("https://".length)
        return rest.isNotEmpty() && !rest.startsWith("/") && rest.none { it.isWhitespace() }
    }
}
