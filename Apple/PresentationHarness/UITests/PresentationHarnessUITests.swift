import XCTest
final class PresentationHarnessUITests: XCTestCase {
    @MainActor func testEditReorderSaveAndReopen() {
        let app = XCUIApplication(); app.launch()
        let prepare = app.buttons["Prepare presentation"]
        XCTAssertTrue(prepare.waitForExistence(timeout: 30)); prepare.tap()
        let field = app.textFields["slide-text"]
        XCTAssertTrue(field.waitForExistence(timeout: 20)); field.tap()
        #if os(macOS)
        field.typeKey("a", modifierFlags: .command); field.typeKey(.delete, modifierFlags: [])
        #else
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40))
        #endif
        XCTAssertEqual(field.value as? String, "")
        field.typeText("Edited slide")
        app.buttons["Apply text"].tap()
        let slideB = app.buttons["slide.slide-b"]
        XCTAssertTrue(slideB.waitForExistence(timeout: 10)); slideB.tap()
        app.buttons["Move slide up"].tap()
        XCTAssertLessThan(slideB.frame.minY, app.buttons["slide.slide-a"].frame.minY)
        app.buttons["Save presentation"].tap()
        XCTAssertTrue(app.staticTexts["presentation-saved"].waitForExistence(timeout: 20))
        app.buttons["Reopen presentation"].tap()
        XCTAssertTrue(app.buttons["slide.slide-a"].waitForExistence(timeout: 20))
        XCTAssertLessThan(slideB.frame.minY, app.buttons["slide.slide-a"].frame.minY)
        app.buttons["slide.slide-a"].tap()
        XCTAssertEqual(app.textFields["slide-text"].value as? String, "Edited slide")
        XCTAssertTrue(app.staticTexts["presentation-opaque-preserved"].exists)
        XCTAssertTrue(app.staticTexts["presentation-source-unchanged"].exists)
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "presentation-reopened"; image.lifetime = .keepAlways; add(image)
    }
}
