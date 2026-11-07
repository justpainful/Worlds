import Foundation
import XCTest
import WorldsIdentity
import WorldsIdentityContinuity
@testable import WorldsAccountViews

private actor AccountFixture: AccountSession {
    enum Mode: Equatable { case profileUnavailable, cancelled, keychainFailure }
    let mode: Mode
    init(_ mode: Mode) { self.mode = mode }
    func accountHasSession() async throws -> Bool { mode == .keychainFailure }
    func beginEmail(_ email: String) async throws -> EmailChallenge {
        if mode == .cancelled { throw CancellationError() }
        return try JSONDecoder().decode(EmailChallenge.self, from: Data(#"{"challengeId":"fixture","expiresAt":9999999999999}"#.utf8))
    }
    func verifyCode(challengeID: String, code: String, deviceName: String, platform: String) async throws { }
    func fetchAccount() async throws -> IdentityAccountSnapshot { throw URLError(.notConnectedToInternet) }
    func logout() async throws -> IdentitySignOutResult {
        if mode == .keychainFailure { throw IdentityError.keychain(-1) }
        return .localOnly
    }
}

@MainActor
final class AccountModelTests: XCTestCase {
    func testSuccessfulSignInKeepsSessionWhenProfileUnavailable() async throws {
        let model = AccountModel(coordinator: AccountFixture(.profileUnavailable), deviceName: "Fixture", platform: "macos")
        await model.startEmail("fixture@example.test")
        let challenge = try XCTUnwrap(model.challenge)
        await model.verify(challenge: challenge, code: "123456")
        XCTAssertTrue(model.hasSession)
        XCTAssertNil(model.challenge)
        XCTAssertNil(model.snapshot)
        XCTAssertNotNil(model.notice)
        await model.signOut()
        XCTAssertFalse(model.hasSession)
        XCTAssertTrue(model.notice?.contains("could not be confirmed") == true)
    }
    func testCancelledRequestDoesNotCreateChallenge() async {
        let model = AccountModel(coordinator: AccountFixture(.cancelled), deviceName: "Fixture", platform: "macos")
        await model.startEmail("fixture@example.test")
        XCTAssertNil(model.challenge)
        XCTAssertFalse(model.hasSession)
        XCTAssertFalse(model.busy)
    }
    func testKeychainDeletionFailureDoesNotClaimSignOut() async {
        let model = AccountModel(coordinator: AccountFixture(.keychainFailure), deviceName: "Fixture", platform: "macos")
        await model.restore()
        XCTAssertTrue(model.hasSession)
        await model.signOut()
        XCTAssertTrue(model.hasSession)
        XCTAssertNotNil(model.error)
    }
}
