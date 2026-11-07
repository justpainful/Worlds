import Foundation
import XCTest
@testable import WorldsAutomations

final class WorldsAutomationsTests: XCTestCase {
    private func ms(_ iso: String) -> Int64 {
        Int64(ISO8601DateFormatter().date(from: iso)!.timeIntervalSince1970 * 1000)
    }
    func testTimezoneAndMonthlyClamping() {
        let riyadh = TimeZone(identifier: "Asia/Riyadh")!
        XCTAssertEqual(AutomationTiming.nextRun(.daily(time: "09:00"), after: ms("2026-02-01T05:00:00Z"), timeZone: riyadh), ms("2026-02-01T06:00:00Z"))
        XCTAssertEqual(AutomationTiming.nextRun(.monthly(day: 31, time: "08:00"), after: ms("2026-02-01T00:00:00Z"), timeZone: riyadh), ms("2026-02-28T05:00:00Z"))
        XCTAssertEqual(AutomationTiming.nextRun(.daily(time: "invalid"), after: ms("2026-02-01T05:00:00Z"), timeZone: riyadh), ms("2026-02-01T06:00:00Z"))
    }
    func testDaylightSavingGapAndRepeatedTime() {
        let ny = TimeZone(identifier: "America/New_York")!
        XCTAssertEqual(AutomationTiming.nextRun(.daily(time: "02:30"), after: ms("2026-03-08T05:00:00Z"), timeZone: ny), ms("2026-03-09T06:30:00Z"))
        XCTAssertEqual(AutomationTiming.nextRun(.daily(time: "01:30"), after: ms("2026-11-01T04:00:00Z"), timeZone: ny), ms("2026-11-01T05:30:00Z"))
        XCTAssertEqual(AutomationTiming.nextRun(.daily(time: "01:30"), after: ms("2026-11-01T05:45:00Z"), timeZone: ny), ms("2026-11-02T06:30:00Z"))
    }
    func testOfflineGraceAndOnce() {
        XCTAssertEqual(AutomationTiming.disposition(scheduledAt: 1_000, now: 1_801_000, graceMinutes: nil), .run)
        XCTAssertEqual(AutomationTiming.disposition(scheduledAt: 1_000, now: 1_801_001, graceMinutes: nil), .skipped)
        XCTAssertEqual(AutomationTiming.disposition(scheduledAt: 2_000, now: 1_000, graceMinutes: nil), .notDue)
        XCTAssertNil(AutomationTiming.nextRun(.once(at: 123), after: 123))
        XCTAssertNil(AutomationTiming.nextRun(.manual, after: 0))
    }
    func testOriginalJSONDefaults() throws {
        let data = Data(#"{"trigger":{"kind":"daily","time":"09:00"},"source":{"pageId":"x"},"destination":{"kind":"channel"}}"#.utf8)
        let spec = try JSONDecoder().decode(AutomationSpec.self, from: data)
        XCTAssertEqual(spec.policy, AutomationPolicy())
        XCTAssertEqual(spec.destination?.id, "")
        XCTAssertEqual(spec.action, .null)
    }
    func testReadOriginalDatabaseWithoutMutation() async throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "automation-fixture", withExtension: "db"))
        let store = try AutomationRepository(url: url)
        let automations = try await store.automations()
        let runs = try await store.runs(automationID: "a")
        let pending = try await store.pending()
        XCTAssertEqual(automations.first?.lastStatus, "waiting")
        XCTAssertEqual(runs.first?.id, "r")
        XCTAssertEqual(pending.first?.id, "p")
    }
}
