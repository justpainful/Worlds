import Foundation
import SQLite3
import Darwin
import XCTest
@testable import WorldsLocalImport
import WorldsModels
import WorldsNativeWrites
@testable import WorldsLocalGalleryImport

final class LocalGalleryImporterTests: XCTestCase {
    @MainActor func testGalleryDispositionRefreshesOnlyConfirmedSuccess() {
        var refreshes = 0
        let success = GalleryImportDisposition.resolve(error: nil)
        success.notifyIfSafe { refreshes += 1 }
        let unconfirmed = GalleryImportDisposition.resolve(error: NativeWriteError.responseUnavailable)
        unconfirmed.notifyIfSafe { refreshes += 1 }
        XCTAssertEqual(refreshes, 1)
        XCTAssertTrue(success.completed)
        XCTAssertFalse(unconfirmed.completed)
        XCTAssertTrue(unconfirmed.retryRequired)
    }
    @MainActor func testCommittedCleanupPendingDoesNotRefreshReplacedDatabase() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("gallery-outcome-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let selected = root.appendingPathComponent("selected", isDirectory: true)
        let replacement = root.appendingPathComponent("replacement", isDirectory: true)
        let retired = root.appendingPathComponent("retired", isDirectory: true)
        try FileManager.default.createDirectory(at: selected, withIntermediateDirectories: false)
        try FileManager.default.createDirectory(at: replacement, withIntermediateDirectories: false)
        func database(_ folder: URL, sql: String) throws {
            var db: OpaquePointer?
            guard sqlite3_open(folder.appendingPathComponent("worlds.db").path, &db) == SQLITE_OK, let db else { throw CocoaError(.fileWriteUnknown) }
            defer { sqlite3_close_v2(db) }
            guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        }
        try database(selected, sql: "CREATE TABLE marker(value INTEGER); INSERT INTO marker VALUES(11)")
        try database(replacement, sql: "CREATE TABLE marker(value INTEGER); INSERT INTO marker VALUES(22)")
        try FileManager.default.moveItem(at: selected, to: retired)
        try FileManager.default.moveItem(at: replacement, to: selected)
        var refreshes = 0
        let outcome = GalleryImportDisposition.resolve(error: NativeWriteError.galleryCommittedCleanupPending)
        outcome.notifyIfSafe { refreshes += 1; try? database(selected, sql: "UPDATE marker SET value=99") }
        XCTAssertEqual(outcome, .committedCleanupPending)
        XCTAssertTrue(outcome.completed)
        XCTAssertFalse(outcome.retryRequired)
        XCTAssertTrue(outcome.message?.contains("saved in the copy open during import") == true)
        XCTAssertTrue(outcome.message?.contains("reopen the local copy") == true)
        XCTAssertEqual(refreshes, 0)
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open_v2(selected.appendingPathComponent("worlds.db").path, &db, SQLITE_OPEN_READONLY, nil), SQLITE_OK)
        guard let db else { return XCTFail("Replacement database unavailable") }; defer { sqlite3_close_v2(db) }
        var statement: OpaquePointer?
        XCTAssertEqual(sqlite3_prepare_v2(db, "SELECT value FROM marker", -1, &statement, nil), SQLITE_OK)
        guard let statement else { return XCTFail("Marker unavailable") }; defer { sqlite3_finalize(statement) }
        XCTAssertEqual(sqlite3_step(statement), SQLITE_ROW)
        XCTAssertEqual(sqlite3_column_int(statement, 0), 22)
    }
    #if DEBUG
    func testIndependentCopyImportsOnceAndPreservesSource() async throws {
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "worlds-v11", withExtension: "db"))
        let temporaryRoot = FileManager.default.temporaryDirectory.appendingPathComponent("gallery-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temporaryRoot, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        // This is a freshly created fixture directory. Foundation can retain
        // the /var system alias, which the production no-follow importer must
        // reject; pass the actual POSIX path for this test-owned root instead.
        let resolved = try XCTUnwrap(realpath(temporaryRoot.path, nil))
        defer { free(resolved) }
        let canonical = String(cString: resolved)
        let root = URL(fileURLWithPath: canonical, isDirectory: true)
        XCTAssertEqual(root.path, canonical)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = root.appendingPathComponent("source.db")
        try FileManager.default.copyItem(at: fixture, to: database)
        var raw: OpaquePointer?
        guard sqlite3_open(database.path, &raw) == SQLITE_OK, let connection = raw else { return XCTFail("Fixture database unavailable") }
        XCTAssertEqual(sqlite3_exec(connection, "INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('gallery-test','Gallery','gallery','{}',1,1)", nil, nil, nil), SQLITE_OK)
        sqlite3_close_v2(connection)
        let sourceBytes = try Data(contentsOf: database)
        let media = root.appendingPathComponent("sample.mp3")
        try Data("fixture media".utf8).write(to: media)
        let coordinator = LocalProjectImportCoordinator(testRoot: root.appendingPathComponent("private", isDirectory: true), backup: NativeSQLiteBackup())
        let copy = try await coordinator.importCopy(from: database)
        let native = try NativePersonalStore(url: copy.databaseURL)
        let value = try await native.readResource(id: "gallery-test")
        guard case .object(let snapshot) = value, case .integer(let revision)? = snapshot["revision"], let metadata = snapshot["metadata"], let blocks = snapshot["blocks"] else { return XCTFail("Invalid gallery fixture") }
        let expected = try JSONDecoder().decode([NativeBlockInput].self, from: JSONEncoder().encode(blocks))
        let importer = try LocalGalleryImporter(copy: copy), operation = UUID()
        let cancelled = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await importer.importFile(source: media, galleryID: "gallery-test", base: revision, metadata: metadata, expected: expected, operationID: operation)
        }
        do { _ = try await cancelled.value; XCTFail("Cancelled import must not start") }
        catch is CancellationError { } catch { XCTFail("Unexpected cancellation error: \(error)") }
        let first: JSONValue
        do { first = try await importer.importFile(source: media, galleryID: "gallery-test", base: revision, metadata: metadata, expected: expected, operationID: operation) }
        catch {
            func matchesRealPath(_ url: URL) -> Bool {
                guard let resolved = realpath(url.path, nil) else { return false }
                defer { free(resolved) }
                return url.path == String(cString: resolved)
            }
            // The fixture is artificial. Report only boolean classifications,
            // never the selected paths or the unfiltered Rust error.
            return XCTFail("Initial import failed: \(error); source canonical: \(matchesRealPath(media)); copy canonical: \(matchesRealPath(copy.databaseURL))")
        }
        let retry: JSONValue
        do { retry = try await importer.importFile(source: media, galleryID: "gallery-test", base: revision, metadata: metadata, expected: expected, operationID: operation) }
        catch { return XCTFail("Idempotent retry failed: \(error)") }
        XCTAssertEqual(first, retry)
        XCTAssertEqual(try Data(contentsOf: database), sourceBytes)
        XCTAssertEqual(try Data(contentsOf: media), Data("fixture media".utf8))
        var copiedRaw: OpaquePointer?
        guard sqlite3_open_v2(copy.databaseURL.path, &copiedRaw, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let copied = copiedRaw else { return XCTFail("Copy unavailable") }
        defer { sqlite3_close_v2(copied) }
        var query: OpaquePointer?
        XCTAssertEqual(sqlite3_prepare_v2(copied, "SELECT rel_path FROM attachments WHERE page_id='gallery-test'", -1, &query, nil), SQLITE_OK)
        let statement = try XCTUnwrap(query); defer { sqlite3_finalize(statement) }
        XCTAssertEqual(sqlite3_step(statement), SQLITE_ROW)
        let path = String(cString: try XCTUnwrap(sqlite3_column_text(statement, 0)))
        let saved = copy.databaseURL.deletingLastPathComponent().appendingPathComponent("attachments").appendingPathComponent(path)
        XCTAssertEqual(try Data(contentsOf: saved), Data("fixture media".utf8))
        XCTAssertEqual(sqlite3_step(statement), SQLITE_DONE)
        try Data("changed content".utf8).write(to: media)
        do { _ = try await importer.importFile(source: media, galleryID: "gallery-test", base: revision, metadata: metadata, expected: expected, operationID: operation); XCTFail("Changed input must not reuse an operation ID") }
        catch NativeWriteError.conflict(_) { } catch { XCTFail("Unexpected error: \(error)") }
    }
    #endif
}
