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

private actor FixtureStore: CollaborationStore {
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
    private var queue: [Data] = []
    private var waiting: CheckedContinuation<Data?, Error>?
    private var closed = false
    func send(_ data: Data) async throws {
        switch try WorldsSyncWire.decode(data) {
        case let .sync(channel, kind, _) where kind == 0:
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
        let session = try CollaborationSession(pageID: "p", workspaceID: "w", documentID: "p",
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
