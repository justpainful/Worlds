import SwiftUI
import UniformTypeIdentifiers
import SQLite3
import Darwin
import WorldsFixtureBundleImport

@MainActor private final class FixtureModel: ObservableObject {
    @Published var selected: URL?
    @Published var message: String?
    @Published var busy = false
    @Published var succeeded = false
    private var root: URL?
    private var privateRoot: URL?
    private var initialDB: Data?
    private var fixtureSource: URL?

    func createFixture() throws {
        guard root == nil else { if let fixtureSource { selected = fixtureSource }; return }
        let temporaryRoot = FileManager.default.temporaryDirectory.appendingPathComponent("bundle-harness-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temporaryRoot, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        // Resolve the newly created fixture directory with POSIX realpath.
        // Foundation may retain the /var alias on macOS.
        guard let resolved = realpath(temporaryRoot.path, nil) else { throw FixtureBundleError.invalidPath }
        defer { free(resolved) }
        let canonicalPath = String(cString: resolved)
        let root = URL(fileURLWithPath: canonicalPath, isDirectory: true)
        guard root.path == canonicalPath else { throw FixtureBundleError.invalidPath }
        let source = root.appendingPathComponent("source", isDirectory: true), destination = root.appendingPathComponent("private", isDirectory: true)
        try FileManager.default.createDirectory(at: source.appendingPathComponent("attachments/sub", isDirectory: true), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        guard let fixture = Bundle.main.url(forResource: "worlds-v11", withExtension: "db") else { throw FixtureBundleError.invalidResult }
        let database = source.appendingPathComponent("worlds.db"); try FileManager.default.copyItem(at: fixture, to: database)
        var raw: OpaquePointer?
        guard sqlite3_open(database.path, &raw) == SQLITE_OK, let db = raw else { throw FixtureBundleError.invalidResult }
        let code = sqlite3_exec(db, "INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('bundle-a','fixture-page','file','a.bin','application/octet-stream',4,'sub/a.bin',1)", nil, nil, nil)
        sqlite3_close_v2(db); guard code == SQLITE_OK else { throw FixtureBundleError.invalidResult }
        try Data("safe".utf8).write(to: source.appendingPathComponent("attachments/sub/a.bin"))
        self.root = root; privateRoot = destination; fixtureSource = source; initialDB = try Data(contentsOf: database); selected = source
    }
    func selectFixture() { do { try createFixture(); message = nil } catch { message = "Fixture setup failed." } }
    func importSelected() async {
        guard !busy, let source = selected else { return }
        busy = true; defer { busy = false }
        do {
            if privateRoot == nil { try createFixture(); selected = source }
            guard let destination = privateRoot else { throw FixtureBundleError.invalidPath }
            let copy = try await FixtureBundleImporter().prepare(source: source, privateRoot: destination)
            guard source == fixtureSource, let initialDB,
                  try Data(contentsOf: source.appendingPathComponent("worlds.db")) == initialDB,
                  try Data(contentsOf: source.appendingPathComponent("attachments/sub/a.bin")) == Data("safe".utf8),
                  try Data(contentsOf: copy.deletingLastPathComponent().appendingPathComponent("attachments/sub/a.bin")) == Data("safe".utf8) else {
                message = "Unverified bundle created; fixture checks did not apply."; return
            }
            succeeded = true; message = "Fixture copied; source unchanged. Bundle remains unverified."
        } catch { message = "Fixture import failed: \(error)" }
    }
}

@main struct AttachmentBundleHarnessApp: App {
    @StateObject private var model = FixtureModel()
    @State private var choosing = false
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Temporary fixture import only. Source identity remains unverified; never use this bundle as production data.")
                    Button("Create and select fixture") { model.selectFixture() }.accessibilityIdentifier("bundle.fixture")
                    Button("Choose source folder") { choosing = true }.accessibilityIdentifier("bundle.choose")
                    if model.selected != nil { Text("Source folder selected").accessibilityIdentifier("bundle.selected") }
                    Button("Import fixture bundle") { Task { await model.importSelected() } }.disabled(model.selected == nil || model.busy).accessibilityIdentifier("bundle.import")
                    if let message = model.message { Text(message).accessibilityIdentifier("bundle.message") }
                    if model.succeeded { Text("Fixture checks passed").accessibilityIdentifier("bundle.success") }
                    Spacer()
                }.padding().navigationTitle("Attachment fixture")
            }
            .frame(minWidth: 520, minHeight: 360)
            .fileImporter(isPresented: $choosing, allowedContentTypes: [.folder]) { result in
                switch result { case .success(let url): model.selected = url; case .failure: model.message = "Folder selection failed." }
            }
        }
    }
}
