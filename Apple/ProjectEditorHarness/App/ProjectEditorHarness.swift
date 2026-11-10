import SwiftUI
import SQLite3
import WorldsNativeWrites
import WorldsResourceRepositories
import WorldsProjectEditingViews
import WorldsLocalImport

/// Test-only executable. It opens a fresh synthetic source and imports into a
/// unique temporary root. It never offers access to a user's database.
@main
struct ProjectEditorHarness: App {
    var body: some Scene { WindowGroup { HarnessView() } }
}
private struct HarnessView: View {
    @State private var repository: NativeResourceRepository?
    @State private var sourceDatabase: URL?
    @State private var privateRoot: URL?
    @State private var expectedSourceBytes: Data?
    @State private var error: String?
    @State private var editor = false
    @State private var importing = false
    @State private var originalUnchanged = false
    var body: some View {
        VStack(spacing: 16) {
            if let repository {
                if let error { Text(error) }
                Text("Independent local copy")
                Text("Changes stay in this copy. Attachments are not included, and changes do not sync to the original. The copy can contain shared records, but shared projects cannot be edited here.")
                Button("Open test project") { editor = true }
                    .sheet(isPresented: $editor) {
                        NavigationStack {
                            ProjectDraftView(projectID: "harness-project", repository: repository) { verifySource() }
                        }
                    }
                if originalUnchanged { Text("Original unchanged").accessibilityIdentifier("harness-original-unchanged") }
            } else if let error { Text(error) }
            else if importing { ProgressView("Importing test copy") }
            else if sourceDatabase != nil { Button("Import test copy") { Task { await importFixture() } } }
            else { ProgressView("Preparing test database") }
        }
        .padding()
        .task { prepareSource() }
    }
    @MainActor private func prepareSource() {
        guard sourceDatabase == nil else { return }
        do {
            guard let source = Bundle.main.url(forResource: "worlds-v11", withExtension: "db") else { throw HarnessError.fixture }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
            let database = directory.appendingPathComponent("source.db")
            try FileManager.default.copyItem(at: source, to: database)
            var pointer: OpaquePointer?
            guard sqlite3_open(database.path, &pointer) == SQLITE_OK, let db = pointer else { throw HarnessError.fixture }
            let sql = #"INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('harness-project','Fixture project','project','{"project":{"status":"active","description":"Original fixture","links":[]},"unknown":{"preserve":true}}',1,100);"#
            let status = sqlite3_exec(db, sql, nil, nil, nil)
            sqlite3_close(db)
            guard status == SQLITE_OK else { throw HarnessError.fixture }
            expectedSourceBytes = try Data(contentsOf: database)
            sourceDatabase = database
            privateRoot = directory.appendingPathComponent("private", isDirectory: true)
        } catch { self.error = error.localizedDescription }
    }
    @MainActor private func importFixture() async {
        guard let sourceDatabase, let privateRoot, !importing else { return }
        importing = true; defer { importing = false }
        do {
            #if DEBUG
            let importer = try LocalProjectImportCoordinator.isolatedTestCoordinator(root: privateRoot, backup: NativeSQLiteBackup())
            let copy = try await importer.importCopy(from: sourceDatabase)
            repository = NativeResourceRepository(store: try NativePersonalStore(url: copy.databaseURL))
            #else
            throw HarnessError.fixture
            #endif
        } catch { self.error = error.localizedDescription }
    }
    @MainActor private func verifySource() {
        guard let sourceDatabase, let expectedSourceBytes else { error = "Source check failed"; return }
        do {
            guard try Data(contentsOf: sourceDatabase) == expectedSourceBytes else { error = "Source changed unexpectedly"; return }
            originalUnchanged = true
        } catch { self.error = "Source check failed" }
    }
}
private enum HarnessError: LocalizedError {
    case fixture
    var errorDescription: String? { "The isolated fixture could not be prepared." }
}
