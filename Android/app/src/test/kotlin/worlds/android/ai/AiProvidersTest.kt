package worlds.android.ai

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AiProvidersTest {
    private val anthropic = AiProvider("anthropic", "Anthropic", AiProviderKind.Anthropic, "https://api.anthropic.com", "test-anthropic-key")
    private val openai = AiProvider("openai", "OpenAI", AiProviderKind.OpenAiCompatible, "https://api.openai.com/v1/", "test-openai-key")
    private val ollama = AiProvider("ollama", "Ollama", AiProviderKind.OpenAiCompatible, "http://localhost:11434/v1", null)

    @Test fun presetsCoverEveryProviderWithOneShape() {
        val ids = AI_PROVIDER_PRESETS.map { it.id }
        assertEquals(listOf("anthropic", "openai", "gemini", "groq", "deepseek", "mistral", "xai", "openrouter", "ollama", "lmstudio", "custom"), ids)
        assertEquals(AiProviderKind.Anthropic, aiPreset("anthropic")!!.kind)
        assertTrue(AI_PROVIDER_PRESETS.filter { it.id != "anthropic" }.all { it.kind == AiProviderKind.OpenAiCompatible })
        assertEquals("https://generativelanguage.googleapis.com/v1beta/openai", aiPreset("gemini")!!.baseUrl)
        assertFalse(aiPreset("ollama")!!.requiresKey)
        assertTrue(aiPreset("groq")!!.requiresKey)
    }

    @Test fun anthropicChatRequestUsesMessagesApi() {
        val request = AiRequests.chat(anthropic, "claude-test", "Be brief.", listOf(AiTurn("user", "Hello")))
        assertEquals("POST", request.method)
        assertEquals("https://api.anthropic.com/v1/messages", request.url)
        assertEquals("test-anthropic-key", request.headers["x-api-key"])
        assertEquals("2023-06-01", request.headers["anthropic-version"])
        assertNull(request.headers["Authorization"])
        val body = JSONObject(request.body!!)
        assertEquals("claude-test", body.getString("model"))
        assertTrue(body.getBoolean("stream"))
        assertEquals(4096, body.getInt("max_tokens"))
        assertEquals("Be brief.", body.getString("system"))
        val messages = body.getJSONArray("messages")
        assertEquals(1, messages.length())
        assertEquals("user", messages.getJSONObject(0).getString("role"))
        assertEquals("Hello", messages.getJSONObject(0).getString("content"))
    }

    @Test fun anthropicBaseWithVersionIsNotDoubled() {
        val request = AiRequests.listModels(anthropic.copy(baseUrl = "https://proxy.example/v1/"))
        assertEquals("https://proxy.example/v1/models?limit=1000", request.url)
    }

    @Test fun openAiChatRequestUsesChatCompletions() {
        val request = AiRequests.chat(openai, "gpt-test", "Be brief.", listOf(AiTurn("user", "Hi"), AiTurn("assistant", "Hello"), AiTurn("user", "More")))
        assertEquals("https://api.openai.com/v1/chat/completions", request.url)
        assertEquals("Bearer test-openai-key", request.headers["Authorization"])
        assertNull(request.headers["x-api-key"])
        val body = JSONObject(request.body!!)
        assertTrue(body.getBoolean("stream"))
        assertFalse(body.has("max_tokens"))
        val messages = body.getJSONArray("messages")
        assertEquals(4, messages.length())
        assertEquals("system", messages.getJSONObject(0).getString("role"))
        assertEquals("Be brief.", messages.getJSONObject(0).getString("content"))
        assertEquals("More", messages.getJSONObject(3).getString("content"))
    }

    @Test fun localServerNeedsNoKey() {
        val request = AiRequests.chat(ollama, "llama3.2", "", listOf(AiTurn("user", "Hi")))
        assertEquals("http://localhost:11434/v1/chat/completions", request.url)
        assertNull(request.headers["Authorization"])
        val messages = JSONObject(request.body!!).getJSONArray("messages")
        assertEquals(1, messages.length())
        assertEquals("http://localhost:11434/v1/models", AiRequests.listModels(ollama).url)
        assertTrue(AiRequests.isLocal(ollama.baseUrl))
    }

    @Test fun modelListRequestsMatchEachKind() {
        val a = AiRequests.listModels(anthropic)
        assertEquals("GET", a.method)
        assertEquals("https://api.anthropic.com/v1/models?limit=1000", a.url)
        assertEquals("test-anthropic-key", a.headers["x-api-key"])
        val o = AiRequests.listModels(openai)
        assertEquals("https://api.openai.com/v1/models", o.url)
        assertEquals("Bearer test-openai-key", o.headers["Authorization"])
    }

    @Test fun turnsAreCleanedBeforeSending() {
        val cleaned = AiRequests.cleanTurns(listOf(
            AiTurn("assistant", "Welcome"),
            AiTurn("user", "One"),
            AiTurn("user", "Two"),
            AiTurn("system", "ignored"),
            AiTurn("assistant", " "),
            AiTurn("assistant", "Reply"),
        ))
        assertEquals(listOf(AiTurn("user", "One\n\nTwo"), AiTurn("assistant", "Reply")), cleaned)
    }

    @Test fun errorMessagesAndStreamingRepliesAreNotSent() {
        val messages = listOf(
            ChatMessage("1", "user", "Hi", 0),
            ChatMessage("2", "assistant", "Bad key", 0, error = true),
            ChatMessage("3", "user", "Again", 0, attachments = listOf(ChatAttachment("p", "Plan", "text/markdown", 4, "# Plan"))),
            ChatMessage("4", "assistant", "", 0, isStreaming = true),
        )
        val turns = messages.toTurns()
        assertEquals(2, turns.size)
        assertTrue(turns[1].content.startsWith("<document name=\"Plan\">\n# Plan\n</document>"))
        assertTrue(turns[1].content.endsWith("Again"))
    }

    @Test fun modelListsParseForBothKindsAndDropNonChatModels() {
        val anthropicModels = AiRequests.parseModels("""{"data":[{"type":"model","id":"claude-a","display_name":"Claude A"},{"id":"claude-b","display_name":"Claude B"}],"has_more":false}""")
        assertEquals(listOf(AiModelOption("claude-a", "Claude A"), AiModelOption("claude-b", "Claude B")), anthropicModels)
        val openAiModels = AiRequests.parseModels("""{"object":"list","data":[{"id":"gpt-test","object":"model"},{"id":"text-embedding-3-small"},{"id":"whisper-1"},{"id":"models/gemini-test"}]}""")
        assertEquals(listOf("gpt-test", "gemini-test"), openAiModels.map { it.id })
    }

    @Test fun anthropicStreamYieldsTextUntilStop() {
        val parser = AiStreamParser(AiProviderKind.Anthropic)
        val lines = listOf(
            "event: message_start",
            """data: {"type":"message_start","message":{"id":"msg","content":[]}}""",
            "",
            "event: content_block_start",
            """data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}""",
            "event: ping",
            """data: {"type":"ping"}""",
            "event: content_block_delta",
            """data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}""",
            """data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}""",
            """data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}""",
            """data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}""",
            "event: message_stop",
            """data: {"type":"message_stop"}""",
        )
        val events = lines.flatMap { parser.line(it) }
        assertEquals(listOf(AiStreamEvent.Delta("Hel"), AiStreamEvent.Delta("lo"), AiStreamEvent.Done), events)
    }

    @Test fun anthropicStreamErrorIsReported() {
        val events = AiStreamParser(AiProviderKind.Anthropic).line("""data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}""")
        assertEquals(listOf(AiStreamEvent.Failure("Overloaded")), events)
    }

    @Test fun openAiStreamYieldsDeltasUntilDone() {
        val parser = AiStreamParser(AiProviderKind.OpenAiCompatible)
        val lines = listOf(
            ": OPENROUTER PROCESSING",
            """data: {"id":"c","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}""",
            """data: {"id":"c","choices":[{"index":0,"delta":{"content":"Hi"}}]}""",
            "\r",
            """data: {"id":"c","choices":[{"index":0,"delta":{"content":" there"}}]}""" + "\r",
            """data: {"id":"c","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}""",
            """data: {"id":"c","choices":[],"usage":{"total_tokens":3}}""",
            "data: [DONE]",
        )
        val events = lines.flatMap { parser.line(it) }
        assertEquals(listOf(AiStreamEvent.Delta("Hi"), AiStreamEvent.Delta(" there"), AiStreamEvent.Done), events)
    }

    @Test fun openAiStreamErrorIsReported() {
        val parser = AiStreamParser(AiProviderKind.OpenAiCompatible)
        assertEquals(listOf(AiStreamEvent.Failure("model overloaded")), parser.line("""data: {"error":{"message":"model overloaded","code":503}}"""))
        assertEquals(listOf(AiStreamEvent.Failure("bad request")), parser.line("""{"error":"bad request"}"""))
    }

    @Test fun httpErrorsBecomeClearMessages() {
        assertTrue(AiRequests.httpError(openai, 401, """{"error":{"message":"Incorrect API key provided"}}""", "gpt-test") is AiError.BadKey)
        assertTrue(AiRequests.httpError(openai, 404, """{"error":{"message":"The model `gpt-x` does not exist","code":"model_not_found"}}""", "gpt-x") is AiError.ModelMissing)
        assertTrue(AiRequests.httpError(anthropic, 404, """{"type":"error","error":{"type":"not_found_error","message":"model: claude-x"}}""", "claude-x") is AiError.ModelMissing)
        assertTrue(AiRequests.httpError(ollama, 400, """{"error":{"message":"model \"llama9\" not found, try pulling it first"}}""", "llama9") is AiError.ModelMissing)
        assertTrue(AiRequests.httpError(openai, 429, """{"error":{"message":"Rate limit reached"}}""", "gpt-test") is AiError.RateLimited)
        val server = AiRequests.httpError(anthropic, 529, """{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}""", "claude-test")
        assertTrue(server is AiError.Server)
        assertTrue(server.message!!.contains("Overloaded"))
    }

    @Test fun keysNeverAppearInDescriptions() {
        assertFalse(anthropic.toString().contains("test-anthropic-key"))
        assertFalse(AiError.BadKey("Anthropic").message!!.contains("test"))
    }

    @Test fun baseUrlsAreValidated() {
        assertTrue(AiRequests.isValidBase("https://api.groq.com/openai/v1"))
        assertTrue(AiRequests.isValidBase("http://192.168.1.20:11434/v1"))
        assertFalse(AiRequests.isValidBase(""))
        assertFalse(AiRequests.isValidBase("api.openai.com"))
        assertFalse(AiRequests.isValidBase("ftp://example.com"))
    }

    @Test fun conversationsRoundTripWithProviderAndModel() {
        val thread = ChatThread("abc", "Plan", "groq", "llama-test", listOf(ChatMessage("1", "user", "Hi", 5, listOf(ChatAttachment("p", "Page", "text/markdown", 2, "Hi")))), 1, 2)
        val back = ChatThreadJson.decode(ChatThreadJson.encode(thread))
        assertEquals(thread, back)
        assertEquals("A long first line that keeps going and going and going pa...", chatTitle("A long first line that keeps going and going and going past the limit\nsecond"))
    }
}
