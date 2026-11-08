import Foundation
import WorldsModels

public enum MathSourceDocumentError: Error, Equatable { case invalidNode, tooLarge }
/// Holds the whole original node, including unknown fields and attributes.
public struct MathSourceDocument: Equatable, Sendable {
    public private(set) var source: JSONValue
    public let display: Bool
    public init(source: JSONValue) throws {
        guard case .object(let node) = source, case .string(let type)? = node["type"],
              type == "mathInline" || type == "mathBlock",
              case .object(let attrs)? = node["attrs"], case .string(let text)? = attrs["latex"] else { throw MathSourceDocumentError.invalidNode }
        guard text.utf8.count <= 64 * 1024 else { throw MathSourceDocumentError.tooLarge }
        self.source = source; display = type == "mathBlock"
    }
    public var text: String {
        guard case .object(let node) = source, case .object(let attrs)? = node["attrs"],
              case .string(let latex)? = attrs["latex"] else { return "" }
        return latex
    }
    public mutating func setText(_ text: String) throws {
        guard text.utf8.count <= 64 * 1024 else { throw MathSourceDocumentError.tooLarge }
        guard case .object(var node) = source, case .object(var attrs)? = node["attrs"] else { throw MathSourceDocumentError.invalidNode }
        attrs["latex"] = .string(text); node["attrs"] = .object(attrs); source = .object(node)
    }
}
