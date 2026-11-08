import XCTest

final class CollaborationHarnessUITests: XCTestCase {
    func testLocalCollaborationScenario() throws {
        let environment = ProcessInfo.processInfo.environment
        let keys = ["WORLDS_REQUIRE_LIVE_SERVICE", "WORLDS_LIVE_SYNC_URL", "WORLDS_LIVE_EDITOR_TOKEN", "WORLDS_LIVE_VIEWER_TOKEN"]
        guard environment[keys[0]] == "1", environment[keys[1]] == "ws://127.0.0.1:18790",
              keys.dropFirst(2).allSatisfy({ !(environment[$0] ?? "").isEmpty }) else {
            return XCTFail("Isolated local Worker and fixture tokens are required")
        }
        let app = XCUIApplication()
        for key in keys { app.launchEnvironment[key] = environment[key] }
        app.launch()
        let start = app.buttons["scenario.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 10))
        start.click()
        let status = app.staticTexts["scenario.status"]
        let complete = NSPredicate(format: "label BEGINSWITH 'Passed:'")
        expectation(for: complete, evaluatedWith: status)
        waitForExpectations(timeout: 90)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Local collaboration scenario passed"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
