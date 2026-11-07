import Foundation
import XCTest
import WorldsModels
import WorldsRustStore
import SQLite3
@testable import WorldsNativeWrites

final class NativePersonalStoreTests: XCTestCase {
    private func fixture() throws -> URL {
        let original = try XCTUnwrap(Bundle.module.url(forResource: "worlds-v11", withExtension: "db"))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let copy = dir.appendingPathComponent("worlds.db")
        try FileManager.default.copyItem(at: original, to: copy)
        return copy
    }

    func testRenameAndConflictThroughNativeBridge() async throws {
        let url = try fixture()
        let store = try NativePersonalStore(url: url)
        let result = try await store.renamePage(id: "fixture-page", base: 1_700_000_000_001, title: "Updated from Swift")
        guard case .object(let page) = result else { return XCTFail("Expected a page") }
        XCTAssertEqual(page["title"], .string("Updated from Swift"))
        do {
            _ = try await store.renamePage(id: "fixture-page", base: 1_700_000_000_001, title: "Stale")
            XCTFail("Stale changes must fail")
        } catch NativeWriteError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
    }

    func testSaveBlocksPreservesJSON() async throws {
        let url = try fixture()
        let store = try NativePersonalStore(url: url)
        let content: JSONValue = .object(["type": .string("paragraph"), "content": .array([.object(["type": .string("text"), "text": .string("Hello from Swift")])])])
        let result = try await store.saveBlocks(pageID: "fixture-page", base: 1_700_000_000_001, blocks: [NativeBlockInput(id: "fixture-block", content: content)])
        guard case .object(let saved) = result else { return XCTFail("Expected save result") }
        XCTAssertEqual(saved["changed"], .integer(1))
        var database: OpaquePointer?
        XCTAssertEqual(sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READONLY, nil), SQLITE_OK)
        let handle = try XCTUnwrap(database)
        defer { sqlite3_close(handle) }
        var statement: OpaquePointer?
        XCTAssertEqual(sqlite3_prepare_v2(handle, "SELECT count(*) FROM pages_fts WHERE pages_fts MATCH 'Swift'", -1, &statement, nil), SQLITE_OK)
        let query = try XCTUnwrap(statement)
        defer { sqlite3_finalize(query) }
        XCTAssertEqual(sqlite3_step(query), SQLITE_ROW)
        XCTAssertEqual(sqlite3_column_int(query, 0), 1)
    }

    func testSQLiteLinkageAndFTSAvailability() throws {
        let request = Data("{\"operation\":\"sqlite_info\"}".utf8)
        let pointer = request.withUnsafeBytes { bytes in
            worlds_store_call(bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count)
        }
        let response = try XCTUnwrap(pointer)
        defer { worlds_store_free(response) }
        let value = try JSONSerialization.jsonObject(with: Data(String(cString: response).utf8)) as? [String: Any]
        let details = try XCTUnwrap(value?["value"] as? [String: Any])
        XCTAssertEqual(details["fts5"] as? Bool, true)
        XCTAssertEqual(details["version"] as? String, String(cString: sqlite3_libversion()), "Swift and Rust are resolving different SQLite builds; review linkage before enabling writes.")
    }
    func testMissingFileFails() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try NativePersonalStore(url: url)
        do {
            _ = try await store.createPage(title: "No file")
            XCTFail("Missing databases must not be created")
        } catch NativeWriteError.invalidFileURL { } catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }
}

