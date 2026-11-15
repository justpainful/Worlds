import Foundation

/// Memory-only store for working on a shared page while it is connected.
/// Like `EphemeralReadOnlyStore` it writes nothing to disk, but it accepts the
/// session's own local updates into an outbox that lives only as long as this
/// store. Every row in it was made by this session for this account, page and
/// workspace, so no row of unknown origin is ever sent with the person's
/// sign-in (the reason the SQLite store stays closed, see CollaborationHost).
/// A change that the server has not acknowledged is lost if the page closes;
/// the app waits for `pendingCount() == 0` before it calls a change saved.
public actor EphemeralSessionStore: CollaborationStore {
    private let pageID: String
    private var log: [UInt64: [Data]] = [:]
    private var outbox: [UInt64: [(id: Int64, update: Data)]] = [:]
    private var nextID: Int64 = 0
    public private(set) var rejection: String?

    public init(pageID: String) { self.pageID = pageID }

    private func check(_ pageID: String) throws {
        guard pageID == self.pageID else { throw CollaborationStorageError.denied }
    }
    public func load(pageID: String, channel: UInt64) async throws -> [Data] {
        try check(pageID)
        return log[channel] ?? []
    }
    public func appendLocal(pageID: String, channel: UInt64, update: Data) async throws {
        try check(pageID)
        guard rejection == nil else { throw CollaborationError.rejected(rejection ?? "") }
        nextID += 1
        log[channel, default: []].append(update)
        outbox[channel, default: []].append((nextID, update))
    }
    public func appendRemote(pageID: String, channel: UInt64, update: Data) async throws {
        try check(pageID)
        log[channel, default: []].append(update)
    }
    public func maximumPendingID(pageID: String, channel: UInt64) async throws -> Int64? {
        try check(pageID)
        return outbox[channel]?.last?.id
    }
    public func acknowledge(pageID: String, channel: UInt64, through: Int64) async throws {
        try check(pageID)
        outbox[channel]?.removeAll { $0.id <= through }
    }
    /// The server refused a change: nothing more is sent from this store.
    public func archiveRejection(pageID: String, channel: UInt64, state: Data, reason: String) async throws {
        try check(pageID)
        rejection = reason
        outbox[channel] = []
    }
    /// Local changes the server has not acknowledged yet.
    public func pendingCount() -> Int { outbox.values.reduce(0) { $0 + $1.count } }
}
