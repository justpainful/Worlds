#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY
import XCTest

final class WorldsLocalCopyUITests: XCTestCase {
    @MainActor func testPersonalProjectEditAndReopenInLocalCopy() throws {
        let app = XCUIApplication()
        app.launchArguments.append("--ui-testing-local-copy-fixture")
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["local-copy-notice"].firstMatch.waitForExistence(timeout: 30))
        capture(app, named: "local-copy-imported")
        let project = app.descendants(matching: .any)["page.harness-project"].firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 20)); project.tap()
        let edit = app.buttons["edit-local-project"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let description = app.descendants(matching: .any)["project-description"].firstMatch
        XCTAssertTrue(description.waitForExistence(timeout: 20)); description.tap()
        #if os(macOS)
        description.typeKey("a", modifierFlags: .command)
        #else
        description.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40))
        #endif
        description.typeText("Updated fixture")
        capture(app, named: "local-copy-project-edited")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["project-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap()
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let reopened = app.descendants(matching: .any)["project-description"].firstMatch
        XCTAssertTrue(reopened.waitForExistence(timeout: 20))
        XCTAssertTrue((reopened.value as? String ?? "").contains("Updated fixture"))
        capture(app, named: "local-copy-project-reopened")
    }

    @MainActor private func capture(_ app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
#endif
