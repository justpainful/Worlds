#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
import SwiftUI
import SQLite3

/// Caller supplies the identity captured when opening the independent copy.
/// The renderer rejects unsupported documents before allowing drawing.
struct LocalDrawingEditor: View {
    let databaseURL: URL
    let pageID: String
    let identity: VideoDatabaseIdentity
    let onClosed: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var actorID: String?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if let actorID {
                    DrawingHarnessView(databaseURL: databaseURL, pageID: pageID, actorID: actorID,
                        validateIdentity: { VideoDatabaseIdentity.read(databaseURL) == identity }, onClose: { onClosed(); dismiss() })
                } else if let error {
                    VStack(spacing: 12) {
                        Text(error).accessibilityIdentifier("drawing-open-error")
                        Button("Close") { onClosed(); dismiss() }
                    }.padding()
                } else { ProgressView("Opening drawing") }
            }.navigationTitle("Drawing")
        }.interactiveDismissDisabled(true)
            .task { open() }
    }
    @MainActor private func open() {
        guard actorID == nil, error == nil else { return }
        do {
            guard VideoDatabaseIdentity.read(databaseURL) == identity else { throw DrawingOpenError.changed }
            var pointer: OpaquePointer?
            guard sqlite3_open_v2(databaseURL.path, &pointer, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
                  let db = pointer else { if let pointer { sqlite3_close_v2(pointer) }; throw DrawingOpenError.unavailable }
            defer { sqlite3_close_v2(db) }
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(db, "SELECT id FROM profile LIMIT 2", -1, &statement, nil) == SQLITE_OK,
                  let statement else { throw DrawingOpenError.unavailable }
            defer { sqlite3_finalize(statement) }
            guard sqlite3_step(statement) == SQLITE_ROW, let raw = sqlite3_column_text(statement, 0) else { throw DrawingOpenError.missingProfile }
            let actor = String(cString: raw)
            guard !actor.isEmpty, sqlite3_step(statement) == SQLITE_DONE else { throw DrawingOpenError.missingProfile }
            guard VideoDatabaseIdentity.read(databaseURL) == identity else { throw DrawingOpenError.changed }
            actorID = actor
        } catch {
            self.error = "This drawing cannot be opened safely. Check the local copy and its profile."
        }
    }
    private enum DrawingOpenError: Error { case changed, unavailable, missingProfile }
}
#endif
