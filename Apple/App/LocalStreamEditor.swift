#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_STREAM_EDITOR
import SwiftUI
import WorldsLocalImport
import WorldsModels
import WorldsNativeWrites
import WorldsResourceRepositories

@MainActor private final class StreamEditorState: ObservableObject {
    @Published var url = ""
    @Published var loading = true
    @Published var ready = false
    @Published var saving = false
    @Published var saved = false
    @Published var error: String?
    private var baseline: StreamRecord?
    private var initial = ""
    private let copy: LocalProjectCopy
    private let pageID: String
    private var repository: NativeResourceRepository?
    init(copy: LocalProjectCopy, pageID: String) { self.copy = copy; self.pageID = pageID }
    var dirty: Bool { url != initial }
    var valid: Bool {
        guard let components = URLComponents(string: url.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = components.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = components.host, !host.isEmpty else { return false }
        return true
    }
    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            let repository = NativeResourceRepository(store: try NativePersonalStore(url: copy.databaseURL))
            let record = try await repository.readStream(id: pageID)
            guard case .object(let object) = record.metadata else { throw NativeResourceRepositoryError.malformedResponse }
            var value = ""
            if case .object(let stream)? = object["stream"], case .string(let stored)? = stream["url"] { value = stored }
            self.repository = repository; baseline = record; initial = value; url = value; ready = true
        } catch { self.error = "This stream could not be opened." }
    }
    func save(onSaved: @escaping @MainActor () -> Void) async {
        guard !saving, valid, let repository, let baseline else { return }
        let submittedURL = url
        saving = true; error = nil
        defer { saving = false }
        do {
            let updated = try await repository.saveStream(id: pageID, baseline: baseline, url: submittedURL)
            self.baseline = updated; initial = submittedURL; saved = url == submittedURL; onSaved()
        } catch NativeWriteError.conflict {
            error = "This stream changed elsewhere. Close and reopen it to load the latest version."
        } catch { self.error = "The stream link could not be saved. Your changes are still here." }
    }
}

struct LocalStreamEditor: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var state: StreamEditorState
    @State private var confirmDiscard = false
    let onSaved: @MainActor () -> Void
    init(copy: LocalProjectCopy, pageID: String, onSaved: @escaping @MainActor () -> Void) {
        _state = StateObject(wrappedValue: StreamEditorState(copy: copy, pageID: pageID)); self.onSaved = onSaved
    }
    var body: some View {
        NavigationStack {
            Form {
                Text("Changes are saved to this independent local copy and do not sync to the original.")
                if state.loading { ProgressView("Opening stream") }
                else if state.saved { Label("Stream link saved", systemImage: "checkmark.circle") }
                else {
                    TextField("Stream URL", text: $state.url, axis: .vertical)
                        .disabled(state.saving)
                        .textContentType(.URL).autocorrectionDisabled()
                        .environment(\.layoutDirection, .leftToRight)
                        .accessibilityIdentifier("stream-url-editor")
                    if !state.url.isEmpty && !state.valid { Text("Enter an HTTP or HTTPS link.").foregroundStyle(.secondary) }
                    Button("Save link") { Task { await state.save(onSaved: onSaved) } }
                        .disabled(!state.ready || !state.valid || !state.dirty || state.saving)
                        .accessibilityIdentifier("save-stream-link")
                    if state.saving { ProgressView("Saving") }
                }
                if let error = state.error { Text(error).foregroundStyle(.secondary).accessibilityIdentifier("stream-editor-error") }
            }
            .navigationTitle("Edit stream link")
            .toolbar { ToolbarItem(placement: .cancellationAction) {
                Button("Close") { if state.dirty && !state.saved { confirmDiscard = true } else { dismiss() } }.disabled(state.saving)
            } }
            .interactiveDismissDisabled(state.saving || (state.dirty && !state.saved))
            .confirmationDialog("Discard changes?", isPresented: $confirmDiscard) {
                Button("Discard changes", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) { }
            }
            .task { await state.load() }
        }
    }
}
#endif
