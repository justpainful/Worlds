import Foundation

public struct ConversationMessage: Identifiable, Sendable, Equatable {
    public enum Role: Sendable, Equatable { case user, assistant }
    public let id: String
    public let role: Role
    public let text: String
    public init(id: String, role: Role, text: String) { self.id = id; self.role = role; self.text = text }
}
public struct ConversationTool: Identifiable, Sendable, Equatable {
    public enum Status: Sendable, Equatable { case running, succeeded, failed }
    public let id: String
    public let name: String
    public let status: Status
    public init(id: String, name: String, status: Status) { self.id = id; self.name = name; self.status = status }
}
public enum ConversationEvent: Sendable {
    /// Must be emitted only after the backing service has persisted the messages.
    case snapshot([ConversationMessage])
    /// Confirms that this request's user message has been persisted.
    case accepted([ConversationMessage])
    case textDelta(String)
    case tool(ConversationTool)
}
/// The host implements this with an authorized, real conversation service.
/// Streams finish only when the underlying run is finished or cancelled.
public protocol ConversationService: Sendable {
    func load(conversationID: String) async throws -> [ConversationMessage]
    func send(conversationID: String, runID: UUID, text: String) -> AsyncThrowingStream<ConversationEvent, Error>
    func cancel(runID: UUID) async throws
}

/// Optional recovery of a final response retained by the service in memory.
public protocol ConversationRecoveryService: ConversationService {
    func hasPendingSave() async -> Bool
    func retryPendingSave() async throws
}
