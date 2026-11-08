import Foundation
import XCTest
import WorldsIdentity
@testable import WorldsIdentityContinuity

private final class MemorySecrets: IdentitySecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?
    func load() throws -> Data? { lock.lock(); defer { lock.unlock() }; return data }
    func save(_ value: Data) throws { lock.lock(); defer { lock.unlock() }; data = value }
    func delete() throws { lock.lock(); defer { lock.unlock() }; data = nil }
}
private final class BlockingSecrets: IdentitySecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?
    private var shouldBlock = false
    let entered = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    func blockNextLoad() { lock.lock(); shouldBlock = true; lock.unlock() }
    func waitForEntry() async -> Bool {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                continuation.resume(returning: self.entered.wait(timeout: .now() + 2) == .success)
            }
        }
    }
    func load() throws -> Data? {
        lock.lock(); let block = shouldBlock; shouldBlock = false; let value = data; lock.unlock()
        if block { entered.signal(); release.wait() }
        return value
    }
    func save(_ value: Data) throws { lock.lock(); data = value; lock.unlock() }
    func delete() throws { lock.lock(); data = nil; lock.unlock() }
}
private actor IdentityFixtureTransport: IdentityTransport {
    enum Mode: Equatable { case success, interrupted, offlineLogout }
    let mode: Mode
    private(set) var refreshCount = 0
    init(mode: Mode) { self.mode = mode }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let path = request.url!.path
        if path == "/auth/refresh" {
            refreshCount += 1
            try await Task.sleep(for: .milliseconds(150))
            if mode == .interrupted { throw URLError(.networkConnectionLost) }
        }
        if path == "/auth/logout" && mode == .offlineLogout { throw URLError(.notConnectedToInternet) }
        let refresh = path == "/auth/refresh" ? "wr_rotated" : "wr_initial"
        let json = """
        {"accessToken":"access-\(refresh)","accessTokenExpiresAt":9999999999999,"refreshToken":"\(refresh)","refreshTokenExpiresAt":9999999999999,"userId":"user","deviceId":"device"}
        """
        return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}

private actor AccountFixtureTransport: IdentityTransport {
    let profileID: String
    init(profileID: String) { self.profileID = profileID }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let json: String
        switch request.url!.path {
        case "/auth/email/verify":
            json = #"{"accessToken":"fixture-access","accessTokenExpiresAt":9999999999999,"refreshToken":"fixture-refresh","refreshTokenExpiresAt":9999999999999,"userId":"user","deviceId":"device"}"#
        case "/me":
            guard request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture-access" else { throw URLError(.userAuthenticationRequired) }
            json = """
            {"id":"\(profileID)","email":"fixture@example.test","displayName":"Fixture","username":"fixture","usernameAuto":false,"avatarUrl":null,"createdAt":1}
            """
        case "/workspaces":
            guard request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture-access" else { throw URLError(.userAuthenticationRequired) }
            json = #"[{"id":"space","name":"Workspace","ownerId":"user","defaultLevel":"view","createdAt":1,"memberCount":1,"role":"owner"}]"#
        case "/me/passkeys":
            guard request.httpMethod == "GET", request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture-access" else { throw URLError(.userAuthenticationRequired) }
            json = #"[{"id":"dGVzdA","name":"Fixture","synced":true,"createdAt":1,"lastUsedAt":null}]"#
        case "/me/passkeys/dGVzdA":
            guard request.httpMethod == "DELETE", request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture-access" else { throw URLError(.userAuthenticationRequired) }
            json = #"{"ok":true}"#
        default: throw URLError(.badURL)
        }
        return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}

private actor PasskeyFixtureTransport: IdentityTransport {
    private(set) var verifyCount = 0
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let body: String
        switch request.url!.path {
        case "/auth/passkey/login/options":
            body = #"{"challengeId":"fixture-challenge","options":{"challenge":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE","rpId":"example.test"}}"#
        case "/auth/passkey/login/verify":
            verifyCount += 1; body = #"{"code":"fixture-handoff"}"#
        case "/auth/token":
            body = #"{"accessToken":"access","accessTokenExpiresAt":9999999999999,"refreshToken":"refresh","refreshTokenExpiresAt":9999999999999,"userId":"user","deviceId":"device"}"#
        default: throw URLError(.badURL)
        }
        return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
private actor DelayedPasskeyTransport: IdentityTransport {
    private(set) var started = false
    private var continuation: CheckedContinuation<Void, Never>?
    func release() { continuation?.resume(); continuation = nil }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard request.url?.path == "/auth/passkey/login/options" else { throw URLError(.badURL) }
        started = true
        await withCheckedContinuation { continuation = $0 }
        let body = #"{"challengeId":"fixture-challenge","options":{"challenge":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE","rpId":"example.test"}}"#
        return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}

final class IdentityContinuityTests: XCTestCase {
    func testPasskeyManagementUsesAuthenticatedEndpointsAndRejectsUnsafeID() async throws {
        let coordinator = try IdentitySessionCoordinator(baseURL: URL(string: "https://example.test")!, lockDirectory: directory(), transport: AccountFixtureTransport(profileID: "user"), secrets: MemorySecrets())
        _ = try await coordinator.verifyEmail(challengeID: "fixture", code: "123456", deviceName: "Fixture", platform: "macos")
        let items = try await coordinator.passkeys()
        XCTAssertEqual(items.count, 1); XCTAssertEqual(items.first?.id, "dGVzdA")
        try await coordinator.removePasskey(id: "dGVzdA")
        do { try await coordinator.removePasskey(id: "../devices"); XCTFail("Path-shaped IDs must be refused") }
        catch IdentityError.invalidPath { } catch { XCTFail("Unexpected error: \(error)") }
    }
    func testSignOutInvalidatesOutstandingPasskeyChallenge() async throws {
        let transport = PasskeyFixtureTransport(), secrets = MemorySecrets()
        let coordinator = try IdentitySessionCoordinator(baseURL: URL(string: "https://example.test")!, lockDirectory: directory(), transport: transport, secrets: secrets)
        let stale = try await coordinator.passkeyChallenge(expectedRelyingPartyID: "example.test")
        _ = try await coordinator.signOut()
        let assertion = PasskeyAssertion(credentialID: Data([1]), clientDataJSON: Data([2]), authenticatorData: Data([3]), signature: Data([4]), userID: nil)
        do { _ = try await coordinator.completePasskey(challenge: stale, assertion: assertion, deviceName: "Fixture", platform: "macos"); XCTFail("Sign out must invalidate an old ceremony") }
        catch IdentityContinuityError.signedOut { } catch { XCTFail("Unexpected error: \(error)") }
        let before = await transport.verifyCount; XCTAssertEqual(before, 0)
        let fresh = try await coordinator.passkeyChallenge(expectedRelyingPartyID: "example.test")
        _ = try await coordinator.completePasskey(challenge: fresh, assertion: assertion, deviceName: "Fixture", platform: "macos")
        let after = await transport.verifyCount; XCTAssertEqual(after, 1)
        do { _ = try await coordinator.completePasskey(challenge: fresh, assertion: assertion, deviceName: "Fixture", platform: "macos"); XCTFail("A challenge must not be replayed") }
        catch IdentityContinuityError.signedOut { } catch { XCTFail("Unexpected error: \(error)") }
    }
    func testSignOutRejectsPasskeyChallengeStillInFlight() async throws {
        let transport = DelayedPasskeyTransport()
        let coordinator = try IdentitySessionCoordinator(baseURL: URL(string: "https://example.test")!, lockDirectory: directory(), transport: transport, secrets: MemorySecrets())
        let pending = Task { try await coordinator.passkeyChallenge(expectedRelyingPartyID: "example.test") }
        for _ in 0..<100 {
            if await transport.started { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        let started = await transport.started
        guard started else { pending.cancel(); await transport.release(); return XCTFail("Fixture did not start") }
        _ = try await coordinator.signOut()
        await transport.release()
        do { _ = try await pending.value; XCTFail("A response issued before sign out must be rejected") }
        catch IdentityContinuityError.signedOut { } catch { XCTFail("Unexpected error: \(error)") }
    }
    private func directory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-identity-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }
    func testScopeSeparatesHostsAndCanonicalizesDefaultPort() throws {
        let a = try IdentityScope.key(for: URL(string: "https://example.test")!)
        let b = try IdentityScope.key(for: URL(string: "https://example.test:443/")!)
        let c = try IdentityScope.key(for: URL(string: "https://other.test")!)
        XCTAssertEqual(a,b); XCTAssertNotEqual(a,c)
        XCTAssertThrowsError(try IdentityScope.key(for: URL(string: "http://example.test")!))
        XCTAssertThrowsError(try IdentityScope.key(for: URL(string: "https://example.test/%2e%2e/x")!))
    }
    func testLeaseExcludesSecondOwnerAndReleases() throws {
        let dir = try directory()
        let scope = try IdentityScope.key(for: URL(string: "https://example.test")!)
        var owner: IdentitySessionLease? = try IdentitySessionLease(directory: dir, scope: scope)
        XCTAssertNotNil(owner)
        XCTAssertThrowsError(try IdentitySessionLease(directory: dir, scope: scope))
        owner = nil
        XCTAssertNoThrow(try IdentitySessionLease(directory: dir, scope: scope))
    }
    func testConcurrentRefreshUsesOneRotation() async throws {
        let dir = try directory(), secrets = MemorySecrets(), transport = IdentityFixtureTransport(mode: .success)
        let coordinator = try IdentitySessionCoordinator(baseURL: URL(string: "https://identity.test")!, lockDirectory: dir, transport: transport, secrets: secrets)
        _ = try await coordinator.verifyEmail(challengeID: "test", code: "000000", deviceName: "Test", platform: "macos")
        let values = try await withThrowingTaskGroup(of: String.self, returning: [String].self) { group in
            for _ in 0..<5 { group.addTask { try await coordinator.accessToken(forceRefresh: true) } }
            var values: [String] = []
            for try await value in group { values.append(value) }
            return values
        }
        XCTAssertEqual(Set(values), ["access-wr_rotated"])
        let count = await transport.refreshCount
        XCTAssertEqual(count, 1)
    }
    func testInterruptedRotationCannotBeReplayed() async throws {
        let dir = try directory(), secrets = MemorySecrets(), transport = IdentityFixtureTransport(mode: .interrupted)
        let coordinator = try IdentitySessionCoordinator(baseURL: URL(string: "https://identity.test")!, lockDirectory: dir, transport: transport, secrets: secrets)
        _ = try await coordinator.verifyEmail(challengeID: "test", code: "000000", deviceName: "Test", platform: "macos")
        do { _ = try await coordinator.accessToken(forceRefresh: true); XCTFail("The simulated connection must fail") } catch { }
        do { _ = try await coordinator.accessToken(forceRefresh: true); XCTFail("A consumed token must not be replayed") }
        catch IdentityError.signedOut { } catch { XCTFail("Unexpected error: \(error)") }
        let count = await transport.refreshCount
        XCTAssertEqual(count, 1)
    }
    func testOfflineSignOutDeletesLocalSession() async throws {
        let secrets = MemorySecrets(), transport = IdentityFixtureTransport(mode: .offlineLogout)
        let coordinator = try IdentitySessionCoordinator(baseURL: URL(string: "https://identity.test")!, lockDirectory: directory(), transport: transport, secrets: secrets)
        _ = try await coordinator.verifyEmail(challengeID: "test", code: "000000", deviceName: "Test", platform: "macos")
        let result = try await coordinator.signOut()
        guard case .localOnly = result else { return XCTFail("Remote revocation must be reported as unavailable") }
        XCTAssertNil(try secrets.load())
        do { _ = try await coordinator.accessToken(); XCTFail("Local sign out must block requests") }
        catch IdentityContinuityError.signedOut { } catch { XCTFail("Unexpected error: \(error)") }
    }
    func testSignOutWaitsForActiveRefresh() async throws {
        let secrets = MemorySecrets(), transport = IdentityFixtureTransport(mode: .success)
        let coordinator = try IdentitySessionCoordinator(baseURL: URL(string: "https://identity.test")!, lockDirectory: directory(), transport: transport, secrets: secrets)
        _ = try await coordinator.verifyEmail(challengeID: "test", code: "000000", deviceName: "Test", platform: "macos")
        let refresh = Task { try await coordinator.accessToken(forceRefresh: true) }
        while await transport.refreshCount == 0 { try await Task.sleep(for: .milliseconds(1)) }
        do { _ = try await coordinator.signOut(); XCTFail("Sign out must not race a refresh") }
        catch IdentityContinuityError.busy { } catch { XCTFail("Unexpected error: \(error)") }
        _ = try await refresh.value
        _ = try await coordinator.signOut()
        XCTAssertNil(try secrets.load())
    }

    func testAccountSnapshotUsesAuthenticatedServiceResponses() async throws {
        let coordinator = try IdentitySessionCoordinator(baseURL: URL(string: "https://identity.test")!, lockDirectory: directory(), transport: AccountFixtureTransport(profileID: "user"), secrets: MemorySecrets())
        _ = try await coordinator.verifyEmail(challengeID: "test", code: "000000", deviceName: "Test", platform: "macos")
        let account = try await coordinator.accountSnapshot()
        XCTAssertEqual(account.profile.id, "user")
        XCTAssertEqual(account.workspaces.map(\.id), ["space"])
    }
    func testAccountSnapshotRejectsDifferentUser() async throws {
        let coordinator = try IdentitySessionCoordinator(baseURL: URL(string: "https://identity.test")!, lockDirectory: directory(), transport: AccountFixtureTransport(profileID: "someone-else"), secrets: MemorySecrets())
        _ = try await coordinator.verifyEmail(challengeID: "test", code: "000000", deviceName: "Test", platform: "macos")
        do { _ = try await coordinator.accountSnapshot(); XCTFail("Mismatched account must be rejected") }
        catch IdentityContinuityError.accountMismatch { }
    }
    func testStoredSessionAvailabilityTracksLocalSignOut() async throws {
        let coordinator = try IdentitySessionCoordinator(baseURL: URL(string: "https://identity.test")!, lockDirectory: directory(), transport: IdentityFixtureTransport(mode: .offlineLogout), secrets: MemorySecrets())
        let initiallySignedIn = try await coordinator.hasStoredSession()
        XCTAssertFalse(initiallySignedIn)
        _ = try await coordinator.verifyEmail(challengeID: "test", code: "000000", deviceName: "Test", platform: "macos")
        let afterSignIn = try await coordinator.hasStoredSession()
        XCTAssertTrue(afterSignIn)
        _ = try await coordinator.signOut()
        let afterSignOut = try await coordinator.hasStoredSession()
        XCTAssertFalse(afterSignOut)
    }
    func testSignOutCannotRaceStoredSessionCheck() async throws {
        let secrets = BlockingSecrets()
        let coordinator = try IdentitySessionCoordinator(baseURL: URL(string: "https://identity.test")!, lockDirectory: directory(), transport: IdentityFixtureTransport(mode: .offlineLogout), secrets: secrets)
        _ = try await coordinator.verifyEmail(challengeID: "test", code: "000000", deviceName: "Test", platform: "macos")
        secrets.blockNextLoad()
        let check = Task { try await coordinator.hasStoredSession() }
        defer { secrets.release.signal() }
        let entered = await secrets.waitForEntry()
        guard entered else { return XCTFail("Session check did not start") }
        do { _ = try await coordinator.signOut(); XCTFail("Sign-out must not race the stored session check") }
        catch IdentityContinuityError.busy { }
        secrets.release.signal()
        let present = try await check.value
        XCTAssertTrue(present)
        _ = try await coordinator.signOut()
        XCTAssertNil(try secrets.load())
    }

}
