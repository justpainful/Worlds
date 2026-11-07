import CoreGraphics
import ImageIO
import Foundation
import XCTest
@testable import WorldsDrawing

final class WorldsDrawingVisualComparisonTests: XCTestCase {
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
            try StrokeRasterCandidate.draw(samples: samples(), brush: brush, seed: 123, color: CGColor(red: 32/255, green: 32/255, blue: 35/255, alpha: 1), in: context)
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
                let color = index == 0 ? CGColor(red: 238/255, green: 68/255, blue: 34/255, alpha: 1) : CGColor(red: 0, green: 102/255, blue: 204/255, alpha: 1)
                context.saveGState(); context.setAlpha(index == 0 ? 0.6 : 0.5); context.beginTransparencyLayer(auxiliaryInfo: nil)
                try StrokeRasterCandidate.draw(samples: points, brush: brush, seed: 123, color: color, in: context)
                context.endTransparencyLayer(); context.restoreGState()
            }
        }
    }
}
