import Foundation
import SQLite3
import XCTest
@testable import WorldsSearch

final class WorldsSearchTests: XCTestCase {
    private func database() throws -> URL {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-v11", withExtension: "db"))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let target = dir.appendingPathComponent("worlds.db")
        try FileManager.default.copyItem(at: source, to: target)
        var handle: OpaquePointer?
        XCTAssertEqual(sqlite3_open(target.path, &handle), SQLITE_OK)
        let db = try XCTUnwrap(handle)
        defer { sqlite3_close(db) }
        let setup = #"""
        INSERT INTO pages(id,title,kind,metadata,created_at,updated_at,archived) VALUES('personal','كتاب الجبر','page','{}',1,10,0),('archived','Archived geometry','page','{}',1,9,1),('template','Template geometry','template','{}',1,8,0);
        INSERT INTO pages(id,title,kind,metadata,created_at,updated_at,deleted_at) VALUES('trash','Deleted geometry','page','{}',1,7,4);
        INSERT INTO pages(id,title,kind,metadata,created_at,updated_at,workspace_id) VALUES('shared','Shared geometry','page','{}',1,6,'team');
        INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('flagged','Flagged geometry','page','{"sync":{"shared":true}}',1,5),('broken','Broken geometry','page','{',1,4);
        INSERT INTO pages_fts(page_id,title,body) VALUES('personal','كتاب الجبر','حل مسألة geometry example'),('archived','Archived geometry','geometry'),('template','Template geometry','geometry'),('trash','Deleted geometry','geometry'),('shared','Shared geometry','geometry'),('flagged','Flagged geometry','geometry'),('broken','Broken geometry','geometry');
        """#
        let rc = sqlite3_exec(db, setup, nil, nil, nil)
        guard rc == SQLITE_OK else { throw WorldsSearchError.database(String(cString: sqlite3_errmsg(db))) }
        return target
    }
    func testTrigramSearchHonorsPermissionsTrashAndTemplates() async throws {
        let url = try database()
        let search = try WorldsSearch(url: url)
        let hits = try await search.search("geometry", includeTemplates: false)
        XCTAssertEqual(Set(hits.map(\.pageId)), Set(["personal", "archived"]))
        XCTAssertTrue(hits.contains { $0.pageId == "personal" && $0.snippet.contains("\u{E000}") && $0.snippet.contains("\u{E001}") && $0.snippetRuns.contains(where: { $0.highlighted && !$0.text.isEmpty && "geometry".hasPrefix($0.text.lowercased()) }) })
        let withTemplates = try await search.search("geometry", includeTemplates: true)
        XCTAssertTrue(withTemplates.contains { $0.pageId == "template" })
        XCTAssertFalse(withTemplates.contains { ["trash", "shared", "flagged", "broken"].contains($0.pageId) })
    }
    func testArabicAndShortTitleFallback() async throws {
        let search = try WorldsSearch(url: database())
        let arabic = try await search.search("الجبر")
        XCTAssertTrue(arabic.contains { $0.pageId == "personal" })
        let short = try await search.search("كت")
        XCTAssertTrue(short.contains { $0.pageId == "personal" })
    }
    func testLiteralWildcardsAndEmptyQuery() async throws {
        let search = try WorldsSearch(url: database())
        let wildcards = try await search.search("%_")
        XCTAssertTrue(wildcards.isEmpty)
        let empty = try await search.search("  ")
        XCTAssertTrue(empty.isEmpty)
    }
    func testQueriesDoNotModifyDatabase() async throws {
        let url = try database()
        let before = try Data(contentsOf: url)
        let search = try WorldsSearch(url: url)
        _ = try await search.search("geometry")
        XCTAssertEqual(try Data(contentsOf: url), before)
    }
}


