import Foundation
import SQLite3
import XCTest
@testable import WorldsLocalImport

private struct FixtureBackup: LocalSQLiteBackup {
    let schemaVersion: Int
    let fail: Bool
    func importSnapshot(source: URL, privateRoot: URL) async throws -> URL {
        if fail { throw CancellationError() }
        let folder = privateRoot.appendingPathComponent("worlds-import-\(UUID().uuidString.lowercased())", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        let destination = folder.appendingPathComponent("worlds.db")
        try FileManager.default.copyItem(at: source, to: destination)
        var db: OpaquePointer?
        guard sqlite3_open(destination.path, &db) == SQLITE_OK, let db else { throw LocalImportError.invalidBackup }
        defer { sqlite3_close(db) }
        guard sqlite3_exec(db, "PRAGMA user_version=\(schemaVersion)", nil, nil, nil) == SQLITE_OK else {
            throw LocalImportError.invalidBackup
        }
        return destination
    }
}

final class LocalProjectImportTests: XCTestCase {
    private func fixture() throws -> (URL, URL) {
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("source.db")
        var db: OpaquePointer?
        guard sqlite3_open(source.path, &db) == SQLITE_OK, let db else { throw LocalImportError.invalidSource }
        defer { sqlite3_close(db) }
        let schema = """
        PRAGMA user_version=11;
        CREATE TABLE pages(id TEXT,kind TEXT,metadata TEXT,workspace_id TEXT,deleted_at INTEGER,updated_at INTEGER);
        CREATE TABLE blocks(id TEXT,page_id TEXT,content TEXT,sort_key TEXT);
        CREATE TABLE changes(page_id TEXT,kind TEXT,origin TEXT,at INTEGER);
        """
        guard sqlite3_exec(db, schema, nil, nil, nil) == SQLITE_OK else { throw LocalImportError.invalidSource }
        return (source, root.appendingPathComponent("private", isDirectory: true))
    }

    func testIndependentCopyValidatedWithoutChangingSource() async throws {
        let (source, root) = try fixture()
        let sourceBytes = try Data(contentsOf: source)
        let coordinator = LocalProjectImportCoordinator(testRoot: root, backup: FixtureBackup(schemaVersion: 11, fail: false))
        let copy = try await coordinator.importCopy(from: source)
        XCTAssertTrue(copy.isIndependentCopy)
        XCTAssertNotEqual(copy.databaseURL, source)
        XCTAssertEqual(try Data(contentsOf: source), sourceBytes)
    }

    func testInvalidVersionIsRejected() async throws {
        let (source, root) = try fixture()
        let coordinator = LocalProjectImportCoordinator(testRoot: root, backup: FixtureBackup(schemaVersion: 12, fail: false))
        do { _ = try await coordinator.importCopy(from: source); XCTFail("Invalid schema must be rejected") }
        catch LocalImportError.unsupportedDatabase { }
    }

    func testCancellationDoesNotModifyOriginal() async throws {
        let (source, root) = try fixture()
        let sourceBytes = try Data(contentsOf: source)
        let coordinator = LocalProjectImportCoordinator(testRoot: root, backup: FixtureBackup(schemaVersion: 11, fail: true))
        do { _ = try await coordinator.importCopy(from: source); XCTFail("Expected cancellation") }
        catch is CancellationError { }
        XCTAssertEqual(try Data(contentsOf: source), sourceBytes)
    }

    func testRestoresOnlyValidatedCopiesAfterCoordinatorRecreated() async throws {
        let (source, root) = try fixture()
        let first = LocalProjectImportCoordinator(testRoot: root, backup: FixtureBackup(schemaVersion: 11, fail: false))
        let saved = try await first.importCopy(from: source)
        let unfinished = root.appendingPathComponent("worlds-import-\(UUID().uuidString.lowercased())", isDirectory: true)
        try FileManager.default.createDirectory(at: unfinished, withIntermediateDirectories: false)
        try Data().write(to: unfinished.appendingPathComponent(".incomplete"))
        try FileManager.default.copyItem(at: source, to: unfinished.appendingPathComponent("worlds.db"))
        let broken = root.appendingPathComponent("worlds-import-\(UUID().uuidString.lowercased())", isDirectory: true)
        try FileManager.default.createDirectory(at: broken, withIntermediateDirectories: false)
        try Data("not a database".utf8).write(to: broken.appendingPathComponent("worlds.db"))
        let brokenMarker = root.appendingPathComponent("worlds-import-\(UUID().uuidString.lowercased())", isDirectory: true)
        try FileManager.default.createDirectory(at: brokenMarker, withIntermediateDirectories: false)
        try FileManager.default.copyItem(at: source, to: brokenMarker.appendingPathComponent("worlds.db"))
        try FileManager.default.createSymbolicLink(at: brokenMarker.appendingPathComponent(".incomplete"), withDestinationURL: brokenMarker.appendingPathComponent("missing"))
        let second = LocalProjectImportCoordinator(testRoot: root, backup: FixtureBackup(schemaVersion: 11, fail: false))
        let inventory = try await second.listCopies()
        XCTAssertEqual(inventory.copies.map(\.id), [saved.id])
        XCTAssertEqual(inventory.rejectedCount, 3)
        let restored = try await second.restoreCopy(id: saved.id)
        XCTAssertEqual(restored.databaseURL, saved.databaseURL)
        XCTAssertEqual(try Data(contentsOf: restored.databaseURL), try Data(contentsOf: source))
    }

    #if canImport(WorldsRustStore)
    func testNativeBackupImportsCommittedWALWithoutChangingSource() async throws {
        let (source, root) = try fixture()
        var writer: OpaquePointer?
        guard sqlite3_open(source.path, &writer) == SQLITE_OK, let writer else { throw LocalImportError.invalidSource }
        defer { sqlite3_close(writer) }
        guard sqlite3_exec(writer, "PRAGMA journal_mode=WAL; INSERT INTO pages(id,kind,metadata,updated_at) VALUES('wal-page','project','{}',1)", nil, nil, nil) == SQLITE_OK else {
            throw LocalImportError.invalidSource
        }
        let coordinator = LocalProjectImportCoordinator(testRoot: root, backup: NativeSQLiteBackup())
        let copy = try await coordinator.importCopy(from: source)
        var imported: OpaquePointer?
        guard sqlite3_open(copy.databaseURL.path, &imported) == SQLITE_OK, let imported else { throw LocalImportError.invalidBackup }
        defer { sqlite3_close(imported) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(imported, "SELECT id FROM pages WHERE id='wal-page'", -1, &statement, nil) == SQLITE_OK, let statement else {
            throw LocalImportError.invalidBackup
        }
        defer { sqlite3_finalize(statement) }
        XCTAssertEqual(sqlite3_step(statement), SQLITE_ROW)
        XCTAssertEqual(String(cString: sqlite3_column_text(statement, 0)), "wal-page")
        XCTAssertEqual(sqlite3_exec(writer, "SELECT id FROM pages WHERE id='wal-page'", nil, nil, nil), SQLITE_OK)
    }
    #endif
}
