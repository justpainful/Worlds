import Foundation
import Darwin
import SQLite3
import XCTest
import WorldsDrawing
import WorldsDrawingNativeWrites
import WorldsDrawingStrokeSession
@testable import WorldsDrawingPencilInput

final class PencilStrokeIntegrationTests: XCTestCase {
    @MainActor func testCapturedInputPersistsAndReopens() async throws {
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "worlds-v11", withExtension: "db"))
        let path = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("pencil-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: fixture, to: path)
        defer { try? FileManager.default.removeItem(at: path) }
        var raw: OpaquePointer?
        guard sqlite3_open(path.path, &raw) == SQLITE_OK, let db = raw else { throw PencilInputError.invalidSample }
        let status = sqlite3_exec(db, "UPDATE pages SET kind='drawing' WHERE id='fixture-page'; INSERT INTO profile(id,display_name,created_at,updated_at) VALUES('artist','Artist',1,1);", nil, nil, nil)
        sqlite3_close_v2(db); XCTAssertEqual(status, SQLITE_OK)
        let resolved = path.withUnsafeFileSystemRepresentation { pointer in pointer.flatMap { realpath($0, nil) } }
        let canonicalPointer = try XCTUnwrap(resolved, "Could not resolve the isolated fixture")
        defer { free(canonicalPointer) }
        let canonical = URL(fileURLWithPath: String(cString: canonicalPointer))
        let writer = try PersonalDrawingWriter(database: canonical)
        let initial = try await writer.load(pageID: "fixture-page")
        let envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: initial) as? [String: Any])
        let doc = try XCTUnwrap(envelope["value"] as? [String: Any])
        let scene = try XCTUnwrap(doc["scene"] as? [String: Any])
        let layer = try XCTUnwrap((scene["layerOrder"] as? [String])?.first)
        let frame = try XCTUnwrap(scene["defaultFrameId"] as? String)
        let session = try PersonalStrokeSession(writer: writer, pageID: "fixture-page")
        let controller = PencilStrokeController(session: session)
        var buffer = PencilStrokeBuffer()
        try buffer.append(PencilRawSample(x: 10, y: 20, force: 1, maximumForce: 2, altitude: .pi / 2, azimuth: 0, timeMilliseconds: 1, isPencil: true, hasPendingEstimates: false))
        try buffer.append(PencilRawSample(x: 20, y: 30, force: 0, maximumForce: 2, altitude: .pi / 2, azimuth: 0, timeMilliseconds: 2, isPencil: true, hasPendingEstimates: false, isRelease: true))
        let saved = await controller.save(buffer, brush: ToolBrush(), tool: .brush, actor: "artist", revision: 0, timestamp: 3, layerID: layer, frameID: frame, seed: 1)
        XCTAssertNotNil(saved, controller.error ?? "Missing write response")
        XCTAssertFalse(controller.hasUnresolvedInput)
        let reopened = try await writer.load(pageID: "fixture-page")
        let reopenedEnvelope = try XCTUnwrap(JSONSerialization.jsonObject(with: reopened) as? [String: Any])
        let reopenedDoc = try XCTUnwrap(reopenedEnvelope["value"] as? [String: Any])
        XCTAssertEqual(reopenedDoc["revision"] as? Int, 1)
        let reopenedScene = try XCTUnwrap(reopenedDoc["scene"] as? [String: Any])
        let nodes = try XCTUnwrap(reopenedScene["nodes"] as? [String: Any])
        let node = try XCTUnwrap(nodes.values.first as? [String: Any])
        let points = try XCTUnwrap(node["samples"] as? [[String: Any]])
        XCTAssertEqual(points.count, 2)
        XCTAssertEqual(points[0]["pressure"] as? Double, 0.5)
        XCTAssertEqual(points[1]["pressure"] as? Double, 0.5)
    }
}
