import Foundation
import SQLite3
import XCTest
@testable import WorldsAI
import WorldsAIConversation
import WorldsAIViews
@testable import WorldsAIConversationBridge

private actor FixtureRunner: ConversationRunner {
    enum Mode { case text, tool, slow }
    let mode: Mode
    init(_ mode: Mode) { self.mode = mode }
    func cancel(runID: UUID) async {}
    func run(_ request: ClaudeRequest, timeout: TimeInterval, onEvent: @escaping @Sendable (ClaudeEvent) -> Void) async throws -> ClaudeResult {
        guard request.mcp == nil else { throw ClaudeConversationBridgeError.unexpectedTool }
        if mode == .slow { try await Task.sleep(for: .seconds(30)) }
        if mode == .tool { onEvent(.tool(name: "unexpected", input: nil)) }
        onEvent(.text("Hello"))
        return ClaudeResult(text: "Hello", isError: false)
    }
}

final class ClaudeConversationBridgeTests: XCTestCase {
    private func store() throws -> (SQLiteConversationStore, URL) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("ai-bridge-\(UUID().uuidString).db")
        var ptr: OpaquePointer?
        guard sqlite3_open(url.path, &ptr) == SQLITE_OK, let db = ptr else { throw ClaudeConversationBridgeError.unavailable }
        let sql = """
        PRAGMA user_version=11;
        CREATE TABLE ai_chats(id TEXT PRIMARY KEY,title TEXT NOT NULL,page_id TEXT,session_id TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
        CREATE TABLE ai_messages(id TEXT PRIMARY KEY,chat_id TEXT NOT NULL REFERENCES ai_chats(id),role TEXT NOT NULL,content TEXT NOT NULL,steps TEXT NOT NULL,op_id TEXT,meta TEXT NOT NULL,created_at INTEGER NOT NULL);
        """
        let status = sqlite3_exec(db, sql, nil, nil, nil); sqlite3_close_v2(db)
        guard status == SQLITE_OK else { throw ClaudeConversationBridgeError.unavailable }
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return (try SQLiteConversationStore(database: url), url)
    }
    func testAcceptedPrecedesStreamAndSavedMessagesReload() async throws {
        let service = try ClaudeConversationService(conversationID: "isolated", store: store().0, runner: FixtureRunner(.text))
        var order: [String] = []
        for try await event in service.send(conversationID: "isolated", runID: UUID(), text: "Question") {
            switch event {
            case .accepted(let messages): order.append("accepted"); XCTAssertEqual(messages.last?.text, "Question")
            case .textDelta(let value): order.append(value)
            default: break
            }
        }
        XCTAssertEqual(order, ["accepted", "Hello"])
        let messages = try await service.load(conversationID: "isolated")
        XCTAssertEqual(messages.map(\.text), ["Question", "Hello"])
        do { _ = try await service.load(conversationID: "other"); XCTFail("Different conversation must be rejected") } catch { }
    }
    func testUnexpectedToolIsRejectedWithoutMCP() async throws {
        let service = try ClaudeConversationService(conversationID: "isolated", store: store().0, runner: FixtureRunner(.tool))
        do {
            for try await _ in service.send(conversationID: "isolated", runID: UUID(), text: "Question") { }
            XCTFail("Unexpected tool must fail")
        } catch ClaudeConversationBridgeError.unexpectedTool { } catch { XCTFail("Unexpected error: \(error)") }
        let saved = try await service.load(conversationID: "isolated")
        XCTAssertEqual(saved.first?.text, "Question")
    }
    func testFailedFinalSaveRemainsRecoverable() async throws {
        let (store, url) = try store()
        var raw: OpaquePointer?
        guard sqlite3_open(url.path, &raw) == SQLITE_OK, let db = raw else { throw ClaudeConversationBridgeError.unavailable }
        let created = sqlite3_exec(db, "CREATE TRIGGER refuse_assistant BEFORE INSERT ON ai_messages WHEN NEW.role='assistant' BEGIN SELECT RAISE(ABORT,'fixture'); END;", nil, nil, nil)
        sqlite3_close_v2(db); XCTAssertEqual(created, SQLITE_OK)
        let service = try ClaudeConversationService(conversationID: "isolated", store: store, runner: FixtureRunner(.text))
        do {
            for try await _ in service.send(conversationID: "isolated", runID: UUID(), text: "Question") { }
            XCTFail("Failed final save must be reported")
        } catch ClaudeConversationBridgeError.persistenceFailed { } catch { XCTFail("Unexpected error: \(error)") }
        let pending = await service.hasPendingSave(); XCTAssertTrue(pending)
        var retryRaw: OpaquePointer?
        guard sqlite3_open(url.path, &retryRaw) == SQLITE_OK, let retryDB = retryRaw else { throw ClaudeConversationBridgeError.unavailable }
        let removed = sqlite3_exec(retryDB, "DROP TRIGGER refuse_assistant", nil, nil, nil)
        sqlite3_close_v2(retryDB); XCTAssertEqual(removed, SQLITE_OK)
        try await service.retryPendingSave()
        let after = await service.hasPendingSave(); XCTAssertFalse(after)
        let messages = try await service.load(conversationID: "isolated")
        XCTAssertEqual(messages.map(\.text), ["Question", "Hello"])
    }
    func testCancelAfterAcceptanceStopsRun() async throws {
        let service = try ClaudeConversationService(conversationID: "isolated", store: store().0, runner: FixtureRunner(.slow))
        let runID = UUID()
        var accepted = false
        do {
            for try await event in service.send(conversationID: "isolated", runID: runID, text: "Question") {
                if case .accepted = event { accepted = true; try await service.cancel(runID: runID) }
            }
            XCTFail("Cancelled run must not report success")
        } catch ClaudeConversationBridgeError.cancelled { } catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertTrue(accepted)
    }
}
