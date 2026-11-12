#if WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_CREATE_PROJECT
import SwiftUI
import WorldsLocalImport
import WorldsWorkspaceAccess
import WorldsNativeWrites
import WorldsModels

struct LocalCreateProjectRequest: Identifiable {
    let id = UUID()
    let operationID = UUID()
    let copy: WorkspaceWriteTarget
    let databaseIdentity: VideoDatabaseIdentity
    let generation: UUID
}

/// Experimental personal project creation in an independent copy. A response
/// failure can happen after commit, so the same request is never retried here.
struct LocalCreateProjectView: View {
    @Environment(\.dismiss) private var dismiss
    let request: LocalCreateProjectRequest
    let onCreated: @MainActor (String) async -> Bool
    @State private var title = ""
    @State private var busy = false
    @State private var submitted = false
    @State private var message: String?
    @State private var confirmDiscard = false

    private var canCreate: Bool {
        !busy && !submitted && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        title.utf8.count <= 512 && !title.utf8.contains(0) && !title.contains("\n") && !title.contains("\r")
    }
    var body: some View {
        NavigationStack {
            Form {
                if request.copy.isLocalCopy { Text("The project is created in the independent local copy and does not sync to the original.") }
                else { Text("The project is created in your Worlds workspace.") }
                if submitted {
                    Text(title).textSelection(.enabled)
                        .accessibilityIdentifier("new-personal-project-retained-title")
                } else {
                    TextField("Project title", text: $title)
                        .disabled(busy)
                        .accessibilityIdentifier("new-personal-project-title")
                }
                if let message { Text(message).accessibilityIdentifier("new-personal-project-status") }
                if busy { ProgressView("Creating project") }
            }
            .navigationTitle("New project")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { if !submitted && !title.isEmpty { confirmDiscard = true } else { dismiss() } }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { Task { await create() } }
                        .disabled(!canCreate).accessibilityIdentifier("create-personal-project")
                }
            }
            .alert("Discard the project title?", isPresented: $confirmDiscard) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            }
            .interactiveDismissDisabled(busy || (!submitted && !title.isEmpty))
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 220)
        #endif
    }

    @MainActor private func create() async {
        guard canCreate else { return }
        guard VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity else {
            submitted = true
            message = request.copy.isLocalCopy ? "The local copy changed before creation. Close and reopen the copy before trying again." : String(localized: "The workspace file changed before creation. Open it again before trying again.")
            return
        }
        busy = true; submitted = true
        defer { busy = false }
        do {
            let store = try NativePersonalStore(url: request.copy.databaseURL)
            let result = try await store.createProjectIdempotent(title: title, operationID: request.operationID)
            guard VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity,
                  case .object(let fields) = result, case .string(let pageID)? = fields["id"],
                  !pageID.isEmpty, !pageID.utf8.contains(0) else {
                message = request.copy.isLocalCopy ? "The creation result could not be verified. The project may have been created. Close and reopen the copy to check." : String(localized: "The result could not be verified. It may have been created. Open the workspace again to check.")
                return
            }
            if await onCreated(pageID) { dismiss() }
            else { message = request.copy.isLocalCopy ? "The project was created, but its display could not be refreshed. Close and reopen the copy to check." : String(localized: "It was created, but the list could not be refreshed. Open the workspace again to check.") }
        } catch {
            message = workspaceWriteMessage(error) ?? (request.copy.isLocalCopy ? "The creation result could not be confirmed. The project may have been created. Close and reopen the copy to check." : String(localized: "The result could not be confirmed. It may have been created. Open the workspace again to check."))
        }
    }
}
#endif
