import Foundation
import XCTest
import WorldsPresentations
@testable import WorldsPresentationSession

final class PresentationSessionTests: XCTestCase {
    private func slide(_ id: String) throws -> SlideBlock {
        let json = """
        {"id":"\(id)","content":{"type":"slide","attrs":{"notes":"old","unknown":{"keep":true},"elements":[{"id":"text","type":"text","text":"old","custom":"keep"}]}}}
        """
        return try SlideBlock(json: Data(json.utf8))
    }
    func testSpeakerNotesUndoAndRejectsMalformedNotes() throws {
        let original = try slide("one")
        var session = try PresentationSession(slides: [original])
        try session.update(at: 0) { try $0.setNotes("ملاحظات 🌍") }
        let changed = session.slides[0]
        XCTAssertEqual(changed.editableNotes, "ملاحظات 🌍")
        XCTAssertEqual(changed.elements, original.elements)
        XCTAssertEqual(changed.attributes["unknown"], original.attributes["unknown"])
        session.undo(); XCTAssertEqual(session.slides[0], original)
        session.redo(); XCTAssertEqual(session.slides[0], changed)
        let malformed = try SlideBlock(json: Data(#"{"id":"bad","content":{"type":"slide","attrs":{"notes":{"future":true},"elements":[]}}}"#.utf8))
        var rejected = try PresentationSession(slides: [malformed])
        XCTAssertNil(malformed.editableNotes)
        XCTAssertThrowsError(try rejected.update(at: 0) { try $0.setNotes("replacement") })
        XCTAssertEqual(rejected.slides[0], malformed); XCTAssertFalse(rejected.canUndo)
    }
    func testTextColorUndoAndProtectsUnknownCSS() throws {
        let original = try slide("one")
        var session = try PresentationSession(slides: [original])
        XCTAssertEqual(original.elements[0].editableTextColor, "")
        try session.update(at: 0) { try $0.setTextStyle(elementID: "text", key: "color", value: .string("#e5484d")) }
        let changed = session.slides[0]
        XCTAssertEqual(changed.elements[0].editableTextColor, "#e5484d")
        XCTAssertEqual(changed.attributes["unknown"], original.attributes["unknown"])
        session.undo(); XCTAssertEqual(session.slides[0], original)
        session.redo(); XCTAssertEqual(session.slides[0], changed)
        let json = #"{"id":"bad","content":{"type":"slide","attrs":{"elements":[{"id":"text","type":"text","text":"old","style":{"color":"rgba(0,0,0,.5)"}}]}}}"#
        let bad = try SlideBlock(json: Data(json.utf8))
        var rejected = try PresentationSession(slides: [bad])
        XCTAssertNil(bad.elements[0].editableTextColor)
        XCTAssertThrowsError(try rejected.update(at: 0) { try $0.setTextStyle(elementID: "text", key: "color", value: .string("#e5484d")) })
        XCTAssertEqual(rejected.slides[0], bad); XCTAssertFalse(rejected.canUndo)
    }
    func testFontSizeUndoAndRejectsMalformedValue() throws {
        let original = try slide("one")
        var session = try PresentationSession(slides: [original])
        XCTAssertEqual(original.elements[0].editableFontSize, 32)
        try session.update(at: 0) { try $0.setTextStyle(elementID: "text", key: "fontSize", value: .integer(40)) }
        let changed = session.slides[0]
        XCTAssertEqual(changed.elements[0].editableFontSize, 40)
        XCTAssertEqual(changed.attributes["unknown"], original.attributes["unknown"])
        session.undo(); XCTAssertEqual(session.slides[0], original)
        session.redo(); XCTAssertEqual(session.slides[0], changed)
        let json = #"{"id":"bad","content":{"type":"slide","attrs":{"elements":[{"id":"text","type":"text","text":"old","style":{"fontSize":{"future":true}}}]}}}"#
        let bad = try SlideBlock(json: Data(json.utf8))
        var rejected = try PresentationSession(slides: [bad])
        XCTAssertNil(bad.elements[0].editableFontSize)
        XCTAssertThrowsError(try rejected.update(at: 0) { try $0.setTextStyle(elementID: "text", key: "fontSize", value: .integer(40)) })
        XCTAssertEqual(rejected.slides[0], bad); XCTAssertFalse(rejected.canUndo)
    }
    func testItalicUndoAndRejectsMalformedValue() throws {
        let original = try slide("one")
        var session = try PresentationSession(slides: [original])
        XCTAssertEqual(original.elements[0].editableItalic, false)
        try session.update(at: 0) { try $0.setTextStyle(elementID: "text", key: "italic", value: .bool(true)) }
        let changed = session.slides[0]
        XCTAssertEqual(changed.elements[0].editableItalic, true)
        XCTAssertEqual(changed.attributes["unknown"], original.attributes["unknown"])
        session.undo(); XCTAssertEqual(session.slides[0], original)
        session.redo(); XCTAssertEqual(session.slides[0], changed)
        let json = #"{"id":"bad","content":{"type":"slide","attrs":{"elements":[{"id":"text","type":"text","text":"old","style":{"italic":{"future":true}}}]}}}"#
        let bad = try SlideBlock(json: Data(json.utf8))
        var rejected = try PresentationSession(slides: [bad])
        XCTAssertNil(bad.elements[0].editableItalic)
        XCTAssertThrowsError(try rejected.update(at: 0) { try $0.setTextStyle(elementID: "text", key: "italic", value: .bool(true)) })
        XCTAssertEqual(rejected.slides[0], bad); XCTAssertFalse(rejected.canUndo)
    }
    func testFontWeightUndoAndRejectsMalformedValue() throws {
        let original = try slide("one")
        var session = try PresentationSession(slides: [original])
        XCTAssertEqual(original.elements[0].editableFontWeight, 500)
        try session.update(at: 0) { try $0.setTextStyle(elementID: "text", key: "fontWeight", value: .integer(700)) }
        let changed = session.slides[0]
        XCTAssertEqual(changed.elements[0].editableFontWeight, 700)
        XCTAssertEqual(changed.attributes["unknown"], original.attributes["unknown"])
        session.undo(); XCTAssertEqual(session.slides[0], original)
        session.redo(); XCTAssertEqual(session.slides[0], changed)
        let json = #"{"id":"bad","content":{"type":"slide","attrs":{"elements":[{"id":"text","type":"text","text":"old","style":{"fontWeight":{"future":true}}}]}}}"#
        let bad = try SlideBlock(json: Data(json.utf8))
        var rejected = try PresentationSession(slides: [bad])
        XCTAssertNil(bad.elements[0].editableFontWeight)
        XCTAssertThrowsError(try rejected.update(at: 0) { try $0.setTextStyle(elementID: "text", key: "fontWeight", value: .integer(700)) })
        XCTAssertEqual(rejected.slides[0], bad); XCTAssertFalse(rejected.canUndo)
    }
    func testTextAlignmentUndoAndRejectsMalformedAlignment() throws {
        let original = try slide("one")
        var session = try PresentationSession(slides: [original])
        XCTAssertEqual(original.elements[0].editableTextAlignment, "left")
        try session.update(at: 0) { try $0.setTextStyle(elementID: "text", key: "align", value: .string("center")) }
        let changed = session.slides[0]
        XCTAssertEqual(changed.elements[0].editableTextAlignment, "center")
        XCTAssertEqual(changed.attributes["unknown"], original.attributes["unknown"])
        session.undo(); XCTAssertEqual(session.slides[0], original)
        session.redo(); XCTAssertEqual(session.slides[0], changed)
        let json = #"{"id":"bad","content":{"type":"slide","attrs":{"elements":[{"id":"text","type":"text","text":"old","style":{"align":{"future":true}}}]}}}"#
        let bad = try SlideBlock(json: Data(json.utf8))
        var rejected = try PresentationSession(slides: [bad])
        XCTAssertNil(bad.elements[0].editableTextAlignment)
        XCTAssertThrowsError(try rejected.update(at: 0) { try $0.setTextStyle(elementID: "text", key: "align", value: .string("left")) })
        XCTAssertEqual(rejected.slides[0], bad); XCTAssertFalse(rejected.canUndo)
    }
    func testEditingOrderUndoAndUnknownFields() throws {
        let one = try slide("one"), two = try slide("two")
        var session = try PresentationSession(slides: [one, two])
        try session.update(at: 0) { try $0.setText(elementID: "text", text: "new") }
        let changed = session.slides[0]
        XCTAssertEqual(changed.elements[0].text, "new")
        XCTAssertTrue(String(decoding: try changed.json(), as: UTF8.self).contains("keep"))
        try session.move(from: 0, to: 1)
        XCTAssertEqual(session.slides.map(\.id), ["two", "one"])
        session.undo(); XCTAssertEqual(session.slides[0], changed)
        session.undo(); XCTAssertEqual(session.slides, [one, two])
        session.redo(); XCTAssertEqual(session.slides[0], changed)
        try session.remove(at: 1)
        XCTAssertFalse(session.canRedo)
        session.undo(); XCTAssertEqual(session.slides.count, 2)
        session.redo(); XCTAssertEqual(session.slides.count, 1)
    }
    func testBlankDuplicateReorderAndUndo() throws {
        let original = try SlideBlock.blank(id: "original")
        let copy = try original.duplicated(id: "copy")
        XCTAssertEqual(copy.layout, "blank")
        XCTAssertEqual(copy.attributes["bid"], .string("copy"))
        var session = try PresentationSession(slides: [original])
        try session.insert(copy, at: 1)
        try session.move(from: 1, to: 0)
        XCTAssertEqual(session.slides.map(\.id), ["copy", "original"])
        session.undo(); XCTAssertEqual(session.slides.map(\.id), ["original", "copy"])
        session.undo(); XCTAssertEqual(session.slides.map(\.id), ["original"])
        session.redo(); XCTAssertEqual(session.slides.map(\.id), ["original", "copy"])
        XCTAssertThrowsError(try slide("opaque").duplicated())
    }
    func testRejectsInvalidAndPreservesSession() throws {
        let one = try slide("one")
        var session = try PresentationSession(slides: [one])
        XCTAssertThrowsError(try session.remove(at: 0))
        XCTAssertThrowsError(try session.insert(one, at: 0))
        XCTAssertThrowsError(try session.move(from: 0, to: 2))
        XCTAssertThrowsError(try session.update(at: 0) { try $0.setText(elementID: "missing", text: "x") })
        XCTAssertEqual(session.slides, [one]); XCTAssertFalse(session.canUndo)
    }
}
