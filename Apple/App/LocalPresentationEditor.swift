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
    @Published var notesDraft = ""
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
    var hasTextUnapplied: Bool { currentElement != nil && draft != currentElement?.text }
    var hasNotesUnapplied: Bool { selected?.editableNotes != nil && notesDraft != selected?.editableNotes }
    var hasUnapplied: Bool { hasTextUnapplied || hasNotesUnapplied }
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
        notesDraft = selected?.editableNotes ?? ""
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
    static let fontSizes: [Int] = [14, 18, 20, 24, 28, 32, 40, 48, 56, 64, 76, 96, 120]
    func changeFontSize(larger: Bool) {
        guard !hasUnapplied else { return }
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), let element = currentElement, let size = element.editableFontSize else { return }
            let candidate = larger ? Self.fontSizes.first(where: { Double($0) > size }) : Self.fontSizes.last(where: { Double($0) < size })
            guard let candidate else { return }
            try session.update(at: index) { try $0.setTextStyle(elementID: element.id, key: "fontSize", value: .integer(Int64(candidate))) }
            self.session = session; slides = session.slides; saved = false; fixtureMediaPresent = false; error = nil
        } catch { self.error = "This font size cannot be changed safely: \(error.localizedDescription)" }
    }
    func toggleTextItalic() {
        guard !hasUnapplied else { return }
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), let element = currentElement, let italic = element.editableItalic else { return }
            try session.update(at: index) { try $0.setTextStyle(elementID: element.id, key: "italic", value: .bool(!italic)) }
            self.session = session; slides = session.slides; saved = false; fixtureMediaPresent = false; error = nil
        } catch { self.error = "Italic cannot be changed safely: \(error.localizedDescription)" }
    }
    func toggleTextBold() {
        guard !hasUnapplied else { return }
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), let element = currentElement, let weight = element.editableFontWeight else { return }
            let nextWeight: Int64 = weight >= 700 ? 500 : 700
            try session.update(at: index) { try $0.setTextStyle(elementID: element.id, key: "fontWeight", value: .integer(nextWeight)) }
            self.session = session; slides = session.slides; saved = false; fixtureMediaPresent = false; error = nil
        } catch { self.error = "This font weight cannot be changed safely: \(error.localizedDescription)" }
    }
    func setTextAlignment(_ alignment: String) {
        guard !hasUnapplied else { return }
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), let element = currentElement, element.editableTextAlignment != nil else { return }
            try session.update(at: index) { try $0.setTextStyle(elementID: element.id, key: "align", value: .string(alignment)) }
            self.session = session; slides = session.slides; saved = false; fixtureMediaPresent = false; error = nil
        } catch { self.error = "This alignment cannot be changed safely: \(error.localizedDescription)" }
    }
    func applyNotes() {
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), session.slides[index].editableNotes != nil else { return }
            try session.update(at: index) { try $0.setNotes(notesDraft) }
            self.session = session; slides = session.slides; saved = false; fixtureMediaPresent = false; error = nil
        } catch { self.error = "These notes cannot be changed safely: \(error.localizedDescription)" }
    }
    func addBlankSlide() { insertSlide(duplicate: false) }
    func duplicateSelectedSlide() { insertSlide(duplicate: true) }
    private func insertSlide(duplicate: Bool) {
        guard !hasUnapplied else { return }
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }) else { return }
            let slide: SlideBlock
            if duplicate { slide = try session.slides[index].duplicated() }
            else { slide = try SlideBlock.blank() }
            try session.insert(slide, at: index + 1)
            self.session = session; slides = session.slides
            selectedID = nil; selectedElementID = nil; draft = ""; select(slide.id)
            saved = false; fixtureMediaPresent = false; error = nil
        } catch {
            self.error = duplicate ? "This slide cannot be duplicated safely because it contains unsupported fields or elements." : "The slide could not be added: \(error.localizedDescription)"
        }
    }
    func moveDown() {
        guard !hasUnapplied else { return }
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), index + 1 < session.slides.count else { return }
            try session.move(from: index, to: index + 1); self.session = session; slides = session.slides; saved = false; fixtureMediaPresent = false
        } catch { self.error = error.localizedDescription }
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
                Text("\(state.slides.count) slides").accessibilityIdentifier("presentation-slide-count")
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
                    Button("Apply text") { state.applyText() }.disabled(!state.hasTextUnapplied)
                }
                if let element = state.currentElement {
                    if let size = element.editableFontSize {
                        VStack(alignment: .leading) {
                            Button("Smaller text") { state.changeFontSize(larger: false) }
                                .accessibilityIdentifier("presentation-text-smaller")
                                .disabled(state.hasUnapplied || !PresentationEditorState.fontSizes.contains(where: { Double($0) < size }))
                            Text(size.formatted()).accessibilityIdentifier("presentation-font-size")
                            Button("Larger text") { state.changeFontSize(larger: true) }
                                .accessibilityIdentifier("presentation-text-larger")
                                .disabled(state.hasUnapplied || !PresentationEditorState.fontSizes.contains(where: { Double($0) > size }))
                        }
                    } else {
                        Text("This font size cannot be edited safely.")
                    }
                    if let italic = element.editableItalic {
                        Button { state.toggleTextItalic() } label: { Label(italic ? "Italic: On" : "Italic: Off", systemImage: "italic") }
                            .accessibilityLabel("Italic text")
                            .disabled(state.hasUnapplied)
                            .accessibilityIdentifier("presentation-text-italic")
                            .accessibilityValue(italic ? "On" : "Off")
                    } else {
                        Text("This italic setting cannot be edited safely.")
                    }
                    if let weight = element.editableFontWeight {
                        Button { state.toggleTextBold() } label: { Label(weight >= 700 ? "Bold: On" : "Bold: Off", systemImage: "bold") }
                            .accessibilityLabel("Bold text")
                            .disabled(state.hasUnapplied)
                            .accessibilityIdentifier("presentation-text-bold")
                            .accessibilityValue(weight >= 700 ? "On" : "Off")
                    } else {
                        Text("This font weight cannot be edited safely.")
                    }
                    if let alignment = element.editableTextAlignment {
                        Picker("Text alignment", selection: Binding(get: { alignment }, set: { state.setTextAlignment($0) })) {
                            Text("Left").tag("left")
                            Text("Center").tag("center")
                            Text("Right").tag("right")
                        }
                        .disabled(state.hasUnapplied).accessibilityIdentifier("presentation-text-alignment")
                    } else {
                        Text("This text alignment cannot be edited safely.")
                    }
                }
                if let notes = state.selected?.editableNotes {
                    TextField("Speaker notes", text: $state.notesDraft, axis: .vertical).accessibilityIdentifier("presentation-notes")
                    Button("Apply notes") { state.applyNotes() }
                        .disabled(state.notesDraft == notes).accessibilityIdentifier("presentation-apply-notes")
                } else if state.selected != nil {
                    Text("These speaker notes cannot be edited safely.").accessibilityIdentifier("presentation-notes-unsupported")
                }
                if let selected = state.selected, selected.elements.contains(where: { $0.type != "text" }) {
                    Text("This slide contains elements that cannot be edited here.").accessibilityIdentifier("presentation-unsupported-elements")
                }
                Button("Add blank slide") { state.addBlankSlide() }.disabled(state.hasUnapplied || state.selected == nil).accessibilityIdentifier("presentation-add-blank")
                Button("Duplicate slide") { state.duplicateSelectedSlide() }.disabled(state.hasUnapplied || state.selected == nil).accessibilityIdentifier("presentation-duplicate-slide")
                Button("Move slide down") { state.moveDown() }.disabled(state.hasUnapplied || state.slides.last?.id == state.selectedID).accessibilityIdentifier("presentation-move-down")
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
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 480)
        #endif
    }
}
#endif
