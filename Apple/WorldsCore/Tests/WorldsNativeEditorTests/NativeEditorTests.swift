import Foundation
import XCTest
import WorldsModels
import WorldsRichText
@testable import WorldsNativeEditor

private actor FixturePersistence: EditorPersistence {
    private(set) var lastJSON: Data?
    private(set) var lastBase: Int64?
    func save(documentJSON: Data, basedOn: Int64) async throws -> Int64 {
        lastJSON = documentJSON; lastBase = basedOn; return basedOn + 1
    }
    func state() -> (Data?, Int64?) { (lastJSON, lastBase) }
}

@MainActor
final class NativeEditorTests: XCTestCase {
    private func makeModel() throws -> NativeEditorModel {
        let json = #"{"type":"doc","content":[{"type":"paragraph","attrs":{"dir":"rtl"},"content":[{"type":"text","text":"مرحبا 👋","marks":[{"type":"future","attrs":{"keep":true}}]}]},{"type":"futureWidget","attrs":{"keep":true}}]}"#
        return try NativeEditorModel(document: RichTextDocument(json: Data(json.utf8)), baseRevision: 3)
    }
    func testEditingUndoRedoAndUnknownData() throws {
        let model = try makeModel()
        let original = model.document.source
        _ = try model.replace(range: NSRange(location: 0, length: 5), with: "أهلًا")
        XCTAssertTrue(model.dirty)
        XCTAssertTrue(model.projection.text.hasPrefix("أهلًا"))
        XCTAssertEqual(model.projection.spans[0].marks.count, 1)
        model.undo()
        XCTAssertEqual(model.document.source, original)
        XCTAssertFalse(model.dirty)
        model.redo()
        XCTAssertTrue(model.projection.text.hasPrefix("أهلًا"))
    }
    func testRejectsStructureAndPreservesDocument() throws {
        let model = try makeModel()
        let original = model.document.source
        XCTAssertThrowsError(try model.replace(range: NSRange(location: 0, length: model.projection.text.utf16.count), with: "x"))
        XCTAssertThrowsError(try model.replace(range: NSRange(location: 0, length: 0), with: "\n"))
        XCTAssertEqual(model.document.source, original)
    }
    func testKnownRichClipboardFormatsAreRejectedInsteadOfFlattened() {
        XCTAssertFalse(NativePastePolicy.rejects(["public.utf8-plain-text"]))
        for rich in ["public.html", "public.rtf", "com.apple.flat-rtfd", "public.png", "public.file-url"] {
            XCTAssertTrue(NativePastePolicy.rejects(["public.utf8-plain-text", rich]))
        }
    }
    func testFormattingPreservesUnknownMark() throws {
        let model = try makeModel()
        let span = try XCTUnwrap(model.projection.spans.first)
        try model.toggleMark("bold", selection: span.range)
        XCTAssertEqual(model.projection.spans[0].marks.count, 2)
        try model.toggleMark("bold", selection: span.range)
        XCTAssertEqual(model.projection.spans[0].marks, span.marks)
        XCTAssertThrowsError(try model.toggleMark("bold", selection: NSRange(location: 0, length: 1)))
    }
    func testSaveUsesAbstractPersistenceAndBaseRevision() async throws {
        let model = try makeModel()
        let store = FixturePersistence()
        _ = try model.replace(range: NSRange(location: 0, length: 1), with: "أ")
        try await model.save(using: store)
        let state = await store.state()
        XCTAssertEqual(state.1, 3)
        XCTAssertEqual(model.baseRevision, 4)
        XCTAssertFalse(model.dirty)
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: XCTUnwrap(state.0)), model.document.source)
    }
    func testSaveWaitsForNativeTextComposition() async throws {
        let model = try makeModel()
        let store = FixturePersistence()
        _ = try model.replace(range: NSRange(location: 0, length: 1), with: "أ")
        model.setNativeEditPending(true)
        do { try await model.save(using: store); XCTFail("Pending input must not be saved") }
        catch NativeEditorError.nativeEditPending { } catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertTrue(model.dirty)
        let state = await store.state()
        XCTAssertNil(state.0)
        model.setNativeEditPending(false)
        try await model.save(using: store)
        XCTAssertFalse(model.dirty)
    }
    func testRejectedNativeTextIsRetainedAndBlocksSaveUntilDiscarded() async throws {
        let model = try makeModel()
        let original = model.document.source
        let rejected = "Unapplied user text"
        do {
            try model.commitNativeText(rejected, selection: NSRange(location: rejected.utf16.count, length: 0))
            XCTFail("Crossing an unsupported widget must fail")
        } catch { model.retainRejectedNativeText(rejected) }
        XCTAssertEqual(model.document.source, original)
        XCTAssertEqual(model.recoverableNativeText, rejected)
        XCTAssertTrue(model.hasUnresolvedInput)
        let store = FixturePersistence()
        do { try await model.save(using: store); XCTFail("Unapplied text must not look saved") }
        catch NativeEditorError.unrecoveredNativeText { }
        let state = await store.state()
        XCTAssertNil(state.0)
        XCTAssertThrowsError(try model.replace(range: NSRange(location: 0, length: 0), with: "x"))
        model.discardRejectedNativeText()
        XCTAssertNil(model.recoverableNativeText)
        XCTAssertFalse(model.hasUnresolvedInput)
        try await model.save(using: store)
    }
    func testCommittedNativeTextSplitsParagraphAndUndo() throws {
        let json = #"{"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"a"},"content":[{"type":"text","text":"abcd"}]}]}"#
        let model = try NativeEditorModel(document: RichTextDocument(json: Data(json.utf8)), baseRevision: 1)
        try model.commitNativeText("ab\ncd", selection: NSRange(location: 3, length: 0))
        XCTAssertEqual(model.projection.text, "ab\ncd")
        model.undo()
        XCTAssertEqual(model.projection.text, "abcd")
        model.redo()
        XCTAssertEqual(model.projection.text, "ab\ncd")
    }
    func testLinkEditPreservesUnknownMarksAndAttributesWithUndo() throws {
        let json = #"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"link","marks":[{"type":"link","attrs":{"href":"https://old.example","custom":"keep"}},{"type":"future","attrs":{"x":1}}]}]}]}"#
        let model = try NativeEditorModel(document: RichTextDocument(json: Data(json.utf8)), baseRevision: 1)
        let before = model.document.source
        try model.setLink(URL(string: "https://new.example"), selection: NSRange(location: 0, length: 4))
        let marks = model.projection.spans[0].marks
        guard case .object(let link) = marks[0], case .object(let attrs)? = link["attrs"] else { return XCTFail("Missing link") }
        XCTAssertEqual(attrs["custom"], .string("keep"))
        XCTAssertEqual(attrs["href"], .string("https://new.example"))
        XCTAssertEqual(marks.count, 2)
        model.undo()
        XCTAssertEqual(model.document.source, before)
    }
    func testCommittedEmojiDiffPreservesUTF16Boundaries() throws {
        let json = #"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"A👋B"}]}]}"#
        let model = try NativeEditorModel(document: RichTextDocument(json: Data(json.utf8)), baseRevision: 1)
        try model.commitNativeText("A🙂B", selection: NSRange(location: 3, length: 0))
        XCTAssertEqual(model.projection.text, "A🙂B")
        model.undo()
        XCTAssertEqual(model.projection.text, "A👋B")
    }
}
