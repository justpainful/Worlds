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
        let template = app.descendants(matching: .any)["search-result.search-template"].firstMatch
        XCTAssertTrue(template.waitForExistence(timeout: 20))
        XCTAssertTrue(template.label.contains("Template · View only"), "Template result must announce that it opens read-only")
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
        try checkReaderToggle(rightToLeft: true)
    }

    @MainActor
    func testReaderShowsRTLQuotationAndOverflowingList() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-reader-fixture", "--ui-testing-rtl"]
        app.launch()
        let page = app.descendants(matching: .any)["page.reader-fixture"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 40)); page.tap()
        let quote = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "اقتباس عربي محفوظ ١٢٣", "اقتباس عربي محفوظ ١٢٣")).firstMatch
        let overflow = app.staticTexts["Overflow item"].firstMatch
        let reader = app.scrollViews["page-content"].firstMatch
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        for _ in 0..<4 { reader.swipeUp() }
        XCTAssertTrue(quote.waitForExistence(timeout: 10))
        XCTAssertTrue(accessibleText(quote).contains("Mixed quote"))
        XCTAssertTrue(accessibleText(quote).contains("Invalid color preserved"))
        XCTAssertTrue(accessibleText(quote).contains("Unsupported formatting: highlight color"))
        XCTAssertTrue(overflow.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["9223372036854775807 + 1."].exists)
        XCTAssertTrue(app.staticTexts["Unsupported attributes: pstyle"].exists)
        XCTAssertTrue(app.staticTexts["Unsupported attributes: start"].exists)
        XCTAssertTrue(app.staticTexts["رقم غير صالح محفوظ"].exists)
        XCTAssertTrue(app.staticTexts["Unsupported attributes: attributes"].exists)
        XCTAssertTrue(app.staticTexts["نص بخصائص غير صالحة"].exists)
        XCTAssertTrue(app.staticTexts["مهمة بحالة مجهولة"].exists)
        XCTAssertTrue(app.images["Completion status unknown"].exists)
        XCTAssertGreaterThanOrEqual(app.staticTexts.matching(identifier: "?").count, 2)
        let inline = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "نص مضمن محفوظ", "نص مضمن محفوظ")).firstMatch
        XCTAssertTrue(inline.exists)
        XCTAssertTrue(accessibleText(inline).contains("Unsupported formatting: text.dir"))
        let badInline = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "Equation source unavailable", "Equation source unavailable")).firstMatch
        XCTAssertTrue(badInline.exists)
        XCTAssertTrue(accessibleText(badInline).contains("Page mention label unavailable"))
        XCTAssertEqual(accessibleText(badInline).components(separatedBy: "Equation source unavailable").count - 1, 2)
        XCTAssertEqual(accessibleText(badInline).components(separatedBy: "Page mention label unavailable").count - 1, 2)
        XCTAssertTrue(accessibleText(badInline).contains("قبل"))
        XCTAssertTrue(accessibleText(badInline).contains("نهاية"))
        capture("reader-rtl-quotation-list", app: app)
    }

    @MainActor
    func testReaderToggleLeftToRight() throws {
        try checkReaderToggle(rightToLeft: false)
    }

    @MainActor
    private func checkReaderToggle(rightToLeft: Bool) throws {
        let app = XCUIApplication()
        app.launchArguments.append("--ui-testing-reader-fixture")
        if rightToLeft { app.launchArguments.append("--ui-testing-rtl") }
        app.launch()
        let page = app.descendants(matching: .any)["page.reader-fixture"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 40))
        page.tap()
        XCTAssertTrue(app.staticTexts["Read the warning"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["مَسْأَلَة ١٢٣: Solve x = 5"].exists)
        XCTAssertFalse(app.staticTexts["Hidden detail"].exists)
        let disclosure = app.buttons["reader-toggle"].firstMatch
        XCTAssertTrue(disclosure.waitForExistence(timeout: 10))
        disclosure.coordinate(withNormalizedOffset: CGVector(dx: rightToLeft ? 0.94 : 0.06, dy: 0.5)).tap()
        XCTAssertTrue(app.staticTexts["Hidden detail"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["First tab content"].exists)
        capture(rightToLeft ? "09-structured-reader-rtl" : "10-structured-reader-ltr", app: app)
        disclosure.tap()
        XCTAssertTrue(app.staticTexts["Hidden detail"].waitForNonExistence(timeout: 10))
        #if os(macOS)
        XCTAssertTrue(disclosure.debugDescription.contains("Keyboard Focused"), disclosure.debugDescription)
        disclosure.typeKey(.space, modifierFlags: [])
        XCTAssertTrue(app.staticTexts["Hidden detail"].waitForExistence(timeout: 10))
        #endif
    }

    #if os(macOS)
    @MainActor
    func testLargeReaderWindow() throws {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-reader-fixture", "--ui-testing-rtl", "--ui-testing-large-window"]
        app.launch()
        let page = app.descendants(matching: .any)["page.reader-fixture"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 40))
        page.tap()
        XCTAssertTrue(app.staticTexts["Read the warning"].waitForExistence(timeout: 20))
        let disclosure = app.buttons["reader-toggle"].firstMatch
        XCTAssertTrue(disclosure.waitForExistence(timeout: 10))
        disclosure.tap()
        XCTAssertTrue(app.staticTexts["Hidden detail"].waitForExistence(timeout: 10))
        let frame = app.windows.firstMatch.frame
        XCTAssertGreaterThanOrEqual(frame.width, 1000)
        XCTAssertGreaterThanOrEqual(frame.height, 600)
        let dimensions = XCTAttachment(string: "Window: \(frame.width) x \(frame.height) points")
        dimensions.name = "large-reader-window-dimensions"
        dimensions.lifetime = .keepAlways
        add(dimensions)
        capture("11-structured-reader-large-rtl", app: app)
    }
    #endif
    @MainActor
    func testProjectSummaryAndLinkedPage() throws {
        let app = try openResource("resource-project")
        XCTAssertTrue(app.staticTexts["Prepare the lesson"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Some linked pages are unavailable in this snapshot."].exists)
        XCTAssertTrue(app.staticTexts["This project links to itself."].exists)
        XCTAssertFalse(app.buttons["resource-page.resource-project"].exists)
        XCTAssertTrue(app.buttons["resource-page.resource-child"].exists)
        XCTAssertFalse(app.buttons["resource-page.resource-archived"].exists)
        let link = app.buttons["resource-page.reader-fixture"]
        XCTAssertTrue(link.waitForExistence(timeout: 10))
        capture("11-project-summary", app: app)
        link.tap()
        XCTAssertTrue(app.staticTexts["Read the warning"].waitForExistence(timeout: 15))
        let returnButton = app.buttons["return-to-linked-page"]
        XCTAssertTrue(returnButton.waitForExistence(timeout: 10))
        returnButton.tap()
        XCTAssertTrue(app.staticTexts["Prepare the lesson"].waitForExistence(timeout: 15))
        capture("19-return-to-project", app: app)
    }

    @MainActor
    func testArabicProjectSummary() throws {
        let app = try openResource("resource-ar-project", rightToLeft: true, light: true)
        XCTAssertTrue(app.staticTexts["مَشْرُوع الرِّيَاضِيَّات: lesson ١٢٣"].waitForExistence(timeout: 15))
        let link = app.buttons["resource-page.reader-fixture"]
        XCTAssertTrue(link.waitForExistence(timeout: 10))
        XCTAssertGreaterThanOrEqual(link.frame.height, 44)
        capture("15-project-summary-rtl", app: app)
        link.tap()
        XCTAssertTrue(app.staticTexts["Read the warning"].waitForExistence(timeout: 15))
    }

    @MainActor
    func testLargeTextSidebarCanReachLastPage() throws {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-reader-fixture", "--ui-testing-rtl", "--ui-testing-large-text", "--ui-testing-dark"]
        app.launch()
        let list = app.descendants(matching: .any)["personal-page-list"].firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 30))
        let last = app.descendants(matching: .any)["page.resource-archived"].firstMatch
        // List may create offscreen rows lazily, so scroll before querying the last row.
        for _ in 0..<6 {
            if last.exists && last.isHittable && list.frame.insetBy(dx: 0, dy: 1).contains(last.frame) { break }
            list.swipeUp()
        }
        XCTAssertTrue(last.waitForExistence(timeout: 10))
        XCTAssertTrue(last.isHittable)
        XCTAssertTrue(list.frame.insetBy(dx: 0, dy: 1).contains(last.frame),
                      "The last row must be fully visible after scrolling. List: \(list.frame), row: \(last.frame)")
        capture("20-large-text-sidebar-bottom-rtl", app: app)
    }

    @MainActor
    func testArabicProjectDark() throws {
        let app = try openResource("resource-ar-project", rightToLeft: true, dark: true)
        XCTAssertTrue(app.staticTexts["مَشْرُوع الرِّيَاضِيَّات: lesson ١٢٣"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Status"].exists)
        XCTAssertTrue(app.staticTexts["Read only"].exists)
        capture("18-project-dark-rtl", app: app)
    }

    @MainActor
    func testProjectLargeTextDarkRTL() throws {
        let app = try openResource("resource-ar-project", rightToLeft: true, largeText: true, dark: true)
        let description = app.staticTexts["مَشْرُوع الرِّيَاضِيَّات: lesson ١٢٣"]
        XCTAssertTrue(description.waitForExistence(timeout: 15))
        capture("16-project-large-text-dark-rtl", app: app)
        if !description.isHittable { app.swipeUp() }
        XCTAssertTrue(description.isHittable)
        capture("17-project-large-text-dark-rtl-content", app: app)
    }

    @MainActor
    func testGallerySummary() throws {
        let app = try openResource("resource-gallery")
        XCTAssertTrue(app.staticTexts["diagram.png"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Reference diagram"].exists)
        capture("12-gallery-summary", app: app)
    }

    @MainActor
    func testPresentationSummary() throws {
        let app = try openResource("resource-deck")
        XCTAssertTrue(app.staticTexts["A real fixture slide"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Slide 1"].exists)
        XCTAssertTrue(app.staticTexts["Unsupported presentation content"].exists)
        XCTAssertTrue(app.staticTexts["Explain the example"].exists)
        capture("13-presentation-summary", app: app)
    }

    @MainActor
    func testFileSummary() throws {
        let app = try openResource("resource-file")
        XCTAssertTrue(app.staticTexts["lesson.pdf"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["application/pdf"].exists)
        capture("14-file-summary", app: app)
    }

    @MainActor
    func testStreamPlaybackFailureCanBeRetried() throws {
        let app = try openResource("resource-stream")
        let play = app.buttons["play-external-stream"]
        XCTAssertTrue(play.waitForExistence(timeout: 15)); play.tap()
        XCTAssertTrue(app.staticTexts["external-stream-error"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.buttons["retry-external-stream"].exists)
        capture("15-stream-failure", app: app)
        app.buttons["retry-external-stream"].tap()
        XCTAssertTrue(app.staticTexts["external-stream-error"].waitForExistence(timeout: 30))
    }

    @MainActor
    func testDashStreamExplainsUnsupportedPlayback() throws {
        let app = try openResource("resource-stream-dash", rightToLeft: true, largeText: true)
        XCTAssertTrue(app.staticTexts["external-stream-dash"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["play-external-stream"].exists)
        capture("16-stream-dash-rtl", app: app)
    }

    @MainActor
    func testStreamUsesStoredFormatWhenExtensionConflicts() throws {
        let app = try openResource("resource-stream-format-mismatch")
        XCTAssertTrue(app.buttons["play-external-stream"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["external-stream-dash"].exists)
    }

    @MainActor
    private func openResource(_ id: String, rightToLeft: Bool = false, largeText: Bool = false, dark: Bool = false, light: Bool = false) throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments.append("--ui-testing-reader-fixture")
        if rightToLeft { app.launchArguments.append("--ui-testing-rtl") }
        if largeText { app.launchArguments.append("--ui-testing-large-text") }
        if dark { app.launchArguments.append("--ui-testing-dark") }
        if light { app.launchArguments.append("--ui-testing-light") }
        app.launch()
        let row = app.descendants(matching: .any)["page.\(id)"].firstMatch
        if !row.waitForExistence(timeout: 10) { app.swipeUp() }
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
        XCTAssertTrue(app.descendants(matching: .any)["resource-content"].firstMatch.waitForExistence(timeout: 15))
        return app
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
    private func accessibleText(_ element: XCUIElement) -> String {
        let value = element.value as? String ?? ""
        return value.isEmpty ? element.label : value
    }
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
