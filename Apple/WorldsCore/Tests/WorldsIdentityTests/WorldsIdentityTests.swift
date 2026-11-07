import Foundation
import XCTest
import CryptoKit
@testable import WorldsIdentity

private final class MemorySecrets: IdentitySecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var value: Data?
    func load() throws -> Data? { lock.lock(); defer { lock.unlock() }; return value }
    func save(_ data: Data) throws { lock.lock(); defer { lock.unlock() }; value = data }
    func delete() throws { lock.lock(); defer { lock.unlock() }; value = nil }
}

private actor FakeIdentity: IdentityTransport {
    private var publicKey: Curve25519.Signing.PublicKey?
    private(set) var refreshCount = 0
    private(set) var validSignature = false
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let path = request.url!.path
        let body = try request.httpBody.map { try JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? nil
        let response: [String: Any]
        switch path {
        case "/auth/email/start":
            response = ["challengeId": "challenge", "expiresAt": 99]
        case "/auth/email/verify":
            let device = body?["device"] as? [String: String]
            guard let encoded = device?["publicKey"], let bytes = decodeBase64URL(encoded) else { throw IdentityError.invalidResponse }
            publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: bytes)
            response = tokens(refresh: "wr_first")
        case "/auth/refresh":
            refreshCount += 1
            guard let body, let token = body["refreshToken"] as? String,
                  let device = body["deviceId"] as? String, let ts = body["ts"] as? Int64,
                  let encoded = body["signature"] as? String, let signature = decodeBase64URL(encoded),
                  let key = publicKey else { throw IdentityError.invalidResponse }
            let message = IdentityCrypto.refreshMessage(deviceID: device, timestamp: ts, token: token)
            validSignature = key.isValidSignature(signature, for: Data(message.utf8))
            response = tokens(refresh: "wr_rotated")
        default:
            response = ["ok": true]
        }
        return (try JSONSerialization.data(withJSONObject: response), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
    private func tokens(refresh: String) -> [String: Any] {
        ["accessToken": "access", "accessTokenExpiresAt": Int64(Date().timeIntervalSince1970 * 1000) + 300_000,
         "refreshToken": refresh, "refreshTokenExpiresAt": Int64(Date().timeIntervalSince1970 * 1000) + 600_000,
         "userId": "user", "deviceId": "device"]
    }
    private func decodeBase64URL(_ text: String) -> Data? {
        var value = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        value += String(repeating: "=", count: (4 - value.count % 4) % 4)
        return Data(base64Encoded: value)
    }
}

final class WorldsIdentityTests: XCTestCase {
    func testPKCERFCVectorAndRefreshMessage() {
        XCTAssertEqual(IdentityCrypto.pkceChallenge(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        XCTAssertEqual(IdentityCrypto.refreshMessage(deviceID: "device", timestamp: 123, token: "wr_test"), "worlds-refresh.v1:device:123:1119e0b1f7c2b94b8cace87a0f07b4bef7067ef8e2f0912f569e744a715272f7")
        let pkce = PKCE()
        XCTAssertEqual(pkce.challenge, IdentityCrypto.pkceChallenge(verifier: pkce.verifier))
        XCTAssertNotEqual(pkce.state, pkce.verifier)
    }

    func testSignInAndSignedRefresh() async throws {
        let transport = FakeIdentity()
        let secrets = MemorySecrets()
        let client = try WorldsIdentityClient(baseURL: URL(string: "https://identity.example")!, secrets: secrets, transport: transport)
        let challenge = try await client.startEmail("person@example.com")
        XCTAssertEqual(challenge.challengeId, "challenge")
        _ = try await client.verifyEmail(challengeID: challenge.challengeId, code: "123456", deviceName: "iPhone", platform: "ios")
        let token = try await client.accessToken(forceRefresh: true)
        XCTAssertEqual(token, "access")
        let count = await transport.refreshCount
        let valid = await transport.validSignature
        XCTAssertEqual(count, 1)
        XCTAssertTrue(valid)
        let saved = try XCTUnwrap(secrets.load())
        XCTAssertTrue(String(decoding: saved, as: UTF8.self).contains("wr_rotated"))
    }

    func testRejectsInvalidServerAndCallbackState() async throws {
        XCTAssertThrowsError(try WorldsIdentityClient(baseURL: URL(string: "http://example.com")!))
        let client = try WorldsIdentityClient(baseURL: URL(string: "https://identity.example")!, secrets: MemorySecrets(), transport: FakeIdentity())
        do {
            _ = try await client.exchange(code: "code", pkce: PKCE(), callbackState: "wrong", deviceName: "Mac", platform: "macos")
            XCTFail("Mismatched state must fail")
        } catch IdentityError.invalidResponse {} catch { XCTFail("Unexpected error: \(error)") }
    }
}
