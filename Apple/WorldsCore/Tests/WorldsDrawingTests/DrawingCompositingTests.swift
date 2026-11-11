import Foundation
import CoreGraphics
import XCTest
import WorldsModels
@testable import WorldsDrawing

/// Renders small scenes into a y-down 40 x 40 bitmap and checks pixels. With the
/// flip below, memory row `y` is drawing row `y`.
final class DrawingCompositingTests: XCTestCase {
    private struct Pixel { let r: Int, g: Int, b: Int, a: Int }
    private let size = 40

    private func scene(layers: String, layerOrder: [String], nodes: String, nodeOrder: [String], masks: String = "{}") throws -> DrawingScene {
        let json = """
        {"schema":1,"defaultFrameId":"f","frames":{"f":{"id":"f","x":0,"y":0,"w":\(size),"h":\(size),"background":"#ffffff","clip":true,"name":"Frame","status":"draft","exportScale":1}},"frameOrder":["f"],
        "layers":\(layers),"layerOrder":\(jsonList(layerOrder)),"nodes":\(nodes),"nodeOrder":\(jsonList(nodeOrder)),
        "assets":{},"masks":\(masks),"steps":{},"stepOrder":[]}
        """
        return try DrawingScene(json: Data(json.utf8))
    }
    private func jsonList(_ values: [String]) -> String { "[" + values.map { "\"\($0)\"" }.joined(separator: ",") + "]" }
    private func layer(_ id: String, parent: String? = nil, opacity: Double = 1, visible: Bool = true) -> String {
        "\"\(id)\":{\"id\":\"\(id)\",\"name\":\"\(id)\",\"visible\":\(visible),\"locked\":false,\"opacity\":\(opacity),\"blend\":\"source-over\",\"parentId\":\(parent.map { "\"\($0)\"" } ?? "null")}"
    }
    private func rect(_ id: String, layer: String, x: Int = 0, y: Int = 0, w: Int = 40, h: Int = 40, fill: String, shape: String = "rect", extra: String = "") -> String {
        "\"\(id)\":{\"id\":\"\(id)\",\"kind\":\"shape\",\"shape\":\"\(shape)\",\"layerId\":\"\(layer)\",\"frameId\":\"f\",\"x\":\(x),\"y\":\(y),\"w\":\(w),\"h\":\(h),\"rotation\":0,\"opacity\":1,\"visible\":true,\"effects\":[],\"paint\":{\"fill\":\"\(fill)\",\"stroke\":\"transparent\",\"strokeWidth\":0,\"dash\":[],\"cap\":\"round\",\"radius\":0}\(extra)}"
    }
    private func stroke(_ id: String, layer: String, kind: String = "hard", size: Int = 10, color: String = "#000000", erase: Bool = false, from: (Int, Int) = (0, 20), to: (Int, Int) = (40, 20)) -> String {
        "\"\(id)\":{\"id\":\"\(id)\",\"kind\":\"stroke\",\"layerId\":\"\(layer)\",\"frameId\":\"f\",\"x\":0,\"y\":0,\"w\":40,\"h\":40,\"rotation\":0,\"opacity\":1,\"visible\":true,\"effects\":[],\"erase\":\(erase),\"seed\":7,"
            + "\"brush\":{\"kind\":\"\(kind)\",\"size\":\(size),\"opacity\":1,\"flow\":1,\"hardness\":1,\"spacing\":0.12,\"angle\":0,\"roundness\":1,\"smoothing\":0,\"stabilizer\":0,\"taperStart\":0,\"taperEnd\":0,\"pressureSize\":false,\"pressureOpacity\":false,\"pressureFlow\":false,\"pressureCurve\":1,\"color\":\"\(color)\"},"
            + "\"samples\":[{\"x\":\(from.0),\"y\":\(from.1),\"pressure\":1,\"tiltX\":0,\"tiltY\":0,\"time\":0},{\"x\":\(to.0),\"y\":\(to.1),\"pressure\":1,\"tiltX\":0,\"tiltY\":0,\"time\":16}]}"
    }
    private func render(_ scene: DrawingScene) throws -> (CGContext, DrawingRenderReport) {
        let context = try XCTUnwrap(CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
                                              space: try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB)), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.translateBy(x: 0, y: CGFloat(size))
        context.scaleBy(x: 1, y: -1)
        let report = try DrawingRenderer().render(scene: scene, frameID: "f", in: context)
        return (context, report)
    }
    private func pixel(_ context: CGContext, _ x: Int, _ y: Int) -> Pixel {
        let data = context.data!.bindMemory(to: UInt8.self, capacity: context.bytesPerRow * context.height)
        let at = y * context.bytesPerRow + x * 4
        return Pixel(r: Int(data[at]), g: Int(data[at + 1]), b: Int(data[at + 2]), a: Int(data[at + 3]))
    }
    private func assertColor(_ p: Pixel, r: Int, g: Int, b: Int, tolerance: Int = 24, _ message: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssert(abs(p.r - r) <= tolerance && abs(p.g - g) <= tolerance && abs(p.b - b) <= tolerance,
                  "\(message): got (\(p.r), \(p.g), \(p.b)), expected (\(r), \(g), \(b))", file: file, line: line)
    }
    private func failures(_ report: DrawingRenderReport, _ id: String) -> [String] {
        report.issues.filter { $0.elementID == id && ($0.reason.contains("unsupported(") || $0.reason.contains("malformed") || $0.reason.contains("not implemented")) }.map(\.reason)
    }

    // MARK: Eraser, alpha lock, masks, effects

    func testEraserClearsOnlyItsOwnLayer() throws {
        let scene = try scene(layers: "{\(layer("bottom")),\(layer("top"))}", layerOrder: ["bottom", "top"],
                              nodes: "{\(rect("blue", layer: "bottom", fill: "#0000ff")),\(rect("red", layer: "top", fill: "#ff0000")),\(stroke("eraser", layer: "top", erase: true))}",
                              nodeOrder: ["blue", "red", "eraser"])
        let (context, report) = try render(scene)
        XCTAssertEqual(report.renderedNodeCount, 3)
        XCTAssertTrue(failures(report, "eraser").isEmpty, "\(report.issues)")
        assertColor(pixel(context, 20, 20), r: 0, g: 0, b: 255, "The eraser reveals the layer below")
        assertColor(pixel(context, 20, 4), r: 255, g: 0, b: 0, "Pixels away from the eraser stay on the top layer")
        assertColor(pixel(context, 20, 36), r: 255, g: 0, b: 0, "Pixels away from the eraser stay on the top layer")
    }

    func testEraserOnEmptyLayerLeavesLowerLayerIntact() throws {
        let scene = try scene(layers: "{\(layer("bottom")),\(layer("top"))}", layerOrder: ["bottom", "top"],
                              nodes: "{\(rect("blue", layer: "bottom", fill: "#0000ff")),\(stroke("eraser", layer: "top", erase: true))}",
                              nodeOrder: ["blue", "eraser"])
        let (context, _) = try render(scene)
        assertColor(pixel(context, 20, 20), r: 0, g: 0, b: 255, "An eraser on another layer does not touch this layer")
    }

    func testAlphaLockPaintsOnlyOverExistingPixels() throws {
        let scene = try scene(layers: "{\(layer("l"))}", layerOrder: ["l"],
                              nodes: "{\(rect("base", layer: "l", w: 20, fill: "#ff0000")),\(rect("locked", layer: "l", fill: "#0000ff", extra: ",\"alphaLock\":true"))}",
                              nodeOrder: ["base", "locked"])
        let (context, report) = try render(scene)
        XCTAssertEqual(report.renderedNodeCount, 2)
        assertColor(pixel(context, 10, 20), r: 0, g: 0, b: 255, "Alpha lock paints over existing pixels")
        assertColor(pixel(context, 30, 20), r: 255, g: 255, b: 255, "Alpha lock leaves empty pixels empty")
    }

    func testMaskHidesMaskedArea() throws {
        let masks = "{\"m\":{\"id\":\"m\",\"name\":\"Mask\",\"enabled\":true,\"inverted\":false,\"linked\":true,\"x\":0,\"y\":0,\"w\":20,\"h\":40,\"strokes\":[]}}"
        let scene = try scene(layers: "{\(layer("l"))}", layerOrder: ["l"],
                              nodes: "{\(rect("r", layer: "l", fill: "#ff0000", extra: ",\"maskId\":\"m\""))}", nodeOrder: ["r"], masks: masks)
        let (context, report) = try render(scene)
        XCTAssertEqual(report.renderedNodeCount, 1)
        assertColor(pixel(context, 10, 20), r: 255, g: 0, b: 0, "Inside the mask the element is visible")
        assertColor(pixel(context, 30, 20), r: 255, g: 255, b: 255, "Outside the mask the element is hidden")
    }

    func testInvertedMaskAndHideStroke() throws {
        let brush = "{\"kind\":\"hard\",\"size\":10,\"opacity\":1,\"flow\":1,\"hardness\":1,\"spacing\":0.12,\"pressureSize\":false,\"color\":\"#000000\"}"
        let hide = "{\"reveal\":false,\"brush\":\(brush),\"samples\":[{\"x\":0,\"y\":5,\"pressure\":1},{\"x\":40,\"y\":5,\"pressure\":1}]}"
        let masks = "{\"m\":{\"id\":\"m\",\"name\":\"Mask\",\"enabled\":true,\"inverted\":true,\"linked\":false,\"x\":0,\"y\":0,\"w\":20,\"h\":40,\"strokes\":[\(hide)]},"
            + "\"off\":{\"id\":\"off\",\"name\":\"Off\",\"enabled\":false,\"inverted\":false,\"linked\":false,\"x\":0,\"y\":0,\"w\":1,\"h\":1,\"strokes\":[]}}"
        let scene = try scene(layers: "{\(layer("l"))}", layerOrder: ["l"],
                              nodes: "{\(rect("r", layer: "l", fill: "#ff0000", extra: ",\"maskId\":\"m\"")),\(rect("g", layer: "l", x: 0, y: 30, w: 40, h: 10, fill: "#00ff00", extra: ",\"maskId\":\"off\""))}",
                              nodeOrder: ["r", "g"], masks: masks)
        let (context, _) = try render(scene)
        assertColor(pixel(context, 10, 20), r: 255, g: 255, b: 255, "An inverted mask hides its own area")
        assertColor(pixel(context, 30, 20), r: 255, g: 0, b: 0, "An inverted mask shows the rest")
        assertColor(pixel(context, 10, 5), r: 255, g: 0, b: 0, "A hide stroke removed mask value, so the inverted mask shows the element")
        assertColor(pixel(context, 10, 35), r: 0, g: 255, b: 0, "A disabled mask is ignored")
    }

    func testUnsupportedEffectStillRendersNode() throws {
        let effects = ",\"effects\":[{\"id\":\"e\",\"kind\":\"pixelate\",\"amount\":4,\"enabled\":true},{\"id\":\"d\",\"kind\":\"invert\",\"amount\":1,\"enabled\":false}]"
        let node = rect("r", layer: "l", fill: "#ff0000").replacingOccurrences(of: ",\"effects\":[]", with: effects)
        let scene = try scene(layers: "{\(layer("l"))}", layerOrder: ["l"], nodes: "{\(node)}", nodeOrder: ["r"])
        let (context, report) = try render(scene)
        XCTAssertEqual(report.renderedNodeCount, 1)
        XCTAssertTrue(report.issues.contains { $0.elementID == "r" && $0.reason.contains("pixelate") }, "\(report.issues)")
        XCTAssertTrue(failures(report, "r").isEmpty, "\(report.issues)")
        assertColor(pixel(context, 20, 20), r: 255, g: 0, b: 0, "The element renders without the unsupported effect, and the disabled effect is ignored")
    }

    func testSupportedColourEffectsAndBlur() throws {
        let inverted = rect("i", layer: "l", w: 20, fill: "#ff0000").replacingOccurrences(of: ",\"effects\":[]", with: ",\"effects\":[{\"id\":\"a\",\"kind\":\"invert\",\"amount\":1,\"enabled\":true}]")
        let gray = rect("g", layer: "l", x: 20, w: 20, h: 20, fill: "#ff0000").replacingOccurrences(of: ",\"effects\":[]", with: ",\"effects\":[{\"id\":\"b\",\"kind\":\"grayscale\",\"amount\":1,\"enabled\":true}]")
        let blurred = rect("b", layer: "l", x: 24, y: 24, w: 12, h: 12, fill: "#0000ff").replacingOccurrences(of: ",\"effects\":[]", with: ",\"effects\":[{\"id\":\"c\",\"kind\":\"blur\",\"amount\":2,\"enabled\":true}]")
        let scene = try scene(layers: "{\(layer("l"))}", layerOrder: ["l"], nodes: "{\(inverted),\(gray),\(blurred)}", nodeOrder: ["i", "g", "b"])
        let (context, report) = try render(scene)
        XCTAssertEqual(report.renderedNodeCount, 3)
        assertColor(pixel(context, 10, 20), r: 0, g: 255, b: 255, "Invert turns red into cyan")
        let g = pixel(context, 30, 10)
        XCTAssert(abs(g.r - g.g) <= 4 && abs(g.g - g.b) <= 4 && g.r < 120, "Grayscale removes colour: \(g)")
        let centre = pixel(context, 30, 30), edge = pixel(context, 24, 30), outside = pixel(context, 21, 30)
        XCTAssert(centre.b > 200 && centre.r < 80, "Blur keeps the centre close to the colour: \(centre)")
        XCTAssert(edge.r > 60 && edge.r < 230, "Blur softens the edge: \(edge)")
        XCTAssert(outside.r < 255, "Blur spreads beyond the element: \(outside)")
    }

    // MARK: Brushes, shapes, nested layers, redaction

    func testEveryDesktopBrushKindRenders() throws {
        let kinds = ["pencil", "hard", "soft", "ink", "marker", "highlighter", "spray", "texture", "calligraphy", "oil", "crayon", "natural-pencil", "watercolor"]
        for kind in kinds {
            let scene = try scene(layers: "{\(layer("l"))}", layerOrder: ["l"], nodes: "{\(stroke("s", layer: "l", kind: kind, size: 12))}", nodeOrder: ["s"])
            let (context, report) = try render(scene)
            XCTAssertEqual(report.renderedNodeCount, 1, kind)
            XCTAssertTrue(failures(report, "s").isEmpty, "\(kind): \(report.issues)")
            var painted = 0
            for y in 12...28 { for x in 4...36 where pixel(context, x, y).r < 250 { painted += 1 } }
            XCTAssertGreaterThan(painted, 10, "\(kind) paints pigment along the stroke")
            XCTAssertEqual(pixel(context, 20, 2).r, 255, "\(kind) does not paint far from the stroke")
        }
    }

    func testEveryDesktopShapeTypeRenders() throws {
        let shapes = ["rect", "roundrect", "ellipse", "triangle", "right-triangle", "polygon", "star", "line", "polyline", "curve", "arrow", "double-arrow", "callout", "number", "highlight"]
        for shape in shapes {
            let node = "\"s\":{\"id\":\"s\",\"kind\":\"shape\",\"shape\":\"\(shape)\",\"layerId\":\"l\",\"frameId\":\"f\",\"x\":4,\"y\":4,\"w\":32,\"h\":32,\"rotation\":0,\"opacity\":1,\"visible\":true,\"effects\":[],\"paint\":{\"fill\":\"#ff0000\",\"stroke\":\"#0000ff\",\"strokeWidth\":2,\"dash\":[],\"cap\":\"round\",\"radius\":6}}"
            let scene = try scene(layers: "{\(layer("l"))}", layerOrder: ["l"], nodes: "{\(node)}", nodeOrder: ["s"])
            let (context, report) = try render(scene)
            XCTAssertEqual(report.renderedNodeCount, 1, shape)
            XCTAssertTrue(failures(report, "s").isEmpty, "\(shape): \(report.issues)")
            XCTAssertFalse(report.issues.contains { $0.reason.contains("Unknown shape") }, shape)
            var painted = 0
            for y in 0..<size { for x in 0..<size where pixel(context, x, y).r < 250 || pixel(context, x, y).g < 250 { painted += 1 } }
            XCTAssertGreaterThan(painted, 20, "\(shape) paints")
        }
    }

    func testShapeGeometryMatchesDesktopPaths() throws {
        func draw(_ shape: String) throws -> CGContext {
            let node = "\"s\":{\"id\":\"s\",\"kind\":\"shape\",\"shape\":\"\(shape)\",\"layerId\":\"l\",\"frameId\":\"f\",\"x\":0,\"y\":0,\"w\":40,\"h\":40,\"rotation\":0,\"opacity\":1,\"visible\":true,\"effects\":[],\"paint\":{\"fill\":\"#ff0000\",\"stroke\":\"transparent\",\"strokeWidth\":0,\"dash\":[]}}"
            let built = try self.scene(layers: "{\(self.layer("l"))}", layerOrder: ["l"], nodes: "{\(node)}", nodeOrder: ["s"])
            return try self.render(built).0
        }
        let triangle = try draw("triangle")
        assertColor(pixel(triangle, 20, 36), r: 255, g: 0, b: 0, "Triangle base is filled")
        assertColor(pixel(triangle, 2, 2), r: 255, g: 255, b: 255, "Triangle corner is empty")
        let right = try draw("right-triangle")
        assertColor(pixel(right, 4, 30), r: 255, g: 0, b: 0, "Right triangle fills the lower left")
        assertColor(pixel(right, 36, 4), r: 255, g: 255, b: 255, "Right triangle leaves the upper right")
        let ellipse = try draw("ellipse")
        assertColor(pixel(ellipse, 1, 1), r: 255, g: 255, b: 255, "Ellipse corner is empty")
        assertColor(pixel(ellipse, 20, 20), r: 255, g: 0, b: 0, "Ellipse centre is filled")
        let callout = try draw("callout")
        assertColor(pixel(callout, 15, 34), r: 255, g: 0, b: 0, "Callout tail is filled")
        assertColor(pixel(callout, 36, 36), r: 255, g: 255, b: 255, "Callout leaves the area beside its tail")
    }

    func testMissingShapePaintFieldsUseDesktopDefaults() throws {
        // DEFAULT_PAINT: stroke #202023, strokeWidth 3, round cap, radius 16.
        let node = "\"s\":{\"id\":\"s\",\"kind\":\"shape\",\"shape\":\"rect\",\"layerId\":\"l\",\"frameId\":\"f\",\"x\":5,\"y\":5,\"w\":30,\"h\":30,\"rotation\":0,\"opacity\":1,\"visible\":true,\"effects\":[],\"paint\":{\"fill\":\"#00ff00\"}}"
        let (context, report) = try render(try scene(layers: "{\(layer("l"))}", layerOrder: ["l"], nodes: "{\(node)}", nodeOrder: ["s"]))
        XCTAssertEqual(report.renderedNodeCount, 1)
        assertColor(pixel(context, 5, 20), r: 32, g: 32, b: 35, "Default stroke colour and width are applied")
        assertColor(pixel(context, 20, 20), r: 0, g: 255, b: 0, "Fill is kept")
    }

    func testNestedLayerGroupsComposite() throws {
        let layers = "{\(layer("group", opacity: 0.5)),\(layer("child", parent: "group")),\(layer("hidden", visible: false)),\(layer("inner", parent: "hidden"))}"
        let nodes = "{\(rect("g", layer: "group", w: 20, fill: "#0000ff")),\(rect("c", layer: "child", fill: "#ff0000")),\(rect("h", layer: "inner", y: 30, h: 10, fill: "#00ff00"))}"
        let (context, report) = try render(try scene(layers: layers, layerOrder: ["group", "child", "hidden", "inner"], nodes: nodes, nodeOrder: ["g", "c", "h"]))
        XCTAssertFalse(report.issues.contains { $0.reason.contains("Nested layer") }, "\(report.issues)")
        assertColor(pixel(context, 30, 10), r: 255, g: 128, b: 128, "Child layer is drawn through its group's opacity")
        assertColor(pixel(context, 10, 10), r: 255, g: 128, b: 128, "Child layer is drawn above the group's own elements")
        assertColor(pixel(context, 20, 35), r: 255, g: 128, b: 128, "A hidden group hides its child layers")
    }

    func testRedactionIsPaintedAboveLaterLayers() throws {
        let redaction = rect("x", layer: "bottom", x: 10, y: 10, w: 10, h: 10, fill: "#000000", extra: ",\"redaction\":true")
        let nodes = "{\(redaction),\(rect("top", layer: "top", fill: "#ff0000"))}"
        let (context, _) = try render(try scene(layers: "{\(layer("bottom")),\(layer("top"))}", layerOrder: ["bottom", "top"], nodes: nodes, nodeOrder: ["x", "top"]))
        assertColor(pixel(context, 15, 15), r: 0, g: 0, b: 0, tolerance: 0, "Redaction stays opaque black")
        assertColor(pixel(context, 30, 30), r: 255, g: 0, b: 0, "Other pixels are unchanged")
    }
}
