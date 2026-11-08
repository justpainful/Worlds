import Foundation
import XCTest
import WorldsIdentity
@testable import WorldsIdentityContinuity

private final class LiveIdentitySecrets: IdentitySecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var value: Data?
    func load() throws -> Data? { lock.lock(); defer { lock.unlock() }; return value }
    func save(_ data: Data) throws { lock.lock(); defer { lock.unlock() }; value = data }
    func delete() throws { lock.lock(); defer { lock.unlock() }; value = nil }
}

/// Requires disposable local services. No deployed service or user account is used.
final class LiveIdentityServiceTests: XCTestCase {
    func testLocalIdentityEmailRefreshAndRemoteLogout() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["WORLDS_REQUIRE_LIVE_IDENTITY"] == "1" else { throw XCTSkip("Local identity service was not requested") }
        guard let rawService = env["WORLDS_LIVE_IDENTITY_URL"], let service = URL(string: rawService),
              let rawMailbox = env["WORLDS_LIVE_MAILBOX_URL"], let mailbox = URL(string: rawMailbox),
              Self.isLoopback(service), Self.isLoopback(mailbox) else { return XCTFail("Local fixture services are required") }
        let directory = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("identity-live-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        let coordinator = try IdentitySessionCoordinator(baseURL: service, lockDirectory: directory, transport: URLSessionIdentityTransport(), secrets: LiveIdentitySecrets())
        let email = "worlds-fixture-\(UUID().uuidString.lowercased())@example.test"
        let challenge = try await coordinator.startEmail(email)
        var parts = try XCTUnwrap(URLComponents(url: mailbox, resolvingAgainstBaseURL: false))
        parts.path = "/code"; parts.queryItems = [URLQueryItem(name: "email", value: email)]
        let codeURL = try XCTUnwrap(parts.url)
        let mailboxTransport = URLSessionIdentityTransport()
        var code: String?
        for _ in 0..<100 {
            let (data, response) = try await mailboxTransport.send(URLRequest(url: codeURL))
            if response.statusCode == 200,
               let object = try? JSONSerialization.jsonObject(with: data) as? [String: String], let value = object["code"] {
                code = value; break
            }
            try await Task.sleep(for: .milliseconds(50))
        }
        let received = try XCTUnwrap(code)
        guard received.utf8.count == 6, received.utf8.allSatisfy({ (48...57).contains($0) }) else { return XCTFail("Invalid fixture code") }
        let signedIn = try await coordinator.verifyEmail(challengeID: challenge.challengeId, code: received, deviceName: "Isolated fixture", platform: "macos")
        let snapshot = try await coordinator.accountSnapshot()
        XCTAssertEqual(snapshot.profile.id, signedIn.userID)
        let createBody = try JSONSerialization.data(withJSONObject: ["name": "Isolated workspace"])
        let workspaceData = try await coordinator.request(path: "/workspaces", method: "POST", body: createBody)
        let workspace = try XCTUnwrap(try JSONSerialization.jsonObject(with: workspaceData) as? [String: Any])
        let workspaceID = try XCTUnwrap(workspace["id"] as? String)
        let treeBody = try JSONSerialization.data(withJSONObject: ["nodes": [["id": "fixture-page", "parentId": NSNull()]]])
        _ = try await coordinator.request(path: "/workspaces/\(workspaceID)/tree", method: "PUT", body: treeBody)
        let level = try await coordinator.currentWorkspacePageLevel(workspaceID: workspaceID, pageID: "fixture-page", expectedUserID: signedIn.userID)
        let absent = try await coordinator.currentWorkspacePageLevel(workspaceID: workspaceID, pageID: "not-mirrored", expectedUserID: signedIn.userID)
        XCTAssertEqual(level, .full); XCTAssertEqual(absent, .none)
        _ = try await coordinator.accessToken(forceRefresh: true)
        let signOut = try await coordinator.signOut()
        guard case .revokedRemotely = signOut else { return XCTFail("Remote logout was not confirmed") }
        let stored = try await coordinator.hasStoredSession(); XCTAssertFalse(stored)
    }
    private static func isLoopback(_ url: URL) -> Bool {
        url.scheme == "http" && url.host == "127.0.0.1" && url.user == nil && url.password == nil && url.query == nil && url.fragment == nil
    }
}
