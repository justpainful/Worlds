import CoreGraphics
import ImageIO
import Foundation
import XCTest
@testable import WorldsDrawing

/// This intentionally remains outside Package.swift until the Apple runner is
/// configured to retain and review both images and the measured error.
final class WorldsDrawingVisualComparisonTests: XCTestCase {
    func testSourceCanvasAndNativeStrokePixels() throws {
        for kind in ["hard", "ink", "pencil", "highlighter", "layers"] {
            let reference = try XCTUnwrap(Bundle.module.url(forResource: kind, withExtension: "png", subdirectory: "CanvasReferences"))
            let expected = try readPNG(reference)
            let actual = try render(kind)
            XCTAssertEqual(actual.count, expected.count)
            let mean = zip(actual, expected).reduce(0.0) { $0 + abs(Double($1.0) - Double($1.1)) } / Double(expected.count * 255)
            let maxDifference = zip(actual, expected).map { abs(Int($0.0) - Int($0.1)) }.max() ?? 0
            let changedPixels = stride(from: 0, to: actual.count, by: 4).filter { index in
                (0..<4).contains { abs(Int(actual[index + $0]) - Int(expected[index + $0])) > 2 }
            }.count
            let difference = XCTAttachment(string: "\(kind) normalized RGBA MAE: \(mean), maximum channel error: \(maxDifference), changed pixels (>2): \(changedPixels) of 4096")
            let referenceAttachment = XCTAttachment(data: try Data(contentsOf: reference), uniformTypeIdentifier: "public.png")
            referenceAttachment.name = "\(kind)-source-canvas"; referenceAttachment.lifetime = .keepAlways; add(referenceAttachment)
            let nativeAttachment = XCTAttachment(data: try png(actual), uniformTypeIdentifier: "public.png")
            nativeAttachment.name = "\(kind)-native"; nativeAttachment.lifetime = .keepAlways; add(nativeAttachment)
            difference.name = "\(kind)-error"; difference.lifetime = .keepAlways; add(difference)
            XCTAssertLessThan(mean, 0.02, "\(kind) differs from the original Canvas reference")
        }
    }
    private func bitmap(_ operation: (CGContext) throws -> Void) throws -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: 64 * 64 * 4)
        try bytes.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(CGContext(data: buffer.baseAddress, width: 64, height: 64, bitsPerComponent: 8, bytesPerRow: 256, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue))
            try operation(context)
        }
        return bytes
    }
    private func readPNG(_ url: URL) throws -> [UInt8] {
        let source = try XCTUnwrap(CGImageSourceCreateWithURL(url as CFURL, nil))
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        return try bitmap { $0.draw(image, in: CGRect(x: 0, y: 0, width: 64, height: 64)) }
    }
    private func png(_ bytes: [UInt8]) throws -> Data {
        let provider = try XCTUnwrap(CGDataProvider(data: Data(bytes) as CFData))
        let image = try XCTUnwrap(CGImage(width: 64, height: 64, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: 256, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
        let data = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "DrawingComparison", code: 1) }
        return data as Data
    }
    private func render(_ kind: String) throws -> [UInt8] {
        if kind == "layers" { return try renderLayers() }
        var brush = ToolBrush(); brush.kind = kind; brush.size = 10; brush.opacity = 0.6; brush.flow = 0.7; brush.spacing = 0.25
        brush.pressureSize = kind != "highlighter"; brush.pressureOpacity = kind != "highlighter"
        let samples = [ToolSample(x: 8, y: 20, pressure: 0.25, time: 0), ToolSample(x: 30, y: 28, pressure: 0.8, time: 1), ToolSample(x: 55, y: 20, pressure: 1, time: 2)]
        return try bitmap { context in
            context.translateBy(x: 0, y: 64); context.scaleBy(x: 1, y: -1)
            try StrokeRasterCandidate.draw(samples: samples, brush: brush, seed: 123, color: CGColor(red: 32/255, green: 32/255, blue: 35/255, alpha: 1), in: context)
        }
    }
    private func renderLayers() throws -> [UInt8] {
        try bitmap { context in
            context.translateBy(x: 0, y: 64); context.scaleBy(x: 1, y: -1)
            for index in 0...1 {
                var brush = ToolBrush(); brush.kind = "hard"; brush.size = 10; brush.opacity = 0.6; brush.flow = 0.7; brush.spacing = 0.25
                brush.pressureSize = true; brush.pressureOpacity = true
                let samples = [ToolSample(x: 8, y: index == 0 ? 20 : 26, pressure: 0.25, time: 0), ToolSample(x: 30, y: index == 0 ? 28 : 20, pressure: 0.8, time: 1), ToolSample(x: 55, y: index == 0 ? 20 : 26, pressure: 1, time: 2)]
                let color = index == 0 ? CGColor(red: 238/255, green: 68/255, blue: 34/255, alpha: 1) : CGColor(red: 0, green: 102/255, blue: 204/255, alpha: 1)
                context.saveGState(); context.setAlpha(index == 0 ? 0.6 : 0.5); context.beginTransparencyLayer(auxiliaryInfo: nil)
                try StrokeRasterCandidate.draw(samples: samples, brush: brush, seed: 123, color: color, in: context)
                context.endTransparencyLayer(); context.restoreGState()
            }
        }
    }

}
