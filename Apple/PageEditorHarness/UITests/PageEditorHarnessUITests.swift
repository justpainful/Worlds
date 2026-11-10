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
        let outer = app.scrollViews["harness-editor-scroll"].firstMatch
        guard outer.waitForExistence(timeout: 10), outer.isHittable else {
            captureFailure(app, named: "page-format-scroll-unavailable")
            XCTFail("Editor scroll view unavailable"); return
        }
        func scrollEditor() {
            let start = outer.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.8))
            let end = outer.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.2))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        let remove = app.buttons["editor-remove-link"]
        for _ in 0..<12 {
            if remove.exists && remove.isHittable && outer.frame.contains(remove.frame) { break }
            scrollEditor()
        }
        guard remove.exists, remove.isHittable else {
            captureFailure(app, named: "page-remove-link-not-visible")
            XCTFail("The final formatting action must be reachable")
            return
        }
        XCTAssertTrue(outer.frame.contains(remove.frame), "The final formatting action must be fully visible after scrolling")
        let toggle = app.buttons["Toggle task"]
        for _ in 0..<12 {
            if toggle.exists && toggle.isHittable && outer.frame.contains(toggle.frame) { break }
            scrollEditor()
        }
        guard toggle.exists, toggle.isHittable else {
            captureFailure(app, named: "page-toggle-task-not-visible")
            XCTFail("The final list action must be reachable")
            return
        }
        XCTAssertTrue(outer.frame.contains(toggle.frame), "The final list action must be fully visible after scrolling")
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
