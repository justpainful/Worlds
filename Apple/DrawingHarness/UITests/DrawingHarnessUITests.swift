import XCTest

final class DrawingHarnessUITests: XCTestCase {
    func testDrawSaveAndReopen() throws {
        let app = XCUIApplication(); app.launch()
        let status = app.staticTexts["drawing-status"]
        guard status.waitForExistence(timeout: 30) else { attachFailure(app, "drawing-status-missing"); XCTFail("Drawing status did not appear"); return }
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
    func testColoredHighlighterSavesAndReopens() throws {
        let app = XCUIApplication(); app.launch()
        let status = app.staticTexts["drawing-status"]
        XCTAssertTrue(status.waitForExistence(timeout: 30))
        wait(for: [expectation(for: NSPredicate(format: "label CONTAINS %@", "Saved revision 0"), evaluatedWith: status)], timeout: 30)
        selectMenu("drawing-tool", value: "Highlighter", in: app)
        selectMenu("drawing-color", value: "Blue", in: app)
        let surface = app.otherElements["drawing-surface"]; XCTAssertTrue(surface.waitForExistence(timeout: 10))
        let start = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.10))
        let end = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.20))
        start.press(forDuration: 0.1, thenDragTo: end)
        let saved = NSPredicate(format: "label CONTAINS %@", "Saved revision 1, strokes 1")
        wait(for: [expectation(for: saved, evaluatedWith: status)], timeout: 30)
        XCTAssertEqual(app.staticTexts["drawing-last-brush"].label, "Last stroke: highlighter #007aff")
        attach(app, "blue-highlighter-saved")
        app.buttons["drawing-reopen"].tap()
        wait(for: [expectation(for: saved, evaluatedWith: status)], timeout: 30)
        XCTAssertEqual(app.staticTexts["drawing-last-brush"].label, "Last stroke: highlighter #007aff")
        attach(app, "blue-highlighter-reopened")
    }
    func testLaserFadesWithoutChangingStoredDrawing() throws {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing-laser-long"]; app.launch()
        let status = app.staticTexts["drawing-status"]
        XCTAssertTrue(status.waitForExistence(timeout: 30))
        wait(for: [expectation(for: NSPredicate(format: "label CONTAINS %@", "Saved revision 0"), evaluatedWith: status)], timeout: 30)
        selectMenu("drawing-tool", value: "Laser", in: app)
        let surface = app.otherElements["drawing-surface"]
        XCTAssertTrue(surface.waitForExistence(timeout: 10))
        let start = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.10))
        let end = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.20))
        start.press(forDuration: 0.1, thenDragTo: end)
        let active = app.staticTexts["laser-active"]
        XCTAssertTrue(active.waitForExistence(timeout: 3)); attach(app, "laser-in-progress")
        wait(for: [expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: active)], timeout: 10)
        XCTAssertTrue(status.label.contains("Saved revision 0, strokes 0"))
        app.buttons["drawing-reopen"].tap()
        wait(for: [expectation(for: NSPredicate(format: "label CONTAINS %@", "Saved revision 0, strokes 0"), evaluatedWith: status)], timeout: 20)
    }
    private func selectMenu(_ identifier: String, value: String, in app: XCUIApplication) {
        let picker = app.descendants(matching: .any)[identifier].firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 10)); picker.tap()
        #if os(macOS)
        let choice = app.menuItems[value]
        #else
        let choice = app.buttons[value]
        #endif
        XCTAssertTrue(choice.waitForExistence(timeout: 10)); choice.tap()
    }
    private func attach(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
    private func attachFailure(_ app: XCUIApplication, _ name: String) {
        attach(app, name)
        let hierarchy = XCTAttachment(string: app.debugDescription); hierarchy.name = name + "-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }
}
