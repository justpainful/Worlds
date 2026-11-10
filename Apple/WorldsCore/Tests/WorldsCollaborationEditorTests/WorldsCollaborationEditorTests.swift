import Foundation
import XCTest
import WorldsRichText
@testable import WorldsCollaborationEditor

final class WorldsCollaborationEditorTests: XCTestCase {
    private func document(_ json: String) throws -> RichTextDocument { try RichTextDocument(json: Data(json.utf8)) }
    func testPlansSinglePlainInsertionWithoutMutatingDocument() throws {
        let doc = try document(#"{"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"block-1"},"content":[{"type":"text","text":"Hello 🌍"}]}]}"#)
        let before = doc.source
        let intent = try CollaborativeInsertPlanner.prepare(document: doc, selection: NSRange(location: 6, length: 0), insertion: "Alice ", markedTextPending: false)
        XCTAssertEqual(intent.blockIndex, 0); XCTAssertEqual(intent.blockID, "block-1")
        XCTAssertEqual(intent.offsetUTF16, 6); XCTAssertEqual(intent.expectedText, "Hello 🌍")
        XCTAssertEqual(doc.source, before)
    }
    func testRejectsMarkedTextNonInsertionAndSurrogateSplit() throws {
        let doc = try document(#"{"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"block-1"},"content":[{"type":"text","text":"Hello 🌍"}]}]}"#)
        XCTAssertThrowsError(try CollaborativeInsertPlanner.prepare(document: doc, selection: NSRange(location: 6, length: 0), insertion: "x", markedTextPending: true))
        XCTAssertThrowsError(try CollaborativeInsertPlanner.prepare(document: doc, selection: NSRange(location: 1, length: 1), insertion: "x", markedTextPending: false))
        XCTAssertThrowsError(try CollaborativeInsertPlanner.prepare(document: doc, selection: NSRange(location: 7, length: 0), insertion: "x", markedTextPending: false))
        XCTAssertThrowsError(try CollaborativeInsertPlanner.prepare(document: doc, selection: NSRange(location: 6, length: 0), insertion: "\n", markedTextPending: false))
    }
    func testRejectsDuplicateIDsAndRichText() throws {
        let duplicate = try document(#"{"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"same"},"content":[{"type":"text","text":"a"}]},{"type":"paragraph","attrs":{"bid":"same"},"content":[{"type":"text","text":"b"}]}]}"#)
        XCTAssertThrowsError(try CollaborativeInsertPlanner.prepare(document: duplicate, selection: NSRange(location: 0, length: 0), insertion: "x", markedTextPending: false))
        let styled = try document(#"{"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"p"},"content":[{"type":"text","text":"a","marks":[{"type":"bold"}]}]}]}"#)
        XCTAssertThrowsError(try CollaborativeInsertPlanner.prepare(document: styled, selection: NSRange(location: 0, length: 0), insertion: "x", markedTextPending: false))
    }
}
