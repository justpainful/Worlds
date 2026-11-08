import Foundation
import WorldsAI
import WorldsAIConversation
import WorldsAIViews

public enum ClaudeConversationBridgeError: Error, LocalizedError {
    case unavailable, busy, cancelled, persistenceFailed, unexpectedTool, limitExceeded, invalidResponse, runtimeFailed
    public var errorDescription: String? {
        switch self {
        case .unavailable: return "This isolated conversation is unavailable."
        case .busy: return "Another response is in progress."
        case .cancelled: return "The response was cancelled."
        case .persistenceFailed: return "The response could not be saved. Keep this session open to recover it."
        case .unexpectedTool: return "The runtime requested a tool that was not authorized."
        case .limitExceeded: return "The response exceeded the session limit."
        case .invalidResponse: return "The saved conversation is invalid."
        case .runtimeFailed: return "Claude reported an error. The response was saved in this isolated conversation."
        }
    }
}
private enum BridgeInput: Sendable { case accepted(String), event(ClaudeEvent) }

/// Experimental, page-free chat only. The caller must provide a private isolated
/// schema-v11 store and a trusted runner; never use a live Worlds database.
/// No MCP server or tool permissions are provided by this adapter.
public actor ClaudeConversationService: ConversationRecoveryService {
    private let id: String
    private let store: SQLiteConversationStore
    private let coordinator: ConversationCoordinator
    private var chatID: String?
    private var activeRun: UUID?
    private var pendingSaveRun: UUID?
    private var cancelled: Set<UUID> = []
    public init(conversationID: String, store: SQLiteConversationStore, runner: any ConversationRunner) throws {
        guard !conversationID.isEmpty else { throw ClaudeConversationBridgeError.unavailable }
        self.id = conversationID; self.store = store
        self.coordinator = ConversationCoordinator(store: store, runner: runner)
    }
    public func load(conversationID: String) async throws -> [ConversationMessage] {
        guard conversationID == id else { throw ClaudeConversationBridgeError.unavailable }
        guard let chatID else { return [] }
        return try await savedMessages(chatID: chatID)
    }
    public nonisolated func send(conversationID: String, runID: UUID, text: String) -> AsyncThrowingStream<ConversationEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task { await self.perform(conversationID: conversationID, runID: runID, text: text, continuation: continuation) }
            continuation.onTermination = { @Sendable termination in
                if case .cancelled = termination { task.cancel(); Task { await self.cancel(runID: runID) } }
            }
        }
    }
    public func hasPendingSave() -> Bool { pendingSaveRun != nil }
    public func retryPendingSave() async throws {
        guard activeRun == nil, let runID = pendingSaveRun else { throw ClaudeConversationBridgeError.unavailable }
        do {
            let result = try await coordinator.retrySave(runID: runID)
            chatID = result.chatID
            pendingSaveRun = nil
        } catch { throw ClaudeConversationBridgeError.persistenceFailed }
    }
    public func cancel(runID: UUID) async {
        guard activeRun == runID else { return }
        cancelled.insert(runID)
        await coordinator.cancel(runID: runID)
    }
    private func perform(conversationID: String, runID: UUID, text: String, continuation: AsyncThrowingStream<ConversationEvent, Error>.Continuation) async {
        guard conversationID == id else { continuation.finish(throwing: ClaudeConversationBridgeError.unavailable); return }
        guard activeRun == nil else { continuation.finish(throwing: ClaudeConversationBridgeError.busy); return }
        guard pendingSaveRun == nil else { continuation.finish(throwing: ClaudeConversationBridgeError.persistenceFailed); return }
        activeRun = runID
        defer { activeRun = nil; cancelled.remove(runID) }
        let (events, input) = AsyncStream<BridgeInput>.makeStream()
        let worker = Task { try await self.forward(events, runID: runID, text: text, continuation: continuation) }
        do {
            let result = try await coordinator.run(runID: runID, chatID: chatID, prompt: text, systemPrompt: "", onAccepted: { chat in
                input.yield(.accepted(chat))
            }, onEvent: { event in input.yield(.event(event)) })
            input.finish()
            try await worker.value
            chatID = result.chatID
            if result.isError { throw ClaudeConversationBridgeError.runtimeFailed }
            continuation.finish()
        } catch {
            input.finish()
            do { try await worker.value } catch { continuation.finish(throwing: error); return }
            if let failure = error as? ConversationError {
                switch failure {
                case .busy: continuation.finish(throwing: ClaudeConversationBridgeError.busy)
                case .cancelled: continuation.finish(throwing: ClaudeConversationBridgeError.cancelled)
                case .persistenceFailed:
                    pendingSaveRun = runID
                    continuation.finish(throwing: ClaudeConversationBridgeError.persistenceFailed)
                case .unexpectedTool: continuation.finish(throwing: ClaudeConversationBridgeError.unexpectedTool)
                case .eventLimitExceeded: continuation.finish(throwing: ClaudeConversationBridgeError.limitExceeded)
                case .invalidRequest: continuation.finish(throwing: ClaudeConversationBridgeError.invalidResponse)
                }
            } else { continuation.finish(throwing: error) }
        }
    }
    private func forward(_ events: AsyncStream<BridgeInput>, runID: UUID, text: String, continuation: AsyncThrowingStream<ConversationEvent, Error>.Continuation) async throws {
        for await event in events {
            switch event {
            case .accepted(let acceptedID):
                chatID = acceptedID
                let messages = try await savedMessages(chatID: acceptedID)
                guard let lastUser = messages.lastIndex(where: { $0.role == .user && $0.text == text }) else { throw ClaudeConversationBridgeError.invalidResponse }
                continuation.yield(.accepted(Array(messages[...lastUser])))
                if cancelled.contains(runID) { await coordinator.cancel(runID: runID) }
            case .event(let event):
                if case .text(let delta) = event { continuation.yield(.textDelta(delta)) }
                // Tool input is deliberately never surfaced or executed here.
            }
        }
    }
    private func savedMessages(chatID: String) async throws -> [ConversationMessage] {
        try await store.messages(chatID: chatID).map { item in
            let role: ConversationMessage.Role
            switch item.role {
            case "user": role = .user
            case "assistant": role = .assistant
            default: throw ClaudeConversationBridgeError.invalidResponse
            }
            return ConversationMessage(id: item.id, role: role, text: item.content)
        }
    }
}
