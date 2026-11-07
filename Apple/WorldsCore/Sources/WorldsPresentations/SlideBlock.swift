import Foundation
import WorldsModels

public enum SlideError: Error, Equatable, Sendable {
    case invalidBlock
    case elementNotFound
    case unsupportedElement
    case invalidGeometry
}

extension JSONValue {
    var slideObject: [String: JSONValue]? { if case .object(let object) = self { return object }; return nil }
    var slideArray: [JSONValue]? { if case .array(let value) = self { return value }; return nil }
    var slideString: String? { if case .string(let value) = self { return value }; return nil }
    var slideNumber: Double? { switch self { case .integer(let n): return Double(n); case .number(let n): return n; default: return nil } }
}

public struct SlideElement: Sendable, Equatable, Identifiable {
    public let source: JSONValue
    public var id: String { source.slideObject?["id"]?.slideString ?? "" }
    public var type: String { source.slideObject?["type"]?.slideString ?? "" }
    public var x: Double { source.slideObject?["x"]?.slideNumber ?? 0 }
    public var y: Double { source.slideObject?["y"]?.slideNumber ?? 0 }
    public var width: Double { source.slideObject?["w"]?.slideNumber ?? 0 }
    public var height: Double { source.slideObject?["h"]?.slideNumber ?? 0 }
    public var rotation: Double { source.slideObject?["rot"]?.slideNumber ?? 0 }
    public var opacity: Double { source.slideObject?["opacity"]?.slideNumber ?? 1 }
    public var text: String? { source.slideObject?["text"]?.slideString }
}

/// Canonical storage is the original block object returned by slideToBlock.
/// Unknown attributes and elements survive reads, edits and serialization.
public struct SlideBlock: Sendable, Equatable, Identifiable {
    public private(set) var source: JSONValue
    public var id: String { source.slideObject?["id"]?.slideString ?? "" }

    public init(json: Data) throws { try self.init(source: JSONDecoder().decode(JSONValue.self, from: json)) }
    public init(source: JSONValue) throws {
        guard let block = source.slideObject, let id = block["id"]?.slideString, !id.isEmpty,
              let content = block["content"]?.slideObject, content["type"]?.slideString == "slide" else { throw SlideError.invalidBlock }
        if let rawAttrs = content["attrs"], rawAttrs != .null {
            guard let attrs = rawAttrs.slideObject else { throw SlideError.invalidBlock }
            if let elements = attrs["elements"], elements.slideArray == nil { throw SlideError.invalidBlock }
        }
        self.source = source
    }
    public func json() throws -> Data { try JSONEncoder().encode(source) }
    public var attributes: [String: JSONValue] { source.slideObject?["content"]?.slideObject?["attrs"]?.slideObject ?? [:] }
    public var layout: String { attributes["layout"]?.slideString ?? "blank" }
    public var notes: String { attributes["notes"]?.slideString ?? "" }
    public var elements: [SlideElement] { (attributes["elements"]?.slideArray ?? []).map { SlideElement(source: $0) } }

    public mutating func setNotes(_ notes: String) throws { try updateAttributes { $0["notes"] = .string(notes) } }
    public mutating func setText(elementID: String, text: String) throws {
        try updateElement(id: elementID) { element in
            guard element["type"]?.slideString == "text" else { throw SlideError.unsupportedElement }
            element["text"] = .string(text)
        }
    }
    public mutating func setGeometry(elementID: String, x: Double, y: Double, width: Double, height: Double, rotation: Double) throws {
        guard [x,y,width,height,rotation].allSatisfy(\.isFinite), width > 0, height > 0,
              [x,y,width,height].allSatisfy({ abs($0) <= 1_000_000 }) else { throw SlideError.invalidGeometry }
        try updateElement(id: elementID) { element in
            guard ["text", "image", "video", "shape"].contains(element["type"]?.slideString ?? "") else { throw SlideError.unsupportedElement }
            element["x"] = .number(x); element["y"] = .number(y); element["w"] = .number(width); element["h"] = .number(height); element["rot"] = .number(rotation)
        }
    }
    public mutating func setTextStyle(elementID: String, key: String, value: JSONValue) throws {
        guard ["fontSize", "fontWeight", "color", "align", "font", "italic"].contains(key) else { throw SlideError.unsupportedElement }
        switch key {
        case "fontSize": guard let n = value.slideNumber, n.isFinite, (1...2048).contains(n) else { throw SlideError.unsupportedElement }
        case "fontWeight": guard let n = value.slideNumber, n.isFinite, (100...1000).contains(n) else { throw SlideError.unsupportedElement }
        case "color", "font": guard case .string = value else { throw SlideError.unsupportedElement }
        case "align": guard let align = value.slideString, ["left", "center", "right"].contains(align) else { throw SlideError.unsupportedElement }
        case "italic": guard case .bool = value else { throw SlideError.unsupportedElement }
        default: throw SlideError.unsupportedElement
        }
        try updateElement(id: elementID) { element in
            guard element["type"]?.slideString == "text" else { throw SlideError.unsupportedElement }
            if let existing = element["style"], existing.slideObject == nil { throw SlideError.unsupportedElement }
            var style = element["style"]?.slideObject ?? [:]
            style[key] = value
            element["style"] = .object(style)
        }
    }
    private mutating func updateElement(id: String, change: (inout [String: JSONValue]) throws -> Void) throws {
        try updateAttributes { attrs in
            guard var elements = attrs["elements"]?.slideArray else { throw SlideError.invalidBlock }
            let matches = elements.indices.filter { elements[$0].slideObject?["id"]?.slideString == id }
            guard matches.count == 1, let index = matches.first, var element = elements[index].slideObject else { throw SlideError.elementNotFound }
            try change(&element)
            elements[index] = .object(element)
            attrs["elements"] = .array(elements)
        }
    }
    private mutating func updateAttributes(_ update: (inout [String: JSONValue]) throws -> Void) throws {
        guard var block = source.slideObject, var content = block["content"]?.slideObject else { throw SlideError.invalidBlock }
        var attrs = content["attrs"]?.slideObject ?? [:]
        try update(&attrs)
        content["attrs"] = .object(attrs)
        block["content"] = .object(content)
        source = .object(block)
    }
}


