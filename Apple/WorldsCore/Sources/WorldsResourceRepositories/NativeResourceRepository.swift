import Foundation
import WorldsModels
import WorldsProjects
import WorldsGallery
import WorldsNativeWrites

public enum NativeResourceRepositoryError: Error { case malformedResponse }

/// Experimental adapter. RustStore is the sole persistence authority and
/// rejects shared pages and unauthorized attachments. Not wired to the app.
public actor NativeResourceRepository: ProjectRepository, GalleryRepository {
    private let store: NativePersonalStore
    public init(store: NativePersonalStore) { self.store = store }
    public func readProject(id: String) async throws -> ProjectRecord {
        let value = try await store.readResource(id: id)
        let record = try parse(value)
        return ProjectRecord(id: record.id, kind: record.kind, metadata: record.metadata, revision: record.revision)
    }
    public func compareAndSwapProject(id: String, expectedRevision: Int64, expectedMetadata: JSONValue, metadata: JSONValue) async throws -> ProjectRecord {
        do {
            let value = try await store.saveProject(id: id, base: expectedRevision, expectedMetadata: expectedMetadata, metadata: metadata)
            let record = try parse(value)
            return ProjectRecord(id: record.id, kind: record.kind, metadata: record.metadata, revision: record.revision)
        } catch NativeWriteError.conflict { throw ProjectError.conflict }
    }
    public func readAuthorizedGallery(id: String) async throws -> GallerySnapshot {
        let record = try parse(await store.readResource(id: id))
        return GallerySnapshot(id: record.id, kind: record.kind, revision: record.revision, blocks: record.blocks, metadata: record.metadata)
    }
    public func commitAuthorizedGallery(id: String, expectedRevision: Int64, expectedBlocks: [JSONValue], expectedMetadata: JSONValue, blocks: [JSONValue], metadata: JSONValue, attachmentIDs: [String]) async throws -> GallerySnapshot {
        // Rust independently verifies both old and new attachment owners in
        // the transaction. This argument is intentionally not an authority.
        _ = attachmentIDs
        do {
            let value = try await store.saveGallery(id: id, base: expectedRevision, expectedMetadata: expectedMetadata, metadata: metadata, expected: try expectedBlocks.map(block), blocks: try blocks.map(block))
            let record = try parse(value)
            return GallerySnapshot(id: record.id, kind: record.kind, revision: record.revision, blocks: record.blocks, metadata: record.metadata)
        } catch NativeWriteError.conflict { throw GalleryError.conflict }
    }
}
private struct ResourceResponse {
    let id: String
    let kind: String
    let revision: Int64
    let metadata: JSONValue
    let blocks: [JSONValue]
}
private func parse(_ value: JSONValue) throws -> ResourceResponse {
    guard case .object(let object) = value, case .string(let id)? = object["id"],
          case .string(let kind)? = object["kind"], case .integer(let revision)? = object["revision"],
          let metadata = object["metadata"], case .array(let blocks)? = object["blocks"] else { throw NativeResourceRepositoryError.malformedResponse }
    return ResourceResponse(id: id, kind: kind, revision: revision, metadata: metadata, blocks: blocks)
}
private func block(_ value: JSONValue) throws -> NativeBlockInput {
    guard case .object(let object) = value, case .string(let id)? = object["id"], let content = object["content"] else { throw NativeResourceRepositoryError.malformedResponse }
    return NativeBlockInput(id: id, content: content)
}
