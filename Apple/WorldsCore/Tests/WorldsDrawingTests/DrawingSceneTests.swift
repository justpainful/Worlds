import Foundation
import CoreGraphics
import XCTest
import WorldsModels
@testable import WorldsDrawing

final class DrawingSceneTests: XCTestCase {
    private let fixture = #"""
    {"schema":1,"defaultFrameId":"f","frames":{"f":{"id":"f","x":0,"y":0,"w":32,"h":32,"background":"#ffffff","clip":true,"name":"Frame","status":"draft","exportScale":1}},"frameOrder":["f"],
    "layers":{"l":{"id":"l","name":"Layer","visible":true,"opacity":1,"blend":"source-over","parentId":null}},"layerOrder":["l"],
    "nodes":{"n":{"id":"n","kind":"shape","shape":"rect","layerId":"l","frameId":"f","x":2,"y":2,"w":10,"h":10,"rotation":0,"opacity":1,"visible":true,"effects":[],"paint":{"fill":"#ff0000","stroke":"transparent","strokeWidth":0,"dash":[],"radius":0}},
    "s":{"id":"s","kind":"stroke","layerId":"l","frameId":"f","x":2,"y":15,"w":10,"h":10,"rotation":0,"opacity":1,"visible":true,"effects":[],"brush":{"kind":"hard","size":2,"color":"#000000"},"samples":[{"x":1,"y":1},{"x":8,"y":8}]},
    "u":{"id":"u","kind":"futureNode","layerId":"l","frameId":"f","x":1,"y":1,"w":1,"h":1,"rotation":0,"opacity":1,"visible":true,"effects":[],"future":{"preserve":true}}},"nodeOrder":["n","s","u"],
    "assets":{},"masks":{},"steps":{},"stepOrder":[],"future":{"private":false}}
    """#
    func testSceneRoundTripPreservesUnknownFields() throws {
        let source = try JSONDecoder().decode(JSONValue.self, from: Data(fixture.utf8))
        let scene = try DrawingScene(source: source)
        let decoded = try JSONDecoder().decode(JSONValue.self, from: scene.json())
        XCTAssertEqual(decoded, source)
    }
    func testDocumentJournalRoundTripIsLossless() throws {
        let input = "{\"revision\":1,\"seed\":\(fixture),\"scene\":\(fixture),\"operations\":[{\"type\":\"futureOperation\",\"payload\":{\"x\":1}}],\"unknown\":true}"
        let original = try JSONDecoder().decode(JSONValue.self, from: Data(input.utf8))
        let document = try DrawingDocument(json: Data(input.utf8))
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: document.json()), original)
    }
    func testUnsupportedSchemaIsRejected() throws {
        let input = fixture.replacingOccurrences(of: "\"schema\":1", with: "\"schema\":2")
        XCTAssertThrowsError(try DrawingScene(json: Data(input.utf8)))
    }
    func testPreviewReportsApproximationsAndUnsupportedElements() throws {
        let scene = try DrawingScene(json: Data(fixture.utf8))
        let context = try XCTUnwrap(CGContext(data: nil, width: 32, height: 32, bitsPerComponent: 8, bytesPerRow: 128, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        let report = try DrawingRenderer().render(scene: scene, frameID: "f", in: context)
        XCTAssertEqual(report.renderedNodeCount, 2)
        XCTAssertFalse(report.isExact)
        XCTAssertEqual(Set(report.issues.map(\.elementID)), Set(["n", "s", "u"]))
    }
    func testMissingFrameFailsWithoutRendering() throws {
        let scene = try DrawingScene(json: Data(fixture.utf8))
        let context = try XCTUnwrap(CGContext(data: nil, width: 32, height: 32, bitsPerComponent: 8, bytesPerRow: 128, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        XCTAssertThrowsError(try DrawingRenderer().render(scene: scene, frameID: "missing", in: context))
    }
    func testExperimentalStrokeSceneRejectsUnsupportedElements() throws {
        let scene = try DrawingScene(json: Data(fixture.utf8))
        let context = try XCTUnwrap(CGContext(data: nil, width: 32, height: 32, bitsPerComponent: 8, bytesPerRow: 128, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        XCTAssertThrowsError(try ExperimentalStrokeSceneRenderer.render(scene: scene, frameID: "f", in: context))
    }

    func testTextNodeRenderingAndBlendModes() throws {
        let textFixture = #"""
        {"schema":1,"defaultFrameId":"f","frames":{"f":{"id":"f","x":0,"y":0,"w":100,"h":100,"background":"#ffffff","clip":true,"name":"Frame","status":"draft","exportScale":1}},"frameOrder":["f"],
        "layers":{"l":{"id":"l","name":"Layer","visible":true,"opacity":0.9,"blend":"multiply","parentId":null}},"layerOrder":["l"],
        "nodes":{"t":{"id":"t","kind":"text","text":"Hello Worlds","layerId":"l","frameId":"f","x":10,"y":10,"w":80,"h":30,"rotation":0,"opacity":1,"visible":true,"effects":[],"textStyle":{"font":"sans-serif","size":14,"weight":600,"color":"#000000","background":"transparent","border":"transparent","align":"left","direction":"ltr"}}},"nodeOrder":["t"],
        "assets":{},"masks":{},"steps":{},"stepOrder":[]}
        """#
        let scene = try DrawingScene(json: Data(textFixture.utf8))
        let context = try XCTUnwrap(CGContext(data: nil, width: 100, height: 100, bitsPerComponent: 8, bytesPerRow: 400, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        let report = try DrawingRenderer().render(scene: scene, frameID: "f", in: context)
        XCTAssertEqual(report.renderedNodeCount, 1)
    }

    func testWorldsDrawPackageExport() throws {
        let scene = try DrawingScene(json: Data(fixture.utf8))
        let assetData = Data("sample-binary-asset".utf8)
        let packageData = try DrawingPackageExporter.exportPackage(scene: scene, assets: ["sample.png": assetData])
        XCTAssertFalse(packageData.isEmpty)
        XCTAssertEqual(packageData.prefix(4), Data([0x50, 0x4B, 0x03, 0x04]))
    }
}

