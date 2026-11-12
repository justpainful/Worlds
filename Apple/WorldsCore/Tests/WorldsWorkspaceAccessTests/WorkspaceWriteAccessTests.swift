import Foundation
import SQLite3
import XCTest
@testable import WorldsLocalImport
@testable import WorldsWorkspaceAccess

final class WorkspaceWriteAccessTests: XCTestCase {
    private func folder() throws -> URL {
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent("workspace-access-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        addTeardownBlock {
            try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
            try? FileManager.default.removeItem(at: root)
        }
        return root
    }

    /// A synthetic database with the columns RustStore uses; no user data.
    private func database(version: Int = 11, tables: Bool = true, in root: URL) throws -> URL {
        let url = root.appendingPathComponent("worlds.db")
        var handle: OpaquePointer?
        guard sqlite3_open(url.path, &handle) == SQLITE_OK, let db = handle else { throw CocoaError(.fileWriteUnknown) }
        defer { sqlite3_close(db) }
        var sql = "PRAGMA journal_mode=WAL; PRAGMA user_version=\(version);"
        if tables {
            sql += """
            CREATE TABLE pages(id TEXT,kind TEXT,metadata TEXT,workspace_id TEXT,deleted_at INTEGER,updated_at INTEGER);
            CREATE TABLE blocks(id TEXT,page_id TEXT,content TEXT,sort_key REAL);
            CREATE TABLE changes(page_id TEXT,kind TEXT,origin TEXT,at INTEGER);
            CREATE TABLE versions(id TEXT,page_id TEXT,snapshot TEXT);
            INSERT INTO pages VALUES('p','page','{}',NULL,NULL,100);
            """
        }
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        return url
    }

    private func facts(path: String = "/Users/person/Library/Application Support/Worlds/worlds.db", ubiquitous: Bool? = false, local: Bool? = true, writable: Bool = true, folderWritable: Bool = true, regular: Bool = true) -> WorkspaceLocationFacts {
        WorkspaceLocationFacts(path: path, resolvedPath: path, isRegularFile: regular, isUbiquitous: ubiquitous, volumeIsLocal: local, isWritable: writable, directoryIsWritable: folderWritable)
    }

    func testLocalWritableDesktopDatabaseIsAccepted() {
        XCTAssertNil(WorkspaceWritePreflight.locationProblem(facts()))
        XCTAssertEqual(WorkspaceWritePreflight.decide(location: facts(), schemaVersion: 11, hasWorldsTables: true, lock: .acquired), .writable)
        // The desktop holding the write lock does not make the database read only.
        XCTAssertEqual(WorkspaceWritePreflight.decide(location: facts(), schemaVersion: 11, hasWorldsTables: true, lock: .busy), .writable)
    }

    func testCloudAndFileProviderLocationsStayReadOnly() {
        XCTAssertEqual(WorkspaceWritePreflight.locationProblem(facts(ubiquitous: true)), .cloudStorage)
        for path in ["/Users/person/Library/Mobile Documents/com~apple~CloudDocs/worlds.db",
                     "/Users/person/Library/CloudStorage/OneDrive-Personal/worlds.db",
                     "/private/var/mobile/Containers/Shared/AppGroup/X/File Provider Storage/worlds.db"] {
            XCTAssertEqual(WorkspaceWritePreflight.locationProblem(facts(path: path)), .cloudStorage, path)
            XCTAssertEqual(WorkspaceWritePreflight.decide(location: facts(path: path), schemaVersion: 11, hasWorldsTables: true, lock: .acquired), .readOnly(.cloudStorage))
        }
        // A symbolic path that resolves into cloud storage is caught as well.
        var linked = facts(path: "/Users/person/Desktop/worlds.db")
        linked.resolvedPath = "/Users/person/Library/Mobile Documents/com~apple~CloudDocs/Desktop/worlds.db"
        XCTAssertEqual(WorkspaceWritePreflight.locationProblem(linked), .cloudStorage)
    }

    func testNetworkUnknownAndReadOnlyLocationsStayReadOnly() {
        XCTAssertEqual(WorkspaceWritePreflight.locationProblem(facts(local: false)), .networkVolume)
        XCTAssertEqual(WorkspaceWritePreflight.locationProblem(facts(local: nil)), .networkVolume)
        XCTAssertEqual(WorkspaceWritePreflight.locationProblem(facts(writable: false)), .notWritable)
        // The folder must be writable for SQLite's WAL and lock files.
        XCTAssertEqual(WorkspaceWritePreflight.locationProblem(facts(folderWritable: false)), .notWritable)
        XCTAssertEqual(WorkspaceWritePreflight.locationProblem(facts(regular: false)), .notLocalFile)
    }

    func testSchemaTablesAndLockFailuresStayReadOnly() {
        XCTAssertEqual(WorkspaceWritePreflight.decide(location: facts(), schemaVersion: 12, hasWorldsTables: true, lock: .acquired), .readOnly(.unsupportedSchema))
        XCTAssertEqual(WorkspaceWritePreflight.decide(location: facts(), schemaVersion: 11, hasWorldsTables: false, lock: .acquired), .readOnly(.notWorldsDatabase))
        XCTAssertEqual(WorkspaceWritePreflight.decide(location: facts(), schemaVersion: nil, hasWorldsTables: false, lock: .failed), .readOnly(.unavailable))
        XCTAssertEqual(WorkspaceWritePreflight.decide(location: facts(), schemaVersion: 11, hasWorldsTables: true, lock: .failed), .readOnly(.unavailable))
    }

    func testEvaluateAcceptsALocalVersionElevenDatabaseWithoutChangingIt() throws {
        let url = try database(in: try folder())
        let before = try readTitleRows(url)
        XCTAssertEqual(WorkspaceWritePreflight.evaluate(url), .writable)
        XCTAssertEqual(try readTitleRows(url), before)
    }

    func testEvaluateRejectsOtherSchemasMissingTablesAndMissingFiles() throws {
        XCTAssertEqual(WorkspaceWritePreflight.evaluate(try database(version: 10, in: try folder())), .readOnly(.unsupportedSchema))
        XCTAssertEqual(WorkspaceWritePreflight.evaluate(try database(tables: false, in: try folder())), .readOnly(.notWorldsDatabase))
        let missing = try folder().appendingPathComponent("missing.db")
        XCTAssertEqual(WorkspaceWritePreflight.evaluate(missing), .readOnly(.notLocalFile))
        // A missing file is never created by the probe.
        XCTAssertFalse(FileManager.default.fileExists(atPath: missing.path))
    }

    func testEvaluateRejectsAReadOnlyFile() throws {
        let url = try database(in: try folder())
        try FileManager.default.setAttributes([.posixPermissions: 0o444], ofItemAtPath: url.path)
        addTeardownBlock { try? FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: url.path) }
        XCTAssertEqual(WorkspaceWritePreflight.evaluate(url), .readOnly(.notWritable))
    }

    func testEvaluateTreatsAnotherWritersLockAsWritable() throws {
        let url = try database(in: try folder())
        var handle: OpaquePointer?
        XCTAssertEqual(sqlite3_open(url.path, &handle), SQLITE_OK)
        let other = try XCTUnwrap(handle)
        defer { sqlite3_close(other) }
        XCTAssertEqual(sqlite3_exec(other, "BEGIN IMMEDIATE", nil, nil, nil), SQLITE_OK)
        XCTAssertEqual(WorkspaceWritePreflight.evaluate(url), .writable)
        XCTAssertEqual(sqlite3_exec(other, "ROLLBACK", nil, nil, nil), SQLITE_OK)
    }

    func testRoutingKeepsTheActiveCopyAndWritesOtherDatabasesInPlaceOnlyWhenWritable() throws {
        let own = URL(fileURLWithPath: "/Users/person/Library/Application Support/Worlds/worlds.db")
        let copy = LocalProjectCopy(databaseURL: URL(fileURLWithPath: "/tmp/LocalCopies/worlds-import-x/worlds.db"), id: UUID())
        let bundle = URL(fileURLWithPath: "/Applications/Worlds.app", isDirectory: true)

        let routedCopy = try XCTUnwrap(WorkspaceWriteTarget.route(openedDatabase: copy.databaseURL, access: .readOnly(.unavailable), activeCopy: copy, bundleURL: bundle))
        XCTAssertEqual(routedCopy.kind, .localCopy)
        XCTAssertEqual(routedCopy.id, copy.id)
        XCTAssertTrue(routedCopy.supportsGalleryFileImport)
        XCTAssertTrue(routedCopy.supportsPermanentDeletion)
        XCTAssertFalse(routedCopy.usesStoreTrash)

        let routedOwn = try XCTUnwrap(WorkspaceWriteTarget.route(openedDatabase: own, access: .writable, activeCopy: copy, bundleURL: bundle))
        XCTAssertEqual(routedOwn.kind, .ownWorkspace)
        XCTAssertEqual(routedOwn.databaseURL, own)
        XCTAssertNil(routedOwn.independentCopy)
        XCTAssertFalse(routedOwn.supportsGalleryFileImport)
        XCTAssertFalse(routedOwn.supportsPermanentDeletion)
        XCTAssertTrue(routedOwn.usesStoreTrash)

        XCTAssertNil(WorkspaceWriteTarget.route(openedDatabase: own, access: .readOnly(.cloudStorage), activeCopy: nil, bundleURL: bundle))
        // Bundled test fixtures are never edited in place.
        let fixture = bundle.appendingPathComponent("Contents/Resources/reader-ui-fixture.db")
        XCTAssertNil(WorkspaceWriteTarget.route(openedDatabase: fixture, access: .writable, activeCopy: nil, bundleURL: bundle))
    }

    func testEachOpenOfTheOwnWorkspaceIsANewSession() {
        let own = URL(fileURLWithPath: "/Users/person/worlds.db")
        let first = WorkspaceWriteTarget.ownWorkspace(databaseURL: own)
        let second = WorkspaceWriteTarget.ownWorkspace(databaseURL: own)
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(first, first)
    }

    private func readTitleRows(_ url: URL) throws -> [String] {
        var handle: OpaquePointer?
        guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db = handle else { throw CocoaError(.fileReadUnknown) }
        defer { sqlite3_close(db) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT id || ':' || updated_at FROM pages ORDER BY id", -1, &statement, nil) == SQLITE_OK, let statement else { throw CocoaError(.fileReadUnknown) }
        defer { sqlite3_finalize(statement) }
        var rows: [String] = []
        while sqlite3_step(statement) == SQLITE_ROW { rows.append(String(cString: sqlite3_column_text(statement, 0))) }
        return rows
    }
}
