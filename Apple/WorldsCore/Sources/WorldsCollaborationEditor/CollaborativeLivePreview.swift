import SwiftUI
import WorldsCollaboration
import WorldsRichText

/// Read-only experimental projection. It never mutates an editor or its draft.
/// Each signal rechecks the session before displaying data.
@MainActor public final class CollaborativeLivePreviewModel: ObservableObject {
    @Published public private(set) var document: RichTextDocument?
    @Published public private(set) var unavailable = true
    private var generation = UUID()
    public init() {}
    public func observe(_ session: CollaborationSession) async {
        let id = UUID(); generation = id
        let changes = await session.editorChanges()
        for await _ in changes {
            guard !Task.isCancelled, generation == id else { break }
            do {
                let snapshot = try await session.plainEditorSnapshot()
                let next = try RichTextDocument(json: snapshot.json)
                guard !Task.isCancelled, generation == id else { break }
                document = next; unavailable = false
            } catch {
                guard generation == id else { break }
                document = nil; unavailable = true
            }
        }
        if generation == id { document = nil; unavailable = true }
    }
}

/// Host owns session lifecycle and must not treat this preview as an editor.
public struct CollaborativeLivePreview: View {
    @StateObject private var model = CollaborativeLivePreviewModel()
    private let session: CollaborationSession
    public init(session: CollaborationSession) { self.session = session }
    public var body: some View {
        ScrollView {
            if let document = model.document {
                Text(document.project().text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .accessibilityIdentifier("collaboration-live-document")
            } else {
                Text("The shared document is unavailable or contains unsupported content.")
                    .foregroundStyle(.secondary)
            }
        }
        .task { await model.observe(session) }
    }
}
