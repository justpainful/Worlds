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
        XCTAssertTrue(edit.waitForExistence(timeout: 20))
        let notice = app.descendants(matching: .any)["local-copy-notice"].firstMatch
        XCTAssertFalse(edit.frame.intersects(notice.frame), "The copy notice must not cover the edit action")
        XCTAssertTrue(edit.isHittable)
        edit.tap()
        let description = app.descendants(matching: .any)["project-description"].firstMatch
        XCTAssertTrue(description.waitForExistence(timeout: 20)); description.tap()
        #if os(macOS)
        description.typeKey("a", modifierFlags: .command)
        description.typeKey(.delete, modifierFlags: [])
        #else
        description.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        description.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 100))
        #endif
        XCTAssertEqual(description.value as? String ?? "", "")
        description.typeText("Updated fixture")
        capture(app, named: "local-copy-project-edited")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["project-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap()
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let reopened = app.descendants(matching: .any)["project-description"].firstMatch
        XCTAssertTrue(reopened.waitForExistence(timeout: 20))
        XCTAssertEqual(reopened.value as? String, "Updated fixture")
        capture(app, named: "local-copy-project-reopened")
    }

    #if WORLDS_EXPERIMENTAL_PROJECT_LINKS
    @MainActor func testUnavailableLinkExplainsAndReloadsWithoutDiscard() throws {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-unavailable-link"]
        app.launch()
        let project = app.descendants(matching: .any)["page.harness-project"].firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 30)); project.tap()
        let edit = app.buttons["edit-local-project"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let message = app.descendants(matching: .any)["project-editing-error"].firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 20))
        XCTAssertTrue(message.label.contains("project or a linked page is unavailable"))
        XCTAssertFalse(app.buttons["project-link-menu"].exists)
        capture(app, named: "local-copy-unavailable-link")
        let reload = app.buttons["Reload project"]
        XCTAssertTrue(reload.waitForExistence(timeout: 10)); reload.tap()
        XCTAssertTrue(message.waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["Discard"].exists)
        app.buttons["Close"].tap()
    }

    @MainActor func testDuplicateLinksAreNotRemovedSilently() throws {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-duplicate-links"]
        app.launch()
        let project = app.descendants(matching: .any)["page.harness-project"].firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 30)); project.tap()
        let edit = app.buttons["edit-local-project"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let links = app.buttons.matching(identifier: "project-unlink.fixture-page")
        XCTAssertTrue(links.firstMatch.waitForExistence(timeout: 20))
        #if os(iOS)
        for _ in 0..<4 where !links.firstMatch.isHittable { app.swipeUp() }
        #endif
        links.firstMatch.tap()
        let message = app.descendants(matching: .any)["project-editing-error"].firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 20))
        XCTAssertTrue(message.label.contains("malformed or duplicated"))
        XCTAssertEqual(links.count, 2)
        capture(app, named: "local-copy-duplicate-links-rejected")
        app.buttons["Close"].tap()
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(links.firstMatch.waitForExistence(timeout: 20))
        XCTAssertEqual(links.count, 2)
    }

    @MainActor func testPersonalProjectLinksPersistAndUnlink() throws {
        let app = XCUIApplication()
        app.launchArguments.append("--ui-testing-local-copy-fixture")
        app.launch()
        let project = app.descendants(matching: .any)["page.harness-project"].firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 30)); project.tap()
        let edit = app.buttons["edit-local-project"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let menu = app.buttons["project-link-menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 20))
        #if os(iOS)
        for _ in 0..<4 where !menu.isHittable { app.swipeUp() }
        #endif
        XCTAssertTrue(menu.isHittable); menu.tap()
        let candidate = app.buttons["project-link.fixture-page"]
        XCTAssertTrue(candidate.waitForExistence(timeout: 10))
        XCTAssertTrue(candidate.isHittable)
        capture(app, named: "local-copy-project-link-picker")
        candidate.tap()
        let unlink = app.buttons["project-unlink.fixture-page"]
        XCTAssertTrue(unlink.waitForExistence(timeout: 15))
        capture(app, named: "local-copy-project-link-staged")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["project-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap()
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(unlink.waitForExistence(timeout: 20))
        #if os(iOS)
        for _ in 0..<4 where !unlink.isHittable { app.swipeUp() }
        #endif
        XCTAssertTrue(unlink.isHittable); unlink.tap()
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["project-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap()
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(menu.waitForExistence(timeout: 20))
        XCTAssertFalse(unlink.exists)
    }

    #endif
    #if os(iOS)
    @MainActor func testLargeTextRTLKeyboardAndSaveRemainReachable() throws {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-large-text", "--ui-testing-rtl", "--ui-testing-dark"]
        app.launch()
        let notice = app.descendants(matching: .any)["local-copy-notice"].firstMatch
        XCTAssertTrue(notice.waitForExistence(timeout: 30))
        let project = app.descendants(matching: .any)["page.harness-project"].firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 20)); project.tap()
        let edit = app.buttons["edit-local-project"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20))
        XCTAssertFalse(edit.frame.intersects(notice.frame)); edit.tap()
        let description = app.descendants(matching: .any)["project-description"].firstMatch
        XCTAssertTrue(description.waitForExistence(timeout: 20))
        for _ in 0..<4 where !description.isHittable { app.swipeUp() }
        XCTAssertTrue(description.isHittable); description.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        description.typeText(" updated")
        capture(app, named: "local-copy-large-rtl-keyboard")
        let done = app.buttons["project-dismiss-keyboard"]
        XCTAssertTrue(done.waitForExistence(timeout: 10)); done.tap()
        let save = app.buttons["Save"]
        for _ in 0..<5 where !save.isHittable { app.swipeUp() }
        XCTAssertTrue(save.isHittable)
        capture(app, named: "local-copy-large-rtl-save")
        save.tap()
        XCTAssertTrue(app.staticTexts["project-saved"].waitForExistence(timeout: 20))
    }
    #endif

    @MainActor private func capture(_ app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
#endif
