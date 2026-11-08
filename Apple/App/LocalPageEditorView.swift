#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PAGE_EDITOR
import SwiftUI
import WorldsEditorPersistence
import WorldsNativeEditor
import WorldsNativeWrites
import SQLite3
import WorldsModels

/// Available only in the isolated integration build; never points at the source database.
struct LocalPageEditorView: View {
    let databaseURL: URL
    let pageID: String
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var model: NativeEditorModel?
    @State private var persistence: PersonalEditorPersistence?
    @State private var error: String?
    @State private var saved = false
    @State private var discard = false
    @State private var reload = false
    @State private var reloadRequired = false
    @State private var injectedConflict = false
    var body: some View {
        NavigationStack {
            Group {
                if let model {
                    LocalPageEditorContent(model: model, error: error, saved: saved, reloadRequired: reloadRequired,
                        onSave: { Task { await save() } }, onReload: { reload = true }, onClose: { if model.hasUnresolvedInput { discard = true } else { dismiss() } })
                } else if let error { ContentUnavailableView("Page could not be opened", systemImage: "exclamationmark.triangle", description: Text(error)) }
                else { ProgressView("Opening page") }
            }
            .navigationTitle("Edit local page")
            .toolbar {
                if model == nil { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            }
            .alert("Discard unsaved edits?", isPresented: $discard) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Cancel", role: .cancel) {}
            }
            .alert("Reload the saved page and discard this draft?", isPresented: $reload) {
                Button("Discard draft and reload", role: .destructive) { Task { await open() } }
                Button("Keep editing", role: .cancel) {}
            } message: { Text("Copy any text you need before reloading. Unsupported content remains in the saved page.") }
            .task { await open() }
        }
    }
    @MainActor private func open() async {
        model = nil; persistence = nil; error = nil
        do {
            let store = try await PersonalEditorPersistence.open(databaseURL: databaseURL, pageID: pageID)
            persistence = store
            model = NativeEditorModel(document: store.initialDocument, baseRevision: store.initialRevision)
            reloadRequired = false; saved = false; error = nil
            if !injectedConflict, ProcessInfo.processInfo.arguments.contains("--ui-testing-local-copy-fixture"),
               ProcessInfo.processInfo.arguments.contains("--ui-testing-page-conflict") {
                var pointer: OpaquePointer?
                guard sqlite3_open(databaseURL.path, &pointer) == SQLITE_OK, let db = pointer else { throw EditorBridgeError.unavailable }
                let status = sqlite3_exec(db, "UPDATE pages SET updated_at=updated_at+1 WHERE id='fixture-page'", nil, nil, nil)
                sqlite3_close_v2(db)
                guard status == SQLITE_OK else { throw EditorBridgeError.unavailable }
                injectedConflict = true
            }
        } catch { self.error = error.localizedDescription }
    }
    @MainActor private func save() async {
        guard let model, let persistence, !model.nativeEditPending, model.recoverableNativeText == nil else { return }
        do { try await model.save(using: persistence); saved = !model.dirty; error = nil; onSaved() }
        catch {
            reloadRequired = true
            if let writeError = error as? NativeWriteError, case .conflict = writeError {
                self.error = "This page changed elsewhere. Your draft remains here; copy it before reloading."
            } else if let bridgeError = error as? EditorBridgeError, case .invalidBlock = bridgeError {
                self.error = "This edit cannot be saved without changing protected content. Your draft remains here."
                reloadRequired = false
            } else {
                self.error = "The save could not be confirmed. Your draft remains here; copy it before reloading. \(error.localizedDescription)"
            }
        }
    }
}
private struct LocalPageEditorContent: View {
    @ObservedObject var model: NativeEditorModel
    let error: String?
    let saved: Bool
    let reloadRequired: Bool
    let onSave: () -> Void
    let onReload: () -> Void
    let onClose: () -> Void
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 12) {
            Text("Edits apply only to this local copy. Some content and input methods cannot be edited safely.").font(.body)
            NativeEditorView(model: model).frame(maxWidth: .infinity, minHeight: 240)
            if let error { Text(error).accessibilityLabel(error).accessibilityIdentifier("local-page-error") }
            if reloadRequired { Button("Reload saved page", action: onReload).accessibilityIdentifier("local-page-reload") }
            if saved && !model.dirty { Text("Page saved").accessibilityIdentifier("local-page-saved") }
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-link-fixture") {
                let spans = model.projection.spans
                let expected = JSONValue.object(["type": .string("link"), "attrs": .object(["href": .string("https://example.com")])])
                if !spans.isEmpty && spans.allSatisfy({ $0.marks.contains(expected) }) { Text("Fixture link covers text").accessibilityIdentifier("fixture-link-covered") }
                if !spans.isEmpty && spans.allSatisfy({ !$0.marks.contains(expected) }) { Text("Fixture link absent").accessibilityIdentifier("fixture-link-absent") }
            }
        }.padding() }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Close", action: onClose).disabled(model.saving || model.nativeEditPending) }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save", action: onSave).disabled(reloadRequired || !model.dirty || model.saving || model.nativeEditPending || model.recoverableNativeText != nil)
            }
        }
        .interactiveDismissDisabled(model.hasUnresolvedInput)
    }
}
#endif
