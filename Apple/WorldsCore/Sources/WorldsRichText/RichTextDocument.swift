import Foundation
import WorldsModels
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

public enum RichTextError: Error, Equatable, Sendable {
    case invalidDocument
    case invalidPath
    case notTextNode
    case invalidRange
}

/// A path indexes only the `content` array at each level.
public struct RichTextPath: Hashable, Sendable {
    public let indices: [Int]
    public init(_ indices: [Int]) { self.indices = indices }
}

public struct RichTextSpan: Equatable, Sendable {
    public let path: RichTextPath
    public let range: NSRange
    public let marks: [JSONValue]
    public let direction: String?
    public let blockType: String?
}

public struct RichTextProjection: Sendable {
    public let text: String
    public let spans: [RichTextSpan]
}

/// The source tree remains canonical. Projection never rewrites an unknown node,
/// mark, attribute or extension payload, so a round trip preserves their data.
public struct RichTextDocument: Sendable, Equatable {
    public internal(set) var source: JSONValue

    public init(source: JSONValue) throws {
        guard case .object(let root) = source,
              case .string("doc")? = root["type"],
              case .array(_)? = root["content"] else { throw RichTextError.invalidDocument }
        self.source = source
    }

    public init(json: Data) throws {
        try self.init(source: JSONDecoder().decode(JSONValue.self, from: json))
    }

    public func json() throws -> Data { try JSONEncoder().encode(source) }

    public func project() -> RichTextProjection {
        var text = ""
        var spans: [RichTextSpan] = []
        projectNode(source, path: [], direction: nil, blockType: nil, text: &text, spans: &spans)
        return RichTextProjection(text: text, spans: spans)
    }

    /// Only text nodes are editable through this operation. Unsupported nodes
    /// remain opaque and untouched. The range is in UTF-16, as used by TextKit.
    public mutating func replaceText(at path: RichTextPath, range: NSRange, with replacement: String) throws {
        try updateNode(&source, path: ArraySlice(path.indices)) { node in
            guard case .string("text")? = node["type"], case .string(let current)? = node["text"] else { throw RichTextError.notTextNode }
            let utf16 = current.utf16
            guard range.location != NSNotFound, range.location >= 0, range.length >= 0,
                  range.location <= utf16.count, range.length <= utf16.count - range.location,
                  let lower16 = utf16.index(utf16.startIndex, offsetBy: range.location, limitedBy: utf16.endIndex),
                  let upper16 = utf16.index(lower16, offsetBy: range.length, limitedBy: utf16.endIndex),
                  let lower = String.Index(lower16, within: current),
                  let upper = String.Index(upper16, within: current) else { throw RichTextError.invalidRange }
            node["text"] = .string(current.replacingCharacters(in: lower..<upper, with: replacement))
        }
    }

    /// Replaces marks only for the chosen text node. Callers must include marks
    /// they wish to retain, including marks unknown to the current UI.
    public mutating func setMarks(at path: RichTextPath, marks: [JSONValue]) throws {
        try updateNode(&source, path: ArraySlice(path.indices)) { node in
            guard case .string("text")? = node["type"] else { throw RichTextError.notTextNode }
            node["marks"] = .array(marks)
        }
    }
}

private func updateNode(_ value: inout JSONValue, path: ArraySlice<Int>, update: (inout [String: JSONValue]) throws -> Void) throws {
    guard case .object(var object) = value else { throw RichTextError.invalidPath }
    guard let index = path.first else {
        try update(&object)
        value = .object(object)
        return
    }
    guard case .array(var children)? = object["content"], index >= 0, index < children.count else { throw RichTextError.invalidPath }
    try updateNode(&children[index], path: path.dropFirst(), update: update)
    object["content"] = .array(children)
    value = .object(object)
}

private func projectNode(_ value: JSONValue, path: [Int], direction: String?, blockType: String?, text: inout String, spans: inout [RichTextSpan]) {
    guard case .object(let node) = value, case .string(let type)? = node["type"] else { return }
    var currentDirection = direction
    if case .object(let attributes)? = node["attrs"] {
        if case .string(let dir)? = attributes["dir"] { currentDirection = dir }
        else if case .string(let dir)? = attributes["direction"] { currentDirection = dir }
    }
    let currentBlock = ["paragraph", "heading", "codeBlock", "blockquote", "listItem", "tableCell", "tableHeader"].contains(type) ? type : blockType
    if type == "text", case .string(let content)? = node["text"] {
        let start = text.utf16.count
        text += content
        let marks: [JSONValue]
        if case .array(let values)? = node["marks"] { marks = values } else { marks = [] }
        spans.append(RichTextSpan(path: RichTextPath(path), range: NSRange(location: start, length: content.utf16.count), marks: marks, direction: currentDirection, blockType: currentBlock))
        return
    }
    if type == "hardBreak" { text += "\n"; return }
    if case .array(let children)? = node["content"] {
        for (index, child) in children.enumerated() {
            if index > 0 {
                if type == "tableRow" { text += "\t" }
                else if ["doc", "bulletList", "orderedList", "taskList", "table", "listItem", "taskItem", "blockquote"].contains(type) { text += "\n" }
            }
            projectNode(child, path: path + [index], direction: currentDirection, blockType: currentBlock, text: &text, spans: &spans)
        }
    } else if !["doc", "paragraph", "heading", "table", "tableRow", "tableCell", "tableHeader"].contains(type) {
        // Embedded and unknown leaf nodes remain visible as an object placeholder.
        text += "\u{fffc}"
    }
}

#if canImport(UIKit) || canImport(AppKit)
extension RichTextDocument {
    /// A native text view can display this projection. Edits must still map
    /// through RichTextSpan paths and UTF-16 ranges to the canonical tree.
    public func attributedString() -> NSAttributedString {
        let projection = project()
        let result = NSMutableAttributedString(string: projection.text)
        for span in projection.spans where span.range.length > 0 {
            var bold = false
            var italic = false
            var attributes: [NSAttributedString.Key: Any] = [:]
            for mark in span.marks {
                guard case .object(let value) = mark, case .string(let type)? = value["type"] else { continue }
                switch type {
                case "bold": bold = true
                case "italic": italic = true
                case "underline": attributes[.underlineStyle] = 1
                case "strike": attributes[.strikethroughStyle] = 1
                case "link":
                    if case .object(let attrs)? = value["attrs"], case .string(let href)? = attrs["href"], let url = URL(string: href), ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                        attributes[.link] = url
                    }
                default: break
                }
            }
            #if canImport(UIKit)
            var traits: UIFontDescriptor.SymbolicTraits = []
            if bold { traits.insert(.traitBold) }
            if italic { traits.insert(.traitItalic) }
            let base = UIFont.preferredFont(forTextStyle: span.blockType == "heading" ? .headline : .body)
            if let descriptor = base.fontDescriptor.withSymbolicTraits(traits) { attributes[.font] = UIFont(descriptor: descriptor, size: base.pointSize) }
            #elseif canImport(AppKit)
            var traits: NSFontTraitMask = []
            if bold { traits.insert(.boldFontMask) }
            if italic { traits.insert(.italicFontMask) }
            let base = NSFont.systemFont(ofSize: NSFont.systemFontSize)
            attributes[.font] = NSFontManager.shared.convert(base, toHaveTrait: traits)
            #endif
            if span.direction == "rtl" || span.direction == "ltr" {
                let paragraph = NSMutableParagraphStyle()
                paragraph.baseWritingDirection = span.direction == "rtl" ? .rightToLeft : .leftToRight
                attributes[.paragraphStyle] = paragraph
            }
            result.addAttributes(attributes, range: span.range)
        }
        return result
    }
}
#endif


