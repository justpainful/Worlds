import XCTest

final class RejectedArchiveHarnessUITests: XCTestCase {
    @MainActor func testListDetailsAndRevokedAccess() throws {
        let app = XCUIApplication(); app.launch()
        let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'archive.row.'"))
        let row = rows.firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20)); activate(row)
        let details = app.staticTexts["archive.details"]
        XCTAssertTrue(details.waitForExistence(timeout: 10))
        #if os(iOS)
        if !details.isHittable { app.swipeUp() }
        #endif
        XCTAssertTrue(details.isHittable)
        let detailScreenshot = XCTAttachment(screenshot: app.screenshot())
        detailScreenshot.name = "Rejected archive details"; detailScreenshot.lifetime = .keepAlways; add(detailScreenshot)
        let revoke = app.buttons["fixture.revoke"]; XCTAssertTrue(revoke.exists); activate(revoke)
        let refresh = app.buttons["archive.refresh"]; XCTAssertTrue(refresh.exists); activate(refresh)
        let message = app.staticTexts["archive.message"]
        XCTAssertTrue(message.waitForExistence(timeout: 10))
        XCTAssertTrue(message.label.contains("unavailable"))
        XCTAssertFalse(details.exists)
        XCTAssertEqual(rows.count, 0)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Rejected archive access revoked"; screenshot.lifetime = .keepAlways; add(screenshot)
    }
    @MainActor private func activate(_ element: XCUIElement) {
        #if os(macOS)
        element.click()
        #else
        element.tap()
        #endif
    }
}
