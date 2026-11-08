import Foundation
import SQLite3
import XCTest
import WorldsDrawing
import WorldsDrawingNativeWrites
@testable import WorldsDrawingStrokeSession

final class PersonalStrokeSessionTests: XCTestCase {
    private func setup() throws -> (URL, PersonalDrawingWriter) {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-v11", withExtension: "db"))
        let path = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("stroke-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: path)
        addTeardownBlock { try? FileManager.default.removeItem(at: path) }
        var raw: OpaquePointer?
        guard sqlite3_open(path.path, &raw) == SQLITE_OK, let db = raw else { throw StrokeSessionError.invalidScene }
        let status = sqlite3_exec(db, "UPDATE pages SET kind='drawing' WHERE id='fixture-page'; INSERT INTO profile(id,display_name,created_at,updated_at) VALUES('artist','Artist',1,1);", nil, nil, nil)
        sqlite3_close_v2(db)
        XCTAssertEqual(status, SQLITE_OK)
        return (path, try PersonalDrawingWriter(database: path))
    }
    private func document(_ data: Data) throws -> [String: Any] {
        let envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return try XCTUnwrap(envelope["value"] as? [String: Any])
    }
    private func ids(_ document: [String: Any]) throws -> (String, String) {
        let scene = try XCTUnwrap(document["scene"] as? [String: Any])
        let layer = try XCTUnwrap((scene["layerOrder"] as? [String])?.first)
        return (layer, try XCTUnwrap(scene["defaultFrameId"] as? String))
    }
    func testStrokePersistsAndStaleRevisionIsRejected() async throws {
        let (_, writer) = try setup()
        let initial = try document(await writer.load(pageID: "fixture-page"))
        let (layer, frame) = try ids(initial)
        let session = try PersonalStrokeSession(writer: writer, pageID: "fixture-page")
        let samples = [ToolSample(x: 10,y: 20,pressure: 0.5,time: 1), ToolSample(x: 20,y: 30,pressure: 0.8,time: 2)]
        let saved = try document(await session.submit(samples: samples, brush: ToolBrush(), tool: .brush, actor: "artist", expectedRevision: 0, timestamp: 2, layerID: layer, frameID: frame, seed: 1))
        XCTAssertEqual(saved["revision"] as? Int, 1)
        let scene = try XCTUnwrap(saved["scene"] as? [String: Any])
        let nodes = try XCTUnwrap(scene["nodes"] as? [String: Any])
        let node = try XCTUnwrap(nodes.values.first as? [String: Any])
        XCTAssertEqual(node["layerId"] as? String, layer)
        XCTAssertEqual(node["frameId"] as? String, frame)
        XCTAssertEqual((node["samples"] as? [[String: Any]])?.count, 2)
        let reloaded = try document(await writer.load(pageID: "fixture-page"))
        XCTAssertEqual(reloaded["revision"] as? Int, 1)
        do {
            _ = try await session.submit(samples: samples, brush: ToolBrush(), tool: .brush, actor: "artist", expectedRevision: 0, timestamp: 3, layerID: layer, frameID: frame, seed: 1)
            XCTFail("Stale revision must fail")
        } catch StrokeSessionError.staleRevision { } catch { XCTFail("Unexpected error: \(error)") }
    }
    func testLockedLayerAndUnknownFrameAreRejected() async throws {
        let (_, writer) = try setup()
        let initial = try document(await writer.load(pageID: "fixture-page"))
        let (layer, frame) = try ids(initial)
        let operation: [String: Any] = ["id":"lock-op", "actor":"artist", "base":0, "at":1, "label":"Lock", "type":"edit", "changes":[["type":"patch", "collection":"layers", "id":layer, "fields":["locked":true]]]]
        _ = try await writer.apply(pageID: "fixture-page", changeJSON: JSONSerialization.data(withJSONObject: operation))
        let session = try PersonalStrokeSession(writer: writer, pageID: "fixture-page")
        let samples = [ToolSample(x: 1,y: 2,pressure: 1,time: 1)]
        do { _ = try await session.submit(samples: samples, brush: ToolBrush(), tool: .brush, actor: "artist", expectedRevision: 1, timestamp: 2, layerID: layer, frameID: frame, seed: 1); XCTFail("Locked layer must fail") }
        catch StrokeSessionError.lockedLayer { } catch { XCTFail("Unexpected error: \(error)") }
        do { _ = try await session.submit(samples: samples, brush: ToolBrush(), tool: .brush, actor: "artist", expectedRevision: 1, timestamp: 2, layerID: layer, frameID: "missing", seed: 1); XCTFail("Missing frame must fail") }
        catch StrokeSessionError.missingFrame { } catch { XCTFail("Unexpected error: \(error)") }
        let unchanged = try document(await writer.load(pageID: "fixture-page"))
        XCTAssertEqual(unchanged["revision"] as? Int, 1)
    }
}
