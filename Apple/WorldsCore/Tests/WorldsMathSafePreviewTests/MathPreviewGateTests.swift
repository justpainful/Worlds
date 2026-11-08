import XCTest
@testable import WorldsMathSafePreview

final class MathPreviewGateTests: XCTestCase {
    func testNarrowCorpus() throws {
        for source in [#"x^2 + y^2 = z^2"#, #"\frac{1}{3}"#, #"\sqrt{x}"#, #"\int_0^1 x^2\,dx"#] {
            XCTAssertNoThrow(try MathPreviewGate.validate(source), source)
        }
    }
    func testUnsupportedAndMalformedRemainSourceOnly() {
        for source in [#"\text{hello}"#, #"\unknown{x}"#, #"\frac{"#, "مرحبا", String(repeating: "x", count: 513), String(repeating: "{", count: 13) + "x" + String(repeating: "}", count: 13)] {
            XCTAssertThrowsError(try MathPreviewGate.validate(source), source)
        }
    }
}
