#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_GALLERY_IMPORT
import SwiftUI
import UniformTypeIdentifiers
import WorldsLocalImport
import WorldsLocalGalleryImport
import WorldsModels
import WorldsNativeWrites

@MainActor private final class GalleryImportState: ObservableObject {
    @Published var loading = true
    @Published var busy = false
    @Published var completed = false
    @Published var ready = false
    @Published var retryRequired = false
    @Published var error: String?
    @Published var fileName: String?
    private let copy: LocalProjectCopy
    private let pageID: String
    private var importer: LocalGalleryImporter?
    private var source: URL?
    private var operation = UUID()
    private var revision: Int64?
    private var metadata: JSONValue?
    private var blocks: [NativeBlockInput]?
    private var task: Task<Void, Never>?

    init(copy: LocalProjectCopy, pageID: String) { self.copy = copy; self.pageID = pageID }
    func load() async {
        do {
            let store = try NativePersonalStore(url: copy.databaseURL)
            let value = try await store.readResource(id: pageID)
            guard case .object(let snapshot) = value, case .integer(let revision)? = snapshot["revision"],
                  let metadata = snapshot["metadata"], let blocks = snapshot["blocks"] else { throw NativeWriteError.invalidResponse }
            self.blocks = try JSONDecoder().decode([NativeBlockInput].self, from: JSONEncoder().encode(blocks))
            self.revision = revision; self.metadata = metadata
            importer = try LocalGalleryImporter(copy: copy)
            ready = true
        } catch { self.error = "The local gallery could not be opened." }
        loading = false
    }
    func choose(_ url: URL) {
        guard !busy, !retryRequired else { return }
        source = url; fileName = url.lastPathComponent; operation = UUID(); error = nil
    }
    func start(onSaved: @escaping @MainActor () -> Void) {
        guard !busy, !completed, let source, let importer, let revision, let metadata, let blocks else { return }
        busy = true; error = nil
        task = Task {
            defer { busy = false; task = nil }
            do {
                _ = try await importer.importFile(source: source, galleryID: pageID, base: revision, metadata: metadata, expected: blocks, operationID: operation)
                completed = true; onSaved()
            } catch is CancellationError { error = "Import cancelled." }
            catch { retryRequired = true; error = "The import result could not be confirmed. Retry this file or close and reopen the gallery." }
        }
    }
    func cancel() { task?.cancel() }
}

struct LocalGalleryImportView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var state: GalleryImportState
    @State private var choosing = false
    let onSaved: @MainActor () -> Void
    init(copy: LocalProjectCopy, pageID: String, onSaved: @escaping @MainActor () -> Void) {
        _state = StateObject(wrappedValue: GalleryImportState(copy: copy, pageID: pageID)); self.onSaved = onSaved
    }
    var body: some View {
        NavigationStack {
            Form {
                Text("The file is copied into this independent local copy. It does not sync to the original.")
                if state.loading { ProgressView("Opening gallery") }
                else if state.completed { Label("File imported", systemImage: "checkmark.circle") }
                else {
                    if let fileName = state.fileName { Text(fileName).textSelection(.enabled) }
                    Button("Choose file") { choosing = true }.disabled(state.busy || !state.ready || state.retryRequired)
                    Button(state.retryRequired ? "Retry import" : "Import file") { state.start(onSaved: onSaved) }.disabled(state.busy || !state.ready || state.fileName == nil)
                    if state.busy { ProgressView("Importing"); Button("Cancel import") { state.cancel() } }
                }
                if let error = state.error { Text(error).foregroundStyle(.secondary) }
            }
            .navigationTitle("Import to gallery")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(state.busy) } }
            .fileImporter(isPresented: $choosing, allowedContentTypes: [.image, .movie, .audio]) { result in
                if case .success(let url) = result { state.choose(url) }
            }
            .interactiveDismissDisabled(state.busy)
            .task { await state.load() }
        }
    }
}
#endif
