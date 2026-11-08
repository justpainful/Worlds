import Foundation
import SQLite3
import XCTest
import WorldsModels
import WorldsPersistence
import WorldsNativeWrites
import WorldsNativeEditor
import WorldsLocalImport
@testable import WorldsEditorPersistence

final class EditorPersistenceTests: XCTestCase {
    @MainActor func testAppendTableColumnTypeSaveReopenAndRejectConflict() async throws {
        let url = try fixture()
        try exec(#"UPDATE pages SET kind='document' WHERE id='fixture-page'; UPDATE blocks SET content='{"type":"table","attrs":{"bid":"fixture-block","future":"keep"},"content":[{"type":"tableRow","content":[{"type":"tableCell","attrs":{"colspan":1,"rowspan":1,"colwidth":null},"content":[{"type":"paragraph","content":[{"type":"text","text":"أصل"}]}]}]}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let stale = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision, supportsDocumentFormatting: true)
        try model.appendTableColumn()
        _ = try model.replace(range: NSRange(location: model.projection.text.utf16.count, length: 0), with: "جديد")
        let expected = model.document.source
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, expected)
        XCTAssertEqual(reopened.initialDocument.project().text, "أصل\tجديد")
        do { _ = try await stale.save(documentJSON: try stale.initialDocument.json(), basedOn: stale.initialRevision); XCTFail("Expected conflict") }
        catch NativeWriteError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        let final = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(final.initialDocument.source, expected)
    }
    @MainActor func testAppendTableRowTypeSaveReopenAndRejectConflict() async throws {
        let url = try fixture()
        try exec(#"UPDATE pages SET kind='document' WHERE id='fixture-page'; UPDATE blocks SET content='{"type":"table","attrs":{"bid":"fixture-block","future":"keep"},"content":[{"type":"tableRow","content":[{"type":"tableCell","attrs":{"colspan":1,"rowspan":1,"colwidth":null},"content":[{"type":"paragraph","content":[{"type":"text","text":"أصل"}]}]}]}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let stale = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision, supportsDocumentFormatting: true)
        try model.appendTableRow()
        _ = try model.replace(range: NSRange(location: model.projection.text.utf16.count, length: 0), with: "جديد")
        let expected = model.document.source
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, expected)
        XCTAssertEqual(reopened.initialDocument.project().text, "أصل\nجديد")
        do { _ = try await stale.save(documentJSON: try stale.initialDocument.json(), basedOn: stale.initialRevision); XCTFail("Expected conflict") }
        catch NativeWriteError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        let final = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(final.initialDocument.source, expected)
    }
    @MainActor func testDocumentParagraphStyleSaveReopenAndConflict() async throws {
        let url = try fixture()
        try exec(#"UPDATE pages SET kind='document' WHERE id='fixture-page'; UPDATE blocks SET content='{"type":"paragraph","attrs":{"bid":"fixture-block","dir":"rtl","future":{"keep":true}},"content":[{"type":"text","text":"عنوان"}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let stale = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision, supportsDocumentFormatting: true)
        try model.setParagraphStyle("title")
        let expected = model.document.source
        XCTAssertThrowsError(try model.setHeading(1))
        XCTAssertEqual(model.document.source, expected)
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, expected)
        XCTAssertEqual(reopened.initialDocument.project().spans.first?.paragraphStyle, "title")
        do { _ = try await stale.save(documentJSON: try stale.initialDocument.json(), basedOn: stale.initialRevision); XCTFail("Expected conflict") }
        catch NativeWriteError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        let final = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(final.initialDocument.source, expected)
    }
    func testDocumentUnknownParagraphStyleRemainsProtected() async throws {
        let url = try fixture()
        try exec(#"UPDATE pages SET kind='document' WHERE id='fixture-page'; UPDATE blocks SET content='{"type":"paragraph","attrs":{"bid":"fixture-block","pstyle":"future"},"content":[{"type":"text","text":"Text"}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let attack = #"{"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"fixture-block","pstyle":"title"},"content":[{"type":"text","text":"Text"}]}]}"#
        do { _ = try await bridge.save(documentJSON: Data(attack.utf8), basedOn: bridge.initialRevision); XCTFail("Expected protected style rejection") }
        catch EditorBridgeError.invalidBlock { }
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, bridge.initialDocument.source)
    }
    @MainActor func testDocumentAlignmentRejectsKindChangeAtSameRevision() async throws {
        let url = try fixture()
        try exec(#"UPDATE pages SET kind='document' WHERE id='fixture-page'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision, supportsDocumentFormatting: true)
        try model.setTextAlignment("center")
        try exec(#"UPDATE pages SET kind='page' WHERE id='fixture-page'"#, url: url)
        do { try await model.save(using: bridge); XCTFail("Expected page kind conflict") }
        catch NativeWriteError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        let after = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(after.initialDocument.source, bridge.initialDocument.source)
        XCTAssertFalse(after.supportsDocumentFormatting)
    }
    func testDocumentAlignmentDoesNotOverwriteUnknownLegacyValue() async throws {
        let url = try fixture()
        try exec(#"UPDATE pages SET kind='document' WHERE id='fixture-page'"#, url: url)
        try exec(#"UPDATE blocks SET content='{"type":"paragraph","attrs":{"bid":"fixture-block","textAlign":"future"},"content":[{"type":"text","text":"Text"}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let attack = #"{"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"fixture-block","textAlign":"center"},"content":[{"type":"text","text":"Text"}]}]}"#
        do { _ = try await bridge.save(documentJSON: Data(attack.utf8), basedOn: bridge.initialRevision); XCTFail("Expected protected value rejection") }
        catch EditorBridgeError.invalidBlock { }
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, bridge.initialDocument.source)
    }
    @MainActor func testDocumentAlignmentPersistsUnknownDataAndRejectsConflict() async throws {
        let url = try fixture()
        try exec(#"UPDATE pages SET kind='document' WHERE id='fixture-page'"#, url: url)
        try exec(#"UPDATE blocks SET content='{"type":"paragraph","attrs":{"bid":"fixture-block","dir":"rtl","textAlign":null,"future":{"keep":true}},"content":[{"type":"text","text":"عربي"}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let stale = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertTrue(bridge.supportsDocumentFormatting)
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision, supportsDocumentFormatting: true)
        try model.setTextAlignment("center")
        let expected = model.document.source
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, expected)
        XCTAssertEqual(reopened.initialDocument.project().spans[0].alignment, "center")
        do { _ = try await stale.save(documentJSON: try stale.initialDocument.json(), basedOn: stale.initialRevision); XCTFail("Expected conflict") }
        catch NativeWriteError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        let final = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(final.initialDocument.source, expected)
    }
    @MainActor func testIndentTaskSavesAndRejectsConcurrentSnapshot() async throws {
        let url = try fixture()
        try exec(#"UPDATE blocks SET content='{"type":"taskList","attrs":{"bid":"fixture-block"},"content":[{"type":"taskItem","attrs":{"checked":false,"future":"keep"},"content":[{"type":"paragraph","content":[{"type":"text","text":"First"}]}]},{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Second"}]}]}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let stale = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        model.selection = NSRange(location: model.projection.text.utf16.count, length: 0)
        try model.changeListIndent(outdent: false)
        let expected = model.document.source
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, expected)
        do { _ = try await stale.save(documentJSON: try stale.initialDocument.json(), basedOn: stale.initialRevision); XCTFail("Expected conflict") }
        catch NativeWriteError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        let final = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(final.initialDocument.source, expected)
    }
    func testLegacyHeadingIdentityAndMovementAreRejected() async throws {
        let url = try fixture()
        try exec(#"UPDATE blocks SET content='{"type":"heading","attrs":{"bid":"fixture-block","level":4},"content":[{"type":"text","text":"Legacy"}]}' WHERE id='fixture-block'"#, url: url)
        try exec(#"INSERT INTO blocks(id,page_id,type,sort_key,content,text,direction,created_at,updated_at) SELECT 'other',page_id,'paragraph',10,'{"type":"paragraph","attrs":{"bid":"other"},"content":[{"type":"text","text":"Other"}]}','Other',direction,created_at,updated_at FROM blocks WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let original = bridge.initialDocument.source
        let attacks = [
            #"{"type":"doc","content":[{"type":"heading","attrs":{"bid":"renamed","level":4},"content":[{"type":"text","text":"Legacy"}]},{"type":"paragraph","attrs":{"bid":"other"},"content":[{"type":"text","text":"Other"}]}]}"#,
            #"{"type":"doc","content":[{"type":"heading","attrs":{"bid":"fixture-block","level":4},"content":[{"type":"text","text":"Legacy"}]},{"type":"paragraph","attrs":{"bid":"fixture-block"},"content":[{"type":"text","text":"Other"}]}]}"#,
            #"{"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"fixture-block"},"content":[]},{"type":"blockquote","attrs":{"bid":"other"},"content":[{"type":"heading","attrs":{"bid":"fixture-block","level":4},"content":[{"type":"text","text":"Legacy"}]}]}]}"#
        ]
        for attack in attacks {
            do { _ = try await bridge.save(documentJSON: Data(attack.utf8), basedOn: bridge.initialRevision); XCTFail("Expected identity or movement rejection") }
            catch EditorBridgeError.invalidBlock { }
            let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
            XCTAssertEqual(reopened.initialDocument.source, original)
        }
    }
    @MainActor func testExitListBeforeUnsupportedHeadingPreservesItOnSave() async throws {
        let url = try fixture()
        try exec(#"UPDATE blocks SET content='{"type":"taskList","attrs":{"bid":"fixture-block"},"content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Parent"}]}]},{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[]}]}]}' WHERE id='fixture-block'"#, url: url)
        try exec(#"INSERT INTO blocks(id,page_id,type,sort_key,content,text,direction,created_at,updated_at) SELECT 'legacy',page_id,'heading',10,'{"type":"heading","attrs":{"bid":"legacy","level":4,"future":true},"content":[{"type":"text","text":"Legacy"}]}','Legacy',direction,created_at,updated_at FROM blocks WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        let range = (model.projection.text as NSString).range(of: "Parent")
        _ = try model.replace(range: NSRange(location: NSMaxRange(range) + 1, length: 0), with: "\n")
        let expected = model.document.source
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, expected)
        XCTAssertTrue(reopened.initialDocument.project().text.contains("Legacy"))
    }
    @MainActor func testExitEmptyRootTaskAndTypeSurvivesReopen() async throws {
        let url = try fixture()
        try exec(#"UPDATE blocks SET content='{"type":"taskList","attrs":{"bid":"fixture-block"},"content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"أصل"}]}]},{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[]}]}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        _ = try model.replace(range: NSRange(location: model.projection.text.utf16.count, length: 0), with: "\n")
        _ = try model.replace(range: model.selection, with: "جديد")
        let expected = model.document.source
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, expected)
    }
    @MainActor func testEmptyNestedTaskEnterPersistsLiftAndRejectsStaleSession() async throws {
        let url = try fixture()
        try exec(#"UPDATE blocks SET content='{"type":"taskList","attrs":{"bid":"fixture-block"},"content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"أصل"}]},{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[]}]}]}]}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let stale = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        let caret = NSRange(location: model.projection.text.utf16.count, length: 0)
        _ = try model.replace(range: caret, with: "\n")
        let expected = model.document.source
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, expected)
        do { _ = try await stale.save(documentJSON: try stale.initialDocument.json(), basedOn: stale.initialRevision); XCTFail("Expected stale snapshot rejection") }
        catch NativeWriteError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        let final = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(final.initialDocument.source, expected)
    }
    @MainActor func testEmptyNestedTaskPersistsAndRejectsStaleSession() async throws {
        let url = try fixture()
        try exec(#"UPDATE blocks SET content='{"type":"taskList","attrs":{"bid":"fixture-block"},"content":[{"type":"taskItem","attrs":{"checked":false,"future":"kept"},"content":[{"type":"paragraph","content":[{"type":"text","text":"أصل"}]}]}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let stale = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        try model.appendListItem(text: "", nested: true)
        let empty = model.document.source
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, empty)
        let resumed = NativeEditorModel(document: reopened.initialDocument, baseRevision: reopened.initialRevision)
        let insertion = NSRange(location: resumed.projection.text.utf16.count, length: 0)
        _ = try resumed.replace(range: insertion, with: "فرعي")
        let typed = resumed.document.source
        try await resumed.save(using: reopened)
        let final = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(final.initialDocument.source, typed)
        let staleModel = NativeEditorModel(document: stale.initialDocument, baseRevision: stale.initialRevision)
        try staleModel.appendListItem(text: "تعارض", nested: true)
        do { try await staleModel.save(using: stale); XCTFail("Expected stale snapshot rejection") } catch { }
        let after = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(after.initialDocument.source, typed)
    }
    @MainActor func testUnsupportedLegacyHeadingDoesNotBlockOtherParagraphEdit() async throws {
        let url = try fixture()
        try exec(#"UPDATE blocks SET content='{"type":"heading","attrs":{"bid":"fixture-block","level":4},"content":[{"type":"text","text":"Legacy"}]}' WHERE id='fixture-block'"#, url: url)
        try exec(#"INSERT INTO blocks(id,page_id,type,sort_key,content,text,direction,created_at,updated_at) SELECT 'other',page_id,'paragraph',10,'{"type":"paragraph","attrs":{"bid":"other"},"content":[{"type":"text","text":"Other"}]}','Other',direction,created_at,updated_at FROM blocks WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        let text = model.projection.text as NSString
        let range = text.range(of: "Other")
        XCTAssertNotEqual(range.location, NSNotFound)
        _ = try model.replace(range: range, with: "Changed")
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertTrue(reopened.initialDocument.project().text.contains("Legacy"))
        XCTAssertTrue(reopened.initialDocument.project().text.contains("Changed"))
    }
    func testRawHeadingValidationPreservesUnsupportedLegacyHeading() async throws {
        let url = try fixture()
        try exec(#"UPDATE blocks SET content='{"type":"heading","attrs":{"bid":"fixture-block","level":4},"content":[{"type":"text","text":"Legacy"}]}' WHERE id='fixture-block'"#, url: url)
        let legacy = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let original = legacy.initialDocument.source
        let changed = #"{"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"fixture-block","level":4},"content":[{"type":"text","text":"Legacy"}]}]}"#
        do { _ = try await legacy.save(documentJSON: Data(changed.utf8), basedOn: legacy.initialRevision); XCTFail("Expected legacy heading protection") }
        catch EditorBridgeError.invalidBlock { }
        _ = try await legacy.save(documentJSON: try legacy.initialDocument.json(), basedOn: legacy.initialRevision)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, original)

        try exec(#"UPDATE blocks SET content='{"type":"heading","attrs":{"bid":"fixture-block","level":2},"content":[{"type":"text","text":"Valid"}]}' WHERE id='fixture-block'"#, url: url)
        let valid = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let missing = #"{"type":"doc","content":[{"type":"heading","attrs":{"bid":"fixture-block"},"content":[{"type":"text","text":"Valid"}]}]}"#
        do { _ = try await valid.save(documentJSON: Data(missing.utf8), basedOn: valid.initialRevision); XCTFail("Expected missing-level rejection") }
        catch EditorBridgeError.invalidBlock { }
        let unchanged = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(unchanged.initialDocument.source, valid.initialDocument.source)

        try exec(#"UPDATE blocks SET content='{"type":"paragraph","attrs":{"bid":"fixture-block"},"content":[{"type":"text","text":"Valid"}]}' WHERE id='fixture-block'"#, url: url)
        let paragraph = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        do { _ = try await paragraph.save(documentJSON: Data(missing.utf8), basedOn: paragraph.initialRevision); XCTFail("Expected missing-level rejection") }
        catch EditorBridgeError.invalidBlock { }
        let final = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(final.initialDocument.source, paragraph.initialDocument.source)
    }
    @MainActor func testLinkAcrossRunsPersistsAndReopens() async throws {
        let url = try fixture()
        try exec(#"UPDATE blocks SET content='{"type":"paragraph","attrs":{"bid":"fixture-block","dir":"rtl"},"content":[{"type":"text","text":"Hello ","marks":[{"type":"bold"}]},{"type":"text","text":"Worlds"}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        try model.setLink(URL(string: "https://example.com"), selection: NSRange(location: 3, length: 6))
        let expected = model.document.source
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, expected)
        XCTAssertEqual(reopened.initialDocument.project().text, "Hello Worlds")
        let restored = NativeEditorModel(document: reopened.initialDocument, baseRevision: reopened.initialRevision)
        try restored.setLink(nil, selection: NSRange(location: 3, length: 6)); try await restored.save(using: reopened)
        let final = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertFalse(final.initialDocument.project().spans.flatMap(\.marks).contains { value in if case .object(let mark) = value { return mark["type"] == .string("link") }; return false })
    }
    @MainActor func testTaskListSaveToggleAndReopen() async throws {
        let url = try fixture()
        try exec(#"UPDATE blocks SET content='{"type":"paragraph","attrs":{"bid":"fixture-block"},"content":[{"type":"text","text":"Hello Worlds"}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        model.selection = NSRange(location: 0, length: 0)
        try model.makeList("taskList"); try model.toggleTask()
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let restored = NativeEditorModel(document: reopened.initialDocument, baseRevision: reopened.initialRevision)
        XCTAssertEqual(restored.projection.text, "Hello Worlds")
        XCTAssertEqual(restored.currentListDescription, "Task complete")
        try restored.toggleTask(); try await restored.save(using: reopened)
        let again = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let last = NativeEditorModel(document: again.initialDocument, baseRevision: again.initialRevision)
        XCTAssertEqual(last.currentListDescription, "Task incomplete")
    }
    @MainActor func testAppendNestedListItemsSaveAndReopen() async throws {
        let url = try fixture()
        try exec(#"UPDATE blocks SET content='{"type":"paragraph","attrs":{"bid":"fixture-block"},"content":[{"type":"text","text":"First"}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        try model.makeList("bulletList")
        try model.appendListItem(text: "Second", nested: false)
        try model.appendListItem(text: "متداخل", nested: true)
        let expected = model.document.source
        model.undo(); model.redo(); XCTAssertEqual(model.document.source, expected)
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, expected)
        XCTAssertEqual(reopened.initialDocument.project().text, "First\nSecond\nمتداخل")
    }
    @MainActor func testNestedTaskEnterAndBackspaceSurviveRealStore() async throws {
        let url = try fixture()
        try exec(#"UPDATE blocks SET content='{"type":"paragraph","attrs":{"bid":"fixture-block"},"content":[{"type":"text","text":"أصل"}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        try model.makeList("taskList"); try model.appendListItem(text: "فرعي", nested: true)
        let end = model.projection.text.utf16.count
        _ = try model.replace(range: NSRange(location: end, length: 0), with: "\n")
        _ = try model.replace(range: NSRange(location: end + 1, length: 0), with: "جديد")
        _ = try model.replace(range: NSRange(location: end, length: 1), with: "")
        let expected = model.document.source
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, expected)
        XCTAssertEqual(reopened.initialDocument.project().text, "أصل\nفرعيجديد")
    }
    @MainActor func testConvertAndUnwrapListSurviveRealStore() async throws {
        let url = try fixture()
        try exec(#"UPDATE blocks SET content='{"type":"paragraph","attrs":{"bid":"fixture-block"},"content":[{"type":"text","text":"Hello Worlds"}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        let original = model.document.source
        try model.makeList("bulletList"); try model.makeList("orderedList"); try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let restored = NativeEditorModel(document: reopened.initialDocument, baseRevision: reopened.initialRevision)
        XCTAssertEqual(restored.currentListDescription, "Numbered list")
        try restored.makeList("orderedList"); try await restored.save(using: reopened)
        let final = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(final.initialDocument.source, original)
    }
    @MainActor func testUnwrapMultipleListItemsSurvivesRealStore() async throws {
        let url = try fixture()
        try exec(#"UPDATE blocks SET content='{"type":"bulletList","attrs":{"bid":"fixture-block"},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"First"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Second"}]}]}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        try model.makeList("bulletList")
        let expected = model.document.source
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(reopened.initialDocument.source, expected)
        XCTAssertEqual(reopened.initialDocument.project().text, "First\nSecond")
    }
    private func fixture() throws -> URL {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "editor-fixture", withExtension: "db"))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("worlds.db")
        try FileManager.default.copyItem(at: source, to: url)
        return url
    }
    private func exec(_ sql: String, url: URL) throws {
        var raw: OpaquePointer?
        guard sqlite3_open_v2(url.path, &raw, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK, let db = raw else { throw EditorBridgeError.unavailable }
        defer { sqlite3_close_v2(db) }
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw EditorBridgeError.unavailable }
    }
    #if DEBUG
    @MainActor
    func testImportedLocalPageEditSurvivesReopenAndPreservesSource() async throws {
        let source = try fixture().resolvingSymlinksInPath()
        try exec("UPDATE blocks SET properties='{\"plugin\":{\"keep\":true}}' WHERE id='fixture-block'", url: source)
        let originalReader = try WorldsDatabase(url: source)
        let before = try await originalReader.snapshot()
        let original = try XCTUnwrap(before.pages.first(where: { $0.id == "fixture-page" }))
        let root = source.deletingLastPathComponent().appendingPathComponent("local-copies", isDirectory: true)
        let importer = try LocalProjectImportCoordinator.isolatedTestCoordinator(root: root, backup: NativeSQLiteBackup())
        let copy = try await importer.importCopy(from: source)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: copy.databaseURL, pageID: original.id)
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        _ = try model.replace(range: NSRange(location: 6, length: 6), with: "Swift")
        try await model.save(using: bridge)
        let restored = try await importer.restoreCopy(id: copy.id)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: restored.databaseURL, pageID: original.id)
        XCTAssertTrue(reopened.initialDocument.project().text.contains("Hello Swift"))
        let copySnapshot = try await WorldsDatabase(url: restored.databaseURL).snapshot()
        let saved = try XCTUnwrap(copySnapshot.pages.first(where: { $0.id == original.id }))
        XCTAssertTrue(saved.blocks[0].propertiesJSON.contains("plugin"))
        XCTAssertTrue(saved.blocks[0].contentJSON.contains("futureMark"))
        XCTAssertTrue(saved.blocks[0].contentJSON.contains("futureNodeFlag"))
        let after = try await originalReader.snapshot()
        XCTAssertEqual(after.pages.first(where: { $0.id == original.id }), original)
    }
    #endif
    @MainActor
    func testEditorSavePreservesUnknownNodeAndAttributes() async throws {
        let url = try fixture()
        let db = try WorldsDatabase(url: url)
        let snapshot = try await db.snapshot()
        let page = try XCTUnwrap(snapshot.pages.first(where: { $0.id == "fixture-page" }))
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: page.id)
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        _ = try model.replace(range: NSRange(location: 6, length: 6), with: "Swift")
        try await model.save(using: bridge)
        XCTAssertFalse(model.dirty)
        let savedSnapshot = try await db.snapshot()
        let saved = try XCTUnwrap(savedSnapshot.pages.first(where: { $0.id == "fixture-page" }))
        let content = try JSONDecoder().decode(JSONValue.self, from: Data(saved.blocks[0].contentJSON.utf8))
        guard case .object(let node) = content, case .object(let attrs)? = node["attrs"],
              case .array(let children)? = node["content"], case .object(let text) = children[0] else { return XCTFail("Missing source fields") }
        XCTAssertEqual(attrs["bid"], .string("fixture-block"))
        XCTAssertEqual(attrs["custom"], .string("preserve"))
        XCTAssertEqual(node["futureNodeFlag"], .object(["keep": .bool(true)]))
        XCTAssertEqual(text["text"], .string("Hello Swift"))
        XCTAssertEqual(text["marks"], .array([.object(["type": .string("futureMark"), "attrs": .object(["flag": .integer(7)])])]))
    }
    @MainActor
    func testHeadingSaveReopenPreservesOpaqueAttributesAndRejectsConflict() async throws {
        let url = try fixture()
        try exec(#"UPDATE blocks SET content='{"type":"paragraph","attrs":{"bid":"fixture-block","dir":"rtl","future":{"x":1}},"futureNodeFlag":{"keep":true},"content":[{"type":"text","text":"مرحبا"}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let stale = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let tampered = #"{"type":"doc","content":[{"type":"heading","attrs":{"bid":"fixture-block","dir":"rtl","level":2,"future":{"x":2}},"futureNodeFlag":{"keep":true},"content":[{"type":"text","text":"مرحبا"}]}]}"#
        do { _ = try await bridge.save(documentJSON: Data(tampered.utf8), basedOn: bridge.initialRevision); XCTFail("Expected opaque attribute rejection") }
        catch EditorBridgeError.invalidBlock { }
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        model.selection = NSRange(location: 0, length: 0)
        try model.setHeading(2)
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        guard case .object(let root) = reopened.initialDocument.source, case .array(let blocks)? = root["content"], !blocks.isEmpty, case .object(let node) = blocks[0],
              case .object(let attrs)? = node["attrs"] else { return XCTFail("Missing heading") }
        XCTAssertEqual(node["type"], .string("heading"))
        XCTAssertEqual(attrs["level"], .integer(2))
        XCTAssertEqual(attrs["future"], .object(["x": .integer(1)]))
        XCTAssertEqual(node["futureNodeFlag"], .object(["keep": .bool(true)]))
        let staleModel = NativeEditorModel(document: stale.initialDocument, baseRevision: stale.initialRevision)
        staleModel.selection = NSRange(location: 0, length: 0)
        try staleModel.setHeading(1)
        do { try await staleModel.save(using: stale); XCTFail("Expected a conflict") } catch { }
        let after = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        XCTAssertEqual(after.initialDocument.source, reopened.initialDocument.source)
    }
    @MainActor
    func testPartialFormattingSurvivesRealStoreReopen() async throws {
        let url = try fixture()
        // This case exercises supported plain text while retaining an opaque
        // parent attribute. The shared fixture's unknown text mark correctly
        // forbids splitting and is covered by the rejection tests.
        try exec(#"UPDATE blocks SET content='{"type":"paragraph","attrs":{"bid":"fixture-block","custom":"preserve"},"futureNodeFlag":{"keep":true},"content":[{"type":"text","text":"Hello Worlds"}]}' WHERE id='fixture-block'"#, url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        XCTAssertEqual(model.projection.text, "Hello Worlds")
        try model.toggleMark("bold", selection: NSRange(location: 6, length: 6))
        try model.toggleMark("italic", selection: NSRange(location: 0, length: 12))
        try await model.save(using: bridge)
        let reopened = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let spans = reopened.initialDocument.project().spans
        XCTAssertEqual(reopened.initialDocument.project().text, "Hello Worlds")
        XCTAssertEqual(spans.count, 2)
        XCTAssertEqual(spans[0].marks, [.object(["type": .string("italic")])])
        XCTAssertEqual(spans[1].marks, [.object(["type": .string("bold")]), .object(["type": .string("italic")])])
        guard case .object(let root) = reopened.initialDocument.source, case .array(let blocks)? = root["content"], case .object(let first) = blocks[0] else { return XCTFail("Missing paragraph") }
        XCTAssertEqual(first["futureNodeFlag"], .object(["keep": .bool(true)]))
    }
    @MainActor
    func testUnappliedNativeInputBlocksRealStoreUntilExplicitDiscard() async throws {
        let url = try fixture()
        try exec("INSERT INTO blocks(id,page_id,type,sort_key,content,text,direction,created_at,updated_at) SELECT 'future',page_id,'futureWidget',10,'{\"type\":\"futureWidget\",\"attrs\":{\"bid\":\"future\"}}','',direction,created_at,updated_at FROM blocks WHERE id='fixture-block'", url: url)
        let reader = try WorldsDatabase(url: url)
        let originalSnapshot = try await reader.snapshot()
        let original = try XCTUnwrap(originalSnapshot.pages.first(where: { $0.id == "fixture-page" }))
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: original.id)
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        let rejected = "Unapplied input"
        do { try model.commitNativeText(rejected, selection: NSRange(location: rejected.utf16.count, length: 0)); XCTFail("Expected an unsupported edit") }
        catch { model.retainRejectedNativeText(rejected) }
        do { try await model.save(using: bridge); XCTFail("Cannot save while rejected input is unresolved") }
        catch NativeEditorError.unrecoveredNativeText { }
        let unchanged = try await reader.snapshot()
        XCTAssertEqual(unchanged.pages.first(where: { $0.id == original.id }), original)
        model.discardRejectedNativeText()
        _ = try model.replace(range: NSRange(location: 6, length: 6), with: "Swift")
        try await model.save(using: bridge)
        let saved = try await reader.snapshot()
        let page = try XCTUnwrap(saved.pages.first(where: { $0.id == original.id }))
        XCTAssertTrue(page.blocks[0].contentJSON.contains("Hello Swift"))
        XCTAssertTrue(page.blocks.contains(where: { $0.id == "future" }))
    }
    @MainActor
    func testConflictAtSameTimestampKeepsDirtyEditorAndDatabase() async throws {
        let url = try fixture(); let db = try WorldsDatabase(url: url)
        let snapshot = try await db.snapshot()
        let page = try XCTUnwrap(snapshot.pages.first(where: { $0.id == "fixture-page" }))
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: page.id)
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        _ = try model.replace(range: NSRange(location: 0,length: 5), with: "Mine")
        try exec("UPDATE blocks SET content='{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Other\"}]}' WHERE id='fixture-block'", url: url)
        do { try await model.save(using: bridge); XCTFail("Concurrent edit must fail") }
        catch NativeWriteError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertTrue(model.dirty)
        let latestSnapshot = try await db.snapshot()
        let latest = try XCTUnwrap(latestSnapshot.pages.first(where: { $0.id == "fixture-page" }))
        XCTAssertTrue(latest.blocks[0].contentJSON.contains("Other"))
    }
    @MainActor
    func testTwoEditorSessionsRejectStaleSnapshot() async throws {
        let url = try fixture()
        let first = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let second = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let a = NativeEditorModel(document: first.initialDocument, baseRevision: first.initialRevision)
        let b = NativeEditorModel(document: second.initialDocument, baseRevision: second.initialRevision)
        _ = try a.replace(range: NSRange(location: 0,length: 5), with: "First")
        _ = try b.replace(range: NSRange(location: 0,length: 5), with: "Other")
        try await a.save(using: first)
        do { try await b.save(using: second); XCTFail("Stale session must fail") }
        catch NativeWriteError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertTrue(b.dirty)
        let reader = try WorldsDatabase(url: url)
        let snapshot = try await reader.snapshot()
        let page = try XCTUnwrap(snapshot.pages.first(where: { $0.id == "fixture-page" }))
        XCTAssertTrue(page.blocks[0].contentJSON.contains("First"))
    }
    @MainActor
    func testRejectsReorderedBlocksWithoutTimestampChange() async throws {
        let url = try fixture()
        try exec("INSERT INTO blocks(id,page_id,type,sort_key,content,text,direction,created_at,updated_at) SELECT 'second',page_id,type,10,content,text,direction,created_at,updated_at FROM blocks WHERE id='fixture-block'", url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        _ = try model.replace(range: NSRange(location: 0,length: 5), with: "Mine")
        try exec("UPDATE blocks SET sort_key=-1 WHERE id='second'", url: url)
        do { try await model.save(using: bridge); XCTFail("Reordering must conflict") }
        catch NativeWriteError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertTrue(model.dirty)
        let reader = try WorldsDatabase(url: url)
        let snapshot = try await reader.snapshot()
        let page = try XCTUnwrap(snapshot.pages.first(where: { $0.id == "fixture-page" }))
        XCTAssertEqual(page.blocks.map(\.id), ["second", "fixture-block"])
    }
    @MainActor
    func testRejectsPageBecomingSharedBeforeSave() async throws {
        let url = try fixture(); let db = try WorldsDatabase(url: url)
        let snapshot = try await db.snapshot()
        let page = try XCTUnwrap(snapshot.pages.first(where: { $0.id == "fixture-page" }))
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: page.id)
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        _ = try model.replace(range: NSRange(location: 0,length: 5), with: "Mine")
        try exec("UPDATE pages SET workspace_id='shared' WHERE id='fixture-page'", url: url)
        do { try await model.save(using: bridge); XCTFail("Shared-page write must fail") } catch { }
        XCTAssertTrue(model.dirty)
    }

    func testRejectsDroppingUnknownRootBlockBeforeWriting() async throws {
        let url = try fixture()
        try exec("INSERT INTO blocks(id,page_id,type,sort_key,content,text,direction,created_at,updated_at) SELECT 'future',page_id,'futureWidget',10,'{\"type\":\"futureWidget\",\"attrs\":{\"bid\":\"future\"},\"payload\":{\"keep\":true}}','',direction,created_at,updated_at FROM blocks WHERE id='fixture-block'", url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        guard case .object(var root) = bridge.initialDocument.source,
              case .array(let content)? = root["content"] else { return XCTFail("Missing document") }
        root["content"] = .array(content.filter { node in
            guard case .object(let object) = node else { return true }
            return object["type"] != .string("futureWidget")
        })
        let input = try JSONEncoder().encode(JSONValue.object(root))
        do { _ = try await bridge.save(documentJSON: input, basedOn: bridge.initialRevision); XCTFail("Unknown block must be preserved") }
        catch EditorBridgeError.invalidBlock { }
        let snapshot = try await WorldsDatabase(url: url).snapshot()
        let page = try XCTUnwrap(snapshot.pages.first(where: { $0.id == "fixture-page" }))
        XCTAssertTrue(page.blocks.contains(where: { $0.id == "future" && $0.contentJSON.contains("futureWidget") }))
    }

    func testRejectsDroppingUnknownNestedNodeOrItsContainingBlock() async throws {
        let url = try fixture()
        try exec("UPDATE blocks SET content=json_insert(content,'$.content[#]',json('{\"type\":\"futureInline\",\"attrs\":{\"payload\":42}}')) WHERE id='fixture-block'", url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        guard case .object(let originalRoot) = bridge.initialDocument.source,
              case .array(let nodes)? = originalRoot["content"],
              case .object(var block) = nodes.first,
              case .array(let children)? = block["content"] else { return XCTFail("Missing fixture content") }
        var removedNodeRoot = originalRoot
        block["content"] = .array(children.filter { value in
            guard case .object(let node) = value else { return true }
            return node["type"] != .string("futureInline")
        })
        removedNodeRoot["content"] = .array([.object(block)])
        var removedBlockRoot = originalRoot
        removedBlockRoot["content"] = .array([])
        for root in [removedNodeRoot, removedBlockRoot] {
            do {
                _ = try await bridge.save(documentJSON: JSONEncoder().encode(JSONValue.object(root)), basedOn: bridge.initialRevision)
                XCTFail("Unknown descendant must remain")
            } catch EditorBridgeError.invalidBlock { }
        }
        let snapshot = try await WorldsDatabase(url: url).snapshot()
        let page = try XCTUnwrap(snapshot.pages.first(where: { $0.id == "fixture-page" }))
        XCTAssertTrue(page.blocks[0].contentJSON.contains("futureInline"))
    }

    func testRejectsLostAttributesAndMovedUnknownMark() async throws {
        let url = try fixture()
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        guard case .object(let originalRoot) = bridge.initialDocument.source,
              case .array(let nodes)? = originalRoot["content"],
              case .object(let originalBlock) = nodes.first,
              case .object(var attrs)? = originalBlock["attrs"],
              case .array(let children)? = originalBlock["content"],
              case .object(var text) = children.first, let marks = text["marks"] else { return XCTFail("Missing fixture metadata") }
        attrs.removeValue(forKey: "custom")
        var changedBlock = originalBlock
        changedBlock["attrs"] = .object(attrs)
        var lostAttributes = originalRoot
        lostAttributes["content"] = .array([.object(changedBlock)])
        text.removeValue(forKey: "marks")
        var movedBlock = originalBlock
        movedBlock["content"] = .array([.object(text), .object(["type": .string("text"), "text": .string(""), "marks": marks])])
        var movedMark = originalRoot
        movedMark["content"] = .array([.object(movedBlock)])
        for root in [lostAttributes, movedMark] {
            do {
                _ = try await bridge.save(documentJSON: JSONEncoder().encode(JSONValue.object(root)), basedOn: bridge.initialRevision)
                XCTFail("Protected metadata must not be lost or moved")
            } catch EditorBridgeError.invalidBlock { }
        }
        let snapshot = try await WorldsDatabase(url: url).snapshot()
        let page = try XCTUnwrap(snapshot.pages.first(where: { $0.id == "fixture-page" }))
        XCTAssertTrue(page.blocks[0].contentJSON.contains("futureMark"))
        XCTAssertTrue(page.blocks[0].contentJSON.contains("preserve"))
    }
}
