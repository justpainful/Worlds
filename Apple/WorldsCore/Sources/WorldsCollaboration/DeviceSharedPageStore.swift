import Foundation
import CryptoKit

/// Who a saved shared page belongs to: one account, one workspace, one page,
/// on one sync origin (`host` or `host:port`, lowercased).
public struct SharedPageBinding: Codable, Sendable, Equatable, Hashable {
    public let accountID: String
    public let workspaceID: String
    public let pageID: String
    public let origin: String
    public init(accountID: String, workspaceID: String, pageID: String, origin: String) {
        self.accountID = accountID; self.workspaceID = workspaceID; self.pageID = pageID; self.origin = origin.lowercased()
    }
    /// `host` or `host:port` of an https URL, the form a binding stores.
    public static func origin(of url: URL) -> String? {
        guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased(), !host.isEmpty else { return nil }
        if let port = url.port, port != 443 { return "\(host):\(port)" }
        return host
    }
    var fileName: String {
        let key = [accountID, workspaceID, pageID, origin].joined(separator: "\n")
        return SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined() + ".sharedpage"
    }
}

public enum DeviceSharedPageStoreError: Error, Equatable { case invalidDirectory, bindingMismatch, corrupt, quarantined }

/// A shared page saved on this device, so it opens offline, plus the outbox
/// of changes this app made to it while connected.
///
/// It is a file this app alone creates, bound to `SharedPageBinding`: a file
/// written for another account, workspace, page or origin is never read, and
/// every outbox row was appended by a `CollaborationSession` that the server
/// had authenticated as `binding.accountID` with edit access. That is what
/// the legacy SQLite outbox cannot show, so `CollaborationHost.makeSession`
/// still refuses that store. New changes are still never made offline: the
/// session refuses a local write unless its connection reports edit access.
///
/// When the server rejects a change, the full state is kept, the outbox is
/// emptied and the copy is quarantined: it refuses new changes until it is
/// removed. Files are written atomically, with complete file protection on
/// iOS. This is local bookkeeping, not proof against another process running
/// as the same user.
public actor DeviceSharedPageStore: CollaborationStore {
    private struct Row: Codable { let id: Int64; let channel: UInt64; let update: Data }
    private struct Entry: Codable { let channel: UInt64; let update: Data }
    private struct File: Codable {
        var version = 1
        var binding: SharedPageBinding
        var savedAt: Date?
        var snapshots: [String: Data] = [:]
        var log: [Entry] = []
        var outbox: [Row] = []
        var nextID: Int64 = 0
        var rejection: String?
        var rejectedState: Data?
    }
    public nonisolated let binding: SharedPageBinding
    public nonisolated let allowsLocalWrites: Bool
    private let url: URL
    private var file: File
    private static let compactAfter = 64

    /// Opens or creates the copy for `binding` in `directory`. Refuses a file
    /// whose recorded binding differs, and an unreadable file.
    public init(directory: URL, binding: SharedPageBinding, allowsLocalWrites: Bool) throws {
        guard directory.isFileURL, !binding.accountID.isEmpty, !binding.workspaceID.isEmpty, !binding.pageID.isEmpty, !binding.origin.isEmpty else {
            throw DeviceSharedPageStoreError.invalidDirectory
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let url = directory.appendingPathComponent(binding.fileName)
        if FileManager.default.fileExists(atPath: url.path) {
            guard let data = try? Data(contentsOf: url), let saved = try? JSONDecoder().decode(File.self, from: data), saved.version == 1 else {
                throw DeviceSharedPageStoreError.corrupt
            }
            guard saved.binding == binding else { throw DeviceSharedPageStoreError.bindingMismatch }
            file = saved
        } else {
            file = File(binding: binding)
        }
        self.url = url; self.binding = binding; self.allowsLocalWrites = allowsLocalWrites
    }

    private func check(_ pageID: String) throws {
        guard pageID == binding.pageID else { throw CollaborationStorageError.denied }
    }
    private func save() throws {
        let data = try JSONEncoder().encode(file)
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: url, options: [.atomic])
        #endif
    }
    private func updates(_ channel: UInt64) -> [Data] {
        (file.snapshots[String(channel)].map { [$0] } ?? []) + file.log.filter { $0.channel == channel }.map(\.update)
    }
    /// Folds the log into one state per channel. The outbox is kept apart.
    private func compactIfNeeded() throws {
        guard file.log.count > Self.compactAfter else { return }
        for channel in Set(file.log.map(\.channel)) {
            let doc = try NativeCRDTDocument()
            for update in updates(channel) { try doc.apply(update) }
            file.snapshots[String(channel)] = try doc.diff(Data([0]))
        }
        file.log.removeAll()
    }

    public func load(pageID: String, channel: UInt64) async throws -> [Data] {
        try check(pageID)
        return updates(channel)
    }
    public func appendLocal(pageID: String, channel: UInt64, update: Data) async throws {
        try check(pageID)
        guard allowsLocalWrites else { throw CollaborationError.accessRevoked }
        guard file.rejection == nil else { throw DeviceSharedPageStoreError.quarantined }
        var next = file
        next.nextID += 1
        next.log.append(Entry(channel: channel, update: update))
        next.outbox.append(Row(id: next.nextID, channel: channel, update: update))
        let previous = file
        file = next
        do { try save() } catch { file = previous; throw error }
    }
    public func appendRemote(pageID: String, channel: UInt64, update: Data) async throws {
        try check(pageID)
        let previous = file
        file.log.append(Entry(channel: channel, update: update))
        file.savedAt = Date()
        do { try compactIfNeeded(); try save() } catch { file = previous; throw error }
    }
    public func maximumPendingID(pageID: String, channel: UInt64) async throws -> Int64? {
        try check(pageID)
        guard file.rejection == nil else { return nil }
        return file.outbox.last(where: { $0.channel == channel })?.id
    }
    public func acknowledge(pageID: String, channel: UInt64, through: Int64) async throws {
        try check(pageID)
        let previous = file
        file.outbox.removeAll { $0.channel == channel && $0.id <= through }
        do { try save() } catch { file = previous; throw error }
    }
    public func archiveRejection(pageID: String, channel: UInt64, state: Data, reason: String) async throws {
        try check(pageID)
        file.rejection = String(reason.prefix(1000))
        file.rejectedState = state
        file.outbox.removeAll()
        try save()
    }

    /// Changes this app made that the server has not acknowledged yet.
    public func pendingCount() -> Int { file.rejection == nil ? file.outbox.count : 0 }
    /// When the server last sent this page, or nil before the first sync.
    public func savedAt() -> Date? { file.savedAt }
    /// The server's reason, when it refused a change from this copy.
    public func rejection() -> String? { file.rejection }

    /// The saved page without any network: every block and the pack item's
    /// fields, as last received plus this app's unacknowledged changes.
    public func savedReading() throws -> (blocks: Data, packFields: Data, savedAt: Date)? {
        guard let savedAt = file.savedAt else { return nil }
        let doc = try NativeCRDTDocument()
        for update in updates(0) { try doc.apply(update) }
        return (try doc.readProjection(), try doc.packFields(), savedAt)
    }

    /// Bindings of the copies saved in `directory` for one account.
    public static func savedBindings(in directory: URL, accountID: String) -> [SharedPageBinding] {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else { return [] }
        return names.filter { $0.hasSuffix(".sharedpage") }.compactMap { name in
            guard let data = try? Data(contentsOf: directory.appendingPathComponent(name)),
                  let saved = try? JSONDecoder().decode(File.self, from: data),
                  saved.binding.accountID == accountID, saved.binding.fileName == name, saved.savedAt != nil else { return nil }
            return saved.binding
        }
    }
    /// Removes the saved copy, its outbox included.
    public static func remove(_ binding: SharedPageBinding, in directory: URL) {
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(binding.fileName))
    }
    /// Removes every copy that belongs to another account than `accountID`.
    public static func removeOthers(than accountID: String, in directory: URL) {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else { return }
        for name in names where name.hasSuffix(".sharedpage") {
            let url = directory.appendingPathComponent(name)
            let saved = (try? Data(contentsOf: url)).flatMap { try? JSONDecoder().decode(File.self, from: $0) }
            if saved?.binding.accountID != accountID { try? FileManager.default.removeItem(at: url) }
        }
    }
}
