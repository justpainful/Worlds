#if WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_RENAME_PAGE
import SwiftUI
import WorldsLocalImport
import WorldsWorkspaceAccess
import WorldsNativeWrites

struct LocalRenamePageRequest: Identifiable {
    let id = UUID()
    let pageID: String
    let originalTitle: String
    let originalRevision: Int64
    let copy: WorkspaceWriteTarget
    let databaseIdentity: VideoDatabaseIdentity
    let generation: UUID
}

struct LocalPageNameRevision {
    let title: String
    let revision: Int64
}

struct LocalRenamePageView: View {
    @Environment(\.dismiss) private var dismiss
    let request: LocalRenamePageRequest
    let save: @MainActor (LocalPageNameRevision, String, UUID) async throws -> LocalPageNameRevision
    @State private var title: String
    @State private var baseline: LocalPageNameRevision
    @State private var previousName: String?
    @State private var busy = false
    @State private var uncertain = false
    @State private var message: String?
    @State private var confirmDiscard = false

    init(request: LocalRenamePageRequest, save: @escaping @MainActor (LocalPageNameRevision, String, UUID) async throws -> LocalPageNameRevision) {
        self.request = request
        self.save = save
        _title = State(initialValue: request.originalTitle)
        _baseline = State(initialValue: LocalPageNameRevision(title: request.originalTitle, revision: request.originalRevision))
    }
    private var dirty: Bool { !title.utf8.elementsEqual(baseline.title.utf8) }
    private var valid: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && title.utf8.count <= 512 && !title.utf8.contains(0) && !title.contains("\n") && !title.contains("\r") }
    var body: some View {
        NavigationStack {
            Form {
                if request.copy.isLocalCopy { Text("Changes stay in this independent local copy.") }
                else { Text("The new name is saved to your Worlds workspace.") }
                TextField("Page title", text: $title)
                    .disabled(busy || uncertain)
                    .accessibilityIdentifier("rename-personal-page-title")
                if dirty && !uncertain {
                    Button("Reset draft") { title = baseline.title; message = nil }
                        .disabled(busy).accessibilityIdentifier("rename-reset-draft")
                }
                if let previousName, !dirty && !uncertain {
                    Button("Restore previous name") { Task { await commit(previousName, restoring: true) } }
                        .disabled(busy).accessibilityIdentifier("rename-undo")
                }
                if let message { Text(message).accessibilityIdentifier("rename-status") }
                if busy { ProgressView("Saving name") }
            }
            .navigationTitle("Rename page")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { if dirty { confirmDiscard = true } else { dismiss() } }.disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await commit(title, restoring: false) } }
                        .disabled(busy || uncertain || !dirty || !valid).accessibilityIdentifier("rename-save")
                }
            }
            .confirmationDialog("Discard the unsaved name?", isPresented: $confirmDiscard) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            }
            .interactiveDismissDisabled(busy || dirty)
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 220)
        #endif
    }
    @MainActor private func commit(_ next: String, restoring: Bool) async {
        guard !busy, !uncertain else { return }
        let old = baseline
        busy = true
        defer { busy = false }
        do {
            let result = try await save(old, next, UUID())
            guard result.title.utf8.elementsEqual(next.utf8) else {
                uncertain = true
                message = request.copy.isLocalCopy ? "The saved name could not be verified. Close and reopen the copy to check." : String(localized: "The saved name could not be verified. Open the workspace again to check.")
                return
            }
            baseline = result
            title = result.title
            previousName = restoring ? nil : old.title
            message = restoring ? "Previous name restored." : "Name saved."
        } catch NativeWriteError.conflict {
            message = request.copy.isLocalCopy ? "The page changed. Keep this draft, then close and reopen the copy to review the current name." : String(localized: "The page changed. Keep this draft, then open the workspace again to review the current name.")
            uncertain = true
        } catch {
            message = request.copy.isLocalCopy ? "The result could not be confirmed. The name may have been saved. Close and reopen the copy to check." : String(localized: "The result could not be confirmed. The name may have been saved. Open the workspace again to check.")
            uncertain = true
        }
    }
}
#endif
