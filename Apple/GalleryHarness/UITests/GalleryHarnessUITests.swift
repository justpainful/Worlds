import XCTest

final class GalleryHarnessUITests: XCTestCase {
    @MainActor func testFixtureImagesOpenFromAuthorizedHandlesInRTL() {
        let app = XCUIApplication(); app.launchArguments.append("--test-rtl"); app.launch()
        let prepare = app.buttons["Prepare fixture"]
        guard prepare.waitForExistence(timeout: 30) else { XCTFail("Fixture missing"); return }; prepare.tap()
        let first = app.buttons["Add First.png"]
        guard first.waitForExistence(timeout: 30) else { XCTFail("First file action missing"); return }; first.tap()
        XCTAssertTrue(app.staticTexts["gallery-item.a"].waitForExistence(timeout: 20))
        app.buttons["Add Second.png"].tap(); XCTAssertTrue(app.staticTexts["gallery-item.b"].waitForExistence(timeout: 20))
        for id in ["a", "b"] {
            let open = app.buttons["gallery-preview.\(id)"]
            guard open.waitForExistence(timeout: 10) else { XCTFail("Image action missing"); return }
            XCTAssertEqual(open.label, id == "a" ? "View image: First.png" : "View image: Second.png")
            open.tap()
            let image = app.descendants(matching: .any)["opened-image-preview"].firstMatch
            guard image.waitForExistence(timeout: 20) else {
                let detail = XCTAttachment(string: app.debugDescription); detail.name = "gallery-image-error-\(id)"; detail.lifetime = .keepAlways; add(detail)
                XCTFail("Image preview did not open"); return
            }
            let surface = app.descendants(matching: .any)["opened-image-surface"].firstMatch
            guard surface.waitForExistence(timeout: 10) else {
                let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "gallery-image-surface-missing-\(id)"; screenshot.lifetime = .keepAlways; add(screenshot)
                let tree = XCTAttachment(string: app.debugDescription); tree.name = "gallery-image-surface-missing-\(id)-hierarchy"; tree.lifetime = .keepAlways; add(tree)
                XCTFail("Image surface missing"); return
            }
            XCTAssertEqual(surface.label, id == "a" ? "Image preview: First.png" : "Image preview: Second.png")
            let zoom = app.descendants(matching: .any)["opened-image-zoom-level"].firstMatch
            let plus = app.buttons["opened-image-zoom-in"], minus = app.buttons["opened-image-zoom-out"]
            let reset = app.buttons["opened-image-zoom-reset"]
            XCTAssertTrue(zoom.waitForExistence(timeout: 10))
            XCTAssertTrue(plus.isHittable)
            XCTAssertEqual(zoom.label, "Zoom 100 percent")
            plus.tap()
            XCTAssertEqual(zoom.label, "Zoom 200 percent")
            minus.tap()
            XCTAssertEqual(zoom.label, "Zoom 100 percent")
            plus.tap()
            XCTAssertTrue(reset.isEnabled)
            reset.tap()
            XCTAssertEqual(zoom.label, "Zoom 100 percent")
            let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "gallery-image-\(id)-rtl"; shot.lifetime = .keepAlways; add(shot)
            app.buttons["Back"].tap()
        }
    }
    @MainActor func testAttachmentChangedAfterOpenBlocksPreview() {
        let app = XCUIApplication(); app.launchArguments.append("--ui-testing-gallery-after-open-record-change"); app.launch()
        let prepare = app.buttons["Prepare fixture"]
        guard prepare.waitForExistence(timeout: 30) else { XCTFail("Fixture missing"); return }; prepare.tap()
        let first = app.buttons["Add First.png"]
        guard first.waitForExistence(timeout: 30) else { XCTFail("First file action missing"); return }; first.tap()
        XCTAssertTrue(app.staticTexts["gallery-item.a"].waitForExistence(timeout: 20))
        app.buttons["gallery-preview.a"].tap()
        XCTAssertTrue(app.staticTexts["gallery-after-open-mutation"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["gallery-error"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.descendants(matching: .any)["opened-image-preview"].exists)
    }
    @MainActor func testLargeRTLImageZoomControlsRemainReachable() {
        let app = XCUIApplication(); app.launchArguments += ["--test-rtl", "--test-large-text"]; app.launch()
        let prepare = app.buttons["Prepare fixture"]
        guard prepare.waitForExistence(timeout: 30) else { XCTFail("Fixture missing"); return }
        prepare.tap()
        let first = app.buttons["Add First.png"]
        guard first.waitForExistence(timeout: 30) else { XCTFail("First file action missing"); return }
        first.tap()
        let open = app.buttons["gallery-preview.a"]
        for _ in 0..<8 {
            if open.exists && open.isHittable { break }
            app.swipeUp()
        }
        guard open.exists && open.isHittable else {
            let detail = XCTAttachment(string: app.debugDescription); detail.name = "gallery-large-rtl-open-missing"; detail.lifetime = .keepAlways; add(detail)
            XCTFail("Image action is not reachable"); return
        }
        open.tap()
        let zoom = app.buttons["opened-image-zoom-in"]
        let reset = app.buttons["opened-image-zoom-reset"]
        guard zoom.waitForExistence(timeout: 20), reset.exists else {
            let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "gallery-zoom-missing"; screenshot.lifetime = .keepAlways; add(screenshot)
            let tree = XCTAttachment(string: app.debugDescription); tree.name = "gallery-zoom-missing-hierarchy"; tree.lifetime = .keepAlways; add(tree)
            XCTFail("Zoom controls missing"); return
        }
        XCTAssertTrue(zoom.isHittable)
        let window = app.windows.firstMatch
        XCTAssertTrue(window.frame.contains(zoom.frame))
        XCTAssertTrue(window.frame.contains(reset.frame))
        zoom.tap()
        XCTAssertTrue(reset.isEnabled)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "gallery-large-rtl-zoom"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
    @MainActor func testChangedFixtureOwnerOrSizeBlocksPreview() {
        for action in ["gallery-change-fixture-owner", "gallery-change-fixture-size"] {
            let app = XCUIApplication(); app.launchArguments.append("--ui-testing-gallery-record-failure"); app.launch()
            let prepare = app.buttons["Prepare fixture"]
            guard prepare.waitForExistence(timeout: 30) else { XCTFail("Fixture missing"); return }; prepare.tap()
            let first = app.buttons["Add First.png"]
            guard first.waitForExistence(timeout: 30) else { XCTFail("First file action missing"); return }; first.tap()
            XCTAssertTrue(app.staticTexts["gallery-item.a"].waitForExistence(timeout: 20))
            app.buttons[action].tap(); app.buttons["gallery-preview.a"].tap()
            XCTAssertTrue(app.staticTexts["gallery-error"].waitForExistence(timeout: 20))
            XCTAssertFalse(app.descendants(matching: .any)["opened-image-preview"].exists)
            app.terminate()
        }
    }
    @MainActor func testMissingFixtureImageReportsErrorWithoutPreview() {
        let app = XCUIApplication(); app.launchArguments.append("--ui-testing-gallery-preview-failure"); app.launch()
        let prepare = app.buttons["Prepare fixture"]
        guard prepare.waitForExistence(timeout: 30) else { XCTFail("Fixture missing"); return }; prepare.tap()
        let first = app.buttons["Add First.png"]
        guard first.waitForExistence(timeout: 30) else { XCTFail("First file action missing"); return }; first.tap()
        XCTAssertTrue(app.staticTexts["gallery-item.a"].waitForExistence(timeout: 20))
        app.buttons["gallery-remove-fixture-image"].tap()
        app.buttons["gallery-preview.a"].tap()
        let error = app.staticTexts["gallery-error"]
        XCTAssertTrue(error.waitForExistence(timeout: 20))
        let message = error.value as? String ?? error.label
        XCTAssertEqual(message, "The attachment cannot be opened.")
        XCTAssertFalse(app.descendants(matching: .any)["opened-image-preview"].exists)
    }
    @MainActor func testDraftCaptionReorderUndoSaveAndReopen() {
        let app = XCUIApplication(); app.launch()
        let prepare = app.buttons["Prepare fixture"]
        guard prepare.waitForExistence(timeout: 30) else { XCTFail("Fixture missing"); return }; prepare.tap()
        let first = app.buttons["Add First.png"]
        guard first.waitForExistence(timeout: 30) else { XCTFail("First file action missing"); return }; first.tap()
        XCTAssertTrue(app.staticTexts["gallery-item.a"].waitForExistence(timeout: 20))
        app.buttons["Add Second.png"].tap()
        XCTAssertTrue(app.staticTexts["gallery-item.b"].waitForExistence(timeout: 20))
        app.buttons["gallery-begin-draft"].tap()
        let caption = app.descendants(matching: .any)["gallery-draft-caption"].firstMatch
        guard caption.waitForExistence(timeout: 20) else { XCTFail("Caption field missing"); return }
        caption.tap(); caption.typeText("Caption A"); app.buttons["Apply caption"].tap()
        let a = app.buttons["gallery-draft-item.a"], b = app.buttons["gallery-draft-item.b"]
        XCTAssertLessThan(a.frame.minY, b.frame.minY)
        app.buttons["gallery-draft-move.b"].tap(); XCTAssertLessThan(b.frame.minY, a.frame.minY)
        app.buttons["Undo draft"].tap(); XCTAssertLessThan(a.frame.minY, b.frame.minY)
        app.buttons["Redo draft"].tap(); XCTAssertLessThan(b.frame.minY, a.frame.minY)
        app.buttons["gallery-save-draft"].tap()
        XCTAssertTrue(app.staticTexts["gallery-draft-saved"].waitForExistence(timeout: 20))
        app.buttons["gallery-close-draft"].tap(); app.buttons["Reopen gallery"].tap()
        XCTAssertTrue(app.staticTexts["gallery-reopened"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["gallery-unknown-preserved"].exists)
        XCTAssertTrue(app.staticTexts["gallery-source-unchanged"].exists)
        app.buttons["gallery-begin-draft"].tap()
        XCTAssertLessThan(b.frame.minY, a.frame.minY); a.tap()
        XCTAssertEqual(caption.value as? String, "Caption A")
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "gallery-draft-reopened"; image.lifetime = .keepAlways; add(image)
    }
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
        XCTAssertTrue(app.staticTexts["gallery-reopened"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["gallery-move.a"].waitForExistence(timeout: 20))
        XCTAssertLessThan(second.frame.minY, firstItem.frame.minY)
        XCTAssertTrue(app.staticTexts["gallery-unknown-preserved"].exists)
        XCTAssertTrue(app.staticTexts["gallery-source-unchanged"].exists)
        let missing = app.buttons["Add Missing.png"]
        XCTAssertTrue(missing.isEnabled); XCTAssertTrue(missing.isHittable); missing.tap()
        XCTAssertTrue(app.staticTexts["gallery-error"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["gallery-item.missing"].exists)
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "gallery-reopened-and-missing"; image.lifetime = .keepAlways; add(image)
    }
}
