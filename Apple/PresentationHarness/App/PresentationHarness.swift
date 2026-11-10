import SwiftUI
import SQLite3
import WorldsPresentations
import WorldsPresentationPersistence
import WorldsModels

@main struct PresentationHarnessApp: App {
    var body: some Scene { WindowGroup { PresentationHarnessView() } }
}
@MainActor private final class DeckState: ObservableObject {
    @Published var slides: [SlideBlock] = []
    @Published var selectedID: String?
    @Published var draft = ""
    @Published var error: String?
    @Published var saved = false
    @Published var sourceUnchanged = false
    @Published var unknownPreserved = false
    @Published var busy = false
    private var session: PresentationSession?
    private var store: PresentationPersistence?
    private var database: URL?
    private var original: URL?
    private var originalBytes: Data?
    var selected: SlideBlock? { slides.first { $0.id == selectedID } }
    var textElement: SlideElement? { selected?.elements.first { $0.type == "text" } }
    var hasUnappliedText: Bool { textElement != nil && draft != textElement?.text }
    func prepare() async {
        guard !busy, database == nil else { return }; busy = true; defer { busy = false }
        do {
            guard let fixture = Bundle.main.url(forResource: "worlds-v11", withExtension: "db") else { throw DeckError.fixture }
            let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
            let source = root.appendingPathComponent("source.db"); try FileManager.default.copyItem(at: fixture, to: source)
            var ptr: OpaquePointer?
            guard sqlite3_open(source.path, &ptr) == SQLITE_OK, let db = ptr else { throw DeckError.fixture }
            let sql = #"""
            INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('deck-test','Deck','presentation','{"keep":true}',1,100);
            INSERT INTO blocks(id,page_id,type,sort_key,content,created_at,updated_at) VALUES
            ('slide-a','deck-test','slide',1,'{"type":"slide","attrs":{"bid":"slide-a","notes":"first","elements":[{"id":"title-a","type":"text","text":"First slide","x":30,"y":40,"w":400,"h":100,"rot":0,"opacity":1,"style":{"fontSize":32},"future":"keep"},{"id":"opaque-element","type":"futureElement","data":{"keep":true}}]}}',1,1),
            ('opaque','deck-test','future',2,'{"type":"future","attrs":{"bid":"opaque","keep":true}}',1,1),
            ('slide-b','deck-test','slide',3,'{"type":"slide","attrs":{"bid":"slide-b","notes":"second","elements":[{"id":"title-b","type":"text","text":"Second slide","x":30,"y":40,"w":400,"h":100,"rot":0,"opacity":1,"style":{"fontSize":32}}]}}',1,1);
            """#
            let status = sqlite3_exec(db, sql, nil, nil, nil); sqlite3_close_v2(db)
            guard status == SQLITE_OK else { throw DeckError.fixture }
            original = source; originalBytes = try Data(contentsOf: source)
            let copy = root.appendingPathComponent("copy.db"); try FileManager.default.copyItem(at: source, to: copy)
            database = copy; try await reopen()
        } catch { self.error = error.localizedDescription }
    }
    func reopen() async throws {
        guard let database else { throw DeckError.fixture }
        let opened = try await PresentationPersistence.open(databaseURL: database, pageID: "deck-test")
        let next = try PresentationSession(slides: opened.initialSlides)
        store = opened; session = next; slides = next.slides; select(next.slides.first?.id); saved = false
        if let original, let originalBytes { sourceUnchanged = try Data(contentsOf: original) == originalBytes }
        let expected: JSONValue = .object(["id": .string("opaque-element"), "type": .string("futureElement"), "data": .object(["keep": .bool(true)])])
        let elementKept = next.slides.first(where: { $0.id == "slide-a" })?.elements.contains(where: { $0.source == expected }) == true
        var pointer: OpaquePointer?
        guard sqlite3_open_v2(database.path, &pointer, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db = pointer else { throw DeckError.fixture }
        defer { sqlite3_close_v2(db) }
        var query: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT count(*) FROM blocks WHERE id='opaque' AND json_extract(content,'$.attrs.keep')=1", -1, &query, nil) == SQLITE_OK, let query else { throw DeckError.fixture }
        defer { sqlite3_finalize(query) }
        unknownPreserved = elementKept && sqlite3_step(query) == SQLITE_ROW && sqlite3_column_int(query, 0) == 1
    }
    func select(_ id: String?) { selectedID = id; draft = textElement?.text ?? "" }
    func applyText() {
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), let element = textElement else { throw DeckError.unsupported }
            try session.update(at: index) { try $0.setText(elementID: element.id, text: draft) }
            self.session = session; slides = session.slides; saved = false; sourceUnchanged = false; unknownPreserved = false; error = nil
        } catch { self.error = error.localizedDescription }
    }
    func moveUp() {
        do {
            guard var session, let index = session.slides.firstIndex(where: { $0.id == selectedID }), index > 0 else { throw DeckError.unsupported }
            try session.move(from: index, to: index - 1); self.session = session; slides = session.slides; saved = false; sourceUnchanged = false; unknownPreserved = false; error = nil
        } catch { self.error = error.localizedDescription }
    }
    func save() async {
        guard let session, let store, !busy else { return }; busy = true; sourceUnchanged = false; unknownPreserved = false; defer { busy = false }
        do { try await store.save(slides: session.slides); saved = true; error = nil }
        catch { self.error = "The save could not be confirmed. The draft remains open: \(error.localizedDescription)" }
    }
    func reload() async { guard !busy else { return }; busy = true; defer { busy = false }; do { try await reopen(); error = nil } catch { self.error = error.localizedDescription } }
}
private enum DeckError: LocalizedError { case fixture, unsupported; var errorDescription: String? { "The requested isolated slide operation is unavailable." } }
private struct PresentationHarnessView: View {
    @StateObject private var state = DeckState()
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Isolated presentation copy. Unsupported media and elements cannot be edited here.")
                    if state.slides.isEmpty { Button("Prepare presentation") { Task { await state.prepare() } } }
                    else {
                        ForEach(Array(state.slides.enumerated()), id: \.element.id) { index, slide in
                            Button("Slide \(index + 1): \(slide.id)") { state.select(slide.id) }.accessibilityIdentifier("slide.\(slide.id)").disabled(state.hasUnappliedText)
                        }
                        if state.textElement != nil {
                            TextField("Slide text", text: $state.draft).accessibilityIdentifier("slide-text")
                            Button("Apply text") { state.applyText() }
                        }
                        Button("Move slide up") { state.moveUp() }.disabled(state.hasUnappliedText || state.slides.first?.id == state.selectedID)
                        Button("Save presentation") { Task { await state.save() } }.disabled(state.hasUnappliedText)
                        Button("Reopen presentation") { Task { await state.reload() } }.disabled(state.hasUnappliedText || !state.saved)
                        if state.saved { Text("Presentation saved").accessibilityIdentifier("presentation-saved") }
                        if state.sourceUnchanged { Text("Original unchanged").accessibilityIdentifier("presentation-source-unchanged") }
                        if state.unknownPreserved { Text("Unsupported content preserved").accessibilityIdentifier("presentation-opaque-preserved") }
                    }
                    if let error = state.error { Text(error).accessibilityIdentifier("presentation-error") }
                }.frame(maxWidth: .infinity, alignment: .leading).padding()
            }.disabled(state.busy).navigationTitle("Presentation test")
        }
    }
}
