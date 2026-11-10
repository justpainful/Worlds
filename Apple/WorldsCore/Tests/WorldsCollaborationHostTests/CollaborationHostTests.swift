import XCTest
import WorldsCollaboration
import WorldsIdentityContinuity
@testable import WorldsCollaborationHost

private actor IdentityFixture: CollaborationIdentity {
    let level: IdentityPageLevel
    var calls = 0
    var tokenCalls = 0
    init(_ level: IdentityPageLevel) { self.level = level }
    func currentWorkspacePageLevel(workspaceID: String, pageID: String, expectedUserID: String) async throws -> IdentityPageLevel {
        calls += 1
        guard workspaceID == "fixture-workspace", pageID == "fixture-page", expectedUserID == "editor" else { throw CollaborationHostError.identityMismatch }
        return level
    }
    func accessToken(expectedUserID: String, forceRefresh: Bool) async throws -> String {
        tokenCalls += 1
        guard expectedUserID == "editor" else { throw CollaborationHostError.identityMismatch }
        return "fixture-token"
    }
}

final class CollaborationHostTests: XCTestCase {
    func testHostRejectsMismatchedStoreAndRevokedServiceAccess() async throws {
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("collab-host-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: fixture, to: copy)
        defer { try? FileManager.default.removeItem(at: copy) }
        let store = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let permitted = IdentityFixture(.edit)
        let trusted = try SyncEndpointProposal(origin: URL(string: "https://example.invalid")!, accountID: "editor", workspaceID: "fixture-workspace").approve()
        do {
            _ = try await CollaborationHost.makeSession(pageID: "other-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, trustedOrigin: trusted, store: store, checkedIdentity: permitted)
            XCTFail("A different page must not use this store")
        } catch CollaborationHostError.identityMismatch { }
        let calls = await permitted.calls; XCTAssertEqual(calls, 0)
        let denied = IdentityFixture(.none)
        do {
            _ = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, trustedOrigin: trusted, store: store, checkedIdentity: denied)
            XCTFail("A revoked page must not start")
        } catch CollaborationHostError.accessDenied { }
        do {
            _ = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, trustedOrigin: trusted, store: store, checkedIdentity: permitted)
            XCTFail("Legacy document and outbox ownership must not be assumed")
        } catch CollaborationHostError.unverifiedDocumentOwnership { }
        let tokenCalls = await permitted.tokenCalls
        XCTAssertEqual(tokenCalls, 0)
    }

    func testHostRejectsUntrustedOriginBeforeIdentityCalls() async throws {
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("collab-origin-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: fixture, to: copy)
        defer { try? FileManager.default.removeItem(at: copy) }
        let store = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let identity = IdentityFixture(.edit)
        let trusted = try SyncEndpointProposal(origin: URL(string: "https://example.invalid")!, accountID: "editor", workspaceID: "fixture-workspace").approve()
        for raw in ["https://evil.invalid", "https://example.invalid.evil.invalid", "https://example.invalid:444", "http://example.invalid", "https://example.invalid/path", "https://user@example.invalid", "https://example.invalid/?x=1"] {
            let candidate = try XCTUnwrap(URL(string: raw))
            do {
                _ = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: candidate, trustedOrigin: trusted, store: store, checkedIdentity: identity)
                XCTFail("Untrusted endpoint was accepted")
            } catch CollaborationHostError.untrustedEndpoint { }
        }
        let calls = await identity.calls
        XCTAssertEqual(calls, 0)
        let tokenCalls = await identity.tokenCalls
        XCTAssertEqual(tokenCalls, 0)
        XCTAssertTrue(trusted.accepts(URL(string: "https://EXAMPLE.invalid:443/")!, accountID: "editor", workspaceID: "fixture-workspace"))
        XCTAssertFalse(trusted.accepts(URL(string: "https://example.invalid")!, accountID: "other", workspaceID: "fixture-workspace"))
        XCTAssertFalse(trusted.accepts(URL(string: "https://example.invalid")!, accountID: "editor", workspaceID: "other"))
        do {
            _ = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "other", serverURL: URL(string: "https://example.invalid")!, trustedOrigin: trusted, store: store, checkedIdentity: identity)
            XCTFail("Approval must not follow another account")
        } catch CollaborationHostError.untrustedEndpoint { }
        let callsAfterAccountChange = await identity.calls
        XCTAssertEqual(callsAfterAccountChange, 0)
    }
}
