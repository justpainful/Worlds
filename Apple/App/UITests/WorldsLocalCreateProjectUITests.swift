#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_CREATE_PROJECT
import XCTest

final class WorldsLocalCreateProjectUITests: XCTestCase {
    @MainActor func testCreateEditAndReopenPersonalProject() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-rtl", "--ui-testing-large-text"]
        app.launch()
        let notice = app.descendants(matching: .any)["local-copy-notice"].firstMatch
        _ = notice.waitForExistence(timeout: 30)
        #if os(iOS)
        let initialPages = app.navigationBars.buttons["Pages"].firstMatch
        if initialPages.exists { initialPages.tap() }
        let initialSidebar = app.navigationBars.buttons["ToggleSidebar"].firstMatch
        if initialSidebar.exists && !app.buttons["new-local-project"].exists { initialSidebar.tap() }
        #endif
        let newPage = app.buttons["new-local-project"]
        guard newPage.waitForExistence(timeout: 30) else { capture(app, "create-action-missing"); XCTFail("New project action missing"); return }
        newPage.tap()
        let title = app.textFields["new-personal-project-title"]
        guard title.waitForExistence(timeout: 15) else { capture(app, "create-title-missing"); XCTFail("Title field missing"); return }
        title.tap()
        title.typeText("Personal test project")
        let create = app.buttons["create-personal-project"]
        guard create.waitForExistence(timeout: 10), create.isEnabled else { capture(app, "create-disabled"); XCTFail("Create action is unavailable"); return }
        create.tap()
        let page = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Personal test project")).firstMatch
        guard page.waitForExistence(timeout: 30) else { capture(app, "created-page-missing"); XCTFail("Created page did not open"); return }
        XCTAssertFalse(title.exists, "The creation sheet must close after opening the page")
        XCTAssertTrue(app.descendants(matching: .any)["resource-content"].waitForExistence(timeout: 20), "The newly created page must open")
        let edit = app.buttons["edit-local-project"]
        guard edit.waitForExistence(timeout: 20) else { capture(app, "create-project-edit-missing"); XCTFail("Project editor missing"); return }
        edit.tap()
        let description = app.descendants(matching: .any)["project-description"].firstMatch
        guard description.waitForExistence(timeout: 20) else { capture(app, "create-project-description-missing"); XCTFail("Project description missing"); return }
        description.tap()
        #if os(iOS)
        guard app.keyboards.firstMatch.waitForExistence(timeout: 15) else { capture(app, "create-project-keyboard-missing"); XCTFail("Keyboard missing"); return }
        #endif
        description.typeText("Fixture description")
        app.buttons["Save"].tap()
        guard app.staticTexts["project-saved"].waitForExistence(timeout: 20) else { capture(app, "create-project-save-missing"); XCTFail("Project save missing"); return }
        app.buttons["Close"].tap()
        capture(app, "created-page")
        #if os(iOS)
        let showPages = app.navigationBars.buttons["Pages"].firstMatch
        if showPages.exists { showPages.tap() }
        #endif
        let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "page.", "Personal test project"))
        guard rows.firstMatch.waitForExistence(timeout: 20), rows.count == 1 else { capture(app, "create-initial-count"); XCTFail("Created page must appear exactly once"); return }
        let createdID = rows.firstMatch.identifier
        #if os(macOS)
        let appWindow = app.windows.firstMatch
        if appWindow.exists { appWindow.click() }
        #endif
        let menu = app.buttons["Local copies"].exists ? app.buttons["Local copies"] : app.descendants(matching: .any)["Local copies"].firstMatch
        guard menu.waitForExistence(timeout: 20) else { capture(app, "create-copy-menu-missing"); XCTFail("Local copies menu missing"); return }
        menu.tap()
        let open = app.buttons["Open local copy"]
        guard open.waitForExistence(timeout: 10) else { capture(app, "create-copy-open-missing"); XCTFail("Open local copy missing"); return }
        open.tap()
        let copies = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Local copy "))
        guard copies.firstMatch.waitForExistence(timeout: 20), copies.count == 1 else { capture(app, "create-copy-picker"); XCTFail("Expected exactly one isolated fixture copy"); return }
        copies.firstMatch.tap()
        let selectPage = app.staticTexts["Select a page"]
        let reopened = app.descendants(matching: .any)[createdID].firstMatch
        guard selectPage.waitForExistence(timeout: 30) || reopened.waitForExistence(timeout: 30) else { capture(app, "create-copy-reopen-incomplete"); XCTFail("The copy did not finish reopening"); return }
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
        XCTAssertTrue(app.descendants(matching: .any)["resource-content"].waitForExistence(timeout: 20), "The persisted page must reopen")
        guard edit.waitForExistence(timeout: 20) else { XCTFail("Project editor missing after reopen"); return }
        edit.tap()
        guard description.waitForExistence(timeout: 20) else { XCTFail("Project description missing after reopen"); return }
        XCTAssertEqual(description.value as? String, "Fixture description")
        capture(app, "created-page-reopened")
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = name + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }
}
#endif
