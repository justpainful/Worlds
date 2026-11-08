#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_CREATE_PAGE
import XCTest

final class WorldsLocalCreatePageUITests: XCTestCase {
    @MainActor func testCreatePersonalPageAndOpenFromList() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-rtl", "--ui-testing-large-text"]
        app.launch()
        let newPage = app.buttons["new-local-page"]
        guard newPage.waitForExistence(timeout: 30) else { capture(app, "create-action-missing"); XCTFail("New page action missing"); return }
        newPage.tap()
        let title = app.textFields["new-personal-page-title"]
        guard title.waitForExistence(timeout: 15) else { capture(app, "create-title-missing"); XCTFail("Title field missing"); return }
        title.tap()
        title.typeText("Personal test page")
        let create = app.buttons["create-personal-page"]
        guard create.waitForExistence(timeout: 10), create.isEnabled else { capture(app, "create-disabled"); XCTFail("Create action is unavailable"); return }
        create.tap()
        let page = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Personal test page")).firstMatch
        guard page.waitForExistence(timeout: 30) else { capture(app, "created-page-missing"); XCTFail("Created page did not open"); return }
        XCTAssertFalse(title.exists, "The creation sheet must close after opening the page")
        XCTAssertTrue(app.descendants(matching: .any)["page-content"].waitForExistence(timeout: 20), "The newly created page must open")
        capture(app, "created-page")
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = name + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }
}
#endif
