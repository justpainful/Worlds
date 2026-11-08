import XCTest

final class GalleryHarnessUITests: XCTestCase {
    @MainActor func testAddReorderReopenAndMissingAttachment() {
        let app = XCUIApplication(); app.launch()
        let prepare = app.buttons["Prepare fixture"]
        XCTAssertTrue(prepare.waitForExistence(timeout: 30)); prepare.tap()
        let first = app.buttons["Add First.png"]
        XCTAssertTrue(first.waitForExistence(timeout: 30)); first.tap()
        XCTAssertTrue(app.staticTexts["gallery-item.a"].waitForExistence(timeout: 20))
        app.buttons["Add Second.png"].tap()
        let second = app.staticTexts["gallery-item.b"]
        XCTAssertTrue(second.waitForExistence(timeout: 20))
        let move = app.buttons["gallery-move.b"]
        XCTAssertTrue(move.waitForExistence(timeout: 10)); move.tap()
        let firstItem = app.staticTexts["gallery-item.a"]
        XCTAssertTrue(app.buttons["gallery-move.a"].waitForExistence(timeout: 20))
        XCTAssertLessThan(second.frame.minY, firstItem.frame.minY)
        app.buttons["Reopen gallery"].tap()
        XCTAssertTrue(app.buttons["gallery-move.a"].waitForExistence(timeout: 20))
        XCTAssertLessThan(second.frame.minY, firstItem.frame.minY)
        XCTAssertTrue(app.staticTexts["gallery-unknown-preserved"].exists)
        XCTAssertTrue(app.staticTexts["gallery-source-unchanged"].exists)
        app.buttons["Add Missing.png"].tap()
        XCTAssertTrue(app.staticTexts["gallery-error"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["gallery-item.missing"].exists)
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "gallery-reopened-and-missing"; image.lifetime = .keepAlways; add(image)
    }
}
