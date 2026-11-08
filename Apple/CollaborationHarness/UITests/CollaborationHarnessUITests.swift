import XCTest

final class CollaborationHarnessUITests: XCTestCase {
    @MainActor func testLocalCollaborationScenario() throws {
        // Obtain synthetic credentials only from the local identity fixture. XCTest
        // does not inherit arbitrary xcodebuild environment variables reliably.
        func fixtureToken(_ subject: String) throws -> String {
            guard subject == "editor" || subject == "viewer",
                  let url = URL(string: "http://127.0.0.1:18791/dev/token?sub=\(subject)") else {
                throw FixtureError.invalidResponse
            }
            let data = try Data(contentsOf: url)
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            guard let token = object?["token"] as? String, !token.isEmpty else { throw FixtureError.invalidResponse }
            return token
        }
        let app = XCUIApplication()
        app.launchEnvironment["WORLDS_REQUIRE_LIVE_SERVICE"] = "1"
        app.launchEnvironment["WORLDS_LIVE_SYNC_URL"] = "ws://127.0.0.1:18790"
        app.launchEnvironment["WORLDS_LIVE_EDITOR_TOKEN"] = try fixtureToken("editor")
        app.launchEnvironment["WORLDS_LIVE_VIEWER_TOKEN"] = try fixtureToken("viewer")
        app.launch()
        let start = app.buttons["scenario.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 10))
        start.click()
        let status = app.descendants(matching: .any)["scenario.status"].firstMatch
        XCTAssertTrue(status.waitForExistence(timeout: 10))
        let expected = "Passed: two replicas converged, offline outbox survived session restart, and viewer write was refused."
        let complete = NSPredicate(format: "label == %@ OR value == %@", expected, expected)
        expectation(for: complete, evaluatedWith: status)
        waitForExpectations(timeout: 90)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Local collaboration scenario passed"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

private enum FixtureError: Error { case invalidResponse }
