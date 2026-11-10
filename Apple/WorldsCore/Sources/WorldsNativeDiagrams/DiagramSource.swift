import Foundation
import WorldsModels

public enum DiagramSourceError: Error, Equatable, Sendable { case invalidNode, tooLarge }
/// Retains the entire ProseMirror node while editing only attrs.code.
public struct DiagramSourceDocument: Equatable, Sendable {
    public private(set) var source: JSONValue
    public init(source: JSONValue) throws {
        guard case .object(let node) = source, node["type"] == .string("mermaid"),
              case .object(let attrs)? = node["attrs"], case .string(let code)? = attrs["code"] else { throw DiagramSourceError.invalidNode }
        guard code.utf8.count <= 64 * 1024 else { throw DiagramSourceError.tooLarge }
        self.source = source
    }
    public var text: String {
        guard case .object(let node) = source, case .object(let attrs)? = node["attrs"], case .string(let value)? = attrs["code"] else { return "" }
        return value
    }
    public mutating func setText(_ text: String) throws {
        guard text.utf8.count <= 64 * 1024 else { throw DiagramSourceError.tooLarge }
        guard case .object(var node) = source, case .object(var attrs)? = node["attrs"] else { throw DiagramSourceError.invalidNode }
        attrs["code"] = .string(text); node["attrs"] = .object(attrs); source = .object(node)
    }
}
