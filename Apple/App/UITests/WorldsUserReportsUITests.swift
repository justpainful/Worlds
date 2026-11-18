import XCTest

/// The fixes users asked for, checked in the running app on iPhone, iPad and Mac:
/// concept maps open as a world that moves and switches to a diagram, and the
/// drawing tools show their own coloured icons with a custom colour picker.
final class WorldsUserReportsUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        // The straight drag would otherwise be corrected into a line shape.
        // Window restoration can leave a Mac with no window open after the earlier tests.
        app.launchArguments = ["--ui-testing-user-reports", "-WorldsDrawingCorrectShapes", "NO", "-ApplePersistenceIgnoreState", "YES"]
        app.launch()
        #if os(macOS)
        app.activate()
        if !app.windows.firstMatch.waitForExistence(timeout: 5) {
            // Clicking the app in the Dock opens a new window, as it does for a person.
            let dock = XCUIApplication(bundleIdentifier: "com.apple.dock")
            let icon = dock.descendants(matching: .any)["Worlds"].firstMatch
            if icon.waitForExistence(timeout: 5) { icon.click() }
            _ = app.windows.firstMatch.waitForExistence(timeout: 10)
        }
        #endif
        return app
    }

    @MainActor func testConceptMapOpensAsAWorldThatMoves() {
        let app = launch()
        let world = app.descendants(matching: .any)["concept-world"].firstMatch
        guard world.waitForExistence(timeout: 30) else { failure(app, "concept-world-missing"); XCTFail("The concept map did not open as a world"); return }
        // iOS reads the concept names out as the value; the Mac names the canvas.
        let names = (world.value as? String) ?? ""
        XCTAssertTrue(names.contains("Main idea") || world.label == "Concept map", "The world must hold the concepts")
        let diagram = app.descendants(matching: .any)["Diagram"].firstMatch
        XCTAssertTrue(diagram.exists, "The World and Diagram switch must show")
        // Let the concepts settle, then drag the world and see it move.
        RunLoop.current.run(until: Date().addingTimeInterval(5))
        screenshot(app, "concept-world")
        let before = world.screenshot().pngRepresentation
        let from = world.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        from.press(forDuration: 0.1, thenDragTo: world.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.7)))
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        XCTAssertNotEqual(world.screenshot().pngRepresentation, before, "Dragging must move the world")
        screenshot(app, "concept-world-moved")
        hit(diagram)
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        screenshot(app, "concept-diagram")
        let full = app.buttons["Full screen"].firstMatch
        XCTAssertTrue(full.exists, "The map must open full screen")
        hit(full)
        let done = app.buttons["Done"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 10), "Full screen must have a way back")
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        screenshot(app, "concept-full-screen")
        hit(done)
    }

    @MainActor func testDrawingToolsShowTheirIconsAndAnyColour() {
        let app = launch()
        let part = app.descendants(matching: .any)["Drawing"].firstMatch
        guard part.waitForExistence(timeout: 30) else { failure(app, "drawing-part-missing"); XCTFail("The check screen did not open"); return }
        hit(part)
        let status = app.staticTexts["drawing-status"]
        guard status.waitForExistence(timeout: 30) else { failure(app, "drawing-status-missing"); XCTFail("The drawing editor did not open"); return }
        guard app.descendants(matching: .any)["drawing-surface"].firstMatch.waitForExistence(timeout: 20) else { failure(app, "drawing-surface-missing"); XCTFail("The drawing surface did not appear"); return }
        XCTAssertTrue(app.descendants(matching: .any)["drawing-custom-color"].firstMatch.exists, "Any colour must be one tap away")
        let tool = app.descendants(matching: .any)["drawing-tool"].firstMatch
        XCTAssertTrue(tool.exists)
        hit(tool)
        let highlighter = app.descendants(matching: .any)["Highlighter"].firstMatch
        guard highlighter.waitForExistence(timeout: 10) else { failure(app, "drawing-tool-menu-missing"); XCTFail("The tool menu did not open"); return }
        screenshot(app, "drawing-tool-menu")
        hit(highlighter)
        let surface = app.descendants(matching: .any)["drawing-surface"].firstMatch
        XCTAssertTrue(surface.waitForExistence(timeout: 10))
        // A stroke that starts outside the board is refused, and nothing is saved.
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.6))
            .press(forDuration: 0.1, thenDragTo: surface.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.7)))
        let refused = NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "outsideRegion", "outsideRegion")
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: refused, object: status)], timeout: 20) == .completed else {
            failure(app, "drawing-outside-not-refused"); XCTFail("A stroke outside the board must be refused"); return
        }
        screenshot(app, "drawing-outside-refused")
        // Inside the board the highlighter draws and saves.
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.10))
            .press(forDuration: 0.1, thenDragTo: surface.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.20)))
        let saved = NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "strokes 1", "strokes 1")
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: saved, object: status)], timeout: 30) == .completed else {
            failure(app, "drawing-highlighter-not-saved"); XCTFail("The highlighter stroke did not save"); return
        }
        screenshot(app, "drawing-highlighter-stroke")
        hit(app.descendants(matching: .any)["drawing-custom-color"].firstMatch)
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        screenshot(app, "drawing-custom-color")
    }

    /// A click on the Mac, a tap on iPhone and iPad.
    private func hit(_ element: XCUIElement) {
        #if os(macOS)
        element.click()
        #else
        element.tap()
        #endif
    }
    private func screenshot(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
    private func failure(_ app: XCUIApplication, _ name: String) {
        screenshot(app, name)
        let hierarchy = XCTAttachment(string: app.debugDescription); hierarchy.name = name + "-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }
}
