import Foundation
import XCTest
import SQLite3
import WorldsSyncWire
@testable import WorldsCollaboration

final class WorldsCollaborationTests: XCTestCase {
    func testParallelCRDTAllocationApplyAndFree() async throws {
        let update = try XCTUnwrap(Data(base64Encoded: "AQbpBwAEAQZzaGFyZWQKSGVsbG8g8J+MjQcBB2RlZmF1bHQDCXBhcmFncmFwaAcA6QcIBgYA6QcJBGJvbGQEdHJ1ZYTpBwoNWWpzIHJpY2ggdGV4dIbpBxcEYm9sZARudWxsAA=="))
        try await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<12 {
                group.addTask {
                    for _ in 0..<32 {
                        let doc = try NativeCRDTDocument()
                        _ = try doc.clientID()
                        try doc.apply(update)
                        let vector = try doc.vector()
                        let diff = try doc.diff(vector)
                        guard diff == Data([0, 0]) else { throw CRDTError.invalidUpdate }
                    }
                }
            }
            try await group.waitForAll()
        }
    }
    func testNativeFixtureStateVectorAndIncrement() throws {
        let doc = try NativeCRDTDocument()
        let base = try XCTUnwrap(Data(base64Encoded: "AQbpBwAEAQZzaGFyZWQKSGVsbG8g8J+MjQcBB2RlZmF1bHQDCXBhcmFncmFwaAcA6QcIBgYA6QcJBGJvbGQEdHJ1ZYTpBwoNWWpzIHJpY2ggdGV4dIbpBxcEYm9sZARudWxsAA=="))
        let vector = try XCTUnwrap(Data(base64Encoded: "AekHGQ=="))
        let update = try XCTUnwrap(Data(base64Encoded: "AQHRDwDE6QcF6QcGBkFsaWNlIAA="))
        try doc.apply(base)
        XCTAssertEqual(try doc.vector(), vector)
        try doc.apply(update)
        let delta = try doc.diff(vector)
        let peer = try NativeCRDTDocument()
        try peer.apply(base)
        try peer.apply(delta)
        XCTAssertEqual(try peer.vector(), try doc.vector())
    }

    func testMalformedUpdatesFailWithoutFreeingTheDocument() throws {
        let doc = try NativeCRDTDocument()
        XCTAssertThrowsError(try doc.apply(Data([255])))
        XCTAssertNoThrow(try doc.vector())
    }
}

private actor FixtureStore: CheckedPlainEditorStore {
    private(set) var editorWrites = 0
    func insertPlainChecked(base: Data, blockIndex: UInt32, blockID: String, expected: String, offset: UInt32, insertion: String) async throws -> Data { editorWrites += 1; return Data([0, 0]) }
    let fixture = Data(base64Encoded: "AQbpBwAEAQZzaGFyZWQKSGVsbG8g8J+MjQcBB2RlZmF1bHQDCXBhcmFncmFwaAcA6QcIBgYA6QcJBGJvbGQEdHJ1ZYTpBwoNWWpzIHJpY2ggdGV4dIbpBxcEYm9sZARudWxsAA==")!
    private(set) var acknowledged: Int64?
    func load(pageID: String, channel: UInt64) async throws -> [Data] { channel == 0 ? [fixture] : [] }
    func appendLocal(pageID: String, channel: UInt64, update: Data) async throws {}
    func appendRemote(pageID: String, channel: UInt64, update: Data) async throws {}
    func maximumPendingID(pageID: String, channel: UInt64) async throws -> Int64? { channel == 0 ? 7 : nil }
    func acknowledge(pageID: String, channel: UInt64, through: Int64) async throws { acknowledged = through }
    func archiveRejection(pageID: String, channel: UInt64, state: Data, reason: String) async throws {}
}

private actor PausedRealStore: CollaborationStore {
    let inner: SQLiteCollaborationStore
    private(set) var persisted = false
    private(set) var archived = false
    private var waiting: CheckedContinuation<Void, Never>?
    init(_ inner: SQLiteCollaborationStore) { self.inner = inner }
    func load(pageID: String, channel: UInt64) async throws -> [Data] { try await inner.load(pageID: pageID, channel: channel) }
    func appendLocal(pageID: String, channel: UInt64, update: Data) async throws {
        try await inner.appendLocal(pageID: pageID, channel: channel, update: update)
        persisted = true
        await withCheckedContinuation { waiting = $0 }
    }
    func release() { waiting?.resume(); waiting = nil }
    func appendRemote(pageID: String, channel: UInt64, update: Data) async throws { try await inner.appendRemote(pageID: pageID, channel: channel, update: update) }
    func maximumPendingID(pageID: String, channel: UInt64) async throws -> Int64? { try await inner.maximumPendingID(pageID: pageID, channel: channel) }
    func acknowledge(pageID: String, channel: UInt64, through: Int64) async throws { try await inner.acknowledge(pageID: pageID, channel: channel, through: through) }
    func archiveRejection(pageID: String, channel: UInt64, state: Data, reason: String) async throws {
        archived = true
        try await inner.archiveRejection(pageID: pageID, channel: channel, state: state, reason: reason)
    }
}

private actor RejectionSocket: CollaborationSocket {
    private var queue: [Data] = []
    private var waiting: CheckedContinuation<Data?, Error>?
    private var contentBatch: UInt64?
    func send(_ data: Data) async throws {
        switch try WorldsSyncWire.decode(data) {
        case let .sync(channel, kind, _) where kind == 0:
            if channel == 0 { try deliver(WorldsSyncWire.encode(.authState(level: "edit", userID: "editor"))) }
            try deliver(WorldsSyncWire.encode(.sync(channel: channel, kind: 0, payload: Data([0]))))
        case let .update(batchID, channel, _) where channel == 0: contentBatch = batchID
        default: break
        }
    }
    var hasBatch: Bool { contentBatch != nil }
    func reject() throws {
        guard let contentBatch else { throw CollaborationError.invalidFrame }
        try deliver(WorldsSyncWire.encode(.acknowledgement(batchID: contentBatch, status: 1, reason: "denied")))
    }
    private func deliver(_ data: Data) throws {
        if let waiting { self.waiting = nil; waiting.resume(returning: data) } else { queue.append(data) }
    }
    func receive() async throws -> Data? {
        if !queue.isEmpty { return queue.removeFirst() }
        return try await withCheckedThrowingContinuation { waiting = $0 }
    }
    func close() async { if let waiting { self.waiting = nil; waiting.resume(throwing: CancellationError()) } }
    func closeCode() async -> Int { 0 }
}

private actor PausedDisconnectSocket: CollaborationSocket {
    private var first = true
    private var receiveWaiter: CheckedContinuation<Data?, Error>?
    private var closeWaiter: CheckedContinuation<Void, Never>?
    private(set) var waitingForCloseCode = false
    var waitingForReceive: Bool { receiveWaiter != nil }
    func send(_ data: Data) async throws { }
    func receive() async throws -> Data? {
        if first { first = false; return try WorldsSyncWire.encode(.authState(level: "edit", userID: "editor")) }
        return try await withCheckedThrowingContinuation { receiveWaiter = $0 }
    }
    func disconnect() { receiveWaiter?.resume(throwing: URLError(.networkConnectionLost)); receiveWaiter = nil }
    func close() async { receiveWaiter?.resume(throwing: CancellationError()); receiveWaiter = nil }
    func closeCode() async -> Int {
        waitingForCloseCode = true
        await withCheckedContinuation { closeWaiter = $0 }
        return 0
    }
    func releaseClose() { closeWaiter?.resume(); closeWaiter = nil }
}

private actor DelayedPresenceSocket: CollaborationSocket {
    private let userID: String
    init(userID: String = "user") { self.userID = userID }
    private var firstReceive = true
    private var waiting: CheckedContinuation<Data?, Error>?
    private var sendWaiter: CheckedContinuation<Void, Never>?
    private(set) var sendStarted = false
    private(set) var closed = false
    private(set) var states: [String] = []
    func send(_ data: Data) async throws {
        if case let .awareness(payload) = try WorldsSyncWire.decode(data) {
            let state = try XCTUnwrap(WorldsSyncWire.decodeAwarenessUpdate(payload).first?.state)
            if !sendStarted && state != "null" {
                sendStarted = true
                await withCheckedContinuation { sendWaiter = $0 }
            }
            states.append(state)
        }
    }
    func receive() async throws -> Data? {
        if firstReceive { firstReceive = false; return try WorldsSyncWire.encode(.authState(level: "edit", userID: userID)) }
        return try await withCheckedThrowingContinuation { waiting = $0 }
    }
    func releaseSend() { sendWaiter?.resume(); sendWaiter = nil }
    func close() async { closed = true; waiting?.resume(throwing: CancellationError()); waiting = nil }
    func closeCode() async -> Int { 0 }
}

private actor PausedRefreshToken {
    private(set) var refreshStarted = false
    private var waiting: CheckedContinuation<Void, Never>?
    func token(force: Bool) async -> String {
        if force { refreshStarted = true; await withCheckedContinuation { waiting = $0 } }
        return "fixture-token"
    }
    func release() { waiting?.resume(); waiting = nil }
}

private actor IdentityChangeSocket: CollaborationSocket {
    private var first = true
    private var waiting: CheckedContinuation<Data?, Error>?
    var ready: Bool { waiting != nil }
    func send(_ data: Data) async throws { }
    func receive() async throws -> Data? {
        if first { first = false; return try WorldsSyncWire.encode(.authState(level: "edit", userID: "editor")) }
        return try await withCheckedThrowingContinuation { waiting = $0 }
    }
    func requestSync() throws {
        let frame = try WorldsSyncWire.encode(.sync(channel: 0, kind: 0, payload: Data([0])))
        waiting?.resume(returning: frame); waiting = nil
    }
    func close() async { waiting?.resume(throwing: CancellationError()); waiting = nil }
    func closeCode() async -> Int { 0 }
}
private actor IdentityRunOutcome {
    private(set) var result: String?
    func set(_ value: String) { result = value }
}

private actor FixtureSocket: CollaborationSocket {
    let level: String
    let userID: String
    let acknowledges: Bool
    init(level: String = "edit", userID: String = "user", acknowledges: Bool = true) { self.level = level; self.userID = userID; self.acknowledges = acknowledges }
    private var queue: [Data] = []
    private(set) var presenceUpdates: [Data] = []
    private(set) var awarenessQueries = 0
    private(set) var refreshes = 0
    private var waiting: CheckedContinuation<Data?, Error>?
    private var closed = false
    func send(_ data: Data) async throws {
        switch try WorldsSyncWire.decode(data) {
        case let .sync(channel, kind, _) where kind == 0:
            if channel == 0 { try deliver(WorldsSyncWire.encode(.authState(level: level, userID: userID))) }
            try deliver(WorldsSyncWire.encode(.sync(channel: channel, kind: 0, payload: Data([0]))))
        case let .update(batchID, _, _):
            if acknowledges { try deliver(WorldsSyncWire.encode(.acknowledgement(batchID: batchID, status: 0, reason: ""))) }
        case let .awareness(payload): presenceUpdates.append(payload)
        case .queryAwareness: awarenessQueries += 1
        case .authRefresh: refreshes += 1
        default: break
        }
    }
    private func deliver(_ bytes: Data) throws {
        if let waiting { self.waiting = nil; waiting.resume(returning: bytes) }
        else { queue.append(bytes) }
    }
    func emitAccess(_ value: String) throws {
        try deliver(WorldsSyncWire.encode(.authState(level: value, userID: userID)))
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

extension WorldsCollaborationTests {
    func testMalformedLocalUpdateNeverPoisonsOutboxOrReopenedReplica() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-invalid-update-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: copy)
        defer { try? FileManager.default.removeItem(at: copy) }
        let store = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let before = try await store.load(pageID: "fixture-page", channel: 0)
        let pending = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
        let socket = FixtureSocket(level: "edit", userID: "editor", acknowledges: false)
        let session = try CollaborationSession(pageID: "fixture-page", workspaceID: "fixture-workspace", documentID: "fixture-page", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, store: store, tokenProvider: { _ in "fixture-token" }, socketFactory: { _, _ in socket })
        let run = Task { try await session.run() }
        defer { Task { await session.stop() } }
        for _ in 0..<100 { if await session.accessLevel == "edit" { break }; try await Task.sleep(for: .milliseconds(10)) }
        guard await session.accessLevel == "edit" else { await session.stop(); _ = try? await run.value; return XCTFail("Authentication was not observed") }
        do { try await session.appendLocal(channel: 0, update: Data([255])); XCTFail("Malformed update must fail before storage") }
        catch CRDTError.invalidUpdate { }
        await session.stop(); _ = try? await run.value
        let reopened = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let after = try await reopened.load(pageID: "fixture-page", channel: 0)
        let afterPending = try await reopened.maximumPendingID(pageID: "fixture-page", channel: 0)
        XCTAssertEqual(after, before); XCTAssertEqual(afterPending, pending)
        let replica = try NativeCRDTDocument()
        for update in after { try replica.apply(update) }
    }
    func testStoppedSessionDoesNotSendDelayedRefreshToken() async throws {
        let store = FixtureStore(), socket = FixtureSocket(), token = PausedRefreshToken()
        let session = try CollaborationSession(pageID: "p", workspaceID: "w", documentID: "p", expectedUserID: "user", serverURL: URL(string: "https://example.invalid")!, store: store, tokenProvider: { force in await token.token(force: force) }, socketFactory: { _, _ in socket })
        let run = Task { try await session.run() }
        defer { Task { await token.release(); await session.stop() } }
        for _ in 0..<100 { if await session.accessLevel == "edit" { break }; try await Task.sleep(for: .milliseconds(10)) }
        guard await session.accessLevel == "edit" else { await session.stop(); _ = try? await run.value; return XCTFail("Authentication was not observed") }
        let refresh = Task { try await session.refreshAuthentication() }
        for _ in 0..<100 { if await token.refreshStarted { break }; try await Task.sleep(for: .milliseconds(10)) }
        guard await token.refreshStarted else { refresh.cancel(); await token.release(); await session.stop(); _ = try? await run.value; return XCTFail("Refresh did not start") }
        await session.stop()
        await token.release()
        do { try await refresh.value; XCTFail("A stopped connection must not send a token") }
        catch CollaborationError.notStarted { }
        let count = await socket.refreshes; XCTAssertEqual(count, 0)
        _ = try? await run.value
    }
    func testClearPresenceClosesSocketDuringBlockedSend() async throws {
        let store = FixtureStore(), socket = DelayedPresenceSocket()
        let session = try CollaborationSession(pageID: "p", workspaceID: "w", documentID: "p", expectedUserID: "user", serverURL: URL(string: "https://example.invalid")!, store: store, tokenProvider: { _ in "fixture-token" }, socketFactory: { _, _ in socket })
        let run = Task { try await session.run() }
        defer { Task { await socket.releaseSend(); await session.stop() } }
        for _ in 0..<100 { if await session.accessLevel == "edit" { break }; try await Task.sleep(for: .milliseconds(10)) }
        guard await session.accessLevel == "edit" else { await session.stop(); _ = try? await run.value; return XCTFail("Authentication was not observed") }
        let send = Task { try await session.setPresence(name: "Fixture", color: "#123456") }
        for _ in 0..<100 { if await socket.sendStarted { break }; try await Task.sleep(for: .milliseconds(10)) }
        guard await socket.sendStarted else { send.cancel(); await session.stop(); _ = try? await run.value; return XCTFail("Presence send was not reached") }
        let clear = Task { try await session.clearPresence() }
        // Wait for the actor to apply the local removal before releasing send.
        for _ in 0..<100 { if await session.presenceSnapshot().isEmpty { break }; try await Task.sleep(for: .milliseconds(10)) }
        let locallyCleared = await session.presenceSnapshot().isEmpty
        if !locallyCleared { await socket.releaseSend(); _ = try? await send.value; _ = try? await clear.value; await session.stop(); _ = try? await run.value; return XCTFail("Local presence was not cleared") }
        for _ in 0..<100 { if await socket.closed { break }; try await Task.sleep(for: .milliseconds(10)) }
        let closedBeforeRelease = await socket.closed
        await socket.releaseSend()
        try await send.value; try await clear.value
        XCTAssertTrue(closedBeforeRelease, "Clearing presence must not wait for an in-flight send")
        await session.stop(); _ = try? await run.value
    }
    func testStopClosesDuringBlockedPresenceAndPreservesOutbox() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-stop-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: copy)
        defer { try? FileManager.default.removeItem(at: copy) }
        let store = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        try await store.appendLocal(pageID: "fixture-page", channel: 0, update: Data([0, 0]))
        let pending = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
        XCTAssertNotNil(pending)
        let socket = DelayedPresenceSocket(userID: "editor")
        let session = try CollaborationSession(pageID: "fixture-page", workspaceID: "fixture-workspace", documentID: "fixture-page", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, store: store, tokenProvider: { _ in "fixture-token" }, socketFactory: { _, _ in socket })
        let run = Task { try await session.run() }
        defer { Task { await socket.releaseSend(); await session.stop() } }
        for _ in 0..<100 { if await session.accessLevel == "edit" { break }; try await Task.sleep(for: .milliseconds(10)) }
        guard await session.accessLevel == "edit" else { await session.stop(); _ = try? await run.value; return XCTFail("Authentication was not observed") }
        let send = Task { try await session.setPresence(name: "Fixture", color: "#123456") }
        for _ in 0..<100 { if await socket.sendStarted { break }; try await Task.sleep(for: .milliseconds(10)) }
        guard await socket.sendStarted else { await socket.releaseSend(); await session.stop(); _ = try? await run.value; return XCTFail("Presence send was not reached") }
        let stop = Task { await session.stop() }
        for _ in 0..<100 { if await socket.closed { break }; try await Task.sleep(for: .milliseconds(10)) }
        let closedBeforeRelease = await socket.closed
        await socket.releaseSend()
        _ = try? await send.value; await stop.value; _ = try? await run.value
        XCTAssertTrue(closedBeforeRelease, "Stop must close the socket without waiting for an in-flight presence frame")
        let reopened = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let remaining = try await reopened.maximumPendingID(pageID: "fixture-page", channel: 0)
        XCTAssertEqual(remaining, pending)
    }
    func testChangedLocalAccountStopsSessionAndKeepsPendingOutbox() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-account-switch-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: copy)
        defer { try? FileManager.default.removeItem(at: copy) }
        let store = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        try await store.appendLocal(pageID: "fixture-page", channel: 0, update: Data([0, 0]))
        let pendingID = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
        let initial = try XCTUnwrap(pendingID)
        let socket = IdentityChangeSocket(), outcome = IdentityRunOutcome()
        let session = try CollaborationSession(pageID: "fixture-page", workspaceID: "fixture-workspace", documentID: "fixture-page", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, store: store, tokenProvider: { _ in "fixture-token" }, socketFactory: { _, _ in socket })
        let run = Task {
            do { try await session.run(); await outcome.set("returned") }
            catch CollaborationStorageError.denied { await outcome.set("denied") }
            catch { await outcome.set("other") }
        }
        defer { Task { await session.stop() } }
        for _ in 0..<100 { if await socket.ready { break }; try await Task.sleep(for: .milliseconds(10)) }
        guard await socket.ready else { await session.stop(); await run.value; return XCTFail("Connection was not authenticated") }
        var raw: OpaquePointer?
        guard sqlite3_open(copy.path, &raw) == SQLITE_OK, let db = raw else { await session.stop(); await run.value; return XCTFail("Fixture database could not open") }
        let changed = sqlite3_exec(db, "UPDATE account SET user_id='other' WHERE id=1", nil, nil, nil)
        sqlite3_close(db); XCTAssertEqual(changed, SQLITE_OK)
        try await socket.requestSync()
        for _ in 0..<200 { if await outcome.result != nil { break }; try await Task.sleep(for: .milliseconds(10)) }
        let result = await outcome.result
        if result == nil { await session.stop() }
        await run.value
        XCTAssertEqual(result, "denied")
        var reopened: OpaquePointer?
        guard sqlite3_open_v2(copy.path, &reopened, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db = reopened else { return XCTFail("Fixture could not reopen") }
        defer { sqlite3_close(db) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT MAX(id) FROM sync_outbox WHERE page_id='fixture-page' AND channel=0 AND state='pending'", -1, &statement, nil) == SQLITE_OK, let statement else { return XCTFail("Outbox query failed") }
        defer { sqlite3_finalize(statement) }
        XCTAssertEqual(sqlite3_step(statement), SQLITE_ROW)
        XCTAssertEqual(sqlite3_column_int64(statement, 0), initial)
    }
    func testPresenceIsExplicitAndClearSendsRemoval() async throws {
        let store = FixtureStore(), socket = FixtureSocket()
        let session = try CollaborationSession(pageID: "p", workspaceID: "w", documentID: "p", expectedUserID: "user", serverURL: URL(string: "https://example.invalid")!, store: store, tokenProvider: { _ in "fixture-token" }, socketFactory: { _, _ in socket })
        let run = Task { try await session.run() }
        defer { Task { await session.stop() } }
        for _ in 0..<100 { if await session.accessLevel == "edit" { break }; try await Task.sleep(for: .milliseconds(10)) }
        guard await session.accessLevel == "edit" else { await session.stop(); _ = try? await run.value; return XCTFail("Authentication was not observed") }
        try await session.pulseAwareness(at: Date().timeIntervalSince1970 + 30)
        let before = await socket.presenceUpdates; XCTAssertTrue(before.isEmpty)
        try await session.setPresence(name: "Fixture", color: "#123456")
        try await session.clearPresence()
        let entries = await socket.presenceUpdates
        XCTAssertEqual(entries.count, 2)
        let removal = try WorldsSyncWire.decodeAwarenessUpdate(try XCTUnwrap(entries.last))
        XCTAssertEqual(removal.first?.state, "null")
        let queries = await socket.awarenessQueries
        try await socket.emitAccess("edit")
        for _ in 0..<100 { if await socket.awarenessQueries > queries { break }; try await Task.sleep(for: .milliseconds(10)) }
        let refreshed = await socket.awarenessQueries; XCTAssertGreaterThan(refreshed, queries)
        try await session.pulseAwareness(at: Date().timeIntervalSince1970 + 60)
        let after = await socket.presenceUpdates; XCTAssertEqual(after.count, 2)
        await session.stop(); _ = try? await run.value
    }
    func testDisconnectedSocketCannotAuthorizeLocalWritesWhileClosing() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-closing-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: copy)
        defer { try? FileManager.default.removeItem(at: copy) }
        let store = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let pending = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
        let socket = PausedDisconnectSocket()
        let session = try CollaborationSession(pageID: "fixture-page", workspaceID: "fixture-workspace", documentID: "fixture-page", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, store: store, tokenProvider: { _ in "fixture-token" }, socketFactory: { _, _ in socket })
        let run = Task { try await session.run() }
        defer { Task { await socket.releaseClose(); await session.stop() } }
        for _ in 0..<100 { if await session.accessLevel == "edit" { break }; try await Task.sleep(for: .milliseconds(10)) }
        guard await session.accessLevel == "edit" else { await session.stop(); _ = try? await run.value; return XCTFail("Authentication was not observed") }
        for _ in 0..<100 { if await socket.waitingForReceive { break }; try await Task.sleep(for: .milliseconds(10)) }
        guard await socket.waitingForReceive else { await session.stop(); _ = try? await run.value; return XCTFail("Receive was not reached") }
        await socket.disconnect()
        for _ in 0..<100 { if await socket.waitingForCloseCode { break }; try await Task.sleep(for: .milliseconds(10)) }
        guard await socket.waitingForCloseCode else { await socket.releaseClose(); await session.stop(); _ = try? await run.value; return XCTFail("Close was not reached") }
        do { try await session.appendLocal(channel: 0, update: Data([0, 0])); XCTFail("Closed connection must not authorize writes") }
        catch CollaborationError.accessRevoked { }
        let after = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
        XCTAssertEqual(after, pending)
        await session.stop(); await socket.releaseClose(); _ = try? await run.value
    }
    func testLivePermissionDowngradeBlocksNewContentWithoutDiscardingOutbox() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-downgrade-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: copy)
        defer { try? FileManager.default.removeItem(at: copy) }
        let store = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        // The already durable update belongs to the previous authorized session.
        try await store.appendLocal(pageID: "fixture-page", channel: 0, update: Data([0, 0]))
        let initial = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
        let socket = FixtureSocket(level: "edit", userID: "editor", acknowledges: false)
        let session = try CollaborationSession(pageID: "fixture-page", workspaceID: "fixture-workspace", documentID: "fixture-page", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, store: store, tokenProvider: { _ in "fixture-token" }, socketFactory: { _, _ in socket })
        let run = Task { try await session.run() }
        defer { Task { await session.stop() } }
        for _ in 0..<100 { if await session.accessLevel == "edit" { break }; try await Task.sleep(for: .milliseconds(10)) }
        guard await session.accessLevel == "edit" else { await session.stop(); _ = try? await run.value; return XCTFail("Authentication was not observed") }
        try await socket.emitAccess("comment")
        for _ in 0..<100 { if await session.accessLevel == "comment" { break }; try await Task.sleep(for: .milliseconds(10)) }
        guard await session.accessLevel == "comment" else { await session.stop(); _ = try? await run.value; return XCTFail("Downgrade was not observed") }
        let before = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
        do { try await session.appendLocal(channel: 0, update: Data([0, 0])); XCTFail("Comment access cannot edit content") }
        catch CollaborationError.accessRevoked { }
        let after = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
        XCTAssertEqual(before, after)
        XCTAssertNotNil(initial); XCTAssertEqual(before, initial)
        await session.stop(); _ = try? await run.value
    }
    func testPlainProjectionUsesYjsFixtureAndRejectsRichText() throws {
        let plain = try XCTUnwrap(Data(base64Encoded: "AQTpBwAHAQdkZWZhdWx0AwlwYXJhZ3JhcGgoAOkHAANiaWQBdwdibG9jay0xBwDpBwAGBADpBwIKSGVsbG8g8J+MjQA="))
        let doc = try NativeCRDTDocument(); try doc.apply(plain)
        let tree = try XCTUnwrap(try JSONSerialization.jsonObject(with: doc.plainProjection()) as? [String: Any])
        let blocks = try XCTUnwrap(tree["content"] as? [[String: Any]])
        let children = try XCTUnwrap(blocks.first?["content"] as? [[String: Any]])
        XCTAssertEqual(children.first?["text"] as? String, "Hello 🌍")
        let rich = try NativeCRDTDocument()
        try rich.apply(try XCTUnwrap(Data(base64Encoded: "AQbqBwAHAQdkZWZhdWx0AwlwYXJhZ3JhcGgoAOoHAANiaWQBdwdibG9jay0xBwDqBwAGBgDqBwIEYm9sZAR0cnVlhOoHAw1ZanMgcmljaCB0ZXh0huoHEARib2xkBG51bGwA")))
        let richTree = try XCTUnwrap(try JSONSerialization.jsonObject(with: rich.plainProjection()) as? [String: Any])
        XCTAssertNotNil(richTree["content"])
    }
    func testRejectsAmbiguousServiceBasePathsBeforeConnecting() throws {
        let store = FixtureStore()
        for value in ["https://example.invalid/a/../private", "https://example.invalid/a/%2e%2e/private", "https://example.invalid/a%2fb", "https://example.invalid/a//b"] {
            let url = try XCTUnwrap(URL(string: value))
            XCTAssertThrowsError(try CollaborationSession(pageID: "p", workspaceID: "w", documentID: "p", expectedUserID: "user", serverURL: url, store: store, tokenProvider: { _ in "fixture-token" }), value)
        }
        XCTAssertNoThrow(try CollaborationSession(pageID: "p", workspaceID: "w", documentID: "p", expectedUserID: "user", serverURL: URL(string: "https://example.invalid/base")!, store: store, tokenProvider: { _ in "fixture-token" }))
    }

    func testRejectionWaitsForPersistedLocalWriteBeforeArchiving() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-reject-race-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: copy)
        defer { try? FileManager.default.removeItem(at: copy) }
        let actual = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let gate = PausedRealStore(actual), socket = RejectionSocket()
        let session = try CollaborationSession(pageID: "fixture-page", workspaceID: "fixture-workspace", documentID: "fixture-page", expectedUserID: "editor",
            serverURL: URL(string: "https://example.invalid")!, store: gate, tokenProvider: { _ in "fixture-token" }, socketFactory: { _, _ in socket })
        let run = Task { try await session.run() }
        defer { Task { await gate.release(); await session.stop() } }
        for _ in 0..<150 {
            if await socket.hasBatch { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        guard await socket.hasBatch else { return XCTFail("No initial handshake batch") }
        let update = try XCTUnwrap(Data(base64Encoded: "AQbpBwAEAQZzaGFyZWQKSGVsbG8g8J+MjQcBB2RlZmF1bHQDCXBhcmFncmFwaAcA6QcIBgYA6QcJBGJvbGQEdHJ1ZYTpBwoNWWpzIHJpY2ggdGV4dIbpBxcEYm9sZARudWxsAA=="))
        let local = Task { try await session.appendLocal(channel: 0, update: update) }
        for _ in 0..<150 {
            if await gate.persisted { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        guard await gate.persisted else { return XCTFail("Local write was not persisted") }
        try await socket.reject()
        try await Task.sleep(for: .milliseconds(100))
        let archivedEarly = await gate.archived
        XCTAssertFalse(archivedEarly, "Archival must wait until the in-flight local write is applied")
        await gate.release(); try await local.value
        do { try await run.value; XCTFail("Expected a rejected write") }
        catch CollaborationError.rejected(_) { }
        var raw: OpaquePointer?
        guard sqlite3_open_v2(copy.path, &raw, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db = raw else { return XCTFail("Could not reopen fixture") }
        defer { sqlite3_close(db) }
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT data FROM sync_rejected_snapshots WHERE page_id='fixture-page' AND channel=0", -1, &stmt, nil) == SQLITE_OK, let stmt else { return XCTFail("Missing archive query") }
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_step(stmt) == SQLITE_ROW, let bytes = sqlite3_column_blob(stmt, 0) else { return XCTFail("Missing archive") }
        let archive = Data(bytes: bytes, count: Int(sqlite3_column_bytes(stmt, 0)))
        let archived = try NativeCRDTDocument(); try archived.apply(archive)
        let expected = try NativeCRDTDocument(); try expected.apply(update)
        XCTAssertEqual(try archived.vector(), try expected.vector())
    }

    func testSessionAcknowledgesHandshakeWatermark() async throws {
        let store = FixtureStore()
        let socket = FixtureSocket()
        let session = try CollaborationSession(pageID: "p", workspaceID: "w", documentID: "p", expectedUserID: "user",
            serverURL: URL(string: "https://example.invalid")!, store: store,
            tokenProvider: { _ in "fixture-token" }, socketFactory: { _, _ in socket })
        let run = Task { try await session.run() }
        var acknowledged: Int64?
        for _ in 0..<100 {
            acknowledged = await store.acknowledged
            if acknowledged != nil { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        await session.stop()
        try await run.value
        XCTAssertEqual(acknowledged, 7)
    }
}

extension WorldsCollaborationTests {
    func testSQLiteStoreOnWorldsV11Fixture() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-v11", withExtension: "db"))
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-collab-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: destination)
        defer { try? FileManager.default.removeItem(at: destination) }
        let store = try SQLiteCollaborationStore(databaseURL: destination, pageID: "fixture-page", userID: "fixture-user", workspaceID: "fixture-workspace")
        let update = Data([0, 0])
        try await store.appendLocal(pageID: "fixture-page", channel: 0, update: update)
        let pending = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
        let watermark = try XCTUnwrap(pending)
        try await store.appendLocal(pageID: "fixture-page", channel: 0, update: update)
        try await store.acknowledge(pageID: "fixture-page", channel: 0, through: watermark)
        let later = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
        XCTAssertGreaterThan(try XCTUnwrap(later), watermark)
        let reopened = try SQLiteCollaborationStore(databaseURL: destination, pageID: "fixture-page", userID: "fixture-user", workspaceID: "fixture-workspace")
        let updates = try await reopened.load(pageID: "fixture-page", channel: 0)
        XCTAssertEqual(updates, [update, update])
        try await reopened.archiveRejection(pageID: "fixture-page", channel: 0, state: update, reason: "denied")
        let remaining = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
        XCTAssertNil(remaining)
        let reset = try await store.load(pageID: "fixture-page", channel: 0)
        XCTAssertEqual(reset, [update])
        XCTAssertThrowsError(try SQLiteCollaborationStore(databaseURL: destination, pageID: "fixture-page", userID: "other", workspaceID: "fixture-workspace"))
    }
    func testRejectedArchiveListAndReadRespectAccount() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-v11", withExtension: "db"))
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-archive-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: destination)
        defer { try? FileManager.default.removeItem(at: destination) }
        let store = try SQLiteCollaborationStore(databaseURL: destination, pageID: "fixture-page", userID: "fixture-user", workspaceID: "fixture-workspace")
        try await store.appendLocal(pageID: "fixture-page", channel: 0, update: Data([0, 0]))
        try await store.archiveRejection(pageID: "fixture-page", channel: 0, state: Data([0, 0]), reason: "denied")
        let page = try await store.rejectedArchives()
        XCTAssertEqual(page.items.count, 1)
        let item = try XCTUnwrap(page.items.first)
        XCTAssertEqual(item.reason, "denied"); XCTAssertNil(page.next)
        let recovered = try await store.readRejectedSnapshot(id: item.id)
        XCTAssertEqual(recovered, Data([0, 0]))
        let pending = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
        XCTAssertNil(pending)
        var handle: OpaquePointer?
        XCTAssertEqual(sqlite3_open(destination.path, &handle), SQLITE_OK)
        let database = try XCTUnwrap(handle)
        XCTAssertEqual(sqlite3_exec(database, "UPDATE account SET user_id='other'", nil, nil, nil), SQLITE_OK)
        sqlite3_close(database)
        do { _ = try await store.rejectedArchives(); XCTFail("Changed account must be refused") }
        catch CollaborationStorageError.denied { } catch { XCTFail("Unexpected error: \(error)") }
        do { _ = try await store.readRejectedSnapshot(id: item.id); XCTFail("Changed account must be refused") }
        catch CollaborationStorageError.denied { } catch { XCTFail("Unexpected error: \(error)") }
    }
}


private actor PrematureSyncSocket: CollaborationSocket {
    private var sent = false
    func send(_ data: Data) async throws {}
    func receive() async throws -> Data? {
        if !sent {
            sent = true
            return try WorldsSyncWire.encode(.sync(channel: 0, kind: 2, payload: Data([0, 0])))
        }
        throw CancellationError()
    }
    func close() async {}
    func closeCode() async -> Int { 0 }
}

private actor FailedConnectionLog {
    private(set) var starts: [Date] = []
    private(set) var failures = 0
    func next() -> any CollaborationSocket { starts.append(Date()); return FailingConnection(log: self) }
    func failed() { failures += 1 }
}
private struct FailingConnection: CollaborationSocket {
    let log: FailedConnectionLog
    func send(_ data: Data) async throws { }
    func receive() async throws -> Data? { await log.failed(); throw URLError(.networkConnectionLost) }
    func close() async { }
    func closeCode() async -> Int { 0 }
}
private actor ReconnectingFactory {
    private(set) var count = 0
    let log = FailedConnectionLog()
    let working = FixtureSocket(userID: "editor")
    func next() -> any CollaborationSocket {
        count += 1
        if count == 1 { return FailingConnection(log: log) }
        return working
    }
}

private actor MissingAcknowledgementFactory {
    private(set) var count = 0
    private let first = FixtureSocket(userID: "editor", acknowledges: false)
    private let second = FixtureSocket(userID: "editor")
    func next() -> any CollaborationSocket { count += 1; return count == 1 ? first : second }
}

private actor BlockedUpdateSocket: CollaborationSocket {
    private let underlying = FixtureSocket(userID: "editor")
    private var waiting: CheckedContinuation<Void, Error>?
    private(set) var blocked = false
    private(set) var closed = false
    func send(_ data: Data) async throws {
        if case .update = try WorldsSyncWire.decode(data) {
            blocked = true
            try await withCheckedThrowingContinuation { waiting = $0 }
        } else { try await underlying.send(data) }
    }
    func receive() async throws -> Data? { try await underlying.receive() }
    func close() async {
        closed = true
        if let waiting { self.waiting = nil; waiting.resume(throwing: CancellationError()) }
        await underlying.close()
    }
    func closeCode() async -> Int { await underlying.closeCode() }
}
private actor BlockedUpdateFactory {
    let first = BlockedUpdateSocket()
    let second = FixtureSocket(userID: "editor")
    private(set) var count = 0
    func next() -> any CollaborationSocket { count += 1; return count == 1 ? first : second }
}

extension WorldsCollaborationTests {
    func testBlockedUpdateSendTimesOutAndResendsDurableOutbox() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-blocked-send-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: copy)
        defer { try? FileManager.default.removeItem(at: copy) }
        let store = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let update = try XCTUnwrap(Data(base64Encoded: "AQbpBwAEAQZzaGFyZWQKSGVsbG8g8J+MjQcBB2RlZmF1bHQDCXBhcmFncmFwaAcA6QcIBgYA6QcJBGJvbGQEdHJ1ZYTpBwoNWWpzIHJpY2ggdGV4dIbpBxcEYm9sZARudWxsAA=="))
        try await store.appendLocal(pageID: "fixture-page", channel: 0, update: update)
        let factory = BlockedUpdateFactory()
        let session = try CollaborationSession(pageID: "fixture-page", workspaceID: "fixture-workspace", documentID: "fixture-page", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, store: store, tokenProvider: { _ in "fixture-token" }, socketFactory: { _, _ in await factory.next() }, acknowledgementTimeout: .milliseconds(100))
        let run = Task { try await session.run() }
        defer { Task { await session.stop() } }
        var resent = false
        for _ in 0..<250 {
            let count = await factory.count
            let remaining = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
            if count >= 2 && remaining == nil { resent = true; break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let blocked = await factory.first.blocked
        let closed = await factory.first.closed
        await session.stop(); _ = try? await run.value
        XCTAssertTrue(blocked); XCTAssertTrue(closed)
        XCTAssertTrue(resent, "A stalled send must close the socket and retry its durable outbox")
        let updates = try await store.load(pageID: "fixture-page", channel: 0)
        XCTAssertTrue(updates.contains(update))
    }
    func testMissingAcknowledgementReconnectsAndResendsDurableOutbox() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-missing-ack-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: copy)
        defer { try? FileManager.default.removeItem(at: copy) }
        let store = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let update = try XCTUnwrap(Data(base64Encoded: "AQbpBwAEAQZzaGFyZWQKSGVsbG8g8J+MjQcBB2RlZmF1bHQDCXBhcmFncmFwaAcA6QcIBgYA6QcJBGJvbGQEdHJ1ZYTpBwoNWWpzIHJpY2ggdGV4dIbpBxcEYm9sZARudWxsAA=="))
        try await store.appendLocal(pageID: "fixture-page", channel: 0, update: update)
        let pending = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
        XCTAssertNotNil(pending)
        let factory = MissingAcknowledgementFactory()
        let session = try CollaborationSession(pageID: "fixture-page", workspaceID: "fixture-workspace", documentID: "fixture-page", expectedUserID: "editor", serverURL: URL(string: "https://example.invalid")!, store: store, tokenProvider: { _ in "fixture-token" }, socketFactory: { _, _ in await factory.next() }, acknowledgementTimeout: .milliseconds(100))
        let run = Task { try await session.run() }
        defer { Task { await session.stop() } }
        var resent = false
        for _ in 0..<250 {
            let connections = await factory.count
            let remaining = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
            if connections >= 2 && remaining == nil { resent = true; break }
            try await Task.sleep(for: .milliseconds(20))
        }
        await session.stop(); _ = try? await run.value
        XCTAssertTrue(resent, "A missing acknowledgement must trigger reconnect and resend")
        let updates = try await store.load(pageID: "fixture-page", channel: 0)
        XCTAssertTrue(updates.contains(update))
    }
    func testDurableOutboxResentAfterFailedConnection() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-reconnect-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: copy)
        defer { try? FileManager.default.removeItem(at: copy) }
        let store = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        try await store.appendLocal(pageID: "fixture-page", channel: 0, update: Data([0, 0]))
        let initial = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
        XCTAssertNotNil(initial)
        let factory = ReconnectingFactory()
        let session = try CollaborationSession(pageID: "fixture-page", workspaceID: "fixture-workspace", documentID: "fixture-page", expectedUserID: "editor",
            serverURL: URL(string: "https://example.invalid")!, store: store,
            tokenProvider: { _ in "fixture-token" }, socketFactory: { _, _ in await factory.next() })
        let run = Task { try await session.run() }
        var acknowledged = false
        for _ in 0..<200 {
            if try await store.maximumPendingID(pageID: "fixture-page", channel: 0) == nil { acknowledged = true; break }
            try await Task.sleep(for: .milliseconds(20))
        }
        await session.stop(); try await run.value
        XCTAssertTrue(acknowledged)
        let attempts = await factory.count
        XCTAssertGreaterThanOrEqual(attempts, 2)
        let reopened = try SQLiteCollaborationStore(databaseURL: copy, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let updates = try await reopened.load(pageID: "fixture-page", channel: 0)
        XCTAssertTrue(updates.contains(Data([0, 0])))
    }

    func testUnauthenticatedReconnectBacksOffAndStopInterruptsWait() async throws {
        let log = FailedConnectionLog()
        let session = try CollaborationSession(pageID: "p", workspaceID: "w", documentID: "p", expectedUserID: "user",
            serverURL: URL(string: "https://example.invalid")!, store: FixtureStore(),
            tokenProvider: { _ in "fixture-token" }, socketFactory: { _, _ in await log.next() })
        let run = Task { try await session.run() }
        var completed = false
        for _ in 0..<250 {
            if await log.failures >= 3 { completed = true; break }
            try await Task.sleep(for: .milliseconds(20))
        }
        guard completed else { await session.stop(); _ = try? await run.value; return XCTFail("Connections did not retry") }
        let times = await log.starts
        XCTAssertGreaterThanOrEqual(times[1].timeIntervalSince(times[0]), 0.8)
        XCTAssertGreaterThanOrEqual(times[2].timeIntervalSince(times[1]), 1.7)
        try await Task.sleep(for: .milliseconds(50))
        let stoppedAt = Date()
        await session.stop()
        try await run.value
        XCTAssertLessThan(Date().timeIntervalSince(stoppedAt), 1.0, "stop should cancel the retry delay")
    }
}

extension WorldsCollaborationTests {
    func testRejectsSyncBeforeIdentityVerification() async throws {
        let store = FixtureStore(), socket = PrematureSyncSocket()
        let session = try CollaborationSession(pageID: "p", workspaceID: "w", documentID: "p", expectedUserID: "user",
            serverURL: URL(string: "https://example.invalid")!, store: store,
            tokenProvider: { _ in "fixture-token" }, socketFactory: { _, _ in socket })
        do { try await session.run(); XCTFail("Unverified server data must be rejected") }
        catch CollaborationError.accessRevoked { }
        catch { XCTFail("Unexpected error: \(error)") }
    }
}

extension WorldsCollaborationTests {
    func testCheckedDeleteAndFormatPersistThroughNativeStore() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-collab-edits-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let plain = try XCTUnwrap(Data(base64Encoded: "AQTpBwAHAQdkZWZhdWx0AwlwYXJhZ3JhcGgoAOkHAANiaWQBdwdibG9jay0xBwDpBwAGBADpBwIKSGVsbG8g8J+MjQA="))
        let rich = try XCTUnwrap(Data(base64Encoded: "AQbqBwAHAQdkZWZhdWx0AwlwYXJhZ3JhcGgoAOoHAANiaWQBdwdibG9jay0xBwDqBwAGBgDqBwIEYm9sZAR0cnVlhOoHAw1ZanMgcmljaCB0ZXh0huoHEARib2xkBG51bGwA"))
        for (name, base) in [("delete", plain), ("format", rich)] {
            let url = directory.appendingPathComponent(name + ".db"); try FileManager.default.copyItem(at: source, to: url)
            let store = try SQLiteCollaborationStore(databaseURL: url, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
            try await store.appendRemote(pageID: "fixture-page", channel: 0, update: base)
            if name == "delete" {
                _ = try await store.deletePlainChecked(base: base, blockIndex: 0, blockID: "block-1", expected: "Hello 🌍", offset: 6, length: 2)
            } else {
                _ = try await store.formatPlainChecked(base: base, blockIndex: 0, blockID: "block-1", expected: "Yjs rich text", offset: 4, length: 4, mark: "italic", enabled: true)
            }
            let updates = try await store.load(pageID: "fixture-page", channel: 0)
            XCTAssertEqual(updates.count, 2)
            let pending = try await store.maximumPendingID(pageID: "fixture-page", channel: 0)
            XCTAssertNotNil(pending)
        }
    }
    func testCheckedEditorWritePersistsAndRejectsStaleBase() async throws {
        let source = try XCTUnwrap(Bundle.module.url(forResource: "worlds-collab-editor-v11", withExtension: "db"))
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-edit-\(UUID().uuidString).db")
        try FileManager.default.copyItem(at: source, to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        let store = try SQLiteCollaborationStore(databaseURL: url, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let base = try XCTUnwrap(Data(base64Encoded: "AQTpBwAHAQdkZWZhdWx0AwlwYXJhZ3JhcGgoAOkHAANiaWQBdwdibG9jay0xBwDpBwAGBADpBwIKSGVsbG8g8J+MjQA="))
        try await store.appendRemote(pageID: "fixture-page", channel: 0, update: base)
        let update = try await store.insertPlainChecked(base: base, blockIndex: 0, blockID: "block-1", expected: "Hello 🌍", offset: 6, insertion: "Alice ")
        XCTAssertFalse(update.isEmpty)
        do { _ = try await store.insertPlainChecked(base: base, blockIndex: 0, blockID: "block-1", expected: "Hello 🌍", offset: 6, insertion: "Bob "); XCTFail("Stale base must be rejected") }
        catch CollaborationStorageError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        let reopened = try SQLiteCollaborationStore(databaseURL: url, pageID: "fixture-page", userID: "editor", workspaceID: "fixture-workspace")
        let updates = try await reopened.load(pageID: "fixture-page", channel: 0)
        XCTAssertEqual(updates.count, 2)
        let pending = try await reopened.maximumPendingID(pageID: "fixture-page", channel: 0)
        XCTAssertNotNil(pending)
    }
}

extension WorldsCollaborationTests {
    func testViewerCannotPrepareEditorWrite() async throws {
        let store = FixtureStore(), socket = FixtureSocket(level: "view")
        let session = try CollaborationSession(pageID: "p", workspaceID: "w", documentID: "p", expectedUserID: "user",
            serverURL: URL(string: "https://example.invalid")!, store: store,
            tokenProvider: { _ in "fixture-token" }, socketFactory: { _, _ in socket })
        let run = Task { try await session.run() }
        for _ in 0..<100 {
            if await session.accessLevel == "view" { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        do { try await session.insertPlain(blockIndex: 0, blockID: "x", expected: "text", offset: 0, insertion: "x"); XCTFail("Viewer must not write") }
        catch CollaborationError.accessRevoked { } catch { XCTFail("Unexpected error: \(error)") }
        let writes = await store.editorWrites
        await session.stop(); try await run.value
        XCTAssertEqual(writes, 0)
    }
}

private final class RedirectProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var rejected = false
    func record(_ value: Bool) { lock.lock(); defer { lock.unlock() }; rejected = value }
    func result() -> Bool { lock.lock(); defer { lock.unlock() }; return rejected }
}

extension WorldsCollaborationTests {
    func testDefaultTransportRejectsRedirectBeforeBearerCanBeForwarded() throws {
        let from = try XCTUnwrap(URL(string: "https://identity.example.invalid/socket"))
        let to = try XCTUnwrap(URL(string: "https://other.example.invalid/socket"))
        let response = try XCTUnwrap(HTTPURLResponse(url: from, statusCode: 302, httpVersion: nil, headerFields: ["Location": to.absoluteString]))
        var request = URLRequest(url: to); request.setValue("Bearer synthetic", forHTTPHeaderField: "Authorization")
        let task = URLSession.shared.dataTask(with: from), probe = RedirectProbe()
        RejectCollaborationRedirects().urlSession(.shared, task: task, willPerformHTTPRedirection: response, newRequest: request) { next in probe.record(next == nil) }
        XCTAssertTrue(probe.result())
    }
}

extension WorldsCollaborationTests {
    func testDefaultSocketLifecycleWithLocalRefusal() async throws {
        let url = try XCTUnwrap(URL(string: "ws://127.0.0.1:1/socket"))
        let first = URLSessionCollaborationSocket(url: url, token: "synthetic")
        let second = URLSessionCollaborationSocket(url: url, token: "synthetic")
        await first.close(); await second.close()
    }
}
