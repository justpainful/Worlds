import Foundation
import WorldsModels
import WorldsPersistence
import WorldsRichText
import WorldsNativeEditor
import WorldsNativeWrites

public enum EditorBridgeError: Error, Equatable {
    case unavailable, invalidDocument, invalidBlock, staleBaseline, saveInProgress, reloadRequired, invalidResponse
}

/// Experimental personal-page bridge. Construct only from an atomic read snapshot.
public actor PersonalEditorPersistence: EditorPersistence {
    public nonisolated let initialDocument: RichTextDocument
    public nonisolated let initialRevision: Int64
    private let pageID: String
    private let store: NativePersonalStore
    private var baseline: [NativeBlockInput]
    private var expectedRevision: Int64
    private var saving = false
    private var invalidated = false

    private init(page: StoredPage, store: NativePersonalStore) throws {
        guard page.kind == "page" || page.kind == "document" else { throw EditorBridgeError.unavailable }
        let metadata = try JSONDecoder().decode(JSONValue.self, from: Data(page.metadataJSON.utf8))
        guard case .object(let metadataFields) = metadata else { throw EditorBridgeError.unavailable }
        if let sync = metadataFields["sync"] {
            guard case .object(let fields) = sync,
                  fields["shared"] == nil || fields["shared"] == .bool(false) else { throw EditorBridgeError.unavailable }
        }
        var original: [NativeBlockInput] = []
        var editable: [JSONValue] = []
        var ids = Set<String>()
        for block in page.blocks {
            guard !block.id.isEmpty, ids.insert(block.id).inserted else { throw EditorBridgeError.invalidBlock }
            let value = try JSONDecoder().decode(JSONValue.self, from: Data(block.contentJSON.utf8))
            guard case .object(var node) = value, case .string(_)? = node["type"] else { throw EditorBridgeError.invalidBlock }
            var attrs: [String: JSONValue]
            if let raw = node["attrs"] {
                guard case .object(let value) = raw else { throw EditorBridgeError.invalidBlock }
                attrs = value
            } else { attrs = [:] }
            if let existing = attrs["bid"], existing != .null, existing != .string(block.id) { throw EditorBridgeError.invalidBlock }
            attrs["bid"] = .string(block.id)
            node["attrs"] = .object(attrs)
            original.append(NativeBlockInput(id: block.id, content: value))
            editable.append(.object(node))
        }
        initialDocument = try RichTextDocument(source: .object(["type": .string("doc"), "content": .array(editable)]))
        initialRevision = page.updatedAt
        expectedRevision = page.updatedAt
        pageID = page.id
        self.store = store
        baseline = original
    }

    /// Read and write use the same URL. No caller-supplied snapshot can be paired with another store.
    public static func open(databaseURL: URL, pageID: String) async throws -> PersonalEditorPersistence {
        let reader = try WorldsDatabase(url: databaseURL)
        let snapshot = try await reader.snapshot()
        guard let page = snapshot.pages.first(where: { $0.id == pageID }) else { throw EditorBridgeError.unavailable }
        return try PersonalEditorPersistence(page: page, store: NativePersonalStore(url: databaseURL))
    }
    public func save(documentJSON: Data, basedOn: Int64) async throws -> Int64 {
        guard !invalidated else { throw EditorBridgeError.reloadRequired }
        guard !saving else { throw EditorBridgeError.saveInProgress }
        guard basedOn == expectedRevision else { throw EditorBridgeError.staleBaseline }
        let value = try JSONDecoder().decode(JSONValue.self, from: documentJSON)
        guard case .object(let root) = value, Set(root.keys) == Set(["type", "content"]),
              root["type"] == .string("doc"), case .array(let nodes)? = root["content"] else { throw EditorBridgeError.invalidDocument }
        var updated: [NativeBlockInput] = []
        var ids = Set<String>()
        for value in nodes {
            guard case .object(let node) = value, case .string(let type)? = node["type"], !type.isEmpty,
                  case .object(let attrs)? = node["attrs"], case .string(let id)? = attrs["bid"],
                  !id.isEmpty, ids.insert(id).inserted else { throw EditorBridgeError.invalidBlock }
            updated.append(NativeBlockInput(id: id, content: value))
        }
        saving = true
        defer { saving = false }
        do {
            let response = try await store.saveBlocksChecked(pageID: pageID, base: basedOn, expected: baseline, blocks: updated)
            guard case .object(let result) = response, case .integer(let revision)? = result["updatedAt"],
                  case .array(let remapped)? = result["remapped"], remapped.isEmpty else {
                invalidated = true
                throw EditorBridgeError.invalidResponse
            }
            expectedRevision = revision
            baseline = updated
            return revision
        } catch {
            // A transport/decoding error may happen after commit. Require a fresh snapshot.
            invalidated = true
            throw error
        }
    }
}
