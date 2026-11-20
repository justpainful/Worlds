import Foundation
import WorldsModels

// The tool calling wire formats, mirroring Android's `AiToolWire.kt` and the
// desktop's `src-tauri/src/providers/wire.rs`: one neutral conversation shape,
// request bodies for both dialects (Anthropic tool_use and tool_result blocks,
// OpenAI tool_calls and tool messages), and a stream accumulator that turns
// either dialect's stream into text deltas plus the finished assistant turn.

extension JSONValue {
    var aiInt: Int64? {
        switch self {
        case .integer(let value): return value
        case .number(let value):
            guard value.rounded() == value, abs(value) < 9.0e15 else { return nil }
            return Int64(value)
        default: return nil
        }
    }

    /// Any JSON text, including a bare string or number.
    static func aiParse(_ text: String) -> JSONValue? {
        guard let data = text.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(JSONValue.self, from: data)
    }

    /// Compact JSON with sorted keys.
    var aiCompact: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(self) else { return "null" }
        return String(decoding: data, as: UTF8.self)
    }
}

extension String {
    var aiIsBlank: Bool { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

/// One piece of a message in the tool loop: text, a tool call the model made,
/// or the result Worlds sent back.
public enum AIPart: Sendable, Equatable {
    case text(String)
    case toolCall(id: String, name: String, input: [String: JSONValue])
    case toolResult(id: String, output: String, isError: Bool)
}

/// A message in the tool loop. Tool results travel as user parts, as on the desktop.
public struct AIMessage: Sendable, Equatable {
    public let role: AITurn.Role
    public let parts: [AIPart]

    public init(role: AITurn.Role, parts: [AIPart]) {
        self.role = role
        self.parts = parts
    }

    public static func text(_ role: AITurn.Role, _ text: String) -> AIMessage {
        AIMessage(role: role, parts: [.text(text)])
    }
}

/// A Worlds tool offered to the model, with the name, description and JSON
/// schema the desktop MCP server uses.
public struct AIToolDefinition: Sendable, Equatable {
    public let name: String
    public let description: String
    public let schema: JSONValue

    public init(name: String, description: String, schema: JSONValue) {
        self.name = name
        self.description = description
        self.schema = schema
    }
}

public struct AIToolCall: Sendable, Equatable {
    public let id: String
    public let name: String
    public let input: [String: JSONValue]

    public init(id: String, name: String, input: [String: JSONValue]) {
        self.id = id
        self.name = name
        self.input = input
    }
}

/// What the model said in one turn: its text and the tools it asked for.
public struct AIAssistantTurn: Sendable, Equatable {
    public let text: String
    public let calls: [AIToolCall]
    public let stop: String?

    public init(text: String, calls: [AIToolCall], stop: String?) {
        self.text = text
        self.calls = calls
        self.stop = stop
    }

    public var message: AIMessage {
        var parts: [AIPart] = []
        if !text.aiIsBlank { parts.append(.text(text)) }
        for call in calls { parts.append(.toolCall(id: call.id, name: call.name, input: call.input)) }
        return AIMessage(role: .assistant, parts: parts)
    }
}

public enum AIToolWire {
    public static let agentMaxTokens = 8192

    /// Consecutive messages of one role merged, blank text dropped, and the
    /// conversation starting with the person.
    public static func normalized(_ messages: [AIMessage]) -> [AIMessage] {
        var out: [AIMessage] = []
        for message in messages {
            let parts = message.parts.filter { part in
                if case .text(let text) = part { return !text.aiIsBlank }
                return true
            }
            if parts.isEmpty { continue }
            if out.isEmpty && message.role != .user { continue }
            if let last = out.last, last.role == message.role {
                out[out.count - 1] = AIMessage(role: last.role, parts: last.parts + parts)
            } else {
                out.append(AIMessage(role: message.role, parts: parts))
            }
        }
        return out
    }

    /// A streamed chat request that offers `tools`; with no tools it is a plain
    /// chat request in the same shape. The address and headers come from the
    /// plain chat request, so the key handling stays in one place.
    public static func request(_ configuration: AIProviderConfiguration, model: String, system: String,
                               messages: [AIMessage], tools: [AIToolDefinition]) throws -> AIHTTPRequest {
        let shape = try AIRequests.chatRequest(configuration, model: model, system: system, turns: [])
        let body: JSONValue
        switch configuration.preset.api {
        case .anthropic: body = anthropicBody(model: model, system: system, messages: messages, tools: tools)
        case .openAI: body = openAIBody(model: model, system: system, messages: messages, tools: tools)
        }
        return AIHTTPRequest(method: "POST", url: shape.url, headers: shape.headers, body: Data(body.aiCompact.utf8))
    }

    public static func anthropicBody(model: String, system: String, messages: [AIMessage], tools: [AIToolDefinition]) -> JSONValue {
        var list: [JSONValue] = []
        for message in normalized(messages) {
            var content: [JSONValue] = []
            for part in message.parts {
                switch part {
                case .text(let text):
                    content.append(.object(["type": .string("text"), "text": .string(text)]))
                case .toolCall(let id, let name, let input):
                    content.append(.object(["type": .string("tool_use"), "id": .string(id), "name": .string(name), "input": .object(input)]))
                case .toolResult(let id, let output, let isError):
                    content.append(.object(["type": .string("tool_result"), "tool_use_id": .string(id), "content": .string(output), "is_error": .bool(isError)]))
                }
            }
            list.append(.object(["role": .string(message.role.rawValue), "content": .array(content)]))
        }
        var body: [String: JSONValue] = [
            "model": .string(model),
            "max_tokens": .integer(Int64(agentMaxTokens)),
            "stream": .bool(true),
            "messages": .array(list),
        ]
        if !system.aiIsBlank { body["system"] = .string(system) }
        if !tools.isEmpty {
            body["tools"] = .array(tools.map { tool in
                .object(["name": .string(tool.name), "description": .string(tool.description), "input_schema": tool.schema])
            })
        }
        return .object(body)
    }

    public static func openAIBody(model: String, system: String, messages: [AIMessage], tools: [AIToolDefinition]) -> JSONValue {
        var list: [JSONValue] = []
        if !system.aiIsBlank { list.append(.object(["role": .string("system"), "content": .string(system)])) }
        for message in normalized(messages) {
            if message.role == .user {
                // Tool results become `tool` messages, which must directly follow
                // the assistant message that asked for them.
                var texts: [String] = []
                for part in message.parts {
                    switch part {
                    case .toolResult(let id, let output, let isError):
                        let text = isError && !output.hasPrefix("Error") ? "Error: \(output)" : output
                        list.append(.object(["role": .string("tool"), "tool_call_id": .string(id), "content": .string(text)]))
                    case .text(let text):
                        texts.append(text)
                    case .toolCall:
                        break
                    }
                }
                if !texts.isEmpty { list.append(.object(["role": .string("user"), "content": .string(texts.joined(separator: "\n\n"))])) }
            } else {
                var texts: [String] = []
                var calls: [JSONValue] = []
                for part in message.parts {
                    switch part {
                    case .text(let text):
                        texts.append(text)
                    case .toolCall(let id, let name, let input):
                        calls.append(.object([
                            "id": .string(id),
                            "type": .string("function"),
                            "function": .object(["name": .string(name), "arguments": .string(JSONValue.object(input).aiCompact)]),
                        ]))
                    case .toolResult:
                        break
                    }
                }
                let text = texts.joined(separator: "\n\n")
                var entry: [String: JSONValue] = ["role": .string("assistant"), "content": text.isEmpty ? .null : .string(text)]
                if !calls.isEmpty { entry["tool_calls"] = .array(calls) }
                list.append(.object(entry))
            }
        }
        var body: [String: JSONValue] = ["model": .string(model), "messages": .array(list), "stream": .bool(true)]
        if !tools.isEmpty {
            body["tools"] = .array(tools.map { tool in
                .object([
                    "type": .string("function"),
                    "function": .object(["name": .string(tool.name), "description": .string(tool.description), "parameters": tool.schema]),
                ])
            })
        }
        return .object(body)
    }

    /// The server refused the request because the model has no tool support
    /// (the same test as the desktop and Android).
    public static func noToolSupport(status: Int, body: String?) -> Bool {
        // Sign in and rate limit errors are never a model refusing tools: falling
        // back to chat only would hide a bad key or a limit behind a working reply.
        if !(400...500).contains(status) || status == 401 || status == 403 || status == 429 { return false }
        let text = (body ?? "").lowercased()
        guard text.contains("tool") || text.contains("function") else { return false }
        return ["not support", "unsupported", "--jinja", "not enabled", "not available", "does not have"].contains { text.contains($0) }
    }

    /// Tool arguments as an object. Some servers double encode them as a JSON string.
    public static func parseArguments(_ raw: String) -> [String: JSONValue] {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return [:] }
        switch JSONValue.aiParse(text) {
        case .object(let object)?:
            return object
        case .string(let inner)?:
            if case .object(let object)? = JSONValue.aiParse(inner) { return object }
            return [:]
        default:
            return [:]
        }
    }
}

/// Turns either dialect's stream into text deltas plus the finished turn (text
/// and tool calls). Feed it every line of the response body, then call `end()`:
/// a server that ignored `"stream": true` and answered with one JSON document
/// is read there.
public struct AITurnStream: Sendable {
    private struct Block: Sendable {
        var type = ""
        var text = ""
        var id = ""
        var name = ""
        var json = ""
        var startInput: [String: JSONValue]?
    }

    private struct Call: Sendable {
        var id = ""
        var name = ""
        var arguments = ""
    }

    public let dialect: AIProviderDialect
    private var blocks: [Int: Block] = [:]
    private var calls: [Call] = []
    private var text = ""
    private var raw = ""
    private var rawBytes = 0
    private var sawData = false
    private var stop: String?
    private static let maxRaw = 4 * 1024 * 1024

    public init(dialect: AIProviderDialect) {
        self.dialect = dialect
    }

    public mutating func line(_ rawLine: String) -> [AIStreamEvent] {
        var line = rawLine
        while line.hasSuffix("\r") { line.removeLast() }
        if line.isEmpty || line.hasPrefix(":") || line.hasPrefix("event:") || line.hasPrefix("id:") || line.hasPrefix("retry:") { return [] }
        guard line.hasPrefix("data:") else {
            if !sawData && rawBytes < Self.maxRaw {
                raw += line + "\n"
                rawBytes += line.utf8.count + 1
            }
            return []
        }
        sawData = true
        let data = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
        if data.isEmpty { return [] }
        if data == "[DONE]" { return [.done] }
        guard let object = JSONValue.aiParse(data)?.aiObject else { return [] }
        if let message = Self.errorMessage(object) { return [.failure(message)] }
        switch dialect {
        case .anthropic: return anthropic(object)
        case .openAI: return openAI(object)
        }
    }

    /// Reads a whole JSON answer when the server did not stream. Call once after the last line.
    public mutating func end() -> [AIStreamEvent] {
        if sawData { return [] }
        let body = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        raw = ""
        rawBytes = 0
        guard body.hasPrefix("{"), let object = JSONValue.aiParse(body)?.aiObject else { return [] }
        if let message = Self.errorMessage(object) { return [.failure(message)] }
        switch dialect {
        case .anthropic:
            let content = object["content"]?.aiArray ?? []
            for (index, item) in content.enumerated() {
                guard let source = item.aiObject else { continue }
                var block = Block(type: source["type"]?.aiString ?? "", text: source["text"]?.aiString ?? "",
                                  id: source["id"]?.aiString ?? "", name: source["name"]?.aiString ?? "")
                if block.type == "tool_use" { block.json = JSONValue.object(source["input"]?.aiObject ?? [:]).aiCompact }
                blocks[index] = block
            }
            if let reason = stopReason(object["stop_reason"]) { stop = reason }
            let all = blocks.keys.sorted().compactMap { blocks[$0] }.filter { $0.type == "text" }.map(\.text).joined()
            return all.isEmpty ? [] : [.delta(all)]
        case .openAI:
            return openAI(object)
        }
    }

    public func turn() -> AIAssistantTurn {
        switch dialect {
        case .anthropic:
            var out = ""
            var found: [AIToolCall] = []
            for index in blocks.keys.sorted() {
                guard let block = blocks[index] else { continue }
                switch block.type {
                case "text":
                    out += block.text
                case "tool_use":
                    guard !block.name.aiIsBlank else { continue }
                    var input = AIToolWire.parseArguments(block.json)
                    if block.json.aiIsBlank, let start = block.startInput { input = start }
                    found.append(AIToolCall(id: block.id.aiIsBlank ? "toolu_\(index)" : block.id, name: block.name, input: input))
                default:
                    break
                }
            }
            return AIAssistantTurn(text: out, calls: found, stop: stop)
        case .openAI:
            var found: [AIToolCall] = []
            for (index, call) in calls.enumerated() where !call.name.aiIsBlank {
                found.append(AIToolCall(id: call.id.aiIsBlank ? "call_\(index)" : call.id, name: call.name,
                                        input: AIToolWire.parseArguments(call.arguments)))
            }
            return AIAssistantTurn(text: text, calls: found, stop: stop)
        }
    }

    private static func errorMessage(_ object: [String: JSONValue]) -> String? {
        guard let error = object["error"], error != .null else { return nil }
        let message: String
        switch error {
        case .object(let fields): message = fields["message"]?.aiString ?? ""
        case .string(let value): message = value
        default: message = error.aiCompact
        }
        let clean = message.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? "Unknown error" : clean
    }

    private func stopReason(_ value: JSONValue?) -> String? {
        guard let reason = value?.aiString, !reason.aiIsBlank, reason != "null" else { return nil }
        return reason
    }

    private mutating func anthropic(_ object: [String: JSONValue]) -> [AIStreamEvent] {
        let rawIndex = object["index"]?.aiInt ?? 0
        guard (0...4096).contains(rawIndex) else { return [] }
        let index = Int(rawIndex)
        switch object["type"]?.aiString ?? "" {
        case "content_block_start":
            let source = object["content_block"]?.aiObject ?? [:]
            var block = Block(type: source["type"]?.aiString ?? "", text: source["text"]?.aiString ?? "",
                              id: source["id"]?.aiString ?? "", name: source["name"]?.aiString ?? "")
            if block.type == "tool_use", let input = source["input"]?.aiObject, !input.isEmpty { block.startInput = input }
            blocks[index] = block
            return block.text.isEmpty ? [] : [.delta(block.text)]
        case "content_block_delta":
            let delta = object["delta"]?.aiObject ?? [:]
            let kind = delta["type"]?.aiString ?? ""
            var block = blocks[index] ?? Block(type: kind == "input_json_delta" ? "tool_use" : "text")
            var events: [AIStreamEvent] = []
            switch kind {
            case "text_delta":
                let piece = delta["text"]?.aiString ?? ""
                block.text += piece
                if !piece.isEmpty { events.append(.delta(piece)) }
            case "input_json_delta":
                block.json += delta["partial_json"]?.aiString ?? ""
            default:
                break
            }
            blocks[index] = block
            return events
        case "message_delta":
            if let reason = stopReason(object["delta"]?.aiObject?["stop_reason"]) { stop = reason }
            return []
        case "message_stop":
            return [.done]
        default:
            return []
        }
    }

    private mutating func openAI(_ object: [String: JSONValue]) -> [AIStreamEvent] {
        guard let choice = object["choices"]?.aiArray?.first?.aiObject else { return [] }
        if let reason = stopReason(choice["finish_reason"]) { stop = reason }
        guard let delta = choice["delta"]?.aiObject ?? choice["message"]?.aiObject else { return [] }
        if let toolCalls = delta["tool_calls"]?.aiArray {
            for item in toolCalls {
                if let call = item.aiObject { toolDelta(call) }
            }
        }
        if let content = delta["content"]?.aiString, !content.isEmpty {
            text += content
            return [.delta(content)]
        }
        return []
    }

    private mutating func toolDelta(_ call: [String: JSONValue]) {
        let rawID = call["id"]?.aiString ?? ""
        let id = rawID.aiIsBlank || rawID == "null" ? "" : rawID
        let index: Int
        if let given = call["index"]?.aiInt {
            guard (0...255).contains(given) else { return }
            index = Int(given)
        } else if !id.isEmpty, let existing = calls.firstIndex(where: { $0.id == id }) {
            index = existing
        } else {
            index = calls.count
        }
        guard index <= 255 else { return }
        while calls.count <= index { calls.append(Call()) }
        if !id.isEmpty { calls[index].id = id }
        guard let function = call["function"]?.aiObject else { return }
        if let name = function["name"]?.aiString, !name.aiIsBlank, name != "null", calls[index].name.isEmpty {
            calls[index].name = name
        }
        if let arguments = function["arguments"], arguments != .null {
            if case .string(let piece) = arguments {
                calls[index].arguments += piece
            } else {
                calls[index].arguments += arguments.aiCompact
            }
        }
    }
}
