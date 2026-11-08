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
public enum RichLinkSafety {
    public static func isAllowed(_ value: String) -> Bool {
        guard !value.isEmpty, value == value.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              let decoded = value.removingPercentEncoding,
              !decoded.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              let parts = URLComponents(string: value), let scheme = parts.scheme?.lowercased(),
              parts.user == nil, parts.password == nil else { return false }
        if scheme == "http" || scheme == "https" { return !(parts.host ?? "").isEmpty }
        if scheme == "mailto" { return !parts.path.isEmpty && !parts.path.contains("\n") }
        return false
    }
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

    /// Changes only a paragraph/heading node and its known level attribute.
    /// Other attributes, children and marks stay in place. Persistence must
    /// explicitly authorize this transformation before exposing it to users.
    public mutating func setHeading(at path: RichTextPath, level: Int?) throws {
        guard level.map({ (1...3).contains($0) }) ?? true else { throw RichTextError.invalidDocument }
        try updateNode(&source, path: ArraySlice(path.indices)) { node in
            guard case .string(let type)? = node["type"], type == "paragraph" || type == "heading" else { throw RichTextError.invalidDocument }
            var attrs: [String: JSONValue] = [:]
            if let raw = node["attrs"], raw != .null {
                guard case .object(let fields) = raw else { throw RichTextError.invalidDocument }
                attrs = fields
            }
            if type == "paragraph", attrs["level"] != nil { throw RichTextError.invalidDocument }
            if type == "heading" {
                guard case .integer(let oldLevel)? = attrs["level"], (1...3).contains(oldLevel) else { throw RichTextError.invalidDocument }
            }
            if let level {
                node["type"] = .string("heading")
                attrs["level"] = .integer(Int64(level))
            } else {
                node["type"] = .string("paragraph")
                attrs.removeValue(forKey: "level")
            }
            if !attrs.isEmpty { node["attrs"] = .object(attrs) }
            else if node["attrs"] != nil { node["attrs"] = .object([:]) }
        }
    }

    /// Converts one top-level plain paragraph to a one-item Worlds list.
    /// Refuses opaque paragraph or text data rather than relocating it.
    public mutating func makeList(blockIndex: Int, kind: String) throws {
        guard ["bulletList", "orderedList", "taskList"].contains(kind),
              case .object(var root) = source, case .array(var blocks)? = root["content"], blocks.indices.contains(blockIndex),
              case .object(var paragraph) = blocks[blockIndex], paragraph["type"] == .string("paragraph"),
              Set(paragraph.keys).isSubset(of: ["type", "attrs", "content"]),
              case .object(let attrs)? = paragraph["attrs"], case .string(let bid)? = attrs["bid"], !bid.isEmpty,
              Set(attrs.keys).isSubset(of: ["bid"]), case .array(let children)? = paragraph["content"] else { throw RichTextError.invalidDocument }
        for child in children {
            guard case .object(let text) = child, text["type"] == .string("text"),
                  Set(text.keys).isSubset(of: ["type", "text", "marks"]), case .string(_)? = text["text"] else { throw RichTextError.invalidDocument }
            if let marks = text["marks"] {
                guard case .array(let values) = marks, values.allSatisfy({ value in
                    guard case .object(let mark) = value, Set(mark.keys) == Set(["type"]), case .string(let name)? = mark["type"] else { return false }
                    return ["bold", "italic", "underline", "strike"].contains(name)
                }) else { throw RichTextError.invalidDocument }
            }
        }
        paragraph.removeValue(forKey: "attrs")
        var item: [String: JSONValue] = ["type": .string(kind == "taskList" ? "taskItem" : "listItem"), "content": .array([.object(paragraph)])]
        if kind == "taskList" { item["attrs"] = .object(["checked": .bool(false)]) }
        blocks[blockIndex] = .object(["type": .string(kind), "attrs": .object(attrs), "content": .array([.object(item)])])
        root["content"] = .array(blocks); source = .object(root)
    }

    /// Converts a root list or unwraps a single-item list. Unknown list/item
    /// attributes and checked task state are never silently discarded.
    public mutating func toggleList(blockIndex: Int, kind: String) throws {
        guard ["bulletList", "orderedList", "taskList"].contains(kind),
              case .object(var root) = source, case .array(var blocks)? = root["content"], blocks.indices.contains(blockIndex),
              case .object(var list) = blocks[blockIndex], case .string(let current)? = list["type"] else { throw RichTextError.invalidDocument }
        if current == "paragraph" { try makeList(blockIndex: blockIndex, kind: kind); return }
        guard ["bulletList", "orderedList", "taskList"].contains(current),
              Set(list.keys).isSubset(of: ["type", "attrs", "content"]), case .object(let attrs)? = list["attrs"],
              case .string(let bid)? = attrs["bid"], !bid.isEmpty, Set(attrs.keys).isSubset(of: ["bid"]),
              case .array(var items)? = list["content"], !items.isEmpty else { throw RichTextError.invalidDocument }
        for item in items {
            guard case .object(let object) = item, object["type"] == .string(current == "taskList" ? "taskItem" : "listItem"),
                  Set(object.keys).isSubset(of: ["type", "attrs", "content"]) else { throw RichTextError.invalidDocument }
            if let attrs = object["attrs"], attrs != .null {
                guard case .object(let fields) = attrs else { throw RichTextError.invalidDocument }
                if current == "taskList" {
                    guard Set(fields.keys).isSubset(of: ["checked"]), fields["checked"] == .bool(false) else { throw RichTextError.invalidDocument }
                } else if !fields.isEmpty { throw RichTextError.invalidDocument }
            } else if current == "taskList" { throw RichTextError.invalidDocument }
        }
        if current == kind {
            var paragraphs: [JSONValue] = []
            var existingIDs = Set<String>()
            for block in blocks {
                if case .object(let object) = block, case .object(let fields)? = object["attrs"], case .string(let id)? = fields["bid"] { existingIDs.insert(id) }
            }
            for (index, value) in items.enumerated() {
                guard case .object(let item) = value, case .array(let content)? = item["content"], content.count == 1,
                      case .object(var paragraph) = content[0], paragraph["type"] == .string("paragraph"),
                      Set(paragraph.keys).isSubset(of: ["type", "content"]), case .array(let textNodes)? = paragraph["content"] else { throw RichTextError.invalidDocument }
                for value in textNodes {
                    guard case .object(let text) = value, text["type"] == .string("text"), Set(text.keys).isSubset(of: ["type", "text", "marks"]), case .string(_)? = text["text"] else { throw RichTextError.invalidDocument }
                    if let marks = text["marks"] {
                        guard case .array(let entries) = marks, entries.allSatisfy({ entry in
                            guard case .object(let mark) = entry, Set(mark.keys) == Set(["type"]), case .string(let name)? = mark["type"] else { return false }
                            return ["bold", "italic", "underline", "strike"].contains(name)
                        }) else { throw RichTextError.invalidDocument }
                    }
                }
                var id = bid
                if index > 0 {
                    repeat { id = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased() } while existingIDs.contains(id)
                    existingIDs.insert(id)
                }
                paragraph["attrs"] = .object(["bid": .string(id)]); paragraphs.append(.object(paragraph))
            }
            blocks.replaceSubrange(blockIndex...blockIndex, with: paragraphs)
        } else {
            for index in items.indices {
                guard case .object(var item) = items[index] else { throw RichTextError.invalidDocument }
                item["type"] = .string(kind == "taskList" ? "taskItem" : "listItem")
                if kind == "taskList" { item["attrs"] = .object(["checked": .bool(false)]) }
                else { item.removeValue(forKey: "attrs") }
                items[index] = .object(item)
            }
            list["type"] = .string(kind); list["content"] = .array(items); blocks[blockIndex] = .object(list)
        }
        root["content"] = .array(blocks); source = .object(root)
    }
    /// Convert a nested list in place; unwrapping a nested hierarchy is refused.
    public mutating func convertNestedList(at path: RichTextPath, kind: String) throws {
        guard path.indices.count >= 3, ["bulletList", "orderedList", "taskList"].contains(kind) else { throw RichTextError.invalidPath }
        try updateNode(&source, path: ArraySlice(path.indices)) { list in
            guard case .string(let current)? = list["type"], ["bulletList", "orderedList", "taskList"].contains(current), current != kind,
                  Set(list.keys).isSubset(of: ["type", "attrs", "content"]), case .array(var items)? = list["content"], !items.isEmpty else { throw RichTextError.invalidDocument }
            if let attrs = list["attrs"], attrs != .null {
                guard case .object(let fields) = attrs, fields.isEmpty else { throw RichTextError.invalidDocument }
            }
            for index in items.indices {
                guard case .object(var item) = items[index], item["type"] == .string(current == "taskList" ? "taskItem" : "listItem"),
                      Set(item.keys).isSubset(of: ["type", "attrs", "content"]) else { throw RichTextError.invalidDocument }
                if let attrs = item["attrs"], attrs != .null {
                    guard case .object(let fields) = attrs else { throw RichTextError.invalidDocument }
                    if current == "taskList" {
                        guard Set(fields.keys).isSubset(of: ["checked"]), fields["checked"] == .bool(false) else { throw RichTextError.invalidDocument }
                    } else if !fields.isEmpty { throw RichTextError.invalidDocument }
                } else if current == "taskList" { throw RichTextError.invalidDocument }
                item["type"] = .string(kind == "taskList" ? "taskItem" : "listItem")
                if kind == "taskList" { item["attrs"] = .object(["checked": .bool(false)]) } else { item.removeValue(forKey: "attrs") }
                items[index] = .object(item)
            }
            list["type"] = .string(kind); list["content"] = .array(items)
        }
    }

    public mutating func toggleTaskItem(at path: RichTextPath) throws {
        guard path.indices.count >= 4 else { throw RichTextError.invalidPath }
        let taskPath = Array(path.indices.prefix(2))
        try toggleTaskItemNode(at: RichTextPath(taskPath))
    }

    /// Lift the last simple nested item into the end of its parent list.
    /// Restricting both insertions to the end avoids shifting opaque siblings.
    public mutating func liftLastNestedItem(at path: RichTextPath) throws -> RichTextPath {
        let p = path.indices
        guard p.count >= 4, let nestedItemIndex = p.last else { throw RichTextError.invalidPath }
        let outerPath = Array(p.dropLast(3)), outerItemIndex = p[p.count - 3], nestedListIndex = p[p.count - 2]
        var destination: [Int] = []
        try updateNode(&source, path: ArraySlice(outerPath)) { outer in
            guard case .string(let kind)? = outer["type"], ["bulletList", "orderedList", "taskList"].contains(kind),
                  case .array(var outerItems)? = outer["content"], outerItems.indices.contains(outerItemIndex), outerItemIndex == outerItems.count - 1,
                  case .object(var parent) = outerItems[outerItemIndex], parent["type"] == .string(kind == "taskList" ? "taskItem" : "listItem"),
                  case .array(var parentContent)? = parent["content"], parentContent.count >= 2, parentContent.indices.contains(nestedListIndex),
                  case .object(let firstParagraph) = parentContent[0], firstParagraph["type"] == .string("paragraph"), nestedListIndex == parentContent.count - 1,
                  case .object(var nested) = parentContent[nestedListIndex], nested["type"] == .string(kind),
                  Set(nested.keys).isSubset(of: ["type", "attrs", "content"]),
                  case .array(var nestedItems)? = nested["content"], nestedItemIndex == nestedItems.count - 1,
                  nestedItems.indices.contains(nestedItemIndex), safeSimpleListItem(nestedItems[nestedItemIndex], kind: kind) else { throw RichTextError.invalidDocument }
            if let attrs = nested["attrs"] { guard attrs == .object([:]) else { throw RichTextError.invalidDocument } }
            if case .object(let item) = nestedItems[nestedItemIndex], item["attrs"] == .null { throw RichTextError.invalidDocument }
            let lifted = nestedItems.removeLast()
            if nestedItems.isEmpty { parentContent.removeLast() }
            else { nested["content"] = .array(nestedItems); parentContent[nestedListIndex] = .object(nested) }
            parent["content"] = .array(parentContent); outerItems[outerItemIndex] = .object(parent)
            destination = outerPath + [outerItems.count]
            outerItems.append(lifted); outer["content"] = .array(outerItems)
        }
        return RichTextPath(destination)
    }
    public mutating func toggleTaskItemNode(at path: RichTextPath) throws {
        guard path.indices.count >= 2 else { throw RichTextError.invalidPath }
        try updateNode(&source, path: ArraySlice(path.indices)) { node in
            guard node["type"] == .string("taskItem"), case .object(var attrs)? = node["attrs"],
                  case .bool(let checked)? = attrs["checked"] else { throw RichTextError.invalidDocument }
            attrs["checked"] = .bool(!checked); node["attrs"] = .object(attrs)
        }
    }

    /// Append a new item without relocating existing sibling paths. Nested
    /// lists are appended to the selected item or to its final matching list.
    public mutating func appendListItem(after path: RichTextPath, text: String, nested: Bool) throws -> RichTextPath {
        guard path.indices.count >= 2, let index = path.indices.last,
              text.utf8.count <= 64 * 1024, !text.contains("\n"), !text.contains("\r"), !text.contains("\u{fffc}") else { throw RichTextError.invalidRange }
        let parent = Array(path.indices.dropLast())
        var output: [Int] = []
        try updateNode(&source, path: ArraySlice(parent)) { list in
            guard case .string(let kind)? = list["type"], ["bulletList", "orderedList", "taskList"].contains(kind),
                  case .array(var items)? = list["content"], items.indices.contains(index),
                  case .object(var item) = items[index], item["type"] == .string(kind == "taskList" ? "taskItem" : "listItem") else { throw RichTextError.invalidDocument }
            let paragraphContent: [JSONValue] = text.isEmpty ? [] : [.object(["type": .string("text"), "text": .string(text)])]
            var newItem: [String: JSONValue] = ["type": .string(kind == "taskList" ? "taskItem" : "listItem"),
                "content": .array([.object(["type": .string("paragraph"), "content": .array(paragraphContent)])])]
            if kind == "taskList" { newItem["attrs"] = .object(["checked": .bool(false)]) }
            if nested {
                guard case .array(var content)? = item["content"] else { throw RichTextError.invalidDocument }
                if let last = content.indices.last, case .object(var sublist) = content[last], sublist["type"] == .string(kind) {
                    guard case .array(var subitems)? = sublist["content"] else { throw RichTextError.invalidDocument }
                    output = path.indices + [last, subitems.count]
                    subitems.append(.object(newItem)); sublist["content"] = .array(subitems); content[last] = .object(sublist)
                } else {
                    output = path.indices + [content.count, 0]
                    content.append(.object(["type": .string(kind), "content": .array([.object(newItem)])]))
                }
                item["content"] = .array(content); items[index] = .object(item)
            } else {
                guard index == items.count - 1 else { throw RichTextError.invalidDocument }
                output = parent + [items.count]; items.append(.object(newItem))
            }
            list["content"] = .array(items)
        }
        return RichTextPath(output)
    }

    /// Split a simple list item at a UTF-16 caret. Unknown sibling data or
    /// nested structures are rejected because insertion would shift paths.
    public mutating func splitListItem(at textPath: RichTextPath, offset: Int) throws {
        let path = textPath.indices
        guard path.count >= 4, path[path.count - 2] == 0 else { throw RichTextError.invalidPath }
        let listPath = Array(path.dropLast(3)), itemIndex = path[path.count - 3], textIndex = path.last!
        try updateNode(&source, path: ArraySlice(listPath)) { list in
            guard case .string(let kind)? = list["type"], ["bulletList", "orderedList", "taskList"].contains(kind),
                  case .array(var items)? = list["content"], items.indices.contains(itemIndex),
                  items.allSatisfy({ safeSimpleListItem($0, kind: kind) }),
                  case .object(var item) = items[itemIndex], case .array(var content)? = item["content"],
                  case .object(var paragraph) = content[0], case .array(let runs)? = paragraph["content"],
                  runs.indices.contains(textIndex), case .object(let textNode) = runs[textIndex], case .string(let text)? = textNode["text"],
                  offset >= 0, offset <= text.utf16.count,
                  let offset16 = text.utf16.index(text.utf16.startIndex, offsetBy: offset, limitedBy: text.utf16.endIndex),
                  let point = String.Index(offset16, within: text) else { throw RichTextError.invalidDocument }
            var left = Array(runs[..<textIndex]), right: [JSONValue] = []
            if point > text.startIndex { var value = textNode; value["text"] = .string(String(text[..<point])); left.append(.object(value)) }
            if point < text.endIndex { var value = textNode; value["text"] = .string(String(text[point...])); right.append(.object(value)) }
            right.append(contentsOf: runs.dropFirst(textIndex + 1))
            var nextParagraph = paragraph; paragraph["content"] = .array(left); nextParagraph["content"] = .array(right)
            content[0] = .object(paragraph); item["content"] = .array(content); items[itemIndex] = .object(item)
            var newItem = item; newItem["content"] = .array([.object(nextParagraph)])
            if kind == "taskList" { newItem["attrs"] = .object(["checked": .bool(false)]) }
            items.insert(.object(newItem), at: itemIndex + 1); list["content"] = .array(items)
        }
    }
    /// Merge at an item boundary only when both task states and all moved
    /// content are known; the operation is one atomic document mutation.
    public mutating func mergeListItem(at itemPath: RichTextPath) throws {
        guard itemPath.indices.count >= 2, let index = itemPath.indices.last, index > 0 else { throw RichTextError.invalidPath }
        try updateNode(&source, path: ArraySlice(itemPath.indices.dropLast())) { list in
            guard case .string(let kind)? = list["type"], ["bulletList", "orderedList", "taskList"].contains(kind),
                  case .array(var items)? = list["content"], items.indices.contains(index),
                  items.allSatisfy({ safeSimpleListItem($0, kind: kind) }),
                  case .object(var left) = items[index - 1], case .object(let right) = items[index],
                  left["attrs"] == right["attrs"], case .array(var leftContent)? = left["content"],
                  case .array(let rightContent)? = right["content"], case .object(var leftParagraph) = leftContent[0],
                  case .object(let rightParagraph) = rightContent[0], case .array(var leftRuns)? = leftParagraph["content"],
                  case .array(let rightRuns)? = rightParagraph["content"] else { throw RichTextError.invalidDocument }
            leftRuns.append(contentsOf: rightRuns); leftParagraph["content"] = .array(leftRuns); leftContent[0] = .object(leftParagraph)
            left["content"] = .array(leftContent); items[index - 1] = .object(left); items.remove(at: index); list["content"] = .array(items)
        }
    }
    public mutating func insertIntoEmptyListItem(at itemPath: RichTextPath, text: String) throws {
        guard !text.isEmpty, !text.contains("\n"), !text.contains("\r"), !text.contains("\u{fffc}") else { throw RichTextError.invalidRange }
        try updateNode(&source, path: ArraySlice(itemPath.indices)) { item in
            guard case .string(let type)? = item["type"], ["listItem", "taskItem"].contains(type),
                  case .array(var content)? = item["content"], let first = content.first, case .object(var paragraph) = first,
                  paragraph["type"] == .string("paragraph"), case .array(let runs)? = paragraph["content"] else { throw RichTextError.invalidDocument }
            if runs.isEmpty {
                paragraph["content"] = .array([.object(["type": .string("text"), "text": .string(text)])])
            } else {
                guard runs.count == 1, case .object(var node) = runs[0], node["type"] == .string("text"), node["text"] == .string("") else { throw RichTextError.invalidDocument }
                node["text"] = .string(text); paragraph["content"] = .array([.object(node)])
            }
            content[0] = .object(paragraph); item["content"] = .array(content)
        }
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

    /// Split one plain text node to apply a mark to a UTF-16 selection. Refuse
    /// opaque siblings or marks rather than moving their protected paths.
    public mutating func togglePartialMark(at path: RichTextPath, range: NSRange, mark: String) throws {
        guard ["bold", "italic", "underline", "strike"].contains(mark), let index = path.indices.last,
              path.indices.count >= 2, range.location != NSNotFound, range.location >= 0, range.length > 0 else { throw RichTextError.invalidRange }
        let parent = Array(path.indices.dropLast())
        try updateNode(&source, path: ArraySlice(parent)) { node in
            guard case .string(let type)? = node["type"], ["paragraph", "heading"].contains(type),
                  case .array(var children)? = node["content"], children.indices.contains(index) else { throw RichTextError.invalidPath }
            let known: Set<String> = ["bold", "italic", "underline", "strike"]
            for child in children {
                guard case .object(let object) = child, Set(object.keys).isSubset(of: ["type", "text", "marks"]),
                      object["type"] == .string("text"), case .string(_)? = object["text"] else { throw RichTextError.invalidDocument }
                if let marks = object["marks"] {
                    guard case .array(let values) = marks, values.allSatisfy({ value in
                        guard case .object(let m) = value, Set(m.keys) == Set(["type"]), case .string(let name)? = m["type"] else { return false }
                        return known.contains(name)
                    }) else { throw RichTextError.invalidDocument }
                }
            }
            guard case .object(let selected) = children[index], case .string(let text)? = selected["text"],
                  range.location <= text.utf16.count, range.length <= text.utf16.count - range.location,
                  let lo16 = text.utf16.index(text.utf16.startIndex, offsetBy: range.location, limitedBy: text.utf16.endIndex),
                  let hi16 = text.utf16.index(lo16, offsetBy: range.length, limitedBy: text.utf16.endIndex),
                  let lo = String.Index(lo16, within: text), let hi = String.Index(hi16, within: text) else { throw RichTextError.invalidRange }
            var marks: [JSONValue] = []
            if case .array(let values)? = selected["marks"] { marks = values }
            let markValue: JSONValue = .object(["type": .string(mark)])
            var newMarks = marks
            if newMarks.contains(markValue) { newMarks.removeAll { $0 == markValue } } else { newMarks.append(markValue) }
            func fragment(_ text: Substring, _ marks: [JSONValue]) -> JSONValue? {
                guard !text.isEmpty else { return nil }
                var value: [String: JSONValue] = ["type": .string("text"), "text": .string(String(text))]
                if !marks.isEmpty { value["marks"] = .array(marks) }
                return .object(value)
            }
            let parts = [fragment(text[..<lo], marks), fragment(text[lo..<hi], newMarks), fragment(text[hi...], marks)].compactMap { $0 }
            children.replaceSubrange(index...index, with: parts)
            node["content"] = .array(children)
        }
    }

    /// Applies one formatting operation to adjacent text runs in one paragraph.
    /// The full parent is checked before mutation to avoid shifting opaque data.
    public mutating func toggleMarkAcrossRuns(_ selections: [(path: RichTextPath, range: NSRange)], mark: String) throws {
        guard ["bold", "italic", "underline", "strike"].contains(mark), !selections.isEmpty,
              let first = selections.first, first.path.indices.count >= 2 else { throw RichTextError.invalidRange }
        let parent = Array(first.path.indices.dropLast())
        let indices = selections.compactMap { $0.path.indices.last }
        guard indices.count == selections.count, Set(indices).count == indices.count,
              zip(indices, indices.dropFirst()).allSatisfy({ pair in pair.1 == pair.0 + 1 }),
              selections.allSatisfy({ Array($0.path.indices.dropLast()) == parent && $0.range.location != NSNotFound && $0.range.location >= 0 && $0.range.length > 0 }) else { throw RichTextError.invalidRange }
        try updateNode(&source, path: ArraySlice(parent)) { node in
            guard case .string(let type)? = node["type"], ["paragraph", "heading"].contains(type),
                  case .array(var children)? = node["content"], indices.allSatisfy({ children.indices.contains($0) }) else { throw RichTextError.invalidPath }
            let known: Set<String> = ["bold", "italic", "underline", "strike"]
            for child in children {
                guard case .object(let object) = child, Set(object.keys).isSubset(of: ["type", "text", "marks"]),
                      object["type"] == .string("text"), case .string(_)? = object["text"] else { throw RichTextError.invalidDocument }
                if let marks = object["marks"] {
                    guard case .array(let values) = marks, values.allSatisfy({ value in
                        guard case .object(let m) = value, Set(m.keys) == Set(["type"]), case .string(let name)? = m["type"] else { return false }
                        return known.contains(name)
                    }) else { throw RichTextError.invalidDocument }
                }
            }
            let target: JSONValue = .object(["type": .string(mark)])
            let allMarked = indices.allSatisfy { index in
                guard case .object(let object) = children[index], case .array(let values)? = object["marks"] else { return false }
                return values.contains(target)
            }
            for (offset, selection) in selections.enumerated().reversed() {
                let index = indices[offset]
                guard case .object(let selected) = children[index], case .string(let text)? = selected["text"],
                      selection.range.location <= text.utf16.count, selection.range.length <= text.utf16.count - selection.range.location,
                      let lo16 = text.utf16.index(text.utf16.startIndex, offsetBy: selection.range.location, limitedBy: text.utf16.endIndex),
                      let hi16 = text.utf16.index(lo16, offsetBy: selection.range.length, limitedBy: text.utf16.endIndex),
                      let lo = String.Index(lo16, within: text), let hi = String.Index(hi16, within: text) else { throw RichTextError.invalidRange }
                var original: [JSONValue] = []
                if case .array(let values)? = selected["marks"] { original = values }
                var changed = original.filter { $0 != target }
                if !allMarked { changed.append(target) }
                func fragment(_ value: Substring, _ marks: [JSONValue]) -> JSONValue? {
                    guard !value.isEmpty else { return nil }
                    var result: [String: JSONValue] = ["type": .string("text"), "text": .string(String(value))]
                    if !marks.isEmpty { result["marks"] = .array(marks) }
                    return .object(result)
                }
                children.replaceSubrange(index...index, with: [fragment(text[..<lo], original), fragment(text[lo..<hi], changed), fragment(text[hi...], original)].compactMap { $0 })
            }
            node["content"] = .array(children)
        }
    }
    public mutating func setLinkAcrossRuns(_ selections: [(path: RichTextPath, range: NSRange)], href: String?) throws {
        guard href.map(RichLinkSafety.isAllowed) ?? true, let first = selections.first, first.path.indices.count >= 2 else { throw RichTextError.invalidRange }
        let parent = Array(first.path.indices.dropLast()), indices = selections.compactMap { $0.path.indices.last }
        guard indices.count == selections.count, Set(indices).count == indices.count,
              zip(indices, indices.dropFirst()).allSatisfy({ $0.1 == $0.0 + 1 }),
              selections.allSatisfy({ Array($0.path.indices.dropLast()) == parent && $0.range.location != NSNotFound && $0.range.location >= 0 && $0.range.length > 0 }) else { throw RichTextError.invalidRange }
        try updateNode(&source, path: ArraySlice(parent)) { node in
            guard case .string(let type)? = node["type"], ["paragraph", "heading"].contains(type),
                  case .array(var children)? = node["content"], indices.allSatisfy({ children.indices.contains($0) }) else { throw RichTextError.invalidPath }
            for child in children {
                guard case .object(let object) = child, Set(object.keys).isSubset(of: ["type", "text", "marks"]),
                      object["type"] == .string("text"), case .string(_)? = object["text"] else { throw RichTextError.invalidDocument }
                if let marks = object["marks"] {
                    guard case .array(let values) = marks else { throw RichTextError.invalidDocument }
                    var links = 0
                    for value in values {
                        guard case .object(let mark) = value, case .string(let name)? = mark["type"] else { throw RichTextError.invalidDocument }
                        if name == "link" {
                            links += 1
                            guard Set(mark.keys) == Set(["type", "attrs"]), case .object(let attrs)? = mark["attrs"],
                                  Set(attrs.keys) == Set(["href"]), case .string(let value)? = attrs["href"], RichLinkSafety.isAllowed(value) else { throw RichTextError.invalidDocument }
                        } else if !["bold", "italic", "underline", "strike"].contains(name) || Set(mark.keys) != Set(["type"]) { throw RichTextError.invalidDocument }
                    }
                    guard links <= 1 else { throw RichTextError.invalidDocument }
                }
            }
            for (offset, selection) in selections.enumerated().reversed() {
                let index = indices[offset]
                guard case .object(let selected) = children[index], case .string(let text)? = selected["text"],
                      selection.range.location <= text.utf16.count, selection.range.length <= text.utf16.count - selection.range.location,
                      let lo16 = text.utf16.index(text.utf16.startIndex, offsetBy: selection.range.location, limitedBy: text.utf16.endIndex),
                      let hi16 = text.utf16.index(lo16, offsetBy: selection.range.length, limitedBy: text.utf16.endIndex),
                      let lo = String.Index(lo16, within: text), let hi = String.Index(hi16, within: text) else { throw RichTextError.invalidRange }
                var marks: [JSONValue] = []; if case .array(let values)? = selected["marks"] { marks = values }
                var changed = marks.filter { value in if case .object(let m) = value { return m["type"] != .string("link") }; return true }
                if let href { changed.append(.object(["type": .string("link"), "attrs": .object(["href": .string(href)])])) }
                func fragment(_ value: Substring, _ marks: [JSONValue]) -> JSONValue? {
                    guard !value.isEmpty else { return nil }
                    var result: [String: JSONValue] = ["type": .string("text"), "text": .string(String(value))]
                    if !marks.isEmpty { result["marks"] = .array(marks) }; return .object(result)
                }
                children.replaceSubrange(index...index, with: [fragment(text[..<lo], marks), fragment(text[lo..<hi], changed), fragment(text[hi...], marks)].compactMap { $0 })
            }
            node["content"] = .array(children)
        }
    }
}

private func safeSimpleListItem(_ value: JSONValue, kind: String) -> Bool {
    guard case .object(let item) = value, item["type"] == .string(kind == "taskList" ? "taskItem" : "listItem"),
          Set(item.keys).isSubset(of: ["type", "attrs", "content"]), case .array(let content)? = item["content"], content.count == 1,
          case .object(let paragraph) = content[0], paragraph["type"] == .string("paragraph"),
          Set(paragraph.keys).isSubset(of: ["type", "content"]), case .array(let runs)? = paragraph["content"] else { return false }
    if let attrs = item["attrs"], attrs != .null {
        guard case .object(let fields) = attrs else { return false }
        if kind == "taskList" {
            guard Set(fields.keys) == Set(["checked"]), case .bool(_)? = fields["checked"] else { return false }
        } else if !fields.isEmpty { return false }
    } else if kind == "taskList" { return false }
    return runs.allSatisfy { value in
        guard case .object(let node) = value, node["type"] == .string("text"), Set(node.keys).isSubset(of: ["type", "text", "marks"]), case .string(_)? = node["text"] else { return false }
        guard let marks = node["marks"] else { return true }
        guard case .array(let entries) = marks else { return false }
        return entries.allSatisfy { entry in
            guard case .object(let mark) = entry, Set(mark.keys) == Set(["type"]), case .string(let name)? = mark["type"] else { return false }
            return ["bold", "italic", "underline", "strike"].contains(name)
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
                else if ["doc", "bulletList", "orderedList", "taskList", "table", "listItem", "taskItem", "blockquote", "tableCell", "tableHeader"].contains(type) { text += "\n" }
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
                    if case .object(let attrs)? = value["attrs"], case .string(let href)? = attrs["href"], RichLinkSafety.isAllowed(href), let url = URL(string: href) {
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
            if bold || span.blockType == "heading" { traits.insert(.boldFontMask) }
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



