import Foundation
import SQLite3
import XCTest
@testable import WorldsAutomations

final class PersonalAutomationSnapshotTests: XCTestCase {
    func testUnavailableSchemaReturnsError() async throws {
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let path = root.appendingPathComponent("empty.db")
        var db: OpaquePointer?; XCTAssertEqual(sqlite3_open(path.path, &db), SQLITE_OK)
        sqlite3_close_v2(try XCTUnwrap(db))
        let repository = try AutomationRepository(url: path)
        do { _ = try await repository.personalSnapshot(); XCTFail("Expected a database error") } catch { }
    }
    func testPersonalSnapshotExcludesSharedMalformedAndMismatchedApprovals() async throws {
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "automation-fixture", withExtension: "db"))
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("worlds.db"); try FileManager.default.copyItem(at: fixture, to: file)
        var pointer: OpaquePointer?; XCTAssertEqual(sqlite3_open(file.path, &pointer), SQLITE_OK)
        let db = try XCTUnwrap(pointer)
        let sql = #"""
        UPDATE pending_actions SET payload='{"runId":"r","pageId":"fixture-page","automationId":"a"}' WHERE id='p';
        INSERT INTO pages(id,title,kind,metadata,workspace_id,created_at,updated_at) VALUES('shared','Shared','page','{}','team',1,1),('duplicate-page','Ambiguous','page','{"other":{"x":1,"x":2}}',NULL,1,1);
        INSERT INTO automations(id,name,enabled,spec,created_at,updated_at) VALUES
          ('shared-auto','Shared',1,'{"source":{"pageId":"shared"}}',1,1),
          ('duplicate-auto','Ambiguous',1,'{"source":{"pageId":"shared","pageId":"fixture-page"}}',1,1),
          ('malformed-auto','Malformed',1,'not json',1,1),
          ('duplicate-page-auto','Ambiguous page',1,'{"source":{"pageId":"duplicate-page"}}',1,1);
        INSERT INTO runs(id,automation_id,status,trigger,started_at) VALUES('shared-run','shared-auto','waiting','manual',1);
        INSERT INTO pending_actions(id,kind,payload,requested_by,op_id,status,created_at) VALUES
          ('shared-pending','discord.send','{"runId":"shared-run","automationId":"shared-auto","pageId":"shared"}','automation','shared-run','pending',1),
          ('forged','discord.send','{"runId":"r","automationId":"a","pageId":"shared"}','automation','r','pending',1),
          ('ambiguous','discord.send','{"runId":"r","automationId":"a","pageId":"shared","pageId":"fixture-page"}','automation','r','pending',1);
        """#
        let result = sqlite3_exec(db, sql, nil, nil, nil); sqlite3_close_v2(db); XCTAssertEqual(result, SQLITE_OK)
        let repository = try AutomationRepository(url: file.resolvingSymlinksInPath())
        let snapshot = try await repository.personalSnapshot()
        XCTAssertEqual(snapshot.automations.map(\.id), ["a"])
        XCTAssertEqual(snapshot.runs.map(\.id), ["r"])
        XCTAssertEqual(snapshot.pending.map(\.id), ["p"])
    }
}
