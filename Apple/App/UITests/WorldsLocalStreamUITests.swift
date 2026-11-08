#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_STREAM_EDITOR
import XCTest

final class WorldsLocalStreamUITests: XCTestCase {
    @MainActor func testEditStreamLinkAndReopenIndependentCopy() throws {
        let app = XCUIApplication()
        app.launchArguments.append("--ui-testing-local-copy-fixture")
        app.launch()
        let page = app.descendants(matching: .any)["page.fixture-stream"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["Edit link"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let field = app.descendants(matching: .any)["stream-url-editor"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 20)); field.tap()
        #if os(macOS)
        field.typeKey("a", modifierFlags: .command)
        field.typeKey(.delete, modifierFlags: [])
        #else
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 100))
        #endif
        XCTAssertEqual(field.value as? String ?? "", "")
        field.typeText("https://new.example/video.mp4")
        let save = app.buttons["save-stream-link"]
        XCTAssertTrue(save.isEnabled); save.tap()
        XCTAssertTrue(app.staticTexts["Stream link saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap()
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let reopened = app.descendants(matching: .any)["stream-url-editor"].firstMatch
        XCTAssertTrue(reopened.waitForExistence(timeout: 20))
        XCTAssertEqual(reopened.value as? String, "https://new.example/video.mp4")
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "isolated-stream-link-reopened"; capture.lifetime = .keepAlways; add(capture)
    }
}
#endif
