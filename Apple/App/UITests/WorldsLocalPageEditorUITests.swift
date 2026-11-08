#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PAGE_EDITOR
import XCTest

final class WorldsLocalPageEditorUITests: XCTestCase {
    @MainActor func testMultipleTaskItemsToggleAndReopen() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-multi-task"]; app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-page"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let first = app.buttons["editor-task.0.0"], second = app.buttons["editor-task.0.1"]
        let nested = app.buttons["editor-task.0.0.1.0"]
        XCTAssertTrue(first.waitForExistence(timeout: 20)); XCTAssertTrue(second.waitForExistence(timeout: 20))
        XCTAssertTrue(nested.waitForExistence(timeout: 20)); XCTAssertTrue(nested.label.contains("Empty task"))
        XCTAssertTrue(first.label.contains("Mark complete")); XCTAssertTrue(second.label.contains("Mark incomplete"))
        first.tap(); second.tap(); nested.tap()
        XCTAssertTrue(first.label.contains("Mark incomplete")); XCTAssertTrue(second.label.contains("Mark complete"))
        XCTAssertTrue(nested.label.contains("Mark incomplete"))
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["local-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap()
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(first.waitForExistence(timeout: 20)); XCTAssertTrue(second.waitForExistence(timeout: 20))
        XCTAssertTrue(first.label.contains("Mark incomplete")); XCTAssertTrue(second.label.contains("Mark complete"))
        XCTAssertTrue(nested.label.contains("Mark incomplete"))
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "page-multiple-tasks-reopened"; screenshot.lifetime = .keepAlways; add(screenshot)
    }
    @MainActor func testCreateChecklistSaveAndReopen() {
        let app = XCUIApplication(); app.launchArguments.append("--ui-testing-local-copy-fixture"); app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-page"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 20)); editor.tap()
        let checklist = app.buttons["Checklist"]
        XCTAssertTrue(checklist.waitForExistence(timeout: 10)); checklist.tap()
        let status = app.staticTexts["editor-list-status"]
        XCTAssertTrue(status.waitForExistence(timeout: 10)); XCTAssertEqual(status.label, "Task incomplete")
        app.buttons["Toggle task"].tap()
        XCTAssertEqual(status.label, "Task complete")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["local-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap()
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(app.staticTexts["editor-list-status"].waitForExistence(timeout: 20))
        XCTAssertEqual(app.staticTexts["editor-list-status"].label, "Task complete")
    }
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
        let cancel = app.windows.buttons["Keep editing"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 10)); cancel.tap()
        XCTAssertEqual(editor.value as? String, draft)
        reload.tap()
        let discard = app.windows.buttons["Discard draft and reload"].firstMatch
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
        let cancel = app.windows.buttons["Cancel"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 10)); cancel.tap()
        XCTAssertEqual(editor.value as? String, draft)
        app.buttons["Close"].tap()
        let discard = app.windows.buttons["Discard"].firstMatch
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
