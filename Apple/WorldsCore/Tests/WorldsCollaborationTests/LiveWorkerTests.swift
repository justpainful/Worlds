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
    func testLiveAwarenessExchangeAndDisconnect() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["WORLDS_REQUIRE_LIVE_SERVICE"] == "1" else { throw XCTSkip("Local Worker integration was not requested") }
        guard env["WORLDS_LIVE_SYNC_URL"] == "ws://127.0.0.1:18790",
              let editor = env["WORLDS_LIVE_EDITOR_TOKEN"], !editor.isEmpty,
              let viewer = env["WORLDS_LIVE_VIEWER_TOKEN"], !viewer.isEmpty else { return XCTFail("Local Worker credentials are required") }
        let paths = try [fixture("editor"), fixture("viewer")]
        defer { for path in paths { try? FileManager.default.removeItem(at: path) } }
        let a = try makeStore(paths[0], user: "editor"), b = try makeStore(paths[1], user: "viewer")
        let doc = "awareness" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let alice = try makeSession(a, user: "editor", token: editor, document: doc)
        let bob = try makeSession(b, user: "viewer", token: viewer, document: doc)
        try await alice.setPresence(name: "Alice", color: "#123456")
        try await bob.setPresence(name: "Bob", color: "#654321")
        let arun = Task { try await alice.run() }, brun = Task { try await bob.run() }
        var seen = false
        for _ in 0..<100 {
            let peers = await bob.presenceSnapshot()
            if peers.values.contains(where: { $0.json.contains("Alice") && $0.json.contains("editor") }) { seen = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertTrue(seen, "Authenticated Alice should appear to Bob")
        await alice.stop(); try await arun.value
        var removed = false
        for _ in 0..<100 {
            let peers = await bob.presenceSnapshot()
            if !peers.values.contains(where: { $0.json.contains("Alice") }) { removed = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertTrue(removed, "Alice should disappear after socket closes")
        let reopened = try makeSession(a, user: "editor", token: editor, document: doc)
        try await reopened.setPresence(name: "Alice", color: "#123456")
        let rerun = Task { try await reopened.run() }
        var returned = false
        for _ in 0..<100 {
            let peers = await bob.presenceSnapshot()
            if peers.values.contains(where: { $0.json.contains("Alice") }) { returned = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        await reopened.stop(); await bob.stop()
        try await rerun.value; try await brun.value
        XCTAssertTrue(returned, "Alice should reappear after reconnecting")
    }

    func testLiveCheckedEditorsConvergeAfterReconnect() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["WORLDS_REQUIRE_LIVE_SERVICE"] == "1" else { throw XCTSkip("Local Worker integration was not requested") }
        guard env["WORLDS_LIVE_SYNC_URL"] == "ws://127.0.0.1:18790",
              let token = env["WORLDS_LIVE_EDITOR_TOKEN"], !token.isEmpty else { return XCTFail("Local Worker identity is required") }
        let paths = try [fixture("editor"), fixture("editor")]
        defer { for path in paths { try? FileManager.default.removeItem(at: path) } }
        let a = try makeStore(paths[0], user: "editor"), b = try makeStore(paths[1], user: "editor")
        let base = try XCTUnwrap(Data(base64Encoded: "AQTpBwAHAQdkZWZhdWx0AwlwYXJhZ3JhcGgoAOkHAANiaWQBdwdibG9jay0xBwDpBwAGBADpBwIKSGVsbG8g8J+MjQA="))
        try await a.appendLocal(pageID: page, channel: 0, update: base)
        let docID = "edit" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let alice = try makeSession(a, user: "editor", token: token, document: docID)
        let bob = try makeSession(b, user: "editor", token: token, document: docID)
        let arun = Task { try await alice.run() }, brun = Task { try await bob.run() }
        let initial = try NativeCRDTDocument(); try initial.apply(base)
        var ready = false
        for _ in 0..<200 {
            let da = try await document(a), db = try await document(b)
            if await alice.accessLevel == "edit", await bob.accessLevel == "edit",
               try equivalent(da, initial), try equivalent(db, initial),
               try await a.maximumPendingID(pageID: page, channel: 0) == nil { ready = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        guard ready else { await alice.stop(); await bob.stop(); _ = try? await arun.value; _ = try? await brun.value; return XCTFail("Clients did not synchronize the base") }
        try await alice.insertPlain(blockIndex: 0, blockID: "block-1", expected: "Hello 🌍", offset: 6, insertion: "Alice ")
        let afterAlice = try NativeCRDTDocument()
        for update in try await a.load(pageID: page, channel: 0) { try afterAlice.apply(update) }
        var receivedAlice = false
        for _ in 0..<200 {
            let replica = try await document(b)
            if await bob.accessLevel == "edit", try equivalent(replica, afterAlice) { receivedAlice = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        guard receivedAlice else { await alice.stop(); await bob.stop(); _ = try? await arun.value; _ = try? await brun.value; return XCTFail("Bob did not receive Alice's edit") }
        try await bob.insertPlain(blockIndex: 0, blockID: "block-1", expected: "Hello Alice 🌍", offset: 12, insertion: "Bob ")
        let expected = try NativeCRDTDocument()
        for update in try await a.load(pageID: page, channel: 0) { try expected.apply(update) }
        for update in try await b.load(pageID: page, channel: 0) { try expected.apply(update) }
        var converged = false
        for _ in 0..<200 {
            let da = try await document(a), db = try await document(b)
            let aPending = try await a.maximumPendingID(pageID: page, channel: 0)
            let bPending = try await b.maximumPendingID(pageID: page, channel: 0)
            if aPending == nil, bPending == nil, try equivalent(da, expected), try equivalent(db, expected) { converged = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        await alice.stop(); await bob.stop(); try await arun.value; try await brun.value
        XCTAssertTrue(converged, "Both durable edits should converge after socket reconnect")
    }

}

