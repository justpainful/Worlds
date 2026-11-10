import XCTest

final class AttachmentBundleHarnessUITests: XCTestCase {
    @MainActor func testFixtureSelectionAndRealBundleImport() throws {
        let app = XCUIApplication(); app.launch()
        let create = app.buttons["bundle.fixture"]; XCTAssertTrue(create.waitForExistence(timeout: 15)); create.click()
        XCTAssertTrue(app.staticTexts["bundle.selected"].waitForExistence(timeout: 10))
        app.buttons["bundle.import"].click()
        XCTAssertTrue(app.staticTexts["bundle.success"].waitForExistence(timeout: 60))
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "Attachment fixture copied"; screenshot.lifetime = .keepAlways; add(screenshot)
    }
}
