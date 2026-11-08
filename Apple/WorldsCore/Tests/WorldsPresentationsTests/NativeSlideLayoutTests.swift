import CoreGraphics
import Foundation
import SwiftUI
import XCTest
@testable import WorldsPresentations

final class NativeSlideLayoutTests: XCTestCase {
    @MainActor func testLineUsesFourPointCenteredStroke() throws {
        let json = #"{"id":"slide","content":{"type":"slide","attrs":{"background":{"color":"#000000"},"elements":[{"id":"line","type":"shape","shape":"line","x":500,"y":310,"w":200,"h":100,"stroke":"#ff0000"}]}}}"#
        let slide = try SlideBlock(json: Data(json.utf8))
        let renderer = ImageRenderer(content: NativeSlideView(slide: slide).frame(width: 1280, height: 720))
        renderer.scale = 1
        let image = try XCTUnwrap(renderer.cgImage)
        let width = image.width, height = image.height
        XCTAssertEqual(width, 1280); XCTAssertEqual(height, 720)
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        try pixels.withUnsafeMutableBytes { bytes in
            let context = try XCTUnwrap(CGContext(data: bytes.baseAddress, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        let redRows = (350...370).filter { y in
            let index = (y * width + 600) * 4
            return pixels[index] > 200 && pixels[index + 1] < 40 && pixels[index + 2] < 40
        }
        XCTAssertEqual(redRows, [358, 359, 360, 361])
    }
    @MainActor func testSlideCoordinatesAndPhysicalAlignmentDoNotMirrorInRTL() throws {
        let json = #"{"id":"slide","content":{"type":"slide","attrs":{"background":{"color":"#16161a"},"elements":[{"id":"left","type":"text","x":80,"y":60,"w":400,"h":100,"text":"مرحبا Worlds","style":{"align":"left","color":"#ffffff","fontSize":40}},{"id":"right","type":"text","x":700,"y":250,"w":400,"h":100,"text":"عربي 123","style":{"align":"right","color":"#e5484d","fontSize":40}},{"id":"shape","type":"shape","shape":"rect","x":120,"y":440,"w":180,"h":100,"fill":"#0090ff"}]}}}"#
        let slide = try SlideBlock(json: Data(json.utf8))
        func pixels(_ direction: LayoutDirection) throws -> Data {
            let content = NativeSlideView(slide: slide).frame(width: 320, height: 180).environment(\.layoutDirection, direction)
            let renderer = ImageRenderer(content: content)
            renderer.scale = 1
            let image = try XCTUnwrap(renderer.cgImage)
            XCTAssertEqual(image.width, 320); XCTAssertEqual(image.height, 180)
            return try XCTUnwrap(image.dataProvider?.data) as Data
        }
        let leftToRight = try pixels(.leftToRight)
        let rightToLeft = try pixels(.rightToLeft)
        XCTAssertEqual(leftToRight, rightToLeft)
        XCTAssertGreaterThan(Set(leftToRight).count, 4, "The fixture must render more than a flat background")
    }
}
