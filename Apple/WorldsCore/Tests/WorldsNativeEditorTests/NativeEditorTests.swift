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
    func testMarkersTrackEveryTaskAndNumberedStart() throws {
        let json = #"{"type":"doc","content":[{"type":"taskList","attrs":{"bid":"tasks"},"content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","attrs":{"dir":"rtl"},"content":[{"type":"text","text":"أول"}]}]},{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"ثان"}]}]}]},{"type":"orderedList","attrs":{"bid":"numbers","start":5},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"one"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"two"}]}]}]}]}"#
        let model = try NativeEditorModel(document: RichTextDocument(json: Data(json.utf8)), baseRevision: 0)
        XCTAssertEqual(model.listMarkers.map(\.label), ["☐", "☑", "5.", "6."])
        XCTAssertTrue(model.listMarkers[0].rightToLeft)
        try model.toggleTask(marker: model.listMarkers[0])
        XCTAssertEqual(model.listMarkers.map(\.label), ["☑", "☑", "5.", "6."])
    }
    func testNestedAndEmptyTaskMarkersRemainEditableWithoutChangingText() throws {
        let json = #"{"type":"doc","content":[{"type":"taskList","attrs":{"bid":"tasks"},"content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"أصل"}]},{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false,"future":"keep"},"content":[{"type":"paragraph","content":[]}]}]}]}]}]}"#
        let model = try NativeEditorModel(document: RichTextDocument(json: Data(json.utf8)), baseRevision: 0)
        let before = model.document.source, text = model.projection.text
        XCTAssertEqual(model.listMarkers.count, 2)
        XCTAssertEqual(model.listMarkers.map(\.label), ["☐", "☐"])
        XCTAssertEqual(model.listMarkers[1].depth, 1)
        XCTAssertEqual(model.listMarkers[1].text, "Empty task")
        let stale = model.listMarkers[1]
        try model.toggleTask(marker: stale)
        XCTAssertEqual(model.projection.text, text)
        XCTAssertEqual(model.listMarkers[1].label, "☑")
        let changed = model.document.source
        XCTAssertThrowsError(try model.toggleTask(marker: stale))
        XCTAssertEqual(model.document.source, changed)
        model.undo(); XCTAssertEqual(model.document.source, before)
    }
    func testCreateListsAndToggleTaskWithUndoRedo() throws {
        for kind in ["bulletList", "orderedList", "taskList"] {
            let json = #"{"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"p"},"content":[{"type":"text","text":"مرحبا"}]}]}"#
            let model = try NativeEditorModel(document: RichTextDocument(json: Data(json.utf8)), baseRevision: 0)
            let original = model.document.source
            model.selection = NSRange(location: 1, length: 0)
            try model.makeList(kind)
            XCTAssertEqual(model.projection.text, "مرحبا")
            XCTAssertEqual(model.currentListDescription, kind == "taskList" ? "Task incomplete" : (kind == "bulletList" ? "Bulleted list" : "Numbered list"))
            if kind == "taskList" {
                try model.toggleTask(); XCTAssertEqual(model.currentListDescription, "Task complete")
                model.undo(); XCTAssertEqual(model.currentListDescription, "Task incomplete")
                model.redo(); XCTAssertEqual(model.currentListDescription, "Task complete")
                model.undo()
            }
            model.undo(); XCTAssertEqual(model.document.source, original)
            model.redo(); XCTAssertEqual(model.projection.text, "مرحبا")
        }
    }
    func testListCreationRejectsUnknownContent() throws {
        let model = try makeModel(), before = model.document.source
        XCTAssertThrowsError(try model.makeList("bulletList"))
        XCTAssertEqual(model.document.source, before)
    }
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
    func testPartialArabicFormattingRoundTripsAndUndoPreservesOpaqueBlocks() throws {
        let json = #"{"type":"doc","content":[{"type":"paragraph","attrs":{"dir":"rtl","bid":"p"},"content":[{"type":"text","text":"مرحبا عالم"}]},{"type":"futureWidget","attrs":{"keep":true}}]}"#
        let model = try NativeEditorModel(document: RichTextDocument(json: Data(json.utf8)), baseRevision: 1)
        let original = model.document.source
        try model.toggleMark("bold", selection: NSRange(location: 6, length: 4))
        XCTAssertEqual(model.projection.text, "مرحبا عالم\n\u{fffc}")
        XCTAssertEqual(model.projection.spans.count, 2)
        XCTAssertEqual(model.projection.spans[1].marks, [.object(["type": .string("bold")])])
        let roundTrip = try RichTextDocument(json: model.document.json())
        XCTAssertEqual(roundTrip.source, model.document.source)
        model.undo(); XCTAssertEqual(model.document.source, original)
        model.redo(); XCTAssertEqual(model.document.source, roundTrip.source)
    }
    func testPartialFormattingRejectsUnknownMarksAndSurrogateSplit() throws {
        let opaque = try makeModel(); let original = opaque.document.source
        XCTAssertThrowsError(try opaque.toggleMark("bold", selection: NSRange(location: 0, length: 2)))
        XCTAssertEqual(opaque.document.source, original)
        let json = #"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"A👋B"}]}]}"#
        let plain = try NativeEditorModel(document: RichTextDocument(json: Data(json.utf8)), baseRevision: 0)
        let before = plain.document.source
        XCTAssertThrowsError(try plain.toggleMark("italic", selection: NSRange(location: 2, length: 1)))
        XCTAssertEqual(plain.document.source, before)
        try plain.toggleMark("italic", selection: NSRange(location: 1, length: 2))
        XCTAssertEqual(plain.projection.spans[1].marks, [.object(["type": .string("italic")])])
    }
    func testPartialFormattingInsideRTLListPreservesListStructure() throws {
        let json = #"{"type":"doc","content":[{"type":"bulletList","attrs":{"bid":"list","future":42},"content":[{"type":"listItem","content":[{"type":"paragraph","attrs":{"dir":"rtl"},"content":[{"type":"text","text":"واحد اثنان"}]}]}]}]}"#
        let model = try NativeEditorModel(document: RichTextDocument(json: Data(json.utf8)), baseRevision: 0)
        try model.toggleMark("underline", selection: NSRange(location: 0, length: 4))
        XCTAssertEqual(model.projection.spans.first?.marks, [.object(["type": .string("underline")])])
        guard case .object(let root) = model.document.source, case .array(let blocks)? = root["content"],
              case .object(let list) = blocks[0], case .object(let attrs)? = list["attrs"] else { return XCTFail("Missing list") }
        XCTAssertEqual(attrs["future"], .integer(42))
        XCTAssertEqual(try RichTextDocument(json: model.document.json()).source, model.document.source)
    }
    func testMultiRunFormattingInRTLListAndUndo() throws {
        let json = #"{"type":"doc","content":[{"type":"bulletList","attrs":{"bid":"list","future":42},"content":[{"type":"listItem","content":[{"type":"paragraph","attrs":{"dir":"rtl"},"content":[{"type":"text","text":"أهلا ","marks":[{"type":"italic"}]},{"type":"text","text":"بالعالم"}]}]}]}]}"#
        let model = try NativeEditorModel(document: RichTextDocument(json: Data(json.utf8)), baseRevision: 0)
        let original = model.document.source
        try model.toggleMark("bold", selection: NSRange(location: 2, length: 6))
        XCTAssertEqual(model.projection.text, "أهلا بالعالم")
        let bold: JSONValue = .object(["type": .string("bold")])
        XCTAssertEqual(model.projection.spans.filter { $0.marks.contains(bold) }.count, 2)
        let saved = try RichTextDocument(json: model.document.json())
        model.undo(); XCTAssertEqual(model.document.source, original)
        model.redo(); XCTAssertEqual(model.document.source, saved.source)
    }
    func testMultiRunFormattingRejectsOpaqueSiblingWithoutChanges() throws {
        let json = #"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"one"},{"type":"text","text":"two","marks":[{"type":"future","attrs":{"keep":true}}]}]}]}"#
        let model = try NativeEditorModel(document: RichTextDocument(json: Data(json.utf8)), baseRevision: 0)
        let original = model.document.source
        XCTAssertThrowsError(try model.toggleMark("bold", selection: NSRange(location: 1, length: 4)))
        XCTAssertEqual(model.document.source, original)
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
