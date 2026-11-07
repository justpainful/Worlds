import XCTest
@testable import WorldsAccountViews

final class AccountServiceConfigurationTests: XCTestCase {
    func testExplicitAddressOverridesBuildDefault() throws {
        let url = try AccountServiceConfiguration.resolve(userValue: " https://identity.example.test/base ", buildValue: "https://other.example.test")
        XCTAssertEqual(url.absoluteString, "https://identity.example.test/base")
    }
    func testMissingAndUnsafeAddressesAreRejected() throws {
        XCTAssertThrowsError(try AccountServiceConfiguration.resolve(userValue: nil, buildValue: "$(WORLDS_IDENTITY_URL)"))
        for address in ["http://remote.example.test", "https://user:pass@example.test", "https://example.test/path?token=secret", "https://example.test/%2e%2e/private"] {
            XCTAssertThrowsError(try AccountServiceConfiguration.resolve(userValue: address, buildValue: nil))
        }
        XCTAssertThrowsError(try AccountServiceConfiguration.resolve(userValue: "http://127.0.0.1:8787", buildValue: nil))
        XCTAssertEqual(try AccountServiceConfiguration.resolve(userValue: "http://127.0.0.1:8787", buildValue: nil, allowInsecureLoopback: true).host, "127.0.0.1")
    }
}
