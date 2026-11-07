import XCTest

@MainActor
final class WorldsUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testOpeningScreen() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Open your Worlds database"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Open Database"].exists)
        capture("01-open-database")
    }

    func testPersonalPageNavigation() throws {
        let app = XCUIApplication()
        app.launchArguments.append("--ui-testing-fixture")
        app.launch()
        let page = app.staticTexts["Fixture page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 15))
        capture("02-personal-pages")
        page.tap()
        XCTAssertTrue(app.staticTexts["Hello Worlds"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Read only"].exists)
        capture("03-page-content")
    }

    func testDatabaseError() throws {
        let app = XCUIApplication()
        app.launchArguments.append("--ui-testing-missing-fixture")
        app.launch()
        XCTAssertTrue(app.alerts["Could not open database"].waitForExistence(timeout: 15))
        capture("04-database-error")
        app.alerts.buttons["OK"].tap()
        XCTAssertFalse(app.alerts["Could not open database"].exists)
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
