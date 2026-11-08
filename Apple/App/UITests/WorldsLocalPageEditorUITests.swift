#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PAGE_EDITOR
import XCTest

final class WorldsLocalPageEditorUITests: XCTestCase {
    @MainActor func testDocumentInsertRowBelowHeaderAndReopenRTL() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-document-table-insert", "--ui-testing-rtl"]; app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-page"]; XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 20))
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.05)).tap()
        let insert = app.buttons["editor-insert-table-row"]
        XCTAssertTrue(insert.waitForExistence(timeout: 10)); insert.tap()
        XCTAssertTrue(app.staticTexts["fixture-table-inserted-row"].waitForExistence(timeout: 10))
        app.buttons["Save"].tap(); XCTAssertTrue(app.staticTexts["local-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(app.staticTexts["fixture-table-inserted-row"].waitForExistence(timeout: 20))
    }
    @MainActor func testDocumentAppendTableColumnAndReopenRTL() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-document-table", "--ui-testing-rtl"]; app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-page"]; XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 20)); editor.tap()
        let add = app.buttons["editor-add-table-column"]
        XCTAssertTrue(add.waitForExistence(timeout: 10)); add.tap()
        XCTAssertTrue(app.staticTexts["fixture-table-two-columns"].waitForExistence(timeout: 10))
        app.buttons["Save"].tap(); XCTAssertTrue(app.staticTexts["local-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(app.staticTexts["fixture-table-two-columns"].waitForExistence(timeout: 20))
        XCTAssertTrue((app.descendants(matching: .any)["native-editor-text"].firstMatch.value as? String ?? "").contains("خلية"))
    }
    @MainActor func testDocumentAppendTableRowAndReopenRTL() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-document-table", "--ui-testing-rtl"]; app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-page"]; XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 20)); editor.tap()
        let add = app.buttons["editor-add-table-row"]
        XCTAssertTrue(add.waitForExistence(timeout: 10)); add.tap()
        XCTAssertTrue(app.staticTexts["fixture-table-two-rows"].waitForExistence(timeout: 10))
        app.buttons["Save"].tap(); XCTAssertTrue(app.staticTexts["local-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(app.staticTexts["fixture-table-two-rows"].waitForExistence(timeout: 20))
        XCTAssertTrue((app.descendants(matching: .any)["native-editor-text"].firstMatch.value as? String ?? "").contains("خلية"))
    }
    @MainActor func testDocumentTitleStyleSaveAndReopenRTL() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-document-alignment", "--ui-testing-rtl"]; app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-page"]; XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 20)); editor.tap()
        let menu = app.descendants(matching: .any)["editor-paragraph-style"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 20)); menu.tap()
        let title = app.descendants(matching: .any).matching(identifier: "Title").firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 10)); title.tap()
        XCTAssertTrue(app.staticTexts["fixture-paragraph-title"].waitForExistence(timeout: 10))
        app.buttons["Save"].tap(); XCTAssertTrue(app.staticTexts["local-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(app.staticTexts["fixture-paragraph-title"].waitForExistence(timeout: 20))
        XCTAssertEqual(app.descendants(matching: .any)["native-editor-text"].firstMatch.value as? String, "نص عربي")
    }
    @MainActor func testDocumentAlignmentSaveAndReopenRTL() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-document-alignment", "--ui-testing-rtl"]; app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-page"]; XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 20)); editor.tap()
        let menu = app.descendants(matching: .any)["editor-alignment"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 20)); menu.tap()
        let center = app.descendants(matching: .any).matching(identifier: "Center").firstMatch
        XCTAssertTrue(center.waitForExistence(timeout: 10)); center.tap()
        XCTAssertTrue(app.staticTexts["fixture-alignment-centered"].waitForExistence(timeout: 10))
        app.buttons["Save"].tap(); XCTAssertTrue(app.staticTexts["local-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(app.staticTexts["fixture-alignment-centered"].waitForExistence(timeout: 20))
        XCTAssertEqual(app.descendants(matching: .any)["native-editor-text"].firstMatch.value as? String, "نص عربي")
    }
    @MainActor private func recordFailureContext(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name + "-screenshot"; screenshot.lifetime = .keepAlways; add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = name + "-accessibility"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }
    @MainActor func testLinkAcrossTextRunsSaveRemoveAndReopenRTL() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-link-fixture", "--ui-testing-rtl"]; app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-page"]; XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 20)); editor.tap()
        #if os(macOS)
        editor.typeKey("a", modifierFlags: .command)
        #else
        editor.press(forDuration: 1.2)
        let selectAll = app.menuItems["Select All"].firstMatch
        guard selectAll.waitForExistence(timeout: 10) else { recordFailureContext(app, "missing-select-all"); XCTFail("Select All menu item did not appear"); return }
        selectAll.tap()
        #endif
        let link = app.buttons["editor-link"]
        #if os(iOS)
        if !link.isHittable { app.scrollViews["editor-format-toolbar"].swipeUp() }
        #endif
        XCTAssertTrue(link.isHittable); link.tap()
        let address = app.textFields["https://example.com"].firstMatch
        XCTAssertTrue(address.waitForExistence(timeout: 10)); address.tap(); address.typeText("https://example.com")
        app.buttons["Apply link"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["fixture-link-covered"].waitForExistence(timeout: 10))
        app.buttons["Save"].tap(); XCTAssertTrue(app.staticTexts["local-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(app.staticTexts["fixture-link-covered"].waitForExistence(timeout: 20))
        let reopened = app.descendants(matching: .any)["native-editor-text"].firstMatch; reopened.tap()
        #if os(macOS)
        reopened.typeKey("a", modifierFlags: .command)
        #else
        reopened.press(forDuration: 1.2)
        let selectAgain = app.menuItems["Select All"].firstMatch
        guard selectAgain.waitForExistence(timeout: 10) else { recordFailureContext(app, "missing-select-all-reopened"); XCTFail("Select All menu item did not appear after reopening"); return }
        selectAgain.tap()
        #endif
        let remove = app.buttons["editor-remove-link"]
        #if os(iOS)
        if !remove.isHittable { app.scrollViews["editor-format-toolbar"].swipeUp() }
        #endif
        XCTAssertTrue(remove.isHittable); remove.tap()
        XCTAssertTrue(app.staticTexts["fixture-link-absent"].waitForExistence(timeout: 10))
        app.buttons["Save"].tap(); XCTAssertTrue(app.staticTexts["local-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(app.staticTexts["fixture-link-absent"].waitForExistence(timeout: 20))
    }
    @MainActor func testTaskReturnAndBackspaceSaveAndReopen() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-rtl"]; app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-page"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 20)); editor.tap()
        app.buttons["Checklist"].tap(); editor.tap()
        #if os(macOS)
        editor.typeKey("a", modifierFlags: .command)
        #else
        editor.press(forDuration: 1.2)
        let selectAll = app.menuItems["Select All"].firstMatch
        XCTAssertTrue(selectAll.waitForExistence(timeout: 10)); selectAll.tap()
        #endif
        editor.typeText("Parent")
        editor.typeText("\n")
        editor.typeText("Child")
        XCTAssertEqual(editor.value as? String, "Parent\nChild")
        XCTAssertTrue(app.buttons["editor-task.0.1"].waitForExistence(timeout: 10))
        editor.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 6))
        XCTAssertEqual(editor.value as? String, "Parent")
        editor.typeText("\n"); editor.typeText("Child")
        XCTAssertEqual(editor.value as? String, "Parent\nChild")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["local-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let reopened = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(reopened.waitForExistence(timeout: 20)); XCTAssertEqual(reopened.value as? String, "Parent\nChild")
        XCTAssertTrue(app.buttons["editor-task.0.1"].waitForExistence(timeout: 10))
    }
    @MainActor func testUnwrapMultipleBulletsAndReopen() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-multi-bullet"]; app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-page"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 20)); editor.tap()
        XCTAssertTrue(app.staticTexts["editor-list-status"].waitForExistence(timeout: 10))
        app.buttons["Bullets"].tap()
        XCTAssertFalse(app.staticTexts["editor-list-status"].exists)
        XCTAssertEqual(editor.value as? String, "First\nSecond")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["local-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let reopened = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(reopened.waitForExistence(timeout: 20)); XCTAssertEqual(reopened.value as? String, "First\nSecond")
        XCTAssertFalse(app.staticTexts["editor-list-status"].exists)
    }
    @MainActor func testAppendListItemsAndReopen() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-multi-task"]; app.launch()
        let page = app.descendants(matching: .any)["page.fixture-page"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-page"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let nested = app.buttons["editor-add-nested.0.0"]
        XCTAssertTrue(nested.waitForExistence(timeout: 20)); nested.tap()
        let field = app.alerts.textFields["Item text"]
        guard field.waitForExistence(timeout: 10) else { recordFailureContext(app, "missing-item-text"); XCTFail("Item text field did not appear in alert"); return }
        field.tap(); field.typeText("Nested item")
        app.alerts.buttons["Add"].tap()
        let nestedTask = app.buttons["editor-task.0.0.1.1"]
        XCTAssertTrue(nestedTask.waitForExistence(timeout: 20)); XCTAssertTrue(nestedTask.label.contains("Nested item"))
        let next = app.buttons["editor-add-item.0.1"]
        XCTAssertTrue(next.waitForExistence(timeout: 20)); next.tap()
        let nextField = app.alerts.textFields["Item text"]
        guard nextField.waitForExistence(timeout: 10) else { recordFailureContext(app, "missing-next-item-text"); XCTFail("Next item text field did not appear in alert"); return }
        nextField.tap(); nextField.typeText("Third item")
        app.alerts.buttons["Add"].tap()
        let third = app.buttons["editor-task.0.2"]
        XCTAssertTrue(third.waitForExistence(timeout: 20)); XCTAssertTrue(third.label.contains("Third item"))
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["local-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(nestedTask.waitForExistence(timeout: 20)); XCTAssertTrue(third.waitForExistence(timeout: 20))
        XCTAssertTrue(nestedTask.label.contains("Nested item")); XCTAssertTrue(third.label.contains("Third item"))
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "page-appended-lists-reopened"; image.lifetime = .keepAlways; add(image)
    }
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
        XCTAssertTrue(status.waitForExistence(timeout: 10)); XCTAssertEqual(accessibleText(status), "Task incomplete")
        app.buttons["Toggle task"].tap()
        XCTAssertEqual(accessibleText(status), "Task complete")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["local-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap()
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(app.staticTexts["editor-list-status"].waitForExistence(timeout: 20))
        XCTAssertEqual(accessibleText(app.staticTexts["editor-list-status"]), "Task complete")
        app.buttons["Toggle task"].tap()
        app.buttons["Numbered"].tap()
        XCTAssertEqual(accessibleText(app.staticTexts["editor-list-status"]), "Numbered list")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["local-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertEqual(accessibleText(app.staticTexts["editor-list-status"]), "Numbered list")
        app.buttons["Numbered"].tap()
        XCTAssertFalse(app.staticTexts["editor-list-status"].exists)
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
        XCTAssertTrue(accessibleText(error).contains("changed elsewhere"), "Unexpected conflict message: \(error.debugDescription)")
        XCTAssertEqual(editor.value as? String, draft)
        let reload = app.buttons["local-page-reload"]
        XCTAssertTrue(reload.exists); reload.tap()
        let cancel = app.windows.buttons["Keep editing"].firstMatch
        guard cancel.waitForExistence(timeout: 10) else { recordFailureContext(app, "missing-keep-editing"); XCTFail("Keep editing action did not appear"); return }
        cancel.tap()
        XCTAssertEqual(editor.value as? String, draft)
        reload.tap()
        let discard = app.windows.buttons["Discard draft and reload"].firstMatch
        guard discard.waitForExistence(timeout: 10) else { recordFailureContext(app, "missing-discard"); XCTFail("Discard action did not appear"); return }
        discard.tap()
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
    @MainActor private func accessibleText(_ element: XCUIElement) -> String {
        if let value = element.value as? String, !value.isEmpty { return value }
        return element.label
    }
}
#endif
