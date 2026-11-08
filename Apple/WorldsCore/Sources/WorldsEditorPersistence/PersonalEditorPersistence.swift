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
    private static let editableNodeTypes: Set<String> = ["paragraph", "heading", "blockquote", "codeBlock", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "table", "tableRow", "tableCell", "tableHeader", "text", "hardBreak"]
    private static let editableMarkTypes: Set<String> = ["bold", "italic", "underline", "strike", "link"]
    public nonisolated let initialDocument: RichTextDocument
    public nonisolated let initialRevision: Int64
    private let pageID: String
    private let store: NativePersonalStore
    private var baseline: [NativeBlockInput]
    private var opaqueRoots: [JSONValue]
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
        opaqueRoots = Self.opaqueValues(in: editable)
    }

    private static func opaqueValues(in roots: [JSONValue]) -> [JSONValue] {
        var result: [JSONValue] = []
        func append(_ node: JSONValue, owner: JSONValue, path: String, kind: String) {
            result.append(.object(["owner": owner, "path": .string(path), "kind": .string(kind), "value": node]))
        }
        func visit(_ value: JSONValue, owner: JSONValue, path: String) {
            guard case .object(let node) = value, case .string(let type)? = node["type"], editableNodeTypes.contains(type) else {
                append(value, owner: owner, path: path, kind: "node"); return
            }
            var extras = node
            for key in ["type", "attrs", "content", "marks"] { extras.removeValue(forKey: key) }
            if type == "text", case .string(_)? = node["text"] { extras.removeValue(forKey: "text") }
            if !extras.isEmpty { append(.object(extras), owner: owner, path: path, kind: "extra:\(type)") }
            if let attributes = node["attrs"] {
                if case .object(var object) = attributes {
                    if path.isEmpty { object.removeValue(forKey: "bid") }
                    // A task checkbox is an explicitly supported editable
                    // property; every other task attribute remains protected.
                    if type == "taskItem", case .bool(_)? = object["checked"] { object.removeValue(forKey: "checked") }
                    if !object.isEmpty { append(.object(object), owner: owner, path: path, kind: "attrs:\(type)") }
                } else { append(attributes, owner: owner, path: path, kind: "attrs:\(type)") }
            }
            if let marks = node["marks"] {
                if case .array(let entries) = marks {
                    for (index, mark) in entries.enumerated() {
                        let markPath = path + "/mark/\(index)"
                        guard case .object(let data) = mark, case .string(let name)? = data["type"], editableMarkTypes.contains(name) else {
                            append(mark, owner: owner, path: markPath, kind: "mark"); continue
                        }
                        // Link href is editable. Every extra property is opaque;
                        // protect the whole mark when such properties exist.
                        var additional = data
                        additional.removeValue(forKey: "type")
                        if name == "link", case .object(var attrs)? = additional["attrs"] {
                            attrs.removeValue(forKey: "href")
                            if attrs.isEmpty { additional.removeValue(forKey: "attrs") }
                        }
                        if !additional.isEmpty { append(mark, owner: owner, path: markPath, kind: "mark") }
                    }
                } else { append(marks, owner: owner, path: path, kind: "marks") }
            }
            if let content = node["content"] {
                if case .array(let children) = content {
                    for (index, child) in children.enumerated() { visit(child, owner: owner, path: path + "/\(index)") }
                } else { append(content, owner: owner, path: path, kind: "content:\(type)") }
            }
        }
        for root in roots {
            let owner: JSONValue
            if case .object(let node) = root, case .object(let attrs)? = node["attrs"], let id = attrs["bid"] { owner = id }
            else { owner = .null }
            visit(root, owner: owner, path: "")
        }
        return result
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
        // Refuse edits that change protected data or its structural position.
        guard Self.opaqueValues(in: nodes) == opaqueRoots else { throw EditorBridgeError.invalidBlock }
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
            opaqueRoots = Self.opaqueValues(in: nodes)
            return revision
        } catch {
            // A transport/decoding error may happen after commit. Require a fresh snapshot.
            invalidated = true
            throw error
        }
    }
}
