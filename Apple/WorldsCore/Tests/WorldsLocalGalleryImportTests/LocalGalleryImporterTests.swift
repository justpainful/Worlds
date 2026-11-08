import Foundation
import SQLite3
import XCTest
import WorldsLocalImport
import WorldsModels
import WorldsNativeWrites
@testable import WorldsLocalGalleryImport

final class LocalGalleryImporterTests: XCTestCase {
    #if DEBUG
    func testIndependentCopyImportsOnceAndPreservesSource() async throws {
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "worlds-v11", withExtension: "db"))
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("gallery-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
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
        let coordinator = try LocalProjectImportCoordinator.isolatedTestCoordinator(root: root.appendingPathComponent("private", isDirectory: true), backup: NativeSQLiteBackup())
        let copy = try await coordinator.importCopy(from: database)
        let native = try NativePersonalStore(url: copy.databaseURL)
        let value = try await native.readResource(id: "gallery-test")
        guard case .object(let snapshot) = value, case .integer(let revision)? = snapshot["revision"], let metadata = snapshot["metadata"], let blocks = snapshot["blocks"] else { return XCTFail("Invalid gallery fixture") }
        let expected = try JSONDecoder().decode([NativeBlockInput].self, from: JSONEncoder().encode(blocks))
        let importer = try LocalGalleryImporter(copy: copy), operation = UUID()
        let first = try await importer.importFile(source: media, galleryID: "gallery-test", base: revision, metadata: metadata, expected: expected, operationID: operation)
        let retry = try await importer.importFile(source: media, galleryID: "gallery-test", base: revision, metadata: metadata, expected: expected, operationID: operation)
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
