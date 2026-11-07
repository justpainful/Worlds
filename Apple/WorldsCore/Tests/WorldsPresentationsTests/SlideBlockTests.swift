import Foundation
import XCTest
import WorldsModels
@testable import WorldsPresentations

final class SlideBlockTests: XCTestCase {
    private let fixture = #"""
    {"id":"slide1","futureBlock":{"keep":true},"content":{"type":"slide","attrs":{"bid":"slide1","layout":"two-columns","background":{"color":"#16161a","attachmentId":null,"future":42},"notes":"Presenter note","elements":[{"id":"text1","type":"text","x":90,"y":70,"w":1100,"h":100,"rot":2,"opacity":1,"text":"مرحبا","style":{"fontSize":54,"fontWeight":700,"color":"#ffffff","align":"left","unknownFontTrait":true},"futureElement":42},{"id":"shape1","type":"shape","shape":"ellipse","x":40,"y":150,"w":100,"h":100,"fill":"#d2a46e"},{"id":"media1","type":"video","attachmentId":"attachment-id","x":200,"y":150,"w":400,"h":300,"fit":"contain"},{"id":"future1","type":"future-media","payload":{"keep":[1,2,3]}}],"custom":{"nested":"value"}}}}
    """#
    func testRoundTripPreservesUnknownContent() throws {
        let source = try JSONDecoder().decode(JSONValue.self, from: Data(fixture.utf8))
        let slide = try SlideBlock(source: source)
        XCTAssertEqual(slide.elements.count, 4)
        XCTAssertEqual(slide.layout, "two-columns")
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: slide.json()), source)
    }
    func testEditingTextGeometryNotesAndStylePreservesUnrelatedElements() throws {
        var slide = try SlideBlock(json: Data(fixture.utf8))
        let unknown = slide.elements[3].source
        try slide.setText(elementID: "text1", text: "Hello 👋")
        try slide.setGeometry(elementID: "text1", x: 22, y: 33, width: 400, height: 120, rotation: 12)
        try slide.setTextStyle(elementID: "text1", key: "fontSize", value: .integer(42))
        try slide.setNotes("Updated")
        XCTAssertEqual(slide.elements[0].text, "Hello 👋")
        XCTAssertEqual(slide.elements[0].x, 22)
        XCTAssertEqual(slide.notes, "Updated")
        XCTAssertEqual(slide.elements[3].source, unknown)
        XCTAssertEqual(slide.elements[0].source.slideObject?["style"]?.slideObject?["unknownFontTrait"], .bool(true))
        XCTAssertEqual(slide.elements[0].source.slideObject?["futureElement"], .integer(42))
    }
    func testRejectsInvalidEditsWithoutMutating() throws {
        var slide = try SlideBlock(json: Data(fixture.utf8))
        let before = slide.source
        XCTAssertThrowsError(try slide.setText(elementID: "shape1", text: "no"))
        XCTAssertThrowsError(try slide.setText(elementID: "missing", text: "no"))
        XCTAssertThrowsError(try slide.setGeometry(elementID: "text1", x: .nan, y: 1, width: 100, height: 10, rotation: 0))
        XCTAssertThrowsError(try slide.setTextStyle(elementID: "text1", key: "align", value: .string("wrong")))
        XCTAssertEqual(slide.source, before)
    }
    func testEmptySlideDefaultsDoNotChangeSource() throws {
        let input = Data(#"{"id":"s","content":{"type":"slide","attrs":{}}}"#.utf8)
        let slide = try SlideBlock(json: input)
        XCTAssertEqual(slide.elements.count, 0)
        XCTAssertEqual(slide.layout, "blank")
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: slide.json()), try JSONDecoder().decode(JSONValue.self, from: input))
    }
    func testDuplicateIDDoesNotEditAmbiguousElement() throws {
        let input = fixture.replacingOccurrences(of: "\"id\":\"shape1\"", with: "\"id\":\"text1\"")
        var slide = try SlideBlock(json: Data(input.utf8))
        let original = slide.source
        XCTAssertThrowsError(try slide.setText(elementID: "text1", text: "wrong"))
        XCTAssertEqual(slide.source, original)
    }
}
