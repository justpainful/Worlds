import Foundation
import XCTest
@testable import WorldsNativeDiagrams

final class ConceptMapTests: XCTestCase {
    private let template = """
    flowchart TD
      C0(["المفهوم الأساسي"])
      C1["المفهوم الأول"]
      C2["المفهوم الثاني"]
      C3["المفهوم الثالث"]
      C4["النتيجة / الأثر"]
      C0 -->|يتكون من| C1
      C0 -->|يعتمد على| C2
      C1 -->|يؤدي إلى| C3
      C2 -->|يتفاعل مع| C3
      C3 -->|ينتج عنه| C4
    """

    func testReadsTheConceptMapTemplate() throws {
        let graph = try XCTUnwrap(ConceptMapParser.parse(template))
        XCTAssertTrue(graph.simple)
        XCTAssertEqual(graph.nodes.map(\.id), ["C0", "C1", "C2", "C3", "C4"])
        XCTAssertEqual(graph.nodes[0].label, "المفهوم الأساسي")
        XCTAssertEqual(graph.nodes[0].shape, "stadium")
        XCTAssertEqual(graph.edges[0], ConceptMapEdge(from: "C0", to: "C1", label: "يتكون من", style: "arrow"))
        XCTAssertEqual(graph.shownView, .world)
    }

    func testReadsChainsAndPlainFlowcharts() throws {
        let graph = try XCTUnwrap(ConceptMapParser.parse("graph LR\n  A[Idea] --> B[Plan] --> C[Ship]; C -- feeds --> A\n  D-->E"))
        XCTAssertEqual(graph.direction, "LR")
        XCTAssertEqual(graph.edges.map { "\($0.from)>\($0.to):\($0.label)" }, ["A>B:", "B>C:", "C>A:feeds", "D>E:"])
        XCTAssertEqual(graph.shownView, .diagram)
    }

    func testKeepsTheLayoutInComments() throws {
        let graph = try XCTUnwrap(ConceptMapParser.parse(template))
        let code = ConceptMapParser.withLayout(template, view: .world, positions: ["C0": ConceptMapPoint(x: 10.4, y: -20.6)], order: graph.nodes.map(\.id))
        XCTAssertTrue(code.hasPrefix(template))
        let again = try XCTUnwrap(ConceptMapParser.parse(code))
        XCTAssertEqual(again.view, .world)
        XCTAssertEqual(again.positions["C0"], ConceptMapPoint(x: 10, y: -21))
    }

    func testMarksWhatItCannotRead() throws {
        XCTAssertFalse(try XCTUnwrap(ConceptMapParser.parse("flowchart TD\n  subgraph S\n  A --> B\n  end")).simple)
        XCTAssertNil(ConceptMapParser.parse("sequenceDiagram\n  A->>B: hi"))
    }
}

#if canImport(AppKit)
import AppKit
import SwiftUI

/// The world really draws on a Mac: the concept map template renders its coloured
/// concepts (not an empty or black picture), as a world and as a diagram.
@MainActor
final class ConceptWorldRenderingTests: XCTestCase {
    private func colouredPixels(_ view: some View, tint: CGFloat = 0.25) throws -> Int {
        let renderer = ImageRenderer(content: view.frame(width: 600, height: 420).background(Color.white))
        renderer.scale = 1
        let image = try XCTUnwrap(renderer.cgImage)
        let rep = NSBitmapImageRep(cgImage: image)
        var count = 0
        for x in stride(from: 0, to: rep.pixelsWide, by: 3) {
            for y in stride(from: 0, to: rep.pixelsHigh, by: 3) {
                guard let c = rep.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { continue }
                let spread = max(c.redComponent, c.greenComponent, c.blueComponent) - min(c.redComponent, c.greenComponent, c.blueComponent)
                if spread > tint { count += 1 }
            }
        }
        return count
    }

    func testTheConceptMapDrawsAsAWorldAndAsADiagram() throws {
        let source = "flowchart TD\n  C0([\"المفهوم الأساسي\"])\n  C1[\"المفهوم الأول\"]\n  C2[\"المفهوم الثاني\"]\n  C0 -->|يتكون من| C1\n  C0 -->|يعتمد على| C2"
        let graph = try XCTUnwrap(ConceptMapParser.parse(source))
        XCTAssertGreaterThan(try colouredPixels(ConceptWorldView(graph: graph)), 20, "The concepts must be drawn as coloured points")
        // The diagram's boxes are a light tint of the concept colour with a coloured edge.
        XCTAssertGreaterThan(try colouredPixels(ConceptWorldView(graph: graph, layered: true), tint: 0.08), 20, "The diagram must draw coloured boxes")
    }
}
#endif
