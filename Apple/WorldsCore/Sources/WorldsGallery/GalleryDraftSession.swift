import Foundation

/// In-memory draft. A host owns the database identity and must prevent concurrent
/// commits or retry after an unconfirmed result until it reloads the copy.
public struct GalleryDraftSession: Sendable {
    public let baseline: GallerySnapshot
    public private(set) var document: GalleryDocument
    private var undoStack: [GalleryDocument] = []
    private var redoStack: [GalleryDocument] = []
    public init(snapshot: GallerySnapshot) throws {
        guard snapshot.kind == "gallery", !snapshot.id.isEmpty else { throw GalleryError.notGallery }
        baseline = snapshot
        document = try GalleryDocument(blocks: snapshot.blocks, metadata: snapshot.metadata)
    }
    public var dirty: Bool { document.blocks != baseline.blocks || document.metadata != baseline.metadata }
    public var canUndo: Bool { !undoStack.isEmpty }
    public var canRedo: Bool { !redoStack.isEmpty }
    public mutating func move(from: Int, to: Int) throws {
        var next = document; try next.move(from: from, to: to); record(next)
    }
    public mutating func setCaption(itemID: String, text: String) throws {
        var next = document; try next.setCaption(itemID: itemID, caption: text); record(next)
    }
    private mutating func record(_ next: GalleryDocument) {
        guard next != document else { return }
        undoStack.append(document)
        if undoStack.count > 120 { undoStack.removeFirst() }
        redoStack.removeAll(); document = next
    }
    public mutating func undo() {
        guard let previous = undoStack.popLast() else { return }
        redoStack.append(document); document = previous
    }
    public mutating func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(document); document = next
    }
    public func commit(to repository: any GalleryRepository) async throws -> GallerySnapshot {
        let original = try GalleryDocument(blocks: baseline.blocks, metadata: baseline.metadata)
        let ids = Array(Set(original.attachmentIDs + document.attachmentIDs)).sorted()
        let saved = try await repository.commitAuthorizedGallery(id: baseline.id, expectedRevision: baseline.revision,
            expectedBlocks: baseline.blocks, expectedMetadata: baseline.metadata, blocks: document.blocks,
            metadata: document.metadata, attachmentIDs: ids)
        guard saved.id == baseline.id, saved.kind == "gallery" else { throw GalleryError.notGallery }
        return saved
    }
}
