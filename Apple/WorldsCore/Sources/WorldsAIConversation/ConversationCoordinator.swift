import Foundation
import WorldsAI
import WorldsModels

public struct ConversationRun: Sendable {
    public let chatID: String
    public let sessionID: String
    public let resume: Bool
    public init(chatID: String, sessionID: String, resume: Bool) { self.chatID = chatID; self.sessionID = sessionID; self.resume = resume }
}
public struct ConversationStep: Codable, Sendable, Equatable {
    public let tool: String
    public var ok: Bool?
    public init(tool: String, ok: Bool?) { self.tool = tool; self.ok = ok }
    enum CodingKeys: String, CodingKey { case tool, ok }
    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(tool, forKey: .tool)
        if let ok { try values.encode(ok, forKey: .ok) } else { try values.encodeNil(forKey: .ok) }
    }
}
public protocol ConversationStore: Sendable {
    /// Atomically creates/loads a personal chat and stores the user message.
    func begin(chatID: String?, prompt: String, runID: UUID) async throws -> ConversationRun
    /// Commits the assistant message before a run can be reported as saved.
    func finish(chatID: String, runID: UUID, text: String, steps: [ConversationStep], isError: Bool, sessionOK: Bool) async throws
}
public protocol ConversationRunner: Sendable {
    func run(_ request: ClaudeRequest, timeout: TimeInterval, onEvent: @escaping @Sendable (ClaudeEvent) -> Void) async throws -> ClaudeResult
    func cancel(runID: UUID) async
}
extension ClaudeRunner: ConversationRunner {}
public enum ConversationError: Error { case busy, cancelled, persistenceFailed, invalidRequest, unexpectedTool, eventLimitExceeded }
public struct ChatRunResult: Sendable {
    public let chatID: String
    public let text: String
    public let isError: Bool
}
private final class EventAccumulator: @unchecked Sendable {
    private let lock = NSLock()
    private var text = ""
    private var textBytes = 0
    private var toolBytes = 0
    private var eventCount = 0
    private var exceeded = false
    private var closed = false
    private var steps: [ConversationStep] = []
    private var unresolvedSteps: [Int] = []
    enum Disposition { case accept, stop, ignore }
    /// Reject before retaining or forwarding oversized data.
    func add(_ event: ClaudeEvent) -> Disposition {
        lock.lock(); defer { lock.unlock() }
        guard !exceeded, !closed else { return .ignore }
        eventCount += 1
        guard eventCount <= 20_000 else { exceeded = true; return .stop }
        switch event {
        case .text(let part):
            let count = part.utf8.count
            guard count <= 8 * 1024 * 1024 - textBytes else { exceeded = true; return .stop }
            textBytes += count; text += part
        case .tool(let name, _):
            let count = name.utf8.count
            guard count <= 512, count <= 1024 * 1024 - toolBytes else { exceeded = true; return .stop }
            toolBytes += count; steps.append(.init(tool: name, ok: nil)); unresolvedSteps.append(steps.count - 1)
        case .toolResult(let error):
            if let index = unresolvedSteps.popLast() { steps[index].ok = !error }
        case .result(let text, _):
            guard text.utf8.count <= 8 * 1024 * 1024 else { exceeded = true; return .stop }
        }
        return .accept
    }
    func markExceeded() { lock.lock(); defer { lock.unlock() }; exceeded = true }
    func seal() -> (String, [ConversationStep], Bool) { lock.lock(); defer { lock.unlock() }; closed = true; return (text, steps, exceeded) }
}

/// One active run per coordinator. This layer never supplies or authorizes MCP.
public actor ConversationCoordinator {
    private let store: any ConversationStore
    private let runner: any ConversationRunner
    private var activeID: UUID?
    private var running: Task<ClaudeResult, Error>?
    private var cancelled = false
    private struct PendingResult { let chatID: String; let text: String; let steps: [ConversationStep]; let isError: Bool; let sessionOK: Bool }
    private var pending: [UUID: PendingResult] = [:]
    private var saving: Set<UUID> = []
    public init(store: any ConversationStore, runner: any ConversationRunner) { self.store = store; self.runner = runner }

    public func cancel(runID: UUID) async {
        guard activeID == runID else { return }
        cancelled = true
        running?.cancel()
        await runner.cancel(runID: runID)
    }
    /// Retains a failed final save in memory; process termination can still lose it.
    public func retrySave(runID: UUID) async throws -> ChatRunResult {
        guard let result = pending[runID], !saving.contains(runID) else { throw ConversationError.invalidRequest }
        saving.insert(runID); defer { saving.remove(runID) }
        do { try await store.finish(chatID: result.chatID, runID: runID, text: result.text, steps: result.steps, isError: result.isError, sessionOK: result.sessionOK) }
        catch { throw ConversationError.persistenceFailed }
        pending.removeValue(forKey: runID)
        return ChatRunResult(chatID: result.chatID, text: result.text, isError: result.isError)
    }
    public func run(runID: UUID, chatID: String?, prompt: String, systemPrompt: String,
                    model: String = "haiku", effort: String = "low", timeout: TimeInterval = 300,
                    onAccepted: @escaping @Sendable (String) -> Void = { _ in },
                    onEvent: @escaping @Sendable (ClaudeEvent) -> Void) async throws -> ChatRunResult {
        guard activeID == nil, pending[runID] == nil else { throw ConversationError.busy }
        guard !prompt.isEmpty, prompt.utf8.count <= 512 * 1024 else { throw ConversationError.invalidRequest }
        activeID = runID; cancelled = false
        defer { activeID = nil; running = nil }
        let opened = try await store.begin(chatID: chatID, prompt: prompt, runID: runID)
        onAccepted(opened.chatID)
        let accumulator = EventAccumulator()
        do {
            if cancelled || Task.isCancelled { throw ConversationError.cancelled }
            let request = ClaudeRequest(runID: runID, prompt: prompt, systemPrompt: systemPrompt,
                                        sessionID: opened.sessionID, resume: opened.resume, model: model, effort: effort, mcp: nil)
            let runner = self.runner
            let task = Task {
                try await runner.run(request, timeout: timeout) { event in
                    switch accumulator.add(event) {
                    case .stop: Task { await runner.cancel(runID: runID) }; return
                    case .ignore: return
                    case .accept: break
                    }
                    // No tool is authorized here; never forward arbitrary tool input.
                    if case let .tool(name, _) = event { onEvent(.tool(name: name, input: nil)) }
                    else { onEvent(event) }
                }
            }
            running = task
            let result = try await task.value
            if cancelled || Task.isCancelled { throw ConversationError.cancelled }
            if result.text.utf8.count > 8 * 1024 * 1024 { accumulator.markExceeded() }
            let (_, steps, exceeded) = accumulator.seal()
            guard !exceeded else { throw ConversationError.eventLimitExceeded }
            guard steps.isEmpty else { throw ConversationError.unexpectedTool }
            do { try await store.finish(chatID: opened.chatID, runID: runID, text: result.text, steps: steps, isError: result.isError, sessionOK: !result.isError) }
            catch {
                pending[runID] = PendingResult(chatID: opened.chatID, text: result.text, steps: steps, isError: result.isError, sessionOK: !result.isError)
                throw ConversationError.persistenceFailed
            }
            return ChatRunResult(chatID: opened.chatID, text: result.text, isError: result.isError)
        } catch {
            if let failure = error as? ConversationError, case .persistenceFailed = failure { throw failure }
            let (partial, steps, exceeded) = accumulator.seal()
            // Do not expose process stderr or credentials in the saved transcript.
            let text = partial.isEmpty ? "Run did not complete." : partial
            do { try await store.finish(chatID: opened.chatID, runID: runID, text: text, steps: steps, isError: true, sessionOK: false) }
            catch {
                pending[runID] = PendingResult(chatID: opened.chatID, text: text, steps: steps, isError: true, sessionOK: false)
                throw ConversationError.persistenceFailed
            }
            if cancelled || Task.isCancelled { throw ConversationError.cancelled }
            if exceeded { throw ConversationError.eventLimitExceeded }
            throw error
        }
    }
}
