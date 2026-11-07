import XCTest

final class ProjectEditorHarnessUITests: XCTestCase {
    @MainActor func testEditSaveAndReopenIsolatedProject() throws {
        let app = XCUIApplication(); app.launch()
        let importButton = app.buttons["Import test copy"]
        XCTAssertTrue(importButton.waitForExistence(timeout: 30)); importButton.tap()
        XCTAssertTrue(app.staticTexts["Independent local copy"].waitForExistence(timeout: 30))
        let open = app.buttons["Open test project"]
        XCTAssertTrue(open.waitForExistence(timeout: 30)); open.tap()
        let description = app.descendants(matching: .any)["project-description"].firstMatch
        XCTAssertTrue(description.waitForExistence(timeout: 20))
        description.tap()
        #if os(macOS)
        description.typeKey("a", modifierFlags: .command)
        #else
        description.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40))
        #endif
        description.typeText("Updated fixture")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["project-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap()
        XCTAssertTrue(app.staticTexts["harness-original-unchanged"].waitForExistence(timeout: 20))
        open.tap()
        let reopened = app.descendants(matching: .any)["project-description"].firstMatch
        XCTAssertTrue(reopened.waitForExistence(timeout: 20))
        XCTAssertTrue((reopened.value as? String ?? "").contains("Updated fixture"))
    }
}
