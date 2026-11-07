#if WORLDS_EXPERIMENTAL_LOCAL_COPY
import SwiftUI
import WorldsLocalImport
import WorldsNativeWrites
import WorldsResourceRepositories
import WorldsProjectEditingViews

func localCopyErrorMessage(_ error: Error) -> String {
    guard let error = error as? LocalImportError else { return error.localizedDescription }
    switch error {
    case .invalidSource: return "Choose an accessible local Worlds database."
    case .invalidContainer: return "The local copy storage is unavailable or cannot be verified."
    case .invalidBackup: return "The local copy is incomplete or could not be verified."
    case .unsupportedDatabase: return "This database is not a supported Worlds database."
    @unknown default: return "The local copy could not be opened."
    }
}

struct LocalCopyContext {
    let copy: LocalProjectCopy
    let repository: NativeResourceRepository
    init(copy: LocalProjectCopy) throws {
        self.copy = copy
        repository = NativeResourceRepository(store: try NativePersonalStore(url: copy.databaseURL))
    }
}

struct LocalCopyNotice: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label("Independent local copy", systemImage: "doc.on.doc").font(.body.weight(.semibold))
            Text("No attachments or sync to the original.")
                .font(.body).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(.regularMaterial)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shared records may be present, but shared projects cannot be edited here.")
        .accessibilityIdentifier("local-copy-notice")
    }
}

struct LocalCopyPicker: View {
    @Environment(\.dismiss) private var dismiss
    let coordinator: LocalProjectImportCoordinator
    let open: (LocalProjectCopy) -> Void
    @State private var copies: [LocalProjectCopy] = []
    @State private var rejected = 0
    @State private var loading = true
    @State private var opening = false
    @State private var failure: String?
    var body: some View {
        NavigationStack {
            Group {
                if loading { ProgressView("Loading local copies") }
                else if copies.isEmpty && rejected == 0 { ContentUnavailableView("No local copies", systemImage: "doc.on.doc") }
                else {
                    List {
                        if rejected > 0 { Text("Some local copies could not be opened: \(rejected)").foregroundStyle(.secondary) }
                        ForEach(copies, id: \.id) { copy in
                            Button("Local copy \(copy.id.uuidString.prefix(8))") {
                                opening = true
                                Task {
                                    do { let validated = try await coordinator.restoreCopy(id: copy.id); open(validated); dismiss() }
                                    catch { failure = localCopyErrorMessage(error); opening = false }
                                }
                            }.disabled(opening)
                        }
                    }
                }
            }
            .navigationTitle("Local copies")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(opening) } }
            .interactiveDismissDisabled(opening)
            .task {
                do { let inventory = try await coordinator.listCopies(); copies = inventory.copies; rejected = inventory.rejectedCount }
                catch { failure = localCopyErrorMessage(error) }
                loading = false
            }
            .alert("Unable to open local copy", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("OK", role: .cancel) { failure = nil }
            } message: { Text(failure ?? "") }
        }
    }
}
#endif
