import Foundation
import SQLite3
import XCTest
import WorldsModels
@testable import WorldsProjects

/// Test-only isolated repository. It is not the Worlds production store.
private actor SQLiteFixtureRepository: ProjectRepository {
    nonisolated(unsafe) private let db: OpaquePointer
    init(url: URL) throws {
        var handle: OpaquePointer?
        guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK, let handle else { throw ProjectError.invalidMetadata }
        db = handle
        let sql = #"INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('project','Project','project','{"project":{"status":"active","links":[],"unknown":"keep"},"other":{"keep":true}}',1,100)"#
        guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else { throw ProjectError.invalidMetadata }
    }
    deinit { sqlite3_close_v2(db) }
    func readProject(id: String) async throws -> ProjectRecord {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT id,kind,metadata,updated_at FROM pages WHERE id=?1", -1, &statement, nil) == SQLITE_OK, let statement else { throw ProjectError.invalidMetadata }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        sqlite3_bind_text(statement, 1, id, -1, transient)
        guard sqlite3_step(statement) == SQLITE_ROW, let rawID = sqlite3_column_text(statement,0), let rawKind = sqlite3_column_text(statement,1), let rawJSON = sqlite3_column_text(statement,2) else { throw ProjectError.invalidResource }
        let metadata = try JSONDecoder().decode(JSONValue.self, from: Data(String(cString: rawJSON).utf8))
        return ProjectRecord(id: String(cString: rawID), kind: String(cString: rawKind), metadata: metadata, revision: sqlite3_column_int64(statement,3))
    }
    func compareAndSwapProject(id: String, expectedRevision: Int64, expectedMetadata: JSONValue, metadata: JSONValue) async throws -> ProjectRecord {
        guard sqlite3_exec(db, "BEGIN IMMEDIATE", nil, nil, nil) == SQLITE_OK else { throw ProjectError.invalidMetadata }
        do {
            var check: OpaquePointer?
            guard sqlite3_prepare_v2(db, "SELECT metadata FROM pages WHERE id=?1", -1, &check, nil) == SQLITE_OK, let check else { throw ProjectError.invalidMetadata }
            let checkTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            sqlite3_bind_text(check, 1, id, -1, checkTransient)
            guard sqlite3_step(check) == SQLITE_ROW, let raw = sqlite3_column_text(check, 0) else { sqlite3_finalize(check); throw ProjectError.conflict }
            let current = try JSONDecoder().decode(JSONValue.self, from: Data(String(cString: raw).utf8))
            sqlite3_finalize(check)
            guard current == expectedMetadata else { throw ProjectError.conflict }
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(db, "UPDATE pages SET metadata=?1,updated_at=updated_at+1 WHERE id=?2 AND kind='project' AND updated_at=?3", -1, &statement, nil) == SQLITE_OK, let statement else { throw ProjectError.invalidMetadata }
            defer { sqlite3_finalize(statement) }
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            let encoded = try JSONEncoder().encode(metadata)
            guard let text = String(data: encoded, encoding: .utf8) else { throw ProjectError.invalidMetadata }
            sqlite3_bind_text(statement, 1, text, -1, transient)
            sqlite3_bind_text(statement, 2, id, -1, transient)
            sqlite3_bind_int64(statement, 3, expectedRevision)
            guard sqlite3_step(statement) == SQLITE_DONE else { throw ProjectError.invalidMetadata }
            guard sqlite3_changes(db) == 1 else { throw ProjectError.conflict }
            guard sqlite3_exec(db, "COMMIT", nil, nil, nil) == SQLITE_OK else { throw ProjectError.invalidMetadata }
            return try await readProject(id: id)
        } catch { sqlite3_exec(db, "ROLLBACK", nil, nil, nil); throw error }
    }
}

final class WorldsProjectsTests: XCTestCase {
    private func resource(_ id: String, kind: String = "page", parent: String? = nil, archived: Bool = false, deleted: Int64? = nil, order: Double = 0) -> ProjectResource {
        ProjectResource(id: id, title: id, kind: kind, parentID: parent, archived: archived, deletedAt: deleted, sortKey: order, createdAt: 1, updatedAt: 2)
    }
    func testDefaultsAndRoundTripKeepUnknownFields() throws {
        let json = #"{"project":{"status":"paused","future":{"v":1},"links":["a"]},"other":{"keep":true}}"#
        let source = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        var project = try ProjectMetadata(source: source)
        try project.apply(.description("مرحبا"), projectID: "p", resources: [])
        guard case .object(let root) = project.source, case .object(let fields)? = root["project"] else { return XCTFail("Missing metadata") }
        XCTAssertEqual(fields["future"], .object(["v": .integer(1)]))
        XCTAssertEqual(root["other"], .object(["keep": .bool(true)]))
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(project.source)), project.source)
    }
    func testChildrenAndLinkedSemantics() throws {
        let resources = [resource("in", parent: "p"), resource("archived-child", parent: "p", archived: true), resource("linked", parent: "elsewhere", archived: true), resource("deleted", deleted: 5), resource("template", kind: "template")]
        var project = ProjectMetadata.newProject
        XCTAssertEqual(ProjectMetadata.children(projectID: "p", resources: resources).map(\.id), ["in"])
        try project.apply(.link("linked"), projectID: "p", resources: resources)
        XCTAssertEqual(project.linked(resources: resources).map(\.id), ["linked"])
        XCTAssertEqual(project.linked(resources: resources).first?.parentID, "elsewhere")
        for bad in ["in", "p", "deleted", "template", "linked"] { XCTAssertThrowsError(try project.apply(.link(bad), projectID: "p", resources: resources)) }
        try project.apply(.unlink("linked"), projectID: "p", resources: resources)
        XCTAssertTrue(project.links.isEmpty)
    }
    func testDuplicateLinksCannotBeUnlinkedOrModifiedSilently() throws {
        let source: JSONValue = .object(["project": .object(["links": .array([.string("a"), .string("a")])])])
        var project = try ProjectMetadata(source: source)
        XCTAssertThrowsError(try project.apply(.unlink("a"), projectID: "p", resources: [resource("a")]))
        XCTAssertEqual(project.source, source)
        XCTAssertThrowsError(try project.apply(.link("b"), projectID: "p", resources: [resource("b")]))
        XCTAssertEqual(project.source, source)
    }
    func testStatusAndCalendarDates() throws {
        var project = ProjectMetadata.newProject
        try project.apply(.status("done"), projectID: "p", resources: [])
        try project.apply(.due("2028-02-29"), projectID: "p", resources: [])
        XCTAssertEqual(project.status, "done")
        XCTAssertEqual(project.due, "2028-02-29")
        XCTAssertThrowsError(try project.apply(.due("2027-02-29"), projectID: "p", resources: []))
        XCTAssertThrowsError(try project.apply(.status("unknown"), projectID: "p", resources: []))
    }
    func testIsolatedDatabaseRoundTripAndConflict() async throws {
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "worlds-v11", withExtension: "db"))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("worlds.db")
        try FileManager.default.copyItem(at: fixture, to: path)
        let repository = try SQLiteFixtureRepository(url: path)
        let service = ProjectService(repository: repository)
        let updated = try await service.apply(projectID: "project", expectedRevision: 100, change: .status("done"), authorizedResources: [])
        XCTAssertEqual(updated.revision, 101)
        let metadata = try ProjectMetadata(source: updated.metadata)
        XCTAssertEqual(metadata.status, "done")
        do {
            _ = try await service.apply(projectID: "project", expectedRevision: 100, change: .description("stale"), authorizedResources: [])
            XCTFail("Stale edit must fail")
        } catch ProjectError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        let current = try await repository.readProject(id: "project")
        XCTAssertEqual(current.metadata, updated.metadata)
    }
}
