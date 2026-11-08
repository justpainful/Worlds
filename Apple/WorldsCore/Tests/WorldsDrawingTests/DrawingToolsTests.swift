import Foundation
import XCTest
@testable import WorldsDrawing

final class DrawingToolsTests: XCTestCase {
    func testStrokeOperationCarriesLocalSamplesAndPressure() throws {
        var brush = ToolBrush(); brush.color = "#00aaff"
        let data = try StrokeOperationBuilder.make(samples: [.init(x: 10,y: 20,pressure: 0.4,time: 1), .init(x: 30,y: 25,pressure: 0.8,time: 2)],
            brush: brush, tool: .brush, nodeID: "n", operationID: "op", actor: "a", revision: 4, timestamp: 9,
            layerID: "layer", frameID: "frame", nodeOrder: ["old"], seed: 1)
        let op = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(op["type"] as? String, "edit")
        XCTAssertEqual(op["base"] as? Int, 4)
        let changes = try XCTUnwrap(op["changes"] as? [[String: Any]])
        XCTAssertEqual(changes[1]["ids"] as? [String], ["old", "n"])
        let node = try XCTUnwrap(changes[0]["value"] as? [String: Any])
        XCTAssertEqual(node["x"] as? Double, 2)
        XCTAssertEqual(node["y"] as? Double, 12)
        XCTAssertEqual(node["w"] as? Double, 36)
        XCTAssertEqual(node["erase"] as? Bool, false)
        let samples = try XCTUnwrap(node["samples"] as? [[String: Double]])
        XCTAssertEqual(samples[0]["x"], 8)
        XCTAssertEqual(samples[0]["pressure"], 0.4)
        let settings = try XCTUnwrap(node["brush"] as? [String: Any])
        XCTAssertEqual(settings["color"] as? String, "#00aaff")
    }
    func testMatchesOriginalStrokeFixture() throws {
        var brush = ToolBrush(); brush.color = "#00aaff"
        let actual = try StrokeOperationBuilder.make(samples: [.init(x: 10,y: 20,pressure: 0.4,time: 1), .init(x: 30,y: 25,pressure: 0.8,time: 2)], brush: brush, tool: .brush,
            nodeID: "n", operationID: "op", actor: "a", revision: 4, timestamp: 9, layerID: "layer", frameID: "frame", nodeOrder: ["old"], seed: 1)
        let url = try XCTUnwrap(Bundle.module.url(forResource: "original-stroke-fixture", withExtension: "json"))
        let expected = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? NSDictionary)
        let result = try XCTUnwrap(JSONSerialization.jsonObject(with: actual) as? NSDictionary)
        XCTAssertEqual(result, expected)
    }
    func testHighlighterEraserAndInvalidBrush() throws {
        let samples = [ToolSample(x: 1,y: 2,pressure: 1,time: 1)]
        func node(_ tool: StrokeTool) throws -> [String: Any] {
            let d = try StrokeOperationBuilder.make(samples: samples, brush: ToolBrush(), tool: tool, nodeID: "n", operationID: "op", actor: "a", revision: 0, timestamp: 1, layerID: "l", frameID: nil, nodeOrder: [], seed: 1)
            let op = try XCTUnwrap(JSONSerialization.jsonObject(with: d) as? [String: Any])
            let changes = try XCTUnwrap(op["changes"] as? [[String: Any]])
            return try XCTUnwrap(changes[0]["value"] as? [String: Any])
        }
        let highlighter = try node(.highlighter)
        XCTAssertEqual((highlighter["brush"] as? [String: Any])?["kind"] as? String, "highlighter")
        XCTAssertEqual(try node(.eraser)["erase"] as? Bool, true)
        var brush = ToolBrush(); brush.kind = "unsupported"
        XCTAssertThrowsError(try StrokeOperationBuilder.make(samples: samples, brush: brush, tool: .brush, nodeID: "n", operationID: "op", actor: "a", revision: 0, timestamp: 1, layerID: "l", frameID: nil, nodeOrder: [], seed: 1))
    }
    func testLaserExpiresWithoutPersistentOperation() {
        var overlay = LaserOverlay()
        let trace = LaserTrace(id: "l", actor: "a", color: "#00ff00", width: 3, points: [.init(x: 1,y: 2)], releasedAt: 1000, lifetime: 500)
        overlay.update(trace)
        XCTAssertEqual(trace.fade(at: 1250), 0.5)
        overlay.prune(at: 1500)
        XCTAssertTrue(overlay.traces.isEmpty)
    }
    func testConservativeRecognition() {
        let line = (0...6).map { ToolPoint(x: Double($0)*10, y: Double($0)*0.1) }
        XCTAssertEqual(ShapeRecognition.recognize(line)?.shape, "line")
        XCTAssertNil(ShapeRecognition.recognize([.init(x: 0,y: 0)]))
    }
}


private struct OriginalShapeFixture: Decodable {
    struct Rect: Decodable { let x: Double, y: Double, w: Double, h: Double }
    struct Result: Decodable { let shape: String, rect: Rect, points: [ToolPoint]?, confidence: Double }
    let points: [ToolPoint], result: Result
}
private struct OriginalPressureFixture: Decodable { let size: Double, opacity: Double }
private struct RecognitionCorpusCase: Decodable {
    let name: String
    let points: [ToolPoint]
    let result: OriginalShapeFixture.Result?
}

extension DrawingToolsTests {
    func testRecognitionMatchesModifiedSourceCorpus() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "recognition-source-corpus", withExtension: "json"))
        let cases = try JSONDecoder().decode([RecognitionCorpusCase].self, from: Data(contentsOf: url))
        XCTAssertEqual(cases.count, 12)
        for item in cases {
            let actual = ShapeRecognition.recognize(item.points)
            guard let expected = item.result else { XCTAssertNil(actual, item.name); continue }
            let result = try XCTUnwrap(actual, item.name)
            XCTAssertEqual(result.shape, expected.shape, item.name)
            XCTAssertEqual(result.x, expected.rect.x, accuracy: 0.000001, item.name)
            XCTAssertEqual(result.y, expected.rect.y, accuracy: 0.000001, item.name)
            XCTAssertEqual(result.width, expected.rect.w, accuracy: 0.000001, item.name)
            XCTAssertEqual(result.height, expected.rect.h, accuracy: 0.000001, item.name)
            XCTAssertEqual(result.confidence, expected.confidence, accuracy: 0.000001, item.name)
            let expectedPoints = expected.points ?? []
            XCTAssertEqual(result.points.count, expectedPoints.count, item.name)
            for (actualPoint, expectedPoint) in zip(result.points, expectedPoints) {
                XCTAssertEqual(actualPoint.x, expectedPoint.x, accuracy: 0.000001, item.name)
                XCTAssertEqual(actualPoint.y, expectedPoint.y, accuracy: 0.000001, item.name)
            }
        }
    }
    func testRecognitionMatchesOriginalShapeFixtures() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "original-shapes-fixture", withExtension: "json"))
        let fixtures = try JSONDecoder().decode([OriginalShapeFixture].self, from: Data(contentsOf: url))
        for fixture in fixtures {
            let result = try XCTUnwrap(ShapeRecognition.recognize(fixture.points))
            XCTAssertEqual(result.shape, fixture.result.shape)
            XCTAssertEqual(result.x, fixture.result.rect.x, accuracy: 0.00001)
            XCTAssertEqual(result.y, fixture.result.rect.y, accuracy: 0.00001)
            XCTAssertEqual(result.width, fixture.result.rect.w, accuracy: 0.00001)
            XCTAssertEqual(result.height, fixture.result.rect.h, accuracy: 0.00001)
            XCTAssertEqual(result.confidence, fixture.result.confidence, accuracy: 0.00001)
            XCTAssertEqual(result.points.count, fixture.result.points?.count ?? 0)
        }
    }
    func testPressureMatchesOriginalDabFixture() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "original-pressure-fixture", withExtension: "json"))
        let expected = try JSONDecoder().decode(OriginalPressureFixture.self, from: Data(contentsOf: url))
        var brush = ToolBrush(); brush.size = 20; brush.flow = 0.8; brush.pressureCurve = 2
        brush.pressureOpacity = true; brush.pressureFlow = true
        let result = try PressureDynamics.values(brush: brush, pressure: 0.5)
        XCTAssertEqual(result.size, expected.size, accuracy: 0.00001)
        XCTAssertEqual(result.opacity, expected.opacity, accuracy: 0.00001)
    }
}

