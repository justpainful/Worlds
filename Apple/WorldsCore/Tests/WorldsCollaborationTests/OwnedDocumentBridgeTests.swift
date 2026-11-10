import Foundation
import XCTest
@testable import WorldsCollaboration

final class OwnedDocumentBridgeTests: XCTestCase {
    func testOwnedBridgeRejectsForeignServerAndRetainsPending() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("owned-bridge-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: copy)
        defer { try? FileManager.default.removeItem(at: copy) }
        let store = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let server = "https://fixture.invalid"
        try await store.enrollEmptyOwnedDocument(channel: 0, server: server)
        let base = try XCTUnwrap(Data(base64Encoded: "AQbpBwAEAQZzaGFyZWQKSGVsbG8g8J+MjQcBB2RlZmF1bHQDCXBhcmFncmFwaAcA6QcIBgYA6QcJBGJvbGQEdHJ1ZYTpBwoNWWpzIHJpY2ggdGV4dIbpBxcEYm9sZARudWxsAA=="))
        try await store.appendOwnedDocument(channel: 0, server: server, update: base, local: true)
        do {
            _ = try await store.ownedDocumentBatch(channel: 0, server: "https://other.invalid", vector: Data([0]))
            XCTFail("A different server cannot read the owned document")
        } catch CollaborationStorageError.denied { }
        let batch = try await store.ownedDocumentBatch(channel: 0, server: server, vector: Data([0]))
        XCTAssertFalse(batch.data.isEmpty)
        XCTAssertNotNil(batch.watermark)
        let reopened = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let persisted = try await reopened.ownedDocumentBatch(channel: 0, server: server, vector: Data([0]))
        XCTAssertEqual(batch.data, persisted.data)
        XCTAssertEqual(batch.watermark, persisted.watermark)
    }
}
