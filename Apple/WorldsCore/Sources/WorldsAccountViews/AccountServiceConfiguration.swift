import Foundation
import WorldsIdentityContinuity

public enum AccountServiceConfigurationError: Error { case notConfigured, invalidAddress }

/// Non-secret configuration. The product has no known production default.
public enum AccountServiceConfiguration {
    public static func resolve(userValue: String?, buildValue: String?, allowInsecureLoopback: Bool = false) throws -> URL {
        let user = userValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let build = buildValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let value = user.isEmpty ? build : user
        guard !value.isEmpty, !value.hasPrefix("$(") else { throw AccountServiceConfigurationError.notConfigured }
        guard !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              let url = URL(string: value), (try? IdentityScope.key(for: url)) != nil,
              url.scheme?.lowercased() == "https" || allowInsecureLoopback else {
            throw AccountServiceConfigurationError.invalidAddress
        }
        return url
    }
}
