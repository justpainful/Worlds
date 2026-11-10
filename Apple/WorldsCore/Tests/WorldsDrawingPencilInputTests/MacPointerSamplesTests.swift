import Foundation
import XCTest
import WorldsDrawing
@testable import WorldsDrawingPencilInput

final class MacPointerSamplesTests: XCTestCase {
    func testTabletPressureAndReleaseAreRetained() throws {
        var buffer = PencilStrokeBuffer()
        try buffer.append(MacPointerSamples.make(x: 20, y: 30, pressure: 0.37, timestamp: 100,
            isTablet: true, isRelease: false))
        try buffer.append(MacPointerSamples.make(x: 25, y: 35, pressure: 0, timestamp: 101,
            isTablet: true, isRelease: true))
        let samples = try buffer.finalized(brush: ToolBrush())
        XCTAssertEqual(samples[0].pressure, 0.37, accuracy: 0.000001)
        XCTAssertEqual(samples[1].pressure, 0.37, accuracy: 0.000001)
        XCTAssertEqual(samples[0].tiltX, 0); XCTAssertEqual(samples[0].tiltY, 0)
        XCTAssertThrowsError(try MacPointerSamples.make(x: 0, y: 0, pressure: 1.2, timestamp: 1, isTablet: true, isRelease: false))
    }
    func testMouseUsesFullPressure() throws {
        let raw = try MacPointerSamples.make(x: 1, y: 2, pressure: 0, timestamp: 3, isTablet: false, isRelease: false)
        XCTAssertEqual(try PencilSampleConversion.convert(raw).pressure, 1)
    }
}

#if canImport(AppKit) && !canImport(UIKit)
import AppKit
final class MacCaptureCancellationTests: XCTestCase {
    @MainActor func testCancelReturnsInputWithoutStrokeCommit() throws {
        let view = CaptureView(frame: NSRect(x: 0, y: 0, width: 100, height: 100))
        var cancelled = 0, committed = 0, captured = 0
        view.onCancelled = { input in cancelled += 1; captured = input.rawSamples.count }
        view.onStroke = { _ in committed += 1 }
        let event = try XCTUnwrap(NSEvent.mouseEvent(with: .leftMouseDown, location: NSPoint(x: 20, y: 20),
            modifierFlags: [], timestamp: 1, windowNumber: 0, context: nil,
            eventNumber: 1, clickCount: 1, pressure: 0))
        view.mouseDown(with: event)
        view.cancelOperation(nil); view.cancelOperation(nil)
        XCTAssertEqual(cancelled, 1); XCTAssertEqual(committed, 0); XCTAssertEqual(captured, 1)
        if #available(macOS 26.0, *) {
            view.mouseDown(with: event)
            view.mouseCancelled(with: event)
            XCTAssertEqual(cancelled, 2); XCTAssertEqual(committed, 0)
        }
    }
}
#endif
