#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_MOVE_PAGE
import XCTest

final class WorldsLocalMovePageUITests: XCTestCase {
    @MainActor func testMoveReopensAndRejectsOwnDescendant() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-move-fixture", "--ui-testing-rtl"]
        app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        guard page.waitForExistence(timeout: 30) else { capture(app, "move-page-missing"); XCTFail("Fixture page missing"); return }
        page.tap()
        let action = app.buttons["move-local-page"]
        guard action.waitForExistence(timeout: 20) else { capture(app, "move-action-missing"); XCTFail("Move action missing"); return }
        action.tap()
        let destination = app.buttons["move-destination.move-destination"]
        guard destination.waitForExistence(timeout: 20) else { capture(app, "move-destination-missing"); XCTFail("Destination missing"); return }
        XCTAssertFalse(app.buttons["move-destination.move-child"].exists, "A descendant cannot be a destination")
        let boundary = app.staticTexts["move-fixture-depth-boundary"]
        guard boundary.waitForExistence(timeout: 20) else { capture(app, "move-boundary-missing"); XCTFail("Depth boundary missing"); return }
        XCTAssertEqual(boundary.label, "Deep boundary: true false", "The last allowed and first rejected destination must match the store limit")
        destination.tap()
        app.buttons["move-confirm"].tap()
        let status = app.staticTexts["move-status"]
        guard status.waitForExistence(timeout: 30) else { capture(app, "move-status-missing"); XCTFail("Move status missing"); return }
        XCTAssertEqual(status.label, "Page moved. The previous position cannot be restored here.")
        app.buttons["Close"].tap()
        #if os(iOS)
        let showPages = app.navigationBars.buttons["Pages"].firstMatch
        if showPages.exists { showPages.tap() }
        #endif
        let menu = app.buttons["Local copies"]
        guard menu.waitForExistence(timeout: 15) else { capture(app, "move-copy-menu-missing"); XCTFail("Local copies menu missing"); return }
        menu.tap()
        let open = app.buttons["Open local copy"]
        guard open.waitForExistence(timeout: 10) else { XCTFail("Open local copy missing"); return }
        open.tap()
        let copies = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Local copy "))
        guard copies.firstMatch.waitForExistence(timeout: 20), copies.count == 1 else { XCTFail("Expected one isolated copy"); return }
        copies.firstMatch.tap()
        guard app.staticTexts["Select a page"].waitForExistence(timeout: 30) else { capture(app, "move-reopen-missing"); XCTFail("Copy did not reopen"); return }
        let parent = app.descendants(matching: .any)["page.move-destination"].firstMatch
        guard parent.waitForExistence(timeout: 20) else { XCTFail("Destination page missing"); return }
        parent.tap()
        XCTAssertTrue(app.buttons["subpage.fixture-page"].waitForExistence(timeout: 20), "Moved page must be a child after reopening")
        capture(app, "move-page-reopened")
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = name + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }
}
#endif
