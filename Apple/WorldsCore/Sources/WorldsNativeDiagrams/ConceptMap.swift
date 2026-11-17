import Foundation

/// A Mermaid flowchart read as concepts and links, the same way the desktop reads
/// it (src/editor/conceptMap.ts), so a concept map opens as the same world on
/// iPhone, iPad and Mac. Where each concept sits is kept in the diagram as
/// Mermaid comments (`%% view world`, `%% at C0 120 -40`); Mermaid ignores them.
public enum ConceptMapView: String, Equatable, Sendable { case world, diagram }

public struct ConceptMapNode: Equatable, Sendable, Identifiable {
    public let id: String
    public var label: String
    public var shape: String
}
public struct ConceptMapEdge: Equatable, Sendable {
    public let from: String
    public let to: String
    public let label: String
    public let style: String
}
public struct ConceptMapPoint: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public init(x: Double, y: Double) { self.x = x; self.y = y }
}

public struct ConceptMapGraph: Equatable, Sendable {
    public var direction: String
    public var nodes: [ConceptMapNode]
    public var edges: [ConceptMapEdge]
    public var positions: [String: ConceptMapPoint]
    public var view: ConceptMapView?
    /// Every statement was understood.
    public var simple: Bool
    /// A concept map is a flowchart whose links mostly carry a linking phrase.
    public var looksLikeConceptMap: Bool {
        !edges.isEmpty && edges.filter { !$0.label.trimmingCharacters(in: .whitespaces).isEmpty }.count * 2 >= edges.count
    }
    public var shownView: ConceptMapView { view ?? (looksLikeConceptMap ? .world : .diagram) }
}

public enum ConceptMapParser {
    private struct Shape { let name: String; let open: String; let close: String }
    private static let shapes: [Shape] = [
        Shape(name: "stadium", open: "([", close: "])"), Shape(name: "subroutine", open: "[[", close: "]]"),
        Shape(name: "cylinder", open: "[(", close: ")]"), Shape(name: "circle", open: "((", close: "))"),
        Shape(name: "hexagon", open: "{{", close: "}}"), Shape(name: "asym", open: ">", close: "]"),
        Shape(name: "round", open: "(", close: ")"), Shape(name: "rect", open: "[", close: "]"),
        Shape(name: "rhombus", open: "{", close: "}"),
    ]
    private static let reserved: Set<String> = ["subgraph", "end", "classdef", "class", "style", "linkstyle", "click", "direction"]

    /// The groups of an anchored match and the text after it, or nil.
    private static func match(_ pattern: String, _ text: String, caseless: Bool = false) -> (groups: [String], rest: String)? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: caseless ? [.caseInsensitive] : []) else { return nil }
        let ns = text as NSString
        guard let found = regex.firstMatch(in: text, options: [.anchored], range: NSRange(location: 0, length: ns.length)) else { return nil }
        let groups = (0..<found.numberOfRanges).map { index -> String in
            let range = found.range(at: index)
            return range.location == NSNotFound ? "" : ns.substring(with: range)
        }
        return (groups, ns.substring(from: found.range.location + found.range.length))
    }

    private static func unquote(_ text: String) -> String {
        let t = text.trimmingCharacters(in: .whitespaces)
        let q = t.count >= 2 && t.hasPrefix("\"") && t.hasSuffix("\"") ? String(t.dropFirst().dropLast()) : t
        return q.replacingOccurrences(of: "#quot;", with: "\"").replacingOccurrences(of: "#lt;", with: "<")
            .replacingOccurrences(of: "#gt;", with: ">").replacingOccurrences(of: "#35;", with: "#")
    }
    private static func stripClass(_ text: String) -> String { match(#":::[\w-]+"#, text)?.rest ?? text }

    private static func readNode(_ source: String) -> (node: ConceptMapNode, labelled: Bool, rest: String)? {
        guard let found = match(#"\s*([\p{L}\p{N}_][\p{L}\p{N}_]*)"#, source) else { return nil }
        let id = found.groups[1]
        var rest = found.rest
        for shape in shapes where rest.hasPrefix(shape.open) {
            var body = String(rest.dropFirst(shape.open.count))
            let label: String
            if body.drop(while: { $0 == " " || $0 == "\t" }).hasPrefix("\"") {
                guard let first = body.firstIndex(of: "\"") else { return nil }
                let start = body.index(after: first)
                guard let last = body[start...].firstIndex(of: "\"") else { return nil }
                label = String(body[start..<last])
                body = String(body[body.index(after: last)...])
                guard let close = body.range(of: shape.close),
                      body[..<close.lowerBound].trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
                rest = String(body[close.upperBound...])
            } else {
                guard let close = body.range(of: shape.close) else { return nil }
                label = String(body[..<close.lowerBound])
                rest = String(body[close.upperBound...])
            }
            return (ConceptMapNode(id: id, label: unquote(label), shape: shape.name), true, stripClass(rest))
        }
        return (ConceptMapNode(id: id, label: id, shape: "rect"), false, stripClass(rest))
    }

    private static func readOperator(_ source: String) -> (style: String, label: String, rest: String)? {
        if let text = match(#"\s*(--|==|-\.)\s+([^|]+?)\s+(-->|---|==>|===|-\.->|-\.-)"#, source) {
            let style = text.groups[1] == "==" ? "thick" : text.groups[1] == "-." ? "dotted" : text.groups[3].hasSuffix(">") ? "arrow" : "line"
            return (style, unquote(text.groups[2]), text.rest)
        }
        guard let op = match(#"\s*(<?)(-\.+-|--+|==+)(>|x|o)?\s*(?:\|([^|]*)\|)?"#, source) else { return nil }
        let body = op.groups[2]
        let style = body.hasPrefix("=") ? "thick" : body.contains(".") ? "dotted" : op.groups[3].isEmpty ? "line" : "arrow"
        return (style, unquote(op.groups[4]), op.rest)
    }

    /// A line split at the semicolons that end statements, not those inside a "label" or an entity like #quot;
    private static func statements(_ line: String) -> [String] {
        var out: [String] = [], current = "", quoted = false
        for character in line {
            if character == "\"" { quoted.toggle(); current.append(character) }
            else if character == ";" && !quoted && match(#".*#[A-Za-z0-9]+$"#, current) == nil { out.append(current); current = "" }
            else { current.append(character) }
        }
        out.append(current)
        return out
    }

    public static func parse(_ code: String) -> ConceptMapGraph? {
        guard code.utf8.count <= 256 * 1024 else { return nil }
        let lines = code.replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n")
        var index = 0
        while index < lines.count, lines[index].trimmingCharacters(in: .whitespaces).isEmpty || lines[index].trimmingCharacters(in: .whitespaces).hasPrefix("%%") { index += 1 }
        guard index < lines.count,
              let head = match(#"\s*(flowchart|graph)(?:\s+(TB|TD|BT|RL|LR))?\s*;?\s*$"#, lines[index], caseless: true) else { return nil }
        var graph = ConceptMapGraph(direction: head.groups[2].isEmpty ? "TD" : head.groups[2].uppercased(), nodes: [], edges: [], positions: [:], view: nil, simple: true)
        var known: [String: Int] = [:]
        func note(_ node: ConceptMapNode, labelled: Bool) {
            if let at = known[node.id] {
                if labelled { graph.nodes[at].label = node.label; graph.nodes[at].shape = node.shape }
            } else { known[node.id] = graph.nodes.count; graph.nodes.append(node) }
        }
        func comment(_ line: String) {
            let t = line.trimmingCharacters(in: .whitespaces)
            if let view = match(#"%%\s*view\s+(world|diagram)\s*$"#, t, caseless: true) {
                graph.view = view.groups[1].lowercased() == "world" ? .world : .diagram
            }
            if let at = match(#"%%\s*at\s+(\S+)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$"#, t, caseless: true),
               let x = Double(at.groups[2]), let y = Double(at.groups[3]) {
                graph.positions[at.groups[1]] = ConceptMapPoint(x: x, y: y)
            }
        }
        for line in lines[..<index] { comment(line) }
        for raw in lines[(index + 1)...] {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            if line.hasPrefix("%%") { comment(line); continue }
            for statement in statements(line) where !statement.trimmingCharacters(in: .whitespaces).isEmpty {
                guard let first = readNode(statement) else { graph.simple = false; break }
                note(first.node, labelled: first.labelled)
                var rest = first.rest, from = first.node.id
                while !rest.trimmingCharacters(in: .whitespaces).isEmpty {
                    guard let op = readOperator(rest) else { break }
                    guard let next = readNode(op.rest) else { rest = op.rest; graph.simple = false; break }
                    note(next.node, labelled: next.labelled)
                    graph.edges.append(ConceptMapEdge(from: from, to: next.node.id, label: op.label, style: op.style))
                    from = next.node.id
                    rest = next.rest
                }
                if !rest.trimmingCharacters(in: .whitespaces).isEmpty { graph.simple = false }
            }
            guard graph.nodes.count <= 400, graph.edges.count <= 800 else { return nil }
        }
        if graph.nodes.contains(where: { reserved.contains($0.id.lowercased()) }) { graph.simple = false }
        graph.positions = graph.positions.filter { known[$0.key] != nil }
        return graph.nodes.isEmpty ? nil : graph
    }

    /// Only the layout comments change; every other line stays exactly as written.
    public static func withLayout(_ code: String, view: ConceptMapView?, positions: [String: ConceptMapPoint], order: [String]) -> String {
        var kept = code.replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n")
            .filter { match(#"\s*%%\s*(view|at)\s"#, $0, caseless: true) == nil }
        while let last = kept.last, last.trimmingCharacters(in: .whitespaces).isEmpty { kept.removeLast() }
        var extra: [String] = []
        if let view { extra.append("%% view \(view.rawValue)") }
        for id in order { if let p = positions[id] { extra.append("%% at \(id) \(Int(p.x.rounded())) \(Int(p.y.rounded()))") } }
        return kept.joined(separator: "\n") + (extra.isEmpty ? "" : "\n" + extra.joined(separator: "\n"))
    }
}
