import Foundation
import XCTest
import WorldsSyncWire
@testable import WorldsCollaboration

final class WorldsCollaborationTests: XCTestCase {
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

private actor FixtureSocket: CollaborationSocket {
    let level: String
    init(level: String = "edit") { self.level = level }
    private var queue: [Data] = []
    private var waiting: CheckedContinuation<Data?, Error>?
    private var closed = false
    func send(_ data: Data) async throws {
        switch try WorldsSyncWire.decode(data) {
        case let .sync(channel, kind, _) where kind == 0:
            if channel == 0 { try deliver(WorldsSyncWire.encode(.authState(level: level, userID: "user"))) }
            try deliver(WorldsSyncWire.encode(.sync(channel: channel, kind: 0, payload: Data([0]))))
        case let .update(batchID, _, _):
            try deliver(WorldsSyncWire.encode(.acknowledgement(batchID: batchID, status: 0, reason: "")))
        default: break
        }
    }
    private func deliver(_ bytes: Data) throws {
        if let waiting { self.waiting = nil; waiting.resume(returning: bytes) }
        else { queue.append(bytes) }
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
