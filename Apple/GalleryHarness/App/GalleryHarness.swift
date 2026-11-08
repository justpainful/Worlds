import SwiftUI
import SQLite3
import WorldsGallery
import WorldsModels
import WorldsMedia
import WorldsMediaViews
import WorldsNativeWrites
import WorldsResourceRepositories

/// Test-only host: it operates only on a generated temporary fixture.
@main struct GalleryHarnessApp: App {
    var body: some Scene {
        WindowGroup {
            GalleryHarnessView().environment(\.layoutDirection, ProcessInfo.processInfo.arguments.contains("--test-rtl") ? .rightToLeft : .leftToRight)
        }
    }
}

private struct GalleryPreviewRequest: Identifiable {
    let id = UUID()
    let attachment: WorldsAttachment
    let file: AttachmentFile
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
    @Published var preview: GalleryPreviewRequest?
    @Published var afterOpenMutationPerformed = false
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
    private let firstPNG = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAaUlEQVR4nNXOMREAIBDAsFJ1LPhXgA9E/MA1CrLuPpRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMT5OzD1AF04Adqq4CNxAAAAAElFTkSuQmCC")!
    private let secondPNG = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAZklEQVR4nNXOQREAIAzAsK7+HzgGETx2jYIM51ImcRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRLnduDXA1OUAe8Zs0PeAAAAAElFTkSuQmCC")!

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
            INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('a','gallery-test','image','First.png','image/png',162,'First.png',1),('b','gallery-test','image','Second.png','image/png',159,'Second.png',1),('missing','gallery-test','image','Missing.png','image/png',68,'Missing.png',1);
            """#
            let status = sqlite3_exec(db, sql, nil, nil, nil); sqlite3_close_v2(db)
            guard status == SQLITE_OK else { throw HarnessError.fixture }
            source = original; sourceBytes = try Data(contentsOf: original); directory = root
            try firstPNG.write(to: root.appendingPathComponent("First.png")); try secondPNG.write(to: root.appendingPathComponent("Second.png"))
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
    /// Fixture-only authorization. The snapshot check is not an ongoing ACL lease.
    func openImage(_ item: GalleryItem) async {
        guard !busy, draft == nil, preview == nil, let repository, let snapshot, let copyURL, let root = directory else { return }
        busy = true; defer { busy = false }
        do {
            let fresh = try await repository.readAuthorizedGallery(id: "gallery-test")
            guard fresh == snapshot, try GalleryDocument(blocks: fresh.blocks, metadata: fresh.metadata).items.contains(item),
                  item.mime == "image/png", item.size >= 0, item.size <= 64 * 1024 * 1024 else { throw HarnessError.invalidImage }
            var pointer: OpaquePointer?
            guard sqlite3_open_v2(copyURL.path, &pointer, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let db = pointer else {
                if let pointer { sqlite3_close_v2(pointer) }; throw HarnessError.invalidImage
            }
            defer { sqlite3_close_v2(db) }
            var raw: OpaquePointer?
            let sql = "SELECT file_name, mime, kind, size, rel_path, created_at FROM attachments WHERE id=?1 AND page_id=?2"
            guard sqlite3_prepare_v2(db, sql, -1, &raw, nil) == SQLITE_OK, let statement = raw else { throw HarnessError.invalidImage }
            defer { sqlite3_finalize(statement) }
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            guard sqlite3_bind_text(statement, 1, item.attachmentID, -1, transient) == SQLITE_OK,
                  sqlite3_bind_text(statement, 2, "gallery-test", -1, transient) == SQLITE_OK,
                  sqlite3_step(statement) == SQLITE_ROW,
                  [0, 1, 2, 4].allSatisfy({ sqlite3_column_type(statement, Int32($0)) == SQLITE_TEXT }),
                  sqlite3_column_type(statement, 3) == SQLITE_INTEGER, sqlite3_column_type(statement, 5) == SQLITE_INTEGER,
                  let name = sqlite3_column_text(statement, 0), let mime = sqlite3_column_text(statement, 1),
                  let kind = sqlite3_column_text(statement, 2), let path = sqlite3_column_text(statement, 4) else { throw HarnessError.invalidImage }
            let size = sqlite3_column_int64(statement, 3)
            let attachment = WorldsAttachment(id: item.attachmentID, pageId: "gallery-test", kind: String(cString: kind),
                fileName: String(cString: name), mime: String(cString: mime), size: size, relPath: String(cString: path),
                width: nil, height: nil, createdAt: sqlite3_column_int64(statement, 5))
            guard attachment.fileName == item.name, attachment.mime == item.mime, attachment.kind == item.kind,
                  attachment.size == item.size, sqlite3_step(statement) == SQLITE_DONE else { throw HarnessError.invalidImage }
            let file = try AttachmentVault(root: root).open(attachment, maxSize: 64 * 1024 * 1024)
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-gallery-after-open-record-change") {
                var writer: OpaquePointer?
                guard sqlite3_open_v2(copyURL.path, &writer, SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let writer else {
                    if let writer { sqlite3_close_v2(writer) }; throw HarnessError.invalidImage
                }
                let result = sqlite3_exec(writer, "UPDATE attachments SET size=size+1 WHERE id='a'", nil, nil, nil)
                let count = sqlite3_changes(writer); sqlite3_close_v2(writer)
                guard result == SQLITE_OK, count == 1 else { throw HarnessError.invalidImage }
                afterOpenMutationPerformed = true
            }
            guard file.size == attachment.size, try await repository.readAuthorizedGallery(id: "gallery-test") == fresh,
                  sqlite3_reset(statement) == SQLITE_OK, sqlite3_step(statement) == SQLITE_ROW,
                  [0, 1, 2, 4].allSatisfy({ sqlite3_column_type(statement, Int32($0)) == SQLITE_TEXT }),
                  sqlite3_column_type(statement, 3) == SQLITE_INTEGER, sqlite3_column_type(statement, 5) == SQLITE_INTEGER,
                  let checkedName = sqlite3_column_text(statement, 0), let checkedMime = sqlite3_column_text(statement, 1),
                  let checkedKind = sqlite3_column_text(statement, 2), let checkedPath = sqlite3_column_text(statement, 4),
                  String(cString: checkedName) == attachment.fileName, String(cString: checkedMime) == attachment.mime,
                  String(cString: checkedKind) == attachment.kind, String(cString: checkedPath) == attachment.relPath,
                  sqlite3_column_int64(statement, 3) == attachment.size, sqlite3_column_int64(statement, 5) == attachment.createdAt,
                  sqlite3_step(statement) == SQLITE_DONE else { throw HarnessError.invalidImage }
            preview = GalleryPreviewRequest(attachment: attachment, file: file); error = nil
        } catch { self.error = "The fixture image could not be opened safely." }
    }
    func alterFixtureAttachment(owner: Bool) {
        guard !busy, let copyURL, ProcessInfo.processInfo.arguments.contains("--ui-testing-gallery-record-failure") else { return }
        var pointer: OpaquePointer?
        guard sqlite3_open_v2(copyURL.path, &pointer, SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let db = pointer else {
            if let pointer { sqlite3_close_v2(pointer) }; error = "The fixture record could not be changed."; return
        }
        defer { sqlite3_close_v2(db) }
        let sql = owner ? "UPDATE attachments SET page_id='fixture-page' WHERE id='a'" : "UPDATE attachments SET size=size+1 WHERE id='a'"
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK, sqlite3_changes(db) == 1 else { error = "The fixture record could not be changed."; return }
        error = nil
    }
    func removeFixtureImage() {
        guard !busy, let root = directory, ProcessInfo.processInfo.arguments.contains("--ui-testing-gallery-preview-failure") else { return }
        do { try FileManager.default.removeItem(at: root.appendingPathComponent("First.png")); error = nil }
        catch { self.error = "The fixture file could not be removed." }
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
    case fixture, missingAttachment, invalidImage
    var errorDescription: String? { switch self { case .fixture: return "The isolated fixture is unavailable."; case .missingAttachment: return "Attachment file is missing. Nothing was added."; case .invalidImage: return "The fixture image is unavailable." } }
}
private struct GalleryHarnessView: View {
    @StateObject private var state = GalleryHarnessState()
    @State private var confirmDiscard = false
    var body: some View {
        NavigationStack {
            List {
                Text("Isolated gallery fixture. Files and edits stay in this temporary copy.")
                if let error = state.error { Text(error).accessibilityIdentifier("gallery-error") }
                if state.afterOpenMutationPerformed { Text("Fixture changed after open").accessibilityIdentifier("gallery-after-open-mutation") }
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
                    if ProcessInfo.processInfo.arguments.contains("--ui-testing-gallery-record-failure") {
                        Button("Change fixture owner") { state.alterFixtureAttachment(owner: true) }.accessibilityIdentifier("gallery-change-fixture-owner")
                        Button("Change fixture size") { state.alterFixtureAttachment(owner: false) }.accessibilityIdentifier("gallery-change-fixture-size")
                    }
                    if ProcessInfo.processInfo.arguments.contains("--ui-testing-gallery-preview-failure") {
                        Button("Remove fixture image") { state.removeFixtureImage() }.accessibilityIdentifier("gallery-remove-fixture-image")
                    }
                    ForEach(Array(state.items.enumerated()), id: \.element.id) { index, item in
                        HStack {
                            Text(item.name).accessibilityIdentifier("gallery-item.\(item.attachmentID)")
                            if item.isImage {
                                Button("View image") { Task { await state.openImage(item) } }
                                    .accessibilityIdentifier("gallery-preview.\(item.attachmentID)")
                            }
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
                .sheet(item: $state.preview) { request in
                    OpenedDocumentPreviewView(attachment: request.attachment, openedFile: request.file)
                }
                .confirmationDialog("Discard unsaved gallery changes?", isPresented: $confirmDiscard) {
                    Button("Discard", role: .destructive) { state.discardDraft() }
                    Button("Cancel", role: .cancel) { }
                }
        }
    }
}
