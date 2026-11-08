import Foundation
import WorldsCollaboration
import WorldsIdentityContinuity

public enum CollaborationHostError: Error { case identityMismatch, accessDenied, untrustedEndpoint }

/// An independently provisioned exact HTTPS origin. The caller is responsible
/// for obtaining it from trusted configuration, not from a Worlds document or
/// its mutable sync.serverUrl setting.
public struct TrustedSyncOrigin: Sendable {
    private let host: String
    private let port: Int
    public init(_ url: URL) throws {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "https", let host = parts.host?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.percentEncodedPath.isEmpty || parts.percentEncodedPath == "/",
              (parts.port ?? 443) > 0, (parts.port ?? 443) <= 65535 else { throw CollaborationHostError.untrustedEndpoint }
        self.host = host; self.port = parts.port ?? 443
    }
    func accepts(_ url: URL) -> Bool {
        guard let other = try? TrustedSyncOrigin(url) else { return false }
        return host == other.host && port == other.port
    }
}

protocol CollaborationIdentity: Sendable {
    func currentWorkspacePageLevel(workspaceID: String, pageID: String, expectedUserID: String) async throws -> IdentityPageLevel
    func accessToken(expectedUserID: String, forceRefresh: Bool) async throws -> String
}
extension IdentitySessionCoordinator: CollaborationIdentity {}

/// Experimental composition for a single already-authorized shared page.
/// The owner must establish database and endpoint provenance independently.
/// A local backup is an independent copy and is not a permitted sync source.
/// The supplied URL receives a bearer token; its trust is not established by
/// the account permission response or by the original sync.serverUrl setting.
public enum CollaborationHost {
    public static func makeSession(pageID: String, workspaceID: String, expectedUserID: String,
                                   serverURL: URL, trustedOrigin: TrustedSyncOrigin, store: SQLiteCollaborationStore,
                                   identity: IdentitySessionCoordinator) async throws -> CollaborationSession {
        try await makeSession(pageID: pageID, workspaceID: workspaceID, expectedUserID: expectedUserID,
                              serverURL: serverURL, trustedOrigin: trustedOrigin, store: store, checkedIdentity: identity)
    }
    static func makeSession(pageID: String, workspaceID: String, expectedUserID: String,
                            serverURL: URL, trustedOrigin: TrustedSyncOrigin, store: SQLiteCollaborationStore,
                            checkedIdentity identity: any CollaborationIdentity) async throws -> CollaborationSession {
        guard trustedOrigin.accepts(serverURL) else { throw CollaborationHostError.untrustedEndpoint }
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
