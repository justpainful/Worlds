#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_CREATE_PAGE
import SwiftUI
import WorldsLocalImport
import WorldsNativeWrites
import WorldsModels

struct LocalCreatePageRequest: Identifiable {
    let id = UUID()
    let operationID = UUID()
    let copy: LocalProjectCopy
    let databaseIdentity: VideoDatabaseIdentity
    let parentID: String?
    let generation: UUID
}

/// Experimental personal page creation in an independent copy. A response
/// failure can happen after commit, so the same request is never retried here.
struct LocalCreatePageView: View {
    @Environment(\.dismiss) private var dismiss
    let request: LocalCreatePageRequest
    let onCreated: @MainActor (String) async -> Bool
    @State private var title = ""
    @State private var busy = false
    @State private var submitted = false
    @State private var message: String?

    private var canCreate: Bool {
        !busy && !submitted && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        title.utf8.count <= 512 && !title.utf8.contains(0) && !title.contains("\n") && !title.contains("\r")
    }
    var body: some View {
        NavigationStack {
            Form {
                Text("This page is created in the independent local copy. It does not sync to the original.")
                if submitted {
                    Text(title).textSelection(.enabled)
                        .accessibilityIdentifier("new-personal-page-retained-title")
                } else {
                    TextField("Page title", text: $title)
                        .disabled(busy)
                        .accessibilityIdentifier("new-personal-page-title")
                }
                if let message { Text(message).accessibilityIdentifier("new-personal-page-status") }
                if busy { ProgressView("Creating page") }
            }
            .navigationTitle(request.parentID == nil ? "New page" : "New subpage")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { Task { await create() } }
                        .disabled(!canCreate).accessibilityIdentifier("create-personal-page")
                }
            }
            .interactiveDismissDisabled(busy)
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 220)
        #endif
    }

    @MainActor private func create() async {
        guard canCreate else { return }
        guard VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity else {
            submitted = true
            message = "The local copy changed before creation. Close and reopen the copy before trying again."
            return
        }
        busy = true; submitted = true
        defer { busy = false }
        do {
            let store = try NativePersonalStore(url: request.copy.databaseURL)
            let result = try await store.createPageIdempotent(title: title, parent: request.parentID, operationID: request.operationID)
            guard VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity,
                  case .object(let fields) = result, case .string(let pageID)? = fields["id"],
                  !pageID.isEmpty, !pageID.utf8.contains(0) else {
                message = "The creation result could not be verified. The page may have been created. Close and reopen the copy to check."
                return
            }
            if await onCreated(pageID) { dismiss() }
            else { message = "The page was created, but its display could not be refreshed. Close and reopen the copy to check." }
        } catch {
            message = "The creation result could not be confirmed. The page may have been created. Close and reopen the copy to check."
        }
    }
}
#endif
