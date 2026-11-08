import Foundation
import Darwin
import SQLite3
import XCTest
import WorldsDrawing
import WorldsDrawingNativeWrites

final class ShapeCorrectionPersistenceTests: XCTestCase {
    func testCorrectionReopensAndRejectedCorrectionRetainsStroke() async throws {
        struct Fixture: Decodable { struct Result: Decodable { let shape: String }; let points: [ToolPoint]; let result: Result? }
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "worlds-v11", withExtension: "db"))
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let path = root.appendingPathComponent("drawing.db"); try FileManager.default.copyItem(at: fixture, to: path)
        var connection: OpaquePointer?; XCTAssertEqual(sqlite3_open(path.path, &connection), SQLITE_OK)
        let db = try XCTUnwrap(connection)
        let status = sqlite3_exec(db, "UPDATE pages SET kind='drawing' WHERE id='fixture-page'; INSERT INTO profile(id,display_name,created_at,updated_at) VALUES('artist','Artist',1,1);", nil, nil, nil)
        sqlite3_close_v2(db); XCTAssertEqual(status, SQLITE_OK)
        let resolved = path.withUnsafeFileSystemRepresentation { pointer in pointer.flatMap { realpath($0, nil) } }
        let canonicalPointer = try XCTUnwrap(resolved, "Could not resolve the isolated fixture")
        defer { free(canonicalPointer) }
        let canonical = URL(fileURLWithPath: String(cString: canonicalPointer))
        let writer = try PersonalDrawingWriter(database: canonical)
        func document(_ data: Data) throws -> [String: Any] {
            let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            return try XCTUnwrap(root["value"] as? [String: Any])
        }
        let initial = try document(await writer.load(pageID: "fixture-page"))
        let scene = try XCTUnwrap(initial["scene"] as? [String: Any])
        let layer = try XCTUnwrap((scene["layerOrder"] as? [String])?.first)
        let frame = try XCTUnwrap(scene["defaultFrameId"] as? String)
        let points: [ToolPoint] = (0...10).map { .init(x: 20, y: 20 + Double($0) * 8) }
            + (1...10).map { .init(x: 20 + Double($0) * 8, y: 100) }
            + (1...10).map { .init(x: 100 - Double($0) * 8, y: 100 - Double($0) * 8) }
        let shape = try XCTUnwrap(ShapeRecognition.recognize(points)); XCTAssertEqual(shape.shape, "right-triangle")
        let samples = points.enumerated().map { ToolSample(x: $0.element.x, y: $0.element.y, pressure: 0.5, time: Double($0.offset)) }
        let stroke = try StrokeOperationBuilder.make(samples: samples, brush: ToolBrush(), tool: .brush,
            nodeID: "stroke-node", operationID: "stroke-op", actor: "artist", revision: 0, timestamp: 1,
            layerID: layer, frameID: frame, nodeOrder: [], seed: 1)
        _ = try await writer.apply(pageID: "fixture-page", changeJSON: stroke)
        let correction = try ShapeCorrectionOperationBuilder.make(strokeOperation: stroke, recognized: shape,
            operationID: "shape-op", actor: "artist", revision: 1, timestamp: 2)
        var stale = try XCTUnwrap(JSONSerialization.jsonObject(with: correction) as? [String: Any]); stale["base"] = -1
        do { _ = try await writer.apply(pageID: "fixture-page", changeJSON: JSONSerialization.data(withJSONObject: stale)); XCTFail("Invalid correction unexpectedly succeeded") } catch { }
        let afterFailure = try document(await writer.load(pageID: "fixture-page"))
        let unchanged = try XCTUnwrap((afterFailure["scene"] as? [String: Any])?["nodes"] as? [String: [String: Any]])
        XCTAssertEqual(unchanged["stroke-node"]?["kind"] as? String, "stroke")
        _ = try await writer.apply(pageID: "fixture-page", changeJSON: correction)
        let reopenedWriter = try PersonalDrawingWriter(database: canonical)
        let reopened = try document(await reopenedWriter.load(pageID: "fixture-page"))
        let nodes = try XCTUnwrap((reopened["scene"] as? [String: Any])?["nodes"] as? [String: [String: Any]])
        let node = try XCTUnwrap(nodes["stroke-node"])
        XCTAssertEqual(node["shape"] as? String, "right-triangle")
        XCTAssertEqual((node["originalSamples"] as? [[String: Any]])?.count, samples.count)
        XCTAssertEqual((node["points"] as? [[String: Any]])?.count, 3)
    }
}
