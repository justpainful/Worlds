import Foundation
import WorldsRustCollaboration

public enum CollaborationStorageError: Error, Equatable {
    case invalidInput, database, denied, unsupportedSchema, invalidResult, conflict
}

/// Bound to one existing Worlds page, signed-in account and workspace.
public actor SQLiteCollaborationStore: CheckedPlainEditorStore {
    nonisolated(unsafe) private let handle: OpaquePointer
    private let pageID: String

    public init(databaseURL: URL, pageID: String, userID: String, workspaceID: String) throws {
        guard databaseURL.isFileURL, ![databaseURL.path, pageID, userID, workspaceID].contains(where: { $0.isEmpty || $0.utf8.contains(0) }) else {
            throw CollaborationStorageError.invalidInput
        }
        var output: OpaquePointer?
        let status = databaseURL.path.withCString { path in
            pageID.withCString { page in
                userID.withCString { user in
                    workspaceID.withCString { workspace in
                        worlds_store_open(path, page, user, workspace, &output)
                    }
                }
            }
        }
        try Self.check(status)
        guard let output else { throw CollaborationStorageError.invalidResult }
        handle = output
        self.pageID = pageID
    }
    deinit { worlds_store_free(handle) }

    private static func check(_ result: Int32) throws {
        switch result {
        case 0: return
        case 1: throw CollaborationStorageError.invalidInput
        case 3: throw CollaborationStorageError.denied
        case 4: throw CollaborationStorageError.unsupportedSchema
        case 5: throw CollaborationStorageError.conflict
        default: throw CollaborationStorageError.database
        }
    }
    private func validate(_ page: String, _ channel: UInt64) throws -> Int64 {
        guard page == pageID, channel <= 1 else { throw CollaborationStorageError.invalidInput }
        return Int64(channel)
    }
    private func unpack(_ data: Data) throws -> [Data] {
        let bytes = [UInt8](data)
        var offset = 0
        func integer() throws -> UInt64 {
            guard bytes.count - offset >= 8 else { throw CollaborationStorageError.invalidResult }
            var value: UInt64 = 0
            for i in 0..<8 { value |= UInt64(bytes[offset + i]) << (8 * i) }
            offset += 8
            return value
        }
        let count = try integer()
        guard count <= UInt64((bytes.count - offset) / 8) else { throw CollaborationStorageError.invalidResult }
        var entries: [Data] = []
        for _ in 0..<Int(count) {
            let length = try integer()
            guard length <= UInt64(bytes.count - offset) else { throw CollaborationStorageError.invalidResult }
            let end = offset + Int(length)
            entries.append(Data(bytes[offset..<end]))
            offset = end
        }
        guard offset == bytes.count else { throw CollaborationStorageError.invalidResult }
        return entries
    }
    public func load(pageID: String, channel: UInt64) async throws -> [Data] {
        let channel = try validate(pageID, channel)
        var output = WorldsBuffer(data: nil, len: 0)
        try Self.check(worlds_store_load(handle, channel, &output))
        defer { worlds_buffer_free(output) }
        guard let ptr = output.data else { throw CollaborationStorageError.invalidResult }
        return try unpack(Data(bytes: ptr, count: output.len))
    }
    private func append(pageID: String, channel: UInt64, update: Data, local: Bool) throws {
        let channel = try validate(pageID, channel)
        let result = update.withUnsafeBytes { bytes in
            worlds_store_append(handle, channel, bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count, local ? 1 : 0)
        }
        try Self.check(result)
    }
    /// Experimental isolated operation. A caller must separately check live service rights.
    /// The returned update was already persisted in both the replica log and outbox.
    public func insertPlainChecked(base: Data, blockIndex: UInt32, blockID: String,
                                   expected: String, offset: UInt32, insertion: String) async throws -> Data {
        try insertPlainSynchronously(base: base, blockIndex: blockIndex, blockID: blockID, expected: expected, offset: offset, insertion: insertion)
    }
    private func insertPlainSynchronously(base: Data, blockIndex: UInt32, blockID: String,
                                          expected: String, offset: UInt32, insertion: String) throws -> Data {
        guard ![blockID, expected, insertion].contains(where: { $0.utf8.contains(0) }) else { throw CollaborationStorageError.invalidInput }
        var output = WorldsBuffer(data: nil, len: 0)
        let status = base.withUnsafeBytes { bytes in
            blockID.withCString { id in
                expected.withCString { text in
                    insertion.withCString { replacement in
                        worlds_store_insert_plain_checked(handle, bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count,
                                                          blockIndex, id, text, offset, replacement, &output)
                    }
                }
            }
        }
        try Self.check(status)
        defer { worlds_buffer_free(output) }
        guard let pointer = output.data else { throw CollaborationStorageError.invalidResult }
        return Data(bytes: pointer, count: output.len)
    }
    public func appendLocal(pageID: String, channel: UInt64, update: Data) async throws {
        try append(pageID: pageID, channel: channel, update: update, local: true)
    }
    public func appendRemote(pageID: String, channel: UInt64, update: Data) async throws {
        try append(pageID: pageID, channel: channel, update: update, local: false)
    }
    public func maximumPendingID(pageID: String, channel: UInt64) async throws -> Int64? {
        let channel = try validate(pageID, channel)
        var output: Int64 = -1
        try Self.check(worlds_store_max_pending(handle, channel, &output))
        return output < 0 ? nil : output
    }
    public func acknowledge(pageID: String, channel: UInt64, through: Int64) async throws {
        try Self.check(worlds_store_ack(handle, validate(pageID, channel), through))
    }
    public func archiveRejection(pageID: String, channel: UInt64, state: Data, reason: String) async throws {
        let channel = try validate(pageID, channel)
        guard !reason.utf8.contains(0) else { throw CollaborationStorageError.invalidInput }
        let id = UUID().uuidString.lowercased()
        let result = id.withCString { id in
            reason.withCString { reason in
                state.withUnsafeBytes { bytes in
                    worlds_store_reject(handle, channel, id, bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count, reason)
                }
            }
        }
        try Self.check(result)
    }
}
