import XCTest

final class DrawingHarnessUITests: XCTestCase {
    func testDrawSaveAndReopen() throws {
        let app = XCUIApplication(); app.launch()
        let status = app.staticTexts["drawing-status"]
        XCTAssertTrue(status.waitForExistence(timeout: 30))
        let initial = expectation(for: NSPredicate(format: "label CONTAINS %@", "Saved revision 0"), evaluatedWith: status)
        wait(for: [initial], timeout: 30)
        let surface = app.otherElements["drawing-surface"]
        XCTAssertTrue(surface.waitForExistence(timeout: 10))
        let start = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.10))
        let end = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.20))
        start.press(forDuration: 0.1, thenDragTo: end)
        let saved = expectation(for: NSPredicate(format: "label CONTAINS %@", "Saved revision 1, strokes 1"), evaluatedWith: status)
        wait(for: [saved], timeout: 30)
        attach(app, "drawing-after-save")
        app.buttons["drawing-reopen"].tap()
        let reopened = expectation(for: NSPredicate(format: "label CONTAINS %@", "Saved revision 1, strokes 1"), evaluatedWith: status)
        wait(for: [reopened], timeout: 30)
        attach(app, "drawing-after-reopen")
    }
    func testSyntheticTriangleCorrectionAndReopen() throws {
        let app = XCUIApplication(); app.launchArguments = ["--synthetic-triangle"]; app.launch()
        let button = app.buttons["simulate-triangle"]
        XCTAssertTrue(button.waitForExistence(timeout: 30))
        let enabled = expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: button)
        wait(for: [enabled], timeout: 30)
        button.tap()
        let status = app.staticTexts["drawing-status"]
        let predicate = NSPredicate(format: "label CONTAINS %@", "Saved revision 2, strokes 1, shape right-triangle")
        wait(for: [expectation(for: predicate, evaluatedWith: status)], timeout: 30)
        attach(app, "synthetic-triangle-after-save")
        app.buttons["drawing-reopen"].tap()
        wait(for: [expectation(for: predicate, evaluatedWith: status)], timeout: 30)
        attach(app, "synthetic-triangle-after-reopen")
    }
    private func attach(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
}
