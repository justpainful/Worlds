import Foundation

/// How a provider speaks: the Anthropic Messages API or OpenAI chat completions.
public enum AIProviderDialect: String, Sendable, Equatable, CaseIterable {
    case anthropic
    case openAI = "openai"
}

/// Where a provider runs. Runners (Claude Code, Codex) are desktop only and are left out on Apple platforms.
public enum AIProviderKind: String, Sendable, Equatable {
    case cloud
    case local
}

public enum AIKeyRequirement: String, Sendable, Equatable {
    case required
    case optional
    case none
}

/// One provider preset. The same shape as `src/ai/providers.json`, shared by Windows, Android and Apple.
public struct AIProviderPreset: Sendable, Equatable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let api: AIProviderDialect
    public let kind: AIProviderKind
    public let baseURL: String
    public let key: AIKeyRequirement
    public let editableBaseURL: Bool
    public let modelsPath: String
    public let note: String?

    public init(id: String, name: String, api: AIProviderDialect, kind: AIProviderKind, baseURL: String,
                key: AIKeyRequirement, editableBaseURL: Bool, modelsPath: String, note: String? = nil) {
        self.id = id
        self.name = name
        self.api = api
        self.kind = kind
        self.baseURL = baseURL
        self.key = key
        self.editableBaseURL = editableBaseURL
        self.modelsPath = modelsPath
        self.note = note
    }

    /// Hosted services need a key; local servers run without one.
    public var requiresKey: Bool { key == .required }
    /// Whether the settings offer a key field at all.
    public var acceptsKey: Bool { key != .none }
    public var isLocal: Bool { kind == .local }
}

/// A Swift copy of the non runner presets in `src/ai/providers.json`.
/// `AIProviderPresetSyncTests` fails when the two drift apart.
public enum AIProviderPresets {
    public static let all: [AIProviderPreset] = [
        AIProviderPreset(id: "anthropic", name: "Anthropic", api: .anthropic, kind: .cloud,
                         baseURL: "https://api.anthropic.com", key: .required, editableBaseURL: true,
                         modelsPath: "/v1/models", note: "Claude models with an API key from the Claude Console."),
        AIProviderPreset(id: "openai", name: "OpenAI", api: .openAI, kind: .cloud,
                         baseURL: "https://api.openai.com/v1", key: .required, editableBaseURL: true, modelsPath: "/models"),
        AIProviderPreset(id: "gemini", name: "Google Gemini", api: .openAI, kind: .cloud,
                         baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", key: .required, editableBaseURL: true, modelsPath: "/models"),
        AIProviderPreset(id: "groq", name: "Groq", api: .openAI, kind: .cloud,
                         baseURL: "https://api.groq.com/openai/v1", key: .required, editableBaseURL: true, modelsPath: "/models"),
        AIProviderPreset(id: "deepseek", name: "DeepSeek", api: .openAI, kind: .cloud,
                         baseURL: "https://api.deepseek.com/v1", key: .required, editableBaseURL: true, modelsPath: "/models"),
        AIProviderPreset(id: "mistral", name: "Mistral", api: .openAI, kind: .cloud,
                         baseURL: "https://api.mistral.ai/v1", key: .required, editableBaseURL: true, modelsPath: "/models"),
        AIProviderPreset(id: "xai", name: "xAI", api: .openAI, kind: .cloud,
                         baseURL: "https://api.x.ai/v1", key: .required, editableBaseURL: true, modelsPath: "/models"),
        AIProviderPreset(id: "openrouter", name: "OpenRouter", api: .openAI, kind: .cloud,
                         baseURL: "https://openrouter.ai/api/v1", key: .required, editableBaseURL: true, modelsPath: "/models"),
        AIProviderPreset(id: "litellm", name: "LiteLLM", api: .openAI, kind: .cloud,
                         baseURL: "http://localhost:4000/v1", key: .optional, editableBaseURL: true,
                         modelsPath: "/models", note: "Your own LiteLLM proxy. Set its address."),
        AIProviderPreset(id: "custom", name: "Custom", api: .openAI, kind: .cloud,
                         baseURL: "", key: .optional, editableBaseURL: true,
                         modelsPath: "/models", note: "Any server that speaks the OpenAI chat completions API."),
        AIProviderPreset(id: "ollama", name: "Ollama", api: .openAI, kind: .local,
                         baseURL: "http://localhost:11434/v1", key: .none, editableBaseURL: true, modelsPath: "/api/tags"),
        AIProviderPreset(id: "lmstudio", name: "LM Studio", api: .openAI, kind: .local,
                         baseURL: "http://localhost:1234/v1", key: .none, editableBaseURL: true, modelsPath: "/models"),
        AIProviderPreset(id: "llamacpp", name: "llama.cpp", api: .openAI, kind: .local,
                         baseURL: "http://localhost:8080/v1", key: .none, editableBaseURL: true, modelsPath: "/models"),
    ]

    public static func preset(id: String?) -> AIProviderPreset? {
        guard let id else { return nil }
        return all.first { $0.id == id }
    }
}
