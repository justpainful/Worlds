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
    private let account: String
    private let workspace: String
    fileprivate init(_ url: URL, accountID: String, workspaceID: String) throws {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "https", let host = parts.host?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.percentEncodedPath.isEmpty || parts.percentEncodedPath == "/",
              (parts.port ?? 443) > 0, (parts.port ?? 443) <= 65535,
              !accountID.isEmpty, !workspaceID.isEmpty,
              !accountID.utf8.contains(0), !workspaceID.utf8.contains(0) else { throw CollaborationHostError.untrustedEndpoint }
        self.host = host; self.port = parts.port ?? 443; self.account = accountID; self.workspace = workspaceID
    }
    func accepts(_ url: URL, accountID: String, workspaceID: String) -> Bool {
        guard let other = try? TrustedSyncOrigin(url, accountID: accountID, workspaceID: workspaceID) else { return false }
        return host == other.host && port == other.port && account == accountID && workspace == workspaceID
    }
}

/// Proposal is data for a consent screen, not proof of server identity. A
/// confirmed value is kept in memory and applies only to this account and workspace.
public struct SyncEndpointProposal: Sendable {
    public let origin: URL
    public let accountID: String
    public let workspaceID: String
    public init(origin: URL, accountID: String, workspaceID: String) throws {
        _ = try TrustedSyncOrigin(origin, accountID: accountID, workspaceID: workspaceID)
        self.origin = origin; self.accountID = accountID; self.workspaceID = workspaceID
    }
    public func approve() throws -> TrustedSyncOrigin {
        try TrustedSyncOrigin(origin, accountID: accountID, workspaceID: workspaceID)
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
        guard trustedOrigin.accepts(serverURL, accountID: expectedUserID, workspaceID: workspaceID) else { throw CollaborationHostError.untrustedEndpoint }
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
