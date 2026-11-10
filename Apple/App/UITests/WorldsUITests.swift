import XCTest
#if os(macOS)
import Darwin
#endif

final class WorldsUITests: XCTestCase {
    #if os(macOS)
    private var traceDirectoryFDs: [String: Int32] = [:]
    func testWindowTraceFilterRejectsUnstructuredText() {
        let valid = "willFinishLaunching active=true hidden=false modal=false windows=1 [visible=true,miniaturized=false,key=true]\n"
        XCTAssertTrue(isSafeWindowTrace(valid))
        XCTAssertFalse(isSafeWindowTrace(valid + "secret document contents\n"))
        XCTAssertFalse(isSafeWindowTrace("willFinishLaunching active=true hidden=false modal=false windows=1 [secret]\n"))
    }
    #endif
    @MainActor func testPersonalHierarchyExpandCollapseAndRetainState() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-reader-fixture", "--ui-testing-rtl", "--ui-testing-large-text"]
        app.launch()
        let parent = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        guard parent.waitForExistence(timeout: 30) else {
            captureLaunchFailure(app, name: "hierarchy-parent-missing")
            XCTFail("Parent page missing"); return
        }
        let toggle = app.buttons["toggle-page-hierarchy"]
        guard toggle.waitForExistence(timeout: 20) else {
            captureLaunchFailure(app, name: "hierarchy-toggle-missing")
            XCTFail("Hierarchy action missing"); return
        }
        toggle.tap()
        let expandParent = app.buttons["expand-page.fixture-page"]
        guard expandParent.waitForExistence(timeout: 20) else {
            captureLaunchFailure(app, name: "hierarchy-parent-expansion-missing")
            XCTFail("Parent expansion missing"); return
        }
        XCTAssertFalse(app.descendants(matching: .any)["page.reader-child"].exists)
        expandParent.tap()
        let child = app.descendants(matching: .any)["page.reader-child"].firstMatch
        XCTAssertTrue(child.waitForExistence(timeout: 20))
        XCTAssertFalse(app.descendants(matching: .any)["page.reader-archived-child"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["page.reader-shared-child"].exists)
        let expandChild = app.buttons["expand-page.reader-child"]
        XCTAssertTrue(expandChild.waitForExistence(timeout: 10))
        expandChild.tap()
        let grandchild = app.descendants(matching: .any)["page.reader-grandchild"].firstMatch
        XCTAssertTrue(grandchild.waitForExistence(timeout: 10))
        expandChild.tap()
        XCTAssertFalse(grandchild.exists)
        let search = app.searchFields.firstMatch
        guard search.waitForExistence(timeout: 10) else {
            captureLaunchFailure(app, name: "hierarchy-search-missing")
            XCTFail("Search field missing"); return
        }
        search.tap()
        #if os(iOS)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        #endif
        search.typeText("qzx")
        XCTAssertTrue(app.descendants(matching: .any)["search-empty"].firstMatch.waitForExistence(timeout: 20))
        search.tap()
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 3))
        XCTAssertTrue(child.waitForExistence(timeout: 20))
        XCTAssertFalse(grandchild.exists)
        toggle.tap()
        toggle.tap()
        XCTAssertTrue(child.waitForExistence(timeout: 10))
        XCTAssertFalse(grandchild.exists)
        capture("personal-hierarchy-rtl", app: app)
    }
    @MainActor func testSubpageCycleDoesNotRepeatAnAncestor() {
        let app = XCUIApplication()
        app.launchArguments.append("--ui-testing-reader-fixture")
        app.launch()
        let list = app.descendants(matching: .any)["personal-page-list"].firstMatch
        guard list.waitForExistence(timeout: 30) else {
            captureLaunchFailure(app, name: "cycle-page-list-missing")
            XCTFail("Page list missing"); return
        }
        let start = app.descendants(matching: .any)["page.reader-cycle-a"].firstMatch
        for _ in 0..<8 {
            if start.exists && start.isHittable { break }
            #if os(macOS)
            let scrollTarget = app.scrollViews.firstMatch.exists ? app.scrollViews.firstMatch : app.outlines.firstMatch
            if scrollTarget.exists {
                scrollTarget.scroll(byDeltaX: 0, deltaY: -120)
            }
            #else
            list.swipeUp()
            #endif
        }
        guard start.exists && start.isHittable else {
            captureLaunchFailure(app, name: "cycle-start-missing")
            XCTFail("Cycle fixture page missing"); return
        }
        start.tap()
        let child = app.buttons["subpage.reader-cycle-b"]
        guard child.waitForExistence(timeout: 20) else {
            captureLaunchFailure(app, name: "cycle-child-missing")
            XCTFail("Cycle fixture child missing"); return
        }
        child.tap()
        XCTAssertTrue(app.staticTexts["Cycle page B"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["subpage.reader-cycle-a"].exists)
        let back = app.buttons["return-to-linked-page"]
        XCTAssertTrue(back.waitForExistence(timeout: 10))
        back.tap()
        XCTAssertTrue(child.waitForExistence(timeout: 20))
        capture("subpage-cycle-stopped", app: app)
    }
    @MainActor func testPersonalSubpagesNavigateAndReturn() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-reader-fixture", "--ui-testing-rtl", "--ui-testing-large-text"]
        app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        guard page.waitForExistence(timeout: 30) else {
            captureLaunchFailure(app, name: "subpage-fixture-missing")
            XCTFail("Parent page missing"); return
        }
        page.tap()
        let child = app.buttons["subpage.reader-child"]
        guard child.waitForExistence(timeout: 20) else {
            captureLaunchFailure(app, name: "subpage-link-missing")
            XCTFail("Personal subpage missing"); return
        }
        XCTAssertFalse(app.buttons["subpage.reader-archived-child"].exists)
        XCTAssertFalse(app.buttons["subpage.reader-shared-child"].exists)
        child.tap()
        XCTAssertTrue(app.staticTexts["Child content"].waitForExistence(timeout: 20))
        let grandchild = app.buttons["subpage.reader-grandchild"]
        guard grandchild.waitForExistence(timeout: 20) else {
            captureLaunchFailure(app, name: "subpage-grandchild-missing")
            XCTFail("Nested subpage missing"); return
        }
        grandchild.tap()
        XCTAssertTrue(app.staticTexts["Grandchild content"].waitForExistence(timeout: 20))
        let back = app.buttons["return-to-linked-page"]
        guard back.waitForExistence(timeout: 10) else {
            captureLaunchFailure(app, name: "subpage-return-missing")
            XCTFail("Return action missing"); return
        }
        back.tap()
        XCTAssertTrue(app.staticTexts["Child content"].waitForExistence(timeout: 20))
        back.tap()
        XCTAssertTrue(app.staticTexts["Hello Worlds"].waitForExistence(timeout: 20))
        XCTAssertTrue(child.exists)
        capture("personal-subpages-rtl-returned", app: app)
    }
    @MainActor
    func testOpeningScreen() throws {
        let app = XCUIApplication()
        app.launch()
        #if os(macOS)
        _ = app.windows.firstMatch.waitForExistence(timeout: 20)
        #endif
        XCTAssertTrue(app.staticTexts["Open your Worlds database"].waitForExistence(timeout: 20))
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
        prepareWindowTrace(app)
        app.launch()
        guard app.descendants(matching: .any)["page.search-personal"].firstMatch.waitForExistence(timeout: 20) else {
            captureLaunchFailure(app, name: "search-fixture-missing")
            XCTFail("Search fixture did not appear")
            throw FixtureLaunchError.unavailable
        }
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
        for _ in 0..<8 {
            if page.exists && page.isHittable { break }
            #if os(macOS)
            let scrollTarget = app.scrollViews.firstMatch.exists ? app.scrollViews.firstMatch : app.outlines.firstMatch
            if scrollTarget.exists {
                scrollTarget.scroll(byDeltaX: 0, deltaY: -120)
            }
            #else
            app.swipeUp()
            #endif
        }
        XCTAssertTrue(page.waitForExistence(timeout: 40)); page.tap()
        let quote = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "اقتباس عربي محفوظ ١٢٣", "اقتباس عربي محفوظ ١٢٣")).firstMatch
        let overflow = app.staticTexts["Overflow item"].firstMatch
        let reader = app.scrollViews["page-content"].firstMatch
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        for _ in 0..<4 {
            #if os(macOS)
            reader.scroll(byDeltaX: 0, deltaY: -120)
            #else
            reader.swipeUp()
            #endif
        }
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
        prepareWindowTrace(app)
        app.launch()
        #if os(macOS)
        _ = app.windows.firstMatch.waitForExistence(timeout: 20)
        #endif
        let page = app.descendants(matching: .any)["page.reader-fixture"].firstMatch
        for _ in 0..<8 {
            if page.exists && page.isHittable { break }
            #if os(macOS)
            let scrollTarget = app.scrollViews.firstMatch.exists ? app.scrollViews.firstMatch : app.outlines.firstMatch
            if scrollTarget.exists {
                scrollTarget.scroll(byDeltaX: 0, deltaY: -120)
            }
            #else
            app.swipeUp()
            #endif
        }
        guard page.waitForExistence(timeout: 40) else {
            captureLaunchFailure(app, name: "reader-fixture-missing")
            XCTFail("Reader fixture did not appear")
            throw FixtureLaunchError.unavailable
        }
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
            #if os(macOS)
            let scrollTarget = app.scrollViews.firstMatch.exists ? app.scrollViews.firstMatch : app.outlines.firstMatch
            if scrollTarget.exists {
                scrollTarget.scroll(byDeltaX: 0, deltaY: -120)
            }
            #else
            list.swipeUp()
            #endif
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
        if !description.isHittable {
            #if os(macOS)
            let scrollTarget = app.scrollViews.firstMatch.exists ? app.scrollViews.firstMatch : app.outlines.firstMatch
            if scrollTarget.exists {
                scrollTarget.scroll(byDeltaX: 0, deltaY: -120)
            }
            #else
            app.swipeUp()
            #endif
        }
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
        prepareWindowTrace(app)
        app.launch()
        #if os(macOS)
        guard app.windows.firstMatch.waitForExistence(timeout: 20) else {
            captureLaunchFailure(app, name: "resource-window-missing")
            XCTFail("Application window did not appear")
            throw FixtureLaunchError.unavailable
        }
        #endif
        let row = app.descendants(matching: .any)["page.\(id)"].firstMatch
        for _ in 0..<8 {
            if row.exists && row.isHittable { break }
            #if os(macOS)
            let scrollTarget = app.scrollViews.firstMatch.exists ? app.scrollViews.firstMatch : app.outlines.firstMatch
            if scrollTarget.exists {
                scrollTarget.scroll(byDeltaX: 0, deltaY: -120)
            }
            #else
            app.swipeUp()
            #endif
        }
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
        _ = app.windows.firstMatch.waitForExistence(timeout: 20)
        let dismiss = app.sheets.buttons["OK"].firstMatch.exists
            ? app.sheets.buttons["OK"].firstMatch
            : (app.dialogs.buttons["OK"].firstMatch.exists ? app.dialogs.buttons["OK"].firstMatch : app.buttons["OK"].firstMatch)
        #else
        let dismiss = app.alerts.buttons["OK"].firstMatch
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

    @MainActor
    func testShowcaseWorkspaceSectionsAndModals() throws {
        let app = XCUIApplication()
        app.launchArguments += [
            "--ui-testing-local-copy-fixture",
            "--ui-testing-presentation-fixture",
            "--ui-testing-automation-fixture",
            "--ui-testing-trash-fixture"
        ]
        app.launch()

        let homeButton = app.buttons["open-home-button"].firstMatch
        XCTAssertTrue(homeButton.waitForExistence(timeout: 30))
        homeButton.tap()
        XCTAssertTrue(app.staticTexts["Welcome to Worlds"].waitForExistence(timeout: 15))
        capture("showcase-01-home-dashboard", app: app)

        let templatesButton = app.buttons["open-templates-button"].firstMatch
        XCTAssertTrue(templatesButton.waitForExistence(timeout: 10))
        templatesButton.tap()
        XCTAssertTrue(app.staticTexts["Workspace Templates"].waitForExistence(timeout: 15))
        capture("showcase-02-templates-gallery", app: app)

        let trashButton = app.buttons["open-trash-button"].firstMatch
        XCTAssertTrue(trashButton.waitForExistence(timeout: 10))
        trashButton.tap()
        XCTAssertTrue(app.staticTexts["Archived architecture notes"].waitForExistence(timeout: 15))
        capture("showcase-03-trash-view", app: app)

        let assistantButton = app.buttons["open-assistant-button"].firstMatch
        XCTAssertTrue(assistantButton.waitForExistence(timeout: 10))
        assistantButton.tap()
        XCTAssertTrue(app.staticTexts["Worlds Intelligence"].waitForExistence(timeout: 15))
        capture("showcase-04-ai-assistant", app: app)
        let closeAssistant = app.buttons["close-assistant-button"].firstMatch
        XCTAssertTrue(closeAssistant.waitForExistence(timeout: 10))
        closeAssistant.tap()

        let accountButton = app.buttons["open-account-button"].firstMatch
        if accountButton.waitForExistence(timeout: 10) {
            accountButton.tap()
            let closeAccount = app.buttons["close-account-button"].firstMatch
            XCTAssertTrue(closeAccount.waitForExistence(timeout: 15))
            capture("showcase-05-account-view", app: app)
            closeAccount.tap()
        }

        let settingsButton = app.buttons["open-settings-button"].firstMatch
        XCTAssertTrue(settingsButton.waitForExistence(timeout: 10))
        settingsButton.tap()
        let closeSettings = app.buttons["close-settings-button"].firstMatch
        XCTAssertTrue(closeSettings.waitForExistence(timeout: 15))
        capture("showcase-06-settings-view", app: app)
        closeSettings.tap()

        homeButton.tap()
        let openAutomations = app.buttons["home-open-automations"].firstMatch
        if openAutomations.waitForExistence(timeout: 10) {
            openAutomations.tap()
            XCTAssertTrue(app.staticTexts["Fixture automation"].waitForExistence(timeout: 15))
            capture("showcase-10-automations-view", app: app)
        }
    }

    @MainActor
    func testShowcaseDrawingStudio() throws {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture"]
        app.launch()

        let drawingRow = app.descendants(matching: .any)["page.fixture-drawing"].firstMatch
        XCTAssertTrue(drawingRow.waitForExistence(timeout: 30))
        drawingRow.tap()

        let editDrawing = app.buttons["edit-local-drawing"].firstMatch
        XCTAssertTrue(editDrawing.waitForExistence(timeout: 20))
        editDrawing.tap()

        let canvas = app.descendants(matching: .any)["drawing-canvas"].firstMatch
        XCTAssertTrue(canvas.waitForExistence(timeout: 20))
        let start = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.28, dy: 0.35))
        let end = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.72, dy: 0.65))
        start.press(forDuration: 0.05, thenDragTo: end)
        capture("showcase-07-drawing-editor", app: app)
    }

    @MainActor
    func testShowcasePresentationEditor() throws {
        let app = XCUIApplication()
        app.launchArguments += [
            "--ui-testing-local-copy-fixture",
            "--ui-testing-presentation-fixture",
            "--ui-testing-presentation-shape"
        ]
        app.launch()

        let deckRow = app.descendants(matching: .any)["page.deck-test"].firstMatch
        XCTAssertTrue(deckRow.waitForExistence(timeout: 30))
        deckRow.tap()

        let editPresentation = app.buttons["edit-local-presentation"].firstMatch
        XCTAssertTrue(editPresentation.waitForExistence(timeout: 20))
        editPresentation.tap()

        XCTAssertTrue(app.staticTexts["First slide"].waitForExistence(timeout: 20))
        capture("showcase-08-presentation-editor", app: app)
    }

    @MainActor
    func testShowcasePageAndTableEditor() throws {
        let app = XCUIApplication()
        app.launchArguments += [
            "--ui-testing-local-copy-fixture",
            "--ui-testing-document-table-insert"
        ]
        app.launch()

        let pageRow = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(pageRow.waitForExistence(timeout: 30))
        pageRow.tap()

        let editPage = app.buttons["edit-local-page"].firstMatch
        XCTAssertTrue(editPage.waitForExistence(timeout: 20))
        editPage.tap()

        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 20))
        capture("showcase-09-page-editor", app: app)
    }

    @MainActor
    func testCompleteVisualShowcaseCaptures() throws {
        let app = XCUIApplication()
        app.launchArguments += [
            "-AppleInterfaceStyle", "Dark",
            "--ui-testing-local-copy-fixture",
            "--ui-testing-presentation-fixture",
            "--ui-testing-automation-fixture",
            "--ui-testing-trash-fixture",
            "--ui-testing-complete-showcase",
            "--ui-testing-dark"
        ]
        app.launch()
        RunLoop.current.run(until: Date().addingTimeInterval(8))
        let launchShot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        launchShot.name = "debug-00-launch-state"; launchShot.lifetime = .keepAlways; add(launchShot)

        // 01 Home Dashboard
        activateNavigation(shortcut: "1", pillID: "open-home-button", app: app)
        capture("complete-01-home-dashboard", app: app)

        // 02 Spreadsheet Studio (Excel-grade)
        activateNavigation(shortcut: "4", pillID: "open-spreadsheets-button", quickActionID: "home-open-spreadsheets", pageID: "page.showcase-sheet-q4", app: app)
        capture("complete-02-spreadsheet-excel", app: app)

        // 03 Mind Maps & Templates
        activateNavigation(shortcut: "2", pillID: "open-templates-button", pageID: "page.showcase-mindmap-arch", app: app)
        capture("complete-03-mindmap-templates", app: app)

        // 04 Planning & OKRs Hub
        activateNavigation(shortcut: "5", pillID: "open-planning-button", quickActionID: "home-open-planning", pageID: "page.showcase-okr-roadmap", app: app)
        capture("complete-04-planning-tasks-goals", app: app)

        // 05 Opt-in Academic Study Pack Hub
        activateNavigation(shortcut: "6", pillID: "open-study-button", quickActionID: "home-open-study", pageID: "page.showcase-study-cs301", app: app)
        capture("complete-05-study-pack-hub", app: app)

        // 06 Creative 3D CAD & Slides Studio
        activateNavigation(shortcut: "7", pillID: "open-studio-button", quickActionID: "home-open-studio", pageID: "page.showcase-cad-turbine", app: app)
        capture("complete-06-creative-3d-studio", app: app)

        // 07 Worlds Intelligence AI Assistant Modal
        #if os(macOS)
        app.typeKey("a", modifierFlags: [.command, .option])
        #else
        let assistantButton = app.buttons["open-assistant-button"].firstMatch
        if assistantButton.waitForExistence(timeout: 5) { assistantButton.tap() }
        #endif
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        capture("complete-07-ai-assistant", app: app)
        let closeAssistant = app.buttons["close-assistant-button"].firstMatch
        if closeAssistant.waitForExistence(timeout: 5) {
            #if os(macOS)
            closeAssistant.click()
            #else
            closeAssistant.tap()
            #endif
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }

        // 08 Settings & Feature Packs Modal
        #if os(macOS)
        app.typeKey(",", modifierFlags: .command)
        #else
        let settingsButton = app.buttons["open-settings-button"].firstMatch
        if settingsButton.waitForExistence(timeout: 5) { settingsButton.tap() }
        #endif
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        capture("complete-08-settings-packs", app: app)
        let closeSettings = app.buttons["close-settings-button"].firstMatch
        if closeSettings.waitForExistence(timeout: 5) {
            #if os(macOS)
            closeSettings.click()
            #else
            closeSettings.tap()
            #endif
        }
    }

    @MainActor
    private func activateNavigation(shortcut: String?, pillID: String, quickActionID: String? = nil, pageID: String? = nil, app: XCUIApplication) {
        #if os(macOS)
        if let shortcut {
            app.typeKey(shortcut, modifierFlags: [.command, .option])
            RunLoop.current.run(until: Date().addingTimeInterval(1.2))
            return
        }
        #endif
        if let quickActionID {
            let quick = app.buttons[quickActionID].firstMatch
            if quick.waitForExistence(timeout: 2) && quick.isHittable {
                #if os(macOS)
                quick.click()
                #else
                quick.tap()
                #endif
                RunLoop.current.run(until: Date().addingTimeInterval(1.2))
                return
            }
        }
        let pill = app.buttons[pillID].firstMatch
        if pill.waitForExistence(timeout: 5) && pill.isHittable {
            #if os(macOS)
            pill.click()
            #else
            pill.tap()
            #endif
            RunLoop.current.run(until: Date().addingTimeInterval(1.2))
            return
        }
        if let pageID {
            let page = app.descendants(matching: .any)[pageID].firstMatch
            if page.waitForExistence(timeout: 5) {
                #if os(macOS)
                page.click()
                #else
                page.tap()
                #endif
                RunLoop.current.run(until: Date().addingTimeInterval(1.2))
            }
        }
    }
    @MainActor
    private func captureLaunchFailure(_ app: XCUIApplication, name: String) {
        let state = XCTAttachment(string: "state=\(app.state.rawValue) windows=\(app.windows.count)\n\(app.debugDescription)")
        state.name = name + "-state-and-hierarchy"; state.lifetime = .keepAlways; add(state)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name + "-screen"; screenshot.lifetime = .keepAlways; add(screenshot)
        #if os(macOS)
        if let raw = app.launchEnvironment["WORLDS_WINDOW_TRACE_TOKEN"], let token = UUID(uuidString: raw),
           let directoryFD = traceDirectoryFDs[token.uuidString] {
            let fd = openat(directoryFD, "lifecycle.log", O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
            var text = "Window trace unavailable."
            if fd >= 0 {
                var info = stat()
                if fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
                   info.st_uid == getuid(), info.st_nlink == 1, (info.st_mode & 0o077) == 0,
                   info.st_size >= 0, info.st_size <= 16_384 {
                    var bytes = [UInt8](repeating: 0, count: 16_385)
                    let count = bytes.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
                    if count >= 0, count <= 16_384, let decoded = String(bytes: bytes.prefix(count), encoding: .utf8),
                       isSafeWindowTrace(decoded) {
                        text = decoded
                    }
                }
                Darwin.close(fd)
            }
            let trace = XCTAttachment(string: text)
            trace.name = name + "-window-lifecycle"; trace.lifetime = .keepAlways; add(trace)
        }
        #endif
    }
    #if os(macOS)
    private func isSafeWindowTrace(_ text: String) -> Bool {
        let names = "(?:willFinishLaunching|didFinishLaunching|sample-[1-9][0-9]?|NSWindowDidBecomeKeyNotification|NSWindowDidResignKeyNotification|NSWindowWillCloseNotification|NSWindowDidMiniaturizeNotification|NSApplicationDidHideNotification|NSApplicationDidUnhideNotification)"
        let window = "visible=(?:true|false),miniaturized=(?:true|false),key=(?:true|false)"
        let pattern = "^\(names) active=(?:true|false) hidden=(?:true|false) modal=(?:true|false) windows=[0-9]{1,3} \\[(?:\(window)(?:;\(window))*)?\\]$"
        let lines = text.split(separator: "\n", omittingEmptySubsequences: true)
        guard !lines.isEmpty, lines.count <= 128 else { return false }
        return lines.allSatisfy { line in
            line.utf8.count <= 2_048 && String(line).range(of: pattern, options: .regularExpression) != nil
        }
    }
    #endif
    @MainActor
    private func prepareWindowTrace(_ app: XCUIApplication) {
        #if os(macOS)
        let token = UUID()
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("worlds-window-trace-\(token.uuidString)", isDirectory: true)
        guard Darwin.mkdir(directory.path, mode_t(0o700)) == 0 else { return }
        var original = stat()
        guard lstat(directory.path, &original) == 0, (original.st_mode & S_IFMT) == S_IFDIR,
              original.st_uid == getuid() else { return }
        let directoryFD = Darwin.open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directoryFD >= 0 else { return }
        var opened = stat()
        guard fstat(directoryFD, &opened) == 0, opened.st_dev == original.st_dev,
              opened.st_ino == original.st_ino, opened.st_uid == getuid() else {
            Darwin.close(directoryFD); return
        }
        let device = original.st_dev, inode = original.st_ino
        traceDirectoryFDs[token.uuidString] = directoryFD
        app.launchEnvironment["WORLDS_WINDOW_TRACE_TOKEN"] = token.uuidString
        addTeardownBlock {
            let fd = openat(directoryFD, "lifecycle.log", O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
            if fd >= 0 {
                var openedFile = stat(), currentFile = stat()
                if fstat(fd, &openedFile) == 0, (openedFile.st_mode & S_IFMT) == S_IFREG,
                   openedFile.st_uid == getuid(), openedFile.st_nlink == 1, (openedFile.st_mode & 0o077) == 0,
                   openedFile.st_size >= 0, openedFile.st_size <= 16_384,
                   fstatat(directoryFD, "lifecycle.log", &currentFile, AT_SYMLINK_NOFOLLOW) == 0,
                   currentFile.st_dev == openedFile.st_dev, currentFile.st_ino == openedFile.st_ino {
                    _ = unlinkat(directoryFD, "lifecycle.log", 0)
                }
                Darwin.close(fd)
            }
            Darwin.close(directoryFD)
            var current = stat()
            guard lstat(directory.path, &current) == 0, (current.st_mode & S_IFMT) == S_IFDIR,
                  current.st_uid == getuid(), current.st_dev == device, current.st_ino == inode else { return }
            _ = rmdir(directory.path)
        }
        #endif
    }
    private enum FixtureLaunchError: Error { case unavailable }
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
