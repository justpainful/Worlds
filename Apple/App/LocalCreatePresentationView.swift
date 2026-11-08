#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_CREATE_PRESENTATION && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
import SwiftUI
import WorldsLocalImport
import WorldsNativeWrites
import WorldsModels

struct LocalCreatePresentationRequest: Identifiable {
    let id = UUID()
    let operationID = UUID()
    let copy: LocalProjectCopy
    let databaseIdentity: VideoDatabaseIdentity
    let generation: UUID
}

/// Experimental personal presentation creation in an independent copy. A response
/// failure can happen after commit, so the same request is never retried here.
struct LocalCreatePresentationView: View {
    @Environment(\.dismiss) private var dismiss
    let request: LocalCreatePresentationRequest
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
                Text("The presentation is created in the independent local copy and does not sync to the original. Some slide features are not supported by this editor.")
                if submitted {
                    Text(title).textSelection(.enabled)
                        .accessibilityIdentifier("new-personal-presentation-retained-title")
                } else {
                    TextField("Presentation title", text: $title)
                        .disabled(busy)
                        .accessibilityIdentifier("new-personal-presentation-title")
                }
                if let message { Text(message).accessibilityIdentifier("new-personal-presentation-status") }
                if busy { ProgressView("Creating presentation") }
            }
            .navigationTitle("New presentation")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { if !submitted && !title.isEmpty { confirmDiscard = true } else { dismiss() } }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { Task { await create() } }
                        .disabled(!canCreate).accessibilityIdentifier("create-personal-presentation")
                }
            }
            .alert("Discard the presentation title?", isPresented: $confirmDiscard) {
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
            message = "The local copy changed before creation. Close and reopen the copy before trying again."
            return
        }
        busy = true; submitted = true
        defer { busy = false }
        do {
            let store = try NativePersonalStore(url: request.copy.databaseURL)
            let result = try await store.createPresentationIdempotent(title: title, operationID: request.operationID)
            guard VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity,
                  case .object(let fields) = result, case .string(let pageID)? = fields["id"],
                  !pageID.isEmpty, !pageID.utf8.contains(0) else {
                message = "The creation result could not be verified. The presentation may have been created. Close and reopen the copy to check."
                return
            }
            if await onCreated(pageID) { dismiss() }
            else { message = "The presentation was created, but its display could not be refreshed. Close and reopen the copy to check." }
        } catch {
            message = "The creation result could not be confirmed. The presentation may have been created. Close and reopen the copy to check."
        }
    }
}
#endif
