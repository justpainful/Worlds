#if WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_CREATE_STREAM
import SwiftUI
import WorldsLocalImport
import WorldsWorkspaceAccess
import WorldsNativeWrites
import WorldsModels

struct LocalCreateStreamRequest: Identifiable {
    let id = UUID()
    let operationID = UUID()
    let copy: WorkspaceWriteTarget
    let databaseIdentity: VideoDatabaseIdentity
    let generation: UUID
}

struct LocalCreateStreamView: View {
    @Environment(\.dismiss) private var dismiss
    let request: LocalCreateStreamRequest
    let onCreated: @MainActor (String, String) async -> Bool
    @State private var name = ""
    @State private var link = ""
    @State private var busy = false
    @State private var submitted = false
    @State private var message: String?
    @State private var confirmDiscard = false

    private var cleanLink: String { link.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var components: URLComponents? { URLComponents(string: cleanLink) }
    private var nameToSave: String {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !clean.isEmpty { return clean }
        let leaf = components?.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? ""
        return leaf.isEmpty ? "Stream" : leaf
    }
    private var valid: Bool {
        guard !busy, !submitted, cleanLink.utf8.count <= 65536,
              !cleanLink.utf8.contains(where: { $0 < 32 || $0 == 127 }),
              let parts = components, let scheme = parts.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = parts.host, !host.isEmpty else { return false }
        return nameToSave.utf8.count <= 512 && !nameToSave.utf8.contains(0) && !nameToSave.contains("\n") && !nameToSave.contains("\r")
    }
    private var hasDraft: Bool { !name.isEmpty || !link.isEmpty }
    var body: some View {
        NavigationStack {
            Form {
                if request.copy.isLocalCopy { Text("The link stays in this independent local copy. DASH playback is not supported.") }
                else { Text("The link is saved in your Worlds workspace. DASH playback is not supported.") }
                if submitted {
                    Text(nameToSave).textSelection(.enabled)
                    Text(cleanLink).textSelection(.enabled).environment(\.layoutDirection, .leftToRight)
                } else {
                    TextField("Link", text: $link).textContentType(.URL).autocorrectionDisabled()
                        .environment(\.layoutDirection, .leftToRight).disabled(busy)
                        .accessibilityIdentifier("new-personal-stream-url")
                    TextField("Name (optional)", text: $name).disabled(busy)
                        .accessibilityIdentifier("new-personal-stream-title")
                    if !link.isEmpty && !valid { Text("Enter an HTTP or HTTPS link and a name of at most 512 bytes.").foregroundStyle(.secondary) }
                }
                if let message { Text(message).accessibilityIdentifier("new-personal-stream-status") }
                if busy { ProgressView("Creating stream") }
            }
            .navigationTitle("New stream")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { if !submitted && hasDraft { confirmDiscard = true } else { dismiss() } }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button("Create") { Task { await create() } }.disabled(!valid).accessibilityIdentifier("create-personal-stream") }
            }
            .alert("Discard the stream details?", isPresented: $confirmDiscard) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            }
            .interactiveDismissDisabled(busy || (!submitted && hasDraft))
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 250)
        #endif
    }
    @MainActor private func create() async {
        guard valid else { return }
        guard VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity else {
            submitted = true; message = request.copy.isLocalCopy ? "The local copy changed before creation. Close and reopen the copy before trying again." : String(localized: "The workspace file changed before creation. Open it again before trying again."); return
        }
        let submittedTitle = nameToSave, submittedLink = cleanLink
        busy = true; submitted = true
        defer { busy = false }
        do {
            let store = try NativePersonalStore(url: request.copy.databaseURL)
            let result = try await store.createStreamIdempotent(title: submittedTitle, streamURL: submittedLink, operationID: request.operationID)
            guard VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity,
                  case .object(let fields) = result, case .string(let id)? = fields["id"], !id.isEmpty, !id.utf8.contains(0) else {
                message = request.copy.isLocalCopy ? "The result could not be verified. The stream may have been created. Close and reopen the copy to check." : String(localized: "The result could not be verified. It may have been created. Open the workspace again to check.")
                return
            }
            if await onCreated(id, submittedLink) { dismiss() }
            else { message = request.copy.isLocalCopy ? "The stream was created, but its display could not be refreshed. Close and reopen the copy to check." : String(localized: "It was created, but the list could not be refreshed. Open the workspace again to check.") }
        } catch {
            message = workspaceWriteMessage(error) ?? (request.copy.isLocalCopy ? "The result could not be confirmed. The stream may have been created. Close and reopen the copy to check." : String(localized: "The result could not be confirmed. It may have been created. Open the workspace again to check."))
        }
    }
}
#endif
