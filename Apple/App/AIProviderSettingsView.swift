#if WORLDS_MAIN_APP_MODULES
import SwiftUI
import WorldsAI

/// Localized text for provider errors. `AIProviderError.errorDescription` is the English fallback.
func aiErrorMessage(_ error: Error) -> String {
    guard let error = error as? AIProviderError else { return error.localizedDescription }
    switch error {
    case .noProvider:
        return String(localized: "Choose an AI provider in AI settings to start.")
    case .noKey(let provider):
        return String(localized: "Add your \(provider) API key in AI settings.")
    case .noModel(let provider):
        return String(localized: "Choose a model for \(provider) in AI settings.")
    case .badURL(let provider):
        return String(localized: "The \(provider) address is not a valid http or https URL.")
    case .insecureAddress(let provider):
        return String(localized: "\(provider) needs an https address. Plain http only works for servers on this device or your local network.")
    case .badKey(let provider):
        return String(localized: "\(provider) rejected the API key. Check it in AI settings.")
    case .modelMissing(let provider, let model):
        return String(localized: "\(provider) has no model named \(model). Pick another model.")
    case .offline(let provider, let host, let local):
        return local
            ? String(localized: "Cannot reach \(provider) at \(host). Check that it is running and reachable from this device.")
            : String(localized: "Cannot reach \(provider). Check your internet connection.")
    case .rateLimited(let provider, let detail):
        let text = String(localized: "\(provider) is limiting requests right now.")
        return detail.map { text + " " + $0 } ?? text
    case .server(let provider, let status, let detail):
        let text = String(localized: "\(provider) returned an error (\(status)).")
        return detail.map { text + " " + $0 } ?? text
    case .stream(let provider, let detail):
        return String(localized: "\(provider) stopped the reply: \(detail)")
    case .malformed(let provider):
        return String(localized: "\(provider) sent a reply Worlds could not read.")
    case .subscriptionToken:
        return String(localized: "That is a Claude subscription sign in token. Worlds cannot use those; create an API key in the Claude Console.")
    case .invalidKey:
        return String(localized: "That does not look like an API key.")
    case .keychain(let status):
        let code = Int(status)
        return String(localized: "The Keychain could not store the key (\(code)).")
    }
}

/// Settings for one provider at a time: which provider, its key, its address and its model.
/// Keys go to the Keychain and are never read back into the form.
@MainActor
final class AIProviderSettingsModel: ObservableObject {
    struct Notice: Equatable {
        let text: String
        let isError: Bool
    }

    @Published private(set) var providerID: String
    @Published var baseURL = ""
    @Published private(set) var model = ""
    @Published private(set) var models: [AIModelOption] = []
    @Published var keyDraft = ""
    @Published private(set) var hasKey = false
    @Published private(set) var isActive = false
    @Published private(set) var loadingModels = false
    @Published private(set) var keyNotice: Notice?
    @Published private(set) var addressNotice: Notice?
    @Published private(set) var modelNotice: Notice?

    private let store: AIProviderSettingsStore

    init(store: AIProviderSettingsStore = AIProviderSettingsStore()) {
        self.store = store
        providerID = store.selectedProviderID ?? AIProviderPresets.all[0].id
        isActive = store.selectedProviderID != nil
        loadFields()
    }

    var preset: AIProviderPreset { AIProviderPresets.preset(id: providerID) ?? AIProviderPresets.all[0] }
    var cloudPresets: [AIProviderPreset] { AIProviderPresets.all.filter { !$0.isLocal } }
    var localPresets: [AIProviderPreset] { AIProviderPresets.all.filter(\.isLocal) }
    var addressIsDefault: Bool { AIRequests.normalizedBase(baseURL) == AIRequests.normalizedBase(preset.baseURL) }

    func select(_ id: String) {
        guard id != providerID, AIProviderPresets.preset(id: id) != nil else { return }
        providerID = id
        loadFields()
        activate()
    }

    private func loadFields() {
        let settings = store.settings(for: providerID)
        baseURL = settings.baseURL
        model = settings.model
        models = settings.models
        keyDraft = ""
        hasKey = preset.acceptsKey && store.hasKey(for: providerID)
        keyNotice = nil
        addressNotice = nil
        modelNotice = nil
    }

    /// Makes the provider on screen the one the assistant uses.
    func activate() {
        store.selectedProviderID = providerID
        isActive = true
    }

    private func persist() {
        store.save(AIProviderSettings(baseURL: baseURL, model: model, models: models), for: providerID)
    }

    func saveKey() {
        // Removing a key is its own button; an empty field never deletes one.
        guard !keyDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        do {
            let saved = try store.saveKey(keyDraft, for: providerID)
            keyDraft = ""
            hasKey = saved
            keyNotice = saved ? Notice(text: String(localized: "Key saved in the Keychain."), isError: false) : nil
            activate()
        } catch {
            // The field is hidden, so a refused key is cleared rather than kept around.
            keyDraft = ""
            keyNotice = Notice(text: aiErrorMessage(error), isError: true)
        }
    }

    func removeKey() {
        do {
            try store.deleteKey(for: providerID)
            hasKey = false
            keyNotice = Notice(text: String(localized: "Key removed."), isError: false)
        } catch {
            keyNotice = Notice(text: aiErrorMessage(error), isError: true)
        }
    }

    /// Saves the address when it is valid. Returns false and explains when it is not.
    @discardableResult
    func saveAddress() -> Bool {
        let clean = AIRequests.normalizedBase(baseURL)
        guard AIRequests.isValidBase(clean) else {
            addressNotice = Notice(text: String(localized: "Enter an address that starts with http:// or https://, without a user name or password."), isError: true)
            return false
        }
        if clean != baseURL { baseURL = clean }
        addressNotice = nil
        persist()
        return true
    }

    func resetAddress() {
        baseURL = preset.baseURL
        addressNotice = nil
        persist()
    }

    func chooseModel(_ id: String) {
        model = id.trimmingCharacters(in: .whitespacesAndNewlines)
        persist()
        activate()
    }

    func loadModels() async {
        guard !loadingModels, saveAddress() else { return }
        loadingModels = true
        defer { loadingModels = false }
        modelNotice = nil
        let store = self.store
        let id = providerID
        let base = AIRequests.normalizedBase(baseURL)
        do {
            // The Keychain read and the request both run away from the main actor.
            let list = try await Task.detached {
                let configuration = try store.configuration(for: id, baseURL: base)
                return try await AIProviderClient(configuration: configuration).listModels()
            }.value
            guard id == providerID else { return }
            models = list
            persist()
            activate()
            modelNotice = list.isEmpty
                ? Notice(text: String(localized: "This provider listed no chat models. Type a model ID instead."), isError: true)
                : Notice(text: String(localized: "Models loaded: \(list.count)"), isError: false)
        } catch {
            guard id == providerID else { return }
            modelNotice = Notice(text: aiErrorMessage(error), isError: true)
        }
    }

    /// A short, localized description of the provider.
    var note: String {
        switch preset.id {
        case "anthropic": return String(localized: "Claude models with an API key from the Claude Console.")
        case "litellm": return String(localized: "Your own LiteLLM proxy. Set its address.")
        case "custom": return String(localized: "Any server that speaks the OpenAI chat completions API.")
        default: break
        }
        if preset.isLocal {
            return String(localized: "Runs on your own computer with no key. On iPhone or iPad, replace localhost with your computer's network address.")
        }
        let site: String
        switch preset.id {
        case "openai": site = "platform.openai.com"
        case "gemini": site = "aistudio.google.com"
        case "groq": site = "console.groq.com"
        case "deepseek": site = "platform.deepseek.com"
        case "mistral": site = "console.mistral.ai"
        case "xai": site = "console.x.ai"
        case "openrouter": site = "openrouter.ai"
        default: return String(localized: "Uses the OpenAI chat completions API.")
        }
        return String(localized: "Create an API key at \(site).")
    }
}

struct AIProviderSettingsView: View {
    @StateObject private var settings = AIProviderSettingsModel()
    @State private var manualModel = ""
    @FocusState private var addressFocused: Bool

    var body: some View {
        Form {
            providerSection
            if settings.preset.acceptsKey { keySection }
            if settings.preset.editableBaseURL { addressSection }
            modelSection
        }
        .formStyle(.grouped)
        .navigationTitle("AI Providers")
        .onAppear { manualModel = settings.model }
        .onChange(of: settings.providerID) { _, _ in manualModel = settings.model }
        .onChange(of: addressFocused) { _, focused in
            if !focused && !settings.addressIsDefault { settings.saveAddress() }
        }
        .accessibilityIdentifier("ai-provider-settings")
    }

    private var providerBinding: Binding<String> {
        Binding(get: { settings.providerID }, set: { settings.select($0) })
    }

    private var providerSection: some View {
        Section {
            Picker(selection: providerBinding) {
                Section("Cloud") {
                    ForEach(settings.cloudPresets) { preset in
                        Text(verbatim: preset.name).tag(preset.id)
                    }
                }
                Section("On your computer") {
                    ForEach(settings.localPresets) { preset in
                        Text(verbatim: preset.name).tag(preset.id)
                    }
                }
            } label: {
                Label("Provider", systemImage: "cpu")
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("ai-provider-picker")
            if !settings.isActive {
                Button { settings.activate() } label: {
                    Label("Use this provider", systemImage: "checkmark.circle")
                }
                .accessibilityIdentifier("ai-provider-use")
            }
        } header: {
            Text("Provider")
        } footer: {
            Text(verbatim: settings.note)
        }
    }

    private var keySection: some View {
        Section {
            if settings.hasKey {
                LabeledContent {
                    Label("Saved", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .accessibilityIdentifier("ai-key-saved")
                } label: {
                    Label("API key", systemImage: "key")
                }
            }
            SecureField(settings.hasKey ? LocalizedStringKey("Replace the saved key") : LocalizedStringKey("Paste your API key"), text: $settings.keyDraft)
                .autocorrectionDisabled()
                #if os(iOS)
                .textContentType(.password)
                .textInputAutocapitalization(.never)
                #endif
                .environment(\.layoutDirection, .leftToRight)
                .onSubmit { settings.saveKey() }
                .accessibilityIdentifier("ai-key-field")
            HStack {
                if settings.hasKey {
                    Button(role: .destructive) { settings.removeKey() } label: {
                        Label("Remove key", systemImage: "trash")
                    }
                    .accessibilityIdentifier("ai-key-remove")
                }
                Spacer()
                Button { settings.saveKey() } label: {
                    Label("Save key", systemImage: "lock")
                }
                .disabled(settings.keyDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("ai-key-save")
            }
            .buttonStyle(.borderless)
            if let notice = settings.keyNotice { noticeView(notice) }
        } header: {
            Text("API key")
        } footer: {
            if settings.preset.requiresKey {
                Text("The key is kept only in this device's Keychain and is never shown again.")
            } else {
                Text("Optional. The key is kept only in this device's Keychain and is never shown again.")
            }
        }
    }

    private var addressSection: some View {
        Section {
            TextField("Server address", text: $settings.baseURL, prompt: Text(verbatim: settings.preset.baseURL.isEmpty ? "https://example.com/v1" : settings.preset.baseURL))
                .autocorrectionDisabled()
                #if os(iOS)
                .textContentType(.URL)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                #endif
                .environment(\.layoutDirection, .leftToRight)
                .focused($addressFocused)
                .onSubmit { settings.saveAddress() }
                .accessibilityIdentifier("ai-address-field")
            if !settings.addressIsDefault && !settings.preset.baseURL.isEmpty {
                Button { settings.resetAddress() } label: {
                    Label("Use the default address", systemImage: "arrow.uturn.backward")
                }
                .buttonStyle(.borderless)
            }
            if let notice = settings.addressNotice { noticeView(notice) }
        } header: {
            Text("Server address")
        }
    }

    private var modelBinding: Binding<String> {
        Binding(get: { settings.model }, set: { settings.chooseModel($0) })
    }

    private var modelSection: some View {
        Section {
            Button {
                Task { await settings.loadModels() }
            } label: {
                HStack {
                    Label("Load models", systemImage: "arrow.clockwise")
                    Spacer()
                    if settings.loadingModels { ProgressView().controlSize(.small) }
                }
            }
            .disabled(settings.loadingModels)
            .accessibilityIdentifier("ai-load-models")
            if !settings.models.isEmpty {
                Picker(selection: modelBinding) {
                    Text("Choose a model").tag("")
                    if !settings.model.isEmpty && !settings.models.contains(where: { $0.id == settings.model }) {
                        Text(verbatim: settings.model).tag(settings.model)
                    }
                    ForEach(settings.models) { option in
                        Text(verbatim: option.name == option.id ? option.id : "\(option.name) (\(option.id))").tag(option.id)
                    }
                } label: {
                    Label("Model", systemImage: "square.stack.3d.up")
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("ai-model-picker")
            }
            TextField("Model ID", text: $manualModel, prompt: Text("Type a model ID"))
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .environment(\.layoutDirection, .leftToRight)
                .onSubmit { settings.chooseModel(manualModel) }
                .onChange(of: settings.model) { _, value in if manualModel != value { manualModel = value } }
                .accessibilityIdentifier("ai-model-field")
            if manualModel.trimmingCharacters(in: .whitespacesAndNewlines) != settings.model {
                Button { settings.chooseModel(manualModel) } label: {
                    Label("Use this model", systemImage: "checkmark")
                }
                .buttonStyle(.borderless)
                .disabled(manualModel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if let notice = settings.modelNotice { noticeView(notice) }
        } header: {
            Text("Model")
        } footer: {
            Text("Load the models this provider offers, or type a model ID.")
        }
    }

    private func noticeView(_ notice: AIProviderSettingsModel.Notice) -> some View {
        Label {
            Text(verbatim: notice.text)
        } icon: {
            Image(systemName: notice.isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
        }
        .font(.footnote)
        .foregroundStyle(notice.isError ? Color.red : Color.secondary)
        .accessibilityIdentifier("ai-settings-notice")
    }
}
#endif
