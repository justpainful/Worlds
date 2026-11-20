import Foundation
import XCTest
import WorldsModels
@testable import WorldsAI

/// Sends nothing: answers each request with the next scripted reply (body
/// lines, or an HTTP failure). The last reply repeats.
final class FakeTransport: AITransport, @unchecked Sendable {
    enum Reply {
        case lines([String])
        case failure(AIHTTPFailure)
    }

    private let lock = NSLock()
    private let replies: [Reply]
    private var sent: [AIHTTPRequest] = []

    init(_ replies: [Reply]) {
        self.replies = replies
    }

    var requests: [AIHTTPRequest] { lock.withLock { sent } }

    func send(_ request: AIHTTPRequest, onLine: (String) async throws -> Bool) async throws -> AIHTTPFailure? {
        let reply: Reply = lock.withLock {
            sent.append(request)
            return replies[min(sent.count - 1, replies.count - 1)]
        }
        switch reply {
        case .failure(let failure):
            return failure
        case .lines(let lines):
            for line in lines {
                let keepReading = try await onLine(line)
                if !keepReading { break }
            }
            return nil
        }
    }

    func body(_ index: Int) throws -> [String: Any] {
        let request = requests[index]
        let data = try XCTUnwrap(request.body)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}

enum SSE {
    static func data(_ value: JSONValue) -> String { "data: " + value.aiCompact }

    static func anthropicText(_ text: String) -> [String] {
        [
            "event: message_start",
            #"data: {"type":"message_start","message":{"id":"m","content":[]}}"#,
            #"data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            data(.object(["type": .string("content_block_delta"), "index": .integer(0), "delta": .object(["type": .string("text_delta"), "text": .string(text)])])),
            #"data: {"type":"content_block_stop","index":0}"#,
            #"data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#,
            #"data: {"type":"message_stop"}"#,
        ]
    }

    static func anthropicTool(id: String, name: String, input: [String: JSONValue], before: String = "") -> [String] {
        var lines = [#"data: {"type":"message_start","message":{"id":"m","content":[]}}"#]
        var index: Int64 = 0
        if !before.isEmpty {
            lines.append(#"data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#)
            lines.append(data(.object(["type": .string("content_block_delta"), "index": .integer(0), "delta": .object(["type": .string("text_delta"), "text": .string(before)])])))
            index = 1
        }
        lines.append(data(.object(["type": .string("content_block_start"), "index": .integer(index),
                                   "content_block": .object(["type": .string("tool_use"), "id": .string(id), "name": .string(name), "input": .object([:])])])))
        let json = JSONValue.object(input).aiCompact
        let half = json.index(json.startIndex, offsetBy: json.count / 2)
        for part in [String(json[..<half]), String(json[half...])] {
            lines.append(data(.object(["type": .string("content_block_delta"), "index": .integer(index),
                                       "delta": .object(["type": .string("input_json_delta"), "partial_json": .string(part)])])))
        }
        lines.append(#"data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}"#)
        lines.append(#"data: {"type":"message_stop"}"#)
        return lines
    }

    static func openAIText(_ text: String) -> [String] {
        [
            data(.object(["choices": .array([.object(["index": .integer(0), "delta": .object(["content": .string(text)])])])])),
            #"data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}"#,
            "data: [DONE]",
        ]
    }

    static func openAIToolChunk(_ call: [String: JSONValue]) -> String {
        data(.object(["choices": .array([.object(["index": .integer(0), "delta": .object(["tool_calls": .array([.object(call)])])])])]))
    }

    static func openAITool(id: String, name: String, input: [String: JSONValue]) -> [String] {
        let json = JSONValue.object(input).aiCompact
        let half = json.index(json.startIndex, offsetBy: json.count / 2)
        return [
            openAIToolChunk(["index": .integer(0), "id": .string(id), "type": .string("function"),
                             "function": .object(["name": .string(name), "arguments": .string("")])]),
            openAIToolChunk(["index": .integer(0), "function": .object(["arguments": .string(String(json[..<half]))])]),
            openAIToolChunk(["index": .integer(0), "function": .object(["arguments": .string(String(json[half...]))])]),
            #"data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}"#,
            "data: [DONE]",
        ]
    }
}

private func providerPreset(_ id: String) throws -> AIProviderPreset {
    try XCTUnwrap(AIProviderPresets.preset(id: id))
}

final class AIToolWireTests: XCTestCase {
    private var anthropic: AIProviderConfiguration {
        get throws { AIProviderConfiguration(preset: try providerPreset("anthropic"), baseURL: "https://api.anthropic.com", apiKey: "test-anthropic-key") }
    }
    private var openAI: AIProviderConfiguration {
        get throws { AIProviderConfiguration(preset: try providerPreset("openai"), baseURL: "https://api.openai.com/v1", apiKey: "test-openai-key") }
    }

    private let conversation = [
        AIMessage.text(.user, "What is on my plan page?"),
        AIMessage(role: .assistant, parts: [.text("Let me look."), .toolCall(id: "call_1", name: "pages_read", input: ["pageId": .string("p1")])]),
        AIMessage(role: .user, parts: [.toolResult(id: "call_1", output: #"{"title":"Plan"}"#, isError: false),
                                       .toolResult(id: "call_2", output: "page not found", isError: true)]),
    ]

    private func json(_ request: AIHTTPRequest) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.body)) as? [String: Any])
    }

    func testAnthropicRequestOffersToolsAndCarriesToolTurns() throws {
        let request = try AIToolWire.request(anthropic, model: "claude-test", system: "Be brief.", messages: conversation, tools: AITools.all)
        XCTAssertEqual(request.url.absoluteString, "https://api.anthropic.com/v1/messages")
        XCTAssertEqual(request.headers["x-api-key"], "test-anthropic-key")
        XCTAssertEqual(request.headers["anthropic-version"], "2023-06-01")
        XCTAssertEqual(request.headers["Content-Type"], "application/json")
        let body = try json(request)
        XCTAssertEqual(body["max_tokens"] as? Int, AIToolWire.agentMaxTokens)
        XCTAssertEqual(body["stream"] as? Bool, true)
        XCTAssertEqual(body["system"] as? String, "Be brief.")
        let tools = try XCTUnwrap(body["tools"] as? [[String: Any]])
        XCTAssertEqual(tools.count, AITools.all.count)
        let read = try XCTUnwrap(tools.first { $0["name"] as? String == "pages_read" })
        let schema = try XCTUnwrap(read["input_schema"] as? [String: Any])
        XCTAssertEqual(schema["type"] as? String, "object")
        XCTAssertEqual(schema["required"] as? [String], ["pageId"])
        let messages = try XCTUnwrap(body["messages"] as? [[String: Any]])
        XCTAssertEqual(messages.count, 3)
        let assistant = try XCTUnwrap(messages[1]["content"] as? [[String: Any]])
        XCTAssertEqual(assistant[0]["type"] as? String, "text")
        XCTAssertEqual(assistant[1]["type"] as? String, "tool_use")
        XCTAssertEqual(assistant[1]["id"] as? String, "call_1")
        XCTAssertEqual((assistant[1]["input"] as? [String: Any])?["pageId"] as? String, "p1")
        XCTAssertEqual(messages[2]["role"] as? String, "user")
        let results = try XCTUnwrap(messages[2]["content"] as? [[String: Any]])
        XCTAssertEqual(results[0]["type"] as? String, "tool_result")
        XCTAssertEqual(results[0]["tool_use_id"] as? String, "call_1")
        XCTAssertEqual(results[0]["is_error"] as? Bool, false)
        XCTAssertEqual(results[1]["is_error"] as? Bool, true)
    }

    func testAnthropicRequestWithoutToolsHasNoToolsKey() throws {
        let body = try json(AIToolWire.request(anthropic, model: "claude-test", system: "", messages: [.text(.user, "Hi")], tools: []))
        XCTAssertNil(body["tools"])
        XCTAssertNil(body["system"])
    }

    func testOpenAIRequestOffersFunctionsAndToolMessages() throws {
        let request = try AIToolWire.request(openAI, model: "gpt-test", system: "Be brief.", messages: conversation, tools: AITools.all)
        XCTAssertEqual(request.url.absoluteString, "https://api.openai.com/v1/chat/completions")
        XCTAssertEqual(request.headers["Authorization"], "Bearer test-openai-key")
        let body = try json(request)
        let tool = try XCTUnwrap((body["tools"] as? [[String: Any]])?.first)
        XCTAssertEqual(tool["type"] as? String, "function")
        let function = try XCTUnwrap(tool["function"] as? [String: Any])
        XCTAssertEqual(function["name"] as? String, "workspace_overview")
        XCTAssertEqual((function["parameters"] as? [String: Any])?["type"] as? String, "object")
        let messages = try XCTUnwrap(body["messages"] as? [[String: Any]])
        XCTAssertEqual(messages.compactMap { $0["role"] as? String }, ["system", "user", "assistant", "tool", "tool"])
        XCTAssertEqual(messages[2]["content"] as? String, "Let me look.")
        let call = try XCTUnwrap((messages[2]["tool_calls"] as? [[String: Any]])?.first)
        XCTAssertEqual(call["id"] as? String, "call_1")
        XCTAssertEqual(call["type"] as? String, "function")
        let arguments = try XCTUnwrap((call["function"] as? [String: Any])?["arguments"] as? String)
        XCTAssertEqual(AIToolWire.parseArguments(arguments)["pageId"], .string("p1"))
        XCTAssertEqual(messages[3]["tool_call_id"] as? String, "call_1")
        XCTAssertEqual(messages[4]["content"] as? String, "Error: page not found")
    }

    func testOpenAIAssistantWithOnlyToolCallsSendsNullContent() throws {
        let messages: [AIMessage] = [
            .text(.user, "Hi"),
            AIMessage(role: .assistant, parts: [.toolCall(id: "c", name: "pages_list", input: [:])]),
            AIMessage(role: .user, parts: [.toolResult(id: "c", output: "[]", isError: false)]),
        ]
        let body = AIToolWire.openAIBody(model: "m", system: "", messages: messages, tools: [])
        let list = body.aiObject?["messages"]?.aiArray ?? []
        XCTAssertEqual(list[1].aiObject?["content"], .null)
        XCTAssertNil(body.aiObject?["tools"])
    }

    func testConversationIsNormalized() {
        let messages = AIToolWire.normalized([.text(.assistant, "Hello"), .text(.user, "One"), .text(.user, " "), .text(.user, "Two")])
        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages[0].parts, [.text("One"), .text("Two")])
    }

    func testAnthropicStreamCollectsTextAndToolCalls() {
        var stream = AITurnStream(dialect: .anthropic)
        var events: [AIStreamEvent] = []
        for line in SSE.anthropicTool(id: "toolu_1", name: "pages_read", input: ["pageId": .string("p1")], before: "Reading.") {
            events += stream.line(line)
        }
        events += stream.end()
        XCTAssertEqual(events, [.delta("Reading."), .done])
        let turn = stream.turn()
        XCTAssertEqual(turn.text, "Reading.")
        XCTAssertEqual(turn.stop, "tool_use")
        XCTAssertEqual(turn.calls, [AIToolCall(id: "toolu_1", name: "pages_read", input: ["pageId": .string("p1")])])
    }

    func testOpenAIStreamCollectsSplitToolCalls() {
        var stream = AITurnStream(dialect: .openAI)
        var lines = SSE.openAITool(id: "call_a", name: "pages_search", input: ["query": .string("plan"), "limit": .integer(5)])
        // A second call in the same turn, by index.
        lines.insert(SSE.openAIToolChunk(["index": .integer(1), "id": .string("call_b"),
                                          "function": .object(["name": .string("tasks_list"), "arguments": .string("{}")])]), at: 3)
        var events: [AIStreamEvent] = []
        for line in lines { events += stream.line(line) }
        XCTAssertEqual(events, [.done])
        let turn = stream.turn()
        XCTAssertEqual(turn.stop, "tool_calls")
        XCTAssertEqual(turn.calls.map(\.name), ["pages_search", "tasks_list"])
        XCTAssertEqual(turn.calls[0].input["query"], .string("plan"))
        XCTAssertEqual(turn.calls[0].input["limit"], .integer(5))
        XCTAssertEqual(turn.calls[1].id, "call_b")
    }

    func testArgumentsSurviveOddEncodings() {
        XCTAssertEqual(AIToolWire.parseArguments(#""{\"pageId\":\"p\"}""#)["pageId"], .string("p"))
        XCTAssertEqual(AIToolWire.parseArguments(#"{"pageId":"p"}"#)["pageId"], .string("p"))
        XCTAssertTrue(AIToolWire.parseArguments("").isEmpty)
        XCTAssertTrue(AIToolWire.parseArguments("not json").isEmpty)
        XCTAssertTrue(AIToolWire.parseArguments("[1,2]").isEmpty)
        // Arguments that arrive as an object instead of a string.
        var stream = AITurnStream(dialect: .openAI)
        _ = stream.line(SSE.openAIToolChunk(["index": .integer(0), "id": .string("c"),
                                              "function": .object(["name": .string("pages_read"), "arguments": .object(["pageId": .string("x")])])]))
        XCTAssertEqual(stream.turn().calls.first?.input["pageId"], .string("x"))
    }

    func testWholeJSONAnswersAreReadAtTheEnd() throws {
        var stream = AITurnStream(dialect: .openAI)
        let pretty = """
        {
          "choices": [
            {
              "index": 0,
              "message": {
                "role": "assistant",
                "content": null,
                "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "pages_list", "arguments": "{}"}}]
              },
              "finish_reason": "tool_calls"
            }
          ]
        }
        """
        for line in pretty.components(separatedBy: "\n") { XCTAssertTrue(stream.line(line).isEmpty) }
        XCTAssertTrue(stream.end().isEmpty)
        XCTAssertEqual(stream.turn().calls.map(\.name), ["pages_list"])

        var anthropic = AITurnStream(dialect: .anthropic)
        _ = anthropic.line(#"{"content":[{"type":"text","text":"Hi"},{"type":"tool_use","id":"t","name":"pages_read","input":{"pageId":"x"}}],"stop_reason":"tool_use"}"#)
        XCTAssertEqual(anthropic.end(), [.delta("Hi")])
        XCTAssertEqual(anthropic.turn().calls.first?.input["pageId"], .string("x"))

        var failed = AITurnStream(dialect: .openAI)
        _ = failed.line(#"{"error":{"message":"bad request"}}"#)
        XCTAssertEqual(failed.end(), [.failure("bad request")])
    }

    func testToolRefusalsAreRecognized() {
        XCTAssertTrue(AIToolWire.noToolSupport(status: 400, body: #"{"error":{"message":"registry.ollama.ai/library/gemma:2b does not support tools"}}"#))
        XCTAssertTrue(AIToolWire.noToolSupport(status: 500, body: #"{"error":{"message":"tools param requires --jinja flag"}}"#))
        XCTAssertTrue(AIToolWire.noToolSupport(status: 400, body: #"{"error":{"message":"Function calling is not enabled for this model"}}"#))
        XCTAssertFalse(AIToolWire.noToolSupport(status: 400, body: #"{"error":{"message":"max_tokens is too large"}}"#))
        // A bad key or a rate limit is never a model refusing tools, whatever the text says.
        for status in [401, 403, 429] {
            XCTAssertFalse(AIToolWire.noToolSupport(status: status, body: #"{"error":{"message":"tools not supported"}}"#), "\(status)")
        }
        XCTAssertFalse(AIToolWire.noToolSupport(status: 503, body: "tools not supported"))
    }
}

final class AIAgentLoopTests: XCTestCase {
    private func configuration(_ id: String, key: String?) throws -> AIProviderConfiguration {
        let preset = try providerPreset(id)
        return AIProviderConfiguration(preset: preset, baseURL: preset.baseURL, apiKey: key)
    }

    func testLoopRunsPagesReadThenAnswers() async throws {
        let workspace = MemoryWorkspace()
        let page = try await workspace.add("Plan", markdown: "Ship the Apple tools")
        let runner = AIToolRunner(workspace: workspace)
        let transport = FakeTransport([
            .lines(SSE.anthropicTool(id: "toolu_1", name: "pages_read", input: ["pageId": .string(page.id)], before: "Let me read it.")),
            .lines(SSE.anthropicText("Your plan is to ship the Apple tools.")),
        ])
        var events: [AIAgentEvent] = []
        let outcome = try await AIAgent.run(
            configuration: configuration("anthropic", key: "test-anthropic-key"), model: "claude-test", system: "system",
            history: [.text(.user, "What is my plan?")], tools: AITools.all, transport: transport,
            host: { name, input in await runner.call(name, input) },
            sink: { events.append($0) })
        XCTAssertEqual(outcome.text, "Your plan is to ship the Apple tools.")
        XCTAssertEqual(outcome.steps, [AIToolStep(tool: "pages_read", ok: true)])
        XCTAssertEqual(outcome.turns, 2)
        XCTAssertFalse(outcome.chatOnly)
        XCTAssertEqual(transport.requests.count, 2)
        XCTAssertEqual(events.first, .delta("Let me read it."))
        XCTAssertTrue(events.contains(.toolStarted("pages_read")))
        let finished = try XCTUnwrap(events.firstIndex(of: .toolFinished("pages_read", ok: true)))
        XCTAssertEqual(events[finished + 1], .delta("\n\n"))
        // The second request carries the tool call and its result back to the model.
        let messages = try XCTUnwrap(transport.body(1)["messages"] as? [[String: Any]])
        XCTAssertEqual(messages.count, 3)
        let result = try XCTUnwrap((messages[2]["content"] as? [[String: Any]])?.first)
        XCTAssertEqual(result["type"] as? String, "tool_result")
        XCTAssertEqual(result["tool_use_id"] as? String, "toolu_1")
        XCTAssertTrue((result["content"] as? String ?? "").contains("Ship the Apple tools"))
        let changes = await runner.changes
        XCTAssertTrue(changes.isEmpty)
    }

    func testLoopWorksForOpenAIDialect() async throws {
        let workspace = MemoryWorkspace()
        let page = try await workspace.add("Groceries")
        let runner = AIToolRunner(workspace: workspace)
        let transport = FakeTransport([
            .lines(SSE.openAITool(id: "call_1", name: "tasks_add", input: ["pageId": .string(page.id), "items": .array([.string("Milk"), .string("Bread")])])),
            .lines(SSE.openAIText("Added two items.")),
        ])
        let outcome = try await AIAgent.run(
            configuration: configuration("openai", key: "test-openai-key"), model: "gpt-test", system: "system",
            history: [.text(.user, "Add milk and bread")], tools: AITools.all, transport: transport,
            host: { name, input in await runner.call(name, input) }, sink: { _ in })
        XCTAssertEqual(outcome.text, "Added two items.")
        let messages = try XCTUnwrap(transport.body(1)["messages"] as? [[String: Any]])
        XCTAssertEqual(messages[3]["role"] as? String, "tool")
        XCTAssertEqual(messages[3]["tool_call_id"] as? String, "call_1")
        let changes = await runner.changes
        XCTAssertEqual(changes.count, 1)
        let markdown = await workspace.markdown(page.id)
        XCTAssertEqual(markdown, "- [ ] Milk\n- [ ] Bread")
    }

    func testModelWithoutToolsFallsBackToChatOnlyOnce() async throws {
        let transport = FakeTransport([
            .failure(AIHTTPFailure(status: 400, body: #"{"error":{"message":"registry.ollama.ai/library/gemma:2b does not support tools"}}"#)),
            .lines(SSE.openAIText("Hello there.")),
        ])
        var events: [AIAgentEvent] = []
        var hostCalls = 0
        let outcome = try await AIAgent.run(
            configuration: configuration("ollama", key: nil), model: "gemma:2b", system: "system",
            history: [.text(.user, "Hi")], tools: AITools.all, transport: transport,
            host: { _, _ in hostCalls += 1; return AIToolResult(output: "", isError: false) },
            sink: { events.append($0) })
        XCTAssertTrue(outcome.chatOnly)
        XCTAssertEqual(outcome.text, "Hello there.")
        XCTAssertEqual(transport.requests.count, 2)
        XCTAssertNotNil(try transport.body(0)["tools"])
        XCTAssertNil(try transport.body(1)["tools"])
        XCTAssertNil(transport.requests[1].headers["Authorization"])
        XCTAssertEqual(events.first, .chatOnly)
        XCTAssertEqual(hostCalls, 0)
    }

    func testRejectedKeyIsNotTreatedAsARefusal() async throws {
        for (status, expected) in [(401, AIProviderError.badKey(provider: "OpenAI")),
                                   (403, AIProviderError.badKey(provider: "OpenAI")),
                                   (429, AIProviderError.rateLimited(provider: "OpenAI", detail: "tools not supported"))] {
            let transport = FakeTransport([
                .failure(AIHTTPFailure(status: status, body: #"{"error":{"message":"tools not supported"}}"#)),
                .lines(SSE.openAIText("This reply must never be requested.")),
            ])
            var events: [AIAgentEvent] = []
            do {
                _ = try await AIAgent.run(
                    configuration: configuration("openai", key: "test-openai-key"), model: "gpt-test", system: "",
                    history: [.text(.user, "Hi")], tools: AITools.all, transport: transport,
                    host: { _, _ in AIToolResult(output: "", isError: false) }, sink: { events.append($0) })
                XCTFail("expected \(expected)")
            } catch let error as AIProviderError {
                XCTAssertEqual(error, expected)
            }
            XCTAssertEqual(transport.requests.count, 1, "\(status)")
            XCTAssertFalse(events.contains(.chatOnly), "\(status)")
        }
    }

    func testOtherErrorsAreNotRetried() async throws {
        let transport = FakeTransport([.failure(AIHTTPFailure(status: 400, body: #"{"error":{"message":"max_tokens is too large"}}"#))])
        do {
            _ = try await AIAgent.run(
                configuration: configuration("openai", key: "test-openai-key"), model: "gpt-test", system: "",
                history: [.text(.user, "Hi")], tools: AITools.all, transport: transport,
                host: { _, _ in AIToolResult(output: "", isError: false) }, sink: { _ in })
            XCTFail("expected an error")
        } catch let error as AIProviderError {
            XCTAssertEqual(error, .server(provider: "OpenAI", status: 400, detail: "max_tokens is too large"))
        }
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testUnknownToolsAreReportedToTheModel() async throws {
        let transport = FakeTransport([
            .lines(SSE.anthropicTool(id: "t1", name: "pages_delete", input: ["pageId": .string("x")])),
            .lines(SSE.anthropicText("I cannot delete pages here.")),
        ])
        var hostCalls = 0
        let outcome = try await AIAgent.run(
            configuration: configuration("anthropic", key: "test-anthropic-key"), model: "claude-test", system: "",
            history: [.text(.user, "Delete it")], tools: AITools.all, transport: transport,
            host: { _, _ in hostCalls += 1; return AIToolResult(output: "", isError: false) }, sink: { _ in })
        XCTAssertEqual(hostCalls, 0)
        XCTAssertEqual(outcome.steps, [AIToolStep(tool: "pages_delete", ok: false)])
        let messages = try XCTUnwrap(transport.body(1)["messages"] as? [[String: Any]])
        let result = try XCTUnwrap((messages[2]["content"] as? [[String: Any]])?.first)
        XCTAssertEqual(result["is_error"] as? Bool, true)
        XCTAssertTrue((result["content"] as? String ?? "").contains("no tool named pages_delete"))
    }

    func testLoopStopsAtTheTurnLimit() async throws {
        let transport = FakeTransport([.lines(SSE.anthropicTool(id: "t", name: "workspace_overview", input: [:]))])
        do {
            _ = try await AIAgent.run(
                configuration: configuration("anthropic", key: "test-anthropic-key"), model: "claude-test", system: "",
                history: [.text(.user, "Loop")], tools: AITools.all, transport: transport,
                host: { _, _ in AIToolResult(output: "{}", isError: false) }, sink: { _ in })
            XCTFail("expected the loop to stop")
        } catch let error as AIProviderError {
            XCTAssertEqual(error, .tooManySteps(limit: AIAgent.maxTurns))
        }
        XCTAssertEqual(transport.requests.count, AIAgent.maxTurns)
    }

    func testStreamErrorsStopTheLoopWithoutTheKey() async throws {
        let transport = FakeTransport([.lines([#"data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded for test-anthropic-key"}}"#])])
        do {
            _ = try await AIAgent.run(
                configuration: configuration("anthropic", key: "test-anthropic-key"), model: "claude-test", system: "",
                history: [.text(.user, "Hi")], tools: AITools.all, transport: transport,
                host: { _, _ in AIToolResult(output: "", isError: false) }, sink: { _ in })
            XCTFail("expected a stream error")
        } catch let error as AIProviderError {
            XCTAssertEqual(error, .stream(provider: "Anthropic", detail: "Overloaded for [key]"))
        }
    }

    func testAnEmptyReplyIsMalformed() async throws {
        let transport = FakeTransport([.lines(["data: [DONE]"])])
        do {
            _ = try await AIAgent.run(
                configuration: configuration("openai", key: "test-openai-key"), model: "gpt-test", system: "",
                history: [.text(.user, "Hi")], tools: [], transport: transport,
                host: { _, _ in AIToolResult(output: "", isError: false) }, sink: { _ in })
            XCTFail("expected an error")
        } catch let error as AIProviderError {
            XCTAssertEqual(error, .malformed(provider: "OpenAI"))
        }
    }
}
