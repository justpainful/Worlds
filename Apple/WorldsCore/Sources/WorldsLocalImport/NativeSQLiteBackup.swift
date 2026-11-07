#if canImport(WorldsRustStore)
import Foundation
import WorldsRustStore

/// Experimental bridge. Only use through a coordinator whose root is trusted
/// and app-owned, while retaining the source security scope for the entire call.
public struct NativeSQLiteBackup: LocalSQLiteBackup {
    public init() {}

    public func importSnapshot(source: URL, privateRoot: URL) async throws -> URL {
        struct Request: Encodable {
            let operation = "import_local_snapshot"
            let source: String
            let private_root: String
        }
        struct Response: Decodable {
            struct ResultValue: Decodable { let path: String }
            let ok: Bool
            let value: ResultValue?
            let error: String?
        }
        guard source.isFileURL, privateRoot.isFileURL else { throw LocalImportError.invalidSource }
        let request = Request(source: source.path, private_root: privateRoot.path)
        let data = try JSONEncoder().encode(request)
        return try await Task.detached(priority: .userInitiated) {
            let raw = data.withUnsafeBytes { worlds_store_call($0.bindMemory(to: UInt8.self).baseAddress, $0.count) }
            guard let raw else { throw LocalImportError.invalidBackup }
            defer { worlds_store_free(raw) }
            guard let text = String(validatingUTF8: raw), let data = text.data(using: .utf8),
                  let response = try? JSONDecoder().decode(Response.self, from: data),
                  response.ok, let path = response.value?.path else { throw LocalImportError.invalidBackup }
            return URL(fileURLWithPath: path)
        }.value
    }
}
#endif
