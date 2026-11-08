#if canImport(UIKit)
import XCTest
import UIKit
import UIKit.UIGestureRecognizerSubclass
@testable import WorldsDrawingPencilInput

final class DrawingCaptureRecognizerTests: XCTestCase {
    @MainActor func testOnlyAncestorPansArePreventedForCanvasTouches() throws {
        let root = UIView(), canvas = CaptureView(frame: .zero), unrelated = UIView()
        root.addSubview(canvas)
        let ancestorPan = UIPanGestureRecognizer(), otherPan = UIPanGestureRecognizer()
        let edgePan = UIScreenEdgePanGestureRecognizer()
        let tap = UITapGestureRecognizer()
        root.addGestureRecognizer(ancestorPan)
        root.addGestureRecognizer(edgePan)
        root.addGestureRecognizer(tap)
        unrelated.addGestureRecognizer(otherPan)
        let recognizer = try XCTUnwrap(canvas.gestureRecognizers?.compactMap { $0 as? DrawingCaptureRecognizer }.first)
        XCTAssertTrue(DrawingCaptureRecognizer.isAncestorPan(ancestorPan, surface: canvas))
        XCTAssertFalse(DrawingCaptureRecognizer.isAncestorPan(otherPan, surface: canvas))
        XCTAssertFalse(DrawingCaptureRecognizer.isAncestorPan(tap, surface: canvas))
        XCTAssertFalse(DrawingCaptureRecognizer.isAncestorPan(edgePan, surface: canvas))
        XCTAssertFalse(DrawingCaptureRecognizer.isAncestorPan(ancestorPan, surface: nil))
        XCTAssertFalse(recognizer.cancelsTouchesInView)
        XCTAssertEqual(Set(recognizer.allowedTouchTypes ?? []), Set([NSNumber(value: UITouch.TouchType.direct.rawValue), NSNumber(value: UITouch.TouchType.pencil.rawValue)]))
    }
}
#endif
