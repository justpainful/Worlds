import XCTest
import SceneKit
@testable import Worlds3DViews

final class DXFParserTests: XCTestCase {
    func testParsesSimpleDXFLines() throws {
        let dxf = """
        0
        SECTION
        2
        ENTITIES
        0
        LINE
        10
        0.0
        20
        0.0
        30
        0.0
        11
        10.0
        21
        20.0
        31
        30.0
        0
        ENDSEC
        0
        EOF
        """
        let parsed = try CADDXFParser.parse(text: dxf)
        XCTAssertEqual(parsed.stats.lineCount, 1)
        XCTAssertEqual(parsed.stats.vertexCount, 2)
        XCTAssertEqual(parsed.stats.boundingBoxMin.x, 0.0, accuracy: 0.001)
        XCTAssertEqual(parsed.stats.boundingBoxMax.x, 10.0, accuracy: 0.001)
        XCTAssertEqual(parsed.stats.boundingBoxMax.y, 20.0, accuracy: 0.001)
        XCTAssertEqual(parsed.stats.boundingBoxMax.z, 30.0, accuracy: 0.001)
    }

    func testParsesDXF3DFace() throws {
        let dxf = """
        0
        SECTION
        2
        ENTITIES
        0
        3DFACE
        10
        0.0
        20
        0.0
        30
        0.0
        11
        10.0
        21
        0.0
        31
        0.0
        12
        10.0
        22
        10.0
        32
        0.0
        13
        0.0
        23
        10.0
        33
        0.0
        0
        ENDSEC
        0
        EOF
        """
        let parsed = try CADDXFParser.parse(text: dxf)
        // Quad face produces 2 triangles
        XCTAssertEqual(parsed.stats.faceCount, 2)
        XCTAssertEqual(parsed.stats.dimensions.x, 10.0, accuracy: 0.001)
        XCTAssertEqual(parsed.stats.dimensions.y, 10.0, accuracy: 0.001)
    }

    func testParsesDXFCirclesAndArcs() throws {
        let dxf = """
        0
        SECTION
        2
        ENTITIES
        0
        CIRCLE
        10
        5.0
        20
        5.0
        30
        0.0
        40
        2.5
        0
        ARC
        10
        0.0
        20
        0.0
        30
        0.0
        40
        5.0
        50
        0.0
        51
        90.0
        0
        ENDSEC
        0
        EOF
        """
        let parsed = try CADDXFParser.parse(text: dxf)
        XCTAssertGreaterThan(parsed.stats.lineCount, 30)
        XCTAssertGreaterThan(parsed.stats.vertexCount, 60)
    }

    func testEmptyDXFThrowsError() {
        let dxf = """
        0
        SECTION
        2
        ENTITIES
        0
        ENDSEC
        0
        EOF
        """
        XCTAssertThrowsError(try CADDXFParser.parse(text: dxf)) { error in
            XCTAssertEqual(error as? Worlds3DError, .emptyScene)
        }
    }
}
