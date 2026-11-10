import Foundation
import WorldsRustStore

public enum DrawingWriteError: Error { case invalidURL, invalidInput, responseUnavailable, failed(String) }
/// Experimental personal drawing bridge; not connected to product editing.
public actor PersonalDrawingWriter {
    private let database: URL
    public init(database: URL) throws {
        guard database.isFileURL, !database.path.isEmpty else { throw DrawingWriteError.invalidURL }
        self.database = database
    }
    /// Returns the original Rust response envelope as UTF-8 JSON.
    public func load(pageID: String) throws -> Data { try call(operation: "load_personal_drawing", pageID: pageID, change: nil) }
    /// The transaction uses the original Windows drawing operation implementation.
    /// The current bridge refuses sync bindings, version restores and asset-backed scenes.
    public func apply(pageID: String, changeJSON: Data) throws -> Data {
        guard (try JSONSerialization.jsonObject(with: changeJSON)) is [String: Any] else { throw DrawingWriteError.invalidInput }
        return try call(operation: "apply_personal_drawing", pageID: pageID, change: changeJSON)
    }
    private func call(operation: String, pageID: String, change: Data?) throws -> Data {
        guard !pageID.isEmpty else { throw DrawingWriteError.invalidInput }
        let scoped = database.startAccessingSecurityScopedResource()
        defer { if scoped { database.stopAccessingSecurityScopedResource() } }
        var request = Data("{\"operation\":".utf8)
        request.append(try JSONEncoder().encode(operation)); request.append(Data(",\"path\":".utf8))
        request.append(try JSONEncoder().encode(database.path)); request.append(Data(",\"page\":".utf8))
        request.append(try JSONEncoder().encode(pageID))
        if let change { request.append(Data(",\"change\":".utf8)); request.append(change) }
        request.append(Data("}".utf8))
        guard request.count <= 8 * 1024 * 1024 else { throw DrawingWriteError.invalidInput }
        let pointer = request.withUnsafeBytes { worlds_store_call($0.bindMemory(to: UInt8.self).baseAddress, $0.count) }
        guard let pointer else { throw DrawingWriteError.responseUnavailable }
        defer { worlds_store_free(pointer) }
        guard let raw = String(validatingUTF8: pointer), let data = raw.data(using: .utf8),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any], let ok = object["ok"] as? Bool else { throw DrawingWriteError.responseUnavailable }
        if !ok { throw DrawingWriteError.failed(object["error"] as? String ?? "Drawing write failed") }
        return data
    }
}
