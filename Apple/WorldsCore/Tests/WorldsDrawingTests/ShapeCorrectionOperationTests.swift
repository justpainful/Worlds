import Foundation
import XCTest
@testable import WorldsDrawing

final class ShapeCorrectionOperationTests: XCTestCase {
    func testRightTrianglePatchKeepsOriginalStrokeAndSourceGeometry() throws {
        struct Fixture: Decodable { struct Result: Decodable { let shape: String }; let points: [ToolPoint]; let result: Result? }
        let url = try XCTUnwrap(Bundle.module.url(forResource: "original-shapes-fixture", withExtension: "json"))
        let corpus = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
        let fixture = try XCTUnwrap(corpus.first { $0.result?.shape == "right-triangle" })
        let recognized = try XCTUnwrap(ShapeRecognition.recognize(fixture.points))
        XCTAssertEqual(recognized.shape, "right-triangle")
        let samples = fixture.points.enumerated().map { ToolSample(x: $0.element.x, y: $0.element.y, pressure: 0.5, time: Double($0.offset)) }
        let stroke = try StrokeOperationBuilder.make(samples: samples, brush: ToolBrush(), tool: .brush,
            nodeID: "node", operationID: "stroke", actor: "artist", revision: 0, timestamp: 1,
            layerID: "layer", frameID: "frame", nodeOrder: [], seed: 1)
        let correction = try ShapeCorrectionOperationBuilder.make(strokeOperation: stroke, recognized: recognized,
            operationID: "correction", actor: "artist", revision: 1, timestamp: 2)
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: correction) as? [String: Any])
        let patch = try XCTUnwrap((root["changes"] as? [[String: Any]])?.first)
        let fields = try XCTUnwrap(patch["fields"] as? [String: Any])
        let strokeRoot = try XCTUnwrap(JSONSerialization.jsonObject(with: stroke) as? [String: Any])
        let strokeNode = try XCTUnwrap(((strokeRoot["changes"] as? [[String: Any]])?.first)?["value"] as? [String: Any])
        XCTAssertEqual(fields["kind"] as? String, "shape")
        XCTAssertEqual(fields["shape"] as? String, "right-triangle")
        XCTAssertNil(fields["samples"])
        // As on the desktop, originalSamples are the stroke samples moved into the shape rectangle.
        let originalSamples = try XCTUnwrap(fields["originalSamples"] as? [[String: Any]])
        let strokeSamples = try XCTUnwrap(strokeNode["samples"] as? [[String: Any]])
        XCTAssertEqual(originalSamples.count, strokeSamples.count)
        let nodeX = try XCTUnwrap(strokeNode["x"] as? Double), nodeY = try XCTUnwrap(strokeNode["y"] as? Double)
        for (moved, sample) in zip(originalSamples, strokeSamples) {
            XCTAssertEqual(try XCTUnwrap(moved["x"] as? Double), try XCTUnwrap(sample["x"] as? Double) + nodeX - recognized.x, accuracy: 0.000001)
            XCTAssertEqual(try XCTUnwrap(moved["y"] as? Double), try XCTUnwrap(sample["y"] as? Double) + nodeY - recognized.y, accuracy: 0.000001)
            XCTAssertEqual(moved["pressure"] as? Double, sample["pressure"] as? Double)
        }
        XCTAssertEqual((fields["points"] as? [[String: Double]])?.count, 3)
        XCTAssertEqual((fields["paint"] as? [String: Any])?["strokeWidth"] as? Double, 12)
        XCTAssertThrowsError(try ShapeCorrectionOperationBuilder.make(strokeOperation: stroke, recognized: recognized,
            operationID: "bad", actor: "artist", revision: 2, timestamp: 3))
    }
}
