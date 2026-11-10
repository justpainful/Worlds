import Foundation
import XCTest
@testable import WorldsAIConversation

final class IsolatedRecoveryJournalTests: XCTestCase {
    func testOutboxReopensAndRejectsConcurrentOwner() async throws {
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: root) }
        let response = IsolatedPendingResponse(runID: UUID(), chatID: "test-chat", text: "رد محفوظ", steps: [], isError: false, sessionOK: true)
        var first: IsolatedRecoveryJournal? = try IsolatedRecoveryJournal(directory: root)
        try await first!.put(response)
        XCTAssertThrowsError(try IsolatedRecoveryJournal(directory: root))
        first = nil
        let reopened = try IsolatedRecoveryJournal(directory: root)
        let records = try await reopened.records()
        XCTAssertEqual(records, [response])
        try await reopened.remove(runID: response.runID)
        let empty = try await reopened.records()
        XCTAssertTrue(empty.isEmpty)
    }
    func testRejectsWorldReadableDirectory() throws {
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: root.path)
        defer { try? FileManager.default.removeItem(at: root) }
        XCTAssertThrowsError(try IsolatedRecoveryJournal(directory: root))
    }
}
