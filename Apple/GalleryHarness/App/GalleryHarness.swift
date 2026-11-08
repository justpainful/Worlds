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
            try await reload(); error = nil; reopened = true
        } catch { self.error = error.localizedDescription }
    }
}
private enum HarnessError: LocalizedError {
    case fixture, missingAttachment
    var errorDescription: String? { switch self { case .fixture: return "The isolated fixture is unavailable."; case .missingAttachment: return "Attachment file is missing. Nothing was added." } }
}
private struct GalleryHarnessView: View {
    @StateObject private var state = GalleryHarnessState()
    var body: some View {
        NavigationStack {
            List {
                Text("Isolated gallery fixture. Files and edits stay in this temporary copy.")
                if let error = state.error { Text(error).accessibilityIdentifier("gallery-error") }
                if state.ready {
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
                } else { Button("Prepare fixture") { Task { await state.prepare() } } }
            }.disabled(state.busy).navigationTitle("Gallery test")
        }
    }
}
