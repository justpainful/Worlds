import XCTest
import SceneKit
@testable import Worlds3DViews

final class STLParserTests: XCTestCase {
    func testParsesASCIISTL() throws {
        let asciiSTL = """
        solid test_tetrahedron
          facet normal 0.0 0.0 -1.0
            outer loop
              vertex 0.0 0.0 0.0
              vertex 10.0 0.0 0.0
              vertex 0.0 10.0 0.0
            endloop
          endfacet
          facet normal 0.0 -1.0 0.0
            outer loop
              vertex 0.0 0.0 0.0
              vertex 0.0 0.0 10.0
              vertex 10.0 0.0 0.0
            endloop
          endfacet
        endsolid test_tetrahedron
        """
        guard let data = asciiSTL.data(using: .utf8) else {
            XCTFail("Failed to encode ASCII STL")
            return
        }
        let parsed = try STLParser.parse(data: data)
        XCTAssertEqual(parsed.stats.faceCount, 2)
        XCTAssertEqual(parsed.stats.vertexCount, 6)
        XCTAssertEqual(parsed.stats.dimensions.x, 10.0, accuracy: 0.001)
        XCTAssertEqual(parsed.stats.dimensions.y, 10.0, accuracy: 0.001)
        XCTAssertEqual(parsed.stats.dimensions.z, 10.0, accuracy: 0.001)
    }

    func testParsesBinarySTL() throws {
        var data = Data(count: 84 + 50) // 1 triangle
        // 80 bytes header (zeros)
        // offset 80: triangle count = 1
        var count: UInt32 = 1
        data.replaceSubrange(80..<84, with: Data(bytes: &count, count: 4))

        // Normal: (0, 0, 1)
        var nz: Float = 1.0
        data.replaceSubrange(92..<96, with: Data(bytes: &nz, count: 4))

        // Vertex 1: (0, 0, 0)
        // Vertex 2: (5, 0, 0)
        var v2x: Float = 5.0
        data.replaceSubrange(108..<112, with: Data(bytes: &v2x, count: 4))

        // Vertex 3: (0, 8, 0)
        var v3y: Float = 8.0
        data.replaceSubrange(124..<128, with: Data(bytes: &v3y, count: 4))

        let parsed = try STLParser.parse(data: data)
        XCTAssertEqual(parsed.stats.faceCount, 1)
        XCTAssertEqual(parsed.stats.vertexCount, 3)
        XCTAssertEqual(parsed.stats.dimensions.x, 5.0, accuracy: 0.001)
        XCTAssertEqual(parsed.stats.dimensions.y, 8.0, accuracy: 0.001)
    }

    func testTruncatedBinarySTLThrowsError() {
        let truncated = Data(count: 90) // claims 0 or is too small for triangle
        XCTAssertThrowsError(try STLParser.parseBinary(data: truncated))
    }
}
