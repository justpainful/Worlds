import Foundation
import WorldsRustCollaboration

public enum CRDTError: Error { case allocation, invalidUpdate, invalidVector, poisoned }

public struct RejectedDrawingComment: Decodable, Sendable, Equatable, Identifiable {
    public let threadID: String
    public let commentID: String
    public let body: String
    public let createdAt: Double
    public let resolved: Bool
    public var id: String { threadID + ":" + commentID }
}

/// Extracts the selected owner's drawing comments without mutating a live document.
public enum RejectedDrawingCommentReader {
    public static func extract(snapshot: Data, owner: String) throws -> [RejectedDrawingComment] {
        guard !owner.isEmpty, !owner.utf8.contains(0), let identifier = strdup(owner) else { throw CRDTError.invalidUpdate }
        defer { free(identifier) }
        let storage = snapshot as NSData
        var output = WorldsBuffer(data: nil, len: 0)
        let status = worlds_rejected_comments(storage.bytes.assumingMemoryBound(to: UInt8.self), storage.length, identifier, &output)
        guard status == 0, let bytes = output.data else { throw CRDTError.invalidUpdate }
        defer { worlds_buffer_free(output) }
        return try JSONDecoder().decode([RejectedDrawingComment].self, from: Data(bytes: bytes, count: output.len))
    }
}

/// Every FFI result is copied before Rust frees it. The lock also prevents
/// destroying a document while one of its operations is using the handle.
public final class NativeCRDTDocument: @unchecked Sendable {
    private let lock = NSLock()
    private let handle: OpaquePointer
    public init() throws {
        guard let handle = worlds_doc_new() else { throw CRDTError.allocation }
        self.handle = handle
    }
    deinit { worlds_doc_free(handle) }
    public func clientID() throws -> UInt64 {
        lock.lock(); defer { lock.unlock() }
        var id: UInt64 = 0
        guard worlds_doc_client_id(handle, &id) == 0 else { throw CRDTError.poisoned }
        return id
    }
    public func apply(_ update: Data) throws {
        lock.lock(); defer { lock.unlock() }
        let code = update.withUnsafeBytes { bytes in
            worlds_doc_apply(handle, bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count)
        }
        guard code == 0 else { throw code == 1 ? CRDTError.invalidUpdate : CRDTError.poisoned }
    }
    public func vector() throws -> Data {
        lock.lock(); defer { lock.unlock() }
        var buffer = WorldsBuffer(data: nil, len: 0)
        guard worlds_doc_state_vector(handle, &buffer) == 0 else { throw CRDTError.poisoned }
        defer { worlds_buffer_free(buffer) }
        return Data(bytes: buffer.data!, count: buffer.len)
    }
    public func diff(_ vector: Data) throws -> Data {
        lock.lock(); defer { lock.unlock() }
        var buffer = WorldsBuffer(data: nil, len: 0)
        let code = vector.withUnsafeBytes { bytes in
            worlds_doc_diff(handle, bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count, &buffer)
        }
        guard code == 0 else { throw code == 1 ? CRDTError.invalidVector : CRDTError.poisoned }
        defer { worlds_buffer_free(buffer) }
        return Data(bytes: buffer.data!, count: buffer.len)
    }
}
