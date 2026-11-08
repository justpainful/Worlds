#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
import SwiftUI
import WorldsPresentations
import WorldsPresentationPersistence
import SQLite3

@MainActor private final class PresentationEditorState: ObservableObject {
    @Published var slides: [SlideBlock] = []
    @Published var selectedID: String?
    @Published var selectedElementID: String?
    @Published var draft = ""
    @Published var error: String?
    @Published var busy = false
    @Published var saved = false
    @Published var reloadRequired = false
    @Published var fixtureMediaPresent = false
    private var session: PresentationSession?
    private var baseline: [SlideBlock] = []
    private var persistence: PresentationPersistence?
    let databaseURL: URL
    let pageID: String
    init(databaseURL: URL, pageID: String) { self.databaseURL = databaseURL; self.pageID = pageID }
    var selected: SlideBlock? { slides.first { $0.id == selectedID } }
    var textElements: [SlideElement] { selected?.elements.filter { $0.type == "text" && !$0.id.isEmpty && $0.text != nil } ?? [] }
    var currentElement: SlideElement? { textElements.first { $0.id == selectedElementID } }
    var hasUnapplied: Bool { currentElement != nil && draft != currentElement?.text }
    var dirty: Bool { hasUnapplied || slides != baseline }
    var canUndo: Bool { session?.canUndo == true }
    var canRedo: Bool { session?.canRedo == true }
    func open() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            let store = try await PresentationPersistence.open(databaseURL: databaseURL, pageID: pageID)
            let session = try PresentationSession(slides: store.initialSlides)
            persistence = store; self.session = session; slides = session.slides; baseline = slides
            selectedID = nil; selectedElementID = nil; draft = ""
            select(slides.first?.id); saved = false; fixtureMediaPresent = false; reloadRequired = false; error = nil
        } catch { self.error = "Could not open this presentation: \(error.localizedDescription)" }
    }
    func select(_ id: String?) {
        guard !hasUnapplied else { return }
        selectedElementID = nil; draft = ""; selectedID = id
        selectElement(textElements.first?.id)
    }
    func selectElement(_ id: String?) { guard !hasUnapplied else { return }; selectedElementID = id; draft = currentElement?.text ?? "" }
    func applyText() {
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), let currentElement else { return }
            try session.update(at: index) { try $0.setText(elementID: currentElement.id, text: draft) }
            self.session = session; slides = session.slides; saved = false; fixtureMediaPresent = false; error = nil
        } catch { self.error = "This text cannot be changed safely: \(error.localizedDescription)" }
    }
    func moveUp() {
        guard !hasUnapplied else { return }
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), index > 0 else { return }
            try session.move(from: index, to: index - 1); self.session = session; slides = session.slides; saved = false; fixtureMediaPresent = false
        } catch { self.error = error.localizedDescription }
    }
    func deleteSelected() {
        guard !hasUnapplied else { return }
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }) else { return }
            try session.remove(at: index)
            self.session = session; slides = session.slides; selectedID = nil; selectedElementID = nil; draft = ""
            select(slides[min(index, slides.count - 1)].id); saved = false; fixtureMediaPresent = false; error = nil
        } catch { self.error = "This slide cannot be removed: \(error.localizedDescription)" }
    }
    func undo() { changeHistory(redo: false) }
    func redo() { changeHistory(redo: true) }
    private func changeHistory(redo: Bool) {
        guard !hasUnapplied, var session else { return }
        if redo { session.redo() } else { session.undo() }
        self.session = session; slides = session.slides
        let nextID = slides.contains(where: { $0.id == selectedID }) ? selectedID : slides.first?.id
        selectedID = nil; selectedElementID = nil; draft = ""; select(nextID); saved = false; fixtureMediaPresent = false; error = nil
    }
    func save() async {
        guard !busy, !hasUnapplied, !reloadRequired, let session, let persistence else { return }
        busy = true; defer { busy = false }
        let deleted = Set(baseline.map(\.id)).subtracting(session.slides.map(\.id))
        do {
            try await persistence.save(slides: session.slides, deleting: deleted)
            baseline = session.slides; self.session = try PresentationSession(slides: session.slides); saved = true; error = nil
        }
        catch { reloadRequired = true; self.error = "Save could not be confirmed. Your draft remains here. Copy any text before reloading: \(error.localizedDescription)"; return }
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-presentation-fixture") {
            do {
                var pointer: OpaquePointer?
                guard sqlite3_open_v2(databaseURL.path, &pointer, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db = pointer else { throw PresentationPersistenceError.invalidResponse }
                defer { sqlite3_close_v2(db) }
                var statement: OpaquePointer?
                guard sqlite3_prepare_v2(db, "SELECT 1 FROM attachments WHERE id='slide-media' AND page_id='deck-test'", -1, &statement, nil) == SQLITE_OK, let statement else { throw PresentationPersistenceError.invalidResponse }
                defer { sqlite3_finalize(statement) }
                fixtureMediaPresent = sqlite3_step(statement) == SQLITE_ROW
                if !fixtureMediaPresent { self.error = "Saved, but the fixture attachment record was not found." }
            } catch {
                self.error = "Saved, but the fixture attachment check failed: \(error.localizedDescription)"
            }
        }
    }
}
struct LocalPresentationEditor: View {
    @StateObject private var state: PresentationEditorState
    @Environment(\.dismiss) private var dismiss
    @State private var discard = false
    @State private var reload = false
    @State private var deleteSlide = false
    let onSaved: () -> Void
    init(databaseURL: URL, pageID: String, onSaved: @escaping () -> Void) {
        _state = StateObject(wrappedValue: PresentationEditorState(databaseURL: databaseURL, pageID: pageID)); self.onSaved = onSaved
    }
    var body: some View {
        NavigationStack {
            List {
                Text("This edits a local copy. Media and unsupported elements are kept but cannot be edited here.")
                if let error = state.error { Text(error).accessibilityIdentifier("presentation-edit-error") }
                if state.slides.isEmpty && !state.busy { Text("No editable slides are available.") }
                ForEach(Array(state.slides.enumerated()), id: \.element.id) { index, slide in
                    Button("Slide \(index + 1)") { state.select(slide.id) }
                        .accessibilityIdentifier("presentation-slide.\(slide.id)").disabled(state.hasUnapplied)
                }
                if state.textElements.count > 1 {
                    ForEach(Array(state.textElements.enumerated()), id: \.offset) { _, element in
                        Button(element.text ?? "Text") { state.selectElement(element.id) }.disabled(state.hasUnapplied)
                    }
                }
                if state.currentElement != nil {
                    TextField("Slide text", text: $state.draft, axis: .vertical).accessibilityIdentifier("presentation-text")
                    Button("Apply text") { state.applyText() }.disabled(!state.hasUnapplied)
                }
                if let selected = state.selected, selected.elements.contains(where: { $0.type != "text" }) {
                    Text("This slide contains elements that cannot be edited here.").accessibilityIdentifier("presentation-unsupported-elements")
                }
                Button("Move slide up") { state.moveUp() }.disabled(state.hasUnapplied || state.slides.first?.id == state.selectedID)
                Button("Delete slide", role: .destructive) { deleteSlide = true }
                    .accessibilityIdentifier("presentation-delete-slide")
                    .disabled(state.hasUnapplied || state.slides.count <= 1)
                HStack {
                    Button("Undo") { state.undo() }.disabled(state.hasUnapplied || !state.canUndo)
                    Button("Redo") { state.redo() }.disabled(state.hasUnapplied || !state.canRedo)
                }
                if state.reloadRequired { Button("Reload saved presentation") { reload = true }.accessibilityIdentifier("presentation-reload") }
                if state.saved { Text("Presentation saved").accessibilityIdentifier("presentation-edit-saved") }
                if state.fixtureMediaPresent { Text("Fixture attachment record retained").accessibilityIdentifier("presentation-media-record-retained") }
            }
            .navigationTitle("Edit presentation")
            .disabled(state.busy)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { if state.dirty { discard = true } else { dismiss() } }.disabled(state.busy) }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await state.save(); if state.saved { onSaved() } } }.disabled(state.busy || !state.dirty || state.hasUnapplied || state.reloadRequired) }
            }
            .confirmationDialog("Discard unsaved changes?", isPresented: $discard) { Button("Discard", role: .destructive) { dismiss() }; Button("Cancel", role: .cancel) {} }
            .confirmationDialog("Discard changes and reload?", isPresented: $reload) { Button("Discard and reload", role: .destructive) { Task { await state.open() } }; Button("Cancel", role: .cancel) {} }
            .alert("Delete this slide?", isPresented: $deleteSlide) {
                Button("Delete slide", role: .destructive) { state.deleteSelected() }.accessibilityIdentifier("presentation-confirm-delete")
                Button("Cancel", role: .cancel) {}
            } message: { Text("The slide and its placements will be removed when you save. Attachment files are not deleted.") }
            .interactiveDismissDisabled(state.dirty || state.busy)
            .task { await state.open() }
        }
    }
}
#endif
