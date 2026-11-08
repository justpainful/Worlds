#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_CREATE_STREAM
import XCTest

final class WorldsLocalCreateStreamUITests: XCTestCase {
    @MainActor func testCreateAndReopenDASHStream() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-rtl", "--ui-testing-large-text"]
        app.launch()
        let newPage = app.buttons["new-local-stream"]
        guard newPage.waitForExistence(timeout: 30) else { capture(app, "create-action-missing"); XCTFail("New stream action missing"); return }
        newPage.tap()
        let title = app.textFields["new-personal-stream-url"]
        guard title.waitForExistence(timeout: 15) else { capture(app, "create-title-missing"); XCTFail("Title field missing"); return }
        title.tap()
        title.typeText("https://example.invalid/video.mpd")
        let create = app.buttons["create-personal-stream"]
        guard create.waitForExistence(timeout: 10), create.isEnabled else { capture(app, "create-disabled"); XCTFail("Create action is unavailable"); return }
        create.tap()
        let page = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "video.mpd")).firstMatch
        guard page.waitForExistence(timeout: 30) else { capture(app, "created-page-missing"); XCTFail("Created page did not open"); return }
        XCTAssertFalse(title.exists, "The creation sheet must close after opening the page")
        XCTAssertTrue(app.descendants(matching: .any)["resource-content"].waitForExistence(timeout: 20), "The newly created page must open")
        XCTAssertTrue(app.staticTexts["external-stream-dash"].waitForExistence(timeout: 10))
        capture(app, "created-page")
        #if os(iOS)
        let showPages = app.navigationBars.buttons["Pages"].firstMatch
        if showPages.exists { showPages.tap() }
        #endif
        let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "page.", "video.mpd"))
        guard rows.firstMatch.waitForExistence(timeout: 20), rows.count == 1 else { capture(app, "create-initial-count"); XCTFail("Created page must appear exactly once"); return }
        let createdID = rows.firstMatch.identifier
        let menu = app.buttons["Local copies"]
        guard menu.waitForExistence(timeout: 15) else { capture(app, "create-copy-menu-missing"); XCTFail("Local copies menu missing"); return }
        menu.tap()
        let open = app.buttons["Open local copy"]
        guard open.waitForExistence(timeout: 10) else { capture(app, "create-copy-open-missing"); XCTFail("Open local copy missing"); return }
        open.tap()
        let copies = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Local copy "))
        guard copies.firstMatch.waitForExistence(timeout: 20), copies.count == 1 else { capture(app, "create-copy-picker"); XCTFail("Expected exactly one isolated fixture copy"); return }
        copies.firstMatch.tap()
        guard app.staticTexts["Select a page"].waitForExistence(timeout: 30) else { capture(app, "create-copy-reopen-incomplete"); XCTFail("The copy did not finish reopening"); return }
        let reopened = app.descendants(matching: .any)[createdID].firstMatch
        guard reopened.waitForExistence(timeout: 30) else { capture(app, "create-reopen-missing"); XCTFail("Created page missing after reopening the copy"); return }
        XCTAssertEqual(rows.count, 1, "Reopening the same copy must retain exactly one created page")
        reopened.tap()
        XCTAssertTrue(app.descendants(matching: .any)["resource-content"].waitForExistence(timeout: 20), "The persisted page must reopen")
        XCTAssertTrue(app.staticTexts["external-stream-dash"].waitForExistence(timeout: 10))
        capture(app, "created-page-reopened")
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = name + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }
}
#endif
