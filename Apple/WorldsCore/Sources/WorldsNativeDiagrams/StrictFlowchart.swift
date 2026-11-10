import Foundation

public enum StrictFlowchartError: Error, Equatable, Sendable {
    case empty, tooLarge, unsupportedHeader, unsupportedStatement(Int), conflictingLabel(Int), tooManyElements, cycle, unsupportedEdgeSpan
}
public struct FlowchartNode: Equatable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public let depth: Int
    public let row: Int
}
public struct FlowchartEdge: Equatable, Sendable { public let from: String; public let to: String }
public struct StrictFlowchart: Equatable, Sendable {
    public enum Direction: Equatable, Sendable { case leftToRight, topToBottom }
    public let direction: Direction
    public let nodes: [FlowchartNode]
    public let edges: [FlowchartEdge]
}

/// A deliberately strict subset. Every nonempty line must be fully consumed.
/// Unknown directives, labels on edges, styling and shapes are never ignored.
public enum StrictFlowchartParser {
    private struct Item { let id: String; let label: String? }
    public static func parse(_ source: String) throws -> StrictFlowchart {
        guard !source.isEmpty else { throw StrictFlowchartError.empty }
        guard source.utf8.count <= 64 * 1024 else { throw StrictFlowchartError.tooLarge }
        let lines = source.components(separatedBy: .newlines)
        guard let first = lines.firstIndex(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) else { throw StrictFlowchartError.empty }
        let header = lines[first].split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        guard header.count == 2, ["flowchart", "graph"].contains(header[0]) else { throw StrictFlowchartError.unsupportedHeader }
        let direction: StrictFlowchart.Direction
        switch header[1] { case "LR": direction = .leftToRight; case "TD", "TB": direction = .topToBottom; default: throw StrictFlowchartError.unsupportedHeader }
        let regex = try NSRegularExpression(pattern: #"^([A-Za-z_][A-Za-z0-9_]{0,63})(?:\[([^\[\]\r\n]{1,80})\])?$"#)
        var ids: [String] = [], labels: [String: String] = [:], explicit: [String: String] = [:]
        var edges: [FlowchartEdge] = [], edgeKeys = Set<String>()
        let reserved: Set<String> = ["style", "class", "classDef", "click", "linkStyle", "subgraph", "end", "direction"]
        func item(_ raw: String, line: Int) throws -> Item {
            let value = raw.trimmingCharacters(in: .whitespaces)
            let range = NSRange(value.startIndex..<value.endIndex, in: value)
            guard let match = regex.firstMatch(in: value, range: range), match.range == range,
                  let idRange = Range(match.range(at: 1), in: value) else { throw StrictFlowchartError.unsupportedStatement(line) }
            let id = String(value[idRange]); guard !reserved.contains(id) else { throw StrictFlowchartError.unsupportedStatement(line) }
            var label: String?
            if let labelRange = Range(match.range(at: 2), in: value) {
                let text = String(value[labelRange])
                guard text.count <= 40, !text.trimmingCharacters(in: .whitespaces).isEmpty,
                      text.rangeOfCharacter(from: .controlCharacters) == nil,
                      text.rangeOfCharacter(from: CharacterSet(charactersIn: "<>&\\\"'`{}|;")) == nil else { throw StrictFlowchartError.unsupportedStatement(line) }
                label = text
            }
            return Item(id: id, label: label)
        }
        func add(_ item: Item, line: Int) throws {
            if labels[item.id] == nil { ids.append(item.id); labels[item.id] = item.id }
            if let label = item.label {
                if let old = explicit[item.id], old != label { throw StrictFlowchartError.conflictingLabel(line) }
                explicit[item.id] = label; labels[item.id] = label
            }
            guard ids.count <= 32 else { throw StrictFlowchartError.tooManyElements }
        }
        for (offset, raw) in lines.enumerated() where offset > first {
            let value = raw.trimmingCharacters(in: .whitespaces)
            if value.isEmpty { continue }
            let segments = value.components(separatedBy: "-->")
            guard !segments.isEmpty, segments.count <= 65 else { throw StrictFlowchartError.tooManyElements }
            let items = try segments.map { try item($0, line: offset + 1) }
            for value in items { try add(value, line: offset + 1) }
            for (left, right) in zip(items, items.dropFirst()) {
                let key = left.id + "\\0" + right.id
                guard edgeKeys.insert(key).inserted else { throw StrictFlowchartError.unsupportedStatement(offset + 1) }
                edges.append(FlowchartEdge(from: left.id, to: right.id))
                guard edges.count <= 64 else { throw StrictFlowchartError.tooManyElements }
            }
        }
        guard !ids.isEmpty else { throw StrictFlowchartError.empty }
        var indegree = Dictionary(uniqueKeysWithValues: ids.map { ($0, 0) })
        var depth = Dictionary(uniqueKeysWithValues: ids.map { ($0, 0) })
        var outgoing: [String: [String]] = [:]
        for edge in edges { indegree[edge.to, default: 0] += 1; outgoing[edge.from, default: []].append(edge.to) }
        var queue = ids.filter { indegree[$0] == 0 }, index = 0
        while index < queue.count {
            let node = queue[index]; index += 1
            for target in outgoing[node, default: []] {
                depth[target] = max(depth[target, default: 0], depth[node, default: 0] + 1)
                indegree[target, default: 0] -= 1
                if indegree[target] == 0 { queue.append(target) }
            }
        }
        guard queue.count == ids.count else { throw StrictFlowchartError.cycle }
        guard depth.values.allSatisfy({ $0 < 8 }) else { throw StrictFlowchartError.tooManyElements }
        guard edges.allSatisfy({ depth[$0.to, default: 0] == depth[$0.from, default: 0] + 1 }) else { throw StrictFlowchartError.unsupportedEdgeSpan }
        var rows: [Int: Int] = [:]
        let nodes = ids.map { id in
            let level = depth[id, default: 0], row = rows[level, default: 0]
            rows[level] = row + 1
            return FlowchartNode(id: id, label: labels[id] ?? id, depth: level, row: row)
        }
        guard rows.values.allSatisfy({ $0 <= 6 }) else { throw StrictFlowchartError.tooManyElements }
        return StrictFlowchart(direction: direction, nodes: nodes, edges: edges)
    }
}
