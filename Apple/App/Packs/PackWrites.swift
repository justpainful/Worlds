#if WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_SPREADSHEET_EDITOR
import Foundation
import WorldsModels
import WorldsNativeWrites
import WorldsResourceRepositories
import WorldsWorkspaceAccess

/// Pack item writes for the Packs screen (docs/PACKS.md): a new item with its
/// first fields, and a change to some fields of an existing one, saved with
/// the same baseline check as the item editor.
enum PackWrites {
    enum Failure: Error { case malformed }

    static func json(_ value: PackValue) -> JSONValue {
        switch value {
        case .string(let s): return .string(s)
        case .bool(let b): return .bool(b)
        case .null: return .null
        case .number(let d): return d == d.rounded() && abs(d) < 1e15 ? .integer(Int64(d)) : .number(d)
        }
    }

    /// Creates the item and returns its page id.
    static func create(target: WorkspaceWriteTarget, kind: String, title: String, fields: [String: PackValue]) async throws -> String {
        let store = try NativePersonalStore(url: target.databaseURL)
        let item = JSONValue.object(fields.mapValues(json))
        let result = try await store.createPackItemIdempotent(title: title, kind: kind, metadata: .object(["item": item]), operationID: UUID())
        guard case .object(let created) = result, case .string(let id)? = created["id"], !id.isEmpty else { throw Failure.malformed }
        return id
    }

    /// Sets the given fields (null clears one) and keeps the rest of the item.
    static func setFields(target: WorkspaceWriteTarget, id: String, fields: [String: PackValue]) async throws {
        let repository = NativeResourceRepository(store: try NativePersonalStore(url: target.databaseURL))
        let baseline = try await repository.readPackItem(id: id)
        guard case .object(var root) = baseline.metadata else { throw Failure.malformed }
        var item: [String: JSONValue] = [:]
        if case .object(let current)? = root["item"] { item = current }
        for (key, value) in fields {
            if case .null = value { item.removeValue(forKey: key) } else { item[key] = json(value) }
        }
        root["item"] = .object(item)
        _ = try await repository.savePackItem(id: id, baseline: baseline, metadata: .object(root))
    }
}
#endif
