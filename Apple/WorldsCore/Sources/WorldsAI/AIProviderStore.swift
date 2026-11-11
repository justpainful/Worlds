import Foundation
import Security

public enum AIKeyValidation {
    public static let maximumLength = 4096

    /// Returns the trimmed key, or an empty string when the field was cleared.
    /// Claude subscription sign in tokens (`sk-ant-oat...`) are refused: Anthropic
    /// allows them only inside Claude Code itself.
    public static func validate(_ raw: String) throws -> String {
        let key = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if key.isEmpty { return "" }
        if key.hasPrefix("sk-ant-oat") { throw AIProviderError.subscriptionToken }
        let printableASCII = key.unicodeScalars.allSatisfy { $0.value > 0x20 && $0.value < 0x7F }
        guard printableASCII, key.utf8.count <= maximumLength else { throw AIProviderError.invalidKey }
        return key
    }
}

/// Where API keys live. The only production implementation is the Keychain.
public protocol AIKeyStoring: Sendable {
    func hasKey(providerID: String) -> Bool
    func key(providerID: String) throws -> String?
    func setKey(_ key: String, providerID: String) throws
    func deleteKey(providerID: String) throws
}

/// One Keychain item per provider, readable only on this device after first unlock.
/// Mirrors `KeychainIdentityStore` in WorldsIdentity.
public struct KeychainAIKeyStore: AIKeyStoring {
    private let service: String

    public init(service: String = "Worlds.AIProviderKeys") {
        self.service = service
    }

    private func baseQuery(_ providerID: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: providerID]
    }

    public func hasKey(providerID: String) -> Bool {
        var query = baseQuery(providerID)
        query[kSecReturnAttributes as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        return SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess
    }

    public func key(providerID: String) throws -> String? {
        var query = baseQuery(providerID)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw AIProviderError.keychain(status: status) }
        guard let data = item as? Data, let key = String(data: data, encoding: .utf8), !key.isEmpty else { return nil }
        return key
    }

    public func setKey(_ key: String, providerID: String) throws {
        let data = Data(key.utf8)
        let attributes: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(baseQuery(providerID) as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw AIProviderError.keychain(status: status) }
        var item = baseQuery(providerID)
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let result = SecItemAdd(item as CFDictionary, nil)
        guard result == errSecSuccess else { throw AIProviderError.keychain(status: result) }
    }

    public func deleteKey(providerID: String) throws {
        let result = SecItemDelete(baseQuery(providerID) as CFDictionary)
        guard result == errSecSuccess || result == errSecItemNotFound else { throw AIProviderError.keychain(status: result) }
    }
}

/// What a person set for one provider, apart from the key.
public struct AIProviderSettings: Codable, Sendable, Equatable {
    public var baseURL: String
    public var model: String
    public var models: [AIModelOption]

    public init(baseURL: String, model: String = "", models: [AIModelOption] = []) {
        self.baseURL = baseURL
        self.model = model
        self.models = models
    }
}

/// Provider settings for this device: the chosen provider, an address and a
/// model per provider in user defaults, and the keys in the Keychain.
public final class AIProviderSettingsStore: @unchecked Sendable {
    private let defaults: UserDefaults
    private let keys: any AIKeyStoring
    private static let selectedKey = "worlds.ai.provider"
    private static let settingsPrefix = "worlds.ai.provider."

    public init(defaults: UserDefaults = .standard, keys: any AIKeyStoring = KeychainAIKeyStore()) {
        self.defaults = defaults
        self.keys = keys
    }

    public var selectedProviderID: String? {
        get {
            let id = defaults.string(forKey: Self.selectedKey)
            return AIProviderPresets.preset(id: id) == nil ? nil : id
        }
        set {
            if let newValue { defaults.set(newValue, forKey: Self.selectedKey) }
            else { defaults.removeObject(forKey: Self.selectedKey) }
        }
    }

    public func settings(for providerID: String) -> AIProviderSettings {
        let fallback = AIProviderPresets.preset(id: providerID)?.baseURL ?? ""
        guard let data = defaults.data(forKey: Self.settingsPrefix + providerID),
              var stored = try? JSONDecoder().decode(AIProviderSettings.self, from: data) else {
            return AIProviderSettings(baseURL: fallback)
        }
        if stored.baseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { stored.baseURL = fallback }
        return stored
    }

    public func save(_ settings: AIProviderSettings, for providerID: String) {
        var clean = settings
        clean.baseURL = AIRequests.normalizedBase(settings.baseURL)
        clean.model = settings.model.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = try? JSONEncoder().encode(clean) else { return }
        defaults.set(data, forKey: Self.settingsPrefix + providerID)
    }

    public func hasKey(for providerID: String) -> Bool {
        keys.hasKey(providerID: providerID)
    }

    /// Validates and stores a key. An empty value removes the saved key.
    /// Returns true when a key was saved.
    @discardableResult
    public func saveKey(_ raw: String, for providerID: String) throws -> Bool {
        guard let preset = AIProviderPresets.preset(id: providerID) else { throw AIProviderError.noProvider }
        guard preset.acceptsKey else { return false }
        let key = try AIKeyValidation.validate(raw)
        if key.isEmpty {
            try keys.deleteKey(providerID: providerID)
            return false
        }
        try keys.setKey(key, providerID: providerID)
        return true
    }

    public func deleteKey(for providerID: String) throws {
        try keys.deleteKey(providerID: providerID)
    }

    /// Checks the chosen provider without reading the key.
    /// Throws the first thing a person has to fix in AI settings.
    public func checkActive() throws -> (preset: AIProviderPreset, settings: AIProviderSettings) {
        guard let id = selectedProviderID, let preset = AIProviderPresets.preset(id: id) else { throw AIProviderError.noProvider }
        let settings = self.settings(for: id)
        guard AIRequests.isValidBase(settings.baseURL) else { throw AIProviderError.badURL(provider: preset.name) }
        if preset.requiresKey && !hasKey(for: id) { throw AIProviderError.noKey(provider: preset.name) }
        if settings.model.isEmpty { throw AIProviderError.noModel(provider: preset.name) }
        return (preset, settings)
    }

    public var isActiveReady: Bool { (try? checkActive()) != nil }

    /// The provider ready to call, with its key read from the Keychain. Call off the main thread.
    public func configuration(for providerID: String, baseURL: String? = nil) throws -> AIProviderConfiguration {
        guard let preset = AIProviderPresets.preset(id: providerID) else { throw AIProviderError.noProvider }
        let key: String? = try preset.acceptsKey ? keys.key(providerID: providerID) : nil
        return AIProviderConfiguration(preset: preset, baseURL: baseURL ?? self.settings(for: providerID).baseURL, apiKey: key)
    }

    /// The chosen provider and model, ready to call. Call off the main thread.
    public func activeConfiguration() throws -> (configuration: AIProviderConfiguration, model: String) {
        let active = try checkActive()
        let config = try self.configuration(for: active.preset.id, baseURL: active.settings.baseURL)
        if active.preset.requiresKey && !config.hasKey { throw AIProviderError.noKey(provider: active.preset.name) }
        return (config, active.settings.model)
    }
}
