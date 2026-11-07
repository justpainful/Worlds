import Foundation
import SQLite3
import XCTest
@testable import WorldsPersistence

final class WorldsDatabaseTests: XCTestCase {
    private func fixture() throws -> URL {
        let original = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("worlds-v1-fixture.db")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let copy = directory.appendingPathComponent("worlds.db")
        try FileManager.default.copyItem(at: original, to: copy)
        return copy
    }

    private func execute(_ url: URL, _ sql: String) throws {
        var db: OpaquePointer?
        guard sqlite3_open(url.path, &db) == SQLITE_OK, let db else { throw NSError(domain: "fixture", code: 1) }
        defer { sqlite3_close(db) }
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw NSError(domain: "fixture", code: 2, userInfo: [NSLocalizedDescriptionKey: String(cString: sqlite3_errmsg(db))]) }
    }

    func testReadsRealVersionOneSchemaWithoutWriting() async throws {
        let url = try fixture()
        let before = try Data(contentsOf: url)
        let database = try WorldsDatabase(url: url)
        let snapshot = try await database.snapshot()
        XCTAssertEqual(snapshot.schemaVersion, 1)
        XCTAssertEqual(snapshot.pages.map(\.id), ["fixture-page"])
        XCTAssertEqual(snapshot.pages.first?.blocks.first?.id, "fixture-block")
        XCTAssertTrue(snapshot.pages.first?.blocks.first?.contentJSON.contains("Hello Worlds") == true)
        XCTAssertEqual(try Data(contentsOf: url), before)
    }

    func testExcludesSharedAndDeletedPages() async throws {
        let url = try fixture()
        try execute(url, "ALTER TABLE pages ADD COLUMN workspace_id TEXT; UPDATE pages SET workspace_id='team'; INSERT INTO pages(id,title,created_at,updated_at) VALUES('personal','Mine',1,2); INSERT INTO pages(id,title,deleted_at,created_at,updated_at) VALUES('trash','Trash',3,1,2); PRAGMA user_version=5;")
        let database = try WorldsDatabase(url: url)
        let visible = try await database.snapshot()
        XCTAssertEqual(visible.pages.map(\.id), ["personal"])
        let includingDeleted = try await database.snapshot(includeDeleted: true)
        XCTAssertEqual(Set(includingDeleted.pages.map(\.id)), Set(["personal", "trash"]))
    }

    func testExcludesMetadataFlaggedSharedPages() async throws {
        let url = try fixture()
        try execute(url, "UPDATE pages SET metadata = '{\"sync\":{\"shared\":true}}'")
        let database = try WorldsDatabase(url: url)
        let snapshot = try await database.snapshot()
        XCTAssertTrue(snapshot.pages.isEmpty)
    }
    func testSearchHistoryAndConflictReadOnly() async throws {
        let url = try fixture()
        try execute(url, "INSERT INTO history(page_id,actor,kind,summary,created_at) VALUES('fixture-page','user','renamed','Renamed',1700000000002)")
        let database = try WorldsDatabase(url: url)
        let search = try await database.searchPersonalTitles("fixture")
        XCTAssertEqual(search.map(\.id), ["fixture-page"])
        let history = try await database.personalHistory(pageID: "fixture-page")
        XCTAssertEqual(history.first?.kind, "renamed")
        let changed = try await database.pageChangedSince(id: "fixture-page", base: 1700000000000)
        XCTAssertTrue(changed)
    }
    func testRejectsFutureSchemaWithoutMigration() async throws {
        let url = try fixture()
        try execute(url, "PRAGMA user_version=999")
        let before = try Data(contentsOf: url)
        XCTAssertThrowsError(try WorldsDatabase(url: url))
        XCTAssertEqual(try Data(contentsOf: url), before)
    }

    func testMissingFileIsNotCreated() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        XCTAssertThrowsError(try WorldsDatabase(url: url))
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }
}


