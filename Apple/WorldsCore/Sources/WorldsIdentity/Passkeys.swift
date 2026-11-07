import Foundation
@preconcurrency import AuthenticationServices

public struct PasskeyChallenge: Sendable {
    public let challengeID: String
    public let relyingPartyID: String
    public let challenge: Data
    init(challengeID: String, relyingPartyID: String, challenge: Data) {
        self.challengeID = challengeID
        self.relyingPartyID = relyingPartyID
        self.challenge = challenge
    }
}

public struct PasskeyAssertion: Sendable {
    public let credentialID: Data
    public let clientDataJSON: Data
    public let authenticatorData: Data
    public let signature: Data
    public let userID: Data?

    public init(credentialID: Data, clientDataJSON: Data, authenticatorData: Data, signature: Data, userID: Data?) {
        self.credentialID = credentialID
        self.clientDataJSON = clientDataJSON
        self.authenticatorData = authenticatorData
        self.signature = signature
        self.userID = userID
    }

    struct WebAuthnResponse: Encodable {
        struct AssertionResponse: Encodable {
            let clientDataJSON: String
            let authenticatorData: String
            let signature: String
            let userHandle: String?
        }
        let id: String
        let rawId: String
        let type = "public-key"
        let clientExtensionResults: [String: String] = [:]
        let authenticatorAttachment = "platform"
        let response: AssertionResponse
    }

    var webAuthnResponse: WebAuthnResponse {
        let id = IdentityCrypto.base64URL(credentialID)
        return WebAuthnResponse(id: id, rawId: id, response: .init(
            clientDataJSON: IdentityCrypto.base64URL(clientDataJSON),
            authenticatorData: IdentityCrypto.base64URL(authenticatorData),
            signature: IdentityCrypto.base64URL(signature),
            userHandle: userID.map(IdentityCrypto.base64URL)))
    }
}

/// Hold this object until the sign-in finishes. The caller supplies its real window.
@MainActor
public final class ApplePasskeyAuthorization: NSObject, @preconcurrency ASAuthorizationControllerDelegate,
                                               @preconcurrency ASAuthorizationControllerPresentationContextProviding {
    private let anchor: ASPresentationAnchor
    private var controller: ASAuthorizationController?
    private var continuation: CheckedContinuation<PasskeyAssertion, Error>?

    public init(anchor: ASPresentationAnchor) { self.anchor = anchor }

    public func assert(_ challenge: PasskeyChallenge) async throws -> PasskeyAssertion {
        guard continuation == nil else { throw IdentityError.busy }
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: challenge.relyingPartyID)
            let request = provider.createCredentialAssertionRequest(challenge: challenge.challenge)
            let controller = ASAuthorizationController(authorizationRequests: [request])
            self.controller = controller
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { anchor }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion,
              let authenticatorData = credential.rawAuthenticatorData,
              let signature = credential.signature else {
            finish(.failure(IdentityError.invalidResponse)); return
        }
        finish(.success(PasskeyAssertion(credentialID: credential.credentialID,
            clientDataJSON: credential.rawClientDataJSON, authenticatorData: authenticatorData,
            signature: signature, userID: credential.userID)))
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        finish(.failure(error))
    }

    private func finish(_ result: Result<PasskeyAssertion, Error>) {
        let pending = continuation
        continuation = nil
        controller = nil
        pending?.resume(with: result)
    }
}
