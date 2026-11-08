import Foundation
import WorldsModels

public enum SlideError: Error, Equatable, Sendable {
    case invalidBlock
    case elementNotFound
    case unsupportedElement
    case invalidGeometry
    case unsupportedDuplication
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
    public var editableItalic: Bool? {
        guard type == "text", let element = source.slideObject else { return nil }
        guard let rawStyle = element["style"] else { return false }
        guard let style = rawStyle.slideObject else { return nil }
        guard let raw = style["italic"] else { return false }
        guard case .bool(let value) = raw else { return nil }
        return value
    }
    public var editableFontWeight: Double? {
        guard type == "text", let element = source.slideObject else { return nil }
        guard let rawStyle = element["style"] else { return 500 }
        guard let style = rawStyle.slideObject else { return nil }
        guard let raw = style["fontWeight"] else { return 500 }
        guard let value = raw.slideNumber, value.isFinite, (100...1000).contains(value) else { return nil }
        return value
    }
    public var editableTextAlignment: String? {
        guard type == "text", let element = source.slideObject else { return nil }
        guard let rawStyle = element["style"] else { return "left" }
        guard let style = rawStyle.slideObject else { return nil }
        guard let raw = style["align"] else { return "left" }
        guard let value = raw.slideString, ["left", "center", "right"].contains(value) else { return nil }
        return value
    }
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
    /// Matches the original blank layout and its default background.
    public static func blank(id: String = UUID().uuidString.lowercased()) throws -> SlideBlock {
        guard !id.isEmpty else { throw SlideError.invalidBlock }
        return try SlideBlock(source: .object(["id": .string(id), "content": .object([
            "type": .string("slide"), "attrs": .object(["bid": .string(id), "layout": .string("blank"),
                "background": .object(["color": .string("#16161a")]), "notes": .string(""), "elements": .array([])])
        ])]))
    }
    /// Unknown fields may contain references to the old element IDs. Refuse to
    /// copy them rather than silently changing their meaning.
    public func duplicated(id: String = UUID().uuidString.lowercased()) throws -> SlideBlock {
        guard !id.isEmpty, id != self.id,
              var block = source.slideObject, Set(block.keys).isSubset(of: ["id", "content"]),
              var content = block["content"]?.slideObject, Set(content.keys).isSubset(of: ["type", "attrs"]),
              var attrs = content["attrs"]?.slideObject,
              Set(attrs.keys).isSubset(of: ["bid", "layout", "background", "notes", "elements"]),
              attrs["bid"] == .string(self.id),
              let rawElements = attrs["elements"]?.slideArray else { throw SlideError.unsupportedDuplication }
        for key in ["layout", "notes"] where attrs[key] != nil {
            guard attrs[key]?.slideString != nil else { throw SlideError.unsupportedDuplication }
        }
        if let background = attrs["background"] {
            guard let object = background.slideObject,
                  Set(object.keys).isSubset(of: ["color", "attachmentId"]),
                  object["color"].map({ $0.slideString != nil }) ?? true,
                  object["attachmentId"].map({ $0 == .null || $0.slideString != nil }) ?? true else { throw SlideError.unsupportedDuplication }
        }
        let allowed: Set<String> = ["id", "type", "x", "y", "w", "h", "rot", "opacity", "text", "style", "attachmentId", "fit", "shape", "fill", "stroke", "radius", "role"]
        var oldIDs = Set<String>(), newElements: [JSONValue] = []
        for value in rawElements {
            guard var element = value.slideObject, Set(element.keys).isSubset(of: allowed),
                  let oldID = element["id"]?.slideString, !oldID.isEmpty, oldIDs.insert(oldID).inserted,
                  let type = element["type"]?.slideString, ["text", "image", "video", "shape"].contains(type) else { throw SlideError.unsupportedDuplication }
            for key in ["text", "attachmentId", "fit", "shape", "fill", "stroke", "role"] where element[key] != nil {
                guard element[key]?.slideString != nil else { throw SlideError.unsupportedDuplication }
            }
            for key in ["x", "y", "w", "h", "rot", "opacity", "radius"] where element[key] != nil {
                guard let value = element[key]?.slideNumber, value.isFinite else { throw SlideError.unsupportedDuplication }
            }
            if let style = element["style"] {
                guard let object = style.slideObject,
                      Set(object.keys).isSubset(of: ["fontSize", "fontWeight", "color", "align", "font", "italic"]) else { throw SlideError.unsupportedDuplication }
                for key in ["color", "align", "font"] where object[key] != nil {
                    guard object[key]?.slideString != nil else { throw SlideError.unsupportedDuplication }
                }
                for key in ["fontSize", "fontWeight"] where object[key] != nil {
                    guard let value = object[key]?.slideNumber, value.isFinite else { throw SlideError.unsupportedDuplication }
                }
                if let italic = object["italic"] { guard case .bool = italic else { throw SlideError.unsupportedDuplication } }
            }
            element["id"] = .string(UUID().uuidString.lowercased()); newElements.append(.object(element))
        }
        attrs["bid"] = .string(id); attrs["elements"] = .array(newElements)
        content["attrs"] = .object(attrs); block["id"] = .string(id); block["content"] = .object(content)
        return try SlideBlock(source: .object(block))
    }
    public var attributes: [String: JSONValue] { source.slideObject?["content"]?.slideObject?["attrs"]?.slideObject ?? [:] }
    public var layout: String { attributes["layout"]?.slideString ?? "blank" }
    public var notes: String { attributes["notes"]?.slideString ?? "" }
    public var elements: [SlideElement] { (attributes["elements"]?.slideArray ?? []).map { SlideElement(source: $0) } }

    public var editableNotes: String? {
        guard let attrs = source.slideObject?["content"]?.slideObject?["attrs"]?.slideObject else { return nil }
        guard let value = attrs["notes"] else { return "" }
        return value.slideString
    }
    public mutating func setNotes(_ notes: String) throws {
        guard editableNotes != nil else { throw SlideError.unsupportedElement }
        try updateAttributes { $0["notes"] = .string(notes) }
    }
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
            if key == "align", SlideElement(source: .object(element)).editableTextAlignment == nil { throw SlideError.unsupportedElement }
            if key == "fontWeight", SlideElement(source: .object(element)).editableFontWeight == nil { throw SlideError.unsupportedElement }
            if key == "italic", SlideElement(source: .object(element)).editableItalic == nil { throw SlideError.unsupportedElement }
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


