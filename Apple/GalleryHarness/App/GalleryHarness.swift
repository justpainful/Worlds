import SwiftUI
import SQLite3
import WorldsGallery
import WorldsModels
import WorldsNativeWrites
import WorldsResourceRepositories

/// Test-only host: it operates only on a generated temporary fixture.
@main struct GalleryHarnessApp: App {
    var body: some Scene { WindowGroup { GalleryHarnessView() } }
}

@MainActor private final class GalleryHarnessState: ObservableObject {
    @Published var items: [GalleryItem] = []
    @Published var error: String?
    @Published var ready = false
    @Published var busy = false
    @Published var sourceUnchanged = false
    @Published var unknownPreserved = false
    @Published var reopened = false
    @Published var draft: GalleryDraftSession?
    @Published var captionDraft = ""
    @Published var draftItemID: String?
    @Published var draftSaveUnconfirmed = false
    @Published var draftRequiresReload = false
    @Published var draftSaved = false
    var currentDraftItem: GalleryItem? { draft?.document.items.first { $0.id == draftItemID } }
    var editableDraftCaption: String? { guard let draft, let id = draftItemID else { return nil }; return draft.document.editableCaption(itemID: id) }
    var captionPending: Bool { editableDraftCaption != nil && captionDraft != editableDraftCaption }
    func beginDraft() {
        guard !busy, !draftRequiresReload, let snapshot else { return }
        do {
            draft = try GalleryDraftSession(snapshot: snapshot)
            draftItemID = draft?.document.items.first?.id; captionDraft = editableDraftCaption ?? ""
            draftSaveUnconfirmed = false; draftSaved = false; error = nil
        } catch { self.error = error.localizedDescription }
    }
    func selectDraftItem(_ id: String) { guard !captionPending else { return }; draftItemID = id; captionDraft = editableDraftCaption ?? "" }
    func applyDraftCaption() {
        guard var draft, let id = draftItemID else { return }
        do { try draft.setCaption(itemID: id, text: captionDraft); self.draft = draft; draftSaved = false; error = nil }
        catch { self.error = "This caption cannot be changed safely." }
    }
    func moveDraftUp(_ index: Int) {
        guard !captionPending, var draft, index > 0 else { return }
        do { try draft.move(from: index, to: index - 1); self.draft = draft; draftSaved = false; error = nil }
        catch { self.error = "This order cannot be changed safely." }
    }
    func undoDraft(redo: Bool) {
        guard !captionPending, var draft else { return }
        if redo { draft.redo() } else { draft.undo() }
        self.draft = draft; draftSaved = false; captionDraft = editableDraftCaption ?? ""
    }
    func saveDraft() async {
        guard !busy, !captionPending, !draftSaveUnconfirmed, let draft, draft.dirty, let repository else { return }
        busy = true; defer { busy = false }
        do {
            let saved = try await draft.commit(to: repository)
            self.draft = try GalleryDraftSession(snapshot: saved); snapshot = saved
            items = self.draft?.document.items ?? []; captionDraft = editableDraftCaption ?? ""
            draftSaved = true; error = nil; reopened = false
            do { try await reload() } catch { self.error = "Saved, but the fixture checks could not be refreshed." }
        } catch {
            draftSaveUnconfirmed = true; draftRequiresReload = true
            self.error = "Save could not be confirmed. The draft is retained. Copy any needed text before discarding and reopening."
        }
    }
    func discardDraft() { draft = nil; draftItemID = nil; captionDraft = ""; draftSaveUnconfirmed = false; draftSaved = false }

    private var source: URL?
    private var sourceBytes: Data?
    private var directory: URL?
    private var copyURL: URL?
    private var repository: NativeResourceRepository?
    private var snapshot: GallerySnapshot?
    private let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=")!

    func prepare() async {
        guard !ready, !busy else { return }; busy = true; defer { busy = false }
        do {
            guard let fixture = Bundle.main.url(forResource: "worlds-v11", withExtension: "db") else { throw HarnessError.fixture }
            let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
            let original = root.appendingPathComponent("source.db")
            try FileManager.default.copyItem(at: fixture, to: original)
            var pointer: OpaquePointer?
            guard sqlite3_open(original.path, &pointer) == SQLITE_OK, let db = pointer else { throw HarnessError.fixture }
            let sql = #"""
            INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('gallery-test','Gallery','gallery','{"gallery":{"view":"grid"},"unknown":{"keep":true}}',1,100);
            INSERT INTO blocks(id,page_id,type,sort_key,content,created_at,updated_at) VALUES('opaque','gallery-test','future',1,'{"type":"future","attrs":{"bid":"opaque","preserve":true}}',1,1);
            INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('a','gallery-test','image','First.png','image/png',68,'First.png',1),('b','gallery-test','image','Second.png','image/png',68,'Second.png',1),('missing','gallery-test','image','Missing.png','image/png',68,'Missing.png',1);
            """#
            let status = sqlite3_exec(db, sql, nil, nil, nil); sqlite3_close_v2(db)
            guard status == SQLITE_OK else { throw HarnessError.fixture }
            source = original; sourceBytes = try Data(contentsOf: original); directory = root
            try png.write(to: root.appendingPathComponent("First.png")); try png.write(to: root.appendingPathComponent("Second.png"))
            let copy = root.appendingPathComponent("copy.db"); try FileManager.default.copyItem(at: original, to: copy); copyURL = copy
            repository = NativeResourceRepository(store: try NativePersonalStore(url: copy))
            try await reload(); ready = true
        } catch { self.error = error.localizedDescription }
    }
    func reload() async throws {
        guard let repository else { throw HarnessError.fixture }
        let next = try await repository.readAuthorizedGallery(id: "gallery-test")
        let document = try GalleryDocument(blocks: next.blocks, metadata: next.metadata)
        let opaque: JSONValue = .object(["type": .string("future"), "attrs": .object(["bid": .string("opaque"), "preserve": .bool(true)])])
        unknownPreserved = next.blocks.contains { block in
            guard case .object(let object) = block else { return false }
            return object["id"] == .string("opaque") && object["content"] == opaque
        }
        snapshot = next; items = document.items
        if let source, let sourceBytes { sourceUnchanged = try Data(contentsOf: source) == sourceBytes }
    }
    func add(id: String, name: String) async {
        guard let root = directory, let repository, let snapshot, !busy else { return }
        busy = true; defer { busy = false }
        do {
            let url = root.appendingPathComponent(name)
            guard FileManager.default.fileExists(atPath: url.path) else { throw HarnessError.missingAttachment }
            let data = try Data(contentsOf: url)
            let attachment = GalleryAttachment(id: id, fileName: name, mime: "image/png", size: Int64(data.count), kind: "image")
            _ = try await GalleryService(repository: repository).apply(galleryID: "gallery-test", expectedRevision: snapshot.revision, change: .add(attachment))
            try await reload(); error = nil
        } catch { self.error = error.localizedDescription }
    }
    func moveUp(_ index: Int) async {
        guard index > 0, let repository, let snapshot, !busy else { return }
        busy = true; defer { busy = false }
        do {
            _ = try await GalleryService(repository: repository).apply(galleryID: "gallery-test", expectedRevision: snapshot.revision, change: .move(from: index, to: index - 1))
            try await reload(); error = nil
        } catch { self.error = error.localizedDescription }
    }
    func reopen() async {
        guard !busy else { return }; busy = true; reopened = false; defer { busy = false }
        do {
            guard let copyURL else { throw HarnessError.fixture }
            repository = NativeResourceRepository(store: try NativePersonalStore(url: copyURL))
            try await reload(); error = nil; draftRequiresReload = false; reopened = true
        } catch { self.error = error.localizedDescription }
    }
}
private enum HarnessError: LocalizedError {
    case fixture, missingAttachment
    var errorDescription: String? { switch self { case .fixture: return "The isolated fixture is unavailable."; case .missingAttachment: return "Attachment file is missing. Nothing was added." } }
}
private struct GalleryHarnessView: View {
    @StateObject private var state = GalleryHarnessState()
    @State private var confirmDiscard = false
    var body: some View {
        NavigationStack {
            List {
                Text("Isolated gallery fixture. Files and edits stay in this temporary copy.")
                if let error = state.error { Text(error).accessibilityIdentifier("gallery-error") }
                if state.ready {
                    if let draft = state.draft {
                        Text("Changes stay in this temporary draft until saved.")
                        if state.draftSaved && !draft.dirty && !state.captionPending { Text("Gallery draft saved").accessibilityIdentifier("gallery-draft-saved") }
                        ForEach(Array(draft.document.items.enumerated()), id: \.element.id) { index, item in
                            HStack {
                                Button(item.name) { state.selectDraftItem(item.id) }.disabled(state.captionPending).accessibilityIdentifier("gallery-draft-item.\(item.attachmentID)")
                                if index > 0 { Button("Move up") { state.moveDraftUp(index) }.disabled(state.captionPending || state.draftSaveUnconfirmed).accessibilityIdentifier("gallery-draft-move.\(item.attachmentID)") }
                            }
                        }
                        if state.currentDraftItem != nil {
                            if state.editableDraftCaption != nil {
                                TextField("Caption", text: $state.captionDraft).accessibilityIdentifier("gallery-draft-caption")
                                Button("Apply caption") { state.applyDraftCaption() }.disabled(!state.captionPending || state.draftSaveUnconfirmed)
                            } else { Text("This caption cannot be edited safely.") }
                        }
                        Button("Undo draft") { state.undoDraft(redo: false) }.disabled(state.captionPending || !draft.canUndo || state.draftSaveUnconfirmed)
                        Button("Redo draft") { state.undoDraft(redo: true) }.disabled(state.captionPending || !draft.canRedo || state.draftSaveUnconfirmed)
                        Button("Save draft") { Task { await state.saveDraft() } }.disabled(state.captionPending || !draft.dirty || state.draftSaveUnconfirmed)
                            .accessibilityIdentifier("gallery-save-draft")
                        Button(draft.dirty || state.captionPending ? "Discard draft" : "Close draft") {
                            if draft.dirty || state.captionPending { confirmDiscard = true } else { state.discardDraft() }
                        }.accessibilityIdentifier("gallery-close-draft")
                    } else {
                        Button("Edit gallery draft") { state.beginDraft() }.disabled(state.draftRequiresReload).accessibilityIdentifier("gallery-begin-draft")
                        if state.draftRequiresReload { Text("Reopen the gallery before starting another draft.") }
                    }
                    Group {
                    Button("Add First.png") { Task { await state.add(id: "a", name: "First.png") } }
                    Button("Add Second.png") { Task { await state.add(id: "b", name: "Second.png") } }
                    Button("Add Missing.png") { Task { await state.add(id: "missing", name: "Missing.png") } }
                    ForEach(Array(state.items.enumerated()), id: \.element.id) { index, item in
                        HStack {
                            Text(item.name).accessibilityIdentifier("gallery-item.\(item.attachmentID)")
                            Spacer()
                            if index > 0 { Button("Move up") { Task { await state.moveUp(index) } }.accessibilityIdentifier("gallery-move.\(item.attachmentID)") }
                        }
                    }
                    if state.unknownPreserved { Text("Unknown block preserved").accessibilityIdentifier("gallery-unknown-preserved") }
                    if state.sourceUnchanged { Text("Original unchanged").accessibilityIdentifier("gallery-source-unchanged") }
                    if state.reopened { Text("Gallery reopened").accessibilityIdentifier("gallery-reopened") }
                    Button("Reopen gallery") { Task { await state.reopen() } }
                    }.disabled(state.draft != nil)
                } else { Button("Prepare fixture") { Task { await state.prepare() } } }
            }.disabled(state.busy).navigationTitle("Gallery test")
                .confirmationDialog("Discard unsaved gallery changes?", isPresented: $confirmDiscard) {
                    Button("Discard", role: .destructive) { state.discardDraft() }
                    Button("Cancel", role: .cancel) { }
                }
        }
    }
}
