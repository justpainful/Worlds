import XCTest

final class MathPreviewUITests: XCTestCase {
    @MainActor func testUnsupportedSourceRemainsEditableAndAppliesExactly() {
        let app = XCUIApplication(); app.launch()
        let field = app.descendants(matching: .any)["math-source-input"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        let first = XCTAttachment(screenshot: app.screenshot()); first.name = "native-math-fixture"; first.lifetime = .keepAlways; add(first)
        field.tap()
        #if os(macOS)
        field.typeKey("a", modifierFlags: .command); field.typeKey(.delete, modifierFlags: [])
        #else
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 3))
        #endif
        field.typeText("@")
        XCTAssertTrue(app.staticTexts["Native preview unavailable for this equation."].waitForExistence(timeout: 10))
        app.buttons["Apply source"].tap()
        XCTAssertEqual(app.staticTexts["applied-math-source"].label, "Applied source: @")
        let second = XCTAttachment(screenshot: app.screenshot()); second.name = "native-math-unsupported"; second.lifetime = .keepAlways; add(second)
    }
}
