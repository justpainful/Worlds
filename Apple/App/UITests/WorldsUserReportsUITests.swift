import XCTest

/// The fixes users asked for, checked in the running app on iPhone, iPad and Mac:
/// concept maps open as a world that moves and switches to a diagram, and the
/// drawing tools show their own coloured icons with a custom colour picker.
final class WorldsUserReportsUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor private func open(_ id: String, _ app: XCUIApplication) -> Bool {
        let row = app.descendants(matching: .any)["page.\(id)"].firstMatch
        guard row.waitForExistence(timeout: 30) else { failure(app, "\(id)-missing"); XCTFail("\(id) did not appear"); return false }
        row.tap()
        return true
    }

    @MainActor func testConceptMapOpensAsAWorldThatMoves() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-local-copy-fixture", "--ui-testing-concept-map"]
        app.launch()
        guard open("fixture-concept-map", app) else { return }
        let world = app.descendants(matching: .any)["concept-world"].firstMatch
        guard world.waitForExistence(timeout: 20) else { failure(app, "concept-world-missing"); XCTFail("The concept map did not open as a world"); return }
        XCTAssertTrue(world.value as? String == "Main idea, First concept, Second concept, Third concept, Result", "The world must hold every concept")
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
        diagram.tap()
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        screenshot(app, "concept-diagram")
        let full = app.buttons["Full screen"].firstMatch
        XCTAssertTrue(full.exists, "The map must open full screen")
        full.tap()
        let done = app.buttons["Done"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 10), "Full screen must have a way back")
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        screenshot(app, "concept-full-screen")
        done.tap()
    }

    @MainActor func testDrawingToolsShowTheirIconsAndAnyColour() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-local-copy-fixture", "-WorldsDrawingCorrectShapes", "NO"]
        app.launch()
        guard open("fixture-drawing", app) else { return }
        let edit = app.buttons["edit-local-drawing"]
        guard edit.waitForExistence(timeout: 20) else { failure(app, "drawing-edit-missing"); XCTFail("Drawing editor action did not appear"); return }
        edit.tap()
        let status = app.staticTexts["drawing-status"]
        guard status.waitForExistence(timeout: 20) else { failure(app, "drawing-status-missing"); XCTFail("Drawing status did not appear"); return }
        wait(for: [expectation(for: NSPredicate(format: "label CONTAINS %@", "Saved revision 0"), evaluatedWith: status)], timeout: 20)
        XCTAssertTrue(app.descendants(matching: .any)["drawing-custom-color"].firstMatch.exists, "Any colour must be one tap away")
        let tool = app.descendants(matching: .any)["drawing-tool"].firstMatch
        XCTAssertTrue(tool.exists)
        tool.tap()
        let highlighter = app.descendants(matching: .any)["Highlighter"].firstMatch
        guard highlighter.waitForExistence(timeout: 10) else { failure(app, "drawing-tool-menu-missing"); XCTFail("The tool menu did not open"); return }
        screenshot(app, "drawing-tool-menu")
        highlighter.tap()
        let surface = app.otherElements["drawing-surface"]
        XCTAssertTrue(surface.waitForExistence(timeout: 10))
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.3))
            .press(forDuration: 0.1, thenDragTo: surface.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.4)))
        let saved = NSPredicate(format: "label CONTAINS %@", "Saved revision 1, strokes 1")
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: saved, object: status)], timeout: 30) == .completed else {
            failure(app, "drawing-highlighter-not-saved"); XCTFail("The highlighter stroke did not save"); return
        }
        screenshot(app, "drawing-highlighter-stroke")
        app.descendants(matching: .any)["drawing-custom-color"].firstMatch.tap()
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        screenshot(app, "drawing-custom-color")
    }

    private func screenshot(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
    private func failure(_ app: XCUIApplication, _ name: String) {
        screenshot(app, name)
        let hierarchy = XCTAttachment(string: app.debugDescription); hierarchy.name = name + "-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }
}
