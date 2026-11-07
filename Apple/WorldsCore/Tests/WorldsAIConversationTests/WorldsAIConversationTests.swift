import Foundation
import SQLite3
import XCTest
@testable import WorldsAI
@testable import WorldsAIConversation

private actor FakeConversationRunner: ConversationRunner {
    enum Mode: Equatable { case normal, unexpectedTool, slow, flood, oversized }
    let mode: Mode
    init(_ mode: Mode) { self.mode = mode }
    func cancel(runID: UUID) async {}
    func run(_ request: ClaudeRequest, timeout: TimeInterval, onEvent: @escaping @Sendable (ClaudeEvent) -> Void) async throws -> ClaudeResult {
        XCTAssertNil(request.mcp)
        if mode == .slow { try await Task.sleep(for: .seconds(10)) }
        if mode == .flood { for _ in 0...20_000 { onEvent(.text("x")) } }
        if mode == .oversized { onEvent(.text(String(repeating: "x", count: 8 * 1024 * 1024 + 1))) }
        if mode == .unexpectedTool { onEvent(.tool(name: "unexpected", input: nil)); onEvent(.toolResult(isError: false)) }
        onEvent(.text("Hello"))
        return ClaudeResult(text: "Hello", isError: false)
    }
}
private final class AcceptanceProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var accepted = false
    private var eventBeforeAcceptance = false
    func markAccepted() { lock.lock(); defer { lock.unlock() }; accepted = true }
    func markEvent() { lock.lock(); defer { lock.unlock() }; if !accepted { eventBeforeAcceptance = true } }
    func state() -> (Bool, Bool) { lock.lock(); defer { lock.unlock() }; return (accepted, eventBeforeAcceptance) }
}
final class WorldsAIConversationTests: XCTestCase {
    private func fixture() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("ai-\(UUID().uuidString).db")
        var ptr: OpaquePointer?
        guard sqlite3_open(url.path, &ptr) == SQLITE_OK, let db = ptr else { throw ConversationStorageError.database }
        defer { sqlite3_close_v2(db) }
        let sql = """
        PRAGMA user_version=11;
        CREATE TABLE ai_chats(id TEXT PRIMARY KEY,title TEXT NOT NULL,page_id TEXT,session_id TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
        CREATE TABLE ai_messages(id TEXT PRIMARY KEY,chat_id TEXT NOT NULL REFERENCES ai_chats(id),role TEXT NOT NULL,content TEXT NOT NULL,steps TEXT NOT NULL,op_id TEXT,meta TEXT NOT NULL,created_at INTEGER NOT NULL);
        """
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw ConversationStorageError.database }
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }
    func testRunnerWritesAndResumesOriginalTables() async throws {
        let store = try SQLiteConversationStore(database: fixture())
        let coordinator = ConversationCoordinator(store: store, runner: FakeConversationRunner(.normal))
        let result = try await coordinator.run(runID: UUID(), chatID: nil, prompt: "Question", systemPrompt: "", onEvent: { _ in })
        let messages = try await store.messages(chatID: result.chatID)
        XCTAssertEqual(messages.map(\.role), ["user", "assistant"])
        XCTAssertEqual(messages.last?.content, "Hello")
        XCTAssertTrue(messages.last?.metadataJSON.contains("\"sessionOk\":true") == true)
        let next = try await store.begin(chatID: result.chatID, prompt: "Follow up", runID: UUID())
        XCTAssertTrue(next.resume)
    }
    func testUnexpectedToolIsRecordedAsErrorWithoutPermission() async throws {
        let store = try SQLiteConversationStore(database: fixture())
        let coordinator = ConversationCoordinator(store: store, runner: FakeConversationRunner(.unexpectedTool))
        let seedID = UUID()
        let opened = try await store.begin(chatID: nil, prompt: "First", runID: seedID)
        try await store.finish(chatID: opened.chatID, runID: seedID, text: "seed", steps: [], isError: true, sessionOK: false)
        do { _ = try await coordinator.run(runID: UUID(), chatID: opened.chatID, prompt: "Next", systemPrompt: "", onEvent: { _ in }); XCTFail("Unexpected tool must fail") }
        catch ConversationError.unexpectedTool { } catch { XCTFail("Unexpected error: \(error)") }
        let messages = try await store.messages(chatID: opened.chatID)
        XCTAssertTrue(messages.last?.metadataJSON.contains("\"isError\":true") == true)
        XCTAssertTrue(messages.last?.stepsJSON.contains("unexpected") == true)
    }
    func testCancellationKeepsUserAndFailureRecord() async throws {
        let store = try SQLiteConversationStore(database: fixture())
        let seedID = UUID()
        let opened = try await store.begin(chatID: nil, prompt: "First", runID: seedID)
        try await store.finish(chatID: opened.chatID, runID: seedID, text: "seed", steps: [], isError: true, sessionOK: false)
        let coordinator = ConversationCoordinator(store: store, runner: FakeConversationRunner(.slow))
        let id = UUID()
        let task = Task { try await coordinator.run(runID: id, chatID: opened.chatID, prompt: "Next", systemPrompt: "", onEvent: { _ in }) }
        for _ in 0..<100 {
            let messages = try await store.messages(chatID: opened.chatID)
            if messages.count >= 3 { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        await coordinator.cancel(runID: id)
        do { _ = try await task.value; XCTFail("Cancellation must fail the run") }
        catch ConversationError.cancelled { } catch { XCTFail("Unexpected error: \(error)") }
        let messages = try await store.messages(chatID: opened.chatID)
        XCTAssertEqual(messages.map(\.role), ["user", "assistant", "user", "assistant"])
        XCTAssertTrue(messages.last?.metadataJSON.contains("\"sessionOk\":false") == true)
    }
    func testFailedAssistantSaveRollsBackAndCanRetry() async throws {
        let url = try fixture(), store = try SQLiteConversationStore(database: url)
        let id = UUID()
        let chat = try await store.begin(chatID: nil, prompt: "Question", runID: id)
        var ptr: OpaquePointer?
        guard sqlite3_open(url.path, &ptr) == SQLITE_OK, let db = ptr else { return XCTFail("Could not open fixture") }
        defer { sqlite3_close_v2(db) }
        XCTAssertEqual(sqlite3_exec(db, "CREATE TRIGGER fail_result BEFORE INSERT ON ai_messages WHEN NEW.role='assistant' BEGIN SELECT RAISE(ABORT,'disk'); END;", nil, nil, nil), SQLITE_OK)
        do { try await store.finish(chatID: chat.chatID, runID: id, text: "result", steps: [], isError: false, sessionOK: true); XCTFail("Injected fault must fail") }
        catch ConversationStorageError.database { } catch { XCTFail("Unexpected error: \(error)") }
        let before = try await store.messages(chatID: chat.chatID)
        XCTAssertEqual(before.map(\.role), ["user"])
        XCTAssertEqual(sqlite3_exec(db, "DROP TRIGGER fail_result", nil, nil, nil), SQLITE_OK)
        try await store.finish(chatID: chat.chatID, runID: id, text: "result", steps: [], isError: false, sessionOK: true)
        let after = try await store.messages(chatID: chat.chatID)
        XCTAssertEqual(after.map(\.role), ["user", "assistant"])
    }

    func testAcknowledgementPrecedesStreamAndDuplicateRunIsRejected() async throws {
        let store = try SQLiteConversationStore(database: fixture())
        let coordinator = ConversationCoordinator(store: store, runner: FakeConversationRunner(.normal))
        let runID = UUID(), probe = AcceptanceProbe()
        let result = try await coordinator.run(runID: runID, chatID: nil, prompt: "Question", systemPrompt: "", onAccepted: { _ in probe.markAccepted() }, onEvent: { _ in probe.markEvent() })
        let (accepted, early) = probe.state()
        XCTAssertTrue(accepted); XCTAssertFalse(early)
        let recovered = await store.acceptedChatID(runID: runID)
        XCTAssertEqual(recovered, result.chatID)
        do { _ = try await store.begin(chatID: result.chatID, prompt: "duplicate", runID: runID); XCTFail("Duplicate must fail") }
        catch ConversationStorageError.unavailable { } catch { XCTFail("Unexpected error: \(error)") }
        let rows = try await store.messages(chatID: result.chatID)
        XCTAssertEqual(rows.count, 2)
    }
    func testAnotherStoreCannotAccessExistingConversation() async throws {
        let url = try fixture()
        let owner = try SQLiteConversationStore(database: url)
        let chat = try await owner.begin(chatID: nil, prompt: "private", runID: UUID())
        let other = try SQLiteConversationStore(database: url)
        do { _ = try await other.messages(chatID: chat.chatID); XCTFail("Another store must not read the chat") }
        catch ConversationStorageError.unavailable { } catch { XCTFail("Unexpected error: \(error)") }
        do { _ = try await other.begin(chatID: chat.chatID, prompt: "other", runID: UUID()); XCTFail("Another store must not resume the chat") }
        catch ConversationStorageError.unavailable { } catch { XCTFail("Unexpected error: \(error)") }
    }

    func testCoordinatorRetainsFailedResultForRetry() async throws {
        let url = try fixture(), store = try SQLiteConversationStore(database: url)
        var ptr: OpaquePointer?
        guard sqlite3_open(url.path, &ptr) == SQLITE_OK, let db = ptr else { return XCTFail("Could not open fixture") }
        defer { sqlite3_close_v2(db) }
        XCTAssertEqual(sqlite3_exec(db, "CREATE TRIGGER fail_result BEFORE INSERT ON ai_messages WHEN NEW.role='assistant' BEGIN SELECT RAISE(ABORT,'disk'); END;", nil, nil, nil), SQLITE_OK)
        let coordinator = ConversationCoordinator(store: store, runner: FakeConversationRunner(.normal)), id = UUID()
        do { _ = try await coordinator.run(runID: id, chatID: nil, prompt: "Question", systemPrompt: "", onEvent: { _ in }); XCTFail("Save must fail") }
        catch ConversationError.persistenceFailed { } catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertEqual(sqlite3_exec(db, "DROP TRIGGER fail_result", nil, nil, nil), SQLITE_OK)
        let result = try await coordinator.retrySave(runID: id)
        XCTAssertEqual(result.text, "Hello")
        let rows = try await store.messages(chatID: result.chatID)
        XCTAssertEqual(rows.map(\.role), ["user", "assistant"])
    }

    func testUnmatchedRunCannotFinishOrReleaseReservation() async throws {
        let store = try SQLiteConversationStore(database: fixture()), acceptedID = UUID()
        let chat = try await store.begin(chatID: nil, prompt: "Question", runID: acceptedID)
        do { try await store.finish(chatID: chat.chatID, runID: UUID(), text: "wrong", steps: [], isError: false, sessionOK: true); XCTFail("Unmatched run must fail") }
        catch ConversationStorageError.invalidData { } catch { XCTFail("Unexpected error: \(error)") }
        let before = try await store.messages(chatID: chat.chatID)
        XCTAssertEqual(before.map(\.role), ["user"])
        try await store.finish(chatID: chat.chatID, runID: acceptedID, text: "right", steps: [], isError: false, sessionOK: true)
        let after = try await store.messages(chatID: chat.chatID)
        XCTAssertEqual(after.map(\.content), ["Question", "right"])
    }
    func testEventLimitsFailAndPreserveBoundedOutput() async throws {
        for mode: FakeConversationRunner.Mode in [.flood, .oversized] {
            let store = try SQLiteConversationStore(database: fixture())
            let coordinator = ConversationCoordinator(store: store, runner: FakeConversationRunner(mode))
            let id = UUID()
            do { _ = try await coordinator.run(runID: id, chatID: nil, prompt: "Question", systemPrompt: "", onEvent: { _ in }); XCTFail("Limit must fail") }
            catch ConversationError.eventLimitExceeded { } catch { XCTFail("Unexpected error: \(error)") }
            let maybeChat = await store.acceptedChatID(runID: id)
            let chat = try XCTUnwrap(maybeChat)
            let messages = try await store.messages(chatID: chat)
            XCTAssertTrue(messages.last?.metadataJSON.contains("\"isError\":true") == true)
            XCTAssertLessThanOrEqual(messages.last?.content.utf8.count ?? .max, 8 * 1024 * 1024)
        }
    }

}
