import Foundation
import XCTest
@testable import WorldsDrawingValidation

final class WorldsDrawingValidationTests: XCTestCase {
    func testOriginalSceneFixtureAndInvalidFrame() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "original-journal-fixture", withExtension: "json"))
        let fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let initial = try XCTUnwrap(fixture["initial"] as? [String: Any])
        var scene = try XCTUnwrap(initial["scene"] as? [String: Any])
        try OriginalDrawingValidator.validate(sceneJSON: JSONSerialization.data(withJSONObject: scene))
        scene["defaultFrameId"] = "missing"
        XCTAssertThrowsError(try OriginalDrawingValidator.validate(sceneJSON: JSONSerialization.data(withJSONObject: scene)))
    }
}
