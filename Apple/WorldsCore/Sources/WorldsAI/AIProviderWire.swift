import Foundation

// Wire details shared with Android (`AiProviders.kt`) and the desktop
// (`src-tauri/src/providers/wire.rs`, `models.rs`). Anthropic speaks the
// Messages API; every other preset speaks OpenAI compatible chat completions.

/// One turn sent to a provider.
public struct AITurn: Sendable, Equatable {
    public enum Role: String, Sendable, Equatable {
        case user
        case assistant
    }
    public let role: Role
    public let content: String
    public init(role: Role, content: String) {
        self.role = role
        self.content = content
    }
}

public struct AIModelOption: Sendable, Equatable, Hashable, Codable, Identifiable {
    public let id: String
    public let name: String
    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

/// A request ready to send. Headers may hold the key, so this type never prints them.
public struct AIHTTPRequest: Sendable, Equatable {
    public let method: String
    public let url: URL
    public let headers: [String: String]
    public let body: Data?

    public func urlRequest(timeout: TimeInterval) -> URLRequest {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        request.httpBody = body
        return request
    }
}

extension AIHTTPRequest: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    public var description: String { "AIHTTPRequest(\(method) \(url.absoluteString))" }
    public var debugDescription: String { description }
    public var customMirror: Mirror { Mirror(self, children: ["method": method, "url": url.absoluteString]) }
}

/// Errors people can act on. Messages never include the key.
/// The app maps these to localized text; `errorDescription` is the English fallback.
public enum AIProviderError: Error, Equatable, Sendable, LocalizedError {
    case noProvider
    case noKey(provider: String)
    case noModel(provider: String)
    case badURL(provider: String)
    case insecureAddress(provider: String)
    case badKey(provider: String)
    case modelMissing(provider: String, model: String)
    case offline(provider: String, host: String, local: Bool)
    case rateLimited(provider: String, detail: String?)
    case server(provider: String, status: Int, detail: String?)
    case stream(provider: String, detail: String)
    case malformed(provider: String)
    case subscriptionToken
    case invalidKey
    case keychain(status: Int32)
    /// The tool loop reached its limit of model turns or tool calls.
    case tooManySteps(limit: Int)

    public var errorDescription: String? {
        switch self {
        case .noProvider:
            return "Choose an AI provider in AI settings to start."
        case .noKey(let provider):
            return "Add your \(provider) API key in AI settings."
        case .noModel(let provider):
            return "Choose a model for \(provider) in AI settings."
        case .badURL(let provider):
            return "The \(provider) address is not a valid http or https URL."
        case .insecureAddress(let provider):
            return "\(provider) needs an https address. Plain http only works for servers on this device or your local network."
        case .badKey(let provider):
            return "\(provider) rejected the API key. Check it in AI settings."
        case .modelMissing(let provider, let model):
            return "\(provider) has no model named \(model). Pick another model."
        case .offline(let provider, let host, let local):
            return local
                ? "Cannot reach \(provider) at \(host). Check that it is running and reachable from this device."
                : "Cannot reach \(provider). Check your internet connection."
        case .rateLimited(let provider, let detail):
            return "\(provider) is limiting requests right now." + (detail.map { " \($0)" } ?? "")
        case .server(let provider, let status, let detail):
            return "\(provider) returned an error (\(status))." + (detail.map { " \($0)" } ?? "")
        case .stream(let provider, let detail):
            return "\(provider) stopped the reply: \(detail)"
        case .malformed(let provider):
            return "\(provider) sent a reply Worlds could not read."
        case .subscriptionToken:
            return "That is a Claude subscription sign in token. Worlds cannot use those; create an API key in the Claude Console."
        case .invalidKey:
            return "That does not look like an API key."
        case .keychain(let status):
            return "The Keychain could not store the key (\(status))."
        case .tooManySteps(let limit):
            return "The assistant stopped after \(limit) steps. Ask for a smaller change."
        }
    }
}

public enum AIRequests {
    public static let anthropicVersion = "2023-06-01"
    public static let maxTokens = 4096

    public static func normalizedBase(_ baseURL: String) -> String {
        var base = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        while base.hasSuffix("/") { base.removeLast() }
        return base
    }

    /// An http or https address with a host, no spaces and no user name or password.
    public static func isValidBase(_ baseURL: String) -> Bool {
        let base = normalizedBase(baseURL)
        guard !base.isEmpty, !base.contains(where: { $0.isWhitespace }) else { return false }
        guard let components = URLComponents(string: base),
              let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = components.host, !host.isEmpty else { return false }
        return components.user == nil && components.password == nil
    }

    public static func host(_ baseURL: String) -> String {
        let base = normalizedBase(baseURL)
        guard let components = URLComponents(string: base), let host = components.host, !host.isEmpty else { return base }
        if let port = components.port { return "\(host):\(port)" }
        return host
    }

    /// Hosts on this device or the local network, where "offline" means the server is not running.
    public static func isLocal(_ baseURL: String) -> Bool {
        let base = normalizedBase(baseURL)
        let host = (URLComponents(string: base)?.host ?? "").lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if host.isEmpty { return false }
        if host == "localhost" || host == "::1" || host == "0.0.0.0" || host.hasSuffix(".local") || host.hasSuffix(".localhost") { return true }
        if host.hasPrefix("127.") || host.hasPrefix("10.") || host.hasPrefix("192.168.") { return true }
        if host.hasPrefix("172.") {
            let parts = host.split(separator: ".")
            if parts.count > 1, let second = Int(parts[1]), (16...31).contains(second) { return true }
        }
        return false
    }

    /// `http://localhost:11434/v1` becomes `http://localhost:11434`.
    public static func serverRoot(_ baseURL: String) -> String {
        let base = normalizedBase(baseURL)
        return base.hasSuffix("/v1") ? String(base.dropLast(3)) : base
    }

    /// Anthropic's preset is the bare host; a base that already ends in /v1 works too.
    static func anthropicRoot(_ baseURL: String) -> String {
        let base = normalizedBase(baseURL)
        return base.hasSuffix("/v1") ? base : base + "/v1"
    }

    public static func headers(_ configuration: AIProviderConfiguration, streaming: Bool) -> [String: String] {
        var headers = ["Accept": streaming ? "text/event-stream" : "application/json"]
        let key = configuration.apiKey?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        switch configuration.preset.api {
        case .anthropic:
            if !key.isEmpty { headers["x-api-key"] = key }
            headers["anthropic-version"] = anthropicVersion
        case .openAI:
            if !key.isEmpty { headers["Authorization"] = "Bearer \(key)" }
        }
        if configuration.preset.id == "openrouter" { headers["X-Title"] = "Worlds" }
        return headers
    }

    public static func modelsRequest(_ configuration: AIProviderConfiguration) throws -> AIHTTPRequest {
        let address: String
        switch configuration.preset.api {
        case .anthropic:
            address = anthropicRoot(configuration.baseURL) + "/models?limit=1000"
        case .openAI:
            let path = configuration.preset.modelsPath.isEmpty ? "/models" : configuration.preset.modelsPath
            // Ollama lists installed models at the server root (`/api/tags`), outside `/v1`.
            address = path.hasPrefix("/api/") ? serverRoot(configuration.baseURL) + path : normalizedBase(configuration.baseURL) + path
        }
        guard isValidBase(configuration.baseURL), let url = URL(string: address) else {
            throw AIProviderError.badURL(provider: configuration.preset.name)
        }
        return AIHTTPRequest(method: "GET", url: url, headers: headers(configuration, streaming: false), body: nil)
    }

    public static func chatRequest(_ configuration: AIProviderConfiguration, model: String, system: String, turns: [AITurn]) throws -> AIHTTPRequest {
        let cleaned = cleanTurns(turns)
        let systemText = system.trimmingCharacters(in: .whitespacesAndNewlines)
        var messages: [[String: Any]] = []
        var body: [String: Any] = ["model": model, "stream": true]
        let address: String
        switch configuration.preset.api {
        case .anthropic:
            body["max_tokens"] = maxTokens
            if !systemText.isEmpty { body["system"] = systemText }
            for turn in cleaned { messages.append(["role": turn.role.rawValue, "content": turn.content]) }
            address = anthropicRoot(configuration.baseURL) + "/messages"
        case .openAI:
            if !systemText.isEmpty { messages.append(["role": "system", "content": systemText]) }
            for turn in cleaned { messages.append(["role": turn.role.rawValue, "content": turn.content]) }
            address = normalizedBase(configuration.baseURL) + "/chat/completions"
        }
        body["messages"] = messages
        guard isValidBase(configuration.baseURL), let url = URL(string: address) else {
            throw AIProviderError.badURL(provider: configuration.preset.name)
        }
        let data = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        var requestHeaders = Self.headers(configuration, streaming: true)
        requestHeaders["Content-Type"] = "application/json"
        return AIHTTPRequest(method: "POST", url: url, headers: requestHeaders, body: data)
    }

    /// Only user and assistant turns with text, starting with the person, with no two turns of one role in a row.
    public static func cleanTurns(_ turns: [AITurn]) -> [AITurn] {
        var out: [AITurn] = []
        for turn in turns {
            if turn.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
            if out.isEmpty && turn.role != .user { continue }
            if let last = out.last, last.role == turn.role {
                out[out.count - 1] = AITurn(role: last.role, content: last.content + "\n\n" + turn.content)
            } else {
                out.append(turn)
            }
        }
        return out
    }

    private static let nonChat = ["embed", "tts", "whisper", "dall-e", "moderation", "transcribe", "rerank", "davinci", "babbage", "image", "audio", "realtime", "search", "guard"]

    /// Reads `{"data":[{"id":...}]}` (Anthropic and OpenAI compatible) or `{"models":[{"name":...}]}` (Ollama),
    /// drops models that cannot chat, and sorts by id.
    public static func parseModels(_ data: Data, provider: String) throws -> [AIModelOption] {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AIProviderError.malformed(provider: provider)
        }
        let items = (object["data"] as? [Any]) ?? (object["models"] as? [Any]) ?? []
        var out: [AIModelOption] = []
        for case let item as [String: Any] in items {
            guard let rawID = nonEmpty(item["id"] as? String) ?? nonEmpty(item["name"] as? String) ?? nonEmpty(item["model"] as? String) else { continue }
            let id = rawID.hasPrefix("models/") ? String(rawID.dropFirst("models/".count)) : rawID
            let lower = id.lowercased()
            if nonChat.contains(where: { lower.contains($0) }) { continue }
            let rawName = nonEmpty(item["display_name"] as? String) ?? nonEmpty(item["name"] as? String)
            let name = rawName.map { $0.hasPrefix("models/") ? String($0.dropFirst("models/".count)) : $0 } ?? id
            if !out.contains(where: { $0.id == id }) { out.append(AIModelOption(id: id, name: name)) }
        }
        return out.sorted { $0.id.lowercased() < $1.id.lowercased() }
    }

    /// The provider's own error text, from the shapes Anthropic and OpenAI compatible servers return.
    public static func errorDetail(_ body: Data?, secret: String? = nil) -> String? {
        guard let body, !body.isEmpty else { return nil }
        var text: String
        if let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
            if let error = object["error"] as? [String: Any] {
                text = (error["message"] as? String) ?? ""
            } else if let error = object["error"] as? String {
                text = error
            } else {
                text = (object["message"] as? String) ?? ""
            }
            text = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(300))
        } else {
            text = String(String(decoding: body, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        }
        if let secret, !secret.isEmpty { text = text.replacingOccurrences(of: secret, with: "[key]") }
        return text.isEmpty ? nil : text
    }

    public static func httpError(provider: String, status: Int, body: Data?, model: String?, secret: String? = nil) -> AIProviderError {
        let detail = errorDetail(body, secret: secret)
        let lower = detail?.lowercased() ?? ""
        let missingWords = ["not found", "does not exist", "not exist", "invalid model", "unknown model", "not_found", "no such"]
        let modelProblem = model != nil && lower.contains("model") && missingWords.contains(where: { lower.contains($0) })
        switch status {
        case 401, 403:
            return .badKey(provider: provider)
        case _ where modelProblem:
            return .modelMissing(provider: provider, model: model ?? "")
        case 404 where model != nil:
            return .modelMissing(provider: provider, model: model ?? "")
        case 429:
            return .rateLimited(provider: provider, detail: detail)
        default:
            return .server(provider: provider, status: status, detail: detail)
        }
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

// MARK: - Server sent events

public struct AISSEEvent: Sendable, Equatable {
    public var event: String?
    public var data: String
    public init(event: String? = nil, data: String) {
        self.event = event
        self.data = data
    }
}

/// Incremental SSE parser. Network chunks may split lines and even UTF-8
/// characters anywhere; only complete lines are decoded.
public struct AISSEParser: Sendable {
    private var buffer: [UInt8] = []
    private var event: String?
    private var data: [String] = []

    public init() {}

    /// Feeds one byte; returns events completed by it (usually none).
    public mutating func push(byte: UInt8) -> [AISSEEvent] {
        guard byte == 0x0A else {
            buffer.append(byte)
            return []
        }
        let line = String(decoding: buffer, as: UTF8.self)
        buffer.removeAll(keepingCapacity: true)
        return push(line: line)
    }

    public mutating func push(bytes: Data) -> [AISSEEvent] {
        var out: [AISSEEvent] = []
        for byte in bytes { out.append(contentsOf: push(byte: byte)) }
        return out
    }

    /// Flushes whatever is left when the stream ends.
    public mutating func finish() -> [AISSEEvent] {
        var out: [AISSEEvent] = []
        if !buffer.isEmpty {
            let line = String(decoding: buffer, as: UTF8.self)
            buffer.removeAll()
            out.append(contentsOf: push(line: line))
        }
        out.append(contentsOf: push(line: ""))
        return out
    }

    public mutating func push(line raw: String) -> [AISSEEvent] {
        var line = raw
        while line.hasSuffix("\r") || line.hasSuffix("\n") { line.removeLast() }
        if line.isEmpty {
            defer { event = nil }
            guard !data.isEmpty else { return [] }
            let joined = data.joined(separator: "\n")
            data.removeAll()
            return [AISSEEvent(event: event, data: joined)]
        }
        if line.hasPrefix(":") { return [] }
        // Some servers answer an error as plain JSON instead of an event stream.
        if line.hasPrefix("{") && data.isEmpty { return [AISSEEvent(event: nil, data: line)] }
        let field: Substring
        var value: Substring
        if let colon = line.firstIndex(of: ":") {
            field = line[..<colon]
            value = line[line.index(after: colon)...]
            if value.hasPrefix(" ") { value = value.dropFirst() }
        } else {
            field = Substring(line)
            value = ""
        }
        switch field {
        case "event": event = String(value)
        case "data": data.append(String(value))
        default: break
        }
        return []
    }
}

public enum AIStreamEvent: Sendable, Equatable {
    case delta(String)
    case done
    case failure(String)
}

/// Turns either dialect's events into text deltas. Anthropic names each event;
/// OpenAI compatible servers end with `[DONE]`.
public struct AIStreamDecoder: Sendable {
    public let dialect: AIProviderDialect

    public init(dialect: AIProviderDialect) {
        self.dialect = dialect
    }

    public func decode(_ event: AISSEEvent) -> [AIStreamEvent] {
        let data = event.data.trimmingCharacters(in: .whitespacesAndNewlines)
        if data.isEmpty { return [] }
        if data == "[DONE]" { return [.done] }
        guard let object = try? JSONSerialization.jsonObject(with: Data(data.utf8)) as? [String: Any] else { return [] }
        if let error = object["error"], !(error is NSNull) {
            let message: String
            if let error = error as? [String: Any] {
                message = (error["message"] as? String) ?? ""
            } else if let error = error as? String {
                message = error
            } else {
                message = ""
            }
            return [.failure(message.isEmpty ? "Unknown error" : message)]
        }
        switch dialect {
        case .anthropic: return anthropic(object, eventName: event.event)
        case .openAI: return openAI(object)
        }
    }

    private func anthropic(_ object: [String: Any], eventName: String?) -> [AIStreamEvent] {
        let type: String = (object["type"] as? String) ?? eventName ?? ""
        switch type {
        case "content_block_start":
            guard let block = object["content_block"] as? [String: Any], (block["type"] as? String) == "text",
                  let text = block["text"] as? String, !text.isEmpty else { return [] }
            return [.delta(text)]
        case "content_block_delta":
            guard let delta = object["delta"] as? [String: Any], (delta["type"] as? String) == "text_delta",
                  let text = delta["text"] as? String, !text.isEmpty else { return [] }
            return [.delta(text)]
        case "message_stop":
            return [.done]
        default:
            return []
        }
    }

    private func openAI(_ object: [String: Any]) -> [AIStreamEvent] {
        guard let choices = object["choices"] as? [Any] else { return [] }
        var out: [AIStreamEvent] = []
        for case let choice as [String: Any] in choices {
            let delta = (choice["delta"] as? [String: Any]) ?? (choice["message"] as? [String: Any])
            if let content = delta?["content"] as? String, !content.isEmpty { out.append(.delta(content)) }
        }
        return out
    }

    /// A whole, non streamed reply, for servers that ignore `"stream": true`.
    public func decodeWhole(_ data: Data) -> [AIStreamEvent] {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [] }
        if let error = object["error"], !(error is NSNull) {
            return decode(AISSEEvent(data: String(decoding: data, as: UTF8.self)))
        }
        switch dialect {
        case .anthropic:
            let blocks = (object["content"] as? [Any]) ?? []
            var text = ""
            for case let block as [String: Any] in blocks where (block["type"] as? String) == "text" {
                text += (block["text"] as? String) ?? ""
            }
            return text.isEmpty ? [] : [.delta(text), .done]
        case .openAI:
            let events = openAI(object)
            return events.isEmpty ? [] : events + [.done]
        }
    }
}
