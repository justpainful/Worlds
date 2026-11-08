import XCTest

final class ClaudeConversationHarnessUITests: XCTestCase {
    @MainActor func testPendingResponseRecoversAfterProcessRestart() throws {
        let app = XCUIApplication()
        let fixtureID = UUID().uuidString
        app.launchArguments = ["--isolated-ui-fixture", fixtureID, "--fixture-fail-save"]
        app.launch(); try start(app)
        let composer = app.textViews["Message"]
        XCTAssertTrue(composer.waitForExistence(timeout: 20)); try waitEnabled(composer)
        composer.click(); composer.typeText("Recover question")
        app.buttons["Send"].click()
        XCTAssertTrue(app.buttons["Retry saving response"].waitForExistence(timeout: 20))
        app.terminate()

        app.launchArguments = ["--isolated-ui-fixture", fixtureID, "--fixture-allow-save"]
        app.launch(); try start(app)
        let retry = app.buttons["Retry saving response"]
        XCTAssertTrue(retry.waitForExistence(timeout: 20)); retry.click()
        XCTAssertTrue(text("Fixture response", in: app).waitForExistence(timeout: 20))
        app.terminate()

        app.launch(); try start(app)
        XCTAssertTrue(text("Recover question", in: app).waitForExistence(timeout: 20))
        XCTAssertTrue(text("Fixture response", in: app).waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["Retry saving response"].exists)
    }

    @MainActor func testConversationSurvivesProcessRestartAndCancellation() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--isolated-ui-fixture", UUID().uuidString]
        app.launch()
        try start(app)
        let composer = app.textViews["Message"]
        XCTAssertTrue(composer.waitForExistence(timeout: 20))
        try waitEnabled(composer)
        composer.click(); composer.typeText("Persisted question")
        app.buttons["Send"].click()
        XCTAssertTrue(text("Fixture response", in: app).waitForExistence(timeout: 20))
        // Wait until the saved response is reloaded and the composer is ready.
        try waitEnabled(composer)
        app.terminate()

        app.launch()
        try start(app)
        XCTAssertTrue(text("Persisted question", in: app).waitForExistence(timeout: 20))
        XCTAssertTrue(text("Fixture response", in: app).waitForExistence(timeout: 20))
        let reopenedComposer = app.textViews["Message"]
        XCTAssertTrue(reopenedComposer.waitForExistence(timeout: 10))
        try waitEnabled(reopenedComposer)
        reopenedComposer.click(); reopenedComposer.typeText("Cancel fixture")
        app.buttons["Send"].click()
        let stop = app.buttons["Stop"]
        XCTAssertTrue(stop.waitForExistence(timeout: 10)); stop.click()
        XCTAssertTrue(text("The response was cancelled.", in: app).waitForExistence(timeout: 20))
        app.terminate()

        app.launch()
        try start(app)
        XCTAssertTrue(text("Persisted question", in: app).waitForExistence(timeout: 20))
        XCTAssertTrue(text("Cancel fixture", in: app).waitForExistence(timeout: 20))
    }

    @MainActor private func start(_ app: XCUIApplication) throws {
        let button = app.buttons["Start"]
        guard button.waitForExistence(timeout: 20) else {
            captureFailure(app, name: "start-unavailable")
            XCTFail("Start did not appear")
            throw HarnessUIError.unavailable
        }
        button.click()
    }
    @MainActor private func text(_ expected: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", expected, expected)).firstMatch
    }
    @MainActor private func waitEnabled(_ element: XCUIElement) throws {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == true"), object: element)
        guard XCTWaiter.wait(for: [ready], timeout: 20) == .completed else {
            captureFailure(XCUIApplication(), name: "composer-disabled")
            XCTFail("Message editor did not become enabled")
            throw HarnessUIError.unavailable
        }
    }
    @MainActor private func captureFailure(_ app: XCUIApplication, name: String) {
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "\(name)-accessibility"; hierarchy.lifetime = .keepAlways; add(hierarchy)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "\(name)-screenshot"; screenshot.lifetime = .keepAlways; add(screenshot)
    }
    private enum HarnessUIError: Error { case unavailable }
}
