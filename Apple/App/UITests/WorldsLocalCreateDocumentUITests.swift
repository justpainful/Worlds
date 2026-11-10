#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_CREATE_DOCUMENT
import XCTest

final class WorldsLocalCreateDocumentUITests: XCTestCase {
    @MainActor func testCreateAndReopenPersonalDocument() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-rtl", "--ui-testing-large-text"]
        app.launch()
        let notice = app.descendants(matching: .any)["local-copy-notice"].firstMatch
        _ = notice.waitForExistence(timeout: 30)
        #if os(iOS)
        let initialPages = app.navigationBars.buttons["Pages"].firstMatch
        if initialPages.exists { initialPages.tap() }
        let initialSidebar = app.navigationBars.buttons["ToggleSidebar"].firstMatch
        if initialSidebar.exists && !app.buttons["new-local-document"].exists { initialSidebar.tap() }
        #endif
        let newPage = app.buttons["new-local-document"]
        guard newPage.waitForExistence(timeout: 30) else { capture(app, "create-action-missing"); XCTFail("New document action missing"); return }
        newPage.tap()
        let title = app.textFields["new-personal-document-title"]
        guard title.waitForExistence(timeout: 15) else { capture(app, "create-title-missing"); XCTFail("Title field missing"); return }
        title.tap()
        title.typeText("Personal test document")
        let create = app.buttons["create-personal-document"]
        guard create.waitForExistence(timeout: 10), create.isEnabled else { capture(app, "create-disabled"); XCTFail("Create action is unavailable"); return }
        create.tap()
        let page = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Personal test document")).firstMatch
        guard page.waitForExistence(timeout: 30) else { capture(app, "created-page-missing"); XCTFail("Created page did not open"); return }
        XCTAssertFalse(title.exists, "The creation sheet must close after opening the page")
        XCTAssertTrue(app.descendants(matching: .any)["page-content"].waitForExistence(timeout: 20), "The newly created page must open")
        XCTAssertTrue(app.staticTexts["document-preview-limit"].waitForExistence(timeout: 10))
        capture(app, "created-page")
        #if os(iOS)
        let showPages = app.navigationBars.buttons["Pages"].firstMatch
        if showPages.exists { showPages.tap() }
        #endif
        let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "page.", "Personal test document"))
        guard rows.firstMatch.waitForExistence(timeout: 20), rows.count == 1 else { capture(app, "create-initial-count"); XCTFail("Created page must appear exactly once"); return }
        let createdID = rows.firstMatch.identifier
        #if os(macOS)
        let appWindow = app.windows.firstMatch
        if appWindow.exists { appWindow.click() }
        #endif
        let menu = app.buttons["Local copies"].exists ? app.buttons["Local copies"] : app.descendants(matching: .any)["Local copies"].firstMatch
        guard menu.waitForExistence(timeout: 15) else { capture(app, "create-copy-menu-missing"); XCTFail("Local copies menu missing"); return }
        menu.tap()
        let open = app.buttons["Open local copy"]
        guard open.waitForExistence(timeout: 10) else { capture(app, "create-copy-open-missing"); XCTFail("Open local copy missing"); return }
        open.tap()
        let copies = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Local copy "))
        guard copies.firstMatch.waitForExistence(timeout: 20), copies.count == 1 else { capture(app, "create-copy-picker"); XCTFail("Expected exactly one isolated fixture copy"); return }
        copies.firstMatch.tap()
        let selectPage = app.staticTexts["Select a page"]
        guard selectPage.waitForExistence(timeout: 30) || app.descendants(matching: .any)[createdID].firstMatch.waitForExistence(timeout: 30) else { capture(app, "create-copy-reopen-incomplete"); XCTFail("The copy did not finish reopening"); return }
        let reopened = app.descendants(matching: .any)[createdID].firstMatch
        #if os(iOS)
        let showPagesReopened = app.navigationBars.buttons["Pages"].firstMatch
        if showPagesReopened.exists { showPagesReopened.tap() }
        #endif
        for _ in 0..<8 {
            if reopened.exists && reopened.isHittable { break }
            #if os(macOS)
            let scrollTarget = app.scrollViews.firstMatch.exists ? app.scrollViews.firstMatch : app.outlines.firstMatch
            if scrollTarget.exists { scrollTarget.scroll(byDeltaX: 0, deltaY: -120) }
            #else
            app.swipeUp()
            #endif
        }
        guard reopened.waitForExistence(timeout: 30) else { capture(app, "create-reopen-missing"); XCTFail("Created page missing after reopening the copy"); return }
        XCTAssertEqual(rows.count, 1, "Reopening the same copy must retain exactly one created page")
        reopened.tap()
        XCTAssertTrue(app.descendants(matching: .any)["page-content"].waitForExistence(timeout: 20), "The persisted page must reopen")
        capture(app, "created-page-reopened")
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = name + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }
}
#endif
