#if canImport(WorldsRustStore)
import Foundation
import SQLite3
import XCTest
@testable import WorldsAutomations

final class NativeAutomationDriverTests: XCTestCase {
    private func database(due: Int64) throws -> URL {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "automation-fixture", withExtension: "db"))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let destination = directory.appendingPathComponent("worlds.db")
        try FileManager.default.copyItem(at: source, to: destination)
        var raw: OpaquePointer?
        guard sqlite3_open_v2(destination.path, &raw, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK, let db = raw else { throw AutomationDriverError.invalidURL }
        defer { sqlite3_close_v2(db) }
        let spec = #"{"trigger":{"kind":"once","at":\#(due)},"source":{"pageId":"fixture-page"},"action":{"kind":"discord.send"},"destination":{"kind":"channel","id":"fixture-target"},"policy":{"unattended":false}}"#
        let sql = "DELETE FROM pending_actions; DELETE FROM runs; UPDATE automations SET enabled=1,next_run_at=\(due),spec='\(spec)' WHERE id='a';"
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw AutomationDriverError.invalidResponse }
        return destination
    }
    private static func tryClaim(_ store: NativeAutomationStore, _ due: DueAutomation) async -> Bool {
        do { _ = try await store.claim(due); return true } catch { return false }
    }
    func testIsolatedScheduleClaimRestartAndDecline() async throws {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let url = try database(due: now - 1000)
        let first = try NativeAutomationStore(url: url)
        let entries = try await first.due()
        let due = try XCTUnwrap(entries.first)
        let second = try NativeAutomationStore(url: url)
        async let a = Self.tryClaim(first,due)
        async let b = Self.tryClaim(second,due)
        let results = await [a,b]
        XCTAssertEqual(results.filter { $0 }.count, 1)
        let reopened = try NativeAutomationStore(url: url)
        let afterRestart = try await reopened.due()
        XCTAssertTrue(afterRestart.isEmpty)
        let reader = try AutomationRepository(url: url)
        let pending = try await reader.pending()
        let run = try await reader.runs(automationID: "a")
        XCTAssertEqual(pending.count, 1)
        XCTAssertEqual(run.first?.status, "waiting")
        try await reopened.decline(actionID: try XCTUnwrap(pending.first?.id))
        let remaining = try await reader.pending()
        let finished = try await reader.runs(automationID: "a")
        XCTAssertTrue(remaining.isEmpty)
        XCTAssertEqual(finished.first?.status, "cancelled")
    }
    func testMissedScheduleIsSkippedWithoutApproval() async throws {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let url = try database(due: now - 31 * 60 * 1000)
        let driver = ForegroundAutomationScheduler(store: try NativeAutomationStore(url: url))
        let claimed = try await driver.poll()
        XCTAssertEqual(claimed.first?.status, "skipped")
        let reader = try AutomationRepository(url: url)
        let pending = try await reader.pending()
        XCTAssertTrue(pending.isEmpty)
    }
}
#endif
