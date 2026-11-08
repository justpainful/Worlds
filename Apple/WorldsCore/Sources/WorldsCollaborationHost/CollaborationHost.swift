import Foundation
import WorldsCollaboration
import WorldsIdentityContinuity

public enum CollaborationHostError: Error { case identityMismatch, accessDenied }

protocol CollaborationIdentity: Sendable {
    func currentWorkspacePageLevel(workspaceID: String, pageID: String, expectedUserID: String) async throws -> IdentityPageLevel
    func accessToken(expectedUserID: String, forceRefresh: Bool) async throws -> String
}
extension IdentitySessionCoordinator: CollaborationIdentity {}

/// Experimental composition for a single already-authorized shared page.
/// The owner must establish database and endpoint provenance independently.
public enum CollaborationHost {
    public static func makeSession(pageID: String, workspaceID: String, expectedUserID: String,
                                   serverURL: URL, store: SQLiteCollaborationStore,
                                   identity: IdentitySessionCoordinator) async throws -> CollaborationSession {
        try await makeSession(pageID: pageID, workspaceID: workspaceID, expectedUserID: expectedUserID,
                              serverURL: serverURL, store: store, checkedIdentity: identity)
    }
    static func makeSession(pageID: String, workspaceID: String, expectedUserID: String,
                            serverURL: URL, store: SQLiteCollaborationStore,
                            checkedIdentity identity: any CollaborationIdentity) async throws -> CollaborationSession {
        guard await store.matchesIdentity(pageID: pageID, userID: expectedUserID, workspaceID: workspaceID) else {
            throw CollaborationHostError.identityMismatch
        }
        let level = try await identity.currentWorkspacePageLevel(workspaceID: workspaceID, pageID: pageID, expectedUserID: expectedUserID)
        guard level != .none else { throw CollaborationHostError.accessDenied }
        // Worlds' application session routes the local page to the same document
        // identifier in its workspace. Never accept an independent document ID.
        return try CollaborationSession(pageID: pageID, workspaceID: workspaceID, documentID: pageID,
                                        expectedUserID: expectedUserID, serverURL: serverURL, store: store,
                                        tokenProvider: { force in
                                            try await identity.accessToken(expectedUserID: expectedUserID, forceRefresh: force)
                                        })
    }
}
