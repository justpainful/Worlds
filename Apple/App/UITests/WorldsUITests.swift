import XCTest

final class WorldsUITests: XCTestCase {
    @MainActor
    func testOpeningScreen() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Open your Worlds database"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["open-database"].exists)
        capture("01-open-database")
    }

    @MainActor
    func testPersonalPageNavigation() throws {
        let app = XCUIApplication()
        app.launchArguments.append("--ui-testing-fixture")
        app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 15))
        capture("02-personal-pages")
        page.tap()
        XCTAssertTrue(app.staticTexts["Hello Worlds"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Read only"].exists)
        capture("03-page-content")
    }

    @MainActor
    func testDatabaseError() throws {
        let app = XCUIApplication()
        app.launchArguments.append("--ui-testing-missing-fixture")
        app.launch()
        #if os(macOS)
        let dismiss = app.sheets.buttons["OK"]
        #else
        let dismiss = app.alerts.buttons["OK"]
        #endif
        XCTAssertTrue(dismiss.waitForExistence(timeout: 15))
        capture("04-database-error")
        dismiss.tap()
        XCTAssertFalse(dismiss.exists)
    }

    @MainActor
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
