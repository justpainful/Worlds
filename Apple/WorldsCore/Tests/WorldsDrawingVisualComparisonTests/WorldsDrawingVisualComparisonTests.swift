import CoreGraphics
import ImageIO
import Foundation
import XCTest
@testable import WorldsDrawing

final class WorldsDrawingVisualComparisonTests: XCTestCase {
    func testPersistedStrokeOperationAgainstSourceCanvas() throws {
        for kind in ["hard", "ink", "pencil"] {
            var brush = ToolBrush(); brush.kind = kind; brush.size = 10; brush.opacity = 0.6; brush.flow = 0.7; brush.spacing = 0.25
            brush.pressureSize = true; brush.pressureOpacity = true
            let operation = try StrokeOperationBuilder.make(samples: samples(), brush: brush, tool: .brush,
                nodeID: "node", operationID: "operation", actor: "artist", revision: 0,
                timestamp: 1, layerID: "layer", frameID: "frame", nodeOrder: [], seed: 123)
            let root = try XCTUnwrap(JSONSerialization.jsonObject(with: operation) as? [String: Any])
            let changes = try XCTUnwrap(root["changes"] as? [[String: Any]])
            let node = try XCTUnwrap(changes.first?["value"] as? [String: Any])
            let sceneJSON: [String: Any] = ["schema": 1, "defaultFrameId": "frame", "frames": ["frame": ["x": 0, "y": 0, "w": 64, "h": 64, "background": "transparent", "clip": true]], "frameOrder": ["frame"], "layers": ["layer": ["visible": true, "opacity": 1, "blend": "source-over", "parentId": NSNull()]], "layerOrder": ["layer"], "nodes": ["node": node], "nodeOrder": ["node"], "assets": [:], "masks": [:], "steps": [:], "stepOrder": []]
            let scene = try DrawingScene(json: JSONSerialization.data(withJSONObject: sceneJSON))
            let actual = try bitmap(256) { context in
                context.translateBy(x: 0, y: 256); context.scaleBy(x: 4, y: -4)
                try ExperimentalStrokeSceneRenderer.render(scene: scene, frameID: "frame", in: context)
            }
            let reference = try XCTUnwrap(Bundle.module.url(forResource: "\(kind)-4x", withExtension: "png", subdirectory: "CanvasReferences"))
            let expected = try readPNG(reference, dimension: 256)
            let painted = stride(from: 0, to: actual.count, by: 4).filter { max(actual[$0 + 3], expected[$0 + 3]) > 4 }
            XCTAssertFalse(painted.isEmpty)
            let difference = painted.reduce(0.0) { sum, i in
                sum + (0..<4).reduce(0.0) { $0 + abs(Double(actual[i+$1]) - Double(expected[i+$1])) }
            }
            let mean = difference / Double(max(1, painted.count) * 4 * 255)
            let report = XCTAttachment(string: "Persisted \(kind) painted-union RGBA MAE: \(mean)")
            report.name = "persisted-\(kind)-comparison"; report.lifetime = .keepAlways; add(report)
            XCTAssertLessThan(mean, 0.02, "Persisted \(kind) stroke differs from source Canvas")
        }
    }
    func testSourceCanvasAndNativeStrokePixels() throws {
        let names = ["hard", "ink", "pencil", "highlighter", "layers", "hard-4x", "ink-4x", "pencil-4x", "highlighter-4x", "layers-4x", "hard-taper-4x", "highlighter-light-4x", "ink-handwriting-4x", "highlighter-preset-4x"]
        for name in names {
            let dimension = name.hasSuffix("-4x") ? 256 : 64
            let reference = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "png", subdirectory: "CanvasReferences"))
            let expected = try readPNG(reference, dimension: dimension)
            let actual = try render(name, dimension: dimension)
            XCTAssertEqual(actual.count, expected.count)
            let pixels = dimension * dimension
            let painted = stride(from: 0, to: actual.count, by: 4).filter { max(actual[$0 + 3], expected[$0 + 3]) > 4 }
            XCTAssertFalse(painted.isEmpty, "Missing painted pixels for \(name)")
            let totalDifference = zip(actual, expected).reduce(0.0) { $0 + abs(Double($1.0) - Double($1.1)) }
            let paintedDifference = painted.reduce(0.0) { sum, i in
                sum + (0..<4).reduce(0.0) { $0 + abs(Double(actual[i+$1]) - Double(expected[i+$1])) }
            }
            let fullMean = totalDifference / Double(actual.count * 255)
            let inkMean = paintedDifference / Double(max(1, painted.count) * 4 * 255)
            let maxDifference = zip(actual, expected).map { abs(Int($0.0) - Int($0.1)) }.max() ?? 0
            let changed = painted.filter { i in (0..<4).contains { abs(Int(actual[i+$0]) - Int(expected[i+$0])) > 2 } }.count
            let report = XCTAttachment(string: "\(name) \(dimension)x\(dimension): full RGBA MAE \(fullMean); painted-union RGBA MAE \(inkMean); max channel \(maxDifference); changed painted pixels (>2) \(changed)/\(painted.count); painted pixels \(painted.count)/\(pixels)")
            report.name = "\(name)-error"; report.lifetime = .keepAlways; add(report)
            let source = XCTAttachment(data: try Data(contentsOf: reference), uniformTypeIdentifier: "public.png")
            source.name = "\(name)-source-canvas"; source.lifetime = .keepAlways; add(source)
            let native = XCTAttachment(data: try png(actual, dimension: dimension), uniformTypeIdentifier: "public.png")
            native.name = "\(name)-native"; native.lifetime = .keepAlways; add(native)
            XCTAssertLessThan(inkMean, 0.02, "\(name) painted pixels differ from Canvas")
        }
    }
    func testCorrectedRightTriangleAgainstSourceCanvas() throws {
        var brush = ToolBrush(); brush.size = 3
        let stroke = try StrokeOperationBuilder.make(samples: samples(), brush: brush, tool: .brush,
            nodeID: "node", operationID: "stroke", actor: "artist", revision: 0,
            timestamp: 1, layerID: "layer", frameID: "frame", nodeOrder: [], seed: 123)
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: stroke) as? [String: Any])
        var node = try XCTUnwrap(((root["changes"] as? [[String: Any]])?.first)?["value"] as? [String: Any])
        node["kind"] = "shape"; node["shape"] = "right-triangle"
        node["x"] = 0; node["y"] = 0; node["w"] = 64; node["h"] = 64
        node["points"] = [["x": 8, "y": 8], ["x": 8, "y": 52], ["x": 52, "y": 52]]
        var paint = try XCTUnwrap(node["paint"] as? [String: Any]); paint["strokeWidth"] = 3; node["paint"] = paint
        let sceneJSON: [String: Any] = ["schema": 1, "defaultFrameId": "frame", "frames": ["frame": ["x": 0, "y": 0, "w": 64, "h": 64, "background": "transparent", "clip": true]], "frameOrder": ["frame"], "layers": ["layer": ["visible": true, "opacity": 1, "blend": "source-over", "parentId": NSNull()]], "layerOrder": ["layer"], "nodes": ["node": node], "nodeOrder": ["node"], "assets": [:], "masks": [:], "steps": [:], "stepOrder": []]
        let scene = try DrawingScene(json: JSONSerialization.data(withJSONObject: sceneJSON))
        XCTAssertThrowsError(try bitmap(256) { try ExperimentalStrokeSceneRenderer.render(scene: scene, frameID: "frame", in: $0) })
        let actual = try bitmap(256) { context in
            context.translateBy(x: 0, y: 256); context.scaleBy(x: 4, y: -4)
            try ExperimentalStrokeSceneRenderer.render(scene: scene, frameID: "frame", in: context, allowCorrectedRightTriangles: true)
        }
        let reference = try XCTUnwrap(Bundle.module.url(forResource: "right-triangle-4x", withExtension: "png", subdirectory: "CanvasReferences"))
        let expected = try readPNG(reference, dimension: 256)
        let painted = stride(from: 0, to: actual.count, by: 4).filter { max(actual[$0 + 3], expected[$0 + 3]) > 4 }
        XCTAssertFalse(painted.isEmpty)
        let difference = painted.reduce(0.0) { sum, i in sum + (0..<4).reduce(0.0) { $0 + abs(Double(actual[i+$1]) - Double(expected[i+$1])) } }
        let mean = difference / Double(max(1, painted.count) * 4 * 255)
        let source = XCTAttachment(data: try Data(contentsOf: reference), uniformTypeIdentifier: "public.png"); source.name = "right-triangle-source"; source.lifetime = .keepAlways; add(source)
        let native = XCTAttachment(data: try png(actual, dimension: 256), uniformTypeIdentifier: "public.png"); native.name = "right-triangle-native"; native.lifetime = .keepAlways; add(native)
        XCTAssertLessThan(mean, 0.02, "Right triangle painted-union RGBA MAE: \(mean)")
    }
    func testRotatedTriangleAndStrokeAgainstSourceCanvas() throws {
        var brush = ToolBrush(); brush.size = 10; brush.opacity = 0.6; brush.flow = 0.7; brush.spacing = 0.25; brush.pressureSize = true; brush.pressureOpacity = true
        let operation = try StrokeOperationBuilder.make(samples: samples(), brush: brush, tool: .brush,
            nodeID: "stroke", operationID: "operation", actor: "artist", revision: 0, timestamp: 1,
            layerID: "layer", frameID: "frame", nodeOrder: [], seed: 123)
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: operation) as? [String: Any])
        var stroke = try XCTUnwrap(((root["changes"] as? [[String: Any]])?.first)?["value"] as? [String: Any])
        stroke["x"] = 0; stroke["y"] = 0; stroke["w"] = 64; stroke["h"] = 64
        stroke["samples"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(samples()))
        var shape = stroke; shape["id"] = "shape"; shape["kind"] = "shape"; shape["shape"] = "right-triangle"
        shape["x"] = 10; shape["y"] = 7; shape["w"] = 44; shape["h"] = 40; shape["rotation"] = 18
        shape["points"] = [["x": 4, "y": 4], ["x": 4, "y": 35], ["x": 39, "y": 35]]
        var paint = try XCTUnwrap(shape["paint"] as? [String: Any]); paint["strokeWidth"] = 3; shape["paint"] = paint
        let sceneJSON: [String: Any] = ["schema": 1, "defaultFrameId": "frame", "frames": ["frame": ["x": 0, "y": 0, "w": 64, "h": 64, "background": "transparent", "clip": true]], "frameOrder": ["frame"], "layers": ["layer": ["visible": true, "opacity": 1, "blend": "source-over", "parentId": NSNull()]], "layerOrder": ["layer"], "nodes": ["shape": shape, "stroke": stroke], "nodeOrder": ["shape", "stroke"], "assets": [:], "masks": [:], "steps": [:], "stepOrder": []]
        let scene = try DrawingScene(json: JSONSerialization.data(withJSONObject: sceneJSON))
        let actual = try bitmap(256) { context in
            context.translateBy(x: 0, y: 256); context.scaleBy(x: 4, y: -4)
            try ExperimentalStrokeSceneRenderer.render(scene: scene, frameID: "frame", in: context, allowCorrectedRightTriangles: true)
        }
        let reference = try XCTUnwrap(Bundle.module.url(forResource: "right-triangle-mixed-4x", withExtension: "png", subdirectory: "CanvasReferences"))
        let expected = try readPNG(reference, dimension: 256)
        let painted = stride(from: 0, to: actual.count, by: 4).filter { max(actual[$0 + 3], expected[$0 + 3]) > 4 }
        XCTAssertFalse(painted.isEmpty)
        let difference = painted.reduce(0.0) { sum, i in sum + (0..<4).reduce(0.0) { $0 + abs(Double(actual[i+$1]) - Double(expected[i+$1])) } }
        let mean = difference / Double(max(1, painted.count) * 4 * 255)
        let source = XCTAttachment(data: try Data(contentsOf: reference), uniformTypeIdentifier: "public.png"); source.name = "triangle-stroke-source"; source.lifetime = .keepAlways; add(source)
        let native = XCTAttachment(data: try png(actual, dimension: 256), uniformTypeIdentifier: "public.png"); native.name = "triangle-stroke-native"; native.lifetime = .keepAlways; add(native)
        XCTAssertLessThan(mean, 0.02, "Mixed painted-union RGBA MAE: \(mean)")
    }
    func testPressureSensitiveHighlighterRemainsUnsupported() throws {
        let reference = try XCTUnwrap(Bundle.module.url(forResource: "highlighter-pressure-4x", withExtension: "png", subdirectory: "CanvasReferences"))
        let source = XCTAttachment(data: try Data(contentsOf: reference), uniformTypeIdentifier: "public.png")
        source.name = "highlighter-pressure-source-only"; source.lifetime = .keepAlways; add(source)
        var brush = ToolBrush(); brush.kind = "highlighter"; brush.pressureSize = true; brush.taperStart = 0.2
        XCTAssertThrowsError(try bitmap(64) { context in
            try StrokeRasterCandidate.draw(samples: samples(), brush: brush, seed: 123, color: CGColor(gray: 0, alpha: 1), in: context)
        })
    }
    private func bitmap(_ size: Int, _ operation: (CGContext) throws -> Void) throws -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: size * size * 4)
        try bytes.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(CGContext(data: buffer.baseAddress, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue))
            try operation(context)
        }
        return bytes
    }
    private func readPNG(_ url: URL, dimension: Int) throws -> [UInt8] {
        let source = try XCTUnwrap(CGImageSourceCreateWithURL(url as CFURL, nil))
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        guard image.width == dimension && image.height == dimension else { throw NSError(domain: "DrawingComparison", code: 2) }
        return try bitmap(dimension) { $0.draw(image, in: CGRect(x: 0, y: 0, width: dimension, height: dimension)) }
    }
    private func png(_ bytes: [UInt8], dimension: Int) throws -> Data {
        let provider = try XCTUnwrap(CGDataProvider(data: Data(bytes) as CFData))
        let image = try XCTUnwrap(CGImage(width: dimension, height: dimension, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: dimension * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
        let data = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "DrawingComparison", code: 1) }
        return data as Data
    }
    private func srgb(_ red: Double, _ green: Double, _ blue: Double) throws -> CGColor {
        let space = try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB))
        return try XCTUnwrap(CGColor(colorSpace: space, components: [red / 255, green / 255, blue / 255, 1]))
    }
    private func samples() -> [ToolSample] {
        [ToolSample(x: 8, y: 20, pressure: 0.25, time: 0), ToolSample(x: 30, y: 28, pressure: 0.8, time: 1), ToolSample(x: 55, y: 20, pressure: 1, time: 2)]
    }
    private func render(_ name: String, dimension: Int) throws -> [UInt8] {
        if name.hasPrefix("layers") { return try renderLayers(dimension) }
        let kind = name.components(separatedBy: "-")[0]
        var brush = ToolBrush(); brush.kind = kind; brush.size = 10; brush.opacity = 0.6; brush.flow = 0.7; brush.spacing = 0.25
        brush.pressureSize = kind != "highlighter"; brush.pressureOpacity = kind != "highlighter"
        if name == "hard-taper-4x" { brush.taperStart = 0.4; brush.taperEnd = 0.3; brush.pressureFlow = true }
        if name == "highlighter-light-4x" { brush.opacity = 0.25; brush.flow = 0.35 }
        if name == "ink-handwriting-4x" { brush.size = 7; brush.opacity = 1; brush.flow = 1; brush.spacing = 0.07; brush.taperStart = 0.08; brush.taperEnd = 0.16; brush.pressureOpacity = false; brush.pressureCurve = 0.65 }
        if name == "highlighter-preset-4x" { brush.size = 28; brush.opacity = 0.35; brush.flow = 1; brush.spacing = 0.12 }
        return try bitmap(dimension) { context in
            let scale = CGFloat(dimension) / 64
            context.translateBy(x: 0, y: CGFloat(dimension)); context.scaleBy(x: scale, y: -scale)
            try StrokeRasterCandidate.draw(samples: samples(), brush: brush, seed: 123, color: try srgb(32, 32, 35), in: context)
        }
    }
    private func renderLayers(_ dimension: Int) throws -> [UInt8] {
        try bitmap(dimension) { context in
            let scale = CGFloat(dimension) / 64
            context.translateBy(x: 0, y: CGFloat(dimension)); context.scaleBy(x: scale, y: -scale)
            for index in 0...1 {
                var brush = ToolBrush(); brush.kind = "hard"; brush.size = 10; brush.opacity = 0.6; brush.flow = 0.7; brush.spacing = 0.25
                brush.pressureSize = true; brush.pressureOpacity = true
                let points = [ToolSample(x: 8, y: index == 0 ? 20 : 26, pressure: 0.25, time: 0), ToolSample(x: 30, y: index == 0 ? 28 : 20, pressure: 0.8, time: 1), ToolSample(x: 55, y: index == 0 ? 20 : 26, pressure: 1, time: 2)]
                let color = try (index == 0 ? srgb(238, 68, 34) : srgb(0, 102, 204))
                context.saveGState(); context.setAlpha(index == 0 ? 0.6 : 0.5); context.beginTransparencyLayer(auxiliaryInfo: nil)
                try StrokeRasterCandidate.draw(samples: points, brush: brush, seed: 123, color: color, in: context)
                context.endTransparencyLayer(); context.restoreGState()
            }
        }
    }
}
