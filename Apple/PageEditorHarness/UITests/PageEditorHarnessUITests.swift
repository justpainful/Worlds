import XCTest

final class PageEditorHarnessUITests: XCTestCase {
    @MainActor func testArabicRTLAndLargeTextSurvivesReopen() throws {
        let app = XCUIApplication()
        app.launchArguments += ["--test-rtl", "--test-large-text"]
        app.launch()
        let importButton = app.buttons["Import test copy"]
        XCTAssertTrue(importButton.waitForExistence(timeout: 30)); importButton.tap()
        let open = app.buttons["Open test page"]
        XCTAssertTrue(open.waitForExistence(timeout: 30)); open.tap()
        let editor = app.descendants(matching: .any)["native-editor-text"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 20)); editor.tap()
        #if os(iOS)
        let label = editor.label
        XCTAssertTrue(label.hasPrefix("display-font-size:"), "The editor should expose its measured display font in this debug harness")
        let size = Double(label.replacingOccurrences(of: "display-font-size:", with: "").split(separator: ";").first ?? "")
        XCTAssertGreaterThan(try XCTUnwrap(size), 25, "Accessibility text must use a visibly enlarged font; observed \(label)")
        #endif
        selectAll(in: editor, app: app)
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
        selectAll(in: editor, app: app)
        editor.typeText("Edited fixture")
        selectAll(in: editor, app: app)
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

    @MainActor private func selectAll(in editor: XCUIElement, app: XCUIApplication) {
        #if os(macOS)
        editor.typeKey("a", modifierFlags: .command)
        #else
        editor.press(forDuration: 1.2)
        let selectAll = app.menuItems["Select All"].firstMatch
        XCTAssertTrue(selectAll.waitForExistence(timeout: 10)); selectAll.tap()
        #endif
    }
    @MainActor private func capture(_ app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
