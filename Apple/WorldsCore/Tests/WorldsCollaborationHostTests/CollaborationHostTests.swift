import XCTest
import WorldsCollaboration
import WorldsIdentityContinuity
@testable import WorldsCollaborationHost

private actor IdentityFixture: CollaborationIdentity {
    let level: IdentityPageLevel
    var calls = 0
    init(_ level: IdentityPageLevel) { self.level = level }
    func currentWorkspacePageLevel(workspaceID: String, pageID: String, expectedUserID: String) async throws -> IdentityPageLevel {
        calls += 1
        guard workspaceID == "fixture-workspace", pageID == "fixture-page", expectedUserID == "editor" else { throw CollaborationHostError.identityMismatch }
        return level
    }
    func accessToken(expectedUserID: String, forceRefresh: Bool) async throws -> String {
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
        do {
            _ = try await CollaborationHost.makeSession(pageID: "other-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, store: store, checkedIdentity: permitted)
            XCTFail("A different page must not use this store")
        } catch CollaborationHostError.identityMismatch { }
        let calls = await permitted.calls; XCTAssertEqual(calls, 0)
        let denied = IdentityFixture(.none)
        do {
            _ = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, store: store, checkedIdentity: denied)
            XCTFail("A revoked page must not start")
        } catch CollaborationHostError.accessDenied { }
        _ = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, store: store, checkedIdentity: permitted)
    }
}
