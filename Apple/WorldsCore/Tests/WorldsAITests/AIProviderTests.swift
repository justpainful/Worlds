import Foundation
import XCTest
@testable import WorldsAI

/// In memory key store, so tests never touch the real Keychain.
private final class MemoryKeyStore: AIKeyStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var keys: [String: String] = [:]
    func hasKey(providerID: String) -> Bool { lock.withLock { keys[providerID] != nil } }
    func key(providerID: String) throws -> String? { lock.withLock { keys[providerID] } }
    func setKey(_ key: String, providerID: String) throws { lock.withLock { keys[providerID] = key } }
    func deleteKey(providerID: String) throws { lock.withLock { _ = keys.removeValue(forKey: providerID) } }
}

private func preset(_ id: String) throws -> AIProviderPreset {
    try XCTUnwrap(AIProviderPresets.preset(id: id))
}

private func jsonBody(_ request: AIHTTPRequest) throws -> [String: Any] {
    let body = try XCTUnwrap(request.body)
    return try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
}

final class AIProviderPresetSyncTests: XCTestCase {
    /// Keeps the Swift copy in step with `src/ai/providers.json`, the list Windows and Android read.
    func testPresetsMatchSharedProvidersJSON() throws {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        let url = root.appendingPathComponent("src/ai/providers.json")
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw XCTSkip("src/ai/providers.json is not next to this package")
        }
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let providers = try XCTUnwrap(object["providers"] as? [[String: Any]])
        let shared = providers.filter { ($0["kind"] as? String) != "runner" }
        XCTAssertEqual(shared.map { ($0["id"] as? String) ?? "" }, AIProviderPresets.all.map(\.id))
        for item in shared {
            let id = (item["id"] as? String) ?? ""
            let swift = try preset(id)
            XCTAssertEqual(swift.name, item["name"] as? String, id)
            XCTAssertEqual(swift.api.rawValue, item["api"] as? String, id)
            XCTAssertEqual(swift.kind.rawValue, item["kind"] as? String, id)
            XCTAssertEqual(swift.baseURL, (item["baseUrl"] as? String) ?? "", id)
            XCTAssertEqual(swift.key.rawValue, item["key"] as? String, id)
            XCTAssertEqual(swift.editableBaseURL, (item["editableBaseUrl"] as? Bool) ?? false, id)
            XCTAssertEqual(swift.modelsPath, (item["modelsPath"] as? String) ?? "", id)
            XCTAssertEqual(swift.note, item["note"] as? String, id)
        }
    }

    func testRunnersAreLeftOut() {
        XCTAssertNil(AIProviderPresets.preset(id: "claude-code"))
        XCTAssertNil(AIProviderPresets.preset(id: "codex"))
        XCTAssertEqual(AIProviderPresets.preset(id: "ollama")?.baseURL, "http://localhost:11434/v1")
        XCTAssertEqual(AIProviderPresets.preset(id: "lmstudio")?.baseURL, "http://localhost:1234/v1")
        XCTAssertEqual(AIProviderPresets.preset(id: "llamacpp")?.baseURL, "http://localhost:8080/v1")
    }
}

final class AIProviderRequestTests: XCTestCase {
    private let turns = [
        AITurn(role: .assistant, content: "dropped, the conversation must start with the person"),
        AITurn(role: .user, content: "Hello"),
        AITurn(role: .user, content: "Are you there?"),
        AITurn(role: .assistant, content: "   "),
        AITurn(role: .assistant, content: "Yes."),
    ]

    func testAnthropicChatRequest() throws {
        let configuration = AIProviderConfiguration(preset: try preset("anthropic"), baseURL: "https://api.anthropic.com/", apiKey: " sk-ant-api03-test ")
        let request = try AIRequests.chatRequest(configuration, model: "claude-sonnet-4-5", system: "Be brief.", turns: turns)
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.url.absoluteString, "https://api.anthropic.com/v1/messages")
        XCTAssertEqual(request.headers["x-api-key"], "sk-ant-api03-test")
        XCTAssertEqual(request.headers["anthropic-version"], "2023-06-01")
        XCTAssertEqual(request.headers["Accept"], "text/event-stream")
        XCTAssertEqual(request.headers["Content-Type"], "application/json")
        XCTAssertNil(request.headers["Authorization"])
        let body = try jsonBody(request)
        XCTAssertEqual(body["model"] as? String, "claude-sonnet-4-5")
        XCTAssertEqual(body["stream"] as? Bool, true)
        XCTAssertEqual(body["max_tokens"] as? Int, 4096)
        XCTAssertEqual(body["system"] as? String, "Be brief.")
        let messages = try XCTUnwrap(body["messages"] as? [[String: String]])
        XCTAssertEqual(messages, [
            ["role": "user", "content": "Hello\n\nAre you there?"],
            ["role": "assistant", "content": "Yes."],
        ])
    }

    func testAnthropicBaseThatAlreadyEndsInV1() throws {
        let configuration = AIProviderConfiguration(preset: try preset("anthropic"), baseURL: "https://proxy.example.com/v1", apiKey: "k")
        XCTAssertEqual(try AIRequests.chatRequest(configuration, model: "m", system: "", turns: turns).url.absoluteString, "https://proxy.example.com/v1/messages")
        XCTAssertEqual(try AIRequests.modelsRequest(configuration).url.absoluteString, "https://proxy.example.com/v1/models?limit=1000")
    }

    func testOpenAIChatRequest() throws {
        let configuration = AIProviderConfiguration(preset: try preset("openai"), baseURL: "https://api.openai.com/v1", apiKey: "sk-test")
        let request = try AIRequests.chatRequest(configuration, model: "gpt-4.1", system: "Be brief.", turns: turns)
        XCTAssertEqual(request.url.absoluteString, "https://api.openai.com/v1/chat/completions")
        XCTAssertEqual(request.headers["Authorization"], "Bearer sk-test")
        XCTAssertNil(request.headers["x-api-key"])
        XCTAssertNil(request.headers["anthropic-version"])
        let body = try jsonBody(request)
        XCTAssertEqual(body["stream"] as? Bool, true)
        XCTAssertNil(body["max_tokens"])
        let messages = try XCTUnwrap(body["messages"] as? [[String: String]])
        XCTAssertEqual(messages.first, ["role": "system", "content": "Be brief."])
        XCTAssertEqual(messages.count, 3)
        XCTAssertEqual(messages.last, ["role": "assistant", "content": "Yes."])
    }

    func testLocalServersSendNoKeyAndOllamaListsTags() throws {
        let ollama = AIProviderConfiguration(preset: try preset("ollama"), baseURL: "http://localhost:11434/v1", apiKey: nil)
        let chat = try AIRequests.chatRequest(ollama, model: "llama3.2:latest", system: "", turns: turns)
        XCTAssertEqual(chat.url.absoluteString, "http://localhost:11434/v1/chat/completions")
        XCTAssertNil(chat.headers["Authorization"])
        let messages = try XCTUnwrap(try jsonBody(chat)["messages"] as? [[String: String]])
        XCTAssertEqual(messages.first?["role"], "user", "an empty system prompt is left out")
        XCTAssertEqual(try AIRequests.modelsRequest(ollama).url.absoluteString, "http://localhost:11434/api/tags")

        let lmstudio = AIProviderConfiguration(preset: try preset("lmstudio"), baseURL: "http://localhost:1234/v1", apiKey: nil)
        XCTAssertEqual(try AIRequests.modelsRequest(lmstudio).url.absoluteString, "http://localhost:1234/v1/models")
        XCTAssertEqual(try AIRequests.modelsRequest(lmstudio).headers, ["Accept": "application/json"])
    }

    func testOpenRouterNamesWorlds() throws {
        let configuration = AIProviderConfiguration(preset: try preset("openrouter"), baseURL: "https://openrouter.ai/api/v1", apiKey: "k")
        XCTAssertEqual(try AIRequests.modelsRequest(configuration).headers["X-Title"], "Worlds")
    }

    func testBadAddressesAreRefused() throws {
        let custom = try preset("custom")
        for address in ["", "localhost:8080/v1", "ftp://host/v1", "https://", "https://user:pass@host/v1", "https://ho st/v1"] {
            XCTAssertFalse(AIRequests.isValidBase(address), address)
            let configuration = AIProviderConfiguration(preset: custom, baseURL: address, apiKey: nil)
            XCTAssertThrowsError(try AIRequests.chatRequest(configuration, model: "m", system: "", turns: turns), address) { error in
                XCTAssertEqual(error as? AIProviderError, .badURL(provider: "Custom"))
            }
        }
        XCTAssertTrue(AIRequests.isValidBase("http://192.168.1.20:11434/v1/"))
        XCTAssertTrue(AIRequests.isLocal("http://192.168.1.20:11434/v1"))
        XCTAssertTrue(AIRequests.isLocal("http://localhost:1234/v1"))
        XCTAssertFalse(AIRequests.isLocal("https://api.openai.com/v1"))
        XCTAssertEqual(AIRequests.host("http://localhost:1234/v1"), "localhost:1234")
    }

    func testClientChecksKeyAndModelBeforeSending() throws {
        let missingKey = AIProviderClient(configuration: AIProviderConfiguration(preset: try preset("openai"), baseURL: "https://api.openai.com/v1", apiKey: "  "))
        XCTAssertThrowsError(try missingKey.checkReady(model: "gpt-4.1")) { XCTAssertEqual($0 as? AIProviderError, .noKey(provider: "OpenAI")) }
        let local = AIProviderClient(configuration: AIProviderConfiguration(preset: try preset("ollama"), baseURL: "http://localhost:11434/v1", apiKey: nil))
        XCTAssertNoThrow(try local.checkReady(model: "llama3.2"))
        XCTAssertThrowsError(try local.checkReady(model: " ")) { XCTAssertEqual($0 as? AIProviderError, .noModel(provider: "Ollama")) }
    }

    func testConfigurationNeverPrintsTheKey() throws {
        let secret = "sk-ant-api03-SECRETVALUE"
        let configuration = AIProviderConfiguration(preset: try preset("anthropic"), baseURL: "https://api.anthropic.com", apiKey: secret)
        var dumped = ""
        dump(configuration, to: &dumped)
        for text in [configuration.description, configuration.debugDescription, String(describing: configuration), String(reflecting: configuration), dumped] {
            XCTAssertFalse(text.contains(secret), text)
        }
        let request = try AIRequests.modelsRequest(configuration)
        XCTAssertFalse(String(describing: request).contains(secret))
    }
}

final class AIProviderStreamTests: XCTestCase {
    private func decode(_ dialect: AIProviderDialect, _ stream: String, chunk: Int) -> [AIStreamEvent] {
        var parser = AISSEParser()
        let decoder = AIStreamDecoder(dialect: dialect)
        var out: [AIStreamEvent] = []
        let bytes = Array(stream.utf8)
        var index = 0
        while index < bytes.count {
            let end = min(index + chunk, bytes.count)
            for event in parser.push(bytes: Data(bytes[index..<end])) { out.append(contentsOf: decoder.decode(event)) }
            index = end
        }
        for event in parser.finish() { out.append(contentsOf: decoder.decode(event)) }
        return out
    }

    func testAnthropicStream() {
        let stream = """
        event: message_start
        data: {"type":"message_start","message":{"id":"msg_1","role":"assistant","content":[]}}

        event: content_block_start
        data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

        event: ping
        data: {"type": "ping"}

        event: content_block_delta
        data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

        event: content_block_delta
        data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" مرحبا"}}

        event: content_block_stop
        data: {"type":"content_block_stop","index":0}

        event: message_delta
        data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}

        event: message_stop
        data: {"type":"message_stop"}


        """
        // Small chunks split lines and the two byte Arabic letters.
        for chunk in [1, 3, 7, 4096] {
            XCTAssertEqual(decode(.anthropic, stream, chunk: chunk), [.delta("Hello"), .delta(" مرحبا"), .done], "chunk \(chunk)")
        }
    }

    func testAnthropicErrorEvent() {
        let stream = "event: error\r\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\r\n\r\n"
        XCTAssertEqual(decode(.anthropic, stream, chunk: 5), [.failure("Overloaded")])
    }

    func testOpenAIStream() {
        let stream = """
        : keep alive

        data: {"id":"1","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}

        data: {"id":"1","choices":[{"index":0,"delta":{"content":"Hi"}}]}

        data: {"id":"1","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}

        data: {"id":"1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

        data: [DONE]

        """
        for chunk in [1, 2, 4096] {
            XCTAssertEqual(decode(.openAI, stream, chunk: chunk), [.delta("Hi"), .delta(" there"), .done], "chunk \(chunk)")
        }
    }

    func testOpenAIErrorAndPlainJSONLine() {
        XCTAssertEqual(decode(.openAI, "data: {\"error\":{\"message\":\"model overloaded\"}}\n\n", chunk: 4096), [.failure("model overloaded")])
        XCTAssertEqual(decode(.openAI, "{\"error\":\"bad request\"}\n", chunk: 4096), [.failure("bad request")])
    }

    func testMultiLineDataAndLastEventWithoutBlankLine() {
        var parser = AISSEParser()
        XCTAssertEqual(parser.push(line: "event: note"), [])
        XCTAssertEqual(parser.push(line: "data: one"), [])
        XCTAssertEqual(parser.push(line: "data:two"), [])
        XCTAssertEqual(parser.push(line: ""), [AISSEEvent(event: "note", data: "one\ntwo")])
        XCTAssertEqual(parser.push(bytes: Data("data: tail".utf8)), [])
        XCTAssertEqual(parser.finish(), [AISSEEvent(event: nil, data: "tail")])
    }

    func testWholeRepliesFromServersThatDoNotStream() {
        let anthropic = Data(#"{"content":[{"type":"text","text":"Hi"},{"type":"text","text":"!"}]}"#.utf8)
        XCTAssertEqual(AIStreamDecoder(dialect: .anthropic).decodeWhole(anthropic), [.delta("Hi!"), .done])
        let openAI = Data(#"{"choices":[{"message":{"role":"assistant","content":"Hello"}}]}"#.utf8)
        XCTAssertEqual(AIStreamDecoder(dialect: .openAI).decodeWhole(openAI), [.delta("Hello"), .done])
    }
}

final class AIProviderModelListTests: XCTestCase {
    func testAnthropicModelList() throws {
        let body = Data(#"{"data":[{"type":"model","id":"claude-sonnet-4-5","display_name":"Claude Sonnet 4.5"},{"type":"model","id":"claude-haiku-4-5","display_name":"Claude Haiku 4.5"}],"has_more":false}"#.utf8)
        XCTAssertEqual(try AIRequests.parseModels(body, provider: "Anthropic"), [
            AIModelOption(id: "claude-haiku-4-5", name: "Claude Haiku 4.5"),
            AIModelOption(id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5"),
        ])
    }

    func testOpenAICompatibleListDropsNonChatModelsAndPrefixes() throws {
        let body = Data(#"{"object":"list","data":[{"id":"gpt-4.1"},{"id":"text-embedding-3-small"},{"id":"whisper-1"},{"id":"models/gemini-2.5-flash","name":"models/gemini-2.5-flash"},{"id":"gpt-4.1"},{"id":"dall-e-3"},{"id":""}]}"#.utf8)
        XCTAssertEqual(try AIRequests.parseModels(body, provider: "OpenAI"), [
            AIModelOption(id: "gemini-2.5-flash", name: "gemini-2.5-flash"),
            AIModelOption(id: "gpt-4.1", name: "gpt-4.1"),
        ])
    }

    func testOllamaTags() throws {
        let body = Data(#"{"models":[{"name":"llama3.2:latest","model":"llama3.2:latest","size":2019393189},{"name":"nomic-embed-text:latest"}]}"#.utf8)
        XCTAssertEqual(try AIRequests.parseModels(body, provider: "Ollama"), [AIModelOption(id: "llama3.2:latest", name: "llama3.2:latest")])
    }

    func testUnreadableListThrows() {
        XCTAssertThrowsError(try AIRequests.parseModels(Data("<html>".utf8), provider: "Custom")) {
            XCTAssertEqual($0 as? AIProviderError, .malformed(provider: "Custom"))
        }
    }
}

final class AIProviderErrorTests: XCTestCase {
    func testHTTPErrorsMapToActionableMessages() {
        XCTAssertEqual(AIRequests.httpError(provider: "OpenAI", status: 401, body: nil, model: "gpt-4.1"), .badKey(provider: "OpenAI"))
        XCTAssertEqual(AIRequests.httpError(provider: "OpenAI", status: 403, body: nil, model: nil), .badKey(provider: "OpenAI"))
        XCTAssertEqual(AIRequests.httpError(provider: "Ollama", status: 404, body: Data(#"{"error":"model \"x\" not found, try pulling it first"}"#.utf8), model: "x"),
                       .modelMissing(provider: "Ollama", model: "x"))
        XCTAssertEqual(AIRequests.httpError(provider: "Anthropic", status: 400, body: Data(#"{"type":"error","error":{"type":"not_found_error","message":"model: claude-x does not exist"}}"#.utf8), model: "claude-x"),
                       .modelMissing(provider: "Anthropic", model: "claude-x"))
        XCTAssertEqual(AIRequests.httpError(provider: "Groq", status: 429, body: Data(#"{"error":{"message":"Slow down."}}"#.utf8), model: "m"),
                       .rateLimited(provider: "Groq", detail: "Slow down."))
        XCTAssertEqual(AIRequests.httpError(provider: "Mistral", status: 500, body: Data("upstream failed".utf8), model: "m"),
                       .server(provider: "Mistral", status: 500, detail: "upstream failed"))
        XCTAssertEqual(AIRequests.httpError(provider: "Custom", status: 404, body: nil, model: nil), .server(provider: "Custom", status: 404, detail: nil))
    }

    func testErrorDetailNeverRepeatsTheKey() {
        let body = Data(#"{"error":{"message":"Incorrect API key provided: sk-live-123. Check it."}}"#.utf8)
        let error = AIRequests.httpError(provider: "OpenAI", status: 400, body: body, model: nil, secret: "sk-live-123")
        XCTAssertEqual(error, .server(provider: "OpenAI", status: 400, detail: "Incorrect API key provided: [key]. Check it."))
        XCTAssertFalse((error.errorDescription ?? "").contains("sk-live-123"))
    }
}

final class AIProviderKeyTests: XCTestCase {
    private var suiteName = ""
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "worlds.ai.tests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func testKeyValidation() throws {
        XCTAssertEqual(try AIKeyValidation.validate("  sk-ant-api03-abc  "), "sk-ant-api03-abc")
        XCTAssertEqual(try AIKeyValidation.validate("   "), "")
        for token in ["sk-ant-oat01-AbCdEf0123456789", " sk-ant-oat02-xyz "] {
            XCTAssertThrowsError(try AIKeyValidation.validate(token)) { XCTAssertEqual($0 as? AIProviderError, .subscriptionToken) }
        }
        for bad in ["sk abc", "sk-\u{0}abc", "مفتاح", String(repeating: "a", count: 5000)] {
            XCTAssertThrowsError(try AIKeyValidation.validate(bad)) { XCTAssertEqual($0 as? AIProviderError, .invalidKey) }
        }
    }

    func testStoreRefusesSubscriptionTokensAndKeepsKeysOutOfDefaults() throws {
        let keys = MemoryKeyStore()
        let store = AIProviderSettingsStore(defaults: defaults, keys: keys)
        XCTAssertThrowsError(try store.saveKey("sk-ant-oat01-secret", for: "anthropic")) { XCTAssertEqual($0 as? AIProviderError, .subscriptionToken) }
        XCTAssertFalse(store.hasKey(for: "anthropic"))
        XCTAssertTrue(try store.saveKey("sk-ant-api03-secret", for: "anthropic"))
        XCTAssertTrue(store.hasKey(for: "anthropic"))
        XCTAssertFalse(try store.saveKey("anything", for: "ollama"), "local servers take no key")
        XCTAssertFalse(keys.hasKey(providerID: "ollama"))
        for (_, value) in defaults.dictionaryRepresentation() {
            XCTAssertFalse(String(describing: value).contains("sk-ant-api03-secret"))
        }
        XCTAssertFalse(try store.saveKey("", for: "anthropic"))
        XCTAssertFalse(store.hasKey(for: "anthropic"))
    }

    func testActiveProviderNamesWhatIsMissing() throws {
        let store = AIProviderSettingsStore(defaults: defaults, keys: MemoryKeyStore())
        XCTAssertThrowsError(try store.checkActive()) { XCTAssertEqual($0 as? AIProviderError, .noProvider) }
        store.selectedProviderID = "anthropic"
        XCTAssertThrowsError(try store.checkActive()) { XCTAssertEqual($0 as? AIProviderError, .noKey(provider: "Anthropic")) }
        try store.saveKey("sk-ant-api03-x", for: "anthropic")
        XCTAssertThrowsError(try store.checkActive()) { XCTAssertEqual($0 as? AIProviderError, .noModel(provider: "Anthropic")) }
        store.save(AIProviderSettings(baseURL: "https://api.anthropic.com/", model: " claude-sonnet-4-5 "), for: "anthropic")
        XCTAssertTrue(store.isActiveReady)
        let active = try store.activeConfiguration()
        XCTAssertEqual(active.model, "claude-sonnet-4-5")
        XCTAssertEqual(active.configuration.baseURL, "https://api.anthropic.com")
        XCTAssertEqual(active.configuration.apiKey, "sk-ant-api03-x")

        store.selectedProviderID = "custom"
        XCTAssertThrowsError(try store.checkActive()) { XCTAssertEqual($0 as? AIProviderError, .badURL(provider: "Custom")) }
        store.selectedProviderID = "ollama"
        store.save(AIProviderSettings(baseURL: "", model: "llama3.2"), for: "ollama")
        XCTAssertEqual(store.settings(for: "ollama").baseURL, "http://localhost:11434/v1", "an empty address falls back to the preset")
        XCTAssertNil(try store.activeConfiguration().configuration.apiKey)

        store.selectedProviderID = "claude-code"
        XCTAssertNil(store.selectedProviderID, "runners are not offered on Apple platforms")
    }
}
