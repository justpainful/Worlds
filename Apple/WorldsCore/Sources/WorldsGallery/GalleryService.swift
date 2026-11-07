import Foundation
import WorldsModels

public struct GallerySnapshot: Sendable, Equatable {
    public let id: String
    public let kind: String
    public let revision: Int64
    public let blocks: [JSONValue]
    public let metadata: JSONValue
    public init(id: String, kind: String, revision: Int64, blocks: [JSONValue], metadata: JSONValue) {
        self.id = id; self.kind = kind; self.revision = revision; self.blocks = blocks; self.metadata = metadata
    }
}
public enum GalleryChange: Sendable {
    case add(GalleryAttachment), move(from: Int, to: Int), remove(itemID: String), caption(itemID: String, text: String), view(String)
}
/// The host must authorize the gallery and every referenced attachment, then
/// atomically compare revision and save the blocks and metadata. Removing an
/// item must never delete its attachment or alter a different resource.
public protocol GalleryRepository: Sendable {
    func readAuthorizedGallery(id: String) async throws -> GallerySnapshot
    func commitAuthorizedGallery(id: String, expectedRevision: Int64, blocks: [JSONValue], metadata: JSONValue, attachmentIDs: [String]) async throws -> GallerySnapshot
}
public actor GalleryService {
    private let repository: any GalleryRepository
    public init(repository: any GalleryRepository) { self.repository = repository }
    public func apply(galleryID: String, expectedRevision: Int64, change: GalleryChange) async throws -> GallerySnapshot {
        let current = try await repository.readAuthorizedGallery(id: galleryID)
        guard current.id == galleryID, current.kind == "gallery" else { throw GalleryError.notGallery }
        guard current.revision == expectedRevision else { throw GalleryError.conflict }
        var document = try GalleryDocument(blocks: current.blocks, metadata: current.metadata)
        let originalAttachments = document.attachmentIDs
        switch change {
        case .add(let attachment): try document.add(attachment)
        case .move(let from, let to): try document.move(from: from, to: to)
        case .remove(let id): try document.remove(itemID: id)
        case .caption(let id, let text): try document.setCaption(itemID: id, caption: text)
        case .view(let value): try document.setView(value)
        }
        return try await repository.commitAuthorizedGallery(id: galleryID, expectedRevision: expectedRevision, blocks: document.blocks, metadata: document.metadata, attachmentIDs: Array(Set(originalAttachments + document.attachmentIDs)).sorted())
    }
}

