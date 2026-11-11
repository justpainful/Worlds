package worlds.android.ai

data class AiModelInfo(
    val id: String,
    val name: String,
    val provider: String,
    val description: String,
    val contextWindow: Int
)

val DEFAULT_AI_MODELS = listOf(
    AiModelInfo(
        id = "claude-3-5-sonnet-20241022",
        name = "Orbit",
        provider = "Anthropic",
        description = "High intelligence, coding and creative generation",
        contextWindow = 200_000
    ),
    AiModelInfo(
        id = "claude-3-5-haiku-20241022",
        name = "Spark",
        provider = "Anthropic",
        description = "Lightweight, ultra-fast responses",
        contextWindow = 200_000
    ),
    AiModelInfo(
        id = "claude-3-opus-20240229",
        name = "Nova",
        provider = "Anthropic",
        description = "Deep reasoning and extensive writing",
        contextWindow = 200_000
    ),
    AiModelInfo(
        id = "gpt-4o",
        name = "GPT-4o",
        provider = "OpenAI",
        description = "Multimodal reasoning and versatility",
        contextWindow = 128_000
    )
)

data class ChatAttachment(
    val id: String,
    val name: String,
    val mime: String,
    val size: Long,
    val content: String // Text or markdown projection
)

data class ChatMessage(
    val id: String,
    val role: String, // "user" | "assistant" | "system"
    val content: String,
    val timestamp: Long,
    val attachments: List<ChatAttachment> = emptyList(),
    val isStreaming: Boolean = false,
    val error: Boolean = false
)

data class ChatThread(
    val id: String,
    val title: String,
    val modelId: String,
    val messages: List<ChatMessage>,
    val createdAt: Long,
    val updatedAt: Long
)
