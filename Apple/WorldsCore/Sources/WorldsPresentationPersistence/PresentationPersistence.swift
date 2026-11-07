import Foundation
import WorldsModels
import WorldsNativeWrites
import WorldsPresentations

public enum PresentationPersistenceError: Error { case invalidResponse, invalidBlock, saveInProgress, reloadRequired }

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
    public func save(slides: [SlideBlock]) async throws {
        guard !invalidated else { throw PresentationPersistenceError.reloadRequired }
        guard !busy else { throw PresentationPersistenceError.saveInProgress }
        guard !slides.isEmpty, Set(slides.map(\.id)).count == slides.count else { throw PresentationPersistenceError.invalidBlock }
        var replacement = slides.makeIterator(), next: [NativeBlockInput] = []
        for block in baseline {
            if case .object(let content) = block.content, content["type"] == .string("slide") {
                if let slide = replacement.next() { next.append(try Self.block(slide)) }
            } else { next.append(block) }
        }
        while let slide = replacement.next() { next.append(try Self.block(slide)) }
        busy = true; defer { busy = false }
        do {
            let value = try await store.savePresentation(id: pageID, base: revision, expectedMetadata: metadata, expected: baseline, blocks: next)
            let parsed = try Self.parse(value)
            guard parsed.id == pageID else { throw PresentationPersistenceError.invalidResponse }
            revision = parsed.revision; metadata = parsed.metadata; baseline = parsed.blocks
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
