import Foundation
import CryptoKit
import Darwin
import WorldsIdentity

public enum IdentityContinuityError: Error, Equatable {
    case invalidServer, invalidDirectory, lockUnavailable, busy, signedOut, accountMismatch, system(Int32)
}

/// Stable scope includes scheme, host, effective port, and the service base path.
public enum IdentityScope {
    public static func key(for url: URL) throws -> String {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = parts.scheme?.lowercased(), let host = parts.host?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil else { throw IdentityContinuityError.invalidServer }
        let local = ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host)
        guard scheme == "https" || (scheme == "http" && local), !parts.percentEncodedPath.contains("%"),
              !parts.path.contains("//"), !parts.path.split(separator: "/").contains(".."),
              !parts.path.split(separator: "/").contains(".") else { throw IdentityContinuityError.invalidServer }
        parts.scheme = scheme; parts.host = host
        if (scheme == "https" && parts.port == 443) || (scheme == "http" && parts.port == 80) { parts.port = nil }
        let path = parts.percentEncodedPath
        parts.percentEncodedPath = path == "/" ? "" : String(path.reversed().drop(while: { $0 == "/" }).reversed())
        guard let canonical = parts.string else { throw IdentityContinuityError.invalidServer }
        return SHA256.hash(data: Data(canonical.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// A lock file contains no credentials. All users of a Keychain scope must use
/// the same private directory; this is a cooperative lock, not a security boundary.
public final class IdentitySessionLease: @unchecked Sendable {
    private let descriptor: Int32
    public init(directory: URL, scope: String) throws {
        guard directory.isFileURL, scope.utf8.count == 64, scope.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              !directory.path.utf8.contains(0) else { throw IdentityContinuityError.invalidDirectory }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        let original = directory.standardizedFileURL
        var originalInfo = stat()
        guard lstat(original.path, &originalInfo) == 0,
              (originalInfo.st_mode & mode_t(S_IFMT)) == mode_t(S_IFDIR) else { throw IdentityContinuityError.invalidDirectory }
        // Resolve system parent aliases such as /var to /private/var before opening.
        let canonical = original.resolvingSymlinksInPath().standardizedFileURL
        var info = stat()
        guard lstat(canonical.path, &info) == 0, (info.st_mode & mode_t(S_IFMT)) == mode_t(S_IFDIR),
              info.st_uid == getuid(), info.st_mode & 0o077 == 0 else { throw IdentityContinuityError.invalidDirectory }
        let path = canonical.appendingPathComponent("identity-\(scope).lock").path
        let fd = Darwin.open(path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw IdentityContinuityError.system(errno) }
        var fileInfo = stat()
        guard fstat(fd, &fileInfo) == 0, (fileInfo.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
              fileInfo.st_uid == getuid(), fileInfo.st_mode & 0o077 == 0, fileInfo.st_nlink == 1 else {
            Darwin.close(fd); throw IdentityContinuityError.invalidDirectory
        }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            let code = errno; Darwin.close(fd)
            if code == EWOULDBLOCK || code == EAGAIN { throw IdentityContinuityError.lockUnavailable }
            throw IdentityContinuityError.system(code)
        }
        descriptor = fd
    }
    deinit { _ = Darwin.close(descriptor) }
}

public struct IdentitySessionSummary: Sendable {
    public let userID: String
    public let deviceID: String
    public let accessExpiresAt: Int64
    fileprivate init(_ tokens: TokenSet) {
        userID = tokens.userId; deviceID = tokens.deviceId; accessExpiresAt = tokens.accessTokenExpiresAt
    }
}
public enum IdentitySignOutResult: Sendable { case revokedRemotely, localOnly }

/// Mirrors the authenticated identity service's GET /me response.
public struct IdentityAccountProfile: Decodable, Sendable {
    public let id: String
    public let email: String
    public let displayName: String
    public let username: String?
    public let usernameAuto: Bool
    public let avatarUrl: String?
    public let createdAt: Int64
}

/// Server-provided membership is display data, not a local authorization grant.
public struct IdentityWorkspace: Decodable, Sendable {
    public let id: String
    public let name: String
    public let ownerId: String
    public let defaultLevel: String
    public let createdAt: Int64
    public let memberCount: Int
    public let role: String
}

public struct IdentityAccountSnapshot: Sendable {
    public let profile: IdentityAccountProfile
    public let workspaces: [IdentityWorkspace]
}
/// The wrapped client is private, preventing accidental bypass by this owner.
/// The host must create one coordinator per scope and use the same lock directory
/// for every process that can access the corresponding Keychain item.
public actor IdentitySessionCoordinator {
    private let lease: IdentitySessionLease
    private let client: WorldsIdentityClient
    private let secrets: any IdentitySecretStore
    private var locallySignedOut = false
    private var changingSession = false
    private var activeRequests = 0
    public let scope: String

    public init(baseURL: URL, lockDirectory: URL,
                transport: any IdentityTransport = URLSessionIdentityTransport()) throws {
        let scope = try IdentityScope.key(for: baseURL)
        let lease = try IdentitySessionLease(directory: lockDirectory, scope: scope)
        let store = KeychainIdentityStore(service: "Worlds.Identity.\(scope)", account: "session")
        client = try WorldsIdentityClient(baseURL: baseURL, secrets: store, transport: transport)
        self.lease = lease; self.scope = scope; self.secrets = store
    }
    // Injected secret stores are internal to isolated tests and must not share scopes.
    init(baseURL: URL, lockDirectory: URL, transport: any IdentityTransport, secrets: any IdentitySecretStore) throws {
        let scope = try IdentityScope.key(for: baseURL)
        let lease = try IdentitySessionLease(directory: lockDirectory, scope: scope)
        client = try WorldsIdentityClient(baseURL: baseURL, secrets: secrets, transport: transport)
        self.lease = lease; self.scope = scope; self.secrets = secrets
    }
    public func startEmail(_ email: String) async throws -> EmailChallenge { try await client.startEmail(email) }
    public func verifyEmail(challengeID: String, code: String, displayName: String? = nil,
                            deviceName: String, platform: String) async throws -> IdentitySessionSummary {
        guard !changingSession, activeRequests == 0 else { throw IdentityContinuityError.busy }
        changingSession = true; defer { changingSession = false }
        let tokens = try await client.verifyEmail(challengeID: challengeID, code: code, displayName: displayName, deviceName: deviceName, platform: platform)
        locallySignedOut = false
        return IdentitySessionSummary(tokens)
    }
    public func accessToken(forceRefresh: Bool = false) async throws -> String {
        guard !locallySignedOut, !changingSession else { throw IdentityContinuityError.signedOut }
        activeRequests += 1; defer { activeRequests -= 1 }
        return try await client.accessToken(forceRefresh: forceRefresh)
    }
    /// Reports only whether a usable durable session is present, without network access.
    public func hasStoredSession() async throws -> Bool {
        guard !locallySignedOut, !changingSession else { return false }
        do { _ = try await client.currentUserID(); return true }
        catch IdentityError.signedOut { return false }
    }
    public func request(path: String, method: String = "GET", body: Data? = nil, actor: String? = nil) async throws -> Data {
        guard !locallySignedOut, !changingSession else { throw IdentityContinuityError.signedOut }
        activeRequests += 1; defer { activeRequests -= 1 }
        return try await client.authenticatedRequest(path: path, method: method, body: body, actor: actor)
    }
    /// Fetches real service data without persisting or treating it as an ACL.
    /// The two requests are separate and do not form a server-side snapshot.
    public func accountSnapshot() async throws -> IdentityAccountSnapshot {
        guard !locallySignedOut, !changingSession else { throw IdentityContinuityError.signedOut }
        activeRequests += 1; defer { activeRequests -= 1 }
        let expected = try await client.currentUserID()
        let profileData = try await client.authenticatedRequest(path: "/me")
        let profile = try JSONDecoder().decode(IdentityAccountProfile.self, from: profileData)
        guard !profile.id.isEmpty, profile.id == expected else { throw IdentityContinuityError.accountMismatch }
        let workspaceData = try await client.authenticatedRequest(path: "/workspaces")
        let workspaces = try JSONDecoder().decode([IdentityWorkspace].self, from: workspaceData)
        guard try await client.currentUserID() == expected else { throw IdentityContinuityError.accountMismatch }
        return IdentityAccountSnapshot(profile: profile, workspaces: workspaces)
    }
    /// Local credentials are erased even when remote revocation fails.
    /// `localOnly` means the server session may still exist until it expires.
    public func signOut() async throws -> IdentitySignOutResult {
        guard !changingSession, activeRequests == 0 else { throw IdentityContinuityError.busy }
        changingSession = true; locallySignedOut = true
        defer { changingSession = false }
        let result: IdentitySignOutResult
        do { try await client.signOut(); result = .revokedRemotely }
        catch { result = .localOnly }
        try secrets.delete()
        return result
    }
    public func passkeyChallenge(expectedRelyingPartyID: String) async throws -> PasskeyChallenge {
        try await client.passkeyChallenge(expectedRelyingPartyID: expectedRelyingPartyID)
    }
    public func completePasskey(challenge: PasskeyChallenge, assertion: PasskeyAssertion,
                                deviceName: String, platform: String) async throws -> IdentitySessionSummary {
        guard !changingSession, activeRequests == 0 else { throw IdentityContinuityError.busy }
        changingSession = true; defer { changingSession = false }
        let tokens = try await client.completePasskey(challenge: challenge, assertion: assertion, deviceName: deviceName, platform: platform)
        locallySignedOut = false
        return IdentitySessionSummary(tokens)
    }
}
