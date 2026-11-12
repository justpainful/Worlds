#if WORLDS_EXPERIMENTAL_LOCAL_COPY
import SwiftUI
import WorldsLocalImport
import WorldsNativeWrites
import WorldsResourceRepositories
import WorldsProjectEditingViews
import WorldsWorkspaceAccess

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

/// The active write target: the person's own workspace database, written in
/// place, or an independent local copy. The property keeps its earlier name
/// `copy` so every editor request reads `request.copy.databaseURL` either way.
struct LocalCopyContext: Sendable {
    let copy: WorkspaceWriteTarget
    let repository: NativeResourceRepository
    /// Keeps security scoped access to the own workspace while it is active.
    let lease: WorkspaceAccessLease?
    init(target: WorkspaceWriteTarget) throws {
        copy = target
        lease = target.isLocalCopy ? nil : WorkspaceAccessLease(url: target.databaseURL)
        repository = NativeResourceRepository(store: try NativePersonalStore(url: target.databaseURL))
    }
    init(copy: LocalProjectCopy) throws {
        try self.init(target: .localCopy(copy))
    }
}

/// One line that says where an editor saves.
func workspaceSaveNotice(_ target: WorkspaceWriteTarget) -> LocalizedStringKey {
    target.isLocalCopy
        ? "Changes are saved to this independent local copy and do not sync to the original."
        : "Changes are saved to your Worlds workspace and appear in Worlds on your computer. Its page history keeps earlier versions."
}

/// Text for a refusal the person can act on, or nil for other errors.
func workspaceWriteMessage(_ error: Error) -> String? {
    guard let error = error as? NativeWriteError, case .teamWorkspace = error else { return nil }
    return String(localized: "New pages would join your active team workspace. Create it in Worlds on your computer, or choose a personal parent page.")
}

struct LocalCopyNotice: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label("Independent local copy", systemImage: "doc.on.doc").font(.body.weight(.semibold))
            Text("Existing attachments are not copied. Changes do not sync to the original.")
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

/// Says why the opened workspace can be read but not edited here.
struct WorkspaceReadOnlyNotice: View {
    let reason: WorkspaceWriteAccess.Reason
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label("Read only", systemImage: "lock").font(.body.weight(.semibold))
            Text(message).font(.body).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(.regularMaterial)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("workspace-read-only-notice")
    }
    private var message: LocalizedStringKey {
        switch reason {
        case .cloudStorage:
            return "This database is in iCloud Drive or another cloud folder, where saving to it could damage it. Create a local copy to edit."
        case .networkVolume:
            return "This database is on a network or unknown drive, where saving to it is not safe. Create a local copy to edit."
        case .notWritable:
            return "This database or its folder cannot be written."
        case .unsupportedSchema:
            return "This database is from a different version of Worlds. Open it in Worlds on your computer first."
        case .notLocalFile, .notWorldsDatabase, .unavailable:
            return "This database cannot be edited here."
        }
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
