import Foundation
import SQLite3
import XCTest
@testable import WorldsPersistence

final class WorldsDatabaseTests: XCTestCase {
    func testPersonalTabSessionRestoresOnlyEligiblePagesPerCopy() throws {
        let suite = "worlds-tabs-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let first = UUID(), second = UUID()
        let store = PersonalTabPreferences(defaults: defaults)
        var tabs = PersonalTabSession(eligibleIDs: ["a", "b"])
        tabs.select("a", eligibleIDs: ["a", "b"])
        XCTAssertTrue(tabs.openTab("b", eligibleIDs: ["a", "b"]))
        XCTAssertFalse(tabs.openTab("shared", eligibleIDs: ["a", "b"]))
        store.save(tabs, copyID: first, eligibleIDs: ["a", "b"])
        let reopened = PersonalTabPreferences(defaults: defaults)
        XCTAssertEqual(reopened.load(copyID: first, eligibleIDs: ["a", "b"]), tabs)
        XCTAssertEqual(reopened.load(copyID: second, eligibleIDs: ["a", "b"]).pageIDs, [])
        let filtered = reopened.load(copyID: first, eligibleIDs: ["a"])
        XCTAssertEqual(filtered.pageIDs, ["a"])
        XCTAssertEqual(filtered.activeID, "a")
        tabs.close("b")
        XCTAssertEqual(tabs.activeID, "a")
        tabs.close("a")
        XCTAssertNil(tabs.activeID)
    }
    func testRestoredTabsExcludeSharedAndDeletedSnapshotPages() async throws {
        let url = try fixture()
        try execute(url, """
        INSERT INTO pages(id,title,metadata,created_at,updated_at) VALUES('shared','Shared','{"sync":{"shared":true}}',1,1);
        INSERT INTO pages(id,title,deleted_at,created_at,updated_at) VALUES('deleted','Deleted',1,1,1);
        """)
        let database = try WorldsDatabase(url: url)
        let snapshot = try await database.snapshot()
        let eligible = Set(snapshot.pages.map(\.id))
        let restored = PersonalTabSession(pageIDs: ["shared", "deleted", "fixture-page"], activeID: "shared", eligibleIDs: eligible)
        XCTAssertEqual(restored.pageIDs, ["fixture-page"])
        XCTAssertEqual(restored.activeID, "fixture-page")
    }
    func testPersonalTabsLimitAndCloseActiveNeighbor() {
        let ids = (0..<21).map { "page-\($0)" }
        let eligible = Set(ids)
        var tabs = PersonalTabSession(eligibleIDs: eligible)
        for id in ids.prefix(20) { XCTAssertTrue(tabs.openTab(id, eligibleIDs: eligible)) }
        XCTAssertFalse(tabs.openTab(ids[20], eligibleIDs: eligible))
        XCTAssertEqual(tabs.pageIDs.count, 20)
        XCTAssertEqual(tabs.activeID, ids[19])
        tabs.close(ids[19])
        XCTAssertEqual(tabs.activeID, ids[18])
        tabs.select(ids[0], eligibleIDs: eligible)
        tabs.close(ids[0])
        XCTAssertEqual(tabs.activeID, ids[1])
    }
    func testHierarchyPreferencesArePerCopyAndFilterUnavailablePages() throws {
        let suite = "worlds-hierarchy-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let first = UUID(), other = UUID()
        let store = PersonalHierarchyPreferences(defaults: defaults)
        store.save(PersonalHierarchyState(enabled: true, expanded: ["parent", "hidden"]), copyID: first, eligibleIDs: ["parent"])
        let reopened = PersonalHierarchyPreferences(defaults: defaults)
        XCTAssertEqual(reopened.load(copyID: first, eligibleIDs: ["parent"]), PersonalHierarchyState(enabled: true, expanded: ["parent"]))
        XCTAssertEqual(reopened.load(copyID: other, eligibleIDs: ["parent"]), PersonalHierarchyState(enabled: false, expanded: []))
        XCTAssertEqual(reopened.load(copyID: first, eligibleIDs: []), PersonalHierarchyState(enabled: true, expanded: []))
    }
    func testPersonalHierarchyKeepsDetachedComponentsAndStopsCycles() async throws {
        let url = try fixture()
        try execute(url, """
        INSERT INTO pages(id,title,parent_id,kind,archived,metadata,created_at,updated_at) VALUES
          ('child','Child','fixture-page','page',0,'{}',2,2),
          ('grandchild','Grandchild','child','page',0,'{}',3,3),
          ('orphan','Orphan','hidden-parent','page',0,'{}',4,4),
          ('cycle-a','Cycle A','cycle-b','page',0,'{}',5,5),
          ('cycle-b','Cycle B','cycle-a','page',0,'{}',6,6),
          ('archived','Archived','fixture-page','page',1,'{}',7,7),
          ('archive-child','Child of archive','archived','page',0,'{}',7,7),
          ('template','Template','fixture-page','template',0,'{}',8,8),
          ('shared','Shared','fixture-page','page',0,'{"sync":{"shared":true}}',9,9),
          ('shared-child','Personal child','shared','page',0,'{}',10,10);
        """)
        let database = try WorldsDatabase(url: url)
        let pages = try await database.snapshot().pages
        let collapsed = PersonalPageHierarchy.rows(pages: pages, expanded: [])
        XCTAssertTrue(collapsed.contains { $0.id == "fixture-page" && $0.hasChildren && !$0.isExpanded })
        XCTAssertFalse(collapsed.contains { $0.id == "child" || $0.id == "grandchild" })
        XCTAssertTrue(collapsed.contains { $0.id == "orphan" && $0.detached })
        XCTAssertTrue(collapsed.contains { $0.id == "archive-child" && $0.detached })
        XCTAssertTrue(collapsed.contains { $0.id == "shared-child" && $0.detached })
        let cycleRoot = try XCTUnwrap(collapsed.first { ["cycle-a", "cycle-b"].contains($0.id) })
        XCTAssertTrue(cycleRoot.detached)
        XCTAssertFalse(collapsed.contains { ["archived", "template", "shared"].contains($0.id) })
        let expanded = PersonalPageHierarchy.rows(pages: pages, expanded: ["fixture-page", "child", "cycle-a", "cycle-b"])
        XCTAssertEqual(expanded.filter { ["fixture-page", "child", "grandchild"].contains($0.id) }.map(\.id), ["fixture-page", "child", "grandchild"])
        XCTAssertEqual(expanded.filter { ["cycle-a", "cycle-b"].contains($0.id) }.count, 2)
        XCTAssertEqual(Set(expanded.map(\.id)).count, expanded.count)
        XCTAssertEqual(PersonalPageHierarchy.expandedAncestors(of: "grandchild", pages: pages), ["fixture-page", "child"])
        XCTAssertEqual(PersonalPageHierarchy.expandedAncestors(of: "cycle-a", pages: pages), ["cycle-b"])
        XCTAssertTrue(PersonalPageHierarchy.expandedAncestors(of: "shared-child", pages: pages).isEmpty)
    }
    private func fixture() throws -> URL {
        let original = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("worlds-v1-fixture.db")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let copy = directory.appendingPathComponent("worlds.db")
        try FileManager.default.copyItem(at: original, to: copy)
        return copy
    }

    private func execute(_ url: URL, _ sql: String) throws {
        var db: OpaquePointer?
        guard sqlite3_open(url.path, &db) == SQLITE_OK, let db else { throw NSError(domain: "fixture", code: 1) }
        defer { sqlite3_close(db) }
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw NSError(domain: "fixture", code: 2, userInfo: [NSLocalizedDescriptionKey: String(cString: sqlite3_errmsg(db))]) }
    }

    func testReadsRealVersionOneSchemaWithoutWriting() async throws {
        let url = try fixture()
        let before = try Data(contentsOf: url)
        let database = try WorldsDatabase(url: url)
        let snapshot = try await database.snapshot()
        XCTAssertEqual(snapshot.schemaVersion, 1)
        XCTAssertEqual(snapshot.pages.map(\.id), ["fixture-page"])
        XCTAssertEqual(snapshot.pages.first?.blocks.first?.id, "fixture-block")
        XCTAssertTrue(snapshot.pages.first?.blocks.first?.contentJSON.contains("Hello Worlds") == true)
        XCTAssertEqual(try Data(contentsOf: url), before)
    }

    func testExcludesSharedAndDeletedPages() async throws {
        let url = try fixture()
        try execute(url, "ALTER TABLE pages ADD COLUMN workspace_id TEXT; UPDATE pages SET workspace_id='team'; INSERT INTO pages(id,title,created_at,updated_at) VALUES('personal','Mine',1,2); INSERT INTO pages(id,title,deleted_at,created_at,updated_at) VALUES('trash','Trash',3,1,2); PRAGMA user_version=5;")
        let database = try WorldsDatabase(url: url)
        let visible = try await database.snapshot()
        XCTAssertEqual(visible.pages.map(\.id), ["personal"])
        let includingDeleted = try await database.snapshot(includeDeleted: true)
        XCTAssertEqual(Set(includingDeleted.pages.map(\.id)), Set(["personal", "trash"]))
    }

    func testTrashedPagesListsPersonalTrashRootsWithDeletionTime() async throws {
        let url = try fixture()
        try execute(url, """
        ALTER TABLE pages ADD COLUMN workspace_id TEXT;
        INSERT INTO pages(id,title,deleted_at,created_at,updated_at) VALUES('root','Trashed root',50,1,2);
        INSERT INTO pages(id,title,parent_id,deleted_at,created_at,updated_at) VALUES('child','Trashed with root','root',50,1,2);
        INSERT INTO pages(id,title,parent_id,deleted_at,created_at,updated_at) VALUES('earlier','Trashed before root','root',40,1,2);
        INSERT INTO pages(id,title,deleted_at,workspace_id,created_at,updated_at) VALUES('team','Team trash',60,'team',1,2);
        INSERT INTO pages(id,title,metadata,deleted_at,created_at,updated_at) VALUES('flagged','Flagged trash','{"sync":{"shared":true}}',70,1,2);
        PRAGMA user_version=5;
        """)
        let before = try Data(contentsOf: url)
        let database = try WorldsDatabase(url: url)
        let trashed = try await database.trashedPages()
        // Newest first; the child trashed with its parent is restored with it.
        XCTAssertEqual(trashed.map(\.id), ["root", "earlier"])
        XCTAssertEqual(trashed.map(\.deletedAt), [50, 40])
        XCTAssertEqual(trashed.first?.page.title, "Trashed root")
        XCTAssertEqual(trashed.first?.page.updatedAt, 2)
        // Live pages are unaffected and the file is not written.
        let visible = try await database.snapshot()
        XCTAssertEqual(visible.pages.map(\.id), ["fixture-page"])
        XCTAssertEqual(try Data(contentsOf: url), before)
    }

    func testSnapshotRetainsArchivedState() async throws {
        let url = try fixture()
        try execute(url, "UPDATE pages SET archived=1 WHERE id='fixture-page'")
        let database = try WorldsDatabase(url: url)
        let snapshot = try await database.snapshot()
        XCTAssertEqual(snapshot.pages.first?.archived, true)
    }

    func testExcludesMetadataFlaggedSharedPages() async throws {
        let url = try fixture()
        try execute(url, "UPDATE pages SET metadata = '{\"sync\":{\"shared\":true}}'")
        let database = try WorldsDatabase(url: url)
        let snapshot = try await database.snapshot()
        XCTAssertTrue(snapshot.pages.isEmpty)
    }
    func testSearchHistoryAndConflictReadOnly() async throws {
        let url = try fixture()
        try execute(url, "INSERT INTO history(page_id,actor,kind,summary,created_at) VALUES('fixture-page','user','renamed','Renamed',1700000000002)")
        let database = try WorldsDatabase(url: url)
        let search = try await database.searchPersonalTitles("fixture")
        XCTAssertEqual(search.map(\.id), ["fixture-page"])
        let history = try await database.personalHistory(pageID: "fixture-page")
        XCTAssertEqual(history.first?.kind, "renamed")
        let changed = try await database.pageChangedSince(id: "fixture-page", base: 1700000000000)
        XCTAssertTrue(changed)
    }

    func testCheckedHistoryDistinguishesEmptyFromUnavailable() async throws {
        let url = try fixture()
        let database = try WorldsDatabase(url: url)
        let empty = try await database.checkedPersonalHistory(pageID: "fixture-page")
        XCTAssertTrue(empty.isEmpty)
        try execute(url, "INSERT INTO history(page_id,actor,kind,summary,created_at) VALUES('fixture-page','user','renamed','Renamed',1700000000002)")
        let entries = try await database.checkedPersonalHistory(pageID: "fixture-page")
        XCTAssertEqual(entries.map(\.summary), ["Renamed"])
        for metadata in ["{\"sync\":{\"shared\":true}}", "{\"sync\":{\"shared\":false,\"shared\":true}}", "{\"nested\":{\"x\":1,\"x\":2}}", "{"] {
            try execute(url, "UPDATE pages SET metadata='\(metadata)' WHERE id='fixture-page'")
            do {
                _ = try await database.checkedPersonalHistory(pageID: "fixture-page")
                XCTFail("Unavailable history must not appear empty")
            } catch WorldsDatabaseError.invalidData(let field) { XCTAssertEqual(field, "page unavailable") }
        }
        try execute(url, "UPDATE pages SET metadata='{}', deleted_at=1 WHERE id='fixture-page'")
        do {
            _ = try await database.checkedPersonalHistory(pageID: "fixture-page")
            XCTFail("Deleted page history must not be exposed")
        } catch WorldsDatabaseError.invalidData(let field) { XCTAssertEqual(field, "page unavailable") }
    }

    func testCheckedHistoryRejectsWorkspacePages() async throws {
        let url = try fixture()
        try execute(url, "ALTER TABLE pages ADD COLUMN workspace_id TEXT; UPDATE pages SET workspace_id='shared-workspace' WHERE id='fixture-page'; INSERT INTO history(page_id,actor,kind,summary,created_at) VALUES('fixture-page','user','edited','Private detail',1); PRAGMA user_version=5;")
        let database = try WorldsDatabase(url: url)
        do {
            _ = try await database.checkedPersonalHistory(pageID: "fixture-page")
            XCTFail("Workspace history must not be exposed")
        } catch WorldsDatabaseError.invalidData(let field) { XCTAssertEqual(field, "page unavailable") }
    }
    func testRejectsFutureSchemaWithoutMigration() async throws {
        let url = try fixture()
        try execute(url, "PRAGMA user_version=999")
        let before = try Data(contentsOf: url)
        XCTAssertThrowsError(try WorldsDatabase(url: url))
        XCTAssertEqual(try Data(contentsOf: url), before)
    }

    func testFileAttachmentRequiresMatchingPersonalOwnerAndMetadata() async throws {
        let url = try fixture()
        try execute(url, #"UPDATE pages SET kind='file',metadata='{"file":{"attachmentId":"owned"}}' WHERE id='fixture-page'; INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('owned','fixture-page','file','test.txt','text/plain',4,'2026-01/test.txt',1),('unowned',NULL,'file','other.txt','text/plain',3,'2026-01/other.txt',1);"#)
        let database = try WorldsDatabase(url: url)
        let allowed = try await database.personalFileAttachment(pageID: "fixture-page")
        XCTAssertEqual(allowed?.id, "owned")
        XCTAssertEqual(allowed?.relPath, "2026-01/test.txt")
        try execute(url, #"UPDATE pages SET metadata='{"file":{"attachmentId":"unowned"}}' WHERE id='fixture-page'"#)
        let unowned = try await database.personalFileAttachment(pageID: "fixture-page")
        XCTAssertNil(unowned)
        try execute(url, #"UPDATE pages SET metadata='{"file":{"attachmentId":"owned","attachmentId":"unowned"}}' WHERE id='fixture-page'"#)
        let ambiguous = try await database.personalFileAttachment(pageID: "fixture-page")
        XCTAssertNil(ambiguous)
        try execute(url, #"UPDATE pages SET metadata='{"sync":{"shared":true},"file":{"attachmentId":"owned"}}' WHERE id='fixture-page'"#)
        let shared = try await database.personalFileAttachment(pageID: "fixture-page")
        XCTAssertNil(shared)
    }

    func testInlineImageRequiresPersonalPageOwnershipAndUnambiguousReference() async throws {
        let url = try fixture()
        try execute(url, #"UPDATE blocks SET type='image',content='{"type":"image","attrs":{"attachmentId":"owned","caption":"صورة"}}' WHERE id='fixture-block'; INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('owned','fixture-page','image','test.png','image/png',4,'img/test.png',1),('unowned',NULL,'image','other.png','image/png',3,'img/other.png',1);"#)
        let db = try WorldsDatabase(url: url)
        let found = try await db.personalInlineImage(pageID: "fixture-page", blockID: "fixture-block")
        XCTAssertEqual(found?.id, "owned")
        let cases = [
            #"UPDATE blocks SET content='{"type":"image","attrs":{"attachmentId":"unowned"}}' WHERE id='fixture-block'"#,
            #"UPDATE blocks SET content='{"type":"image","attrs":{"attachmentId":"owned","attachmentId":"unowned"}}' WHERE id='fixture-block'"#,
            #"UPDATE blocks SET content='{"type":"file","attrs":{"attachmentId":"owned"}}' WHERE id='fixture-block'"#,
            #"UPDATE blocks SET content='not-json' WHERE id='fixture-block'"#
        ]
        for statement in cases {
            try execute(url, statement)
            let blocked = try await db.personalInlineImage(pageID: "fixture-page", blockID: "fixture-block")
            XCTAssertNil(blocked)
        }
        try execute(url, #"UPDATE blocks SET content='{"type":"image","attrs":{"attachmentId":"owned"}}' WHERE id='fixture-block'; UPDATE pages SET metadata='{"sync":{"shared":true}}' WHERE id='fixture-page'"#)
        let shared = try await db.personalInlineImage(pageID: "fixture-page", blockID: "fixture-block")
        XCTAssertNil(shared)
        try execute(url, #"UPDATE pages SET metadata='{"future":{"same":1,"same":2}}' WHERE id='fixture-page'"#)
        let duplicate = try await db.personalInlineImage(pageID: "fixture-page", blockID: "fixture-block")
        XCTAssertNil(duplicate)
    }

    func testMissingFileIsNotCreated() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        XCTAssertThrowsError(try WorldsDatabase(url: url))
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }
    func testLegacyAndMalformedSyncMetadataAreFilteredConsistently() async throws {
        let url = try fixture()
        try execute(url, """
        UPDATE pages SET metadata='{}' WHERE id='fixture-page';
        INSERT INTO pages(id,title,metadata,created_at,updated_at) VALUES
          ('legacy','Legacy','{"other":1}',1,1),
          ('syncempty','Legacy sync','{"sync":{}}',1,1),
          ('private','Personal','{"sync":{"shared":false}}',1,1),
          ('shared','Shared','{"sync":{"shared":true}}',1,1),
          ('numeric','Numeric','{"sync":{"shared":0}}',1,1),
          ('string','String','{"sync":{"shared":"false"}}',1,1),
          ('nullflag','Null flag','{"sync":{"shared":null}}',1,1),
          ('nullsync','Null sync','{"sync":null}',1,1),
          ('array','Array sync','{"sync":[]}',1,1),
          ('dupsync','Duplicate sync','{"sync":{"shared":false},"sync":{"shared":true}}',1,1),
          ('dupflag','Duplicate flag','{"sync":{"shared":false,"shared":true}}',1,1),
          ('invalid','Broken','{',1,1),
          ('nonobject','Nonobject','[]',1,1);
        INSERT INTO history(page_id,actor,kind,summary,created_at)
          SELECT id,'user','edit','example',1 FROM pages;
        """)
        let database = try WorldsDatabase(url: url)
        let visible = try await database.snapshot()
        let expected: Set<String> = ["fixture-page", "legacy", "syncempty", "private"]
        XCTAssertEqual(Set(visible.pages.map(\.id)), expected)
        for id in ["fixture-page", "legacy", "syncempty", "private", "shared", "numeric", "string", "nullflag", "nullsync", "array", "dupsync", "dupflag", "invalid", "nonobject"] {
            let history = try await database.personalHistory(pageID: id)
            XCTAssertEqual(!history.isEmpty, expected.contains(id), "History eligibility differs for \(id)")
        }
    }

}


