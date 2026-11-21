import Foundation
import WorldsModels

/// A failed HTTP answer: its status and body.
public struct AIHTTPFailure: Sendable, Equatable {
    public let status: Int
    public let body: String?

    public init(status: Int, body: String?) {
        self.status = status
        self.body = body
    }
}

/// Sends one request. A 2xx answer passes its body lines to `onLine` (return
/// false to stop reading) and returns nil; any other status returns its code
/// and body. `AIProviderClient` is the real one; tests use a fake.
public protocol AITransport: Sendable {
    func send(_ request: AIHTTPRequest, onLine: (String) async throws -> Bool) async throws -> AIHTTPFailure?
}

/// A tool's text output and whether it failed.
public struct AIToolResult: Sendable, Equatable {
    public let output: String
    public let isError: Bool

    public init(output: String, isError: Bool) {
        self.output = output
        self.isError = isError
    }
}

/// One tool step of a reply, as the chat shows it. `ok` is nil while the tool runs.
public struct AIToolStep: Sendable, Equatable, Codable {
    public let tool: String
    public let ok: Bool?

    public init(tool: String, ok: Bool?) {
        self.tool = tool
        self.ok = ok
    }
}

/// What the loop reports while it runs, in the desktop's LoopEvent shape.
public enum AIAgentEvent: Sendable, Equatable {
    case delta(String)
    case toolStarted(String)
    case toolFinished(String, ok: Bool)
    /// The model refused tools; the reply continues as plain chat.
    case chatOnly
}

public struct AIAgentOutcome: Sendable, Equatable {
    public let text: String
    public let steps: [AIToolStep]
    public let turns: Int
    public let chatOnly: Bool

    public init(text: String, steps: [AIToolStep], turns: Int, chatOnly: Bool) {
        self.text = text
        self.steps = steps
        self.turns = turns
        self.chatOnly = chatOnly
    }
}

/// Worlds' own tool loop for API providers, mirroring Android's `AiAgent.kt`
/// and the desktop's `providers/agent.rs`: send the conversation and the tool
/// definitions, run the tool calls the model asks for, send the results back,
/// and repeat until the model answers. A model that rejects tools gets one
/// retry without them and the reply continues as chat only.
public enum AIAgent {
    /// Most model turns one reply may take (the desktop's MAX_TURNS).
    public static let maxTurns = 24
    /// Most tool calls one reply may make.
    public static let maxToolCalls = 60

    public static func run(
        configuration: AIProviderConfiguration,
        model: String,
        system: String,
        history: [AIMessage],
        tools: [AIToolDefinition],
        transport: any AITransport,
        host: (String, [String: JSONValue]) async throws -> AIToolResult,
        sink: (AIAgentEvent) async -> Void
    ) async throws -> AIAgentOutcome {
        let provider = configuration.preset.name
        var messages = history
        var useTools = !tools.isEmpty
        var chatOnly = false
        var steps: [AIToolStep] = []
        var texts: [String] = []
        var saidAnything = false
        var turns = 0
        var calls = 0

        while turns < maxTurns {
            try Task.checkCancellation()
            let offered = useTools ? tools : []
            let request = try AIToolWire.request(configuration, model: model, system: system, messages: messages, tools: offered)
            var stream = AITurnStream(dialect: configuration.preset.api)
            let failure = try await transport.send(request) { line in
                var keepReading = true
                for event in stream.line(line) {
                    switch event {
                    case .delta(let text):
                        await sink(.delta(text))
                    case .done:
                        keepReading = false
                    case .failure(let message):
                        throw AIProviderError.stream(provider: provider, detail: AIAgent.redact(message, configuration))
                    }
                }
                return keepReading
            }
            if let failure {
                if useTools && AIToolWire.noToolSupport(status: failure.status, body: failure.body) {
                    // Retry once without tools; the reply stays chat only from here on.
                    useTools = false
                    chatOnly = true
                    await sink(.chatOnly)
                    continue
                }
                throw AIRequests.httpError(provider: provider, status: failure.status, body: failure.body.map { Data($0.utf8) },
                                           model: model, secret: configuration.apiKey)
            }
            for event in stream.end() {
                switch event {
                case .delta(let text):
                    await sink(.delta(text))
                case .failure(let message):
                    throw AIProviderError.stream(provider: provider, detail: AIAgent.redact(message, configuration))
                case .done:
                    break
                }
            }
            let turn = stream.turn()
            turns += 1
            let said = turn.text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !said.isEmpty {
                saidAnything = true
                texts.append(said)
            }
            if turn.calls.isEmpty {
                if texts.isEmpty && steps.isEmpty { throw AIProviderError.malformed(provider: provider) }
                break
            }
            messages.append(turn.message)
            var results: [AIPart] = []
            for call in turn.calls {
                try Task.checkCancellation()
                calls += 1
                if calls > maxToolCalls { throw AIProviderError.tooManySteps(limit: maxToolCalls) }
                await sink(.toolStarted(call.name))
                steps.append(AIToolStep(tool: call.name, ok: nil))
                let result: AIToolResult
                if offered.contains(where: { $0.name == call.name }) {
                    do {
                        result = try await host(call.name, call.input)
                    } catch is CancellationError {
                        throw CancellationError()
                    } catch {
                        result = AIToolResult(output: "Error: \(error.localizedDescription)", isError: true)
                    }
                } else {
                    result = AIToolResult(output: "Error: there is no tool named \(call.name)", isError: true)
                }
                steps[steps.count - 1] = AIToolStep(tool: call.name, ok: !result.isError)
                await sink(.toolFinished(call.name, ok: !result.isError))
                results.append(.toolResult(id: call.id, output: result.output, isError: result.isError))
            }
            messages.append(AIMessage(role: .user, parts: results))
            if saidAnything { await sink(.delta("\n\n")) }
            if turns >= maxTurns { throw AIProviderError.tooManySteps(limit: maxTurns) }
        }
        // The last thing the model said is the answer.
        return AIAgentOutcome(text: texts.last ?? "", steps: steps, turns: turns, chatOnly: chatOnly)
    }

    /// A provider's error text never repeats the key.
    static func redact(_ message: String, _ configuration: AIProviderConfiguration) -> String {
        guard let key = configuration.apiKey?.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty else { return message }
        return message.replacingOccurrences(of: key, with: "[key]")
    }
}
