#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
import XCTest
final class WorldsLocalPresentationUITests: XCTestCase {
    @MainActor func testSpeakerNotesSaveAndReopenKeepsMedia() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-presentation-fixture"]; app.launch()
        let page = app.descendants(matching: .any)["page.deck-test"].firstMatch
        guard page.waitForExistence(timeout: 30) else { failure(app, "notes-page-missing"); XCTFail("Presentation page missing"); return }; page.tap()
        let edit = app.buttons["edit-local-presentation"]
        guard edit.waitForExistence(timeout: 20) else { failure(app, "notes-edit-missing"); XCTFail("Presentation editor missing"); return }; edit.tap()
        let notes = app.descendants(matching: .any)["presentation-notes"].firstMatch
        guard notes.waitForExistence(timeout: 20) else { failure(app, "notes-field-missing"); XCTFail("Notes field missing"); return }
        notes.tap(); notes.typeText("Speaker notes")
        let apply = app.buttons["presentation-apply-notes"]; XCTAssertTrue(apply.isEnabled); apply.tap()
        app.buttons["Save"].tap()
        guard app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20) else { failure(app, "notes-save-missing"); XCTFail("Notes save missing"); return }
        XCTAssertTrue(app.staticTexts["presentation-media-record-retained"].waitForExistence(timeout: 10))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(notes.waitForExistence(timeout: 20)); XCTAssertEqual(notes.value as? String, "Speaker notes")
        XCTAssertTrue(app.staticTexts["presentation-unsupported-elements"].exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "presentation-notes-reopened"; screenshot.lifetime = .keepAlways; add(screenshot)
    }
    @MainActor func testPartialPreviewUsesSelectedSlideAndShowsLimits() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-presentation-fixture"]; app.launch()
        let page = app.descendants(matching: .any)["page.deck-test"].firstMatch
        guard page.waitForExistence(timeout: 30) else { failure(app, "preview-page-missing"); XCTFail("Presentation page missing"); return }; page.tap()
        let edit = app.buttons["edit-local-presentation"]
        guard edit.waitForExistence(timeout: 20) else { failure(app, "preview-edit-missing"); XCTFail("Presentation editor missing"); return }; edit.tap()
        let toggle = app.descendants(matching: .any)["presentation-preview-toggle"].firstMatch
        guard toggle.waitForExistence(timeout: 20) else { failure(app, "preview-toggle-missing"); XCTFail("Preview toggle missing"); return }; toggle.tap()
        XCTAssertTrue(app.staticTexts["presentation-preview-limitations"].waitForExistence(timeout: 10))
        let renderedText = app.staticTexts["First slide"].firstMatch
        XCTAssertTrue(renderedText.waitForExistence(timeout: 10))
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "presentation-partial-preview"; image.lifetime = .keepAlways; add(image)
    }
    @MainActor func testReorderTextUndoAndReopenKeepsMedia() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-presentation-fixture", "--ui-testing-presentation-element-order"]; app.launch()
        let page = app.descendants(matching: .any)["page.deck-test"].firstMatch
        guard page.waitForExistence(timeout: 30) else { failure(app, "order-page-missing"); XCTFail("Presentation page missing"); return }; page.tap()
        let edit = app.buttons["edit-local-presentation"]
        guard edit.waitForExistence(timeout: 20) else { failure(app, "order-edit-missing"); XCTFail("Presentation editor missing"); return }; edit.tap()
        let first = app.buttons["First slide"], second = app.buttons["Second text"]
        guard first.waitForExistence(timeout: 20), second.waitForExistence(timeout: 20) else { failure(app, "order-elements-missing"); XCTFail("Text elements missing"); return }
        XCTAssertLessThan(first.frame.minY, second.frame.minY)
        let forward = app.buttons["presentation-element-forward"]; if !forward.isHittable { app.swipeUp() }
        XCTAssertTrue(forward.isEnabled); forward.tap()
        XCTAssertLessThan(second.frame.minY, first.frame.minY)
        app.buttons["Undo"].tap(); XCTAssertLessThan(first.frame.minY, second.frame.minY)
        app.buttons["Redo"].tap(); XCTAssertLessThan(second.frame.minY, first.frame.minY)
        app.buttons["Save"].tap()
        guard app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20) else { failure(app, "order-save-missing"); XCTFail("Element order save missing"); return }
        XCTAssertTrue(app.staticTexts["presentation-media-record-retained"].waitForExistence(timeout: 10))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(first.waitForExistence(timeout: 20)); XCTAssertTrue(second.waitForExistence(timeout: 20))
        XCTAssertLessThan(second.frame.minY, first.frame.minY)
        XCTAssertTrue(app.staticTexts["presentation-unsupported-elements"].exists)
    }
    @MainActor func testBackgroundColorUndoAndReopenKeepsMedia() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-presentation-fixture"]; app.launch()
        let page = app.descendants(matching: .any)["page.deck-test"].firstMatch
        guard page.waitForExistence(timeout: 30) else { failure(app, "background-page-missing"); XCTFail("Presentation page missing"); return }; page.tap()
        let edit = app.buttons["edit-local-presentation"]
        guard edit.waitForExistence(timeout: 20) else { failure(app, "background-edit-missing"); XCTFail("Presentation editor missing"); return }; edit.tap()
        let menu = app.descendants(matching: .any)["presentation-background-color-menu"].firstMatch
        guard menu.waitForExistence(timeout: 20) else { failure(app, "background-menu-missing"); XCTFail("Background menu missing"); return }
        XCTAssertTrue(menu.label.contains("#16161a")); menu.tap()
        let color = app.descendants(matching: .any)["presentation-background-color.#f7f5f0"].firstMatch
        guard color.waitForExistence(timeout: 10) else { failure(app, "background-option-missing"); XCTFail("Background option missing"); return }; color.tap()
        XCTAssertTrue(menu.label.contains("#f7f5f0"))
        app.buttons["Undo"].tap(); XCTAssertTrue(menu.label.contains("#16161a"))
        app.buttons["Redo"].tap(); XCTAssertTrue(menu.label.contains("#f7f5f0"))
        app.buttons["Save"].tap()
        guard app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20) else { failure(app, "background-save-missing"); XCTFail("Background save missing"); return }
        XCTAssertTrue(app.staticTexts["presentation-media-record-retained"].waitForExistence(timeout: 10))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(menu.waitForExistence(timeout: 20)); XCTAssertTrue(menu.label.contains("#f7f5f0"))
        XCTAssertTrue(app.staticTexts["presentation-unsupported-elements"].exists)
    }
    @MainActor func testRotateTextUndoAndReopenKeepsMedia() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-presentation-fixture"]; app.launch()
        let page = app.descendants(matching: .any)["page.deck-test"].firstMatch
        guard page.waitForExistence(timeout: 30) else { failure(app, "rotate-page-missing"); XCTFail("Presentation page missing"); return }; page.tap()
        let edit = app.buttons["edit-local-presentation"]
        guard edit.waitForExistence(timeout: 20) else { failure(app, "rotate-edit-missing"); XCTFail("Presentation editor missing"); return }; edit.tap()
        let position = app.staticTexts["presentation-text-rotation"]
        guard position.waitForExistence(timeout: 20) else { failure(app, "rotate-position-missing"); XCTFail("Text rotation missing"); return }
        XCTAssertEqual(position.label, "Rotation: 0°")
        app.buttons["presentation-text-rotate-right"].tap(); XCTAssertEqual(position.label, "Rotation: 1°")
        app.buttons["Undo"].tap(); XCTAssertEqual(position.label, "Rotation: 0°")
        app.buttons["Redo"].tap(); XCTAssertEqual(position.label, "Rotation: 1°")
        app.buttons["Save"].tap()
        guard app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20) else { failure(app, "rotate-save-missing"); XCTFail("Rotation save missing"); return }
        XCTAssertTrue(app.staticTexts["presentation-media-record-retained"].waitForExistence(timeout: 10))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(position.waitForExistence(timeout: 20)); XCTAssertEqual(position.label, "Rotation: 1°")
        XCTAssertTrue(app.staticTexts["presentation-unsupported-elements"].exists)
    }
    @MainActor func testMoveTextUndoAndReopenKeepsMedia() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-presentation-fixture"]; app.launch()
        let page = app.descendants(matching: .any)["page.deck-test"].firstMatch
        guard page.waitForExistence(timeout: 30) else { failure(app, "move-page-missing"); XCTFail("Presentation page missing"); return }; page.tap()
        let edit = app.buttons["edit-local-presentation"]
        guard edit.waitForExistence(timeout: 20) else { failure(app, "move-edit-missing"); XCTFail("Presentation editor missing"); return }; edit.tap()
        let position = app.staticTexts["presentation-text-position"]
        guard position.waitForExistence(timeout: 20) else { failure(app, "move-position-missing"); XCTFail("Text position missing"); return }
        XCTAssertEqual(position.label, "Position: 20, 30")
        app.buttons["presentation-text-right"].tap(); XCTAssertEqual(position.label, "Position: 21, 30")
        app.buttons["Undo"].tap(); XCTAssertEqual(position.label, "Position: 20, 30")
        app.buttons["Redo"].tap(); XCTAssertEqual(position.label, "Position: 21, 30")
        app.buttons["Save"].tap()
        guard app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20) else { failure(app, "move-save-missing"); XCTFail("Position save missing"); return }
        XCTAssertTrue(app.staticTexts["presentation-media-record-retained"].waitForExistence(timeout: 10))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(position.waitForExistence(timeout: 20)); XCTAssertEqual(position.label, "Position: 21, 30")
        XCTAssertTrue(app.staticTexts["presentation-unsupported-elements"].exists)
    }
    @MainActor func testTextColorUndoAndReopenKeepsMedia() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-presentation-fixture"]; app.launch()
        let page = app.descendants(matching: .any)["page.deck-test"].firstMatch
        guard page.waitForExistence(timeout: 30) else { failure(app, "color-page-missing"); XCTFail("Presentation page missing"); return }; page.tap()
        let edit = app.buttons["edit-local-presentation"]
        guard edit.waitForExistence(timeout: 20) else { failure(app, "color-edit-missing"); XCTFail("Presentation editor missing"); return }; edit.tap()
        let menu = app.descendants(matching: .any)["presentation-text-color-menu"].firstMatch
        guard menu.waitForExistence(timeout: 20) else { failure(app, "color-menu-missing"); XCTFail("Color menu missing"); return }
        XCTAssertTrue(menu.label.contains("Default")); menu.tap()
        let color = app.descendants(matching: .any)["presentation-text-color.#e5484d"].firstMatch
        guard color.waitForExistence(timeout: 10) else { failure(app, "color-option-missing"); XCTFail("Color option missing"); return }; color.tap()
        XCTAssertTrue(menu.label.contains("#e5484d"))
        app.buttons["Undo"].tap(); XCTAssertTrue(menu.label.contains("Default"))
        app.buttons["Redo"].tap(); XCTAssertTrue(menu.label.contains("#e5484d"))
        app.buttons["Save"].tap()
        guard app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20) else { failure(app, "color-save-missing"); XCTFail("Color save missing"); return }
        XCTAssertTrue(app.staticTexts["presentation-media-record-retained"].waitForExistence(timeout: 10))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(menu.waitForExistence(timeout: 20)); XCTAssertTrue(menu.label.contains("#e5484d"))
        XCTAssertTrue(app.staticTexts["presentation-unsupported-elements"].exists)
    }
    @MainActor func testChooseFontSizeUndoAndReopenKeepsMedia() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-presentation-fixture"]; app.launch()
        let page = app.descendants(matching: .any)["page.deck-test"].firstMatch
        guard page.waitForExistence(timeout: 30) else { failure(app, "choose-size-page-missing"); XCTFail("Presentation page missing"); return }; page.tap()
        let edit = app.buttons["edit-local-presentation"]
        guard edit.waitForExistence(timeout: 20) else { failure(app, "choose-size-edit-missing"); XCTFail("Presentation editor missing"); return }; edit.tap()
        let size = app.staticTexts["presentation-font-size"]
        guard size.waitForExistence(timeout: 20) else { failure(app, "choose-size-control-missing"); XCTFail("Font size missing"); return }
        XCTAssertEqual(size.label, "32")
        let menu = app.descendants(matching: .any)["presentation-font-size-menu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 10)); menu.tap()
        let choice = app.descendants(matching: .any)["presentation-font-size-choice.48"].firstMatch
        guard choice.waitForExistence(timeout: 10) else { failure(app, "choose-size-option-missing"); XCTFail("Font size option missing"); return }; choice.tap()
        XCTAssertEqual(size.label, "48")
        app.buttons["Undo"].tap(); XCTAssertEqual(size.label, "32")
        app.buttons["Redo"].tap(); XCTAssertEqual(size.label, "48")
        app.buttons["Save"].tap()
        guard app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20) else { failure(app, "choose-size-save-missing"); XCTFail("Font size save missing"); return }
        XCTAssertTrue(app.staticTexts["presentation-media-record-retained"].waitForExistence(timeout: 10))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(size.waitForExistence(timeout: 20)); XCTAssertEqual(size.label, "48")
        XCTAssertTrue(app.staticTexts["presentation-unsupported-elements"].exists)
    }
    @MainActor func testFontSizeUndoAndReopenKeepsMedia() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-presentation-fixture"]; app.launch()
        let page = app.descendants(matching: .any)["page.deck-test"].firstMatch
        guard page.waitForExistence(timeout: 30) else { failure(app, "size-page-missing"); XCTFail("Presentation page missing"); return }; page.tap()
        let edit = app.buttons["edit-local-presentation"]
        guard edit.waitForExistence(timeout: 20) else { failure(app, "size-edit-missing"); XCTFail("Presentation editor missing"); return }; edit.tap()
        let size = app.staticTexts["presentation-font-size"]
        guard size.waitForExistence(timeout: 20) else { failure(app, "size-control-missing"); XCTFail("Font size missing"); return }
        XCTAssertEqual(size.label, "32"); app.buttons["presentation-text-larger"].tap(); XCTAssertEqual(size.label, "40")
        app.buttons["Undo"].tap(); XCTAssertEqual(size.label, "32")
        app.buttons["Redo"].tap(); XCTAssertEqual(size.label, "40")
        app.buttons["Save"].tap()
        guard app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20) else { failure(app, "size-save-missing"); XCTFail("Font size save missing"); return }
        XCTAssertTrue(app.staticTexts["presentation-media-record-retained"].waitForExistence(timeout: 10))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(size.waitForExistence(timeout: 20)); XCTAssertEqual(size.label, "40")
        XCTAssertTrue(app.staticTexts["presentation-unsupported-elements"].exists)
    }
    @MainActor func testItalicTextUndoAndReopenKeepsMedia() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-presentation-fixture"]; app.launch()
        let page = app.descendants(matching: .any)["page.deck-test"].firstMatch
        guard page.waitForExistence(timeout: 30) else { failure(app, "italic-page-missing"); XCTFail("Presentation page missing"); return }; page.tap()
        let edit = app.buttons["edit-local-presentation"]
        guard edit.waitForExistence(timeout: 20) else { failure(app, "italic-edit-missing"); XCTFail("Presentation editor missing"); return }; edit.tap()
        let bold = app.buttons["presentation-text-italic"]
        guard bold.waitForExistence(timeout: 20) else { failure(app, "italic-control-missing"); XCTFail("Italic control missing"); return }
        XCTAssertEqual(bold.value as? String, "Off"); bold.tap(); XCTAssertEqual(bold.value as? String, "On")
        app.buttons["Undo"].tap(); XCTAssertEqual(bold.value as? String, "Off")
        app.buttons["Redo"].tap(); XCTAssertEqual(bold.value as? String, "On")
        app.buttons["Save"].tap()
        guard app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20) else { failure(app, "italic-save-missing"); XCTFail("Bold save missing"); return }
        XCTAssertTrue(app.staticTexts["presentation-media-record-retained"].waitForExistence(timeout: 10))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(bold.waitForExistence(timeout: 20)); XCTAssertEqual(bold.value as? String, "On")
        XCTAssertTrue(app.staticTexts["presentation-unsupported-elements"].exists)
    }
    @MainActor func testBoldTextUndoAndReopenKeepsMedia() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-presentation-fixture"]; app.launch()
        let page = app.descendants(matching: .any)["page.deck-test"].firstMatch
        guard page.waitForExistence(timeout: 30) else { failure(app, "bold-page-missing"); XCTFail("Presentation page missing"); return }; page.tap()
        let edit = app.buttons["edit-local-presentation"]
        guard edit.waitForExistence(timeout: 20) else { failure(app, "bold-edit-missing"); XCTFail("Presentation editor missing"); return }; edit.tap()
        let bold = app.buttons["presentation-text-bold"]
        guard bold.waitForExistence(timeout: 20) else { failure(app, "bold-control-missing"); XCTFail("Bold control missing"); return }
        XCTAssertEqual(bold.value as? String, "Off"); bold.tap(); XCTAssertEqual(bold.value as? String, "On")
        app.buttons["Undo"].tap(); XCTAssertEqual(bold.value as? String, "Off")
        app.buttons["Redo"].tap(); XCTAssertEqual(bold.value as? String, "On")
        app.buttons["Save"].tap()
        guard app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20) else { failure(app, "bold-save-missing"); XCTFail("Bold save missing"); return }
        XCTAssertTrue(app.staticTexts["presentation-media-record-retained"].waitForExistence(timeout: 10))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(bold.waitForExistence(timeout: 20)); XCTAssertEqual(bold.value as? String, "On")
        XCTAssertTrue(app.staticTexts["presentation-unsupported-elements"].exists)
    }
    @MainActor func testTextAlignmentSaveAndReopenKeepsMedia() {
        let app = XCUIApplication(); app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-presentation-fixture"]; app.launch()
        let page = app.descendants(matching: .any)["page.deck-test"].firstMatch
        guard page.waitForExistence(timeout: 30) else { failure(app, "alignment-page-missing"); XCTFail("Presentation page missing"); return }; page.tap()
        let edit = app.buttons["edit-local-presentation"]
        guard edit.waitForExistence(timeout: 20) else { failure(app, "alignment-edit-missing"); XCTFail("Presentation editor missing"); return }; edit.tap()
        let picker = app.descendants(matching: .any)["presentation-text-alignment"].firstMatch
        guard picker.waitForExistence(timeout: 20) else { failure(app, "alignment-picker-missing"); XCTFail("Alignment picker missing"); return }
        picker.tap()
        let center = app.descendants(matching: .any).matching(identifier: "Center").firstMatch
        guard center.waitForExistence(timeout: 10) else { failure(app, "alignment-center-missing"); XCTFail("Center option missing"); return }; center.tap()
        app.buttons["Save"].tap()
        guard app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20) else { failure(app, "alignment-save-missing"); XCTFail("Alignment save missing"); return }
        XCTAssertTrue(app.staticTexts["presentation-media-record-retained"].waitForExistence(timeout: 10))
        app.buttons["Close"].tap(); XCTAssertTrue(edit.waitForExistence(timeout: 20)); edit.tap()
        XCTAssertTrue(picker.waitForExistence(timeout: 20))
        XCTAssertTrue((picker.value as? String ?? picker.label).contains("Center"))
        XCTAssertTrue(app.staticTexts["presentation-unsupported-elements"].exists)
    }
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
        guard app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20) else { failure(app, "presentation-save-missing"); XCTFail("Saved state missing"); return }
        guard app.staticTexts["presentation-media-record-retained"].waitForExistence(timeout: 10) else { failure(app, "presentation-media-missing"); XCTFail("Media verification missing"); return }
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
        XCTAssertTrue(count.waitForExistence(timeout: 20))
        if count.label != "2 slides" { failure(app, "presentation-count-unexpected") }
        XCTAssertEqual(count.label, "2 slides")
        let addSlide = app.buttons["presentation-add-blank"]
        if !addSlide.isHittable { app.swipeUp() }
        XCTAssertTrue(addSlide.waitForExistence(timeout: 10)); addSlide.tap()
        XCTAssertEqual(count.label, "3 slides")
        let duplicate = app.buttons["presentation-duplicate-slide"]
        if !duplicate.isHittable { app.swipeUp() }; duplicate.tap()
        XCTAssertEqual(count.label, "4 slides")
        app.buttons["presentation-move-down"].tap()
        app.buttons["Undo"].tap(); app.buttons["Redo"].tap()
        app.buttons["Save"].tap()
        guard app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20) else { failure(app, "presentation-created-save-missing"); XCTFail("Saved state missing"); return }
        guard app.staticTexts["presentation-media-record-retained"].waitForExistence(timeout: 10) else { failure(app, "presentation-created-media-missing"); XCTFail("Media verification missing"); return }
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
        if field.value as? String != "" { failure(app, "presentation-field-not-empty") }
        XCTAssertEqual(field.value as? String, "")
        field.typeText("Edited slide")
        app.buttons["Apply text"].tap()
        app.buttons["presentation-slide.slide-b"].tap()
        XCTAssertEqual(field.value as? String, "Second slide", "Element IDs may recur on different slides")
        app.buttons["Move slide up"].tap()
        XCTAssertLessThan(app.buttons["presentation-slide.slide-b"].frame.minY, app.buttons["presentation-slide.slide-a"].frame.minY)
        app.buttons["Save"].tap()
        guard app.staticTexts["presentation-edit-saved"].waitForExistence(timeout: 20) else { failure(app, "presentation-text-save-missing"); XCTFail("Saved state missing"); return }
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
    @MainActor private func failure(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription); hierarchy.name = name + "-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }
}
#endif
