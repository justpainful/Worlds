#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_RENAME_PAGE
import XCTest

final class WorldsLocalRenamePageUITests: XCTestCase {
    @MainActor func testRenameAndUndo() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-rtl", "--ui-testing-large-text"]
        app.launch()
        let notice = app.descendants(matching: .any)["local-copy-notice"].firstMatch
        _ = notice.waitForExistence(timeout: 30)
        #if os(iOS)
        let initialPages = app.navigationBars.buttons["Pages"].firstMatch
        if initialPages.exists { initialPages.tap() }
        #endif
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        guard page.waitForExistence(timeout: 30) else { capture(app, "rename-page-missing"); XCTFail("Fixture page missing"); return }
        page.tap()
        let rename = app.buttons["rename-local-page"]
        guard rename.waitForExistence(timeout: 20) else { capture(app, "rename-action-missing"); XCTFail("Rename action missing"); return }
        rename.tap()
        let field = app.textFields["rename-personal-page-title"]
        guard field.waitForExistence(timeout: 15) else { capture(app, "rename-field-missing"); XCTFail("Name field missing"); return }
        guard let originalName = field.value as? String else { XCTFail("Original name unavailable"); return }
        field.tap()
        #if os(macOS)
        field.typeKey("a", modifierFlags: .command)
        field.typeKey(.delete, modifierFlags: [])
        #else
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 100))
        #endif
        field.typeText("Renamed fixture")
        app.buttons["rename-save"].tap()
        guard app.staticTexts["rename-status"].waitForExistence(timeout: 30) else { capture(app, "rename-save-missing"); XCTFail("Save status missing"); return }
        XCTAssertEqual(app.staticTexts["rename-status"].label, "Name saved.")
        let undo = app.buttons["rename-undo"]
        guard undo.waitForExistence(timeout: 10) else { capture(app, "rename-undo-missing"); XCTFail("Undo action missing"); return }
        undo.tap()
        let restored = NSPredicate(format: "label == %@", "Previous name restored.")
        expectation(for: restored, evaluatedWith: app.staticTexts["rename-status"])
        waitForExpectations(timeout: 30)
        capture(app, "rename-restored")
        app.buttons["Close"].tap()
        #if os(iOS)
        let showPages = app.navigationBars.buttons["Pages"].firstMatch
        if showPages.exists { showPages.tap() }
        #endif
        #if os(macOS)
        let appWindow = app.windows.firstMatch
        if appWindow.exists { appWindow.click() }
        #endif
        let menu = app.buttons["Local copies"].exists ? app.buttons["Local copies"] : app.descendants(matching: .any)["Local copies"].firstMatch
        guard menu.waitForExistence(timeout: 15) else { capture(app, "rename-copy-menu-missing"); XCTFail("Local copies menu missing"); return }
        menu.tap()
        let open = app.buttons["Open local copy"]
        guard open.waitForExistence(timeout: 10) else { XCTFail("Open local copy missing"); return }
        open.tap()
        let copies = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Local copy "))
        guard copies.firstMatch.waitForExistence(timeout: 20), copies.count == 1 else { XCTFail("Expected one isolated copy"); return }
        copies.firstMatch.tap()
        guard app.staticTexts["Select a page"].waitForExistence(timeout: 30), page.waitForExistence(timeout: 20) else { capture(app, "rename-copy-reopen-missing"); XCTFail("Copy did not reopen"); return }
        page.tap()
        guard rename.waitForExistence(timeout: 20) else { XCTFail("Rename action missing after reopen"); return }
        rename.tap()
        guard field.waitForExistence(timeout: 15) else { XCTFail("Name field missing after reopen"); return }
        XCTAssertEqual(field.value as? String, originalName, "Reopened copy must retain the restored name")
        capture(app, "rename-reopened")
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = name + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }
}
#endif
