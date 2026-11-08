import Foundation
import XCTest
import WorldsSyncWire
@testable import WorldsCollaboration
private actor ProjectionChangeProbe {
    private(set) var formatted = false
    func record() { formatted = true }
}

/// Runs only against the repository's local Worker and its disposable identity stand-in.
final class LiveWorkerTests: XCTestCase {
    private let page = "fixture-page"
    private let workspace = "fixture-workspace"
    private let base = Data(base64Encoded: "AQbpBwAEAQZzaGFyZWQKSGVsbG8g8J+MjQcBB2RlZmF1bHQDCXBhcmFncmFwaAcA6QcIBgYA6QcJBGJvbGQEdHJ1ZYTpBwoNWWpzIHJpY2ggdGV4dIbpBxcEYm9sZARudWxsAA==")!
    private let alice = Data(base64Encoded: "AQHRDwDE6QcF6QcGBkFsaWNlIAA=")!
    private let bob = Data(base64Encoded: "AQHSDwDE6QcF6QcGBEJvYiAA")!

    #if DEBUG
    func testLiveWorkerPongDoesNotCloseBinaryTransport() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["WORLDS_REQUIRE_LIVE_SERVICE"] == "1" else { throw XCTSkip("Local Worker integration was not requested") }
        guard env["WORLDS_LIVE_SYNC_URL"] == "ws://127.0.0.1:18790", let token = env["WORLDS_LIVE_EDITOR_TOKEN"], !token.isEmpty else {
            return XCTFail("Local Worker credentials are required")
        }
        let document = "pong" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let url = try XCTUnwrap(URL(string: "ws://127.0.0.1:18790/v1/workspaces/fixture-workspace/docs/\(document)/sync"))
        let socket = URLSessionCollaborationSocket(url: url, token: token)
        defer { Task { await socket.close() } }
        try await socket.sendFixturePing()
        try await socket.send(WorldsSyncWire.encode(.queryAwareness))
        var observed = false
        for _ in 0..<6 {
            guard let data = try await socket.receive() else { return XCTFail("Text pong closed the binary receive loop") }
            if case .awareness = try WorldsSyncWire.decode(data) { observed = true; break }
        }
        XCTAssertTrue(observed, "Expected an awareness response after the pong")
    }
    #endif

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
        func trace(_ message: String) { FileHandle.standardError.write(Data("awareness-diagnostic: \(message)\n".utf8)) }
        trace("begin")
        let env = ProcessInfo.processInfo.environment
        guard env["WORLDS_REQUIRE_LIVE_SERVICE"] == "1" else { throw XCTSkip("Local Worker integration was not requested") }
        guard env["WORLDS_LIVE_SYNC_URL"] == "ws://127.0.0.1:18790",
              let editor = env["WORLDS_LIVE_EDITOR_TOKEN"], !editor.isEmpty,
              let viewer = env["WORLDS_LIVE_VIEWER_TOKEN"], !viewer.isEmpty else { return XCTFail("Local Worker credentials are required") }
        trace("copy fixtures")
        let paths = try [fixture("editor"), fixture("viewer")]
        trace("fixtures copied")
        defer { for path in paths { try? FileManager.default.removeItem(at: path) } }
        trace("open editor store")
        let a = try makeStore(paths[0], user: "editor")
        trace("open viewer store")
        let b = try makeStore(paths[1], user: "viewer")
        trace("stores open")
        let doc = "awareness" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        trace("create sessions")
        let alice = try makeSession(a, user: "editor", token: editor, document: doc)
        let bob = try makeSession(b, user: "viewer", token: viewer, document: doc)
        trace("set Alice presence")
        try await alice.setPresence(name: "Alice", color: "#123456")
        trace("set Bob presence")
        try await bob.setPresence(name: "Bob", color: "#654321")
        trace("start sessions")
        let arun = Task { try await alice.run() }, brun = Task { try await bob.run() }
        var seen = false
        for _ in 0..<100 {
            let peers = await bob.presenceSnapshot()
            if peers.values.contains(where: { $0.json.contains("Alice") && $0.json.contains("editor") }) { seen = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        trace("finished first presence wait")
        XCTAssertTrue(seen, "Authenticated Alice should appear to Bob")
        trace("stop Alice")
        await alice.stop(); try await arun.value
        var removed = false
        for _ in 0..<100 {
            let peers = await bob.presenceSnapshot()
            if !peers.values.contains(where: { $0.json.contains("Alice") }) { removed = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        trace("finished removal wait")
        XCTAssertTrue(removed, "Alice should disappear after socket closes")
        trace("create replacement session")
        let reopened = try makeSession(a, user: "editor", token: editor, document: doc)
        try await reopened.setPresence(name: "Alice", color: "#123456")
        let rerun = Task { try await reopened.run() }
        var returned = false
        for _ in 0..<100 {
            let peers = await bob.presenceSnapshot()
            if peers.values.contains(where: { $0.json.contains("Alice") }) { returned = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        trace("stop replacement and Bob")
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
               try await a.maximumPendingID(pageID: page, channel: 0) == nil,
               (try? await alice.plainEditorProjection()) != nil,
               (try? await bob.plainEditorProjection()) != nil { ready = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        guard ready else { await alice.stop(); await bob.stop(); _ = try? await arun.value; _ = try? await brun.value; return XCTFail("Clients did not synchronize the base") }
        let projection = try await alice.plainEditorProjection()
        let tree = try XCTUnwrap(try JSONSerialization.jsonObject(with: projection) as? [String: Any])
        let paragraphs = try XCTUnwrap(tree["content"] as? [[String: Any]])
        let content = try XCTUnwrap(paragraphs.first?["content"] as? [[String: Any]])
        XCTAssertEqual(content.first?["text"] as? String, "Hello 🌍")
        let bobInitial = try await bob.plainEditorSnapshot()
        try await alice.insertPlain(blockIndex: 0, blockID: "block-1", expected: "Hello 🌍", offset: 6, insertion: "Alice ")
        let afterAlice = try NativeCRDTDocument()
        for update in try await a.load(pageID: page, channel: 0) { try afterAlice.apply(update) }
        var receivedAlice = false
        for _ in 0..<200 {
            let replica = try await document(b)
            if await bob.accessLevel == "edit", try equivalent(replica, afterAlice),
               (try? await bob.plainEditorSnapshot()) != nil { receivedAlice = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        guard receivedAlice else { await alice.stop(); await bob.stop(); _ = try? await arun.value; _ = try? await brun.value; return XCTFail("Bob did not receive Alice's edit") }
        do {
            try await bob.insertPlain(blockIndex: 0, blockID: "block-1", expected: "Hello Alice 🌍", offset: 12, insertion: "stale", expectedState: bobInitial.state)
            XCTFail("A selection tied to an older projection must not write")
        } catch CollaborationError.staleProjection { } catch { XCTFail("Unexpected error: \(error)") }
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
        if converged {
            var current: PlainEditorProjection?
            for _ in 0..<100 {
                if let snapshot = try? await bob.plainEditorSnapshot() { current = snapshot; break }
                try await Task.sleep(for: .milliseconds(100))
            }
            let snapshot = try XCTUnwrap(current)
            let signals = await alice.editorChanges()
            let probe = ProjectionChangeProbe()
            let observer = Task {
                for await _ in signals {
                    if let json = try? await alice.plainEditorProjection(), let text = String(data: json, encoding: .utf8), text.contains("italic") {
                        await probe.record(); break
                    }
                }
            }
            try await bob.formatPlain(blockIndex: 0, blockID: "block-1", expected: "Hello Alice Bob 🌍", offset: 6, length: 5, mark: "italic", enabled: true, expectedState: snapshot.state)
            var observed = false
            for _ in 0..<200 {
                if await probe.formatted { observed = true; break }
                try await Task.sleep(for: .milliseconds(100))
            }
            observer.cancel()
            XCTAssertTrue(observed, "Formatting should reach the other replica")
        }
        await alice.stop(); await bob.stop(); try await arun.value; try await brun.value
        XCTAssertTrue(converged, "Both durable edits should converge after socket reconnect")
    }

}

final class TransportDiagnosticsTests: XCTestCase {
    /// Diagnostic A/B on an isolated local Worker and disposable fixture tokens.
    /// The shared session is never used by product code or non-loopback endpoints.
    private func diagnosticTransport(useSharedSession: Bool) async throws {
        let trace: @Sendable (String) -> Void = { message in FileHandle.standardError.write(Data("transport-diagnostic: \(message)\n".utf8)) }
        let env = ProcessInfo.processInfo.environment
        guard env["WORLDS_REQUIRE_LIVE_SERVICE"] == "1" else { throw XCTSkip("Local Worker integration was not requested") }
        guard env["WORLDS_LIVE_SYNC_URL"] == "ws://127.0.0.1:18790", let token = env["WORLDS_LIVE_EDITOR_TOKEN"], !token.isEmpty else { return XCTFail("Local-only fixture token required") }
        trace("fixture")
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-diagnostic-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: path)
        defer { try? FileManager.default.removeItem(at: path) }
        let page = "fixture-page", workspace = "fixture-workspace"
        let store = try SQLiteCollaborationStore(databaseURL: path, pageID: page, userID: "editor", workspaceID: workspace)
        let documentID = "diagnostic" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        trace(useSharedSession ? "create shared-session client" : "create hardened-session client")
        let session = try CollaborationSession(pageID: page, workspaceID: workspace, documentID: documentID, expectedUserID: "editor",
            serverURL: URL(string: "http://127.0.0.1:18790")!, store: store, tokenProvider: { _ in token },
            socketFactory: { url, token in
                guard url.host == "127.0.0.1", url.port == 18790 else { throw CollaborationError.invalidEndpoint }
                trace(useSharedSession ? "open shared-session socket" : "open hardened-session socket")
                if useSharedSession { return URLSessionCollaborationSocket(url: url, token: token, session: .shared) }
                return URLSessionCollaborationSocket(url: url, token: token)
            })
        trace("start run")
        let run = Task { try await session.run() }
        var connected = false
        for _ in 0..<100 {
            if await session.accessLevel == "edit" { connected = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        trace(connected ? "authenticated" : "authentication timeout")
        await session.stop(); try await run.value
        XCTAssertTrue(connected, "Local diagnostic did not authenticate")
    }
    func testDiagnosticDefaultTransportLoopbackHandshake() async throws { try await diagnosticTransport(useSharedSession: false) }
    func testDiagnosticSharedSessionLoopbackHandshake() async throws { try await diagnosticTransport(useSharedSession: true) }

    private func diagnosticPresenceIsolation(dual: Bool, explicitFactory: Bool = false, includePresence: Bool = true) async throws {
        func trace(_ value: String) { FileHandle.standardError.write(Data("awareness-isolation: \(value)\n".utf8)) }
        let env = ProcessInfo.processInfo.environment
        guard env["WORLDS_REQUIRE_LIVE_SERVICE"] == "1" else { throw XCTSkip("Local Worker integration was not requested") }
        guard env["WORLDS_LIVE_SYNC_URL"] == "ws://127.0.0.1:18790",
              let editor = env["WORLDS_LIVE_EDITOR_TOKEN"], !editor.isEmpty,
              let viewer = env["WORLDS_LIVE_VIEWER_TOKEN"], !viewer.isEmpty else { return XCTFail("Local fixture tokens are required") }
        let names = dual ? ["editor", "viewer"] : ["editor"]
        var paths: [URL] = []
        defer { for path in paths { try? FileManager.default.removeItem(at: path) } }
        for name in names {
            let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-\(name)-v11", withExtension: "db"))
            let path = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-isolation-\(UUID().uuidString).db")
            try FileManager.default.copyItem(at: source, to: path); paths.append(path)
        }
        let doc = "isolation" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let page = "fixture-page", workspace = "fixture-workspace", server = URL(string: "http://127.0.0.1:18790")!
        func session(store: SQLiteCollaborationStore, user: String, token: String) throws -> CollaborationSession {
            if explicitFactory {
                return try CollaborationSession(pageID: page, workspaceID: workspace, documentID: doc, expectedUserID: user, serverURL: server, store: store,
                    tokenProvider: { _ in token }, socketFactory: { url, token in URLSessionCollaborationSocket(url: url, token: token) })
            }
            return try CollaborationSession(pageID: page, workspaceID: workspace, documentID: doc, expectedUserID: user, serverURL: server, store: store, tokenProvider: { _ in token })
        }
        trace("open first store")
        let a = try SQLiteCollaborationStore(databaseURL: paths[0], pageID: page, userID: "editor", workspaceID: workspace)
        let alice = try session(store: a, user: "editor", token: editor)
        var bob: CollaborationSession?
        if dual {
            trace("open second store")
            let b = try SQLiteCollaborationStore(databaseURL: paths[1], pageID: page, userID: "viewer", workspaceID: workspace)
            bob = try session(store: b, user: "viewer", token: viewer)
        } else if includePresence {
            trace("set one presence")
            try await alice.setPresence(name: "Alice", color: "#123456")
        }
        trace("start sessions")
        let arun = Task { try await alice.run() }
        let brun: Task<Void, Error>? = bob.map { session in Task { try await session.run() } }
        var connected = false
        for _ in 0..<100 {
            let alevel = await alice.accessLevel
            let blevel = await bob?.accessLevel
            if alevel == "edit", !dual || blevel == "view" { connected = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        trace(connected ? "authenticated" : "timeout")
        await alice.stop(); if let bob { await bob.stop() }
        try await arun.value; if let brun { try await brun.value }
        XCTAssertTrue(connected)
    }
    func testDiagnosticSingleClientWithPresence() async throws { try await diagnosticPresenceIsolation(dual: false) }
    func testDiagnosticTwoClientsWithoutPresence() async throws { try await diagnosticPresenceIsolation(dual: true) }
    func testDiagnosticDefaultFactoryWithoutPresence() async throws { try await diagnosticPresenceIsolation(dual: false, includePresence: false) }
    func testDiagnosticExplicitFactoryWithPresence() async throws { try await diagnosticPresenceIsolation(dual: false, explicitFactory: true) }

}
