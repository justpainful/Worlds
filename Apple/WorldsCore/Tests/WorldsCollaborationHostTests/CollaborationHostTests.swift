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
    func storedAccountID() async throws -> String? { "editor" }
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
    let acknowledges: Bool
    private var queue: [Data] = []
    private var waiting: CheckedContinuation<Data?, Error>?
    private var closed = false
    init(page: Data, level: String, received: ReceivedUpdates, acknowledges: Bool = true) {
        self.page = page; self.level = level; self.received = received; self.acknowledges = acknowledges
    }
    func send(_ data: Data) async throws {
        switch try WorldsSyncWire.decode(data) {
        case let .sync(channel, kind, _) where kind == 0:
            if channel == 0 { try deliver(WorldsSyncWire.encode(.authState(level: level, userID: "editor"))) }
            try deliver(WorldsSyncWire.encode(.sync(channel: channel, kind: 0, payload: Data([0]))))
            try deliver(WorldsSyncWire.encode(.sync(channel: channel, kind: 1, payload: channel == 0 ? page : Data([0, 0]))))
        case let .update(batchID, channel, update):
            if channel == 0 { await received.add(update) }
            if acknowledges { try deliver(WorldsSyncWire.encode(.acknowledgement(batchID: batchID, status: 0, reason: ""))) }
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

extension CollaborationHostTests {
    private func temporaryDirectory() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("shared-pages-" + UUID().uuidString, isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }
    private var binding: SharedPageBinding {
        SharedPageBinding(accountID: "editor", workspaceID: "fixture-workspace", pageID: "fixture-page", origin: "example.invalid")
    }
    private func trusted() throws -> TrustedSyncOrigin {
        try SyncEndpointProposal(origin: URL(string: "https://example.invalid")!, accountID: "editor", workspaceID: "fixture-workspace").approve()
    }

    func testSavedCopyKeepsAnUnsentChangeAndSendsItNextTime() async throws {
        let directory = temporaryDirectory()
        let page = Self.sharedOrderPage
        let first = try DeviceSharedPageStore(directory: directory, binding: binding, allowsLocalWrites: true)
        let silent = ReceivedUpdates()
        let offline = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor",
            serverURL: URL(string: "https://example.invalid")!, trustedOrigin: try trusted(), savedCopy: first, checkedIdentity: IdentityFixture(.edit),
            socketFactory: { _, _ in EditablePageSocket(page: page, level: "edit", received: silent, acknowledges: false) })
        let firstRun = Task { try await offline.run() }
        _ = try await waitForReading(offline)
        try await offline.setPackFields(request: try JSONSerialization.data(withJSONObject: ["set": ["status": "paid"]]))
        await offline.stop()
        try await firstRun.value
        let unsent = await first.pendingCount()
        XCTAssertEqual(unsent, 1, "The server never acknowledged it")

        // The page and the change survive closing the page and the app.
        let reopened = try DeviceSharedPageStore(directory: directory, binding: binding, allowsLocalWrites: true)
        let kept = await reopened.pendingCount()
        XCTAssertEqual(kept, 1)
        let savedValue = try await reopened.savedReading()
        let saved = try XCTUnwrap(savedValue)
        let fields = try XCTUnwrap(try JSONSerialization.jsonObject(with: saved.packFields) as? [String: Any])
        XCTAssertEqual((fields["fields"] as? [String: Any])?["status"] as? String, "paid")
        XCTAssertEqual(fields["kind"] as? String, "shop.order")

        // The next connected session sends it and the server acknowledges it.
        let received = ReceivedUpdates()
        let online = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor",
            serverURL: URL(string: "https://example.invalid")!, trustedOrigin: try trusted(), savedCopy: reopened, checkedIdentity: IdentityFixture(.edit),
            socketFactory: { _, _ in EditablePageSocket(page: page, level: "edit", received: received) })
        let secondRun = Task { try await online.run() }
        var pending = 1
        for _ in 0..<150 where pending > 0 {
            try await Task.sleep(for: .milliseconds(20))
            pending = await reopened.pendingCount()
        }
        XCTAssertEqual(pending, 0)
        let server = try NativeCRDTDocument()
        try server.apply(page)
        for update in await received.updates { try server.apply(update) }
        let onServer = try XCTUnwrap(try JSONSerialization.jsonObject(with: server.packFields()) as? [String: Any])
        XCTAssertEqual((onServer["fields"] as? [String: Any])?["status"] as? String, "paid")
        await online.stop()
        try await secondRun.value
    }

    func testSavedCopyIsBoundToItsAccountPageAndOrigin() async throws {
        let directory = temporaryDirectory()
        let copy = try DeviceSharedPageStore(directory: directory, binding: binding, allowsLocalWrites: true)
        try await copy.appendRemote(pageID: "fixture-page", channel: 0, update: Self.sharedOrderPage)
        let url = URL(string: "https://example.invalid")!
        // Another page or origin never uses this copy.
        do {
            _ = try await CollaborationHost.makeSession(pageID: "other-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: url, trustedOrigin: try trusted(), savedCopy: copy, checkedIdentity: IdentityFixture(.edit))
            XCTFail("A copy of another page was accepted")
        } catch CollaborationHostError.identityMismatch { }
        do {
            _ = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: URL(string: "https://evil.invalid")!, trustedOrigin: try trusted(), savedCopy: copy, checkedIdentity: IdentityFixture(.edit))
            XCTFail("Untrusted endpoint was accepted")
        } catch CollaborationHostError.untrustedEndpoint { }
        // A copy that edits needs edit access; one that reads only needs any access.
        do {
            _ = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: url, trustedOrigin: try trusted(), savedCopy: copy, checkedIdentity: IdentityFixture(.view))
            XCTFail("A viewer got a copy that edits")
        } catch CollaborationHostError.accessDenied { }
        do {
            _ = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: url, trustedOrigin: try trusted(), savedCopy: copy, checkedIdentity: IdentityFixture(.none))
            XCTFail("A page without access was opened")
        } catch CollaborationHostError.accessDenied { }
        let reader = try DeviceSharedPageStore(directory: directory, binding: binding, allowsLocalWrites: false)
        _ = try await CollaborationHost.makeSession(pageID: "fixture-page", workspaceID: "fixture-workspace", expectedUserID: "editor", serverURL: url, trustedOrigin: try trusted(), savedCopy: reader, checkedIdentity: IdentityFixture(.view))
        do { try await reader.appendLocal(pageID: "fixture-page", channel: 0, update: Data([0, 0])); XCTFail("A reading copy wrote") }
        catch CollaborationError.accessRevoked { }
        // A file whose recorded owner differs from its name is never read.
        let mineFile = try XCTUnwrap(try FileManager.default.contentsOfDirectory(atPath: directory.path).first)
        let other = SharedPageBinding(accountID: "other", workspaceID: "fixture-workspace", pageID: "fixture-page", origin: "example.invalid")
        let theirs = try DeviceSharedPageStore(directory: directory, binding: other, allowsLocalWrites: false)
        try await theirs.appendRemote(pageID: "fixture-page", channel: 0, update: Self.sharedOrderPage)
        let theirFile = try XCTUnwrap(try FileManager.default.contentsOfDirectory(atPath: directory.path).first { $0 != mineFile })
        try FileManager.default.removeItem(at: directory.appendingPathComponent(theirFile))
        try FileManager.default.copyItem(at: directory.appendingPathComponent(mineFile), to: directory.appendingPathComponent(theirFile))
        XCTAssertThrowsError(try DeviceSharedPageStore(directory: directory, binding: other, allowsLocalWrites: false)) { error in
            XCTAssertEqual(error as? DeviceSharedPageStoreError, .bindingMismatch)
        }
    }

    func testRejectedChangeQuarantinesTheCopy() async throws {
        let directory = temporaryDirectory()
        let copy = try DeviceSharedPageStore(directory: directory, binding: binding, allowsLocalWrites: true)
        try await copy.appendRemote(pageID: "fixture-page", channel: 0, update: Self.sharedOrderPage)
        let change = try NativeCRDTDocument.preparePackFields(base: Self.sharedOrderPage, request: Data(#"{"set":{"status":"paid"}}"#.utf8))
        try await copy.appendLocal(pageID: "fixture-page", channel: 0, update: change)
        try await copy.archiveRejection(pageID: "fixture-page", channel: 0, state: change, reason: "view access cannot edit the page")
        let reopened = try DeviceSharedPageStore(directory: directory, binding: binding, allowsLocalWrites: true)
        let pending = await reopened.pendingCount()
        XCTAssertEqual(pending, 0)
        let reason = await reopened.rejection()
        XCTAssertEqual(reason, "view access cannot edit the page")
        let watermark = try await reopened.maximumPendingID(pageID: "fixture-page", channel: 0)
        XCTAssertNil(watermark)
        do { try await reopened.appendLocal(pageID: "fixture-page", channel: 0, update: change); XCTFail("A quarantined copy took a change") }
        catch DeviceSharedPageStoreError.quarantined { }
    }

    func testSavedCopiesOpenOfflineOnlyForTheSignedInAccount() async throws {
        let directory = temporaryDirectory()
        let mine = try DeviceSharedPageStore(directory: directory, binding: binding, allowsLocalWrites: false)
        try await mine.appendRemote(pageID: "fixture-page", channel: 0, update: Self.sharedOrderPage)
        let otherBinding = SharedPageBinding(accountID: "other", workspaceID: "fixture-workspace", pageID: "fixture-page", origin: "example.invalid")
        let theirs = try DeviceSharedPageStore(directory: directory, binding: otherBinding, allowsLocalWrites: false)
        try await theirs.appendRemote(pageID: "fixture-page", channel: 0, update: Self.sharedOrderPage)
        XCTAssertEqual(DeviceSharedPageStore.savedBindings(in: directory, accountID: "editor"), [binding])
        let opened = try await CollaborationHost.openSavedCopy(binding: binding, directory: directory, checkedIdentity: IdentityFixture(.none))
        let openedValue = try await opened.savedReading()
        let reading = try XCTUnwrap(openedValue)
        let tree = try XCTUnwrap(try JSONSerialization.jsonObject(with: reading.blocks) as? [String: Any])
        XCTAssertEqual((tree["content"] as? [[String: Any]])?.first?["type"] as? String, "heading")
        do { _ = try await CollaborationHost.openSavedCopy(binding: otherBinding, directory: directory, checkedIdentity: IdentityFixture(.none)); XCTFail("Another account's copy opened") }
        catch CollaborationHostError.identityMismatch { }
        DeviceSharedPageStore.removeOthers(than: "editor", in: directory)
        XCTAssertTrue(DeviceSharedPageStore.savedBindings(in: directory, accountID: "other").isEmpty)
        DeviceSharedPageStore.remove(binding, in: directory)
        XCTAssertTrue(DeviceSharedPageStore.savedBindings(in: directory, accountID: "editor").isEmpty)
    }

    func testSavedCopyCompactsWithoutChangingThePage() async throws {
        let directory = temporaryDirectory()
        let copy = try DeviceSharedPageStore(directory: directory, binding: binding, allowsLocalWrites: true)
        try await copy.appendRemote(pageID: "fixture-page", channel: 0, update: Self.sharedOrderPage)
        var state = Self.sharedOrderPage
        for index in 0..<80 {
            let change = try NativeCRDTDocument.preparePackFields(base: state, request: Data(#"{"set":{"total":\#(index)}}"#.utf8))
            try await copy.appendRemote(pageID: "fixture-page", channel: 0, update: change)
            let doc = try NativeCRDTDocument()
            try doc.apply(state); try doc.apply(change)
            state = try doc.diff(Data([0]))
        }
        let reopened = try DeviceSharedPageStore(directory: directory, binding: binding, allowsLocalWrites: true)
        let updates = try await reopened.load(pageID: "fixture-page", channel: 0)
        XCTAssertLessThan(updates.count, 40, "The log was folded into a saved state")
        let readingValue = try await reopened.savedReading()
        let reading = try XCTUnwrap(readingValue)
        let fields = try XCTUnwrap(try JSONSerialization.jsonObject(with: reading.packFields) as? [String: Any])
        XCTAssertEqual((fields["fields"] as? [String: Any])?["total"] as? Double, 79)
        XCTAssertEqual((fields["fields"] as? [String: Any])?["status"] as? String, "sent")
    }
}
