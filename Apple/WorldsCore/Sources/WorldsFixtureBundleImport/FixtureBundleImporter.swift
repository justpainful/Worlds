#if DEBUG
import Foundation
import WorldsRustStore

public enum FixtureBundleError: Error { case invalidPath, failed(String), invalidResult }
private struct Request: Encodable {
    let operation = "import_fixture_attachment_bundle"
    let source: String
    let private_root: String
}
private struct Response: Decodable {
    struct Value: Decodable { let path: String }
    let ok: Bool
    let value: Value?
    let error: String?
}

/// Debug-only, temporary-fixture-only bridge. No source provenance is claimed.
public struct FixtureBundleImporter: Sendable {
    public init() {}
    public func prepare(source: URL, privateRoot: URL) async throws -> URL {
        guard source.isFileURL, privateRoot.isFileURL else { throw FixtureBundleError.invalidPath }
        try Task.checkCancellation()
        return try await Task.detached(priority: .userInitiated) {
            let scoped = source.startAccessingSecurityScopedResource()
            defer { if scoped { source.stopAccessingSecurityScopedResource() } }
            let request = try JSONEncoder().encode(Request(source: source.path, private_root: privateRoot.path))
            let pointer = request.withUnsafeBytes { worlds_store_call($0.bindMemory(to: UInt8.self).baseAddress, $0.count) }
            guard let pointer else { throw FixtureBundleError.invalidResult }
            defer { worlds_store_free(pointer) }
            guard let text = String(validatingUTF8: pointer), let data = text.data(using: .utf8), let response = try? JSONDecoder().decode(Response.self, from: data) else { throw FixtureBundleError.invalidResult }
            guard response.ok else { throw FixtureBundleError.failed(response.error ?? "Fixture import failed") }
            guard let path = response.value?.path, path.hasSuffix("/worlds.db") else { throw FixtureBundleError.invalidResult }
            return URL(fileURLWithPath: path)
        }.value
    }
}
#endif
