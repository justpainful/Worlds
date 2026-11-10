import Foundation
import XCTest
import WorldsModels
@testable import WorldsNativeDiagrams

final class StrictFlowchartTests: XCTestCase {
    func testOriginalDefaultChainAndArabicLabels() throws {
        let graph = try StrictFlowchartParser.parse("flowchart LR\n  A[Idea] --> B[Plan] --> C[Ship]")
        XCTAssertEqual(graph.direction, .leftToRight)
        XCTAssertEqual(graph.nodes.map(\.label), ["Idea", "Plan", "Ship"])
        XCTAssertEqual(graph.nodes.map(\.depth), [0, 1, 2])
        XCTAssertEqual(graph.edges.map { $0.from + ">" + $0.to }, ["A>B", "B>C"])
        let arabic = try StrictFlowchartParser.parse("graph TD\nA[بداية] --> B[نهاية]")
        XCTAssertEqual(arabic.direction, .topToBottom)
        XCTAssertEqual(arabic.nodes.map(\.label), ["بداية", "نهاية"])
    }
    func testKnownUnsupportedSyntaxFailsClosed() {
        let cases = ["sequenceDiagram\nA->>B: hello", "flowchart LR\nA --> B; B --> C",
            "flowchart LR\nA -->|label| B", "flowchart LR\nA --> B\nstyle A fill:red",
            "flowchart LR\nA --> B\nB --> A", "flowchart LR\nA[one] --> A[two]",
            "flowchart LR\nA --> B\nA --> B", "flowchart LR\nA[<b>text</b>] --> B",
            "flowchart LR\nA --> B\nB --> C\nA --> C", "flowchart LR\nA --> B\nclick A callback"]
        for source in cases { XCTAssertThrowsError(try StrictFlowchartParser.parse(source), source) }
    }
    func testElementLimitFailsWithoutPartialResult() {
        let body = (0..<65).map { "N\($0)" }.joined(separator: "\n")
        XCTAssertThrowsError(try StrictFlowchartParser.parse("flowchart LR\n" + body))
        XCTAssertThrowsError(try StrictFlowchartParser.parse(String(repeating: "x", count: 65537)))
    }
    func testSourceEditPreservesUnknownFieldsExactly() throws {
        let raw = #"{"type":"mermaid","attrs":{"code":"flowchart LR\nA --> B","bid":"b","future":{"keep":[1,true]}},"extension":{"keep":"value"}}"#
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(raw.utf8))
        var document = try DiagramSourceDocument(source: value)
        try document.setText("unsupported source remains editable")
        guard case .object(let node) = document.source, case .object(let attrs)? = node["attrs"] else { return XCTFail("Node lost") }
        XCTAssertEqual(attrs["bid"], .string("b"))
        XCTAssertEqual(attrs["future"], .object(["keep": .array([.integer(1), .bool(true)])]))
        XCTAssertEqual(node["extension"], .object(["keep": .string("value")]))
        let saved = document.source
        XCTAssertThrowsError(try document.setText(String(repeating: "x", count: 65537)))
        XCTAssertEqual(document.source, saved)
    }
}
