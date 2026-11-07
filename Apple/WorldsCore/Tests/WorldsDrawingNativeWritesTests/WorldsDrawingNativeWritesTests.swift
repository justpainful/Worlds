import Foundation
import SQLite3
import XCTest
@testable import WorldsDrawingNativeWrites

final class WorldsDrawingNativeWritesTests: XCTestCase {
    private func value(_ data: Data) throws -> [String: Any] {
        let envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return try XCTUnwrap(envelope["value"] as? [String: Any])
    }
    func testPersonalDrawingOriginalSaveAndConflict() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-v11", withExtension: "db"))
        let url = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("drawing-write-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        var db: OpaquePointer?
        guard sqlite3_open(url.path, &db) == SQLITE_OK, let db else { return XCTFail("Fixture open failed") }
        let status = sqlite3_exec(db, "UPDATE pages SET kind='drawing' WHERE id='fixture-page'; INSERT INTO profile(id,display_name,created_at,updated_at) VALUES('artist','Artist',1,1);", nil, nil, nil)
        sqlite3_close_v2(db)
        XCTAssertEqual(status, SQLITE_OK)
        let store = try PersonalDrawingWriter(database: url)
        let before = try value(await store.load(pageID: "fixture-page"))
        let scene = try XCTUnwrap(before["scene"] as? [String: Any])
        let layer = try XCTUnwrap((scene["layerOrder"] as? [String])?.first)
        let operation: [String: Any] = ["id":"op-1", "actor":"artist", "base":0, "at":1, "label":"Rename", "type":"edit", "changes":[["type":"patch", "collection":"layers", "id":layer, "fields":["name":"Ink"]]]]
        let data = try JSONSerialization.data(withJSONObject: operation)
        let saved = try value(await store.apply(pageID: "fixture-page", changeJSON: data))
        XCTAssertEqual(saved["revision"] as? Int, 1)
        let reopened = try value(await store.load(pageID: "fixture-page"))
        XCTAssertEqual(reopened["revision"] as? Int, 1)
        var stale = operation; stale["id"] = "op-2"
        do { _ = try await store.apply(pageID: "fixture-page", changeJSON: JSONSerialization.data(withJSONObject: stale)); XCTFail("Stale operation must fail") }
        catch DrawingWriteError.failed { } catch { XCTFail("Unexpected error: \(error)") }
    }
}
