import Foundation
import WorldsModels
import WorldsNativeWrites
import WorldsPresentations

public enum PresentationPersistenceError: Error { case invalidResponse, invalidBlock, saveInProgress, reloadRequired }
public struct DeletedSlideRecovery: Sendable, Equatable, Identifiable {
    public let id: UUID
    public let blockID: String
    public let createdAt: Int64
}

/// Experimental personal-only repository. All original blocks and metadata are
/// supplied back to Rust as the baseline; Rust validates within a transaction.
public actor PresentationPersistence {
    public nonisolated let initialSlides: [SlideBlock]
    private let store: NativePersonalStore
    private let pageID: String
    private var revision: Int64
    private var metadata: JSONValue
    private var baseline: [NativeBlockInput]
    private var busy = false
    private var invalidated = false

    private init(store: NativePersonalStore, snapshot: JSONValue) throws {
        let parsed = try Self.parse(snapshot)
        self.store = store; pageID = parsed.id; revision = parsed.revision
        metadata = parsed.metadata; baseline = parsed.blocks
        initialSlides = try parsed.blocks.compactMap { block in
            guard case .object(let content) = block.content, content["type"] == .string("slide") else { return nil }
            return try SlideBlock(source: .object(["id": .string(block.id), "content": block.content]))
        }
    }
    public static func open(databaseURL: URL, pageID: String) async throws -> PresentationPersistence {
        let store = try NativePersonalStore(url: databaseURL)
        return try PresentationPersistence(store: store, snapshot: await store.readPresentation(id: pageID))
    }
    /// Slides replace existing slide slots; non-slide blocks retain their exact
    /// content and relative order. Extra slides append after the last block.
    public func save(slides: [SlideBlock], deleting: Set<String> = []) async throws {
        guard !invalidated else { throw PresentationPersistenceError.reloadRequired }
        guard !busy else { throw PresentationPersistenceError.saveInProgress }
        guard !slides.isEmpty, Set(slides.map(\.id)).count == slides.count else { throw PresentationPersistenceError.invalidBlock }
        let previous = Set(baseline.compactMap { block -> String? in
            if case .object(let content) = block.content, content["type"] == .string("slide") { return block.id }
            return nil
        })
        guard previous.subtracting(Set(slides.map(\.id))) == deleting else { throw PresentationPersistenceError.invalidBlock }
        var next: [NativeBlockInput] = []
        if !deleting.isEmpty {
            let retainedIDs = baseline.compactMap { block -> String? in
                guard case .object(let content) = block.content, content["type"] == .string("slide"), !deleting.contains(block.id) else { return nil }
                return block.id
            }
            guard retainedIDs == slides.map(\.id) else { throw PresentationPersistenceError.invalidBlock }
            let byID = Dictionary(uniqueKeysWithValues: slides.map { ($0.id, $0) })
            for block in baseline {
                if case .object(let content) = block.content, content["type"] == .string("slide") {
                    if let slide = byID[block.id] { next.append(try Self.block(slide)) }
                } else { next.append(block) }
            }
        } else {
            var replacement = slides.makeIterator()
            for block in baseline {
                if case .object(let content) = block.content, content["type"] == .string("slide") {
                    if let slide = replacement.next() { next.append(try Self.block(slide)) }
                } else { next.append(block) }
            }
            while let slide = replacement.next() { next.append(try Self.block(slide)) }
        }
        busy = true; defer { busy = false }
        do {
            let value = try await store.savePresentation(id: pageID, base: revision, expectedMetadata: metadata, expected: baseline, blocks: next, deleting: deleting.sorted())
            let parsed = try Self.parse(value)
            guard parsed.id == pageID else { throw PresentationPersistenceError.invalidResponse }
            revision = parsed.revision; metadata = parsed.metadata; baseline = parsed.blocks
        } catch { invalidated = true; throw error }
    }
    public func deletedSlides() async throws -> [DeletedSlideRecovery] {
        guard !invalidated else { throw PresentationPersistenceError.reloadRequired }
        guard !busy else { throw PresentationPersistenceError.saveInProgress }
        let value = try await store.deletedPresentationSlides(id: pageID)
        guard case .object(let result) = value, case .array(let items)? = result["items"] else { throw PresentationPersistenceError.invalidResponse }
        return try items.map { item in
            guard case .object(let row) = item, case .string(let rawID)? = row["id"], let id = UUID(uuidString: rawID),
                  case .string(let blockID)? = row["blockID"], case .integer(let createdAt)? = row["createdAt"] else { throw PresentationPersistenceError.invalidResponse }
            return DeletedSlideRecovery(id: id, blockID: blockID, createdAt: createdAt)
        }
    }
    public func restoreDeletedSlide(id: UUID) async throws -> [SlideBlock] {
        guard !invalidated else { throw PresentationPersistenceError.reloadRequired }
        guard !busy else { throw PresentationPersistenceError.saveInProgress }
        busy = true; defer { busy = false }
        do {
            let value = try await store.restorePresentationSlide(id: pageID, recoveryID: id, base: revision, expectedMetadata: metadata, expected: baseline)
            let parsed = try Self.parse(value)
            guard parsed.id == pageID else { throw PresentationPersistenceError.invalidResponse }
            let slides = try parsed.blocks.compactMap { block -> SlideBlock? in
                guard case .object(let content) = block.content, content["type"] == .string("slide") else { return nil }
                return try SlideBlock(source: .object(["id": .string(block.id), "content": block.content]))
            }
            revision = parsed.revision; metadata = parsed.metadata; baseline = parsed.blocks
            return slides
        } catch { invalidated = true; throw error }
    }
    private static func block(_ slide: SlideBlock) throws -> NativeBlockInput {
        guard case .object(let object) = slide.source, let content = object["content"] else { throw PresentationPersistenceError.invalidBlock }
        return NativeBlockInput(id: slide.id, content: content)
    }
    private static func parse(_ value: JSONValue) throws -> (id: String, revision: Int64, metadata: JSONValue, blocks: [NativeBlockInput]) {
        guard case .object(let object) = value, case .string(let id)? = object["id"], object["kind"] == .string("presentation"),
              case .integer(let revision)? = object["revision"], let metadata = object["metadata"], case .array(let entries)? = object["blocks"] else { throw PresentationPersistenceError.invalidResponse }
        let blocks = try entries.map { entry -> NativeBlockInput in
            guard case .object(let item) = entry, case .string(let id)? = item["id"], let content = item["content"] else { throw PresentationPersistenceError.invalidResponse }
            return NativeBlockInput(id: id, content: content)
        }
        return (id, revision, metadata, blocks)
    }
}
