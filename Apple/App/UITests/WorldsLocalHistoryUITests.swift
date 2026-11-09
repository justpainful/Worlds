#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_LOCAL_HISTORY
import XCTest

final class WorldsLocalHistoryUITests: XCTestCase {
    @MainActor func testHistoryReadFailureIsNotShownAsEmpty() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-history-unavailable"]
        app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        guard page.waitForExistence(timeout: 30) else { capture(app, "history-error-page-missing"); XCTFail("Fixture page missing"); return }
        page.tap()
        let open = app.buttons["open-local-history"]
        guard open.waitForExistence(timeout: 20) else { capture(app, "history-error-action-missing"); XCTFail("History action missing"); return }
        open.tap()
        let error = app.descendants(matching: .any)["local-history-error"].firstMatch
        guard error.waitForExistence(timeout: 20) else { capture(app, "history-error-missing"); XCTFail("Read failure was not displayed"); return }
        XCTAssertFalse(app.descendants(matching: .any)["local-history-empty"].exists)
        capture(app, "history-read-error")
    }

    @MainActor func testPersonalHistoryAndEmptyPageInRTL() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-history-fixture", "--ui-testing-rtl", "--ui-testing-large-text"]
        app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        guard page.waitForExistence(timeout: 30) else { capture(app, "history-page-missing"); XCTFail("Fixture page missing"); return }
        page.tap()
        let open = app.buttons["open-local-history"]
        guard open.waitForExistence(timeout: 20) else { capture(app, "history-action-missing"); XCTFail("History action missing"); return }
        open.tap()
        let list = app.descendants(matching: .any)["local-history-list"].firstMatch
        guard list.waitForExistence(timeout: 20) else { capture(app, "history-list-missing"); XCTFail("History list missing"); return }
        XCTAssertTrue(app.staticTexts["تعديل تجريبي"].exists || app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "تعديل تجريبي")).firstMatch.exists)
        XCTAssertTrue(app.staticTexts["Renamed fixture"].exists || app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Renamed fixture")).firstMatch.exists)
        capture(app, "history-personal-rtl")
        app.buttons["Close"].tap()
        #if os(iOS)
        let showPages = app.navigationBars.buttons["Pages"].firstMatch
        if showPages.exists { showPages.tap() }
        #endif
        let project = app.descendants(matching: .any)["page.harness-project"].firstMatch
        for _ in 0..<8 {
            if project.exists && project.isHittable { break }
            #if os(macOS)
            let scrollTarget = app.scrollViews.firstMatch.exists ? app.scrollViews.firstMatch : app.outlines.firstMatch
            if scrollTarget.exists { scrollTarget.scroll(byDeltaX: 0, deltaY: -120) }
            #else
            app.swipeUp()
            #endif
        }
        guard project.waitForExistence(timeout: 20) else { capture(app, "history-empty-page-missing"); XCTFail("Second page missing"); return }
        project.tap()
        guard open.waitForExistence(timeout: 20) else { capture(app, "history-empty-action-missing"); XCTFail("History action missing"); return }
        open.tap()
        guard app.descendants(matching: .any)["local-history-empty"].firstMatch.waitForExistence(timeout: 20) else {
            capture(app, "history-empty-missing"); XCTFail("Empty history state missing"); return
        }
        capture(app, "history-empty-rtl")
    }

    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription); hierarchy.name = name + "-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }
}
#endif
