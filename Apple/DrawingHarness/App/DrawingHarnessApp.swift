import SwiftUI
import SQLite3

@main struct DrawingHarnessApp: App {
    var body: some Scene { WindowGroup { DrawingFixtureHost() } }
}
private struct DrawingFixtureHost: View {
    @State private var database: URL?
    @State private var error: String?
    var body: some View {
        Group {
            if let database {
                DrawingHarnessView(databaseURL: database, pageID: "fixture-page", actorID: "artist", fixtureMode: true, validateIdentity: { true })
            } else if let error { Text(error) }
            else { ProgressView("Preparing isolated drawing") }
        }.task { prepare() }
    }
    private func prepare() {
        guard database == nil, error == nil else { return }
        do {
            guard let fixture = Bundle.main.url(forResource: "worlds-v11", withExtension: "db") else { throw CocoaError(.fileNoSuchFile) }
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("drawing-harness-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            let copy = root.appendingPathComponent("copy.db"); try FileManager.default.copyItem(at: fixture, to: copy)
            var connection: OpaquePointer?
            guard sqlite3_open(copy.path, &connection) == SQLITE_OK, let db = connection else { throw CocoaError(.fileReadUnknown) }
            let result = sqlite3_exec(db, "UPDATE pages SET kind='drawing' WHERE id='fixture-page'; INSERT INTO profile(id,display_name,created_at,updated_at) VALUES('artist','Artist',1,1);", nil, nil, nil)
            sqlite3_close_v2(db)
            guard result == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
            database = copy.resolvingSymlinksInPath()
        } catch { self.error = "Cannot prepare isolated drawing fixture." }
    }
}
