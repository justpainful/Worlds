import Foundation
import XCTest
@testable import WorldsCollaboration

/// Runs only against the repository's local Worker and its disposable identity stand-in.
final class LiveWorkerTests: XCTestCase {
    private let page = "fixture-page"
    private let workspace = "fixture-workspace"
    private let base = Data(base64Encoded: "AQbpBwAEAQZzaGFyZWQKSGVsbG8g8J+MjQcBB2RlZmF1bHQDCXBhcmFncmFwaAcA6QcIBgYA6QcJBGJvbGQEdHJ1ZYTpBwoNWWpzIHJpY2ggdGV4dIbpBxcEYm9sZARudWxsAA==")!
    private let alice = Data(base64Encoded: "AQHRDwDE6QcF6QcGBkFsaWNlIAA=")!
    private let bob = Data(base64Encoded: "AQHSDwDE6QcF6QcGBEJvYiAA")!

    private func fixture(_ identity: String) throws -> URL {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-\(identity)-v11", withExtension: "db"))
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-live-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: copy)
        return copy
    }
    private func makeStore(_ url: URL, user: String) throws -> SQLiteCollaborationStore {
        try SQLiteCollaborationStore(databaseURL: url, pageID: page, userID: user, workspaceID: workspace)
    }
    private func makeSession(_ store: SQLiteCollaborationStore, user: String, token: String, document: String) throws -> CollaborationSession {
        try CollaborationSession(pageID: page, workspaceID: workspace, documentID: document, expectedUserID: user,
            serverURL: URL(string: "http://127.0.0.1:18790")!, store: store, tokenProvider: { _ in token })
    }
    private func document(_ store: SQLiteCollaborationStore) async throws -> NativeCRDTDocument {
        let doc = try NativeCRDTDocument()
        for update in try await store.load(pageID: page, channel: 0) { try doc.apply(update) }
        return doc
    }
    private func equivalent(_ one: NativeCRDTDocument, _ two: NativeCRDTDocument) throws -> Bool {
        try one.diff(two.vector()) == Data([0, 0]) && two.diff(one.vector()) == Data([0, 0])
    }

    func testLiveSwiftSessionsConvergeReconnectAndArchiveRefusal() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["WORLDS_REQUIRE_LIVE_SERVICE"] == "1" else { throw XCTSkip("Local Worker integration was not requested") }
        guard env["WORLDS_LIVE_SYNC_URL"] == "ws://127.0.0.1:18790",
              let editor = env["WORLDS_LIVE_EDITOR_TOKEN"], !editor.isEmpty,
              let viewer = env["WORLDS_LIVE_VIEWER_TOKEN"], !viewer.isEmpty else {
            XCTFail("Local-only Worker URL and test identities are required")
            return
        }
        let paths = try [fixture("editor"), fixture("editor"), fixture("viewer")]
        defer { for path in paths { try? FileManager.default.removeItem(at: path) } }
        let a = try makeStore(paths[0], user: "editor")
        let b = try makeStore(paths[1], user: "editor")
        let v = try makeStore(paths[2], user: "viewer")
        try await a.appendLocal(pageID: page, channel: 0, update: base)
        try await a.appendLocal(pageID: page, channel: 0, update: alice)
        try await b.appendLocal(pageID: page, channel: 0, update: base)
        try await b.appendLocal(pageID: page, channel: 0, update: bob)
        let expected = try NativeCRDTDocument()
        try expected.apply(base); try expected.apply(alice); try expected.apply(bob)
        let docID = "swiftlive" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let aSession = try makeSession(a, user: "editor", token: editor, document: docID)
        let bSession = try makeSession(b, user: "editor", token: editor, document: docID)
        let aRun = Task { try await aSession.run() }
        let bRun = Task { try await bSession.run() }
        var converged = false
        for _ in 0..<200 {
            let aPending = try await a.maximumPendingID(pageID: page, channel: 0)
            let bPending = try await b.maximumPendingID(pageID: page, channel: 0)
            let da = try await document(a); let db = try await document(b)
            let matchesA = try equivalent(da, expected)
            let matchesB = try equivalent(db, expected)
            if aPending == nil && bPending == nil && matchesA && matchesB {
                converged = true; break
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        await aSession.stop(); await bSession.stop()
        try await aRun.value; try await bRun.value
        XCTAssertTrue(converged, "Two Swift sessions did not converge and acknowledge their outboxes")

        let reopened = try makeSession(a, user: "editor", token: editor, document: docID)
        let reopenedRun = Task { try await reopened.run() }
        var reconnected = false
        for _ in 0..<100 {
            if await reopened.accessLevel == "edit" { reconnected = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        await reopened.stop(); try await reopenedRun.value
        XCTAssertTrue(reconnected, "Swift session did not reconnect")
        let restored = try await document(a)
        XCTAssertTrue(try equivalent(restored, expected))

        try await v.appendLocal(pageID: page, channel: 0, update: base)
        let deniedSession = try makeSession(v, user: "viewer", token: viewer, document: docID + "denied")
        let deniedRun = Task { try await deniedSession.run() }
        var archived = false
        for _ in 0..<100 {
            if try await v.maximumPendingID(pageID: page, channel: 0) == nil { archived = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        if !archived { await deniedSession.stop() }
        do { try await deniedRun.value; XCTFail("Viewer write must be rejected") }
        catch CollaborationError.rejected(_) { }
        catch { XCTFail("Unexpected service error: \(error)") }
        XCTAssertTrue(archived, "Refused update was not archived")
        let recovered = try await v.load(pageID: page, channel: 0)
        XCTAssertEqual(recovered, [Data([0, 0])])
    }
}

