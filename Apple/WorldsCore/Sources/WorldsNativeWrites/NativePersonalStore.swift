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
    case galleryCommittedCleanupPending

    public var errorDescription: String? {
        switch self {
        case .invalidFileURL: return "Choose an existing local database file."
        case .responseUnavailable: return "The native store did not return a response."
        case .invalidResponse: return "The native store returned an invalid response."
        case .galleryCommittedCleanupPending: return "The gallery import was saved, but cleanup is pending."
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
    var expectedTitle: String? = nil
    var expectedParent: String? = nil
    var expectedSort: Double? = nil
    var destination: String? = nil
    var destinationRevision: Int64? = nil
    var parent: String? = nil
    var parentRevision: Int64? = nil
    var blocks: [NativeBlockInput]? = nil
    var expected: [NativeBlockInput]? = nil
    var expectedKind: String? = nil
    var expectedMetadata: JSONValue? = nil
    var metadata: JSONValue? = nil
    var source: String? = nil
    var operationID: String? = nil
    var deleting: [String]? = nil
    var recoveryID: String? = nil
    var streamURL: String? = nil
    enum CodingKeys: String, CodingKey {
        case operation, path, page, base, title, parent, blocks, expected, metadata, deleting
        case expectedMetadata = "expected_metadata"
        case expectedKind = "expected_kind"
        case expectedTitle = "expected_title"
        case expectedParent = "expected_parent"
        case parentRevision = "parent_revision"
        case expectedSort = "expected_sort"
        case destination
        case destinationRevision = "destination_revision"
        case source
        case operationID = "operation_id"
        case recoveryID = "recovery_id"
        case streamURL = "url"
    }
}
private struct Response: Decodable {
    let ok: Bool
    let value: JSONValue?
    let error: String?
}
private final class GalleryCancelToken: @unchecked Sendable {
    let pointer: OpaquePointer
    init() throws {
        guard let pointer = worlds_gallery_cancel_new() else { throw NativeWriteError.responseUnavailable }
        self.pointer = pointer
    }
    func cancel() { worlds_gallery_cancel(pointer) }
    deinit { worlds_gallery_cancel_free(pointer) }
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
    /// Reuse the same ID and exact inputs when resolving an uncertain response.
    /// The result describes the original commit; reload to see current page state.
    public func createPageIdempotent(title: String, parent: String? = nil, operationID: UUID) async throws -> JSONValue {
        try await call(Request(operation: "create_page_idempotent", path: url.path, title: title, parent: parent, operationID: operationID.uuidString))
    }
    /// Pass parent and its observed revision together, or nil for a root document.
    public func createDocumentIdempotent(title: String, parent: String? = nil, parentRevision: Int64? = nil, operationID: UUID) async throws -> JSONValue {
        try await call(Request(operation: "create_document_idempotent", path: url.path, title: title, parent: parent, parentRevision: parentRevision, operationID: operationID.uuidString))
    }
    /// Pass the parent and its observed revision together, or nil for a root project.
    public func createProjectIdempotent(title: String, parent: String? = nil, parentRevision: Int64? = nil, operationID: UUID) async throws -> JSONValue {
        try await call(Request(operation: "create_project_idempotent", path: url.path, title: title, parent: parent, parentRevision: parentRevision, operationID: operationID.uuidString))
    }
    public func renamePage(id: String, base: Int64, title: String) async throws -> JSONValue {
        try await call(Request(operation: "rename_page", path: url.path, page: id, base: base, title: title))
    }
    /// Reuse the ID and exact inputs after an uncertain response; reload the
    /// snapshot before treating the original result as the current page state.
    public func renamePageChecked(id: String, base: Int64, expectedTitle: String, title: String, operationID: UUID) async throws -> JSONValue {
        try await call(Request(operation: "rename_page_checked", path: url.path, page: id, base: base, title: title, expectedTitle: expectedTitle, operationID: operationID.uuidString))
    }
    /// Moves to the current end of the destination. This does not preserve an
    /// earlier sort key for undo; repeat only with the same UUID and inputs.
    public func movePageChecked(id: String, base: Int64, expectedParent: String?, expectedSort: Double, destination: String?, destinationRevision: Int64?, operationID: UUID) async throws -> JSONValue {
        try await call(Request(operation: "move_page_checked", path: url.path, page: id, base: base, expectedParent: expectedParent, expectedSort: expectedSort, destination: destination, destinationRevision: destinationRevision, operationID: operationID.uuidString))
    }
    public func saveBlocks(pageID: String, base: Int64, blocks: [NativeBlockInput]) async throws -> JSONValue {
        try await call(Request(operation: "save_blocks", path: url.path, page: pageID, base: base, blocks: blocks))
    }
    /// Requires the original ordered block contents and verifies them atomically.
    public func saveBlocksChecked(pageID: String, base: Int64, expected: [NativeBlockInput], blocks: [NativeBlockInput]) async throws -> JSONValue {
        try await call(Request(operation: "save_blocks_checked", path: url.path, page: pageID, base: base, blocks: blocks, expected: expected))
    }
    /// Also compares the original page kind in the same transaction.
    public func saveBlocksCheckedKind(pageID: String, base: Int64, expected: [NativeBlockInput], blocks: [NativeBlockInput], expectedKind: String) async throws -> JSONValue {
        try await call(Request(operation: "save_blocks_checked_kind", path: url.path, page: pageID, base: base, blocks: blocks, expected: expected, expectedKind: expectedKind))
    }
    public func readResource(id: String) async throws -> JSONValue {
        try await call(Request(operation: "read_resource", path: url.path, page: id))
    }
    public func readPresentation(id: String) async throws -> JSONValue {
        try await call(Request(operation: "read_presentation", path: url.path, page: id))
    }
    public func deletedPresentationSlides(id: String) async throws -> JSONValue {
        try await call(Request(operation: "deleted_presentation_slides", path: url.path, page: id))
    }
    public func restorePresentationSlide(id: String, recoveryID: UUID, base: Int64, expectedMetadata: JSONValue, expected: [NativeBlockInput]) async throws -> JSONValue {
        try await call(Request(operation: "restore_presentation_slide", path: url.path, page: id, base: base, expected: expected, expectedMetadata: expectedMetadata, recoveryID: recoveryID.uuidString.lowercased()))
    }
    public func savePresentation(id: String, base: Int64, expectedMetadata: JSONValue, expected: [NativeBlockInput], blocks: [NativeBlockInput], deleting: [String] = []) async throws -> JSONValue {
        try await call(Request(operation: "save_presentation", path: url.path, page: id, base: base, blocks: blocks, expected: expected, expectedMetadata: expectedMetadata, deleting: deleting))
    }
    public func saveProject(id: String, base: Int64, expectedMetadata: JSONValue, metadata: JSONValue) async throws -> JSONValue {
        try await call(Request(operation: "save_project", path: url.path, page: id, base: base, expectedMetadata: expectedMetadata, metadata: metadata))
    }
    /// Saves one personal stream link using the complete metadata baseline.
    public func saveStream(id: String, base: Int64, expectedMetadata: JSONValue, url: String) async throws -> JSONValue {
        try await call(Request(operation: "save_stream", path: self.url.path, page: id, base: base, expectedMetadata: expectedMetadata, streamURL: url))
    }
    public func saveGallery(id: String, base: Int64, expectedMetadata: JSONValue, metadata: JSONValue, expected: [NativeBlockInput], blocks: [NativeBlockInput]) async throws -> JSONValue {
        try await call(Request(operation: "save_gallery", path: url.path, page: id, base: base, blocks: blocks, expected: expected, expectedMetadata: expectedMetadata, metadata: metadata))
    }
    /// Experimental: use only with a validated independent LocalProjectCopy.
    /// Reuse operationID only to retry exactly the same request and source.
    public func importLocalGalleryFile(id: String, base: Int64, metadata: JSONValue, expected: [NativeBlockInput], source: URL, operationID: UUID) async throws -> JSONValue {
        guard source.isFileURL else { throw NativeWriteError.invalidFileURL }
        let token = try GalleryCancelToken()
        return try await withTaskCancellationHandler {
            try await call(Request(operation: "import_local_gallery_file", path: url.path, page: id, base: base, expected: expected, metadata: metadata, source: source.path, operationID: operationID.uuidString.lowercased()), scopedSource: source, galleryCancellation: token)
        } onCancel: { token.cancel() }
    }
    public func trashPage(id: String, base: Int64) async throws {
        _ = try await call(Request(operation: "trash_page", path: url.path, page: id, base: base))
    }

    private func call(_ request: Request, scopedSource: URL? = nil, galleryCancellation: GalleryCancelToken? = nil) async throws -> JSONValue {
        let url = self.url
        return try await Task.detached(priority: .userInitiated) {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let sourceScoped = scopedSource?.startAccessingSecurityScopedResource() ?? false
            defer { if sourceScoped { scopedSource?.stopAccessingSecurityScopedResource() } }
            guard FileManager.default.fileExists(atPath: url.path) else { throw NativeWriteError.invalidFileURL }
            let data = try JSONEncoder().encode(request)
            let pointer = data.withUnsafeBytes { bytes in
                if let galleryCancellation {
                    return worlds_gallery_call(bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count, galleryCancellation.pointer)
                } else {
                    return worlds_store_call(bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count)
                }
            }
            guard let pointer else { throw NativeWriteError.responseUnavailable }
            defer { worlds_store_free(pointer) }
            guard let json = String(validatingUTF8: pointer), let body = json.data(using: .utf8),
                  let response = try? JSONDecoder().decode(Response.self, from: body) else { throw NativeWriteError.invalidResponse }
            guard response.ok else {
                let message = response.error ?? "The database operation failed."
                if galleryCancellation != nil {
                    if message.hasPrefix("cancelled:") { throw CancellationError() }
                    if message.hasPrefix("conflict:") { throw NativeWriteError.conflict("The gallery or import request has changed.") }
                    if message.hasPrefix("committed:") { throw NativeWriteError.galleryCommittedCleanupPending }
                    #if DEBUG
                    // Only fixed classifications are exposed; the underlying
                    // Rust error may contain user paths and must not be logged.
                    if message.contains("no-follow directory component 0") {
                        let stage = message.contains("open scoped source file") ? "source" : (message.contains("validate local copy directory") ? "copy" : "other")
                        throw NativeWriteError.operationFailed("Fixture diagnostic: no-follow component zero rejected (\(stage)).")
                    }
                    if message.contains("database identity cannot be verified") {
                        throw NativeWriteError.operationFailed("Fixture diagnostic: database identity check failed.")
                    }
                    #endif
                    throw NativeWriteError.operationFailed("The gallery file could not be imported.")
                }
                if message.hasPrefix("conflict:") { throw NativeWriteError.conflict(message) }
                throw NativeWriteError.operationFailed(message)
            }
            return response.value ?? .null
        }.value
    }
}
