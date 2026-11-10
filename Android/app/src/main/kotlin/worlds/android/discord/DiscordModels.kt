package worlds.android.discord

import org.json.JSONArray
import org.json.JSONObject
import worlds.content.ContentBlock
import worlds.content.ResourceDocument

data class DiscordDestination(
    val id: String,
    val name: String,
    val kind: String = "webhook", // "webhook" | "channel"
    val guildName: String? = null,
    val webhookUrl: String? = null
)

data class EmbedField(
    val name: String,
    val value: String,
    val inline: Boolean = false
)

data class DiscordEmbed(
    val title: String? = null,
    val description: String? = null,
    val url: String? = null,
    val color: Int = 0xD2A46E, // Default Worlds Gold
    val fields: List<EmbedField> = emptyList(),
    val footerText: String? = "Worlds Android",
    val timestamp: String? = null
)

data class DiscordOptions(
    val includeTitle: Boolean = true,
    val wrapInEmbed: Boolean = true,
    val color: Int = 0xD2A46E,
    val footerText: String? = "Shared from Worlds"
)

object DiscordEmbedFormatter {
    fun formatPage(document: ResourceDocument, options: DiscordOptions): Pair<String?, List<DiscordEmbed>> {
        val title = if (options.includeTitle) document.resource.title.ifBlank { "Untitled" } else null
        val descriptionBuilder = StringBuilder()

        for (block in document.blocks) {
            val blockNode = runCatching { JSONObject(block.content) }.getOrNull() ?: continue
            val type = blockNode.optString("type")
            when (type) {
                "paragraph" -> {
                    val text = extractText(blockNode)
                    if (text.isNotBlank()) descriptionBuilder.append(text).append("\n\n")
                }
                "heading" -> {
                    val level = blockNode.optJSONObject("attrs")?.optInt("level", 1) ?: 1
                    val text = extractText(blockNode)
                    if (text.isNotBlank()) {
                        val prefix = when (level) {
                            1 -> "# "
                            2 -> "## "
                            else -> "### "
                        }
                        descriptionBuilder.append(prefix).append(text).append("\n\n")
                    }
                }
                "codeBlock" -> {
                    val lang = blockNode.optJSONObject("attrs")?.optString("language").orEmpty()
                    val text = extractText(blockNode)
                    descriptionBuilder.append("```").append(lang).append("\n").append(text).append("\n```\n\n")
                }
                "bulletList" -> {
                    val items = blockNode.optJSONArray("content")
                    if (items != null) {
                        for (i in 0 until items.length()) {
                            val item = items.optJSONObject(i)
                            val text = item?.let(::extractText).orEmpty()
                            if (text.isNotBlank()) descriptionBuilder.append("• ").append(text).append("\n")
                        }
                        descriptionBuilder.append("\n")
                    }
                }
                "orderedList" -> {
                    val items = blockNode.optJSONArray("content")
                    if (items != null) {
                        for (i in 0 until items.length()) {
                            val item = items.optJSONObject(i)
                            val text = item?.let(::extractText).orEmpty()
                            if (text.isNotBlank()) descriptionBuilder.append("${i + 1}. ").append(text).append("\n")
                        }
                        descriptionBuilder.append("\n")
                    }
                }
                "taskList" -> {
                    val items = blockNode.optJSONArray("content")
                    if (items != null) {
                        for (i in 0 until items.length()) {
                            val item = items.optJSONObject(i)
                            val checked = item?.optJSONObject("attrs")?.optBoolean("checked") == true
                            val text = item?.let(::extractText).orEmpty()
                            if (text.isNotBlank()) descriptionBuilder.append(if (checked) "✅ " else "⬜ ").append(text).append("\n")
                        }
                        descriptionBuilder.append("\n")
                    }
                }
                "blockquote", "callout", "prompt" -> {
                    val text = extractText(blockNode)
                    if (text.isNotBlank()) {
                        descriptionBuilder.append("> ").append(text.replace("\n", "\n> ")).append("\n\n")
                    }
                }
            }
        }

        val rawDescription = descriptionBuilder.toString().trim()
        val description = if (rawDescription.length > 4000) rawDescription.take(3990) + "..." else rawDescription

        return if (options.wrapInEmbed) {
            val embed = DiscordEmbed(
                title = title,
                description = description.ifBlank { "*(Empty content)*" },
                color = options.color,
                footerText = options.footerText
            )
            null to listOf(embed)
        } else {
            val content = buildString {
                if (title != null) append("**").append(title).append("**\n\n")
                append(description)
            }.take(2000)
            content to emptyList()
        }
    }

    private fun extractText(node: JSONObject): String {
        val sb = StringBuilder()
        fun walk(n: JSONObject) {
            val type = n.optString("type")
            if (type == "text") {
                val t = n.optString("text")
                var styled = t
                val marks = n.optJSONArray("marks")
                if (marks != null) {
                    for (i in 0 until marks.length()) {
                        val m = marks.optJSONObject(i)
                        when (m?.optString("type")) {
                            "bold" -> styled = "**$styled**"
                            "italic" -> styled = "*$styled*"
                            "code" -> styled = "`$styled`"
                            "strike" -> styled = "~~$styled~~"
                            "link" -> {
                                val href = m.optJSONObject("attrs")?.optString("href").orEmpty()
                                if (href.isNotBlank()) styled = "[$styled]($href)"
                            }
                        }
                    }
                }
                sb.append(styled)
            } else if (type == "hardBreak") {
                sb.append("\n")
            }
            val content = n.optJSONArray("content")
            if (content != null) {
                for (i in 0 until content.length()) {
                    val child = content.optJSONObject(i)
                    if (child != null) walk(child)
                }
            }
        }
        walk(node)
        return sb.toString().trim()
    }

    fun buildPayloadJson(content: String?, embeds: List<DiscordEmbed>): JSONObject {
        val payload = JSONObject()
        if (!content.isNullOrBlank()) {
            payload.put("content", content)
        }
        if (embeds.isNotEmpty()) {
            val embedsArr = JSONArray()
            for (embed in embeds) {
                val embedObj = JSONObject()
                if (embed.title != null) embedObj.put("title", embed.title)
                if (embed.description != null) embedObj.put("description", embed.description)
                if (embed.url != null) embedObj.put("url", embed.url)
                embedObj.put("color", embed.color)
                if (embed.footerText != null) {
                    embedObj.put("footer", JSONObject().put("text", embed.footerText))
                }
                if (embed.fields.isNotEmpty()) {
                    val fieldsArr = JSONArray()
                    for (field in embed.fields) {
                        fieldsArr.put(
                            JSONObject()
                                .put("name", field.name)
                                .put("value", field.value)
                                .put("inline", field.inline)
                        )
                    }
                    embedObj.put("fields", fieldsArr)
                }
                embedsArr.put(embedObj)
            }
            payload.put("embeds", embedsArr)
        }
        return payload
    }
}
