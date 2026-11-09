import Foundation
import WorldsModels

public enum MathDiagramError: Error, Equatable, Sendable {
    case invalidNode, sourceTooLarge, unsupportedSyntax(String)
}
public enum MathDiagramKind: String, Sendable { case mathInline, mathBlock, mermaid }

/// The complete node is retained, so block IDs and attributes unknown to this
/// client remain untouched when the source changes.
public struct MathDiagramNode: Sendable, Equatable {
    public private(set) var source: JSONValue
    public let kind: MathDiagramKind
    public init(source: JSONValue) throws {
        guard case .object(let object) = source, case .string(let type)? = object["type"],
              let kind = MathDiagramKind(rawValue: type),
              case .object(let attributes)? = object["attrs"],
              case .string(let value)? = attributes[kind == .mermaid ? "code" : "latex"] else { throw MathDiagramError.invalidNode }
        guard value.utf8.count <= 64 * 1024 else { throw MathDiagramError.sourceTooLarge }
        self.source = source; self.kind = kind
    }
    public init(json: Data) throws { try self.init(source: JSONDecoder().decode(JSONValue.self, from: json)) }
    public var text: String {
        guard case .object(let node) = source, case .object(let attrs)? = node["attrs"],
              case .string(let value)? = attrs[kind == .mermaid ? "code" : "latex"] else { return "" }
        return value
    }
    public mutating func setText(_ value: String) throws {
        guard value.utf8.count <= 64 * 1024 else { throw MathDiagramError.sourceTooLarge }
        guard case .object(var node) = source, case .object(var attrs)? = node["attrs"] else { throw MathDiagramError.invalidNode }
        attrs[kind == .mermaid ? "code" : "latex"] = .string(value)
        node["attrs"] = .object(attrs); source = .object(node)
    }
    public func json() throws -> Data { try JSONEncoder().encode(source) }
}
