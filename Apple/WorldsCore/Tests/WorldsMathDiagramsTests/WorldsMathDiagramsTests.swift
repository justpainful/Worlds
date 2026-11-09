import Foundation
import XCTest
import WorldsModels
@testable import WorldsMathDiagrams

final class WorldsMathDiagramsTests: XCTestCase {
    func testRealWorldNodeRoundTripAndSourceEdit() throws {
        let input = #"{"type":"mathBlock","attrs":{"bid":"block1","dir":"rtl","latex":"\\int_0^1 x^2\\,dx = \\frac{1}{3}","future":{"keep":true}},"futureNode":123}"#
        let original = try JSONDecoder().decode(JSONValue.self, from: Data(input.utf8))
        var node = try MathDiagramNode(source: original)
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: node.json()), original)
        try node.setText(#"x^2 + y^2 = z^2"#)
        guard case .object(let root) = node.source, case .object(let attrs)? = root["attrs"] else { return XCTFail("Missing attributes") }
        XCTAssertEqual(attrs["future"], .object(["keep": .bool(true)]))
        XCTAssertEqual(root["futureNode"], .integer(123))
    }
    func testMathCorpusAndInvalidSyntax() throws {
        for formula in [#"x^2 + y^2 = z^2"#, #"\frac{1}{3}"#, #"\sqrt{x}"#, #"\int_0^1 x^2 dx"#] {
            try NativeMathDiagramParser.validateMath(formula)
        }
        XCTAssertThrowsError(try NativeMathDiagramParser.validateMath(#"\frac{"#))
    }
    func testMermaidCorpusAndUnsupportedSyntax() throws {
        let flowchart = "flowchart LR\n  A[Idea] --> B[Plan] --> C[Ship]"
        let sequence = "sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi"
        let pie = "pie title Pets\n  \"Cats\" : 4\n  \"Dogs\" : 3"
        for source in [flowchart, sequence, pie] { XCTAssertFalse(try NativeMathDiagramParser.validateMermaid(source).isEmpty) }
        XCTAssertThrowsError(try NativeMathDiagramParser.validateMermaid("not a mermaid diagram"))
    }
    func testUnknownNodeOrOversizedSourceIsRejected() throws {
        XCTAssertThrowsError(try MathDiagramNode(source: .object(["type": .string("future"), "attrs": .object([:])])))
        var node = try MathDiagramNode(source: .object(["type": .string("mermaid"), "attrs": .object(["code": .string("flowchart LR\n A --> B")])]))
        XCTAssertThrowsError(try node.setText(String(repeating: "x", count: 65537)))
        XCTAssertEqual(node.text, "flowchart LR\n A --> B")
    }
    func testMermaidReportsDegradedAndIgnoredDirectives() throws {
        let ignored = "flowchart LR\n A --> B\n classDef hot fill:#f96\n click A callback"
        let inspection = try NativeMathDiagramParser.inspectMermaid(ignored)
        XCTAssertNotNil(inspection.diagramType)
        XCTAssertFalse(inspection.fidelityVerified)
        XCTAssertTrue(inspection.diagnostics.contains { $0.message.contains("classDef") })
        XCTAssertTrue(inspection.diagnostics.contains { $0.message.contains("click") })
        XCTAssertThrowsError(try NativeMathDiagramParser.validateMermaid(ignored))
        let degraded = try NativeMathDiagramParser.inspectMermaid("flowchart LR junk\n A --> B")
        XCTAssertNotNil(degraded.diagramType)
        XCTAssertFalse(degraded.diagnostics.isEmpty)
    }
}


