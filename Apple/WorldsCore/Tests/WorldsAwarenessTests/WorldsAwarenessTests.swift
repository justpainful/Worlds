import Foundation
import XCTest
import WorldsSyncWire
@testable import WorldsAwareness

final class WorldsAwarenessTests: XCTestCase {
    func testActualYjsFixture() throws {
        // Produced by the repository's y-protocols Awareness and lib0 encoder.
        let hex = "010701307b2275736572223a7b226964223a2275222c226e616d65223a2241222c22636f6c6f72223a2223313233343536227d7d"
        let bytes = stride(from: 0, to: hex.count, by: 2).map { offset -> UInt8 in
            let start = hex.index(hex.startIndex, offsetBy: offset)
            return UInt8(hex[start..<hex.index(start, offsetBy: 2)], radix: 16)!
        }
        var awareness = WorldsAwareness(clientID: 10)
        _ = try awareness.apply(Data(bytes), at: 0)
        XCTAssertEqual(awareness.peers[7]?.clock, 1)
        XCTAssertEqual(awareness.peers[7]?.json, "{\"user\":{\"id\":\"u\",\"name\":\"A\",\"color\":\"#123456\"}}")
    }
    func testExchangeClocksAndLeave() throws {
        var alice = WorldsAwareness(clientID: 1), bob = WorldsAwareness(clientID: 2)
        let first = try alice.setLocal("{\"user\":{\"name\":\"Alice\"}}", at: 0)
        // Yjs local initialization normally advances clock zero to one before broadcasting.
        let second = try alice.setLocal("{\"user\":{\"name\":\"Alice\"}}", at: 1)
        XCTAssertNil(try bob.apply(first, at: 1))
        XCTAssertNil(bob.peers[1])
        XCTAssertNil(try bob.apply(second, at: 1))
        XCTAssertNotNil(bob.peers[1])
        _ = try bob.apply(first, at: 2)
        XCTAssertEqual(bob.peers[1]?.clock, 1)
        let left = try alice.setLocal(nil, at: 3)
        _ = try bob.apply(left, at: 3)
        XCTAssertNil(bob.peers[1])
    }
    func testExpiryHeartbeatAndLocalReassertion() throws {
        var a = WorldsAwareness(clientID: 1), b = WorldsAwareness(clientID: 2)
        _ = try a.setLocal("{}", at: 0)
        let initial = try a.setLocal("{}", at: 1)
        _ = try b.apply(initial, at: 1)
        XCTAssertNotNil(try a.tick(at: 16))
        _ = try b.tick(at: 31)
        XCTAssertNil(b.peers[1])
        let removal = try WorldsSyncWire.encodeAwarenessUpdate([.init(clientID: 1, clock: 3, state: "null")])
        let response = try a.apply(removal, at: 32)
        let decoded = try WorldsSyncWire.decodeAwarenessUpdate(XCTUnwrap(response))
        XCTAssertEqual(decoded.first?.clock, 4)
        XCTAssertNotNil(a.peers[1])
    }
    func testMalformedJSONDoesNotApplyPartialUpdate() throws {
        var a = WorldsAwareness(clientID: 1)
        let invalid = try WorldsSyncWire.encodeAwarenessUpdate([.init(clientID: 2, clock: 1, state: "{}"), .init(clientID: 3, clock: 1, state: "{")])
        XCTAssertThrowsError(try a.apply(invalid, at: 0))
        XCTAssertTrue(a.peers.isEmpty)
    }
    func testRejectsRemoteClientIDCollisionWithoutOverwritingLocalState() throws {
        var awareness = WorldsAwareness(clientID: 7)
        _ = try awareness.setLocal("{}", at: 0)
        let conflict = try WorldsSyncWire.encodeAwarenessUpdate([.init(clientID: 7, clock: 1, state: "{\"other\":true}")])
        XCTAssertThrowsError(try awareness.apply(conflict, at: 1))
        XCTAssertEqual(awareness.peers[7]?.json, "{}")
    }

}
