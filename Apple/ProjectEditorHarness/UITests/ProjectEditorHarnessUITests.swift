import XCTest

final class ProjectEditorHarnessUITests: XCTestCase {
    @MainActor func testEditSaveAndReopenIsolatedProject() throws {
        let app = XCUIApplication(); app.launch()
        let importButton = app.buttons["Import test copy"]
        XCTAssertTrue(importButton.waitForExistence(timeout: 30)); importButton.tap()
        XCTAssertTrue(app.staticTexts["Independent local copy"].waitForExistence(timeout: 30))
        capture(app, named: "harness-copy-imported")
        let open = app.buttons["Open test project"]
        XCTAssertTrue(open.waitForExistence(timeout: 30)); open.tap()
        let description = app.descendants(matching: .any)["project-description"].firstMatch
        XCTAssertTrue(description.waitForExistence(timeout: 20))
        description.tap()
        #if os(macOS)
        description.typeKey("a", modifierFlags: .command)
        #else
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "Tapping the description must open the keyboard")
        let focus = expectation(for: NSPredicate(format: "hasKeyboardFocus == true"), evaluatedWith: description)
        wait(for: [focus], timeout: 10)
        description.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40))
        #endif
        description.typeText("Updated fixture")
        capture(app, named: "harness-project-edited")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["project-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap()
        XCTAssertTrue(app.staticTexts["harness-original-unchanged"].waitForExistence(timeout: 20))
        capture(app, named: "harness-original-unchanged")
        open.tap()
        let reopened = app.descendants(matching: .any)["project-description"].firstMatch
        XCTAssertTrue(reopened.waitForExistence(timeout: 20))
        XCTAssertTrue((reopened.value as? String ?? "").contains("Updated fixture"))
        capture(app, named: "harness-project-reopened")
    }

    @MainActor private func capture(_ app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
