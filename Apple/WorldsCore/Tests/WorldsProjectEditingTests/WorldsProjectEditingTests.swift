import Foundation
import SQLite3
import XCTest
import WorldsModels
import WorldsProjects
import WorldsNativeWrites
import WorldsResourceRepositories
@testable import WorldsProjectEditing

final class WorldsProjectEditingTests: XCTestCase {
    private func execute(_ path: URL, _ sql: String) throws {
        var db: OpaquePointer?
        guard sqlite3_open(path.path, &db) == SQLITE_OK, let db else { throw ProjectError.invalidResource }
        defer { sqlite3_close(db) }
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw ProjectError.invalidMetadata }
    }
    private func database() throws -> URL {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-v11", withExtension: "db"))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("worlds.db"); try FileManager.default.copyItem(at: source, to: path)
        try execute(path, #"INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('project','Project','project','{"project":{"status":"active","description":"old","links":[]},"unknown":{"keep":true}}',1,100); INSERT INTO pages(id,title,kind,workspace_id,metadata,created_at,updated_at) VALUES('shared','Shared','project','team','{}',1,100);"#)
        return path
    }
    func testUndoAndFullBaselineConflictOnRealStore() async throws {
        let path = try database()
        let repository = NativeResourceRepository(store: try NativePersonalStore(url: path))
        let session = try await ProjectEditingSession.open(repository: repository, projectID: "project")
        try await session.change(.description("draft"), authorizedResources: [])
        try await session.undo()
        let undone = await session.current(); XCTAssertEqual(undone.description, "old")
        try await session.redo()
        try execute(path, #"UPDATE pages SET metadata=json_set(metadata,'$.unknown.keep',false) WHERE id='project'"#)
        do { _ = try await session.save(); XCTFail("Expected metadata conflict") }
        catch ProjectError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        let retained = await session.current(); XCTAssertEqual(retained.description, "draft")
        do { _ = try await session.save(); XCTFail("A conflicted session must reload") }
        catch ProjectEditingError.reloadRequired { } catch { XCTFail("Unexpected error: \(error)") }
    }
    func testSavePreservesUnknownMetadataAndRefusesShared() async throws {
        let path = try database()
        let repository = NativeResourceRepository(store: try NativePersonalStore(url: path))
        let session = try await ProjectEditingSession.open(repository: repository, projectID: "project")
        try await session.change(.description("saved"), authorizedResources: [])
        let result = try await session.save()
        guard case .object(let metadata) = result.metadata else { return XCTFail("Missing metadata") }
        XCTAssertEqual(metadata["unknown"], .object(["keep": .bool(true)]))
        do { _ = try await ProjectEditingSession.open(repository: repository, projectID: "shared"); XCTFail("Shared page must be rejected") } catch { }
    }
    private func fixtureResource() -> ProjectResource {
        ProjectResource(id: "fixture-page", title: "Fixture page", kind: "page", parentID: nil,
                        archived: false, deletedAt: nil, sortKey: 0, createdAt: 1, updatedAt: 1)
    }
    func testLinkUnlinkAndReopenRealProject() async throws {
        let path = try database()
        let repository = NativeResourceRepository(store: try NativePersonalStore(url: path))
        let session = try await ProjectEditingSession.open(repository: repository, projectID: "project")
        try await session.change(.link("fixture-page"), authorizedResources: [fixtureResource()])
        _ = try await session.save()
        let reopened = try await ProjectEditingSession.open(repository: repository, projectID: "project")
        let linked = await reopened.current(); XCTAssertEqual(linked.links, ["fixture-page"])
        try await reopened.change(.unlink("fixture-page"), authorizedResources: [fixtureResource()])
        _ = try await reopened.save()
        let again = try await ProjectEditingSession.open(repository: repository, projectID: "project")
        let unlinked = await again.current(); XCTAssertTrue(unlinked.links.isEmpty)
        guard case .object(let metadata) = unlinked.source else { return XCTFail("Missing metadata") }
        XCTAssertEqual(metadata["unknown"], .object(["keep": .bool(true)]))
    }
    func testLinkRejectedIfTargetBecomesSharedBeforeSave() async throws {
        let path = try database()
        let repository = NativeResourceRepository(store: try NativePersonalStore(url: path))
        let session = try await ProjectEditingSession.open(repository: repository, projectID: "project")
        try await session.change(.link("fixture-page"), authorizedResources: [fixtureResource()])
        try execute(path, "UPDATE pages SET workspace_id='team' WHERE id='fixture-page'")
        do { _ = try await session.save(); XCTFail("Shared target must be rejected") } catch { }
        let reopened = try await ProjectEditingSession.open(repository: repository, projectID: "project")
        let current = await reopened.current(); XCTAssertTrue(current.links.isEmpty)
    }

}
