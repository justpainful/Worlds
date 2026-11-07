import Foundation
import WorldsRustCollaboration

public enum CRDTError: Error { case allocation, invalidUpdate, invalidVector, poisoned }

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
