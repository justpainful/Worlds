import Foundation
import WorldsModels

public enum StructuralEditError: Error, Equatable, Sendable {
    case invalidRange, unsupportedStructure, incompatibleBlocks, unknownMetadata
}

extension RichTextDocument {
    /// Replaces a selection across text-only paragraphs under one supported
    /// parent. Opaque inline nodes and cross-container edits are rejected.
    /// Splits receive new block IDs; merges require matching non-ID metadata.
    public mutating func replaceParagraphSelection(_ range: NSRange, with replacement: String) throws {
        let projection = project()
        guard range.location != NSNotFound, range.location >= 0, range.length >= 0,
              range.location <= projection.text.utf16.count,
              range.length <= projection.text.utf16.count - range.location else { throw StructuralEditError.invalidRange }
        let end = range.location + range.length
        let candidates = projection.spans.filter { $0.path.indices.count >= 2 }
        guard let start = candidates.last(where: { $0.range.location <= range.location && NSMaxRange($0.range) >= range.location }),
              let finish = candidates.first(where: { $0.range.location <= end && NSMaxRange($0.range) >= end }) else { throw StructuralEditError.unsupportedStructure }
        let startPath = start.path.indices, endPath = finish.path.indices
        let parentPath = Array(startPath.dropLast(2))
        guard parentPath == Array(endPath.dropLast(2)),
              let firstBlock = startPath.dropLast().last, let lastBlock = endPath.dropLast().last,
              let firstChild = startPath.last, let lastChild = endPath.last,
              firstBlock <= lastBlock, firstBlock != lastBlock || firstChild <= lastChild,
              let container = valueAtPath(source, path: parentPath)?.objectForEdit,
              case .string(let parentType)? = container["type"],
              ["doc", "listItem", "taskItem", "tableCell", "tableHeader", "blockquote"].contains(parentType),
              case .array(var blocks)? = container["content"], lastBlock < blocks.count else { throw StructuralEditError.unsupportedStructure }
        let a = [firstBlock, firstChild], b = [lastBlock, lastChild]
        var selected: [[String: JSONValue]] = []
        for index in a[0]...b[0] {
            guard case .object(let block) = blocks[index], case .string("paragraph")? = block["type"],
                  case .array(let children)? = block["content"],
                  children.allSatisfy({ if case .object(let node) = $0, case .string("text")? = node["type"], case .string(_)? = node["text"] { return true }; return false }) else { throw StructuralEditError.unsupportedStructure }
            selected.append(block)
        }
        let reference = normalizedBlock(selected[0])
        guard selected.allSatisfy({ normalizedBlock($0) == reference }) else { throw StructuralEditError.incompatibleBlocks }
        guard case .array(let startChildren)? = selected.first?["content"], case .array(let endChildren)? = selected.last?["content"],
              a[1] < startChildren.count, b[1] < endChildren.count,
              case .object(let startNode) = startChildren[a[1]], case .string(let startText)? = startNode["text"],
              case .object(let endNode) = endChildren[b[1]], case .string(let endText)? = endNode["text"] else { throw StructuralEditError.unsupportedStructure }
        let localStart = range.location - start.range.location
        let localEnd = end - finish.range.location
        guard let leftIndex = utf16Index(startText, localStart), let rightIndex = utf16Index(endText, localEnd) else { throw StructuralEditError.invalidRange }
        if range.length == 0, !safeToSplit(startNode) { throw StructuralEditError.unknownMetadata }
        if range.length > 0 {
            for blockIndex in a[0]...b[0] {
                let children = selected[blockIndex - a[0]]["content"]!.arrayForEdit!
                let first = blockIndex == a[0] ? a[1] : 0
                let last = blockIndex == b[0] ? b[1] : children.count - 1
                if first <= last {
                    for index in first...last {
                        guard let node = children[index].objectForEdit, safeToReplace(node) else { throw StructuralEditError.unknownMetadata }
                    }
                }
            }
        }
        var prefix = Array(startChildren[..<a[1]])
        let left = String(startText[..<leftIndex])
        if !left.isEmpty { var node = startNode; node["text"] = .string(left); prefix.append(.object(node)) }
        var suffix: [JSONValue] = []
        let right = String(endText[rightIndex...])
        if !right.isEmpty { var node = endNode; node["text"] = .string(right); suffix.append(.object(node)) }
        suffix.append(contentsOf: endChildren.dropFirst(b[1] + 1))
        let lines = replacement.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").components(separatedBy: "\n")
        if lines.count > 1 || a[0] != b[0] {
            guard selected.allSatisfy(safeParagraphStructure) else { throw StructuralEditError.unknownMetadata }
        }
        var result: [JSONValue] = []
        for (index, line) in lines.enumerated() {
            var block = selected[0]
            if index > 0 {
                var attrs = block["attrs"]?.objectForEdit ?? [:]
                if parentType == "doc" || attrs["bid"] != nil {
                    attrs["bid"] = .string(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())
                    block["attrs"] = .object(attrs)
                }
            }
            var children: [JSONValue] = index == 0 ? prefix : []
            if !line.isEmpty {
                var inserted: [String: JSONValue] = ["type": .string("text"), "text": .string(line)]
                if let marks = startNode["marks"] { inserted["marks"] = marks }
                children.append(.object(inserted))
            }
            if index == lines.count - 1 { children.append(contentsOf: suffix) }
            block["content"] = .array(children)
            result.append(.object(block))
        }
        blocks.replaceSubrange(a[0]...b[0], with: result)
        var updated = source
        try replaceChildren(&updated, path: ArraySlice(parentPath), children: blocks)
        source = updated
    }
}

private extension JSONValue {
    var objectForEdit: [String: JSONValue]? { if case .object(let value) = self { return value }; return nil }
    var arrayForEdit: [JSONValue]? { if case .array(let value) = self { return value }; return nil }
}
private func utf16Index(_ value: String, _ offset: Int) -> String.Index? {
    guard offset >= 0, offset <= value.utf16.count,
          let index = value.utf16.index(value.utf16.startIndex, offsetBy: offset, limitedBy: value.utf16.endIndex) else { return nil }
    return String.Index(index, within: value)
}
private func normalizedBlock(_ block: [String: JSONValue]) -> [String: JSONValue] {
    var copy = block
    copy.removeValue(forKey: "content")
    if var attrs = copy["attrs"]?.objectForEdit { attrs.removeValue(forKey: "bid"); copy["attrs"] = .object(attrs) }
    return copy
}
private func safeToReplace(_ node: [String: JSONValue]) -> Bool {
    guard Set(node.keys).isSubset(of: ["type", "text", "marks"]) else { return false }
    guard let marks = node["marks"] else { return true }
    guard let list = marks.arrayForEdit else { return false }
    let known = Set(["bold", "italic", "underline", "strike", "code"])
    return list.allSatisfy { value in guard let object = value.objectForEdit, case .string(let name)? = object["type"] else { return false }; return known.contains(name) && Set(object.keys) == ["type"] }
}


private func valueAtPath(_ source: JSONValue, path: [Int]) -> JSONValue? {
    var value = source
    for index in path {
        guard let children = value.objectForEdit?["content"]?.arrayForEdit, index >= 0, index < children.count else { return nil }
        value = children[index]
    }
    return value
}
private func replaceChildren(_ source: inout JSONValue, path: ArraySlice<Int>, children: [JSONValue]) throws {
    guard var object = source.objectForEdit else { throw StructuralEditError.unsupportedStructure }
    if let index = path.first {
        guard var current = object["content"]?.arrayForEdit, index >= 0, index < current.count else { throw StructuralEditError.unsupportedStructure }
        try replaceChildren(&current[index], path: path.dropFirst(), children: children)
        object["content"] = .array(current)
    } else { object["content"] = .array(children) }
    source = .object(object)
}
private func safeToSplit(_ node: [String: JSONValue]) -> Bool {
    // Unknown marks may encode non-duplicable identity or semantics. Splitting
    // them without understanding their rules could corrupt data.
    return safeToReplace(node)
}


private func safeParagraphStructure(_ block: [String: JSONValue]) -> Bool {
    guard Set(block.keys).isSubset(of: ["type", "attrs", "content"]) else { return false }
    guard let attrs = block["attrs"] else { return true }
    if attrs == .null { return true }
    guard let object = attrs.objectForEdit else { return false }
    return Set(object.keys).isSubset(of: ["bid", "dir", "textAlign"])
}
