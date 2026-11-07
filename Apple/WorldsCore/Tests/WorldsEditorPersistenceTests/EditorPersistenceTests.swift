import Foundation
import SQLite3
import XCTest
import WorldsModels
import WorldsPersistence
import WorldsNativeWrites
import WorldsNativeEditor
@testable import WorldsEditorPersistence

final class EditorPersistenceTests: XCTestCase {
    private func fixture() throws -> URL {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "editor-fixture", withExtension: "db"))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("worlds.db")
        try FileManager.default.copyItem(at: source, to: url)
        return url
    }
    private func exec(_ sql: String, url: URL) throws {
        var raw: OpaquePointer?
        guard sqlite3_open_v2(url.path, &raw, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK, let db = raw else { throw EditorBridgeError.unavailable }
        defer { sqlite3_close_v2(db) }
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw EditorBridgeError.unavailable }
    }
    @MainActor
    func testEditorSavePreservesUnknownNodeAndAttributes() async throws {
        let url = try fixture()
        let db = try WorldsDatabase(url: url)
        let snapshot = try await db.snapshot()
        let page = try XCTUnwrap(snapshot.pages.first(where: { $0.id == "fixture-page" }))
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: page.id)
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        _ = try model.replace(range: NSRange(location: 6, length: 6), with: "Swift")
        try await model.save(using: bridge)
        XCTAssertFalse(model.dirty)
        let savedSnapshot = try await db.snapshot()
        let saved = try XCTUnwrap(savedSnapshot.pages.first(where: { $0.id == "fixture-page" }))
        let content = try JSONDecoder().decode(JSONValue.self, from: Data(saved.blocks[0].contentJSON.utf8))
        guard case .object(let node) = content, case .object(let attrs)? = node["attrs"],
              case .array(let children)? = node["content"], case .object(let text) = children[0] else { return XCTFail("Missing source fields") }
        XCTAssertEqual(attrs["bid"], .string("fixture-block"))
        XCTAssertEqual(attrs["custom"], .string("preserve"))
        XCTAssertEqual(node["futureNodeFlag"], .object(["keep": .bool(true)]))
        XCTAssertEqual(text["text"], .string("Hello Swift"))
        XCTAssertEqual(text["marks"], .array([.object(["type": .string("futureMark"), "attrs": .object(["flag": .integer(7)])])]))
    }
    @MainActor
    func testConflictAtSameTimestampKeepsDirtyEditorAndDatabase() async throws {
        let url = try fixture(); let db = try WorldsDatabase(url: url)
        let snapshot = try await db.snapshot()
        let page = try XCTUnwrap(snapshot.pages.first(where: { $0.id == "fixture-page" }))
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: page.id)
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        _ = try model.replace(range: NSRange(location: 0,length: 5), with: "Mine")
        try exec("UPDATE blocks SET content='{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Other\"}]}' WHERE id='fixture-block'", url: url)
        do { try await model.save(using: bridge); XCTFail("Concurrent edit must fail") }
        catch NativeWriteError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertTrue(model.dirty)
        let latestSnapshot = try await db.snapshot()
        let latest = try XCTUnwrap(latestSnapshot.pages.first(where: { $0.id == "fixture-page" }))
        XCTAssertTrue(latest.blocks[0].contentJSON.contains("Other"))
    }
    @MainActor
    func testTwoEditorSessionsRejectStaleSnapshot() async throws {
        let url = try fixture()
        let first = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let second = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let a = NativeEditorModel(document: first.initialDocument, baseRevision: first.initialRevision)
        let b = NativeEditorModel(document: second.initialDocument, baseRevision: second.initialRevision)
        _ = try a.replace(range: NSRange(location: 0,length: 5), with: "First")
        _ = try b.replace(range: NSRange(location: 0,length: 5), with: "Other")
        try await a.save(using: first)
        do { try await b.save(using: second); XCTFail("Stale session must fail") }
        catch NativeWriteError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertTrue(b.dirty)
        let reader = try WorldsDatabase(url: url)
        let snapshot = try await reader.snapshot()
        let page = try XCTUnwrap(snapshot.pages.first(where: { $0.id == "fixture-page" }))
        XCTAssertTrue(page.blocks[0].contentJSON.contains("First"))
    }
    @MainActor
    func testRejectsReorderedBlocksWithoutTimestampChange() async throws {
        let url = try fixture()
        try exec("INSERT INTO blocks(id,page_id,type,sort_key,content,text,direction,created_at,updated_at) SELECT 'second',page_id,type,10,content,text,direction,created_at,updated_at FROM blocks WHERE id='fixture-block'", url: url)
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: "fixture-page")
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        _ = try model.replace(range: NSRange(location: 0,length: 5), with: "Mine")
        try exec("UPDATE blocks SET sort_key=-1 WHERE id='second'", url: url)
        do { try await model.save(using: bridge); XCTFail("Reordering must conflict") }
        catch NativeWriteError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertTrue(model.dirty)
        let reader = try WorldsDatabase(url: url)
        let snapshot = try await reader.snapshot()
        let page = try XCTUnwrap(snapshot.pages.first(where: { $0.id == "fixture-page" }))
        XCTAssertEqual(page.blocks.map(\.id), ["second", "fixture-block"])
    }
    @MainActor
    func testRejectsPageBecomingSharedBeforeSave() async throws {
        let url = try fixture(); let db = try WorldsDatabase(url: url)
        let snapshot = try await db.snapshot()
        let page = try XCTUnwrap(snapshot.pages.first(where: { $0.id == "fixture-page" }))
        let bridge = try await PersonalEditorPersistence.open(databaseURL: url, pageID: page.id)
        let model = NativeEditorModel(document: bridge.initialDocument, baseRevision: bridge.initialRevision)
        _ = try model.replace(range: NSRange(location: 0,length: 5), with: "Mine")
        try exec("UPDATE pages SET workspace_id='shared' WHERE id='fixture-page'", url: url)
        do { try await model.save(using: bridge); XCTFail("Shared-page write must fail") } catch { }
        XCTAssertTrue(model.dirty)
    }
}
