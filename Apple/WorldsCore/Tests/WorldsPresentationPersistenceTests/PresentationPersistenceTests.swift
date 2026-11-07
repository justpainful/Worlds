import Foundation
import SQLite3
import XCTest
import WorldsPresentations
@testable import WorldsPresentationPersistence

final class PresentationPersistenceTests: XCTestCase {
    private func execute(_ path: URL, _ sql: String) throws {
        var db: OpaquePointer?
        guard sqlite3_open(path.path, &db) == SQLITE_OK, let db else { throw PresentationPersistenceError.invalidResponse }
        defer { sqlite3_close(db) }
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw PresentationPersistenceError.invalidResponse }
    }
    private func database() throws -> URL {
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "worlds-v11", withExtension: "db"))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let path = dir.appendingPathComponent("worlds.db")
        try FileManager.default.copyItem(at: fixture, to: path)
        try execute(path, #"INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('deck','Deck','presentation','{}',1,100); INSERT INTO blocks(id,page_id,type,sort_key,content,created_at,updated_at) VALUES('slide','deck','slide',0,'{"type":"slide","attrs":{"bid":"slide","notes":"old","elements":[]}}',1,1),('opaque','deck','future',1,'{"type":"future","attrs":{"bid":"opaque","keep":true}}',1,1);"#)
        return path
    }
    func testSaveKeepsOpaqueAndConflictingSessionFails() async throws {
        let path = try database()
        let first = try await PresentationPersistence.open(databaseURL: path, pageID: "deck")
        let stale = try await PresentationPersistence.open(databaseURL: path, pageID: "deck")
        var slide = try XCTUnwrap(first.initialSlides.first)
        try slide.setNotes("changed")
        try await first.save(slides: [slide])
        do { try await stale.save(slides: stale.initialSlides); XCTFail("Expected conflict") } catch { }
        let reloaded = try await PresentationPersistence.open(databaseURL: path, pageID: "deck")
        XCTAssertEqual(reloaded.initialSlides.first?.notes, "changed")
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open_v2(path.path, &db, SQLITE_OPEN_READONLY, nil), SQLITE_OK)
        let handle = try XCTUnwrap(db); defer { sqlite3_close(handle) }
        var stmt: OpaquePointer?
        XCTAssertEqual(sqlite3_prepare_v2(handle, "SELECT count(*) FROM blocks WHERE id='opaque' AND json_extract(content,'$.attrs.keep')=1", -1, &stmt, nil), SQLITE_OK)
        let query = try XCTUnwrap(stmt); defer { sqlite3_finalize(query) }
        XCTAssertEqual(sqlite3_step(query), SQLITE_ROW)
        XCTAssertEqual(sqlite3_column_int(query, 0), 1)
    }
}
