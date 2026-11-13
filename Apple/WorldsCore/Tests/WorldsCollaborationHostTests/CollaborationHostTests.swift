import XCTest
import WorldsCollaboration
import WorldsSyncWire
import WorldsIdentityContinuity
@testable import WorldsCollaborationHost

private actor IdentityFixture: CollaborationIdentity {
    let level: IdentityPageLevel
    var calls = 0
    var tokenCalls = 0
    init(_ level: IdentityPageLevel) { self.level = level }
    func currentWorkspacePageLevel(workspaceID: String, pageID: String, expectedUserID: String) async throws -> IdentityPageLevel {
        calls += 1
        guard workspaceID == "fixture-workspace", pageID == "fixture-page", expectedUserID == "editor" else { throw CollaborationHostError.identityMismatch }
        return level
    }
    func accessToken(expectedUserID: String, forceRefresh: Bool) async throws -> String {
        tokenCalls += 1
        guard expectedUserID == "editor" else { throw CollaborationHostError.identityMismatch }
        return "fixture-token"
    }
}

final class CollaborationHostTests: XCTestCase {
    func testHostRejectsMismatchedStoreAndRevokedServiceAccess() async throws {
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("collab-host-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: fixture, to: copy)
        defer { try? FileManager.default.removeItem(at: copy) }
        let store = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let permitted = IdentityFixture(.edit)
        let trusted = try SyncEndpointProposal(origin: URL(string: "https://example.invalid")!, accountID: "editor", workspaceID: "fixture-workspace").approve()
        do {
            _ = try await CollaborationHost.makeSession(pageID: "other-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, trustedOrigin: trusted, store: store, checkedIdentity: permitted)
            XCTFail("A different page must not use this store")
        } catch CollaborationHostError.identityMismatch { }
        let calls = await permitted.calls; XCTAssertEqual(calls, 0)
        let denied = IdentityFixture(.none)
        do {
            _ = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, trustedOrigin: trusted, store: store, checkedIdentity: denied)
            XCTFail("A revoked page must not start")
        } catch CollaborationHostError.accessDenied { }
        do {
            _ = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, trustedOrigin: trusted, store: store, checkedIdentity: permitted)
            XCTFail("Legacy document and outbox ownership must not be assumed")
        } catch CollaborationHostError.unverifiedDocumentOwnership { }
        let tokenCalls = await permitted.tokenCalls
        XCTAssertEqual(tokenCalls, 0)
    }

    func testHostRejectsUntrustedOriginBeforeIdentityCalls() async throws {
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("collab-origin-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: fixture, to: copy)
        defer { try? FileManager.default.removeItem(at: copy) }
        let store = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let identity = IdentityFixture(.edit)
        let trusted = try SyncEndpointProposal(origin: URL(string: "https://example.invalid")!, accountID: "editor", workspaceID: "fixture-workspace").approve()
        for raw in ["https://evil.invalid", "https://example.invalid.evil.invalid", "https://example.invalid:444", "http://example.invalid", "https://example.invalid/path", "https://user@example.invalid", "https://example.invalid/?x=1"] {
            let candidate = try XCTUnwrap(URL(string: raw))
            do {
                _ = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: candidate, trustedOrigin: trusted, store: store, checkedIdentity: identity)
                XCTFail("Untrusted endpoint was accepted")
            } catch CollaborationHostError.untrustedEndpoint { }
        }
        let calls = await identity.calls
        XCTAssertEqual(calls, 0)
        let tokenCalls = await identity.tokenCalls
        XCTAssertEqual(tokenCalls, 0)
        XCTAssertTrue(trusted.accepts(URL(string: "https://EXAMPLE.invalid:443/")!, accountID: "editor", workspaceID: "fixture-workspace"))
        XCTAssertFalse(trusted.accepts(URL(string: "https://example.invalid")!, accountID: "other", workspaceID: "fixture-workspace"))
        XCTAssertFalse(trusted.accepts(URL(string: "https://example.invalid")!, accountID: "editor", workspaceID: "other"))
        do {
            _ = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "other", serverURL: URL(string: "https://example.invalid")!, trustedOrigin: trusted, store: store, checkedIdentity: identity)
            XCTFail("Approval must not follow another account")
        } catch CollaborationHostError.untrustedEndpoint { }
        let callsAfterAccountChange = await identity.calls
        XCTAssertEqual(callsAfterAccountChange, 0)
    }
}

/// Answers the client's first sync with the server's identity, its state
/// vector and the page, like the sync Worker does for a viewer.
private actor ReadOnlyPageSocket: CollaborationSocket {
    let page: Data
    let userID: String
    private var queue: [Data] = []
    private var waiting: CheckedContinuation<Data?, Error>?
    private var closed = false
    private(set) var updates: [Data] = []
    init(page: Data, userID: String) { self.page = page; self.userID = userID }
    func send(_ data: Data) async throws {
        switch try WorldsSyncWire.decode(data) {
        case let .sync(channel, kind, _) where kind == 0:
            if channel == 0 { try deliver(WorldsSyncWire.encode(.authState(level: "view", userID: userID))) }
            try deliver(WorldsSyncWire.encode(.sync(channel: channel, kind: 0, payload: Data([0]))))
            try deliver(WorldsSyncWire.encode(.sync(channel: channel, kind: 1, payload: channel == 0 ? page : Data([0, 0]))))
        case let .update(batchID, _, update):
            updates.append(update)
            try deliver(WorldsSyncWire.encode(.acknowledgement(batchID: batchID, status: 0, reason: "")))
        default: break
        }
    }
    private func deliver(_ bytes: Data) throws {
        if let waiting { self.waiting = nil; waiting.resume(returning: bytes) } else { queue.append(bytes) }
    }
    func receive() async throws -> Data? {
        if !queue.isEmpty { return queue.removeFirst() }
        if closed { throw CancellationError() }
        return try await withCheckedThrowingContinuation { waiting = $0 }
    }
    func close() async {
        closed = true
        if let waiting { self.waiting = nil; waiting.resume(throwing: CancellationError()) }
    }
    func closeCode() async -> Int { 0 }
}

private actor TokenLog {
    var tokens: [String] = []
    var urls: [String] = []
    func record(_ token: String, url: URL) { tokens.append(token); urls.append(url.absoluteString) }
}

extension CollaborationHostTests {
    /// A heading, a paragraph and a shop order's fields, as the desktop writes them.
    static let sharedOrderPage = Data(base64Encoded: "AQykvNDD2Zy6BAAHAQdkZWZhdWx0AwdoZWFkaW5nKACkvNDD2Zy6BAAFbGV2ZWwBfEAAAAAoAKS80MPZnLoEAANiaWQBdwNoLTEHAKS80MPZnLoEAAYEAKS80MPZnLoEAwtPcmRlciBub3Rlc4ekvNDD2Zy6BAADCXBhcmFncmFwaCgApLzQw9mcugQPA2JpZAF3A3AtMQcApLzQw9mcugQPBgQApLzQw9mcugQRCVR3byBib3hlcygBBmZpZWxkcwZzdGF0dXMBdwRzZW50KAEGZmllbGRzBXRvdGFsAXxEj8AAKAEEbWV0YQRraW5kAXcKc2hvcC5vcmRlcgA=")!

    func testReadOnlySessionChecksOriginAndAccessBeforeAnyToken() async throws {
        let trusted = try SyncEndpointProposal(origin: URL(string: "https://example.invalid")!, accountID: "editor", workspaceID: "fixture-workspace").approve()
        let identity = IdentityFixture(.view)
        do {
            _ = try await CollaborationHost.makeReadOnlySession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: URL(string: "https://evil.invalid")!, trustedOrigin: trusted, checkedIdentity: identity)
            XCTFail("Untrusted endpoint was accepted")
        } catch CollaborationHostError.untrustedEndpoint { }
        let callsAfterOrigin = await identity.calls
        XCTAssertEqual(callsAfterOrigin, 0)
        do {
            _ = try await CollaborationHost.makeReadOnlySession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, trustedOrigin: trusted, checkedIdentity: IdentityFixture(.none))
            XCTFail("A page without access must not open")
        } catch CollaborationHostError.accessDenied { }
        do {
            _ = try await CollaborationHost.makeReadOnlySession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "other", serverURL: URL(string: "https://example.invalid")!, trustedOrigin: trusted, checkedIdentity: identity)
            XCTFail("Approval must not follow another account")
        } catch CollaborationHostError.untrustedEndpoint { }
        let tokenCalls = await identity.tokenCalls
        XCTAssertEqual(tokenCalls, 0)
    }

    func testReadOnlySessionShowsBlocksAndPackFieldsAndRefusesWrites() async throws {
        let trusted = try SyncEndpointProposal(origin: URL(string: "https://example.invalid")!, accountID: "editor", workspaceID: "fixture-workspace").approve()
        let identity = IdentityFixture(.view)
        let socket = ReadOnlyPageSocket(page: Self.sharedOrderPage, userID: "editor")
        let tokens = TokenLog()
        let session = try await CollaborationHost.makeReadOnlySession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor",
            serverURL: URL(string: "https://example.invalid")!, trustedOrigin: trusted, checkedIdentity: identity,
            socketFactory: { url, token in
                await tokens.record(token, url: url)
                return socket
            })
        let run = Task { try await session.run() }
        var reading: SharedPageReading?
        for _ in 0..<150 {
            reading = try? await session.readOnlySnapshot()
            if reading != nil { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let page = try XCTUnwrap(reading)
        XCTAssertEqual(page.accessLevel, "view")
        let tree = try XCTUnwrap(try JSONSerialization.jsonObject(with: page.blocks) as? [String: Any])
        let blocks = try XCTUnwrap(tree["content"] as? [[String: Any]])
        XCTAssertEqual(blocks.count, 2)
        XCTAssertEqual(blocks.first?["type"] as? String, "heading")
        let fields = try XCTUnwrap(try JSONSerialization.jsonObject(with: page.packFields) as? [String: Any])
        XCTAssertEqual(fields["kind"] as? String, "shop.order")
        XCTAssertEqual((fields["fields"] as? [String: Any])?["status"] as? String, "sent")
        do { try await session.appendLocal(channel: 0, update: Data([0, 0])); XCTFail("A viewer session must not write") }
        catch CollaborationError.accessRevoked { }
        let sent = await tokens.tokens
        XCTAssertEqual(sent, ["fixture-token"])
        let urls = await tokens.urls
        XCTAssertEqual(urls, ["wss://example.invalid/v1/workspaces/fixture-workspace/docs/fixture-page/sync"])
        // Only the empty answers to the server's sync step went out.
        let updates = await socket.updates
        XCTAssertTrue(updates.allSatisfy { $0 == Data([0, 0]) }, "\(updates)")
        await session.stop()
        try await run.value
    }

    func testEphemeralStoreRefusesLocalWritesAndOtherPages() async throws {
        let store = EphemeralReadOnlyStore(pageID: "page")
        try await store.appendRemote(pageID: "page", channel: 0, update: Data([0, 0]))
        let loaded = try await store.load(pageID: "page", channel: 0)
        XCTAssertEqual(loaded, [Data([0, 0])])
        let pending = try await store.maximumPendingID(pageID: "page", channel: 0)
        XCTAssertNil(pending)
        do { try await store.appendLocal(pageID: "page", channel: 0, update: Data([0, 0])); XCTFail("Local writes must be refused") }
        catch CollaborationError.accessRevoked { }
        do { _ = try await store.load(pageID: "other", channel: 0); XCTFail("Another page must be refused") }
        catch CollaborationStorageError.denied { }
    }
}

/// One connection to a fake sync server with edit access: it answers the
/// client's first sync with the page and acknowledges every update it gets.
private actor EditablePageSocket: CollaborationSocket {
    let page: Data
    let level: String
    let received: ReceivedUpdates
    private var queue: [Data] = []
    private var waiting: CheckedContinuation<Data?, Error>?
    private var closed = false
    init(page: Data, level: String, received: ReceivedUpdates) { self.page = page; self.level = level; self.received = received }
    func send(_ data: Data) async throws {
        switch try WorldsSyncWire.decode(data) {
        case let .sync(channel, kind, _) where kind == 0:
            if channel == 0 { try deliver(WorldsSyncWire.encode(.authState(level: level, userID: "editor"))) }
            try deliver(WorldsSyncWire.encode(.sync(channel: channel, kind: 0, payload: Data([0]))))
            try deliver(WorldsSyncWire.encode(.sync(channel: channel, kind: 1, payload: channel == 0 ? page : Data([0, 0]))))
        case let .update(batchID, channel, update):
            if channel == 0 { await received.add(update) }
            try deliver(WorldsSyncWire.encode(.acknowledgement(batchID: batchID, status: 0, reason: "")))
        default: break
        }
    }
    private func deliver(_ bytes: Data) throws {
        if let waiting { self.waiting = nil; waiting.resume(returning: bytes) } else { queue.append(bytes) }
    }
    func receive() async throws -> Data? {
        if !queue.isEmpty { return queue.removeFirst() }
        if closed { throw CancellationError() }
        return try await withCheckedThrowingContinuation { waiting = $0 }
    }
    func close() async {
        closed = true
        if let waiting { self.waiting = nil; waiting.resume(throwing: CancellationError()) }
    }
    func closeCode() async -> Int { 0 }
}

private actor ReceivedUpdates {
    var updates: [Data] = []
    var connections = 0
    func add(_ update: Data) { updates.append(update) }
    func connected() { connections += 1 }
}

extension CollaborationHostTests {
    private func waitForReading(_ session: CollaborationSession) async throws -> SharedPageReading {
        for _ in 0..<150 {
            if let reading = try? await session.readOnlySnapshot() { return reading }
            try await Task.sleep(for: .milliseconds(20))
        }
        throw CollaborationError.notStarted
    }

    func testLiveSessionSendsPackFieldChangesAndEmptiesItsOutbox() async throws {
        let trusted = try SyncEndpointProposal(origin: URL(string: "https://example.invalid")!, accountID: "editor", workspaceID: "fixture-workspace").approve()
        let received = ReceivedUpdates()
        let page = Self.sharedOrderPage
        let live = try await CollaborationHost.makeLiveSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor",
            serverURL: URL(string: "https://example.invalid")!, trustedOrigin: trusted, checkedIdentity: IdentityFixture(.edit),
            socketFactory: { _, _ in
                await received.connected()
                return EditablePageSocket(page: page, level: "edit", received: received)
            })
        let run = Task { try await live.session.run() }
        _ = try await waitForReading(live.session)
        let request = try JSONSerialization.data(withJSONObject: ["set": ["status": "paid", "total": 1200], "remove": ["missing"]])
        try await live.session.setPackFields(request: request)
        // The change shows at once and stays queued until the server acknowledges it.
        var pending = await live.outbox.pendingCount()
        for _ in 0..<150 where pending > 0 {
            try await Task.sleep(for: .milliseconds(20))
            pending = await live.outbox.pendingCount()
        }
        XCTAssertEqual(pending, 0)
        let reading = try await waitForReading(live.session)
        let fields = try XCTUnwrap(try JSONSerialization.jsonObject(with: reading.packFields) as? [String: Any])
        XCTAssertEqual((fields["fields"] as? [String: Any])?["status"] as? String, "paid")
        XCTAssertEqual(fields["kind"] as? String, "shop.order")
        // What reached the server carries the change.
        let server = try NativeCRDTDocument()
        try server.apply(page)
        for update in await received.updates { try server.apply(update) }
        let onServer = try XCTUnwrap(try JSONSerialization.jsonObject(with: server.packFields()) as? [String: Any])
        XCTAssertEqual((onServer["fields"] as? [String: Any])?["total"] as? Double, 1200)
        let connections = await received.connections
        XCTAssertGreaterThanOrEqual(connections, 2, "A local change reconnects so the handshake sends it")
        await live.session.stop()
        try await run.value
    }

    func testLiveSessionRefusesViewersAndBadRequests() async throws {
        let trusted = try SyncEndpointProposal(origin: URL(string: "https://example.invalid")!, accountID: "editor", workspaceID: "fixture-workspace").approve()
        do {
            _ = try await CollaborationHost.makeLiveSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor",
                serverURL: URL(string: "https://example.invalid")!, trustedOrigin: trusted, checkedIdentity: IdentityFixture(.view))
            XCTFail("A viewer must not get a session that can write")
        } catch CollaborationHostError.accessDenied { }
        do {
            _ = try await CollaborationHost.makeLiveSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor",
                serverURL: URL(string: "https://evil.invalid")!, trustedOrigin: trusted, checkedIdentity: IdentityFixture(.edit))
            XCTFail("Untrusted endpoint was accepted")
        } catch CollaborationHostError.untrustedEndpoint { }
        // The service said edit, but the server reports view for this connection.
        let received = ReceivedUpdates()
        let page = Self.sharedOrderPage
        let live = try await CollaborationHost.makeLiveSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor",
            serverURL: URL(string: "https://example.invalid")!, trustedOrigin: trusted, checkedIdentity: IdentityFixture(.edit),
            socketFactory: { _, _ in EditablePageSocket(page: page, level: "view", received: received) })
        let run = Task { try await live.session.run() }
        _ = try await waitForReading(live.session)
        let request = try JSONSerialization.data(withJSONObject: ["set": ["status": "paid"]])
        do { try await live.session.setPackFields(request: request); XCTFail("View access must not write") }
        catch CollaborationError.accessRevoked { }
        let pending = await live.outbox.pendingCount()
        XCTAssertEqual(pending, 0)
        await live.session.stop()
        try await run.value
        // Malformed requests never reach the outbox.
        XCTAssertThrowsError(try NativeCRDTDocument.preparePackFields(base: Self.sharedOrderPage, request: Data("{}".utf8)))
    }
}
