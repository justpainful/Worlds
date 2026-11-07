import CoreGraphics
import XCTest
@testable import WorldsDrawing

final class StrokeRasterCandidateTests: XCTestCase {
    func testHighlighterSelfOverlapDoesNotDoubleOpacity() throws {
        var bytes = [UInt8](repeating: 0, count: 40 * 16 * 4)
        var brush = ToolBrush()
        brush.kind = "highlighter"; brush.size = 6; brush.opacity = 0.5; brush.flow = 1; brush.pressureSize = false
        let points = [ToolSample(x: 5, y: 8, pressure: 1, time: 0), ToolSample(x: 30, y: 8, pressure: 1, time: 1), ToolSample(x: 5, y: 8, pressure: 1, time: 2)]
        try bytes.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(CGContext(data: buffer.baseAddress, width: 40, height: 16, bitsPerComponent: 8, bytesPerRow: 160, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            try StrokeRasterCandidate.draw(samples: points, brush: brush, seed: 1, color: CGColor(red: 1, green: 0, blue: 0, alpha: 1), in: context)
        }
        let alpha = bytes[(8 * 40 + 16) * 4 + 3]
        XCTAssertGreaterThan(alpha, 100)
        XCTAssertLessThan(alpha, 155)
    }
    func testUnsupportedHighlighterPressureFailsClosed() {
        var brush = ToolBrush(); brush.kind = "highlighter"; brush.pressureSize = true
        var bytes = [UInt8](repeating: 0, count: 16 * 16 * 4)
        bytes.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(data: buffer.baseAddress, width: 16, height: 16, bitsPerComponent: 8, bytesPerRow: 64, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return XCTFail("Missing context") }
            XCTAssertThrowsError(try StrokeRasterCandidate.draw(samples: [ToolSample(x: 1, y: 1, pressure: 0.5, time: 0)], brush: brush, seed: 1, color: CGColor(red: 0, green: 0, blue: 0, alpha: 1), in: context))
        }
    }
}
