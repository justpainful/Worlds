import Foundation
import XCTest
import WorldsModels
@testable import WorldsRichText

final class RichTextDocumentTests: XCTestCase {
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
}

