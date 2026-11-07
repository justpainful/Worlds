#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY
import Foundation
import SQLite3
import WorldsLocalImport

/// Synthetic test data only. This path never accesses Application Support or a user database.
enum LocalCopyUITestFixture {
    static func make() throws -> (LocalProjectImportCoordinator, URL) {
        guard let fixture = Bundle.main.url(forResource: "worlds-v11", withExtension: "db") else { throw CocoaError(.fileNoSuchFile) }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        let source = root.appendingPathComponent("source.db")
        try FileManager.default.copyItem(at: fixture, to: source)
        var connection: OpaquePointer?
        guard sqlite3_open(source.path, &connection) == SQLITE_OK, let database = connection else {
            if let connection { sqlite3_close(connection) }
            throw CocoaError(.fileReadUnknown)
        }
        defer { sqlite3_close(database) }
        let sql = #"INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('harness-project','Fixture project','project','{"project":{"status":"active","description":"Original fixture","links":[]},"unknown":{"preserve":true}}',1,100);"#
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-duplicate-links") {
            let update = #"UPDATE pages SET metadata=json_set(metadata,'$.project.links',json('["fixture-page","fixture-page"]')) WHERE id='harness-project';"#
            guard sqlite3_exec(database, update, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-unavailable-link") {
            let update = #"UPDATE pages SET metadata=json_set(metadata,'$.project.links',json('["missing-fixture"]')) WHERE id='harness-project';"#
            guard sqlite3_exec(database, update, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        }
        let importer = try LocalProjectImportCoordinator.isolatedTestCoordinator(root: root.appendingPathComponent("private", isDirectory: true), backup: NativeSQLiteBackup())
        return (importer, source)
    }
}
#endif
