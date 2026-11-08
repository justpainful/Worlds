#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
import XCTest

final class WorldsLocalDrawingUITests: XCTestCase {
    @MainActor private func openDrawing(_ app: XCUIApplication) {
        let row = app.descendants(matching: .any)["page.fixture-drawing"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 30)); row.tap()
        let edit = app.buttons["edit-local-drawing"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
    }
    @MainActor func testPersonalDrawingSaveAndReopen() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing-local-copy-fixture"]; app.launch()
        openDrawing(app)
        let status = app.staticTexts["drawing-status"]
        XCTAssertTrue(status.waitForExistence(timeout: 20))
        wait(for: [expectation(for: NSPredicate(format: "label CONTAINS %@", "Saved revision 0"), evaluatedWith: status)], timeout: 20)
        let surface = app.otherElements["drawing-surface"]
        XCTAssertTrue(surface.waitForExistence(timeout: 10))
        let start = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.10))
        let end = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.20))
        start.press(forDuration: 0.1, thenDragTo: end)
        let saved = NSPredicate(format: "label CONTAINS %@", "Saved revision 1, strokes 1")
        wait(for: [expectation(for: saved, evaluatedWith: status)], timeout: 30)
        screenshot(app, "personal-drawing-saved")
        app.buttons["close-drawing-editor"].tap()
        let edit = app.buttons["edit-local-drawing"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(status.waitForExistence(timeout: 20))
        wait(for: [expectation(for: saved, evaluatedWith: status)], timeout: 20)
        screenshot(app, "personal-drawing-reopened")
    }
    @MainActor func testUnsupportedSceneCannotBeEdited() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing-local-copy-fixture", "--ui-testing-unsupported-drawing"]; app.launch()
        openDrawing(app)
        let status = app.staticTexts["drawing-status"]
        XCTAssertTrue(status.waitForExistence(timeout: 20))
        wait(for: [expectation(for: NSPredicate(format: "label CONTAINS %@", "cannot be displayed safely"), evaluatedWith: status)], timeout: 20)
        XCTAssertFalse(app.otherElements["drawing-surface"].exists)
        XCTAssertTrue(app.buttons["close-drawing-editor"].isEnabled)
        screenshot(app, "personal-drawing-unsupported")
    }
    private func screenshot(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
}
#endif
