import Foundation
import WorldsModels

public enum DrawingDataError: Error, Equatable, Sendable {
    case invalidScene
    case unsupportedSchema
    case invalidCollection(String)
}

/// Schema 1 remains an open JSON tree so fields unknown to this build survive.
/// This performs structural checks, not the full validation in model.ts.
public struct DrawingScene: Sendable, Equatable {
    public private(set) var source: JSONValue

    public init(json: Data) throws {
        try self.init(source: JSONDecoder().decode(JSONValue.self, from: json))
    }
    public init(source: JSONValue) throws {
        guard case .object(let scene) = source else { throw DrawingDataError.invalidScene }
        guard scene["schema"] == .integer(1) else { throw DrawingDataError.unsupportedSchema }
        for key in ["frames", "layers", "nodes", "assets", "masks", "steps"] {
            guard case .object(_)? = scene[key] else { throw DrawingDataError.invalidCollection(key) }
        }
        for key in ["frameOrder", "layerOrder", "nodeOrder", "stepOrder"] {
            guard case .array(let values)? = scene[key], values.allSatisfy({ if case .string = $0 { return true }; return false }) else { throw DrawingDataError.invalidCollection(key) }
        }
        guard case .string(_)? = scene["defaultFrameId"] else { throw DrawingDataError.invalidScene }
        self.source = source
    }
    public func json() throws -> Data { try JSONEncoder().encode(source) }
}


/// Full journal envelope. Operations and unknown envelope fields are preserved
/// as JSON and are not interpreted or replayed by this module.
public struct DrawingDocument: Sendable, Equatable {
    public private(set) var source: JSONValue
    public let scene: DrawingScene
    public init(json: Data) throws {
        let decoded = try JSONDecoder().decode(JSONValue.self, from: json)
        guard case .object(let object) = decoded,
              case .integer(let revision)? = object["revision"], revision >= 0,
              case .array(_)? = object["operations"], let seed = object["seed"], let scene = object["scene"] else { throw DrawingDataError.invalidScene }
        _ = try DrawingScene(source: seed)
        self.scene = try DrawingScene(source: scene)
        self.source = decoded
    }
    public func json() throws -> Data { try JSONEncoder().encode(source) }
}
