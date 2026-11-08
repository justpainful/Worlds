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
    var elementReorderPending: Bool {
        slides.contains { slide in
            guard let original = baseline.first(where: { $0.id == slide.id }) else { return false }
            return slide.elements.map(\.id) != original.elements.map(\.id)
        }
    }
    func canReorderText(forward: Bool) -> Bool {
        guard !dirty, let slide = selected, let element = currentElement else { return false }
        var candidate = slide
        do { try candidate.movePlainTextElement(elementID: element.id, forward: forward); return true } catch { return false }
    }
    func reorderText(forward: Bool) {
        guard canReorderText(forward: forward) else { return }
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), let element = currentElement else { return }
            try session.update(at: index) { try $0.movePlainTextElement(elementID: element.id, forward: forward) }
            self.session = session; slides = session.slides; saved = false; fixtureMediaPresent = false; error = nil
        } catch { self.error = "This element order cannot be changed safely: \(error.localizedDescription)" }
    }
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
    func rotateText(clockwise: Bool) {
        guard !hasUnapplied else { return }
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), let element = currentElement, element.editableRotation != nil else { return }
            try session.update(at: index) { try $0.rotateText(elementID: element.id, degrees: clockwise ? 1 : -1) }
            self.session = session; slides = session.slides; saved = false; fixtureMediaPresent = false; error = nil
        } catch { self.error = "This rotation cannot be changed safely: \(error.localizedDescription)" }
    }
    func moveText(dx: Double, dy: Double) {
        guard !hasUnapplied else { return }
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), let element = currentElement, element.editablePosition != nil else { return }
            try session.update(at: index) { try $0.moveText(elementID: element.id, dx: dx, dy: dy) }
            self.session = session; slides = session.slides; saved = false; fixtureMediaPresent = false; error = nil
        } catch { self.error = "This text position cannot be changed safely: \(error.localizedDescription)" }
    }
    static let backgroundColors = ["#16161a", "#0f172a", "#1b1f1d", "#2a1a1f", "#f7f5f0", "#ffffff", "#1d3557", "#3a2e5a", "#7c2d12", "#14532d"]
    func setBackgroundColor(_ color: String) {
        guard !hasUnapplied, Self.backgroundColors.contains(color) else { return }
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), let current = session.slides[index].editableBackgroundColor, current.lowercased() != color else { return }
            try session.update(at: index) { try $0.setBackgroundColor(color) }
            self.session = session; slides = session.slides; saved = false; fixtureMediaPresent = false; error = nil
        } catch { self.error = "This background cannot be changed safely: \(error.localizedDescription)" }
    }
    static let textColors = ["#f4f2ee", "#16161a", "#d2a46e", "#e5484d", "#f76b15", "#ffc53d", "#46a758", "#0090ff", "#8e4ec6", "#d6409f", "#8b8d98"]
    func setTextColor(_ color: String) {
        guard !hasUnapplied, Self.textColors.contains(color) else { return }
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), let element = currentElement, let current = element.editableTextColor, current.lowercased() != color else { return }
            try session.update(at: index) { try $0.setTextStyle(elementID: element.id, key: "color", value: .string(color)) }
            self.session = session; slides = session.slides; saved = false; fixtureMediaPresent = false; error = nil
        } catch { self.error = "This text color cannot be changed safely: \(error.localizedDescription)" }
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
    func chooseFontSize(_ size: Int) {
        guard !hasUnapplied, Self.fontSizes.contains(size) else { return }
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), let element = currentElement, let current = element.editableFontSize, current != Double(size) else { return }
            try session.update(at: index) { try $0.setTextStyle(elementID: element.id, key: "fontSize", value: .integer(Int64(size))) }
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
    @State private var previewExpanded = false
    let onSaved: () -> Void
    init(databaseURL: URL, pageID: String, onSaved: @escaping () -> Void) {
        _state = StateObject(wrappedValue: PresentationEditorState(databaseURL: databaseURL, pageID: pageID)); self.onSaved = onSaved
    }
    private func swatchColor(_ hex: String) -> Color {
        let rgb = UInt32(hex.dropFirst(), radix: 16) ?? 0
        return Color(red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
    }
    var body: some View {
        NavigationStack {
            List {
                Text("This edits a local copy. Media and unsupported elements are kept but cannot be edited here.")
                if let error = state.error { Text(error).accessibilityIdentifier("presentation-edit-error") }
                if state.saved && !state.dirty { Text("Presentation saved").accessibilityIdentifier("presentation-edit-saved") }
                if state.fixtureMediaPresent { Text("Fixture attachment record retained").accessibilityIdentifier("presentation-media-record-retained") }
                if state.slides.isEmpty && !state.busy { Text("No editable slides are available.") }
                Text("\(state.slides.count) slides").accessibilityIdentifier("presentation-slide-count")
                Group {
                ForEach(Array(state.slides.enumerated()), id: \.element.id) { index, slide in
                    Button("Slide \(index + 1)") { state.select(slide.id) }
                        .accessibilityIdentifier("presentation-slide.\(slide.id)").disabled(state.hasUnapplied)
                }
                if let slide = state.selected {
                    DisclosureGroup("Partial slide preview", isExpanded: $previewExpanded) {
                        Text("Images and video are unavailable. Some formatting may differ and unsupported elements may be omitted. Apply text changes to update this preview.")
                            .font(.caption).accessibilityIdentifier("presentation-preview-limitations")
                        NativeSlideView(slide: slide)
                            .frame(maxWidth: 720)
                            .accessibilityIdentifier("presentation-partial-preview")
                    }.accessibilityIdentifier("presentation-preview-toggle")
                }
                if let slide = state.selected {
                    if let color = slide.editableBackgroundColor {
                        Menu("Background color: \(color)") {
                            ForEach(PresentationEditorState.backgroundColors, id: \.self) { candidate in
                                Button { state.setBackgroundColor(candidate) } label: {
                                    Label { Text(candidate) } icon: { Circle().fill(swatchColor(candidate)) }
                                }.accessibilityIdentifier("presentation-background-color.\(candidate)")
                            }
                        }
                        .disabled(state.hasUnapplied).accessibilityIdentifier("presentation-background-color-menu")
                    } else {
                        Text("This background contains an image or unsupported data and cannot be edited here.")
                    }
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
                    if let rotation = element.editableRotation {
                        Text("Rotation: \(rotation.formatted())°").accessibilityIdentifier("presentation-text-rotation")
                        Button("Rotate text counterclockwise") { state.rotateText(clockwise: false) }
                            .disabled(state.hasUnapplied || rotation < -999_999).accessibilityIdentifier("presentation-text-rotate-left")
                        Button("Rotate text clockwise") { state.rotateText(clockwise: true) }
                            .disabled(state.hasUnapplied || rotation > 999_999).accessibilityIdentifier("presentation-text-rotate-right")
                        Text("A full slide preview is not available here.").font(.caption)
                    } else {
                        Text("This rotation cannot be edited safely.")
                    }
                    if let position = element.editablePosition {
                        Text("Position: \(position.x.formatted()), \(position.y.formatted())").accessibilityIdentifier("presentation-text-position")
                        Text("Position uses slide coordinates. A full slide preview is not available here.").font(.caption)
                        Button("Move text left") { state.moveText(dx: -1, dy: 0) }.disabled(state.hasUnapplied).accessibilityIdentifier("presentation-text-left")
                        Button("Move text right") { state.moveText(dx: 1, dy: 0) }.disabled(state.hasUnapplied).accessibilityIdentifier("presentation-text-right")
                        Button("Move text up") { state.moveText(dx: 0, dy: -1) }.disabled(state.hasUnapplied).accessibilityIdentifier("presentation-text-up")
                        Button("Move text down") { state.moveText(dx: 0, dy: 1) }.disabled(state.hasUnapplied).accessibilityIdentifier("presentation-text-down")
                    } else {
                        Text("This text position cannot be edited safely.")
                    }
                    if let color = element.editableTextColor {
                        Menu("Text color: \(color.isEmpty ? "Default" : color)") {
                            ForEach(PresentationEditorState.textColors, id: \.self) { candidate in
                                Button { state.setTextColor(candidate) } label: {
                                    Label { Text(candidate) } icon: { Circle().fill(swatchColor(candidate)) }
                                }.accessibilityIdentifier("presentation-text-color.\(candidate)")
                            }
                        }
                        .disabled(state.hasUnapplied).accessibilityIdentifier("presentation-text-color-menu")
                    } else {
                        Text("This text color cannot be edited safely.")
                    }
                    if let size = element.editableFontSize {
                        VStack(alignment: .leading) {
                            Button("Smaller text") { state.changeFontSize(larger: false) }
                                .accessibilityIdentifier("presentation-text-smaller")
                                .disabled(state.hasUnapplied || !PresentationEditorState.fontSizes.contains(where: { Double($0) < size }))
                            Text(size.formatted()).accessibilityIdentifier("presentation-font-size")
                            Menu("Choose font size") {
                                ForEach(PresentationEditorState.fontSizes, id: \.self) { candidate in
                                    Button {
                                        state.chooseFontSize(candidate)
                                    } label: {
                                        if Double(candidate) == size { Label(String(candidate), systemImage: "checkmark") }
                                        else { Text(String(candidate)) }
                                    }.accessibilityIdentifier("presentation-font-size-choice.\(candidate)")
                                }
                            }
                            .disabled(state.hasUnapplied).accessibilityIdentifier("presentation-font-size-menu")
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
                }
                .disabled(state.elementReorderPending)
                if state.elementReorderPending {
                    Text("Save or undo the element order before making other changes.")
                }
                Button("Bring text forward") { state.reorderText(forward: true) }
                    .disabled(!state.canReorderText(forward: true)).accessibilityIdentifier("presentation-element-forward")
                Button("Send text backward") { state.reorderText(forward: false) }
                    .disabled(!state.canReorderText(forward: false)).accessibilityIdentifier("presentation-element-backward")
                HStack {
                    Button("Undo") { state.undo() }.disabled(state.hasUnapplied || !state.canUndo)
                    Button("Redo") { state.redo() }.disabled(state.hasUnapplied || !state.canRedo)
                }
                if state.reloadRequired { Button("Reload saved presentation") { reload = true }.accessibilityIdentifier("presentation-reload") }
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
