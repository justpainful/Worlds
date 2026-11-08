import Foundation
import XCTest
import WorldsModels
@testable import WorldsRichText

final class RichTextDocumentTests: XCTestCase {
    func testAppendColumnRejectsLaterInvalidRowAtomically() throws {
        let json = #"{"type":"doc","content":[{"type":"table","attrs":{"bid":"t"},"content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"keep"}]}]}]},{"type":"tableRow","content":[{"type":"tableCell","attrs":{"colspan":2},"content":[{"type":"paragraph","content":[]}]}]}]}]}"#
        var document = try RichTextDocument(json: Data(json.utf8))
        let before = document
        XCTAssertThrowsError(try document.appendPlainTableColumn(at: RichTextPath([0])))
        XCTAssertEqual(document, before)
    }
    func testAppendColumnUsesLastCellTypeInMixedRows() throws {
        let json = #"{"type":"doc","content":[{"type":"table","attrs":{"bid":"t"},"content":[{"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[]}]}]},{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[]}]},{"type":"tableHeader","content":[{"type":"paragraph","content":[]}]}]}]}]}"#
        let expected = #"{"type":"doc","content":[{"type":"table","attrs":{"bid":"t"},"content":[{"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[]}]}]},{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[]}]},{"type":"tableHeader","content":[{"type":"paragraph","content":[]}]},{"type":"tableHeader","content":[{"type":"paragraph","content":[]}]}]}]}]}"#
        var document = try RichTextDocument(json: Data(json.utf8))
        try document.appendPlainTableColumn(at: RichTextPath([0]))
        XCTAssertEqual(document.source, try RichTextDocument(json: Data(expected.utf8)).source)
    }
    func testHeadingConversionRejectsParagraphStyleWithoutChangingDocument() throws {
        for json in [
            #"{"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"p","pstyle":"title","future":true},"content":[{"type":"text","text":"عربي"}]}]}"#,
            #"{"type":"doc","content":[{"type":"heading","attrs":{"bid":"p","level":1,"pstyle":"future","future":true},"content":[{"type":"text","text":"عربي"}]}]}"#
        ] {
            var document = try RichTextDocument(json: Data(json.utf8))
            let original = document
            let level: Int? = json.contains("\"heading\"") ? nil : 1
            XCTAssertThrowsError(try document.setHeading(at: RichTextPath([0]), level: level))
            XCTAssertEqual(document, original)
        }
    }
    func testLiftRejectsNegativePathAndEmptyListWithoutMutation() throws {
        let json = #"{"type":"doc","content":[{"type":"bulletList","attrs":{"bid":"list"},"content":[]}]}"#
        var document = try RichTextDocument(json: Data(json.utf8))
        let original = document
        XCTAssertThrowsError(try document.liftLastNestedItem(at: RichTextPath([0, -1, 0, 0])))
        XCTAssertEqual(document, original)
        XCTAssertThrowsError(try document.liftLastNestedItem(at: RichTextPath([0, 0, -1, 0])))
        XCTAssertEqual(document, original)
    }
    func testLiftRejectsNullAttributesThatPersistenceProtects() throws {
        for (listAttrs, itemAttrs) in [("null", "{}"), ("{}", "null")] {
            let json = """
            {"type":"doc","content":[{"type":"bulletList","attrs":{"bid":"list"},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[]},{"type":"bulletList","attrs":\(listAttrs),"content":[{"type":"listItem","attrs":\(itemAttrs),"content":[{"type":"paragraph","content":[]}]}]}]}]}]}
            """
            var document = try RichTextDocument(json: Data(json.utf8))
            let original = document
            XCTAssertThrowsError(try document.liftLastNestedItem(at: RichTextPath([0, 0, 1, 0])))
            XCTAssertEqual(document, original)
        }
    }
    func testHeadingConversionPreservesOpaqueDataAndRejectsAmbiguousLevel() throws {
        let json = #"{"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"a","dir":"rtl","future":{"v":1}},"content":[{"type":"text","text":"عربي 👋","marks":[{"type":"future","attrs":{"x":3}}]}]},{"type":"widget","attrs":{"payload":true}}]}"#
        let original = try RichTextDocument(json: Data(json.utf8))
        var doc = original
        try doc.setHeading(at: RichTextPath([0]), level: 2)
        XCTAssertEqual(doc.project().text, original.project().text)
        try doc.setHeading(at: RichTextPath([0]), level: nil)
        XCTAssertEqual(doc, original)
        XCTAssertThrowsError(try doc.setHeading(at: RichTextPath([0]), level: 4))
        XCTAssertThrowsError(try doc.setHeading(at: RichTextPath([1]), level: 1))
        XCTAssertEqual(doc, original)
        let ambiguous = #"{"type":"doc","content":[{"type":"paragraph","attrs":{"level":"future"},"content":[]}]}"#
        var blocked = try RichTextDocument(json: Data(ambiguous.utf8))
        let before = blocked
        XCTAssertThrowsError(try blocked.setHeading(at: RichTextPath([0]), level: 1))
        XCTAssertEqual(blocked, before)
    }
    private let corpus = #"""
    {"type":"doc","attrs":{"custom":"untouched"},"content":[
      {"type":"paragraph","attrs":{"dir":"rtl","future":17},"content":[{"type":"text","text":"مرحبا 👋","marks":[{"type":"bold"},{"type":"futureMark","attrs":{"x":[1,2]}}]}]},
      {"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"First","marks":[{"type":"italic"}]}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Second"}]}]}]},
      {"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"A"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"B"}]}]}]}]},
      {"type":"futureWidget","attrs":{"payload":{"deep":true}}}
    ]}
    """#

    func testRoundTripPreservesUnknownData() throws {
        let original = try JSONDecoder().decode(JSONValue.self, from: Data(corpus.utf8))
        let doc = try RichTextDocument(source: original)
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: doc.json()), original)
        let projection = doc.project()
        XCTAssertTrue(projection.text.contains("مرحبا 👋"))
        XCTAssertTrue(projection.text.contains("First\nSecond"))
        XCTAssertTrue(projection.text.contains("A\tB"))
        XCTAssertTrue(projection.text.contains("\u{fffc}"))
        XCTAssertEqual(projection.spans.first?.direction, "rtl")
        XCTAssertEqual(projection.spans.first?.marks.count, 2)
    }

    func testTargetedTextEditPreservesUnknownSiblingAndMark() throws {
        var doc = try RichTextDocument(json: Data(corpus.utf8))
        let before = doc.source
        try doc.replaceText(at: RichTextPath([0, 0]), range: NSRange(location: 0, length: 5), with: "أهلًا")
        let projection = doc.project()
        XCTAssertTrue(projection.text.hasPrefix("أهلًا"))
        XCTAssertEqual(projection.spans.first?.marks.count, 2)
        guard case .object(let oldRoot) = before, case .array(let oldNodes)? = oldRoot["content"],
              case .object(let newRoot) = doc.source, case .array(let newNodes)? = newRoot["content"] else { return XCTFail("Missing nodes") }
        XCTAssertEqual(oldNodes[3], newNodes[3])
        XCTAssertEqual(oldNodes[2], newNodes[2])
    }

    func testRejectsInvalidPathsAndSplitUnicode() throws {
        var doc = try RichTextDocument(json: Data(corpus.utf8))
        let before = doc.source
        XCTAssertThrowsError(try doc.replaceText(at: RichTextPath([99]), range: NSRange(location: 0, length: 0), with: "x"))
        XCTAssertThrowsError(try doc.replaceText(at: RichTextPath([0]), range: NSRange(location: 0, length: 0), with: "x"))
        XCTAssertThrowsError(try doc.replaceText(at: RichTextPath([0, 0]), range: NSRange(location: 7, length: 1), with: "x"))
        XCTAssertEqual(doc.source, before)
    }

    func testMarksAreEditedOnlyWhenExplicitlyRequested() throws {
        var doc = try RichTextDocument(json: Data(corpus.utf8))
        let mark = JSONValue.object(["type": .string("underline")])
        try doc.setMarks(at: RichTextPath([0, 0]), marks: [mark])
        XCTAssertEqual(doc.project().spans.first?.marks, [mark])
    }

    #if canImport(UIKit) || canImport(AppKit)
    func testNativeAttributedProjectionMatchesPlainText() throws {
        let doc = try RichTextDocument(json: Data(corpus.utf8))
        XCTAssertEqual(doc.attributedString().string, doc.project().text)
        XCTAssertGreaterThan(doc.attributedString().length, 0)
    }
    #endif
    func testSplitAndMergeParagraphsPreserveOtherBlocks() throws {
        let json = #"{"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"original","dir":"rtl"},"content":[{"type":"text","text":"abcd","marks":[{"type":"bold"}]}]},{"type":"futureWidget","attrs":{"keep":true}}]}"#
        var document = try RichTextDocument(json: Data(json.utf8))
        try document.replaceParagraphSelection(NSRange(location: 2, length: 0), with: "\n")
        XCTAssertEqual(document.project().text, "ab\ncd\n\u{fffc}")
        guard case .object(let splitRoot) = document.source, case .array(let blocks)? = splitRoot["content"],
              case .object(let first) = blocks[0], case .object(let second) = blocks[1],
              case .object(let firstAttrs)? = first["attrs"], case .object(let secondAttrs)? = second["attrs"] else { return XCTFail("Missing split blocks") }
        XCTAssertNotEqual(firstAttrs["bid"], secondAttrs["bid"])
        XCTAssertEqual(firstAttrs["dir"], secondAttrs["dir"])
        try document.replaceParagraphSelection(NSRange(location: 2, length: 1), with: "")
        XCTAssertEqual(document.project().text, "abcd\n\u{fffc}")
    }
    func testUTF16OffsetsAndUnknownMarksFailClosed() throws {
        let json = #"{"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"a"},"content":[{"type":"text","text":"A👋B"}]}]}"#
        var document = try RichTextDocument(json: Data(json.utf8))
        XCTAssertThrowsError(try document.replaceParagraphSelection(NSRange(location: 2, length: 0), with: "x"))
        try document.replaceParagraphSelection(NSRange(location: 1, length: 2), with: "🙂")
        XCTAssertEqual(document.project().text, "A🙂B")
        let unknown = #"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"abc","marks":[{"type":"future"}]}]}]}"#
        var protected = try RichTextDocument(json: Data(unknown.utf8))
        let before = protected.source
        XCTAssertThrowsError(try protected.replaceParagraphSelection(NSRange(location: 1, length: 0), with: "\n"))
        XCTAssertEqual(protected.source, before)
    }
    func testNestedListSplitPreservesMarksAndUnknownContainerAttributes() throws {
        let json = #"{"type":"doc","content":[{"type":"bulletList","attrs":{"custom":9},"content":[{"type":"listItem","attrs":{"custom":"keep"},"content":[{"type":"paragraph","attrs":{"dir":"rtl"},"content":[{"type":"text","text":"أهلا","marks":[{"type":"bold"}]}]}]}]}]}"#
        var document = try RichTextDocument(json: Data(json.utf8))
        try document.replaceParagraphSelection(NSRange(location: 2, length: 0), with: "\n")
        XCTAssertEqual(document.project().text, "أه\nلا")
        XCTAssertEqual(document.project().spans.count, 2)
        XCTAssertEqual(document.project().spans[0].marks, document.project().spans[1].marks)
        guard case .object(let root) = document.source, case .array(let top)? = root["content"],
              case .object(let list) = top[0], case .object(let attrs)? = list["attrs"] else { return XCTFail("Missing list") }
        XCTAssertEqual(attrs["custom"], .integer(9))
    }
    func testTableCellEditsCannotCrossCellBoundary() throws {
        let json = #"{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","attrs":{"colspan":1},"content":[{"type":"paragraph","content":[{"type":"text","text":"abc"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"def"}]}]}]}]}]}"#
        var document = try RichTextDocument(json: Data(json.utf8))
        XCTAssertEqual(document.project().text, "abc\tdef")
        let before = document.source
        XCTAssertThrowsError(try document.replaceParagraphSelection(NSRange(location: 2, length: 3), with: "x"))
        XCTAssertEqual(document.source, before)
        try document.replaceParagraphSelection(NSRange(location: 1, length: 0), with: "\n")
        XCTAssertEqual(document.project().text, "a\nbc\tdef")
    }
    func testSplitRejectsUnknownParagraphIdentityAttributes() throws {
        let input = #"{"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"a","futureIdentity":"unique"},"content":[{"type":"text","text":"abcd"}]}]}"#
        var document = try RichTextDocument(json: Data(input.utf8))
        let before = document.source
        XCTAssertThrowsError(try document.replaceParagraphSelection(NSRange(location: 2, length: 0), with: "\n"))
        XCTAssertEqual(document.source, before)
    }
}
