import XCTest

final class ClaudeConversationHarnessUITests: XCTestCase {
    override func tearDown() {
        let app = XCUIApplication()
        if app.state != .notRunning {
            app.terminate()
            _ = XCTWaiter.wait(for: [XCTestExpectation(description: "teardown")], timeout: 1.5)
        }
        super.tearDown()
    }

    @MainActor func testReferenceEditorAccessibilityDiagnostic() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--isolated-ui-fixture", UUID().uuidString, "--diagnose-reference-editor", "-ApplePersistenceIgnoreState", "YES"]
        app.launch()
        try start(app)
        let composer = app.textViews["Message"].firstMatch
        let reference = app.textViews["Diagnostic editor"].firstMatch
        guard composer.waitForExistence(timeout: 20), reference.waitForExistence(timeout: 20) else {
            captureFailure(app, name: "reference-editor-missing")
            XCTFail("Diagnostic editors did not appear")
            return
        }
        let details = app.staticTexts["conversation-fixture-diagnostics"].firstMatch
        let loaded = NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "loaded=true", "loaded=true")
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: loaded, object: details)], timeout: 20) == .completed else {
            captureFailure(app, name: "reference-editor-load-missing")
            XCTFail("Diagnostic conversation did not finish loading")
            return
        }
        let observation = "composer enabled=\(composer.isEnabled) hittable=\(composer.isHittable); reference enabled=\(reference.isEnabled) hittable=\(reference.isHittable); native=\((details.value as? String) ?? details.label)"
        let attachment = XCTAttachment(string: observation)
        attachment.name = "reference-editor-observation"; attachment.lifetime = .keepAlways; add(attachment)
        captureFailure(app, name: "reference-editor-diagnostic")
    }

    @MainActor func testPendingResponseRecoversAfterProcessRestart() throws {
        let app = XCUIApplication()
        let fixtureID = UUID().uuidString
        app.launchArguments = ["--isolated-ui-fixture", fixtureID, "--fixture-fail-save", "-ApplePersistenceIgnoreState", "YES"]
        app.launch(); try start(app)
        let composer = app.textViews["Message"]
        XCTAssertTrue(composer.waitForExistence(timeout: 20)); try waitEnabled(composer)
        focusAndType("Recover question", into: composer)
        app.buttons["Send"].click()
        XCTAssertTrue(app.buttons["Retry saving response"].waitForExistence(timeout: 20))
        terminateAndClean(app)

        app.launchArguments = ["--isolated-ui-fixture", fixtureID, "--fixture-allow-save", "-ApplePersistenceIgnoreState", "YES"]
        app.launch(); try start(app)
        let retry = app.buttons["Retry saving response"]
        XCTAssertTrue(retry.waitForExistence(timeout: 20)); retry.click()
        XCTAssertTrue(text("Fixture response", in: app).waitForExistence(timeout: 20))
        terminateAndClean(app)

        app.launchArguments = ["--isolated-ui-fixture", fixtureID, "--fixture-allow-save", "-ApplePersistenceIgnoreState", "YES"]
        app.launch(); try start(app)
        XCTAssertTrue(text("Recover question", in: app).waitForExistence(timeout: 20))
        XCTAssertTrue(text("Fixture response", in: app).waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["Retry saving response"].exists)
    }

    @MainActor func testConversationSurvivesProcessRestartAndCancellation() throws {
        let app = XCUIApplication()
        let fixtureID = UUID().uuidString
        app.launchArguments = ["--isolated-ui-fixture", fixtureID, "-ApplePersistenceIgnoreState", "YES"]
        app.launch()
        try start(app)
        let composer = app.textViews["Message"]
        XCTAssertTrue(composer.waitForExistence(timeout: 20))
        try waitEnabled(composer)
        focusAndType("Persisted question", into: composer)
        app.buttons["Send"].click()
        XCTAssertTrue(text("Fixture response", in: app).waitForExistence(timeout: 20))
        // Wait until the saved response is reloaded and the composer is ready.
        try waitEnabled(composer)
        terminateAndClean(app)

        app.launchArguments = ["--isolated-ui-fixture", fixtureID, "-ApplePersistenceIgnoreState", "YES"]
        app.launch()
        try start(app)
        XCTAssertTrue(text("Persisted question", in: app).waitForExistence(timeout: 20))
        XCTAssertTrue(text("Fixture response", in: app).waitForExistence(timeout: 20))
        let reopenedComposer = app.textViews["Message"]
        XCTAssertTrue(reopenedComposer.waitForExistence(timeout: 10))
        try waitEnabled(reopenedComposer)
        focusAndType("Cancel fixture", into: reopenedComposer)
        app.buttons["Send"].click()
        let stop = app.buttons["Stop"]
        XCTAssertTrue(stop.waitForExistence(timeout: 10)); stop.click()
        XCTAssertTrue(text("The response was cancelled.", in: app).waitForExistence(timeout: 20))
        terminateAndClean(app)

        app.launchArguments = ["--isolated-ui-fixture", fixtureID, "-ApplePersistenceIgnoreState", "YES"]
        app.launch()
        try start(app)
        XCTAssertTrue(text("Persisted question", in: app).waitForExistence(timeout: 20))
        XCTAssertTrue(text("Cancel fixture", in: app).waitForExistence(timeout: 20))
    }

    @MainActor private func focusAndType(_ text: String, into element: XCUIElement) {
        #if os(macOS)
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
        #else
        element.tap()
        #endif
        element.typeText(text)
    }
    @MainActor private func terminateAndClean(_ app: XCUIApplication) {
        app.terminate()
        _ = XCTWaiter.wait(for: [XCTestExpectation(description: "relaunch-wait")], timeout: 1.5)
    }
    @MainActor private func start(_ app: XCUIApplication) throws {
        #if os(macOS)
        app.activate()
        #endif
        _ = app.windows.firstMatch.waitForExistence(timeout: 10)
        let button = app.buttons["Start"]
        if button.waitForExistence(timeout: 10) {
            button.click()
        }
        let composer = app.textViews["Message"].firstMatch
        let diagnostics = app.staticTexts["conversation-fixture-diagnostics"].firstMatch
        guard composer.waitForExistence(timeout: 20) || diagnostics.waitForExistence(timeout: 20) else {
            captureFailure(app, name: "start-unavailable")
            XCTFail("Start did not appear; application state: \(app.state.rawValue), windows: \(app.windows.count)")
            throw HarnessUIError.unavailable
        }
    }
    @MainActor private func text(_ expected: String, in app: XCUIApplication) -> XCUIElement {
        let predicate = NSPredicate(format: "label CONTAINS[c] %@ OR value CONTAINS[c] %@", expected, expected)
        let other = app.otherElements.matching(predicate).firstMatch
        if other.exists { return other }
        let staticText = app.staticTexts.matching(predicate).firstMatch
        if staticText.exists { return staticText }
        if app.windows.firstMatch.exists {
            return app.windows.firstMatch.descendants(matching: .any).matching(predicate).firstMatch
        }
        return other
    }
    @MainActor private func waitEnabled(_ element: XCUIElement) throws {
        let app = XCUIApplication()
        #if os(macOS)
        app.activate()
        #endif
        let diagnostics = app.staticTexts["conversation-fixture-diagnostics"].firstMatch
        guard diagnostics.waitForExistence(timeout: 20) else {
            captureFailure(app, name: "diagnostics-missing")
            XCTFail("Conversation diagnostics did not appear")
            throw HarnessUIError.unavailable
        }
        let loadedPredicate = NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "loaded=true", "loaded=true")
        let ready = XCTNSPredicateExpectation(predicate: loadedPredicate, object: diagnostics)
        guard XCTWaiter.wait(for: [ready], timeout: 20) == .completed else {
            captureFailure(app, name: "load-timeout")
            let details = (diagnostics.value as? String) ?? diagnostics.label
            XCTFail("Conversation did not finish loading: \(details)")
            throw HarnessUIError.unavailable
        }
        #if os(macOS)
        app.activate()
        #endif
    }
    @MainActor private func captureFailure(_ app: XCUIApplication, name: String) {
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "\(name)-accessibility"; hierarchy.lifetime = .keepAlways; add(hierarchy)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "\(name)-screenshot"; screenshot.lifetime = .keepAlways; add(screenshot)
    }
    private enum HarnessUIError: Error { case unavailable }
}
