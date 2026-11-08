import Foundation
import XCTest
import WorldsCollaboration
@testable import WorldsRejectedArchives

private actor FixtureAuthority: ArchiveAuthority {
    var permission: ArchivePermission?
    var calls = 0
    var revokeOnCall: Int?
    init(_ permission: ArchivePermission) { self.permission = permission }
    func revoke() { permission = nil }
    func revokeAt(_ count: Int) { calls = 0; revokeOnCall = count }
    func currentPermission() async throws -> ArchivePermission? {
        calls += 1
        if calls == revokeOnCall { permission = nil }
        return permission
    }
}

final class RejectedArchivesTests: XCTestCase {
    func testRealSQLiteArchiveRefusesRevocationAndDoesNotRequeue() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-v11", withExtension: "db"))
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent("archives-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: destination)
        defer { try? FileManager.default.removeItem(at: destination) }
        let store = try SQLiteCollaborationStore(databaseURL: destination, pageID: "fixture-page", userID: "fixture-user", workspaceID: "fixture-workspace")
        try await store.appendLocal(pageID: "fixture-page", channel: 0, update: Data([0, 0]))
        try await store.archiveRejection(pageID: "fixture-page", channel: 0, state: Data([0, 0]), reason: "denied")
        let permission = ArchivePermission(userID: "fixture-user", workspaceID: "fixture-workspace", pageID: "fixture-page", generation: "fixture")
        let authority = FixtureAuthority(permission)
        let service = RejectedArchiveService(store: store, authority: authority, expected: permission)
        let page = try await service.list()
        let item = try XCTUnwrap(page.items.first)
        let snapshot = try await service.snapshot(id: item.id)
        XCTAssertEqual(snapshot, Data([0, 0]))
        let pending = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
        XCTAssertNil(pending)
        await authority.revokeAt(2)
        do { _ = try await service.snapshot(id: item.id); XCTFail("Revocation during read must prevent returning data") }
        catch RejectedArchiveError.accessUnavailable { } catch { XCTFail("Unexpected error: \(error)") }
        do { _ = try await service.list(); XCTFail("Revoked access must not return metadata") }
        catch RejectedArchiveError.accessUnavailable { } catch { XCTFail("Unexpected error: \(error)") }
    }
    func testServiceRejectsPermissionForAnotherAccount() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-v11", withExtension: "db"))
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent("archives-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: destination)
        defer { try? FileManager.default.removeItem(at: destination) }
        let store = try SQLiteCollaborationStore(databaseURL: destination, pageID: "fixture-page", userID: "fixture-user", workspaceID: "fixture-workspace")
        let wrong = ArchivePermission(userID: "other", workspaceID: "fixture-workspace", pageID: "fixture-page", generation: "fixture")
        let service = RejectedArchiveService(store: store, authority: FixtureAuthority(wrong), expected: wrong)
        do { _ = try await service.list(); XCTFail("A permission for another account must fail") }
        catch RejectedArchiveError.stalePermission { } catch { XCTFail("Unexpected error: \(error)") }
    }
}
