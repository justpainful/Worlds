import Foundation
import WorldsCollaboration

/// Implementations must fetch current server-backed authority and return nil
/// on expiry, logout, failed refresh, or revocation. Never implement from cache alone.
public protocol ArchiveAuthority: Sendable {
    func currentPermission() async throws -> ArchivePermission?
}

public struct ArchivePermission: Sendable, Equatable {
    public let userID: String
    public let workspaceID: String
    public let pageID: String
    /// Changes whenever the login or authorization state changes.
    public let generation: String
    public init(userID: String, workspaceID: String, pageID: String, generation: String) {
        self.userID = userID; self.workspaceID = workspaceID; self.pageID = pageID; self.generation = generation
    }
}

public enum RejectedArchiveError: Error { case accessUnavailable, stalePermission, invalidSelection }

/// Read-only. Never restores or publishes a CRDT update.
public actor RejectedArchiveService {
    private let store: SQLiteCollaborationStore
    private let authority: any ArchiveAuthority
    private let expected: ArchivePermission
    public init(store: SQLiteCollaborationStore, authority: any ArchiveAuthority, expected: ArchivePermission) {
        self.store = store; self.authority = authority; self.expected = expected
    }
    private func verify() async throws {
        try Task.checkCancellation()
        guard !expected.userID.isEmpty, !expected.workspaceID.isEmpty, !expected.pageID.isEmpty, !expected.generation.isEmpty,
              let current = try await authority.currentPermission() else { throw RejectedArchiveError.accessUnavailable }
        guard current == expected, await store.matchesIdentity(pageID: current.pageID, userID: current.userID, workspaceID: current.workspaceID) else { throw RejectedArchiveError.stalePermission }
        try Task.checkCancellation()
    }
    public func list(before: RejectedArchiveCursor? = nil) async throws -> RejectedArchivePage {
        try await verify()
        let result = try await store.rejectedArchives(before: before)
        try await verify()
        return result
    }
    /// Called again at copy time, so the action never uses a previously cached snapshot.
    public func snapshot(id: String) async throws -> Data {
        guard !id.isEmpty else { throw RejectedArchiveError.invalidSelection }
        try await verify()
        let result = try await store.readRejectedSnapshot(id: id)
        try await verify()
        return result
    }
}
