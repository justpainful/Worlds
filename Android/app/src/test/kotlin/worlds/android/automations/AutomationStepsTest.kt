package worlds.android.automations

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import worlds.content.AutomationPolicy
import worlds.content.AutomationSpec
import worlds.content.Automations
import worlds.content.Trigger

class AutomationStepsTest {
    private val base = AutomationSpec(trigger = Trigger.Manual, sourcePageId = "page-1")

    @Test fun storedKindsStayCompatibleWithDesktop() {
        assertEquals("claude", AutomationSteps.TRANSFORM_AI)
        assertEquals("none", AutomationSteps.TRANSFORM_NONE)
        assertEquals("discord.send", AutomationSteps.ACTION_DISCORD)
        assertEquals("notification.show", AutomationSteps.ACTION_NOTIFICATION)
    }

    @Test fun transformReadsNoneAiAndUnknown() {
        assertEquals(AutomationSteps.Transform.None, AutomationSteps.transform(base))
        assertEquals(AutomationSteps.Transform.None, AutomationSteps.transform(base.copy(transformKind = "")))
        assertEquals(
            AutomationSteps.Transform.Ai("Make a list."),
            AutomationSteps.transform(base.copy(transformKind = "claude", transformInstructions = "  Make a list.  "))
        )
        assertEquals(
            AutomationSteps.Transform.Ai(AutomationSteps.DEFAULT_AI_INSTRUCTIONS),
            AutomationSteps.transform(base.copy(transformKind = "claude", transformInstructions = "   "))
        )
        assertEquals(AutomationSteps.Transform.Unknown("translate"), AutomationSteps.transform(base.copy(transformKind = "translate")))
    }

    @Test fun actionChoosesDiscordNotificationOrRefuses() {
        assertEquals(
            AutomationSteps.Action.Discord("https://discord.com/api/webhooks/1/abc"),
            AutomationSteps.action(base.copy(actionKind = "discord.send", destinationWebhook = " https://discord.com/api/webhooks/1/abc "))
        )
        assertEquals(AutomationSteps.Action.DiscordWithoutWebhook, AutomationSteps.action(base.copy(actionKind = "discord.send", destinationWebhook = null)))
        assertEquals(AutomationSteps.Action.DiscordWithoutWebhook, AutomationSteps.action(base.copy(actionKind = "discord.send", destinationWebhook = "  ")))
        // A webhook saved earlier does not matter once the notification action is chosen.
        assertEquals(AutomationSteps.Action.Notification, AutomationSteps.action(base.copy(actionKind = "notification.show", destinationWebhook = "https://example.com/hook")))
        assertEquals(AutomationSteps.Action.Unknown("page.sync"), AutomationSteps.action(base.copy(actionKind = "page.sync")))
        assertEquals(AutomationSteps.Action.Unknown(""), AutomationSteps.action(base.copy(actionKind = "")))
    }

    @Test fun aiMessageHasInstructionsThenThePage() {
        val message = AutomationSteps.aiUserMessage("Summarize in three points.", "Weekly \"notes\"", "# Notes\n\n- one\n- two\n\n")
        assertEquals(
            "Summarize in three points.\n\n<document name=\"Weekly 'notes'\">\n# Notes\n\n- one\n- two\n</document>",
            message
        )
        assertTrue(AutomationSteps.aiUserMessage("  ", "Page", "Body").startsWith(AutomationSteps.DEFAULT_AI_INSTRUCTIONS + "\n\n"))
    }

    @Test fun systemPromptAsksForTheResultOnly() {
        assertEquals(
            "You transform a Worlds page for an automation. Follow the user's instructions and reply with the result only.",
            AutomationSteps.AI_SYSTEM_PROMPT
        )
    }

    @Test fun providerPickPrefersAReadyDefault() {
        val presets = listOf("anthropic", "openai", "ollama")
        assertEquals("openai", AutomationSteps.pickProvider("openai", presets) { true })
        assertEquals("ollama", AutomationSteps.pickProvider("openai", presets) { it == "ollama" })
        assertEquals("anthropic", AutomationSteps.pickProvider(null, presets) { it != "openai" })
        assertEquals("openai", AutomationSteps.pickProvider("gone", presets) { it == "openai" })
        assertNull(AutomationSteps.pickProvider("openai", presets) { false })
    }

    @Test fun notificationBodyIsTrimmedAndCut() {
        assertEquals("Short text", AutomationSteps.notificationBody("  Short text \n"))
        val long = (1..400).joinToString(" ") { "word$it" }
        val body = AutomationSteps.notificationBody(long)
        assertTrue(body.length <= AutomationSteps.NOTIFICATION_MAX_CHARS)
        assertTrue(body.endsWith("..."))
        assertFalse(body.removeSuffix("...").endsWith(" "))
        assertTrue(long.startsWith(body.removeSuffix("...")))
        // Without spaces the text is cut at the limit.
        val solid = "x".repeat(50)
        assertEquals("x".repeat(17) + "...", AutomationSteps.notificationBody(solid, 20))
    }

    @Test fun webhookMustBeHttpsWithAHost() {
        assertTrue(AutomationSteps.isValidWebhook("https://discord.com/api/webhooks/1/abc"))
        assertTrue(AutomationSteps.isValidWebhook(" HTTPS://discord.com/api/webhooks/1/abc "))
        assertFalse(AutomationSteps.isValidWebhook("http://discord.com/api/webhooks/1/abc"))
        assertFalse(AutomationSteps.isValidWebhook("https://"))
        assertFalse(AutomationSteps.isValidWebhook("https:///path"))
        assertFalse(AutomationSteps.isValidWebhook("https://disc ord.com/x"))
        assertFalse(AutomationSteps.isValidWebhook("discord.com/api/webhooks"))
    }

    @Test fun notificationActionSurvivesTheJsonRoundTrip() {
        val spec = AutomationSpec(
            trigger = Trigger.Daily("08:30"),
            sourcePageId = "page-7",
            transformKind = "claude",
            transformInstructions = "Summarize.",
            actionKind = AutomationSteps.ACTION_NOTIFICATION,
            policy = AutomationPolicy(unattended = true, graceMinutes = 30L),
        )
        val json = Automations.specToJson(spec)
        assertEquals("notification.show", json.getJSONObject("action").getString("kind"))
        assertEquals("claude", json.getJSONObject("transform").getString("kind"))
        assertFalse(json.has("destination"))
        val back = Automations.specFromJson(JSONObject(json.toString()))
        assertEquals(spec, back)
        assertEquals(AutomationSteps.Action.Notification, AutomationSteps.action(back))
    }

    @Test fun desktopDiscordSpecStillReads() {
        val desktop = JSONObject(
            """{"trigger":{"kind":"manual"},"source":{"pageId":"p"},"transform":{"kind":"claude","instructions":"Tidy up."},"action":{"kind":"discord.send"},"destination":{"webhookUrl":"https://discord.com/api/webhooks/1/abc"},"policy":{"unattended":false}}"""
        )
        val spec = Automations.specFromJson(desktop)
        assertEquals(AutomationSteps.Transform.Ai("Tidy up."), AutomationSteps.transform(spec))
        assertEquals(AutomationSteps.Action.Discord("https://discord.com/api/webhooks/1/abc"), AutomationSteps.action(spec))
    }
}
