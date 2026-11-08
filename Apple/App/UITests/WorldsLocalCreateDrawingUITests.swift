#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_CREATE_DRAWING && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
import XCTest

final class WorldsLocalCreateDrawingUITests: XCTestCase {
    @MainActor func testCreateDrawAndReopen() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-rtl", "--ui-testing-large-text"]
        app.launch()
        let newPage = app.buttons["new-local-drawing"]
        guard newPage.waitForExistence(timeout: 30) else { capture(app, "create-action-missing"); XCTFail("New drawing action missing"); return }
        newPage.tap()
        let title = app.textFields["new-personal-drawing-title"]
        guard title.waitForExistence(timeout: 15) else { capture(app, "create-title-missing"); XCTFail("Title field missing"); return }
        title.tap()
        title.typeText("Personal test drawing")
        let create = app.buttons["create-personal-drawing"]
        guard create.waitForExistence(timeout: 10), create.isEnabled else { capture(app, "create-disabled"); XCTFail("Create action is unavailable"); return }
        create.tap()
        let page = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Personal test drawing")).firstMatch
        guard page.waitForExistence(timeout: 30) else { capture(app, "created-page-missing"); XCTFail("Created page did not open"); return }
        XCTAssertFalse(title.exists, "The creation sheet must close after opening the page")
        XCTAssertTrue(app.descendants(matching: .any)["page-content"].waitForExistence(timeout: 20), "The newly created page must open")
        let edit = app.buttons["edit-local-drawing"]
        guard edit.waitForExistence(timeout: 20) else { capture(app, "create-project-edit-missing"); XCTFail("Drawing editor missing"); return }
        edit.tap()
        let status = app.staticTexts["drawing-status"]
        guard status.waitForExistence(timeout: 20) else { capture(app, "created-drawing-status-missing"); XCTFail("Drawing status missing"); return }
        let initial = NSPredicate(format: "label CONTAINS %@", "Saved revision 0")
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: initial, object: status)], timeout: 20) == .completed else { capture(app, "created-drawing-initial-missing"); XCTFail("Initial drawing did not load"); return }
        let surface = app.otherElements["drawing-surface"]
        guard surface.waitForExistence(timeout: 15) else { capture(app, "created-drawing-surface-missing"); XCTFail("Drawing surface missing"); return }
        let start = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.10))
        let end = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.20))
        start.press(forDuration: 0.1, thenDragTo: end)
        let saved = NSPredicate(format: "label CONTAINS %@", "Saved revision 1, strokes 1")
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: saved, object: status)], timeout: 30) == .completed else { capture(app, "created-drawing-save-missing"); XCTFail("Stroke did not save"); return }
        app.buttons["close-drawing-editor"].tap()
        capture(app, "created-page")
        #if os(iOS)
        let showPages = app.navigationBars.buttons["Pages"].firstMatch
        if showPages.exists { showPages.tap() }
        #endif
        let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "page.", "Personal test drawing"))
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
        XCTAssertTrue(app.descendants(matching: .any)["page-content"].waitForExistence(timeout: 20), "The persisted page must reopen")
        guard edit.waitForExistence(timeout: 20) else { XCTFail("Drawing editor missing after reopen"); return }
        edit.tap()
        guard status.waitForExistence(timeout: 20) else { XCTFail("Drawing status missing after reopen"); return }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: saved, object: status)], timeout: 20), .completed)
        capture(app, "created-page-reopened")
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = name + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }
}
#endif
