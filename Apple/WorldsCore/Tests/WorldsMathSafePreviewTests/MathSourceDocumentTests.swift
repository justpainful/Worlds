import Foundation
import XCTest
import WorldsModels
#if canImport(WorldsMathSafePreview)
@testable import WorldsMathSafePreview
#endif

final class MathSourceDocumentTests: XCTestCase {
    func testEditPreservesOpaqueNodeAndLatexExactly() throws {
        let raw = #"{"type":"mathBlock","attrs":{"latex":"x^2","bid":"math","future":{"keep":true}},"unknown":[1,2]}"#
        var node = try MathSourceDocument(source: JSONDecoder().decode(JSONValue.self, from: Data(raw.utf8)))
        XCTAssertTrue(node.display)
        try node.setText("\\frac{1}{2} + unknown source")
        guard case .object(let object) = node.source, case .object(let attrs)? = object["attrs"] else { return XCTFail("Missing attrs") }
        XCTAssertEqual(attrs["latex"], .string("\\frac{1}{2} + unknown source"))
        XCTAssertEqual(attrs["future"], .object(["keep": .bool(true)]))
        XCTAssertEqual(object["unknown"], .array([.integer(1), .integer(2)]))
        let before = node.source
        XCTAssertThrowsError(try node.setText(String(repeating: "x", count: 65537)))
        XCTAssertEqual(node.source, before)
    }
}
