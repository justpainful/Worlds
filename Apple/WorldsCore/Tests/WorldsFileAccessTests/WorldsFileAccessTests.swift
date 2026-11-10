import Foundation
import SQLite3
import XCTest
import WorldsPersistence
import WorldsMedia

final class WorldsFileAccessTests: XCTestCase {
    func testOwnedPersonalFileCanBeReadAndMismatchedOwnerIsRejected() async throws {
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "worlds-v1-fixture", withExtension: "db"))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: dir) }
        let path = dir.appendingPathComponent("worlds.db")
        try FileManager.default.copyItem(at: fixture, to: path)
        let root = dir.appendingPathComponent("attachments", isDirectory: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("2026-01"), withIntermediateDirectories: true)
        try Data("Worlds file".utf8).write(to: root.appendingPathComponent("2026-01/test.txt"))
        var db: OpaquePointer?
        guard sqlite3_open(path.path, &db) == SQLITE_OK, let db else { return XCTFail("Fixture database unavailable") }
        let sql = #"UPDATE pages SET kind='file',metadata='{"file":{"attachmentId":"owned"}}' WHERE id='fixture-page'; INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('owned','fixture-page','file','test.txt','text/plain',11,'2026-01/test.txt',1),('unowned',NULL,'file','secret.txt','text/plain',6,'secret.txt',1);"#
        XCTAssertEqual(sqlite3_exec(db, sql, nil, nil, nil), SQLITE_OK)
        sqlite3_close(db)
        let database = try WorldsDatabase(url: path)
        let found = try await database.personalFileAttachment(pageID: "fixture-page")
        let record = try XCTUnwrap(found)
        let attachment = WorldsAttachment(id: record.id, pageId: record.pageID, kind: record.kind, fileName: record.fileName, mime: record.mime, size: record.size, relPath: record.relPath, width: record.width, height: record.height, createdAt: record.createdAt)
        XCTAssertEqual(try WorldsMedia.text(file: AttachmentVault(root: root).open(attachment)), "Worlds file")
        var writer: OpaquePointer?
        XCTAssertEqual(sqlite3_open(path.path, &writer), SQLITE_OK)
        let handle = try XCTUnwrap(writer)
        XCTAssertEqual(sqlite3_exec(handle, #"UPDATE pages SET metadata='{"file":{"attachmentId":"unowned"}}' WHERE id='fixture-page'"#, nil, nil, nil), SQLITE_OK)
        sqlite3_close(handle)
        let denied = try await database.personalFileAttachment(pageID: "fixture-page")
        XCTAssertNil(denied)
    }
}
