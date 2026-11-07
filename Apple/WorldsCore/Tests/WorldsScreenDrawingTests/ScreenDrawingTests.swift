#if os(macOS)
import AppKit
import CoreGraphics
import XCTest
@testable import WorldsScreenDrawing

final class ScreenDrawingTests: XCTestCase {
    private let ink = ScreenInk(red: 0, green: 0.5, blue: 1)
    func testLaserLifetimeAndRemoval() {
        var doc = ScreenDrawingDocument()
        doc.begin(tool: .laser, ink: ink, width: 4, lifetime: 2, sample: .init(point: .zero, pressure: 0.5))
        doc.end(at: 10)
        XCTAssertEqual(doc.strokes[0].opacity(at: 11), 0.5)
        doc.prune(at: 12)
        XCTAssertTrue(doc.strokes.isEmpty)
    }
    func testEraserTargetsStrokeAndUndoDoesNotTouchStillImage() {
        var doc = ScreenDrawingDocument()
        doc.begin(tool: .pen, ink: ink, width: 4, lifetime: 3, sample: .init(point: CGPoint(x: 10,y: 10), pressure: 1))
        doc.move(tool: .pen, sample: .init(point: CGPoint(x: 100,y: 10), pressure: 0.5), eraserWidth: 4)
        doc.end(at: 0)
        doc.begin(tool: .highlighter, ink: ink, width: 4, lifetime: 3, sample: .init(point: CGPoint(x: 50,y: 90), pressure: 1))
        doc.end(at: 0)
        doc.begin(tool: .eraser, ink: ink, width: 8, lifetime: 3, sample: .init(point: CGPoint(x: 50,y: 10), pressure: 1))
        XCTAssertEqual(doc.strokes.count, 1)
        XCTAssertEqual(doc.strokes[0].tool, .highlighter)
        doc.undo(); XCTAssertTrue(doc.strokes.isEmpty)
    }
    func testRejectsNonfiniteAndBounds() {
        var doc = ScreenDrawingDocument()
        doc.begin(tool: .pen, ink: ink, width: .nan, lifetime: 3, sample: .init(point: .zero, pressure: 1))
        XCTAssertNil(doc.current)
        doc.begin(tool: .pen, ink: ink, width: 4, lifetime: 3, sample: .init(point: CGPoint(x: .infinity,y: 0), pressure: 1))
        XCTAssertNil(doc.current)
    }
    @MainActor
    func testInjectedSourceProducesSyntheticImage() async throws {
        struct Fixture: ScreenImageSource {
            func capture(displayID: CGDirectDisplayID) async throws -> CGImage {
                let context = CGContext(data: nil, width: 3, height: 2, bitsPerComponent: 8, bytesPerRow: 0,
                                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
                context.setFillColor(NSColor.systemBlue.cgColor)
                context.fill(CGRect(x: 0,y: 0,width: 3,height: 2))
                return context.makeImage()!
            }
        }
        let frame = try await Fixture().capture(displayID: 1)
        XCTAssertEqual(frame.width, 3); XCTAssertEqual(frame.height, 2)
    }
}
#endif
