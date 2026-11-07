import Foundation
import WorldsSyncWire

/// Yjs awareness state and clocks. Transport, timers and editor binding belong to the caller.
public struct WorldsAwareness: Sendable {
    public enum AwarenessError: Error { case invalidJSON, clockOverflow, clientIDCollision }
    public struct Peer: Equatable, Sendable {
        public let json: String
        public let clock: UInt64
        public let updatedAt: TimeInterval
    }
    private struct Metadata: Sendable { var clock: UInt64; var updatedAt: TimeInterval }
    public let clientID: UInt64
    public private(set) var peers: [UInt64: Peer] = [:]
    private var metadata: [UInt64: Metadata] = [:]

    public init(clientID: UInt64) { self.clientID = clientID }

    /// Set nil to leave. The caller transmits the returned update on the current socket.
    public mutating func setLocal(_ json: String?, at now: TimeInterval) throws -> Data {
        if let json, try Self.isNull(json) { throw AwarenessError.invalidJSON }
        let old = metadata[clientID]
        guard old?.clock != WorldsSyncWire.maxSafeInteger else { throw AwarenessError.clockOverflow }
        let clock = old.map { $0.clock + 1 } ?? 0
        metadata[clientID] = Metadata(clock: clock, updatedAt: now)
        if let json { peers[clientID] = Peer(json: json, clock: clock, updatedAt: now) }
        else { peers.removeValue(forKey: clientID) }
        return try WorldsSyncWire.encodeAwarenessUpdate([.init(clientID: clientID, clock: clock, state: json ?? "null")])
    }

    /// Returns an update to reassert local state if a remote peer tried to remove it.
    public mutating func apply(_ data: Data, at now: TimeInterval) throws -> Data? {
        let entries = try WorldsSyncWire.decodeAwarenessUpdate(data)
        let nullStates = try entries.map { try Self.isNull($0.state) }
        // A newer non-null state claiming our document client ID indicates a collision.
        // Do not overwrite our state or publish cursors under another document identity.
        for (index, entry) in entries.enumerated() where entry.clientID == clientID && !nullStates[index] {
            if let current = metadata[clientID], entry.clock > current.clock { throw AwarenessError.clientIDCollision }
        }
        var reassert: WorldsSyncWire.AwarenessEntry?
        for (index, entry) in entries.enumerated() {
            let previousClock = metadata[entry.clientID]?.clock ?? 0
            let isNull = nullStates[index]
            guard previousClock < entry.clock || (previousClock == entry.clock && isNull && peers[entry.clientID] != nil) else { continue }
            if isNull && entry.clientID == clientID, let local = peers[clientID] {
                guard entry.clock < WorldsSyncWire.maxSafeInteger else { throw AwarenessError.clockOverflow }
                let clock = entry.clock + 1
                metadata[clientID] = Metadata(clock: clock, updatedAt: now)
                peers[clientID] = Peer(json: local.json, clock: clock, updatedAt: now)
                reassert = .init(clientID: clientID, clock: clock, state: local.json)
            } else {
                metadata[entry.clientID] = Metadata(clock: entry.clock, updatedAt: now)
                if isNull { peers.removeValue(forKey: entry.clientID) }
                else { peers[entry.clientID] = Peer(json: entry.state, clock: entry.clock, updatedAt: now) }
            }
        }
        return try reassert.map { try WorldsSyncWire.encodeAwarenessUpdate([$0]) }
    }

    /// Call periodically. Yjs renews the local state at 15 s and expires remote peers at 30 s.
    public mutating func tick(at now: TimeInterval) throws -> Data? {
        for (id, peer) in Array(peers) where id != clientID && now - peer.updatedAt >= 30 {
            peers.removeValue(forKey: id)
        }
        guard let local = peers[clientID], now - local.updatedAt >= 15 else { return nil }
        return try setLocal(local.json, at: now)
    }
    /// On disconnection, forget remote live states but retain clocks like y-protocols.
    public mutating func disconnected() {
        for id in Array(peers.keys) where id != clientID { peers.removeValue(forKey: id) }
    }
    private static func isNull(_ json: String) throws -> Bool {
        guard let data = json.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { throw AwarenessError.invalidJSON }
        return value is NSNull
    }
}
