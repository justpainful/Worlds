import Foundation

public struct ConversationMessage: Identifiable, Sendable, Equatable {
    public enum Role: Sendable, Equatable { case user, assistant }
    public let id: String
    public let role: Role
    public let text: String
    /// The tools this reply ran, finished.
    public let steps: [ConversationTool]
    /// The model could not use tools, so this reply is chat only.
    public let chatOnly: Bool
    /// The pages this reply changed, which can be undone together.
    public let changes: ConversationChanges?
    public init(id: String, role: Role, text: String, steps: [ConversationTool] = [], chatOnly: Bool = false, changes: ConversationChanges? = nil) {
        self.id = id; self.role = role; self.text = text
        self.steps = steps; self.chatOnly = chatOnly; self.changes = changes
    }
}
public struct ConversationTool: Identifiable, Sendable, Equatable {
    public enum Status: Sendable, Equatable { case running, succeeded, failed }
    public let id: String
    public let name: String
    public let status: Status
    public init(id: String, name: String, status: Status) { self.id = id; self.name = name; self.status = status }
}
/// A page one reply changed. `openable` is false for a created page that was undone.
public struct ConversationChangedPage: Identifiable, Sendable, Equatable {
    public let id: String
    public let title: String
    public let openable: Bool
    public init(id: String, title: String, openable: Bool) { self.id = id; self.title = title; self.openable = openable }
}
public struct ConversationChanges: Sendable, Equatable {
    public let pages: [ConversationChangedPage]
    public let undone: Bool
    public init(pages: [ConversationChangedPage], undone: Bool) { self.pages = pages; self.undone = undone }
}
public enum ConversationEvent: Sendable {
    /// Must be emitted only after the backing service has persisted the messages.
    case snapshot([ConversationMessage])
    /// Confirms that this request's user message has been persisted.
    case accepted([ConversationMessage])
    case textDelta(String)
    case tool(ConversationTool)
    /// The model refused tools; this reply continues as chat only.
    case chatOnly
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

/// Optional actions for replies that changed the workspace: open a changed
/// page, and undo every change of one reply in one step.
public protocol ConversationWorkspaceActions: ConversationService {
    /// Returns the conversation after the undo, saved.
    func undo(conversationID: String, messageID: String) async throws -> [ConversationMessage]
    func open(pageID: String) async
}
