#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PAGE_EDITOR
import XCTest

final class WorldsLocalPageEditorUITests: XCTestCase {
    @MainActor func testConflictKeepsDraftUntilConfirmedReload() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-page-conflict"]; app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-page"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 20)); editor.tap()
        let original = editor.value as? String
        editor.typeText(" draft")
        let draft = editor.value as? String
        XCTAssertNotEqual(draft, original)
        app.buttons["Save"].tap()
        let error = app.staticTexts["local-page-error"]
        XCTAssertTrue(error.waitForExistence(timeout: 20))
        XCTAssertTrue(error.label.contains("changed elsewhere"))
        XCTAssertEqual(editor.value as? String, draft)
        let reload = app.buttons["local-page-reload"]
        XCTAssertTrue(reload.exists); reload.tap()
        let cancel = app.buttons["Keep editing"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 10)); cancel.tap()
        XCTAssertEqual(editor.value as? String, draft)
        reload.tap()
        let discard = app.buttons["Discard draft and reload"]
        XCTAssertTrue(discard.waitForExistence(timeout: 10)); discard.tap()
        let reopened = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(reopened.waitForExistence(timeout: 20))
        XCTAssertEqual(reopened.value as? String, original)
    }
    @MainActor func testClosingDraftRequiresExplicitDiscard() {
        let app = XCUIApplication(); app.launchArguments.append("--ui-testing-local-copy-fixture"); app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-page"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 20)); editor.tap()
        let original = editor.value as? String
        editor.typeText(" draft")
        let draft = editor.value as? String
        XCTAssertNotEqual(draft, original)
        app.buttons["Close"].tap()
        let cancel = app.buttons["Cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 10)); cancel.tap()
        XCTAssertEqual(editor.value as? String, draft)
        app.buttons["Close"].tap()
        let discard = app.buttons["Discard"]
        XCTAssertTrue(discard.waitForExistence(timeout: 10)); discard.tap()
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let reopened = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(reopened.waitForExistence(timeout: 20))
        XCTAssertEqual(reopened.value as? String, original)
    }
    @MainActor func testEditSaveAndReopenPersonalPage() {
        let app = XCUIApplication(); app.launchArguments.append("--ui-testing-local-copy-fixture"); app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-page"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 20)); editor.tap()
        #if os(macOS)
        editor.typeKey("a", modifierFlags: .command)
        #else
        editor.press(forDuration: 1.2)
        let selectAll = app.menuItems["Select All"].firstMatch
        XCTAssertTrue(selectAll.waitForExistence(timeout: 10)); selectAll.tap()
        #endif
        editor.typeText("Updated local page")
        let save = app.buttons["Save"]
        XCTAssertTrue(save.isEnabled); save.tap()
        XCTAssertTrue(app.staticTexts["local-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap()
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let reopened = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(reopened.waitForExistence(timeout: 20))
        XCTAssertEqual(reopened.value as? String, "Updated local page")
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "local-page-reopened"; screenshot.lifetime = .keepAlways; add(screenshot)
    }
}
#endif
