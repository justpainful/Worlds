import Foundation
import XCTest
@testable import WorldsModels

final class ResourceCompatibilityTests: XCTestCase {
    func testRichBlockRetainsUnknownNestedNodesAndArabic() throws {
        let source = #"{"id":"b1","pageId":"p1","type":"futureBlock","order":1.5,"content":{"type":"futureNode","attrs":{"color":"#abcdef","nested":{"flag":true,"nothing":null}},"content":[{"type":"text","text":"مرحبا"}]},"properties":{"extension":{"version":2}},"direction":"rtl","createdAt":1730000000000,"updatedAt":1730000000001}"#
        let original = Data(source.utf8)
        let block = try JSONDecoder().decode(ResourceBlock.self, from: original)
        let encoded = try JSONEncoder().encode(block)
        let expected = try JSONDecoder().decode(JSONValue.self, from: original)
        let actual = try JSONDecoder().decode(JSONValue.self, from: encoded)
        XCTAssertEqual(actual, expected)
    }

    func testResourceAcceptsUnknownKindAndNullProperties() throws {
        let source = #"{"id":"p1","title":"","icon":null,"cover":null,"parentId":null,"sortKey":0,"ownerId":null,"kind":"futureKind","templateCategory":null,"pinned":false,"pinOrder":null,"favorite":false,"archived":false,"deletedAt":null,"preview":"","createdAt":1,"updatedAt":2,"openedAt":null,"properties":null,"look":{}}"#
        let resource = try JSONDecoder().decode(ResourceSummary.self, from: Data(source.utf8))
        XCTAssertEqual(resource.kind, "futureKind")
        XCTAssertEqual(resource.properties, .null)
    }
}
