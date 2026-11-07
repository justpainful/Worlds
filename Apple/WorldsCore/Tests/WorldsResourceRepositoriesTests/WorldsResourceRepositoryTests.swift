import Foundation
import SQLite3
import XCTest
import WorldsModels
import WorldsProjects
import WorldsGallery
import WorldsNativeWrites
@testable import WorldsResourceRepositories

final class WorldsResourceRepositoryTests: XCTestCase {
    private func database() throws -> URL {
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "worlds-v11", withExtension: "db"))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let path = dir.appendingPathComponent("worlds.db")
        try FileManager.default.copyItem(at: fixture, to: path)
        try execute(path, #"INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('p','Project','project','{"project":{"status":"active","links":[]},"future":true}',1,100),('g','Gallery','gallery','{"gallery":{"view":"grid"}}',1,100); INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('a','fixture-page','image','a.png','image/png',1,'test/a.png',1);"#)
        return path
    }
    private func execute(_ path: URL, _ sql: String) throws {
        var db: OpaquePointer?
        guard sqlite3_open(path.path, &db) == SQLITE_OK, let db else { throw NativeResourceRepositoryError.malformedResponse }
        defer { sqlite3_close(db) }
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw NativeResourceRepositoryError.malformedResponse }
    }
    func testProjectUsesNativeStoreAndRejectsSameTimestampChange() async throws {
        let path = try database()
        let repo = NativeResourceRepository(store: try NativePersonalStore(url: path))
        let project = ProjectService(repository: repo)
        let current = try await repo.readProject(id: "p")
        let saved = try await project.apply(projectID: "p", expectedRevision: current.revision, change: .description("native indexed text"), authorizedResources: [])
        XCTAssertEqual(try ProjectMetadata(source: saved.metadata).description, "native indexed text")
        // Update metadata without changing updated_at, reproducing the timestamp collision.
        try execute(path, "UPDATE pages SET metadata=json_set(metadata,'$.future',false) WHERE id='p'")
        do {
            _ = try await repo.compareAndSwapProject(id: "p", expectedRevision: saved.revision, expectedMetadata: saved.metadata, metadata: saved.metadata)
            XCTFail("Expected conflict")
        } catch ProjectError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
    }
    func testGalleryUsesNativeStoreAndKeepsAttachment() async throws {
        let path = try database()
        let repo = NativeResourceRepository(store: try NativePersonalStore(url: path))
        let service = GalleryService(repository: repo)
        let initial = try await repo.readAuthorizedGallery(id: "g")
        let added = try await service.apply(galleryID: "g", expectedRevision: initial.revision, change: .add(GalleryAttachment(id: "a", fileName: "a.png", mime: "image/png", size: 1, kind: "image")))
        let item = try XCTUnwrap(try GalleryDocument(blocks: added.blocks, metadata: added.metadata).items.first)
        let removed = try await service.apply(galleryID: "g", expectedRevision: added.revision, change: .remove(itemID: item.id))
        XCTAssertTrue(try GalleryDocument(blocks: removed.blocks, metadata: removed.metadata).items.isEmpty)
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open_v2(path.path, &db, SQLITE_OPEN_READONLY, nil), SQLITE_OK)
        let handle = try XCTUnwrap(db); defer { sqlite3_close(handle) }
        var statement: OpaquePointer?
        XCTAssertEqual(sqlite3_prepare_v2(handle, "SELECT count(*) FROM attachments WHERE id='a'", -1, &statement, nil), SQLITE_OK)
        let query = try XCTUnwrap(statement); defer { sqlite3_finalize(query) }
        XCTAssertEqual(sqlite3_step(query), SQLITE_ROW)
        XCTAssertEqual(sqlite3_column_int(query, 0), 1)
    }
}
