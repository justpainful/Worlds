package worlds.android.ai

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Sends nothing: answers each request with the next scripted reply (body lines, or an HTTP failure). */
internal class FakeTransport(private val replies: List<Any>) : AiTransport {
    val requests = ArrayList<AiHttpRequest>()

    override suspend fun send(request: AiHttpRequest, onLine: suspend (String) -> Boolean): AiHttpFailure? {
        requests.add(request)
        val reply = replies[minOf(requests.size - 1, replies.size - 1)]
        if (reply is AiHttpFailure) return reply
        @Suppress("UNCHECKED_CAST")
        for (line in reply as List<String>) if (!onLine(line)) break
        return null
    }

    fun body(index: Int) = JSONObject(requests[index].body!!)
}

internal object Sse {
    fun anthropicText(text: String) = listOf(
        "event: message_start",
        """data: {"type":"message_start","message":{"id":"m","content":[]}}""",
        """data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}""",
        "data: " + JSONObject().put("type", "content_block_delta").put("index", 0).put("delta", JSONObject().put("type", "text_delta").put("text", text)),
        """data: {"type":"content_block_stop","index":0}""",
        """data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}""",
        """data: {"type":"message_stop"}""",
    )

    fun anthropicTool(id: String, name: String, input: JSONObject, before: String = "") = buildList {
        add("""data: {"type":"message_start","message":{"id":"m","content":[]}}""")
        var index = 0
        if (before.isNotEmpty()) {
            add("""data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}""")
            add("data: " + JSONObject().put("type", "content_block_delta").put("index", 0).put("delta", JSONObject().put("type", "text_delta").put("text", before)))
            index = 1
        }
        add("data: " + JSONObject().put("type", "content_block_start").put("index", index).put("content_block", JSONObject().put("type", "tool_use").put("id", id).put("name", name).put("input", JSONObject())))
        val json = input.toString()
        val half = json.length / 2
        for (part in listOf(json.substring(0, half), json.substring(half))) {
            add("data: " + JSONObject().put("type", "content_block_delta").put("index", index).put("delta", JSONObject().put("type", "input_json_delta").put("partial_json", part)))
        }
        add("""data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}""")
        add("""data: {"type":"message_stop"}""")
    }

    fun openAiText(text: String) = listOf(
        "data: " + JSONObject().put("choices", JSONArray().put(JSONObject().put("index", 0).put("delta", JSONObject().put("content", text)))),
        """data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}""",
        "data: [DONE]",
    )

    fun openAiTool(id: String, name: String, input: JSONObject): List<String> {
        val json = input.toString()
        val half = json.length / 2
        fun chunk(call: JSONObject) = "data: " + JSONObject().put("choices", JSONArray().put(JSONObject().put("index", 0).put("delta", JSONObject().put("tool_calls", JSONArray().put(call)))))
        return listOf(
            chunk(JSONObject().put("index", 0).put("id", id).put("type", "function").put("function", JSONObject().put("name", name).put("arguments", ""))),
            chunk(JSONObject().put("index", 0).put("function", JSONObject().put("arguments", json.substring(0, half)))),
            chunk(JSONObject().put("index", 0).put("function", JSONObject().put("arguments", json.substring(half)))),
            """data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}""",
            "data: [DONE]",
        )
    }
}

class AiAgentTest {
    private val anthropic = AiProvider("anthropic", "Anthropic", AiProviderKind.Anthropic, "https://api.anthropic.com", "test-anthropic-key")
    private val openai = AiProvider("openai", "OpenAI", AiProviderKind.OpenAiCompatible, "https://api.openai.com/v1", "test-openai-key")
    private val ollama = AiProvider("ollama", "Ollama", AiProviderKind.OpenAiCompatible, "http://localhost:11434/v1", null)

    private val conversation = listOf(
        AiMsg.text("user", "What is on my plan page?"),
        AiMsg("assistant", listOf(AiPart.Text("Let me look."), AiPart.ToolCall("call_1", "pages_read", JSONObject().put("pageId", "p1")))),
        AiMsg("user", listOf(AiPart.ToolResult("call_1", "{\"title\":\"Plan\"}", false), AiPart.ToolResult("call_2", "page not found", true))),
    )

    // ---- request bodies

    @Test fun anthropicRequestOffersToolsAndCarriesToolTurns() {
        val request = AiToolWire.request(anthropic, "claude-test", "Be brief.", conversation, AiTools.ALL)
        assertEquals("https://api.anthropic.com/v1/messages", request.url)
        assertEquals("test-anthropic-key", request.headers["x-api-key"])
        assertEquals("application/json", request.headers["Content-Type"])
        val body = JSONObject(request.body!!)
        assertEquals(AiToolWire.AGENT_MAX_TOKENS, body.getInt("max_tokens"))
        assertTrue(body.getBoolean("stream"))
        assertEquals("Be brief.", body.getString("system"))
        val tools = body.getJSONArray("tools")
        assertEquals(AiTools.ALL.size, tools.length())
        val read = (0 until tools.length()).map { tools.getJSONObject(it) }.first { it.getString("name") == "pages_read" }
        assertEquals("object", read.getJSONObject("input_schema").getString("type"))
        assertEquals("pageId", read.getJSONObject("input_schema").getJSONArray("required").getString(0))
        val messages = body.getJSONArray("messages")
        assertEquals(3, messages.length())
        val assistant = messages.getJSONObject(1).getJSONArray("content")
        assertEquals("text", assistant.getJSONObject(0).getString("type"))
        val use = assistant.getJSONObject(1)
        assertEquals("tool_use", use.getString("type"))
        assertEquals("call_1", use.getString("id"))
        assertEquals("p1", use.getJSONObject("input").getString("pageId"))
        val results = messages.getJSONObject(2)
        assertEquals("user", results.getString("role"))
        val first = results.getJSONArray("content").getJSONObject(0)
        assertEquals("tool_result", first.getString("type"))
        assertEquals("call_1", first.getString("tool_use_id"))
        assertFalse(first.getBoolean("is_error"))
        assertTrue(results.getJSONArray("content").getJSONObject(1).getBoolean("is_error"))
    }

    @Test fun anthropicRequestWithoutToolsHasNoToolsKey() {
        val body = JSONObject(AiToolWire.request(anthropic, "claude-test", "", listOf(AiMsg.text("user", "Hi")), emptyList()).body!!)
        assertFalse(body.has("tools"))
        assertFalse(body.has("system"))
    }

    @Test fun openAiRequestOffersFunctionsAndToolMessages() {
        val request = AiToolWire.request(openai, "gpt-test", "Be brief.", conversation, AiTools.ALL)
        assertEquals("https://api.openai.com/v1/chat/completions", request.url)
        assertEquals("Bearer test-openai-key", request.headers["Authorization"])
        val body = JSONObject(request.body!!)
        val tool = body.getJSONArray("tools").getJSONObject(0)
        assertEquals("function", tool.getString("type"))
        assertEquals("workspace_overview", tool.getJSONObject("function").getString("name"))
        assertEquals("object", tool.getJSONObject("function").getJSONObject("parameters").getString("type"))
        val messages = body.getJSONArray("messages")
        assertEquals(listOf("system", "user", "assistant", "tool", "tool"), (0 until messages.length()).map { messages.getJSONObject(it).getString("role") })
        val assistant = messages.getJSONObject(2)
        assertEquals("Let me look.", assistant.getString("content"))
        val call = assistant.getJSONArray("tool_calls").getJSONObject(0)
        assertEquals("call_1", call.getString("id"))
        assertEquals("function", call.getString("type"))
        assertEquals("p1", JSONObject(call.getJSONObject("function").getString("arguments")).getString("pageId"))
        assertEquals("call_1", messages.getJSONObject(3).getString("tool_call_id"))
        assertEquals("Error: page not found", messages.getJSONObject(4).getString("content"))
    }

    @Test fun openAiAssistantWithOnlyToolCallsSendsNullContent() {
        val msgs = listOf(AiMsg.text("user", "Hi"), AiMsg("assistant", listOf(AiPart.ToolCall("c", "pages_list", JSONObject()))), AiMsg("user", listOf(AiPart.ToolResult("c", "[]", false))))
        val messages = AiToolWire.openAiBody("m", "", msgs, emptyList()).getJSONArray("messages")
        assertTrue(messages.getJSONObject(1).isNull("content"))
        assertFalse(AiToolWire.openAiBody("m", "", msgs, emptyList()).has("tools"))
    }

    @Test fun conversationIsNormalized() {
        val msgs = AiToolWire.normalized(listOf(AiMsg.text("assistant", "Hello"), AiMsg.text("user", "One"), AiMsg.text("user", " "), AiMsg.text("user", "Two")))
        assertEquals(1, msgs.size)
        assertEquals(listOf(AiPart.Text("One"), AiPart.Text("Two")), msgs[0].parts)
    }

    // ---- stream parsing

    @Test fun anthropicStreamCollectsTextAndToolCalls() {
        val stream = AiTurnStream(AiProviderKind.Anthropic)
        val events = Sse.anthropicTool("toolu_1", "pages_read", JSONObject().put("pageId", "p1"), before = "Reading.").flatMap { stream.line(it) } + stream.end()
        assertEquals(listOf(AiStreamEvent.Delta("Reading."), AiStreamEvent.Done), events)
        val turn = stream.turn()
        assertEquals("Reading.", turn.text)
        assertEquals("tool_use", turn.stop)
        assertEquals(1, turn.calls.size)
        assertEquals("toolu_1", turn.calls[0].id)
        assertEquals("pages_read", turn.calls[0].name)
        assertEquals("p1", turn.calls[0].input.getString("pageId"))
    }

    @Test fun openAiStreamCollectsSplitToolCalls() {
        val stream = AiTurnStream(AiProviderKind.OpenAiCompatible)
        val lines = Sse.openAiTool("call_a", "pages_search", JSONObject().put("query", "plan").put("limit", 5)).toMutableList()
        // A second call in the same turn, by index.
        lines.add(3, "data: " + JSONObject().put("choices", JSONArray().put(JSONObject().put("index", 0).put("delta", JSONObject().put("tool_calls", JSONArray().put(
            JSONObject().put("index", 1).put("id", "call_b").put("function", JSONObject().put("name", "tasks_list").put("arguments", "{}"))))))))
        val events = lines.flatMap { stream.line(it) }
        assertEquals(listOf(AiStreamEvent.Done), events)
        val turn = stream.turn()
        assertEquals("tool_calls", turn.stop)
        assertEquals(listOf("pages_search", "tasks_list"), turn.calls.map { it.name })
        assertEquals("plan", turn.calls[0].input.getString("query"))
        assertEquals(5, turn.calls[0].input.getInt("limit"))
        assertEquals("call_b", turn.calls[1].id)
    }

    @Test fun argumentsSurviveOddEncodings() {
        assertEquals("p", AiToolWire.parseArgs("\"{\\\"pageId\\\":\\\"p\\\"}\"").getString("pageId"))
        assertEquals(0, AiToolWire.parseArgs("").length())
        assertEquals(0, AiToolWire.parseArgs("not json").length())
        assertEquals(0, AiToolWire.parseArgs("[1,2]").length())
    }

    @Test fun wholeJsonAnswersAreReadAtTheEnd() {
        val stream = AiTurnStream(AiProviderKind.OpenAiCompatible)
        val body = """{"choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{"id":"c1","type":"function","function":{"name":"pages_list","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}"""
        // Pretty printed over several lines, as some servers do.
        val lines = JSONObject(body).toString(2).lines()
        assertTrue(lines.size > 3)
        lines.forEach { assertTrue(stream.line(it).isEmpty()) }
        assertTrue(stream.end().isEmpty())
        assertEquals(listOf("pages_list"), stream.turn().calls.map { it.name })

        val anthropicStream = AiTurnStream(AiProviderKind.Anthropic)
        anthropicStream.line("""{"content":[{"type":"text","text":"Hi"},{"type":"tool_use","id":"t","name":"pages_read","input":{"pageId":"x"}}],"stop_reason":"tool_use"}""")
        assertEquals(listOf(AiStreamEvent.Delta("Hi")), anthropicStream.end())
        assertEquals("x", anthropicStream.turn().calls.single().input.getString("pageId"))

        val failed = AiTurnStream(AiProviderKind.OpenAiCompatible)
        failed.line("""{"error":{"message":"bad request"}}""")
        assertEquals(listOf(AiStreamEvent.Failure("bad request")), failed.end())
    }

    @Test fun toolRefusalsAreRecognized() {
        assertTrue(AiToolWire.noToolSupport(400, """{"error":{"message":"registry.ollama.ai/library/gemma:2b does not support tools"}}"""))
        assertTrue(AiToolWire.noToolSupport(500, """{"error":{"message":"tools param requires --jinja flag"}}"""))
        assertTrue(AiToolWire.noToolSupport(400, """{"error":{"message":"Function calling is not enabled for this model"}}"""))
        assertFalse(AiToolWire.noToolSupport(400, """{"error":{"message":"max_tokens is too large"}}"""))
        assertFalse(AiToolWire.noToolSupport(401, """{"error":{"message":"tools not supported"}}"""))
    }

    // ---- the loop

    @Test fun loopRunsPagesReadThenAnswers() = runBlocking {
        val workspace = MemoryWorkspace()
        val page = workspace.add("Plan", markdown = "Ship the Android tools")
        val runner = AiToolRunner(workspace)
        val transport = FakeTransport(listOf(
            Sse.anthropicTool("toolu_1", "pages_read", JSONObject().put("pageId", page.id), before = "Let me read it."),
            Sse.anthropicText("Your plan is to ship the Android tools."),
        ))
        val events = ArrayList<AiAgentEvent>()
        val outcome = AiAgent.run(anthropic, "claude-test", "system", listOf(AiMsg.text("user", "What is my plan?")), AiTools.ALL, transport,
            host = { name, input -> runner.call(name, input) }, sink = { events.add(it) })
        assertEquals("Your plan is to ship the Android tools.", outcome.text)
        assertEquals(listOf(AiToolStep("pages_read", true)), outcome.steps)
        assertEquals(2, outcome.turns)
        assertFalse(outcome.chatOnly)
        assertEquals(2, transport.requests.size)
        assertTrue(events.contains(AiAgentEvent.ToolStarted("pages_read")))
        assertTrue(events.contains(AiAgentEvent.ToolFinished("pages_read", true)))
        assertEquals(AiAgentEvent.Delta("\n\n"), events[events.indexOf(AiAgentEvent.ToolFinished("pages_read", true)) + 1])
        // The second request carries the tool call and its result back to the model.
        val messages = transport.body(1).getJSONArray("messages")
        assertEquals(3, messages.length())
        val result = messages.getJSONObject(2).getJSONArray("content").getJSONObject(0)
        assertEquals("tool_result", result.getString("type"))
        assertEquals("toolu_1", result.getString("tool_use_id"))
        assertTrue(result.getString("content").contains("Ship the Android tools"))
        assertTrue(runner.changes.isEmpty())
    }

    @Test fun loopWorksForOpenAiDialect() = runBlocking {
        val workspace = MemoryWorkspace()
        val page = workspace.add("Groceries")
        val runner = AiToolRunner(workspace)
        val transport = FakeTransport(listOf(
            Sse.openAiTool("call_1", "tasks_add", JSONObject().put("pageId", page.id).put("items", JSONArray().put("Milk").put("Bread"))),
            Sse.openAiText("Added two items."),
        ))
        val outcome = AiAgent.run(openai, "gpt-test", "system", listOf(AiMsg.text("user", "Add milk and bread")), AiTools.ALL, transport,
            host = { name, input -> runner.call(name, input) }, sink = {})
        assertEquals("Added two items.", outcome.text)
        val messages = transport.body(1).getJSONArray("messages")
        assertEquals("tool", messages.getJSONObject(3).getString("role"))
        assertEquals("call_1", messages.getJSONObject(3).getString("tool_call_id"))
        assertEquals(1, runner.changes.size)
        assertTrue(workspace.markdown(page.id).contains("- [ ] Milk"))
    }

    @Test fun modelWithoutToolsFallsBackToChatOnlyOnce() = runBlocking {
        val transport = FakeTransport(listOf(
            AiHttpFailure(400, """{"error":{"message":"registry.ollama.ai/library/gemma:2b does not support tools"}}"""),
            Sse.openAiText("Hello there."),
        ))
        val events = ArrayList<AiAgentEvent>()
        var hostCalls = 0
        val outcome = AiAgent.run(ollama, "gemma:2b", "system", listOf(AiMsg.text("user", "Hi")), AiTools.ALL, transport,
            host = { _, _ -> hostCalls++; AiToolResult("", false) }, sink = { events.add(it) })
        assertTrue(outcome.chatOnly)
        assertEquals("Hello there.", outcome.text)
        assertEquals(2, transport.requests.size)
        assertTrue(transport.body(0).has("tools"))
        assertFalse(transport.body(1).has("tools"))
        assertNull(transport.requests[1].headers["Authorization"])
        assertEquals(AiAgentEvent.ChatOnly, events.first())
        assertEquals(0, hostCalls)
    }

    @Test fun otherErrorsAreNotRetried() = runBlocking {
        val transport = FakeTransport(listOf(AiHttpFailure(400, """{"error":{"message":"max_tokens is too large"}}""")))
        try {
            AiAgent.run(openai, "gpt-test", "", listOf(AiMsg.text("user", "Hi")), AiTools.ALL, transport, host = { _, _ -> AiToolResult("", false) }, sink = {})
            fail("expected an error")
        } catch (e: AiError.Server) {
            assertEquals("max_tokens is too large", e.detail)
        }
        assertEquals(1, transport.requests.size)
    }

    @Test fun unknownToolsAreReportedToTheModel() = runBlocking {
        val transport = FakeTransport(listOf(
            Sse.anthropicTool("t1", "pages_delete", JSONObject().put("pageId", "x")),
            Sse.anthropicText("I cannot delete pages here."),
        ))
        var hostCalls = 0
        val outcome = AiAgent.run(anthropic, "claude-test", "", listOf(AiMsg.text("user", "Delete it")), AiTools.ALL, transport,
            host = { _, _ -> hostCalls++; AiToolResult("", false) }, sink = {})
        assertEquals(0, hostCalls)
        assertEquals(listOf(AiToolStep("pages_delete", false)), outcome.steps)
        val result = transport.body(1).getJSONArray("messages").getJSONObject(2).getJSONArray("content").getJSONObject(0)
        assertTrue(result.getBoolean("is_error"))
        assertTrue(result.getString("content").contains("no tool named pages_delete"))
    }

    @Test fun loopStopsAtTheTurnLimit() = runBlocking {
        val transport = FakeTransport(listOf(Sse.anthropicTool("t", "workspace_overview", JSONObject())))
        try {
            AiAgent.run(anthropic, "claude-test", "", listOf(AiMsg.text("user", "Loop")), AiTools.ALL, transport, host = { _, _ -> AiToolResult("{}", false) }, sink = {})
            fail("expected the loop to stop")
        } catch (e: AiError.TooManySteps) {
            assertEquals(listOf<Any>(AiAgent.MAX_TURNS), e.messageArgs)
        }
        assertEquals(AiAgent.MAX_TURNS, transport.requests.size)
    }

    @Test fun streamErrorsStopTheLoop() = runBlocking {
        val transport = FakeTransport(listOf(listOf("""data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}""")))
        try {
            AiAgent.run(anthropic, "claude-test", "", listOf(AiMsg.text("user", "Hi")), AiTools.ALL, transport, host = { _, _ -> AiToolResult("", false) }, sink = {})
            fail("expected a stream error")
        } catch (e: AiError.Stream) {
            assertEquals(listOf<Any>("Anthropic", "Overloaded"), e.messageArgs)
        }
    }

    @Test fun repliesWithStepsAndChangesSurviveSaving() {
        val thread = ChatThread("t1", "Plan", "anthropic", "claude-test", listOf(
            ChatMessage("u", "user", "Add tasks", 1),
            ChatMessage("a", "assistant", "Done.", 2, steps = listOf(AiToolStep("tasks_add", true), AiToolStep("pages_read", false)),
                changes = listOf(AiPageChange("p1", "Plan", "v1", false), AiPageChange("p2", "New", null, true)), undone = true, chatOnly = true),
            ChatMessage("s", "assistant", "", 3, isStreaming = true),
        ), 1, 3, chatOnly = true)
        val decoded = ChatThreadJson.decode(ChatThreadJson.encode(thread))
        assertTrue(decoded.chatOnly)
        assertEquals(2, decoded.messages.size)
        val reply = decoded.messages[1]
        assertEquals(thread.messages[1].steps, reply.steps)
        assertEquals(thread.messages[1].changes, reply.changes)
        assertTrue(reply.undone)
        assertTrue(reply.chatOnly)
        // A running reply that already changed pages is kept, so its Undo is not lost.
        val running = thread.copy(messages = listOf(ChatMessage("r", "assistant", "", 4, isStreaming = true, changes = listOf(AiPageChange("p1", "Plan", "v1", false)))))
        assertEquals(1, ChatThreadJson.decode(ChatThreadJson.encode(running)).messages.single().changes.size)
    }
}
