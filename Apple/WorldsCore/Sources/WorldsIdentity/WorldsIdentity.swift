import Foundation
import CryptoKit
import Security

public enum IdentityError: Error, Equatable {
    case invalidServerURL
    case invalidPath
    case invalidResponse
    case signedOut
    case busy
    case keychain(OSStatus)
    case http(status: Int, code: String, message: String)
}

public enum IdentityCrypto {
    public static func base64URL(_ bytes: Data) -> String {
        bytes.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    public static func decodeBase64URL(_ value: String) -> Data? {
        guard value.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }) else { return nil }
        var encoded = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        return Data(base64Encoded: encoded)
    }
    public static func pkceChallenge(verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    public static func refreshMessage(deviceID: String, timestamp: Int64, token: String) -> String {
        let digest = SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()
        return "worlds-refresh.v1:\(deviceID):\(timestamp):\(digest)"
    }

    public static func randomToken() -> String {
        // CryptoKit generates this private key using the platform CSPRNG.
        base64URL(Curve25519.Signing.PrivateKey().rawRepresentation)
    }
}

public struct PKCE: Sendable {
    public let verifier: String
    public let challenge: String
    public let state: String
    public init() {
        verifier = IdentityCrypto.randomToken()
        challenge = IdentityCrypto.pkceChallenge(verifier: verifier)
        state = IdentityCrypto.randomToken()
    }
}

public struct TokenSet: Decodable, Sendable {
    public let accessToken: String
    public let accessTokenExpiresAt: Int64
    public let refreshToken: String
    public let refreshTokenExpiresAt: Int64
    public let userId: String
    public let deviceId: String
}

public struct EmailChallenge: Decodable, Sendable {
    public let challengeId: String
    public let expiresAt: Int64
}

public struct DeviceDescription: Encodable, Sendable {
    public let name: String
    public let platform: String
    public let publicKey: String
}

public protocol IdentitySecretStore: Sendable {
    func load() throws -> Data?
    func save(_ data: Data) throws
    func delete() throws
}

/// Stores one session bundle as a single Keychain item, scoped to this device.
public struct KeychainIdentityStore: IdentitySecretStore {
    private let service: String
    private let account: String
    public init(service: String = "Worlds.Identity", account: String = "session") {
        self.service = service
        self.account = account
    }
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: account]
    }
    public func load() throws -> Data? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw IdentityError.keychain(status) }
        guard let data = item as? Data else { throw IdentityError.invalidResponse }
        return data
    }
    public func save(_ data: Data) throws {
        let attributes: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw IdentityError.keychain(status) }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let result = SecItemAdd(item as CFDictionary, nil)
        guard result == errSecSuccess else { throw IdentityError.keychain(result) }
    }
    public func delete() throws {
        let result = SecItemDelete(query as CFDictionary)
        guard result == errSecSuccess || result == errSecItemNotFound else { throw IdentityError.keychain(result) }
    }
}

public protocol IdentityTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

private final class RejectIdentityRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

public struct URLSessionIdentityTransport: IdentityTransport {
    private let session: URLSession
    public init() {
        session = URLSession(configuration: .ephemeral, delegate: RejectIdentityRedirects(), delegateQueue: nil)
    }
    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw IdentityError.invalidResponse }
        return (data, http)
    }
}

private struct SavedSession: Codable, Sendable {
    let userID: String
    let deviceID: String
    let refreshToken: String
    let signingKey: Data
    var refreshInFlight: Bool? = nil
}

private struct ServiceError: Decodable { let error: String?; let message: String? }
private struct EmailStartBody: Encodable { let email: String }
private struct EmailVerifyBody: Encodable {
    let challengeId: String; let code: String; let displayName: String?; let device: DeviceDescription
}
private struct ExchangeBody: Encodable { let code: String; let codeVerifier: String; let device: DeviceDescription }
private struct RefreshBody: Encodable { let refreshToken: String; let deviceId: String; let ts: Int64; let signature: String }

/// The actor serializes token rotation within one process and shares in-flight refreshes.
public actor WorldsIdentityClient {
    private let baseURL: URL
    private let secrets: any IdentitySecretStore
    private let transport: any IdentityTransport
    private var access: (token: String, expires: Int64)?
    private var refreshTask: Task<TokenSet, Error>?
    private var operationInProgress = false

    public init(baseURL: URL, secrets: any IdentitySecretStore = KeychainIdentityStore(),
                transport: any IdentityTransport = URLSessionIdentityTransport()) throws {
        let scheme = baseURL.scheme?.lowercased()
        let host = baseURL.host?.lowercased()
        let loopback = host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
        guard host != nil, baseURL.user == nil, baseURL.password == nil,
              baseURL.query == nil, baseURL.fragment == nil,
              scheme == "https" || (scheme == "http" && loopback) else { throw IdentityError.invalidServerURL }
        self.baseURL = baseURL
        self.secrets = secrets
        self.transport = transport
    }

    /// Reject paths that a proxy or server could normalize outside the service base.
    private static func safePath(_ value: String) -> Bool {
        guard let decoded = value.removingPercentEncoding,
              !decoded.contains("\\"), !decoded.utf8.contains(0), !decoded.contains("%"),
              !decoded.contains("//"), !decoded.split(separator: "/", omittingEmptySubsequences: false).contains("."),
              !decoded.split(separator: "/", omittingEmptySubsequences: false).contains("..") else { return false }
        let lower = value.lowercased()
        return !lower.contains("%2f") && !lower.contains("%5c")
    }

    private static func request(base: URL, path: String, method: String, body: Data?, token: String? = nil,
                                actor: String? = nil) throws -> URLRequest {
        let pathOnly = String(path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0])
        guard path.hasPrefix("/"), !path.hasPrefix("//"), !path.contains("#"), !path.contains("\\"),
              Self.safePath(pathOnly), Self.safePath(base.path) else { throw IdentityError.invalidPath }
        guard let url = URL(string: base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path),
              url.host == base.host, url.scheme == base.scheme else { throw IdentityError.invalidPath }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.httpBody = body
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let actor { request.setValue(actor, forHTTPHeaderField: "X-Worlds-Actor") }
        return request
    }

    private static func send(_ request: URLRequest, transport: any IdentityTransport) async throws -> Data {
        let (data, response) = try await transport.send(request)
        guard (200..<300).contains(response.statusCode) else {
            let detail = try? JSONDecoder().decode(ServiceError.self, from: data)
            throw IdentityError.http(status: response.statusCode, code: detail?.error ?? "http_error", message: detail?.message ?? "Request failed")
        }
        return data
    }

    private func post<T: Encodable, R: Decodable>(_ path: String, _ body: T, as: R.Type) async throws -> R {
        let request = try Self.request(base: baseURL, path: path, method: "POST", body: JSONEncoder().encode(body))
        return try JSONDecoder().decode(R.self, from: await Self.send(request, transport: transport))
    }

    public func startEmail(_ email: String) async throws -> EmailChallenge {
        try await post("/auth/email/start", EmailStartBody(email: email), as: EmailChallenge.self)
    }

    public func verifyEmail(challengeID: String, code: String, displayName: String? = nil,
                            deviceName: String, platform: String) async throws -> TokenSet {
        guard !operationInProgress, refreshTask == nil else { throw IdentityError.busy }
        operationInProgress = true
        defer { operationInProgress = false }
        let key = Curve25519.Signing.PrivateKey()
        let device = DeviceDescription(name: deviceName, platform: platform, publicKey: IdentityCrypto.base64URL(key.publicKey.rawRepresentation))
        let tokens: TokenSet = try await post("/auth/email/verify", EmailVerifyBody(challengeId: challengeID, code: code, displayName: displayName, device: device), as: TokenSet.self)
        try save(tokens, key: key.rawRepresentation)
        return tokens
    }

    /// Exchange only after the caller has validated the browser callback state.
    public func exchange(code: String, pkce: PKCE, callbackState: String, deviceName: String, platform: String) async throws -> TokenSet {
        guard callbackState == pkce.state else { throw IdentityError.invalidResponse }
        guard !operationInProgress, refreshTask == nil else { throw IdentityError.busy }
        operationInProgress = true
        defer { operationInProgress = false }
        let key = Curve25519.Signing.PrivateKey()
        let device = DeviceDescription(name: deviceName, platform: platform, publicKey: IdentityCrypto.base64URL(key.publicKey.rawRepresentation))
        let tokens: TokenSet = try await post("/auth/token", ExchangeBody(code: code, codeVerifier: pkce.verifier, device: device), as: TokenSet.self)
        try save(tokens, key: key.rawRepresentation)
        return tokens
    }

    /// Obtain a server challenge and constrain it to the caller's trusted RP ID.
    public func passkeyChallenge(expectedRelyingPartyID: String) async throws -> PasskeyChallenge {
        struct Empty: Encodable {}
        struct Envelope: Decodable { let challengeId: String; let options: Options }
        struct Options: Decodable { let challenge: String; let rpId: String; let userVerification: String? }
        let result: Envelope = try await post("/auth/passkey/login/options", Empty(), as: Envelope.self)
        guard result.options.rpId == expectedRelyingPartyID,
              let challenge = IdentityCrypto.decodeBase64URL(result.options.challenge),
              challenge.count >= 16, challenge.count <= 1024 else { throw IdentityError.invalidResponse }
        return PasskeyChallenge(challengeID: result.challengeId, relyingPartyID: result.options.rpId, challenge: challenge)
    }

    /// Complete an Apple assertion with the service's one-time PKCE handoff.
    public func completePasskey(challenge: PasskeyChallenge, assertion: PasskeyAssertion,
                                deviceName: String, platform: String) async throws -> TokenSet {
        struct Handoff: Encodable { let codeChallenge: String }
        struct Payload: Encodable {
            let challengeId: String; let response: PasskeyAssertion.WebAuthnResponse; let handoff: Handoff
        }
        struct Code: Decodable { let code: String }
        guard !operationInProgress, refreshTask == nil else { throw IdentityError.busy }
        operationInProgress = true
        defer { operationInProgress = false }
        let pkce = PKCE()
        let handoff: Code = try await post("/auth/passkey/login/verify",
            Payload(challengeId: challenge.challengeID, response: assertion.webAuthnResponse,
                    handoff: Handoff(codeChallenge: pkce.challenge)), as: Code.self)
        let key = Curve25519.Signing.PrivateKey()
        let device = DeviceDescription(name: deviceName, platform: platform, publicKey: IdentityCrypto.base64URL(key.publicKey.rawRepresentation))
        let tokens: TokenSet = try await post("/auth/token", ExchangeBody(code: handoff.code, codeVerifier: pkce.verifier, device: device), as: TokenSet.self)
        try save(tokens, key: key.rawRepresentation)
        return tokens
    }
    private func save(_ tokens: TokenSet, key: Data) throws {
        guard !tokens.accessToken.isEmpty, !tokens.refreshToken.isEmpty, !tokens.userId.isEmpty, !tokens.deviceId.isEmpty else { throw IdentityError.invalidResponse }
        let session = SavedSession(userID: tokens.userId, deviceID: tokens.deviceId, refreshToken: tokens.refreshToken, signingKey: key)
        try secrets.save(JSONEncoder().encode(session))
        access = (tokens.accessToken, tokens.accessTokenExpiresAt)
    }

    /// Identifies the durable session without exposing its token or device key.
    /// An interrupted token rotation requires sign-in again.
    public func currentUserID() throws -> String {
        guard !operationInProgress else { throw IdentityError.busy }
        guard let bytes = try secrets.load() else { throw IdentityError.signedOut }
        let saved = try JSONDecoder().decode(SavedSession.self, from: bytes)
        // A marker with no live rotation is an interrupted, unsafe session.
        // During this actor's active refresh, however, the account remains
        // pinned and other requests may safely join the same refresh task.
        guard (saved.refreshInFlight != true || refreshTask != nil), !saved.userID.isEmpty else { throw IdentityError.signedOut }
        return saved.userID
    }

    public func accessToken(forceRefresh: Bool = false) async throws -> String {
        guard !operationInProgress else { throw IdentityError.busy }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        if !forceRefresh, let access, access.expires - now > 60_000 { return access.token }
        if let task = refreshTask {
            let tokens = try await task.value
            access = (tokens.accessToken, tokens.accessTokenExpiresAt)
            return tokens.accessToken
        }
        guard let bytes = try secrets.load() else { throw IdentityError.signedOut }
        let saved = try JSONDecoder().decode(SavedSession.self, from: bytes)
        guard saved.refreshInFlight != true else { throw IdentityError.signedOut }
        let key = try Curve25519.Signing.PrivateKey(rawRepresentation: saved.signingKey)
        let message = IdentityCrypto.refreshMessage(deviceID: saved.deviceID, timestamp: now, token: saved.refreshToken)
        let signature = try key.signature(for: Data(message.utf8))
        let body = RefreshBody(refreshToken: saved.refreshToken, deviceId: saved.deviceID, ts: now, signature: IdentityCrypto.base64URL(signature))
        let request = try Self.request(base: baseURL, path: "/auth/refresh", method: "POST", body: JSONEncoder().encode(body))
        // Mark the token consumed before sending: an interrupted rotation must not be replayed.
        var pending = saved
        pending.refreshInFlight = true
        try secrets.save(JSONEncoder().encode(pending))
        let transport = self.transport
        let secrets = self.secrets
        let task = Task { () throws -> TokenSet in
            let data = try await Self.send(request, transport: transport)
            let tokens = try JSONDecoder().decode(TokenSet.self, from: data)
            guard tokens.deviceId == saved.deviceID, tokens.userId == saved.userID,
                  !tokens.accessToken.isEmpty, !tokens.refreshToken.isEmpty else { throw IdentityError.invalidResponse }
            let next = SavedSession(userID: tokens.userId, deviceID: tokens.deviceId,
                                    refreshToken: tokens.refreshToken, signingKey: saved.signingKey)
            try secrets.save(JSONEncoder().encode(next))
            return tokens
        }
        refreshTask = task
        do {
            let tokens = try await task.value
            access = (tokens.accessToken, tokens.accessTokenExpiresAt)
            refreshTask = nil
            return tokens.accessToken
        } catch {
            refreshTask = nil
            access = nil
            if case IdentityError.http(status: 401, code: _, message: _) = error {
                access = nil
                try? secrets.delete()
                throw IdentityError.signedOut
            }
            throw error
        }
    }

    /// Generic identity endpoint request. Caller supplies an encoded JSON body if needed.
    public func authenticatedRequest(path: String, method: String = "GET", body: Data? = nil, actor: String? = nil) async throws -> Data {
        let token = try await accessToken()
        let request = try Self.request(base: baseURL, path: path, method: method, body: body, token: token, actor: actor)
        do { return try await Self.send(request, transport: transport) }
        catch IdentityError.http(status: 401, code: _, message: _) {
            // Reuse a token already refreshed by another request, avoiding rotation reuse.
            let newer = access?.token
            let next = newer != nil && newer != token ? newer! : try await accessToken(forceRefresh: true)
            return try await Self.send(Self.request(base: baseURL, path: path, method: method, body: body, token: next, actor: actor), transport: transport)
        }
    }

    public func signOut() async throws {
        guard !operationInProgress, refreshTask == nil else { throw IdentityError.busy }
        let token = try await accessToken()
        guard !operationInProgress, refreshTask == nil else { throw IdentityError.busy }
        operationInProgress = true
        defer { operationInProgress = false }
        let request = try Self.request(base: baseURL, path: "/auth/logout", method: "POST", body: nil, token: token)
        _ = try await Self.send(request, transport: transport)
        try secrets.delete()
        access = nil
    }
}




