#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_GALLERY_DRAFT_FIXTURE
import XCTest

final class WorldsLocalGalleryDraftUITests: XCTestCase {
    @MainActor func testCaptionOrderSaveAndReopenWithAssets() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-gallery-draft-fixture", "--ui-testing-rtl"]
        app.launch()
        let page = app.descendants(matching: .any)["page.gallery-draft-fixture"].firstMatch
        guard page.waitForExistence(timeout: 30) else { capture(app, "gallery-fixture-missing"); XCTFail("Fixture gallery missing"); return }
        page.tap()
        let edit = app.buttons["edit-fixture-gallery"]
        guard edit.waitForExistence(timeout: 20) else { capture(app, "gallery-fixture-edit-missing"); XCTFail("Fixture editor missing"); return }
        edit.tap()
        let caption = app.textFields["fixture-gallery-caption"]
        guard caption.waitForExistence(timeout: 20) else { capture(app, "gallery-fixture-caption-missing"); XCTFail("Caption missing"); return }
        XCTAssertTrue(app.staticTexts["fixture-gallery-assets"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["fixture-gallery-opaque"].waitForExistence(timeout: 10))
        caption.tap()
        #if os(iOS)
        guard app.keyboards.firstMatch.waitForExistence(timeout: 15) else { capture(app, "gallery-fixture-keyboard-missing"); XCTFail("Keyboard missing"); return }
        #endif
        caption.typeText("Fixture caption")
        app.buttons["Apply caption"].tap()
        let move = app.buttons["fixture-gallery-move.asset-b"]
        guard move.waitForExistence(timeout: 15) else { capture(app, "gallery-fixture-move-missing"); XCTFail("Move action missing"); return }
        move.tap()
        app.buttons["Undo"].tap()
        app.buttons["Redo"].tap()
        let save = app.buttons["fixture-gallery-save"]
        guard save.waitForExistence(timeout: 10), save.isEnabled else { capture(app, "gallery-fixture-save-disabled"); XCTFail("Save unavailable"); return }
        save.tap()
        guard app.staticTexts["fixture-gallery-saved"].waitForExistence(timeout: 30) else { capture(app, "gallery-fixture-save-missing"); XCTFail("Save and asset verification missing"); return }
        app.buttons["Close"].tap()
        guard edit.waitForExistence(timeout: 20) else { XCTFail("Editor action missing after save"); return }
        edit.tap()
        let first = app.buttons["fixture-gallery-item.asset-a"], second = app.buttons["fixture-gallery-item.asset-b"]
        guard first.waitForExistence(timeout: 20), second.waitForExistence(timeout: 20) else { capture(app, "gallery-fixture-reopen-missing"); XCTFail("Gallery items missing after reopen"); return }
        XCTAssertLessThan(second.frame.minY, first.frame.minY)
        XCTAssertTrue(app.staticTexts["fixture-gallery-assets"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["fixture-gallery-opaque"].waitForExistence(timeout: 10))
        first.tap()
        XCTAssertEqual(caption.value as? String, "Fixture caption")
        capture(app, "gallery-fixture-reopened")
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = name + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }
}
#endif
