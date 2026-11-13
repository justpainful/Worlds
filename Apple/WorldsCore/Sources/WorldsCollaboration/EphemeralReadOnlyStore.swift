import Foundation

/// Memory-only store for viewing a shared page. It keeps the updates the
/// server sends for the life of one session and nothing else: local updates
/// are refused, there is no outbox, nothing is written to disk, and closing
/// the page forgets it. Because nothing is ever queued for sending, there is
/// no queued row whose owner must be proven before a bearer token is used,
/// which is what still blocks the SQLite store (see CollaborationHost).
public actor EphemeralReadOnlyStore: CollaborationStore {
    private let pageID: String
    private var updates: [UInt64: [Data]] = [:]

    public init(pageID: String) { self.pageID = pageID }

    public func load(pageID: String, channel: UInt64) async throws -> [Data] {
        guard pageID == self.pageID else { throw CollaborationStorageError.denied }
        return updates[channel] ?? []
    }
    /// Viewing never writes. Editing comes through a store that owns its outbox.
    public func appendLocal(pageID: String, channel: UInt64, update: Data) async throws {
        throw CollaborationError.accessRevoked
    }
    public func appendRemote(pageID: String, channel: UInt64, update: Data) async throws {
        guard pageID == self.pageID else { throw CollaborationStorageError.denied }
        updates[channel, default: []].append(update)
    }
    public func maximumPendingID(pageID: String, channel: UInt64) async throws -> Int64? { nil }
    /// Nothing is pending, so there is never anything to acknowledge.
    public func acknowledge(pageID: String, channel: UInt64, through: Int64) async throws {}
    /// There is no local edit to preserve; the session still stops on a rejection.
    public func archiveRejection(pageID: String, channel: UInt64, state: Data, reason: String) async throws {}
}
