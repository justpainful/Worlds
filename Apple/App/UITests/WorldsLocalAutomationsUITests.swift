#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_AUTOMATIONS
import XCTest

final class WorldsLocalAutomationsUITests: XCTestCase {
    @MainActor func testEmptyAutomationsOnIndependentCopy() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing-local-copy-fixture"]; app.launch()
        let button = app.buttons["open-local-automations"]
        XCTAssertTrue(button.waitForExistence(timeout: 30)); button.tap()
        XCTAssertTrue(app.staticTexts["No personal automations in this copy."].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["No personal requests waiting for review."].exists)
        screenshot(app, "automations-empty")
    }
    @MainActor func testDeclineOnlyChangesIndependentCopy() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing-local-copy-fixture", "--ui-testing-automation-fixture"]; app.launch()
        let button = app.buttons["open-local-automations"]
        XCTAssertTrue(button.waitForExistence(timeout: 30)); button.tap()
        let decline = app.buttons["decline-automation.pending-fixture"]
        XCTAssertTrue(decline.waitForExistence(timeout: 20)); screenshot(app, "automations-pending")
        #if os(macOS)
        XCTAssertGreaterThan(decline.frame.width, 0)
        XCTAssertGreaterThan(decline.frame.height, 0)
        XCTAssertTrue(decline.isHittable)
        #endif
        decline.tap()
        let confirm = app.buttons["Decline"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10)); confirm.tap()
        XCTAssertTrue(app.staticTexts["No personal requests waiting for review."].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Status: cancelled"].exists)
        screenshot(app, "automations-declined")
    }
    private func screenshot(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
}
#endif
