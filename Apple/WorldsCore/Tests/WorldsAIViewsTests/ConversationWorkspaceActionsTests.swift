import Foundation
import XCTest
@testable import WorldsAIViews

private final class ToolFixtureService: ConversationWorkspaceActions, @unchecked Sendable {
    private let lock = NSLock()
    private var saved: [ConversationMessage] = []
    private var opened: [String] = []

    var openedPages: [String] { lock.withLock { opened } }

    func load(conversationID: String) async throws -> [ConversationMessage] { lock.withLock { saved } }

    func send(conversationID: String, runID: UUID, text: String) -> AsyncThrowingStream<ConversationEvent, Error> {
        let reply = ConversationMessage(
            id: "reply", role: .assistant, text: "Added two tasks.",
            steps: [ConversationTool(id: "s0", name: "Add tasks", status: .succeeded)], chatOnly: false,
            changes: ConversationChanges(pages: [ConversationChangedPage(id: "p1", title: "Groceries", openable: true)], undone: false))
        let messages = [ConversationMessage(id: "user", role: .user, text: text), reply]
        lock.withLock { saved = messages }
        return AsyncThrowingStream { continuation in
            continuation.yield(.accepted([messages[0]]))
            continuation.yield(.chatOnly)
            continuation.yield(.tool(ConversationTool(id: "s0", name: "Add tasks", status: .running)))
            continuation.yield(.textDelta("Added two tasks."))
            continuation.yield(.snapshot(messages))
            continuation.finish()
        }
    }

    func cancel(runID: UUID) async throws {}

    func undo(conversationID: String, messageID: String) async throws -> [ConversationMessage] {
        lock.withLock {
            saved = saved.map { message in
                guard message.id == messageID, let changes = message.changes else { return message }
                return ConversationMessage(id: message.id, role: message.role, text: message.text, steps: message.steps,
                                           chatOnly: message.chatOnly, changes: ConversationChanges(pages: changes.pages, undone: true))
            }
            return saved
        }
    }

    func open(pageID: String) async { lock.withLock { opened.append(pageID) } }
}

@MainActor
final class ConversationWorkspaceActionsTests: XCTestCase {
    func testRepliesKeepStepsAndChangesAndCanBeUndone() async {
        let service = ToolFixtureService()
        let model = ConversationViewModel(conversationID: "fixture", service: service)
        XCTAssertTrue(model.supportsWorkspaceActions)
        await model.load(); model.draft = "Add milk and bread"; await model.send()
        XCTAssertFalse(model.running)
        XCTAssertEqual(model.streamedText, "")
        XCTAssertTrue(model.tools.isEmpty)
        let reply = model.messages.last
        XCTAssertEqual(reply?.steps.map(\.status), [.succeeded])
        XCTAssertEqual(reply?.changes?.undone, false)

        await model.open(pageID: "p1")
        XCTAssertEqual(service.openedPages, ["p1"])
        await model.undo(messageID: "reply")
        XCTAssertEqual(model.messages.last?.changes?.undone, true)
        XCTAssertNil(model.undoing)
        XCTAssertNil(model.error)
    }

    func testPlainServicesOfferNoWorkspaceActions() {
        struct Plain: ConversationService {
            func load(conversationID: String) async throws -> [ConversationMessage] { [] }
            func send(conversationID: String, runID: UUID, text: String) -> AsyncThrowingStream<ConversationEvent, Error> {
                AsyncThrowingStream { $0.finish() }
            }
            func cancel(runID: UUID) async throws {}
        }
        XCTAssertFalse(ConversationViewModel(conversationID: "fixture", service: Plain()).supportsWorkspaceActions)
    }
}
