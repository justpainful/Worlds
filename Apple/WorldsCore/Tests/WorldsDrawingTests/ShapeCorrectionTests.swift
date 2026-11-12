import Foundation
import CoreGraphics
import XCTest
import WorldsModels
@testable import WorldsDrawing

/// Recognition to shape node conversion, checked against the desktop rules in
/// `src/drawing/Stage.tsx` (pointer up) and `addNode` in `DrawingView.tsx`.
final class ShapeCorrectionTests: XCTestCase {
    private struct CorpusCase: Decodable {
        struct Rect: Decodable { let x: Double, y: Double, w: Double, h: Double }
        struct Result: Decodable { let shape: String, rect: Rect, points: [ToolPoint]? }
        let name: String
        let points: [ToolPoint]
        let result: Result?
    }

    private func corpus() throws -> [CorpusCase] {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "recognition-source-corpus", withExtension: "json"))
        return try JSONDecoder().decode([CorpusCase].self, from: Data(contentsOf: url))
    }
    private func samples(_ points: [ToolPoint], dx: Double = 0, dy: Double = 0) -> [ToolSample] {
        points.enumerated().map { ToolSample(x: $0.element.x + dx, y: $0.element.y + dy, pressure: 0.5, time: Double($0.offset)) }
    }
    private func brush(color: String = "#ef3d35", size: Double = 7) -> ToolBrush {
        var brush = ToolBrush(); brush.color = color; brush.size = size
        return brush
    }
    /// The stroke edit and its node, exactly as the editor saves them.
    private func strokeOperation(_ samples: [ToolSample], brush: ToolBrush, tool: StrokeTool = .brush,
                                 layer: String = "l", frame: String = "f") throws -> (Data, [String: JSONValue]) {
        let data = try StrokeOperationBuilder.make(samples: samples, brush: brush, tool: tool, nodeID: "node",
            operationID: "stroke-op", actor: "artist", revision: 0, timestamp: 1, layerID: layer, frameID: frame, nodeOrder: [], seed: 1)
        let operation = try XCTUnwrap(try JSONDecoder().decode(JSONValue.self, from: data).obj)
        let change = try XCTUnwrap(operation["changes"]?.arr?.first?.obj)
        return (data, try XCTUnwrap(change["value"]?.obj))
    }
    private func emptyDocument(size: Int = 400) throws -> DrawingDocument {
        let scene = """
        {"schema":1,"defaultFrameId":"f","frames":{"f":{"id":"f","name":"Frame","x":0,"y":0,"w":\(size),"h":\(size),"background":"#ffffff","clip":true,"status":"draft","exportScale":1}},"frameOrder":["f"],"layers":{"l":{"id":"l","name":"Layer","visible":true,"locked":false,"positionLocked":false,"alphaLocked":false,"opacity":1,"blend":"source-over","parentId":null}},"layerOrder":["l"],"nodes":{},"nodeOrder":[],"assets":{},"masks":{},"steps":{},"stepOrder":[]}
        """
        return try DrawingDocument(json: Data("{\"revision\":0,\"seed\":\(scene),\"scene\":\(scene),\"operations\":[]}".utf8))
    }
    private func node(_ document: DrawingDocument, _ id: String = "node") -> [String: JSONValue]? {
        document.scene.source.obj?["nodes"]?.obj?[id]?.obj
    }

    func testEveryRecognizedCorpusShapeBecomesTheDesktopShapeNode() throws {
        var covered = Set<String>()
        for item in try corpus() {
            guard let expected = item.result else { continue }
            let strokeSamples = samples(item.points)
            let (_, stroke) = try strokeOperation(strokeSamples, brush: brush())
            let recognized = try XCTUnwrap(ShapeCorrection.recognize(strokeSamples), item.name)
            XCTAssertEqual(recognized.shape, expected.shape, item.name)
            let fields = try ShapeCorrection.patchFields(stroke: stroke, recognized: recognized)
            covered.insert(recognized.shape)

            XCTAssertEqual(fields["kind"], .string("shape"), item.name)
            XCTAssertEqual(fields["shape"], .string(expected.shape), item.name)
            XCTAssertNil(fields["id"], item.name)
            XCTAssertNil(fields["samples"], "JSON drops the desktop's samples: undefined; \(item.name)")
            for (key, value) in [("x", expected.rect.x), ("y", expected.rect.y), ("w", expected.rect.w), ("h", expected.rect.h)] {
                XCTAssertEqual(try XCTUnwrap(fields[key]?.num, item.name), value, accuracy: 0.000001, "\(item.name) \(key)")
            }
            // Corners relative to the new rectangle, or no points at all.
            if let corners = expected.points {
                let points = try XCTUnwrap(fields["points"]?.arr, item.name)
                XCTAssertEqual(points.count, corners.count, item.name)
                for (point, corner) in zip(points, corners) {
                    XCTAssertEqual(try XCTUnwrap(point.obj?["x"]?.num), corner.x - expected.rect.x, accuracy: 0.000001, item.name)
                    XCTAssertEqual(try XCTUnwrap(point.obj?["y"]?.num), corner.y - expected.rect.y, accuracy: 0.000001, item.name)
                }
            } else {
                XCTAssertNil(fields["points"], item.name)
            }
            // Colour and width come from the brush; the rest of the paint is kept.
            let paint = try XCTUnwrap(fields["paint"]?.obj, item.name)
            XCTAssertEqual(paint["stroke"], .string("#ef3d35"), item.name)
            XCTAssertEqual(try XCTUnwrap(paint["strokeWidth"]?.num, item.name), 7, item.name)
            XCTAssertEqual(paint["fill"], stroke["paint"]?.obj?["fill"], item.name)
            XCTAssertEqual(paint["cap"], stroke["paint"]?.obj?["cap"], item.name)
            // Every other stroke field is carried over.
            for key in ["name", "layerId", "frameId", "brush", "seed", "erase", "alphaLock", "rotation", "opacity", "visible", "textStyle", "effects"] {
                XCTAssertEqual(fields[key], stroke[key], "\(item.name) \(key)")
            }
            // originalSamples: the stroke samples moved into the new rectangle.
            let original = try XCTUnwrap(fields["originalSamples"]?.arr, item.name)
            XCTAssertEqual(original.count, strokeSamples.count, item.name)
            for (moved, sample) in zip(original, strokeSamples) {
                let value = try XCTUnwrap(moved.obj, item.name)
                XCTAssertEqual(try XCTUnwrap(value["x"]?.num), sample.x - expected.rect.x, accuracy: 0.000001, item.name)
                XCTAssertEqual(try XCTUnwrap(value["y"]?.num), sample.y - expected.rect.y, accuracy: 0.000001, item.name)
                XCTAssertEqual(try XCTUnwrap(value["pressure"]?.num), sample.pressure, item.name)
                XCTAssertEqual(try XCTUnwrap(value["time"]?.num), sample.time, item.name)
            }
        }
        XCTAssertEqual(covered, ShapeCorrection.correctableShapes)
    }

    func testColourAndWidthFollowTheStrokeBrush() throws {
        let line = (0...20).map { ToolPoint(x: 20 + Double($0) * 8, y: 30 + Double($0) * 2) }
        for (color, size) in [("#007aff", 1.0), ("#30a46c", 12.5), ("#202023", 48.0)] {
            let strokeSamples = samples(line)
            let (_, stroke) = try strokeOperation(strokeSamples, brush: brush(color: color, size: size))
            let recognized = try XCTUnwrap(ShapeCorrection.recognize(strokeSamples))
            XCTAssertEqual(recognized.shape, "line")
            let node = try ShapeCorrection.correctedNode(stroke: stroke, recognized: recognized)
            XCTAssertEqual(node["paint"]?.obj?["stroke"], .string(color))
            XCTAssertEqual(try XCTUnwrap(node["paint"]?.obj?["strokeWidth"]?.num), size)
            XCTAssertEqual(node["brush"], stroke["brush"])
            // The merged node keeps its samples, as the desktop's stored node does.
            XCTAssertEqual(node["samples"], stroke["samples"])
            XCTAssertEqual(node["id"], .string("node"))
            XCTAssertEqual(node["points"]?.arr?.count, 2)
        }
    }

    func testOnlyBrushStrokesAreEligibleAndInvalidInputIsRefused() throws {
        XCTAssertTrue(ShapeCorrection.isEligible(.brush))
        XCTAssertFalse(ShapeCorrection.isEligible(.highlighter))
        XCTAssertFalse(ShapeCorrection.isEligible(.eraser))
        let square = (0...10).map { ToolPoint(x: 20 + Double($0) * 8, y: 20) } + (1...10).map { ToolPoint(x: 100, y: 20 + Double($0) * 8) }
            + (1...10).map { ToolPoint(x: 100 - Double($0) * 8, y: 100) } + (1...10).map { ToolPoint(x: 20, y: 100 - Double($0) * 8) }
        let strokeSamples = samples(square)
        let recognized = try XCTUnwrap(ShapeCorrection.recognize(strokeSamples))
        XCTAssertEqual(recognized.shape, "rect")
        let (_, stroke) = try strokeOperation(strokeSamples, brush: brush())
        let (_, eraser) = try strokeOperation(strokeSamples, brush: brush(), tool: .eraser)
        XCTAssertThrowsError(try ShapeCorrection.patchFields(stroke: eraser, recognized: recognized))
        var shape = stroke; shape["kind"] = .string("shape")
        XCTAssertThrowsError(try ShapeCorrection.patchFields(stroke: shape, recognized: recognized))
        let arrow = RecognizedDrawingShape(shape: "arrow", x: 0, y: 0, width: 10, height: 10, points: [], confidence: 1)
        XCTAssertThrowsError(try ShapeCorrection.patchFields(stroke: stroke, recognized: arrow))
        let brokenLine = RecognizedDrawingShape(shape: "line", x: 0, y: 0, width: 10, height: 10, points: [], confidence: 1)
        XCTAssertThrowsError(try ShapeCorrection.patchFields(stroke: stroke, recognized: brokenLine))
        let infinite = RecognizedDrawingShape(shape: "ellipse", x: .infinity, y: 0, width: 10, height: 10, points: [], confidence: 1)
        XCTAssertThrowsError(try ShapeCorrection.patchFields(stroke: stroke, recognized: infinite))
    }

    /// Stroke, then correction, then undo and redo through the journal: undo
    /// restores the original stroke exactly, redo brings the shape back.
    func testUndoOfTheCorrectionRestoresTheOriginalStroke() throws {
        let item = try XCTUnwrap(try corpus().first { $0.name == "rotated-square" })
        let strokeSamples = samples(item.points, dx: 60, dy: 60)
        let (strokeData, stroke) = try strokeOperation(strokeSamples, brush: brush())
        var document = try emptyDocument()
        document = try DrawingJournal.append(try JSONDecoder().decode(JSONValue.self, from: strokeData), to: document, actor: "artist")
        let saved = try XCTUnwrap(node(document))
        XCTAssertEqual(saved, stroke)

        let recognized = try XCTUnwrap(ShapeCorrection.recognize(strokeSamples))
        XCTAssertEqual(recognized.shape, "rect")
        let correctionData = try ShapeCorrectionOperationBuilder.make(strokeOperation: strokeData, recognized: recognized,
            operationID: "correction-op", actor: "artist", revision: 1, timestamp: 2)
        let correction = try JSONDecoder().decode(JSONValue.self, from: correctionData)
        XCTAssertEqual(correction.obj?["label"], .string(ShapeCorrection.operationLabel))
        XCTAssertEqual(correction.obj?["type"], .string("edit"))
        XCTAssertEqual(correction.obj?["base"], .integer(1))
        XCTAssertEqual(correction.obj?["changes"]?.arr?.count, 1)
        document = try DrawingJournal.append(correction, to: document, actor: "artist")
        let corrected = try XCTUnwrap(node(document))
        XCTAssertEqual(corrected["kind"], .string("shape"))
        XCTAssertEqual(corrected["shape"], .string("rect"))
        XCTAssertEqual(corrected["points"]?.arr?.count, 4)
        XCTAssertEqual(corrected["samples"], stroke["samples"])
        XCTAssertEqual(document.scene.source.obj?["nodeOrder"], .array([.string("node")]))

        let undo = try XCTUnwrap(try DrawingJournal.toggle(in: document, actor: "artist", redo: false, id: "undo-op", at: 3))
        XCTAssertEqual(undo.obj?["target"], .string("correction-op"))
        document = try DrawingJournal.append(undo, to: document, actor: "artist")
        XCTAssertEqual(try XCTUnwrap(node(document)), stroke)

        let redo = try XCTUnwrap(try DrawingJournal.toggle(in: document, actor: "artist", redo: true, id: "redo-op", at: 4))
        XCTAssertEqual(redo.obj?["target"], .string("correction-op"))
        document = try DrawingJournal.append(redo, to: document, actor: "artist")
        XCTAssertEqual(try XCTUnwrap(node(document)), corrected)
        XCTAssertEqual(try DrawingDocument(json: document.json()).source, document.source)
    }

    func testCorrectionOfAStaleOrForeignStrokeIsRefused() throws {
        let line = (0...20).map { ToolPoint(x: 20 + Double($0) * 8, y: 30 + Double($0) * 2) }
        let strokeSamples = samples(line)
        let (strokeData, _) = try strokeOperation(strokeSamples, brush: brush())
        let recognized = try XCTUnwrap(ShapeCorrection.recognize(strokeSamples))
        XCTAssertNoThrow(try ShapeCorrectionOperationBuilder.make(strokeOperation: strokeData, recognized: recognized,
            operationID: "ok", actor: "artist", revision: 1, timestamp: 2))
        XCTAssertThrowsError(try ShapeCorrectionOperationBuilder.make(strokeOperation: strokeData, recognized: recognized,
            operationID: "stale", actor: "artist", revision: 2, timestamp: 2))
        XCTAssertThrowsError(try ShapeCorrectionOperationBuilder.make(strokeOperation: strokeData, recognized: recognized,
            operationID: "other", actor: "someone-else", revision: 1, timestamp: 2))
        XCTAssertThrowsError(try ShapeCorrectionOperationBuilder.make(strokeOperation: strokeData, recognized: recognized,
            operationID: "", actor: "artist", revision: 1, timestamp: 2))
    }

    /// The editor preview accepts every corrected shape and paints it in the brush colour.
    func testEditorPreviewRendersEveryCorrectedShape() throws {
        for item in try corpus() where item.result != nil {
            let strokeSamples = samples(item.points, dx: 60, dy: 60)
            let (strokeData, _) = try strokeOperation(strokeSamples, brush: brush())
            let recognized = try XCTUnwrap(ShapeCorrection.recognize(strokeSamples), item.name)
            var document = try DrawingJournal.append(try JSONDecoder().decode(JSONValue.self, from: strokeData), to: emptyDocument(), actor: "artist")
            let correction = try ShapeCorrectionOperationBuilder.make(strokeOperation: strokeData, recognized: recognized,
                operationID: "correction-op", actor: "artist", revision: 1, timestamp: 2)
            document = try DrawingJournal.append(try JSONDecoder().decode(JSONValue.self, from: correction), to: document, actor: "artist")
            let context = try XCTUnwrap(CGContext(data: nil, width: 400, height: 400, bitsPerComponent: 8, bytesPerRow: 1600,
                space: drawingColorSpace(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.translateBy(x: 0, y: 400); context.scaleBy(x: 1, y: -1)
            XCTAssertNoThrow(try ExperimentalStrokeSceneRenderer.render(scene: document.scene, frameID: "f", in: context, allowCorrectedShapes: true), item.name)
            XCTAssertThrowsError(try ExperimentalStrokeSceneRenderer.render(scene: document.scene, frameID: "f", in: context), item.name)
            let report = try DrawingRenderer().render(scene: document.scene, frameID: "f", in: context)
            XCTAssertEqual(report.renderedNodeCount, 1, item.name)
            XCTAssertFalse(report.issues.contains { $0.reason.contains("unsupported(") || $0.reason.contains("malformed") }, item.name)
        }
    }

    func testCorrectedRectangleIsPaintedOnItsEdge() throws {
        let square = (0...15).map { ToolPoint(x: 100 + Double($0) * 8, y: 100) } + (1...10).map { ToolPoint(x: 220, y: 100 + Double($0) * 8) }
            + (1...15).map { ToolPoint(x: 220 - Double($0) * 8, y: 180) } + (1...10).map { ToolPoint(x: 100, y: 180 - Double($0) * 8) }
        let strokeSamples = samples(square)
        let (strokeData, _) = try strokeOperation(strokeSamples, brush: brush(color: "#ff0000", size: 8))
        let recognized = try XCTUnwrap(ShapeCorrection.recognize(strokeSamples))
        XCTAssertEqual(recognized.shape, "rect")
        var document = try DrawingJournal.append(try JSONDecoder().decode(JSONValue.self, from: strokeData), to: emptyDocument(), actor: "artist")
        let correction = try ShapeCorrectionOperationBuilder.make(strokeOperation: strokeData, recognized: recognized,
            operationID: "correction-op", actor: "artist", revision: 1, timestamp: 2)
        document = try DrawingJournal.append(try JSONDecoder().decode(JSONValue.self, from: correction), to: document, actor: "artist")
        let context = try XCTUnwrap(CGContext(data: nil, width: 400, height: 400, bitsPerComponent: 8, bytesPerRow: 1600,
            space: drawingColorSpace(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.translateBy(x: 0, y: 400); context.scaleBy(x: 1, y: -1)
        try ExperimentalStrokeSceneRenderer.render(scene: document.scene, frameID: "f", in: context, allowCorrectedShapes: true)
        let data = try XCTUnwrap(context.data).bindMemory(to: UInt8.self, capacity: 1600 * 400)
        func rgb(_ x: Int, _ y: Int) -> (Int, Int, Int) { let at = y * 1600 + x * 4; return (Int(data[at]), Int(data[at + 1]), Int(data[at + 2])) }
        let edge = rgb(160, 100), inside = rgb(160, 140)
        XCTAssert(edge.0 > 200 && edge.1 < 60 && edge.2 < 60, "The top edge must be red, got \(edge)")
        XCTAssert(inside.0 > 240 && inside.1 > 240 && inside.2 > 240, "The inside must stay white, got \(inside)")
    }
}

private extension JSONValue {
    var obj: [String: JSONValue]? { if case .object(let value) = self { return value }; return nil }
    var arr: [JSONValue]? { if case .array(let value) = self { return value }; return nil }
    var num: Double? {
        switch self { case .integer(let value): return Double(value); case .number(let value): return value; default: return nil }
    }
}
