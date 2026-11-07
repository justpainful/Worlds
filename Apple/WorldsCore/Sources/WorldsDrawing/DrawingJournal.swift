import Foundation
import WorldsModels

public enum DrawingJournalError: Error, Equatable {
    case malformed, unsupported, conflict, authorMismatch, duplicateIdentifier, invalidScene
}

private extension JSONValue {
    var jObject: [String: JSONValue]? { if case .object(let x) = self { return x }; return nil }
    var jArray: [JSONValue]? { if case .array(let x) = self { return x }; return nil }
    var jString: String? { if case .string(let x) = self { return x }; return nil }
    var jInt: Int64? { if case .integer(let x) = self { return x }; return nil }
    var jBool: Bool? { if case .bool(let x) = self { return x }; return nil }
}

/// Experimental in-memory journal. Full source scene validation and guards
/// are deliberately not replaced by these structural checks.
public enum DrawingJournal {
    private static let maps: Set<String> = ["frames", "layers", "nodes", "assets", "masks", "steps"]
    private static let orders = ["frameOrder":"frames", "layerOrder":"layers", "nodeOrder":"nodes", "stepOrder":"steps"]
    private static let unsafeKeys: Set<String> = ["__proto__", "constructor", "prototype"]

    private static func sceneChecked(_ scene: [String: JSONValue]) throws {
        _ = try DrawingScene(source: .object(scene))
        for (list, map) in orders {
            guard let values = scene[list]?.jArray, let entities = scene[map]?.jObject else { throw DrawingJournalError.invalidScene }
            let ids = values.compactMap(\.jString)
            guard ids.count == values.count, Set(ids).count == ids.count, Set(ids) == Set(entities.keys) else { throw DrawingJournalError.invalidScene }
        }
        for map in maps {
            guard let entities = scene[map]?.jObject else { throw DrawingJournalError.invalidScene }
            for (id, value) in entities {
                guard !unsafeKeys.contains(id), value.jObject?["id"]?.jString == id else { throw DrawingJournalError.invalidScene }
            }
        }
        guard let frame = scene["defaultFrameId"]?.jString, scene["frames"]?.jObject?[frame] != nil,
              !(scene["layerOrder"]?.jArray?.isEmpty ?? true) else { throw DrawingJournalError.invalidScene }
    }
    private static func changes(_ changes: [JSONValue], into initial: [String: JSONValue], replay: Bool) throws -> [String: JSONValue] {
        guard changes.count <= 10_000 else { throw DrawingJournalError.malformed }
        var scene = initial
        for change in changes {
            guard let c = change.jObject, let type = c["type"]?.jString else { throw DrawingJournalError.malformed }
            if type == "order" {
                guard let list = c["list"]?.jString, let map = orders[list], let ids = c["ids"]?.jArray,
                      ids.allSatisfy({ $0.jString != nil }), let items = scene[map]?.jObject else { throw DrawingJournalError.malformed }
                if replay {
                    let present = ids.compactMap(\.jString).filter { items[$0] != nil }
                    let remainder = items.keys.filter { !present.contains($0) }.sorted()
                    scene[list] = .array((present + remainder).map(JSONValue.string))
                } else { scene[list] = .array(ids) }
            } else if type == "defaultFrame" {
                guard let id = c["id"]?.jString else { throw DrawingJournalError.malformed }
                scene["defaultFrameId"] = .string(id)
            } else {
                guard let collection = c["collection"]?.jString, maps.contains(collection),
                      let id = c["id"]?.jString, !unsafeKeys.contains(id), var entities = scene[collection]?.jObject else { throw DrawingJournalError.malformed }
                switch type {
                case "put":
                    guard entities[id] == nil, let value = c["value"] else { throw DrawingJournalError.conflict }
                    entities[id] = value
                case "remove": entities.removeValue(forKey: id)
                case "patch":
                    guard var old = entities[id]?.jObject, let patch = c["fields"]?.jObject,
                          !patch.keys.contains(where: { unsafeKeys.contains($0) || $0 == "id" }) else { throw DrawingJournalError.conflict }
                    for (key, value) in patch { old[key] = value }
                    entities[id] = .object(old)
                default: throw DrawingJournalError.unsupported
                }
                scene[collection] = .object(entities)
            }
        }
        return scene
    }
    private static func replay(seed: [String: JSONValue], operations: [JSONValue]) throws -> [String: JSONValue] {
        var enabled: [String: Bool] = [:]
        for value in operations {
            guard let op = value.jObject, let type = op["type"]?.jString else { throw DrawingJournalError.malformed }
            if type == "edit", let id = op["id"]?.jString { enabled[id] = true }
            else if type == "toggle", let target = op["target"]?.jString, let on = op["enabled"]?.jBool { enabled[target] = on }
            else { throw DrawingJournalError.unsupported }
        }
        var result = seed
        for value in operations {
            guard let op = value.jObject, let type = op["type"]?.jString else { throw DrawingJournalError.malformed }
            if type == "edit", let id = op["id"]?.jString, enabled[id] == true {
                guard let list = op["changes"]?.jArray else { throw DrawingJournalError.malformed }
                result = try changes(list, into: result, replay: true)
            }
        }
        try sceneChecked(result)
        return result
    }

    public static func append(_ value: JSONValue, to document: DrawingDocument, actor: String) throws -> DrawingDocument {
        guard var envelope = document.source.jObject, let revision = envelope["revision"]?.jInt,
              revision >= 0, revision < Int64.max, var operations = envelope["operations"]?.jArray,
              let oldScene = envelope["scene"]?.jObject, let seed = envelope["seed"]?.jObject,
              let op = value.jObject, let id = op["id"]?.jString, !id.isEmpty,
              let author = op["actor"]?.jString, !actor.isEmpty, author == actor,
              let base = op["base"]?.jInt, base >= 0, let label = op["label"]?.jString,
              !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              op["at"]?.jInt != nil, let type = op["type"]?.jString else { throw DrawingJournalError.malformed }
        if let existing = operations.first(where: { $0.jObject?["id"]?.jString == id }) {
            guard existing == value else { throw DrawingJournalError.duplicateIdentifier }
            return document
        }
        guard base == revision else { throw DrawingJournalError.conflict }
        // Guarded operations require the original store and must not silently degrade.
        guard op["pixelGuard"] == nil, op["versionRestore"] == nil,
              op["requiresBase"] == nil || (type == "edit" && op["requiresBase"]?.jBool == true) else { throw DrawingJournalError.unsupported }
        var next: [String: JSONValue]
        switch type {
        case "edit":
            guard let list = op["changes"]?.jArray else { throw DrawingJournalError.malformed }
            next = try changes(list, into: oldScene, replay: false)
            operations.append(value)
            try sceneChecked(next)
        case "toggle":
            guard let target = op["target"]?.jString, op["enabled"]?.jBool != nil,
                  let match = operations.first(where: { $0.jObject?["id"]?.jString == target })?.jObject,
                  match["type"]?.jString == "edit", match["actor"]?.jString == actor else { throw DrawingJournalError.authorMismatch }
            operations.append(value)
            next = try replay(seed: seed, operations: operations)
        default: throw DrawingJournalError.unsupported
        }
        envelope["scene"] = .object(next); envelope["operations"] = .array(operations); envelope["revision"] = .integer(revision + 1)
        return try DrawingDocument(json: JSONEncoder().encode(JSONValue.object(envelope)))
    }

    /// Mirrors the frontend's per-author toggle target selection, not the native DB history window.
    public static func toggle(in document: DrawingDocument, actor: String, redo: Bool, id: String, at: Int64) throws -> JSONValue? {
        guard !actor.isEmpty, !id.isEmpty, let env = document.source.jObject, let revision = env["revision"]?.jInt,
              let operations = env["operations"]?.jArray else { throw DrawingJournalError.malformed }
        var enabled: [String: Bool] = [:]
        for value in operations {
            guard let op = value.jObject, let type = op["type"]?.jString else { throw DrawingJournalError.malformed }
            if type == "edit", let id = op["id"]?.jString { enabled[id] = true }
            else if type == "toggle", let target = op["target"]?.jString, let value = op["enabled"]?.jBool { enabled[target] = value }
            else { throw DrawingJournalError.unsupported }
        }
        let edits = operations.compactMap(\.jObject).filter { $0["type"]?.jString == "edit" && $0["actor"]?.jString == actor }
        var target = edits.reversed().first { enabled[$0["id"]?.jString ?? ""] == true }?["id"]?.jString
        if redo {
            target = nil
            for value in operations.reversed() {
                guard let op = value.jObject else { throw DrawingJournalError.malformed }
                if op["actor"]?.jString != actor { continue }
                if op["type"]?.jString == "edit" { break }
                if op["type"]?.jString == "toggle", op["enabled"]?.jBool == false,
                   let candidate = op["target"]?.jString, enabled[candidate] == false,
                   edits.contains(where: { $0["id"]?.jString == candidate }) { target = candidate; break }
            }
        }
        guard let target else { return nil }
        return .object(["id":.string(id),"actor":.string(actor),"base":.integer(revision),"at":.integer(at),
                        "label":.string(redo ? "Redo" : "Undo"),"type":.string("toggle"),"target":.string(target),"enabled":.bool(redo)])
    }
}

public struct DrawingTransform: Sendable {
    public let x: Double, y: Double, width: Double, height: Double, rotation: Double
    public let flipX: Bool, flipY: Bool
    public init(x: Double, y: Double, width: Double, height: Double, rotation: Double, flipX: Bool, flipY: Bool) {
        self.x=x; self.y=y; self.width=width; self.height=height; self.rotation=rotation; self.flipX=flipX; self.flipY=flipY
    }
}
public enum DrawingSelection {
    /// Resolves a selection in scene order. It does not perform hit testing.
    public static func nodes(in scene: DrawingScene, ids: Set<String>) throws -> [String] {
        guard let root = scene.source.jObject, let order = root["nodeOrder"]?.jArray,
              let nodes = root["nodes"]?.jObject, ids.allSatisfy({ nodes[$0] != nil }) else { throw DrawingJournalError.invalidScene }
        return order.compactMap(\.jString).filter { ids.contains($0) }
    }

    /// Creates a patch only. The original store must still validate and commit it.
    public static func transformChange(in scene: DrawingScene, nodeID: String, transform: DrawingTransform) throws -> JSONValue {
        guard [transform.x,transform.y,transform.width,transform.height,transform.rotation].allSatisfy(\.isFinite),
              transform.width > 0, transform.height > 0, let root = scene.source.jObject,
              let node = root["nodes"]?.jObject?[nodeID]?.jObject, node["locked"]?.jBool != true,
              let layerID = node["layerId"]?.jString, let layer = root["layers"]?.jObject?[layerID]?.jObject,
              layer["locked"]?.jBool != true, layer["positionLocked"]?.jBool != true else { throw DrawingJournalError.invalidScene }
        return .object(["type":.string("patch"),"collection":.string("nodes"),"id":.string(nodeID),"fields":.object([
            "x":.number(transform.x),"y":.number(transform.y),"w":.number(transform.width),"h":.number(transform.height),
            "rotation":.number(transform.rotation),"flipX":.bool(transform.flipX),"flipY":.bool(transform.flipY)
        ])])
    }
}
