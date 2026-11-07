import XCTest

final class WorldsUITests: XCTestCase {
    @MainActor
    func testOpeningScreen() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Open your Worlds database"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["open-database"].exists)
        capture("01-open-database", app: app)
    }

    @MainActor
    func testPersonalPageNavigation() throws {
        let app = XCUIApplication()
        app.launchArguments.append("--ui-testing-fixture")
        app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 15))
        capture("02-personal-pages", app: app)
        page.tap()
        XCTAssertTrue(app.staticTexts["Hello Worlds"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Read only"].exists)
        capture("03-page-content", app: app)
    }

    @MainActor
    func testPersonalSearchAndNavigation() throws {
        let app = XCUIApplication()
        app.launchArguments.append("--ui-testing-search-fixture")
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["page.search-personal"].firstMatch.waitForExistence(timeout: 20))
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 20))
        search.tap()
        search.typeText("geometry")
        let result = app.descendants(matching: .any)["search-result.search-personal"].firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 20))
        XCTAssertFalse(app.descendants(matching: .any)["search-result.search-shared"].exists)
        capture("05-personal-search-results", app: app)
        result.tap()
        XCTAssertTrue(app.staticTexts["Read only"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["geometry lesson"].exists)
        capture("06-search-result-page", app: app)
    }

    @MainActor
    func testSearchEmptyState() throws {
        let app = XCUIApplication()
        app.launchArguments.append("--ui-testing-search-fixture")
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["page.search-personal"].firstMatch.waitForExistence(timeout: 20))
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 20))
        search.tap()
        search.typeText("notfoundxyz")
        XCTAssertTrue(app.descendants(matching: .any)["search-empty"].firstMatch.waitForExistence(timeout: 20))
        #if os(iOS)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        #endif
        capture("07-search-no-results", app: app)
    }

    @MainActor
    func testRightToLeftNavigationAndReading() throws {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-fixture", "--ui-testing-rtl"]
        app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 20))
        page.tap()
        XCTAssertTrue(app.descendants(matching: .any)["page-content"].firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Hello Worlds"].exists)
        capture("08-rtl-page-content", app: app)
    }

    @MainActor
    func testClearingSearchReturnsToPageList() throws {
        let app = XCUIApplication()
        app.launchArguments.append("--ui-testing-search-fixture")
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["page.search-personal"].firstMatch.waitForExistence(timeout: 20))
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 20))
        search.tap()
        #if os(iOS)
        if !app.keyboards.firstMatch.waitForExistence(timeout: 5) { search.tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        #endif
        search.typeText("geometry")
        XCTAssertTrue(app.descendants(matching: .any)["search-result.search-personal"].firstMatch.waitForExistence(timeout: 20))
        search.tap()
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 8))
        XCTAssertTrue(app.descendants(matching: .any)["page.search-personal"].firstMatch.waitForExistence(timeout: 20))
    }

    @MainActor
    func testReaderShowsStructuredContentAndExpandsToggle() throws {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-reader-fixture", "--ui-testing-rtl"]
        app.launch()
        let page = app.descendants(matching: .any)["page.reader-fixture"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 20))
        page.tap()
        XCTAssertTrue(app.staticTexts["Read the warning"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["مَسْأَلَة ١٢٣: Solve x = 5"].exists)
        XCTAssertFalse(app.staticTexts["Hidden detail"].exists)
        let disclosure = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "More details")).firstMatch
        XCTAssertTrue(disclosure.waitForExistence(timeout: 10))
        disclosure.tap()
        XCTAssertTrue(app.staticTexts["Hidden detail"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["First tab content"].exists)
        capture("09-structured-reader-rtl", app: app)
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
        capture("04-database-error", app: app)
        dismiss.tap()
        XCTAssertFalse(dismiss.exists)
    }

    @MainActor
    private func capture(_ name: String, app: XCUIApplication) {
        #if os(macOS)
        app.activate()
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 5))
        let screenshot = window.screenshot()
        #else
        let screenshot = XCUIScreen.main.screenshot()
        #endif
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
