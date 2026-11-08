import Foundation
import XCTest
import WorldsRustStore
import WorldsRustCollaboration

final class CombinedFFITests: XCTestCase {
    func testBothLibrariesAllocateAndFreeTheirOwnObjects() throws {
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = directory.appendingPathComponent("fixture.db")
        try FileManager.default.copyItem(at: fixture, to: database)
        let request = Data(#"{"operation":"sqlite_info"}"#.utf8)
        for _ in 0..<64 {
            let json = request.withUnsafeBytes { bytes in
                WorldsRustStore.worlds_store_call(bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count)
            }
            let response = try XCTUnwrap(json)
            let text = String(cString: response)
            WorldsRustStore.worlds_store_free(response)
            let parsed = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
            XCTAssertEqual(parsed["ok"] as? Bool, true)
            var handle: OpaquePointer?
            let status = database.path.withCString { path in
                "fixture-page".withCString { page in
                    "editor".withCString { user in
                        "fixture-workspace".withCString { workspace in
                            WorldsRustCollaboration.worlds_store_open(path, page, user, workspace, &handle)
                        }
                    }
                }
            }
            XCTAssertEqual(status, 0)
            let store = try XCTUnwrap(handle)
            var pending: Int64 = -1
            XCTAssertEqual(WorldsRustCollaboration.worlds_store_max_pending(store, 0, &pending), 0)
            WorldsRustCollaboration.worlds_collaboration_store_free(store)
        }
    }
}
