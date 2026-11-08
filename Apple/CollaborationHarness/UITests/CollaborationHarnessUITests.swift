import XCTest
import AppKit

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
        let continueButton = app.buttons["scenario.continue"]
        XCTAssertTrue(continueButton.waitForExistence(timeout: 60), "The real offline outbox checkpoint did not appear")
        let connection = app.descendants(matching: .any)["collaboration-connection-status"].firstMatch
        XCTAssertTrue(connection.exists)
        let authenticated = NSPredicate(format: "label == %@ OR value == %@ OR label == %@ OR value == %@", "Connected: can edit", "Connected: can edit", "Connected: full access", "Connected: full access")
        expectation(for: authenticated, evaluatedWith: connection)
        waitForExpectations(timeout: 10)
        let queue = app.descendants(matching: .any)["scenario.queue"].firstMatch
        XCTAssertTrue(queue.exists)
        let waiting = "Second replica: local change waiting in outbox."
        XCTAssertTrue(queue.label == waiting || (queue.value as? String) == waiting)
        let offlineScreenshot = XCTAttachment(screenshot: app.screenshot())
        offlineScreenshot.name = "Authenticated session and offline outbox"
        offlineScreenshot.lifetime = .keepAlways
        add(offlineScreenshot)
        continueButton.click()
        let expected = "Passed: two replicas converged, offline outbox survived session restart, and viewer write was refused."
        let complete = NSPredicate(format: "label == %@ OR value == %@", expected, expected)
        expectation(for: complete, evaluatedWith: status)
        waitForExpectations(timeout: 90)
        let empty = "Second replica: no pending channel 0 outbox entries at last check."
        XCTAssertTrue(queue.label == empty || (queue.value as? String) == empty)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Local collaboration scenario passed"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    @MainActor func testMissingServiceConfigurationShowsFailure() {
        let app = XCUIApplication()
        app.launchEnvironment["WORLDS_REQUIRE_LIVE_SERVICE"] = "0"
        app.launch()
        let start = app.buttons["scenario.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 10))
        start.click()
        let status = app.descendants(matching: .any)["scenario.status"].firstMatch
        let message = "Scenario failed: The local service configuration or fixture tokens are missing."
        let failed = NSPredicate(format: "label == %@ OR value == %@", message, message)
        expectation(for: failed, evaluatedWith: status)
        waitForExpectations(timeout: 10)
        XCTAssertFalse(app.buttons["scenario.continue"].exists)
    }

    @MainActor func testCheckedAppendAndConditionalUndo() throws {
        let tokenURL = try XCTUnwrap(URL(string: "http://127.0.0.1:18791/dev/token?sub=editor"))
        let response = try JSONSerialization.jsonObject(with: Data(contentsOf: tokenURL)) as? [String: Any]
        let token = try XCTUnwrap(response?["token"] as? String)
        XCTAssertFalse(token.isEmpty)
        let app = XCUIApplication()
        app.launchArguments.append("--test-hold-checked-operation")
        app.launchEnvironment["WORLDS_REQUIRE_LIVE_SERVICE"] = "1"
        app.launchEnvironment["WORLDS_LIVE_SYNC_URL"] = "ws://127.0.0.1:18790"
        app.launchEnvironment["WORLDS_LIVE_EDITOR_TOKEN"] = token
        app.launch()
        let open = app.buttons["checked.open"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.click()
        let document = app.descendants(matching: .any)["checked.document"].firstMatch
        XCTAssertTrue(document.waitForExistence(timeout: 30))
        let initial = NSPredicate(format: "label == %@ OR value == %@", "Hello 🌍", "Hello 🌍")
        expectation(for: initial, evaluatedWith: document)
        waitForExpectations(timeout: 30)
        let draft = app.textFields["checked.draft"]
        XCTAssertTrue(draft.waitForExistence(timeout: 10))
        draft.click(); draft.typeText(" test")
        app.buttons["checked.append"].click()
        let editingBlocked = NSPredicate(format: "enabled == false")
        expectation(for: editingBlocked, evaluatedWith: draft)
        waitForExpectations(timeout: 10)
        XCTAssertEqual(draft.value as? String, " test")
        let continueOperation = app.buttons["checked.test-continue"]
        XCTAssertTrue(continueOperation.waitForExistence(timeout: 10))
        continueOperation.click()
        let appended = NSPredicate(format: "label == %@ OR value == %@", "Hello 🌍 test", "Hello 🌍 test")
        expectation(for: appended, evaluatedWith: document)
        waitForExpectations(timeout: 30)
        let undo = app.buttons["checked.undo"]
        XCTAssertTrue(undo.isEnabled)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Checked insertion in isolated collaboration"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        undo.click()
        expectation(for: initial, evaluatedWith: document)
        waitForExpectations(timeout: 30)
        XCTAssertFalse(undo.isEnabled)
    }

    @MainActor func testCheckedUnicodePasteAndConditionalUndo() throws {
        let tokenURL = try XCTUnwrap(URL(string: "http://127.0.0.1:18791/dev/token?sub=editor"))
        let response = try JSONSerialization.jsonObject(with: Data(contentsOf: tokenURL)) as? [String: Any]
        let token = try XCTUnwrap(response?["token"] as? String)
        XCTAssertFalse(token.isEmpty)
        let app = XCUIApplication()
        app.launchEnvironment["WORLDS_REQUIRE_LIVE_SERVICE"] = "1"
        app.launchEnvironment["WORLDS_LIVE_SYNC_URL"] = "ws://127.0.0.1:18790"
        app.launchEnvironment["WORLDS_LIVE_EDITOR_TOKEN"] = token
        app.launch()
        let open = app.buttons["checked.open"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.click()
        let document = app.descendants(matching: .any)["checked.document"].firstMatch
        let initial = "Hello 🌍"
        XCTAssertEqual(initial.utf16.count, 8)
        XCTAssertEqual(" مرحبا 👋".utf16.count, 9)
        let original = NSPredicate(format: "label == %@ OR value == %@", initial, initial)
        expectation(for: original, evaluatedWith: document)
        waitForExpectations(timeout: 30)
        let draft = app.textFields["checked.draft"]
        XCTAssertTrue(draft.waitForExistence(timeout: 10))
        let pasteboard = NSPasteboard.general
        let snapshotChangeCount = pasteboard.changeCount
        let existingItems = pasteboard.pasteboardItems
        if existingItems == nil && !(pasteboard.types ?? []).isEmpty {
            throw XCTSkip("The existing pasteboard items cannot be inspected.")
        }
        let saved = try (existingItems ?? []).map { item -> NSPasteboardItem in
            let copy = NSPasteboardItem()
            for type in item.types {
                guard let data = item.data(forType: type), copy.setData(data, forType: type) else {
                    throw XCTSkip("The existing pasteboard cannot be preserved for this test.")
                }
            }
            return copy
        }
        guard pasteboard.changeCount == snapshotChangeCount else {
            throw XCTSkip("The pasteboard changed while preparing the test.")
        }
        pasteboard.clearContents()
        var testChangeCount = pasteboard.changeCount
        defer {
            if pasteboard.changeCount == testChangeCount {
                pasteboard.clearContents()
                if !saved.isEmpty { _ = pasteboard.writeObjects(saved) }
            }
        }
        guard pasteboard.setString(" مرحبا 👋", forType: .string) else {
            throw FixtureError.invalidResponse
        }
        testChangeCount = pasteboard.changeCount
        draft.click()
        draft.typeKey("v", modifierFlags: .command)
        XCTAssertEqual(draft.value as? String, " مرحبا 👋")
        app.buttons["checked.append"].click()
        let result = "Hello 🌍 مرحبا 👋"
        let appended = NSPredicate(format: "label == %@ OR value == %@", result, result)
        expectation(for: appended, evaluatedWith: document)
        waitForExpectations(timeout: 30)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Unicode insertion in isolated collaboration"
        attachment.lifetime = .keepAlways
        add(attachment)
        let undo = app.buttons["checked.undo"]
        XCTAssertTrue(undo.isEnabled)
        undo.click()
        expectation(for: original, evaluatedWith: document)
        waitForExpectations(timeout: 30)
        XCTAssertFalse(undo.isEnabled)
    }
}

private enum FixtureError: Error { case invalidResponse }
