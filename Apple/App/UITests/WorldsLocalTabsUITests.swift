#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PERSONAL_TABS
import XCTest

final class WorldsLocalTabsUITests: XCTestCase {
    @MainActor func testClosingInactiveTabKeepsCurrentReturnPath() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-tabs-links"]
        app.launch()
        let first = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        guard first.waitForExistence(timeout: 30) else { capture(app, "tabs-return-first-missing"); XCTFail("First page missing"); return }
        first.tap()
        guard app.buttons["personal-tab.fixture-page"].waitForExistence(timeout: 20) else { capture(app, "tabs-return-first-tab-missing"); XCTFail("First tab missing"); return }
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
        guard project.waitForExistence(timeout: 20) else { capture(app, "tabs-return-project-missing"); XCTFail("Project missing"); return }
        #if os(macOS)
        project.rightClick()
        #else
        project.press(forDuration: 1)
        #endif
        let action = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Open in new tab")).firstMatch
        guard action.waitForExistence(timeout: 10) else { capture(app, "tabs-return-open-missing"); XCTFail("Open in new tab missing"); return }
        action.tap()
        let link = app.buttons["resource-page.fixture-page"]
        guard link.waitForExistence(timeout: 20) else { capture(app, "tabs-return-link-missing"); XCTFail("Project link missing"); return }
        link.tap()
        let back = app.buttons["return-to-linked-page"]
        guard back.waitForExistence(timeout: 20) else { capture(app, "tabs-return-action-missing"); XCTFail("Return action missing"); return }
        let inactiveClose = app.buttons["close-personal-tab.harness-project"]
        guard inactiveClose.waitForExistence(timeout: 10) else { capture(app, "tabs-return-close-missing"); XCTFail("Inactive tab close missing"); return }
        inactiveClose.tap()
        XCTAssertTrue(back.exists, "Closing an inactive tab must retain the active return path")
        back.tap()
        XCTAssertTrue(app.staticTexts["Original fixture"].waitForExistence(timeout: 20))
        capture(app, "tabs-return-preserved")
    }
    @MainActor func testOpenSwitchAndClosePersonalTabsInRTL() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-rtl", "--ui-testing-large-text"]
        app.launch()
        let first = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        guard first.waitForExistence(timeout: 30) else { capture(app, "tabs-first-missing"); XCTFail("First personal page missing"); return }
        first.tap()
        let firstTab = app.buttons["personal-tab.fixture-page"]
        guard firstTab.waitForExistence(timeout: 20) else { capture(app, "tabs-first-tab-missing"); XCTFail("First tab missing"); return }
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
        guard project.waitForExistence(timeout: 20) else { capture(app, "tabs-project-missing"); XCTFail("Project page missing"); return }
        #if os(macOS)
        project.rightClick()
        #else
        project.press(forDuration: 1)
        #endif
        let action = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Open in new tab")).firstMatch
        guard action.waitForExistence(timeout: 10) else { capture(app, "tabs-context-missing"); XCTFail("Open in new tab action missing"); return }
        action.tap()
        let projectTab = app.buttons["personal-tab.harness-project"]
        guard projectTab.waitForExistence(timeout: 20) else { capture(app, "tabs-project-tab-missing"); XCTFail("Project tab missing"); return }
        XCTAssertTrue(firstTab.exists)
        firstTab.tap()
        XCTAssertTrue(app.staticTexts["Hello Worlds"].waitForExistence(timeout: 20))
        projectTab.tap()
        XCTAssertTrue(app.staticTexts["Original fixture"].waitForExistence(timeout: 20))
        let close = app.buttons["close-personal-tab.harness-project"]
        guard close.waitForExistence(timeout: 10) else { capture(app, "tabs-close-missing"); XCTFail("Close action missing"); return }
        close.tap()
        XCTAssertFalse(projectTab.exists)
        XCTAssertTrue(app.staticTexts["Hello Worlds"].waitForExistence(timeout: 20))
        capture(app, "personal-tabs-rtl")
    }

    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = name + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }
}
#endif
