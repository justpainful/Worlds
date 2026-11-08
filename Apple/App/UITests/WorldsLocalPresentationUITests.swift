#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
import XCTest
final class WorldsLocalPresentationUITests: XCTestCase {
    @MainActor func testDeleteUndoRedoAndReopenKeepsAttachmentRecord() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-presentation-fixture"]; app.launch()
        let page = app.descendants(matching: .any)["page.deck-test"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-presentation"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let slideA = app.buttons["presentation-slide.slide-a"], slideB = app.buttons["presentation-slide.slide-b"]
        XCTAssertTrue(slideA.waitForExistence(timeout: 20)); XCTAssertTrue(slideB.exists)
        let delete = app.buttons["presentation-delete-slide"]
        XCTAssertTrue(delete.isEnabled); delete.tap()
        let confirm = app.buttons["presentation-confirm-delete"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10)); confirm.tap()
        XCTAssertFalse(slideA.exists); XCTAssertTrue(slideB.exists); XCTAssertFalse(delete.isEnabled)
        let undo = app.buttons["Undo"]; XCTAssertTrue(undo.isEnabled); undo.tap(); XCTAssertTrue(slideA.waitForExistence(timeout: 10))
        let redo = app.buttons["Redo"]; XCTAssertTrue(redo.isEnabled); redo.tap(); XCTAssertFalse(slideA.exists)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["presentation-media-record-retained"].waitForExistence(timeout: 10))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(slideB.waitForExistence(timeout: 20)); XCTAssertFalse(slideA.exists); XCTAssertFalse(delete.isEnabled)
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "presentation-slide-deleted"; image.lifetime = .keepAlways; add(image)
    }
    @MainActor func testAddDuplicateReorderUndoAndReopen() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-presentation-fixture"]; app.launch()
        let page = app.descendants(matching: .any)["page.deck-test"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-presentation"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let count = app.staticTexts["presentation-slide-count"]
        XCTAssertTrue(count.waitForExistence(timeout: 20)); XCTAssertEqual(count.label, "2 slides")
        let add = app.buttons["presentation-add-blank"]
        if !add.isHittable { app.swipeUp() }
        XCTAssertTrue(add.waitForExistence(timeout: 10)); add.tap()
        XCTAssertEqual(count.label, "3 slides")
        let duplicate = app.buttons["presentation-duplicate-slide"]
        if !duplicate.isHittable { app.swipeUp() }; duplicate.tap()
        XCTAssertEqual(count.label, "4 slides")
        app.buttons["presentation-move-down"].tap()
        app.buttons["Undo"].tap(); app.buttons["Redo"].tap()
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["presentation-media-record-retained"].waitForExistence(timeout: 10))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(count.waitForExistence(timeout: 20)); XCTAssertEqual(count.label, "4 slides")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "presentation-created-and-reopened"; shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor func testEditReorderSaveAndReopen() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-presentation-fixture"]; app.launch()
        let page = app.descendants(matching: .any)["page.deck-test"].firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 30)); page.tap()
        let edit = app.buttons["edit-local-presentation"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let field = app.descendants(matching: .any)["presentation-text"].firstMatch
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
        app.buttons["presentation-slide.slide-b"].tap()
        XCTAssertEqual(field.value as? String, "Second slide", "Element IDs may recur on different slides")
        app.buttons["Move slide up"].tap()
        XCTAssertLessThan(app.buttons["presentation-slide.slide-b"].frame.minY, app.buttons["presentation-slide.slide-a"].frame.minY)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20))
        app.buttons["Close"].tap()
        XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        let slideA = app.buttons["presentation-slide.slide-a"]
        XCTAssertTrue(slideA.waitForExistence(timeout: 20))
        XCTAssertLessThan(app.buttons["presentation-slide.slide-b"].frame.minY, slideA.frame.minY)
        slideA.tap()
        XCTAssertEqual(app.descendants(matching: .any)["presentation-text"].firstMatch.value as? String, "Edited slide")
        XCTAssertTrue(app.staticTexts["presentation-unsupported-elements"].exists)
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "local-presentation-reopened"; image.lifetime = .keepAlways; add(image)
    }
}
#endif
