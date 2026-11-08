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
