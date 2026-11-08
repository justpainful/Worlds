import XCTest

final class PageEditorHarnessUITests: XCTestCase {
    @MainActor func testArabicRTLAndLargeTextSurvivesReopen() throws {
        let app = XCUIApplication()
        app.launchArguments += ["--test-rtl", "--test-large-text"]
        app.launch()
        let importButton = app.buttons["Import test copy"]
        XCTAssertTrue(importButton.waitForExistence(timeout: 30)); importButton.tap()
        let open = app.buttons["Open test page"]
        guard open.waitForExistence(timeout: 30) else { captureFailure(app, named: "page-open-missing"); XCTFail("Open test page did not appear"); return }; open.tap()
        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        guard editor.waitForExistence(timeout: 20) else { captureFailure(app, named: "page-editor-missing"); XCTFail("Editor did not appear"); return }
        #if os(macOS)
        if !editor.isHittable {
            let scroll = app.scrollViews["harness-editor-scroll"].firstMatch
            guard scroll.waitForExistence(timeout: 10), scroll.isHittable else { captureFailure(app, named: "page-scroll-unavailable"); XCTFail("Editor scroll view unavailable"); return }
            scroll.swipeUp()
        }
        #endif
        guard editor.isHittable else { captureFailure(app, named: "page-editor-offscreen"); XCTFail("Editor is not visible"); return }; editor.tap()
        #if os(iOS)
        let label = editor.label
        XCTAssertTrue(label.hasPrefix("display-font-size:"), "The editor should expose its measured display font in this debug harness")
        let size = Double(label.replacingOccurrences(of: "display-font-size:", with: "").split(separator: ";").first ?? "")
        XCTAssertGreaterThan(try XCTUnwrap(size), 25, "Accessibility text must use a visibly enlarged font; observed \(label)")
        #endif
        guard selectAll(in: editor, app: app) else { return }
        editor.typeText("مسألة رياضيات 123")
        XCTAssertEqual(editor.value as? String, "مسألة رياضيات 123")
        capture(app, named: "page-editor-arabic-large-rtl-draft")
        let save = app.buttons["Save"]
        XCTAssertTrue(save.isHittable); XCTAssertTrue(save.isEnabled); save.tap()
        XCTAssertTrue(app.staticTexts["editor-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap()
        XCTAssertTrue(app.staticTexts["editor-source-unchanged"].waitForExistence(timeout: 20))
        open.tap()
        let reopened = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(reopened.waitForExistence(timeout: 20))
        XCTAssertEqual(reopened.value as? String, "مسألة رياضيات 123")
        XCTAssertTrue(app.staticTexts["editor-reopened-arabic"].waitForExistence(timeout: 10))
        #if os(iOS)
        let formatting = app.scrollViews["editor-format-toolbar"]
        XCTAssertTrue(formatting.waitForExistence(timeout: 10))
        let remove = app.buttons["editor-remove-link"]
        for _ in 0..<4 where !formatting.frame.contains(remove.frame) { formatting.swipeUp() }
        XCTAssertTrue(remove.isHittable)
        XCTAssertTrue(formatting.frame.contains(remove.frame), "The final formatting action must be fully visible after scrolling")
        let lists = app.scrollViews["editor-list-toolbar"]
        XCTAssertTrue(lists.waitForExistence(timeout: 10))
        let toggle = app.buttons["Toggle task"]
        for _ in 0..<4 where !lists.frame.contains(toggle.frame) { lists.swipeUp() }
        XCTAssertTrue(toggle.isHittable)
        XCTAssertTrue(lists.frame.contains(toggle.frame), "The final list action must be fully visible after scrolling")
        #endif
        capture(app, named: "page-editor-arabic-large-rtl-reopened")
    }

    @MainActor func testEditBoldSaveAndReopenIndependentCopy() throws {
        let app = XCUIApplication(); app.launch()
        let importButton = app.buttons["Import test copy"]
        XCTAssertTrue(importButton.waitForExistence(timeout: 30)); importButton.tap()
        let open = app.buttons["Open test page"]
        XCTAssertTrue(open.waitForExistence(timeout: 30)); open.tap()
        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 20)); editor.tap()
        guard selectAll(in: editor, app: app) else { return }
        editor.typeText("Edited fixture")
        guard selectAll(in: editor, app: app) else { return }
        let bold = app.buttons["Bold"]
        XCTAssertTrue(bold.waitForExistence(timeout: 10)); XCTAssertTrue(bold.isHittable); bold.tap()
        capture(app, named: "page-editor-bold-draft")
        let save = app.buttons["Save"]
        XCTAssertTrue(save.isEnabled); save.tap()
        XCTAssertTrue(app.staticTexts["editor-page-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap()
        XCTAssertTrue(app.staticTexts["editor-source-unchanged"].waitForExistence(timeout: 20))
        capture(app, named: "page-editor-source-unchanged")
        XCTAssertTrue(open.waitForExistence(timeout: 10)); open.tap()
        let reopened = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(reopened.waitForExistence(timeout: 20))
        XCTAssertEqual(reopened.value as? String, "Edited fixture")
        XCTAssertTrue(app.staticTexts["editor-reopened-bold"].waitForExistence(timeout: 10))
        capture(app, named: "page-editor-reopened")
    }

    @MainActor private func selectAll(in editor: XCUIElement, app: XCUIApplication) -> Bool {
        #if os(macOS)
        editor.typeKey("a", modifierFlags: .command)
        #else
        editor.press(forDuration: 1.2)
        let selectAll = app.menuItems["Select All"].firstMatch
        guard selectAll.waitForExistence(timeout: 10) else { captureFailure(app, named: "page-select-all-missing"); XCTFail("Select All did not appear"); return false }; selectAll.tap()
        #endif
        return true
    }
    @MainActor private func captureFailure(_ app: XCUIApplication, named name: String) {
        capture(app, named: name)
        let hierarchy = XCTAttachment(string: app.debugDescription); hierarchy.name = name + "-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }
    @MainActor private func capture(_ app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
