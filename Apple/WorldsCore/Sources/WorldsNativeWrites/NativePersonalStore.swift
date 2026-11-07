import Foundation
import WorldsModels
import WorldsRustStore

public struct NativeBlockInput: Codable, Sendable {
    public let id: String
    public let content: JSONValue
    public init(id: String, content: JSONValue) { self.id = id; self.content = content }
}

public enum NativeWriteError: Error, LocalizedError, Sendable {
    case invalidFileURL
    case responseUnavailable
    case invalidResponse
    case conflict(String)
    case operationFailed(String)

    public var errorDescription: String? {
        switch self {
        case .invalidFileURL: return "Choose an existing local database file."
        case .responseUnavailable: return "The native store did not return a response."
        case .invalidResponse: return "The native store returned an invalid response."
        case .conflict(let message), .operationFailed(let message): return message
        }
    }
}

private struct Request: Encodable, Sendable {
    let operation: String
    let path: String
    var page: String? = nil
    var base: Int64? = nil
    var title: String? = nil
    var parent: String? = nil
    var blocks: [NativeBlockInput]? = nil
    var expected: [NativeBlockInput]? = nil
    var expectedMetadata: JSONValue? = nil
    var metadata: JSONValue? = nil
    enum CodingKeys: String, CodingKey {
        case operation, path, page, base, title, parent, blocks, expected, metadata
        case expectedMetadata = "expected_metadata"
    }
}
private struct Response: Decodable {
    let ok: Bool
    let value: JSONValue?
    let error: String?
}

/// Experimental bridge. The calling app must not enable editing until its
/// complete workflow, permissions, file access and platform tests are reviewed.
public actor NativePersonalStore {
    private let url: URL
    public init(url: URL) throws {
        guard url.isFileURL, !url.path.isEmpty else { throw NativeWriteError.invalidFileURL }
        self.url = url
    }

    public func createPage(title: String, parent: String? = nil) async throws -> JSONValue {
        try await call(Request(operation: "create_page", path: url.path, title: title, parent: parent))
    }
    public func renamePage(id: String, base: Int64, title: String) async throws -> JSONValue {
        try await call(Request(operation: "rename_page", path: url.path, page: id, base: base, title: title))
    }
    public func saveBlocks(pageID: String, base: Int64, blocks: [NativeBlockInput]) async throws -> JSONValue {
        try await call(Request(operation: "save_blocks", path: url.path, page: pageID, base: base, blocks: blocks))
    }
    /// Requires the original ordered block contents and verifies them atomically.
    public func saveBlocksChecked(pageID: String, base: Int64, expected: [NativeBlockInput], blocks: [NativeBlockInput]) async throws -> JSONValue {
        try await call(Request(operation: "save_blocks_checked", path: url.path, page: pageID, base: base, blocks: blocks, expected: expected))
    }
    public func readResource(id: String) async throws -> JSONValue {
        try await call(Request(operation: "read_resource", path: url.path, page: id))
    }
    public func saveProject(id: String, base: Int64, expectedMetadata: JSONValue, metadata: JSONValue) async throws -> JSONValue {
        try await call(Request(operation: "save_project", path: url.path, page: id, base: base, expectedMetadata: expectedMetadata, metadata: metadata))
    }
    public func saveGallery(id: String, base: Int64, expectedMetadata: JSONValue, metadata: JSONValue, expected: [NativeBlockInput], blocks: [NativeBlockInput]) async throws -> JSONValue {
        try await call(Request(operation: "save_gallery", path: url.path, page: id, base: base, blocks: blocks, expected: expected, expectedMetadata: expectedMetadata, metadata: metadata))
    }
    public func trashPage(id: String, base: Int64) async throws {
        _ = try await call(Request(operation: "trash_page", path: url.path, page: id, base: base))
    }

    private func call(_ request: Request) async throws -> JSONValue {
        let url = self.url
        return try await Task.detached(priority: .userInitiated) {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard FileManager.default.fileExists(atPath: url.path) else { throw NativeWriteError.invalidFileURL }
            let data = try JSONEncoder().encode(request)
            let pointer = data.withUnsafeBytes { bytes in
                worlds_store_call(bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count)
            }
            guard let pointer else { throw NativeWriteError.responseUnavailable }
            defer { worlds_store_free(pointer) }
            guard let json = String(validatingUTF8: pointer), let body = json.data(using: .utf8),
                  let response = try? JSONDecoder().decode(Response.self, from: body) else { throw NativeWriteError.invalidResponse }
            guard response.ok else {
                let message = response.error ?? "The database operation failed."
                if message.hasPrefix("conflict:") { throw NativeWriteError.conflict(message) }
                throw NativeWriteError.operationFailed(message)
            }
            return response.value ?? .null
        }.value
    }
}
