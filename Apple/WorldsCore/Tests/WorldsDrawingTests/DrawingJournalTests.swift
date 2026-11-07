import Foundation
import XCTest
import WorldsModels
@testable import WorldsDrawing

private struct JournalFixture: Decodable {
    let initial, add, move, undo, redo, afterUndo, afterRedo: JSONValue
    let nodeID: String
}
final class DrawingJournalTests: XCTestCase {
    private func fixture() throws -> JournalFixture {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "original-journal-fixture", withExtension: "json"))
        return try JSONDecoder().decode(JournalFixture.self, from: Data(contentsOf: url))
    }
    func testOriginalJournalEditUndoRedoAndRoundTrip() throws {
        let f = try fixture()
        var doc = try DrawingDocument(json: JSONEncoder().encode(f.initial))
        doc = try DrawingJournal.append(f.add, to: doc, actor: "alice")
        doc = try DrawingJournal.append(f.move, to: doc, actor: "alice")
        doc = try DrawingJournal.append(f.undo, to: doc, actor: "alice")
        XCTAssertEqual(doc.source, f.afterUndo)
        doc = try DrawingJournal.append(f.redo, to: doc, actor: "alice")
        XCTAssertEqual(doc.source, f.afterRedo)
        XCTAssertEqual(try DrawingDocument(json: doc.json()).source, f.afterRedo)
        XCTAssertEqual(try DrawingJournal.append(f.redo, to: doc, actor: "alice").source, f.afterRedo)
    }
    func testRejectsStaleAndOtherAuthorsToggle() throws {
        let f = try fixture()
        let doc = try DrawingDocument(json: JSONEncoder().encode(f.initial))
        XCTAssertThrowsError(try DrawingJournal.append(f.move, to: doc, actor: "alice"))
        let one = try DrawingJournal.append(f.add, to: doc, actor: "alice")
        let wrong = JSONValue.object(["id":.string("wrong"),"actor":.string("bob"),"base":.integer(1),"at":.integer(1),"label":.string("Undo"),"type":.string("toggle"),"target":.string(try XCTUnwrap(f.add.objectValueForTest?["id"]?.stringValueForTest)),"enabled":.bool(false)])
        XCTAssertThrowsError(try DrawingJournal.append(wrong, to: one, actor: "bob"))
    }
    func testSelectionAndTransformProducePatch() throws {
        let f = try fixture()
        let doc = try DrawingDocument(json: JSONEncoder().encode(f.afterRedo))
        XCTAssertEqual(try DrawingSelection.nodes(in: doc.scene, ids: [f.nodeID]), [f.nodeID])
        let change = try DrawingSelection.transformChange(in: doc.scene, nodeID: f.nodeID,
            transform: .init(x: 8,y: 9,width: 12,height: 13,rotation: 15,flipX: false,flipY: true))
        XCTAssertEqual(change.objectValueForTest?["id"]?.stringValueForTest, f.nodeID)
        XCTAssertThrowsError(try DrawingSelection.nodes(in: doc.scene, ids: ["unknown"]))
    }
}
private extension JSONValue {
    var objectValueForTest: [String: JSONValue]? { if case .object(let o) = self { return o }; return nil }
    var stringValueForTest: String? { if case .string(let s) = self { return s }; return nil }
}
