import Foundation
import SQLite3
import XCTest
@testable import WorldsDrawingStorage

final class DrawingStorageTests: XCTestCase {
    private func database() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-drawing-\(UUID().uuidString).db")
        var db: OpaquePointer?
        guard sqlite3_open(url.path, &db) == SQLITE_OK, let db else { throw DrawingStorageError.database }
        defer { sqlite3_close_v2(db) }
        let sql = """
        PRAGMA user_version=11;
        CREATE TABLE pages(id TEXT PRIMARY KEY, kind TEXT, deleted_at INTEGER, workspace_id TEXT, metadata TEXT);
        CREATE TABLE drawing_sync_state(page_id TEXT,user_id TEXT);
        CREATE TABLE drawing_documents(page_id TEXT PRIMARY KEY, revision INTEGER, seed TEXT, scene TEXT, search_text TEXT, thumbnail_id TEXT, updated_at INTEGER);
        CREATE TABLE drawing_operations(page_id TEXT,id TEXT,revision INTEGER,actor TEXT,payload TEXT,created_at INTEGER);
        CREATE TABLE drawing_versions(id TEXT,page_id TEXT,revision INTEGER,label TEXT,author TEXT,scene TEXT,created_at INTEGER);
        INSERT INTO pages VALUES('personal','drawing',NULL,NULL,'{"sync":{"shared":false}}');
        INSERT INTO pages VALUES('shared','drawing',NULL,'workspace','{}');
        INSERT INTO pages VALUES('replica','drawing',NULL,NULL,'{}');
        INSERT INTO drawing_sync_state VALUES('replica','other-user');
        INSERT INTO pages VALUES('flagged','drawing',NULL,NULL,'{"sync":{"shared":true}}');
        INSERT INTO drawing_documents VALUES('personal',1,'{"schema":1,"unknown":{"x":1}}','{"schema":1,"future":[1,2]}','words',NULL,3);
        INSERT INTO drawing_operations VALUES('personal','op',1,'author','{"unknown":{"x":"kept"}}',2);
        INSERT INTO drawing_versions VALUES('ver','personal',1,'Snapshot','author','{"asset":"original"}',3);
        """
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw DrawingStorageError.database }
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }
    func testReadOpaqueRoundTripAndRejectShared() async throws {
        let url = try database()
        let reader = try DrawingStorageReader(url: url)
        let snapshot = try await reader.snapshot(pageID: "personal")
        XCTAssertEqual(snapshot.scene, "{\"schema\":1,\"future\":[1,2]}")
        XCTAssertEqual(snapshot.operations.first?.payload, "{\"unknown\":{\"x\":\"kept\"}}")
        XCTAssertEqual(snapshot.versions.first?.scene, "{\"asset\":\"original\"}")
        let bytes = try JSONEncoder().encode(snapshot)
        XCTAssertEqual(try JSONDecoder().decode(DrawingRecordSnapshot.self, from: bytes), snapshot)
        for page in ["shared", "flagged", "replica", "missing"] {
            do { _ = try await reader.snapshot(pageID: page); XCTFail("Unavailable drawing must be rejected") }
            catch DrawingStorageError.unavailable { } catch { XCTFail("Unexpected error: \(error)") }
        }
    }
}
