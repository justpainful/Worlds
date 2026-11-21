import Foundation
import WorldsModels

// Markdown for the assistant's tools. Apple has no Markdown import of its own,
// so this is a port of the constrained dialect in Android's `MarkdownImport.kt`
// and `MarkdownExport.kt` (themselves ports of the desktop's
// `content::from_markdown` and `content::to_markdown`): headings 1 to 3,
// paragraphs with line breaks, bullet, numbered and task lists, quotes,
// callouts and prompts, fenced code, rules, pipe tables, and inline bold,
// italic, strike, highlight, code, links and page mentions.

public enum AIMarkdownError: Error, Equatable, Sendable {
    case tooComplex
}

public enum AIMarkdownImport {
    public static let maxBytes = 8 * 1024 * 1024
    static let maxNodes = 100_000
    static let maxWork: Int64 = 50_000_000

    /// ProseMirror block nodes, without block ids.
    public static func parse(_ source: String) throws -> [JSONValue] {
        if source.utf8.count > maxBytes { throw AIMarkdownError.tooComplex }
        let nodes = try Parser().parse(source)
        for node in nodes where node.aiCompact.utf8.count > 1_000_000 { throw AIMarkdownError.tooComplex }
        return nodes
    }

    private final class Parser {
        private var nodes = 0
        private var work: Int64 = 0
        private static let delimiters: [([Character], String)] = [
            (Array("**"), "bold"), (Array("~~"), "strike"), (Array("=="), "highlight"), (Array("`"), "code"), (Array("*"), "italic"),
        ]

        private func count(_ value: [String: JSONValue]) throws -> JSONValue {
            nodes += 1
            if nodes > AIMarkdownImport.maxNodes { throw AIMarkdownError.tooComplex }
            return .object(value)
        }

        private func charge(_ amount: Int) throws {
            work += Int64(max(0, amount))
            if work > AIMarkdownImport.maxWork { throw AIMarkdownError.tooComplex }
        }

        private func text(_ value: String, marks: [JSONValue] = []) throws -> JSONValue {
            var node: [String: JSONValue] = ["type": .string("text"), "text": .string(value)]
            if !marks.isEmpty { node["marks"] = .array(marks) }
            return try count(node)
        }

        private func paragraph(_ inline: [JSONValue]) throws -> JSONValue {
            var node: [String: JSONValue] = ["type": .string("paragraph")]
            if !inline.isEmpty { node["content"] = .array(inline) }
            return try count(node)
        }

        private static func mark(_ type: String) -> JSONValue { .object(["type": .string(type)]) }

        private static func starts(_ source: [Character], with pattern: [Character], at index: Int) -> Bool {
            guard index >= 0, index + pattern.count <= source.count else { return false }
            for offset in 0..<pattern.count where source[index + offset] != pattern[offset] { return false }
            return true
        }

        private func find(_ pattern: [Character], in source: [Character], from: Int) throws -> Int {
            var found = -1
            if from >= 0 && !pattern.isEmpty {
                var index = from
                while index + pattern.count <= source.count {
                    if Self.starts(source, with: pattern, at: index) { found = index; break }
                    index += 1
                }
            }
            try charge(found < 0 ? source.count - from : found - from + pattern.count)
            return found
        }

        private func flush(_ buffer: inout String, into result: inout [JSONValue]) throws {
            if buffer.isEmpty { return }
            result.append(try text(buffer))
            buffer = ""
        }

        private static func adding(_ kind: String, to node: JSONValue) -> JSONValue {
            guard case .object(var object) = node, object["type"] == .string("text") else { return node }
            var marks = object["marks"]?.aiArray ?? []
            marks.append(mark(kind))
            object["marks"] = .array(marks)
            return .object(object)
        }

        func inline(_ source: [Character], depth: Int = 0) throws -> [JSONValue] {
            if depth > 32 { throw AIMarkdownError.tooComplex }
            var result: [JSONValue] = []
            var buffer = ""
            var i = 0
            let mention = Array("@["), mentionClose = Array("](page:"), close = Array(")"), linkClose = Array("](")
            while i < source.count {
                try charge(1)
                if Self.starts(source, with: mention, at: i) {
                    let middle = try find(mentionClose, in: source, from: i + 2)
                    if middle >= 0 {
                        let end = try find(close, in: source, from: middle + 7)
                        if end >= 0 {
                            try flush(&buffer, into: &result)
                            result.append(try count([
                                "type": .string("pageMention"),
                                "attrs": .object(["id": .string(String(source[(middle + 7)..<end])), "label": .string(String(source[(i + 2)..<middle]))]),
                            ]))
                            i = end + 1
                            continue
                        }
                    }
                }
                if source[i] == "[" {
                    let middle = try find(linkClose, in: source, from: i + 1)
                    if middle >= 0 {
                        let end = try find(close, in: source, from: middle + 2)
                        if end >= 0 {
                            let label = String(source[(i + 1)..<middle])
                            let href = String(source[(middle + 2)..<end])
                            if !label.isEmpty && !href.contains(" ") {
                                try flush(&buffer, into: &result)
                                result.append(try text(label, marks: [.object(["type": .string("link"), "attrs": .object(["href": .string(href)])])]))
                                i = end + 1
                                continue
                            }
                        }
                    }
                }
                var matched = false
                for (delimiter, kind) in Self.delimiters {
                    guard Self.starts(source, with: delimiter, at: i) else { continue }
                    let from = i + delimiter.count
                    let end = try find(delimiter, in: source, from: from)
                    if end <= from { continue }
                    try flush(&buffer, into: &result)
                    let inner = Array(source[from..<end])
                    if kind == "code" {
                        result.append(try text(String(inner), marks: [Self.mark(kind)]))
                    } else {
                        for child in try inline(inner, depth: depth + 1) { result.append(Self.adding(kind, to: child)) }
                    }
                    i = end + delimiter.count
                    matched = true
                    break
                }
                if matched { continue }
                buffer.append(source[i])
                i += 1
            }
            try flush(&buffer, into: &result)
            return result
        }

        private func inline(_ source: String) throws -> [JSONValue] { try inline(Array(source)) }

        private func flushParagraph(_ pending: inout [String], into blocks: inout [JSONValue]) throws {
            if pending.isEmpty { return }
            var values: [JSONValue] = []
            for (index, line) in pending.enumerated() {
                if index > 0 { values.append(try count(["type": .string("hardBreak")])) }
                values.append(contentsOf: try inline(line))
            }
            blocks.append(try paragraph(values))
            pending.removeAll()
        }

        func parse(_ source: String) throws -> [JSONValue] {
            let lines = try AIMarkdownImport.lines(source)
            var blocks: [JSONValue] = []
            var pending: [String] = []
            var i = 0
            while i < lines.count {
                try charge(1)
                let t = AIMarkdownImport.trim(lines[i])
                if t.isEmpty {
                    try flushParagraph(&pending, into: &blocks)
                    i += 1
                    continue
                }
                if t.hasPrefix("```") {
                    try flushParagraph(&pending, into: &blocks)
                    let language = AIMarkdownImport.trim(String(t.dropFirst(3)))
                    var code: [String] = []
                    i += 1
                    while i < lines.count && !AIMarkdownImport.trimStart(lines[i]).hasPrefix("```") {
                        code.append(lines[i])
                        i += 1
                    }
                    i += 1
                    var node: [String: JSONValue] = ["type": .string("codeBlock"), "attrs": .object(["language": .string(language)])]
                    let value = code.joined(separator: "\n")
                    if !value.isEmpty {
                        let child = try text(value)
                        node["content"] = .array([child])
                    }
                    blocks.append(try count(node))
                    continue
                }
                if t == "---" || t == "***" {
                    try flushParagraph(&pending, into: &blocks)
                    blocks.append(try count(["type": .string("horizontalRule")]))
                    i += 1
                    continue
                }
                if let heading = [("### ", 3), ("## ", 2), ("# ", 1)].first(where: { t.hasPrefix($0.0) }) {
                    try flushParagraph(&pending, into: &blocks)
                    var node: [String: JSONValue] = ["type": .string("heading"), "attrs": .object(["level": .integer(Int64(heading.1))])]
                    let value = try inline(String(t.dropFirst(heading.0.count)))
                    if !value.isEmpty { node["content"] = .array(value) }
                    blocks.append(try count(node))
                    i += 1
                    continue
                }
                if t.hasPrefix(">") {
                    try flushParagraph(&pending, into: &blocks)
                    var body: [String] = []
                    while i < lines.count && AIMarkdownImport.trimStart(lines[i]).hasPrefix(">") {
                        let stripped = String(AIMarkdownImport.trimStart(lines[i]).drop(while: { $0 == ">" }))
                        body.append(stripped.hasPrefix(" ") ? String(stripped.dropFirst()) : stripped)
                        i += 1
                    }
                    let first = body.first ?? ""
                    let firstCharacters = Array(first)
                    var end = -1
                    if first.hasPrefix("[!") {
                        var index = 2
                        while index < firstCharacters.count {
                            if firstCharacters[index] == "]" { end = index; break }
                            index += 1
                        }
                    }
                    if end >= 0 {
                        let tag = String(firstCharacters[2..<end]).lowercased()
                        let after = AIMarkdownImport.trim(String(firstCharacters[(end + 1)...]))
                        var rest: [String] = []
                        if !after.isEmpty { rest.append(after) }
                        rest.append(contentsOf: body.dropFirst())
                        var paragraphs: [JSONValue] = []
                        for line in rest { paragraphs.append(try paragraph(try inline(line))) }
                        if paragraphs.isEmpty { paragraphs.append(try paragraph([])) }
                        let type = tag == "prompt" ? "prompt" : "callout"
                        let attrs: JSONValue = tag == "prompt" ? .object(["label": .string("Prompt")]) : .object(["tone": .string(tag)])
                        blocks.append(try count(["type": .string(type), "attrs": attrs, "content": .array(paragraphs)]))
                    } else {
                        var paragraphs: [JSONValue] = []
                        for line in body { paragraphs.append(try paragraph(try inline(line))) }
                        blocks.append(try count(["type": .string("blockquote"), "content": .array(paragraphs)]))
                    }
                    continue
                }
                if t.hasPrefix("|") {
                    try flushParagraph(&pending, into: &blocks)
                    var rows: [[String]] = []
                    while i < lines.count && AIMarkdownImport.trimStart(lines[i]).hasPrefix("|") {
                        let inner = AIMarkdownImport.trim(lines[i]).trimmingCharacters(in: CharacterSet(charactersIn: "|"))
                        let cells = inner.components(separatedBy: "|").map { AIMarkdownImport.trim($0) }
                        let separator = cells.allSatisfy { cell in !cell.isEmpty && cell.allSatisfy { $0 == "-" || $0 == ":" } }
                        if !separator { rows.append(cells) }
                        i += 1
                    }
                    var tableRows: [JSONValue] = []
                    for (rowIndex, cells) in rows.enumerated() {
                        let cellType = rowIndex == 0 ? "tableHeader" : "tableCell"
                        var cellNodes: [JSONValue] = []
                        for cell in cells {
                            let content = try paragraph(try inline(cell))
                            cellNodes.append(try count(["type": .string(cellType), "content": .array([content])]))
                        }
                        tableRows.append(try count(["type": .string("tableRow"), "content": .array(cellNodes)]))
                    }
                    blocks.append(try count(["type": .string("table"), "content": .array(tableRows)]))
                    continue
                }
                if let kind = AIMarkdownImport.listKind(t) {
                    try flushParagraph(&pending, into: &blocks)
                    var items: [JSONValue] = []
                    while i < lines.count {
                        let line = AIMarkdownImport.trimStart(lines[i])
                        if AIMarkdownImport.listKind(line) != kind { break }
                        let characters = Array(line)
                        let checked = kind == "taskList" && characters.count > 3 && (characters[3] == "x" || characters[3] == "X")
                        let begin: Int
                        switch kind {
                        case "taskList": begin = 6
                        case "bulletList": begin = 2
                        default: begin = characters.prefix(while: { $0.isASCII && $0.isNumber }).count + 2
                        }
                        let content = begin <= characters.count ? String(characters[begin...]) : ""
                        let body = try paragraph(try inline(content))
                        var item: [String: JSONValue] = [
                            "type": .string(kind == "taskList" ? "taskItem" : "listItem"),
                            "content": .array([body]),
                        ]
                        if kind == "taskList" { item["attrs"] = .object(["checked": .bool(checked)]) }
                        items.append(try count(item))
                        i += 1
                    }
                    blocks.append(try count(["type": .string(kind), "content": .array(items)]))
                    continue
                }
                pending.append(t)
                i += 1
            }
            try flushParagraph(&pending, into: &blocks)
            return blocks
        }
    }

    static func listKind(_ value: String) -> String? {
        for prefix in ["- [ ]", "- [x]", "- [X]"] where value == prefix || value.hasPrefix(prefix + " ") { return "taskList" }
        if value == "-" || value == "*" || value.hasPrefix("- ") || value.hasPrefix("* ") { return "bulletList" }
        let digits = value.prefix(while: { $0.isASCII && $0.isNumber }).count
        if digits > 0 {
            let rest = value.dropFirst(digits)
            if rest == "." || rest.hasPrefix(". ") { return "orderedList" }
        }
        return nil
    }

    static func trimStart(_ value: String) -> String { String(value.drop(while: { $0.isWhitespace })) }

    static func trim(_ value: String) -> String {
        var result = Substring(value)
        while let first = result.first, first.isWhitespace { result.removeFirst() }
        while let last = result.last, last.isWhitespace { result.removeLast() }
        return String(result)
    }

    /// Lines split on "\n" like Rust's `str::lines`: a trailing newline adds no
    /// empty line and a "\r" before a newline is dropped.
    static func lines(_ value: String) throws -> [String] {
        if value.isEmpty { return [] }
        let endsWithNewline = value.unicodeScalars.last == "\n"
        var parts = value.unicodeScalars.split(separator: "\n", omittingEmptySubsequences: false).map { String(Substring($0)) }
        if endsWithNewline { parts.removeLast() }
        if parts.count > maxNodes { throw AIMarkdownError.tooComplex }
        for index in parts.indices where index < parts.count - 1 || endsWithNewline {
            if parts[index].unicodeScalars.last == "\r" { parts[index].unicodeScalars.removeLast() }
        }
        return parts
    }
}

/// Text projection matching the desktop's `content::to_markdown`, as Android's `MarkdownExport.kt`.
public enum AIMarkdownExport {
    public static func block(_ node: JSONValue) -> String {
        let kids = children(node)
        switch type(node) {
        case "paragraph":
            return inline(kids)
        case "heading":
            let level = min(max(attrs(node)?["level"]?.aiInt ?? 1, 1), 3)
            return String(repeating: "#", count: Int(level)) + " " + inline(kids)
        case "bulletList":
            return kids.map { "- " + item($0) }.joined(separator: "\n")
        case "orderedList":
            return kids.enumerated().map { "\($0.offset + 1). " + item($0.element) }.joined(separator: "\n")
        case "taskList":
            return kids.map { child in
                "- [" + (attrs(child)?["checked"] == .bool(true) ? "x" : " ") + "] " + item(child)
            }.joined(separator: "\n")
        case "blockquote":
            return kids.map { "> " + block($0) }.joined(separator: "\n")
        case "callout":
            return "> [!" + (attr(node, "tone") ?? "note") + "] " + kids.map { block($0) }.joined(separator: "\n> ")
        case "prompt":
            return "> [!prompt] " + kids.map { block($0) }.joined(separator: "\n> ")
        case "codeBlock":
            return "```" + (attr(node, "language") ?? "") + "\n" + AIPlainText.text(node) + "\n```"
        case "horizontalRule":
            return "---"
        case "table":
            var lines: [String] = []
            for (index, row) in kids.enumerated() {
                let cells = children(row).map { AIPlainText.text($0).replacingOccurrences(of: "|", with: "\\|") }
                lines.append("| " + cells.joined(separator: " | ") + " |")
                if index == 0 { lines.append("|" + cells.map { _ in "---" }.joined(separator: "|") + "|") }
            }
            return lines.joined(separator: "\n")
        case "image", "video":
            return "[\(type(node)): \(attr(node, "caption") ?? attr(node, "name") ?? "")]"
        case "file":
            return "[file: \(attr(node, "name") ?? "")]"
        case "pageLink":
            return "[subpage: @[\(attr(node, "title") ?? "")](page:\(attr(node, "pageId") ?? ""))]"
        case "embed":
            return "[embed: \(attr(node, "url") ?? "")]"
        case "discordMessage":
            return "[discord message: \(attr(node, "content") ?? "")]"
        case "schedule":
            return "[schedule: \(attr(node, "automationId") ?? "")]"
        case "columns", "column", "tabs":
            return kids.map { block($0) }.filter { !$0.isEmpty }.joined(separator: "\n\n")
        case "toggle":
            let head = kids.first.map { block($0) } ?? ""
            let body = kids.dropFirst().map { block($0) }
            return body.isEmpty ? "> [!toggle] \(head)" : "> [!toggle] \(head)\n> " + body.joined(separator: "\n> ")
        case "toc":
            return "[table of contents]"
        case "mathBlock":
            return "$$\n" + (attr(node, "latex") ?? "") + "\n$$"
        case "mermaid":
            return "```mermaid\n" + (attr(node, "code") ?? "") + "\n```"
        case "chart":
            let title = attr(node, "title") ?? ""
            return "[chart: " + (title.isEmpty ? "from a table" : title) + "]"
        case "tab":
            return "### " + (attr(node, "title") ?? "Tab") + "\n\n" + kids.map { block($0) }.filter { !$0.isEmpty }.joined(separator: "\n\n")
        case "gallery":
            return "[gallery: \(attrs(node)?["images"]?.aiArray?.count ?? 0) pictures]"
        case "collection":
            let title = attr(node, "title") ?? ""
            return "[collection: \(title.isEmpty ? "pages" : title) (\(attr(node, "source") ?? "children"), \(attr(node, "view") ?? "table") view)]"
        default:
            return AIPlainText.text(node)
        }
    }

    private static func item(_ node: JSONValue) -> String {
        children(node).map { child in
            if type(child) == "paragraph" { return inline(children(child)) }
            return lines(block(child)).map { "  " + $0 }.joined(separator: "\n")
        }.joined(separator: "\n")
    }

    private static func inline(_ nodes: [JSONValue]) -> String {
        var out = ""
        for node in nodes {
            switch type(node) {
            case "text":
                var text = node.aiObject?["text"]?.aiString ?? ""
                for mark in (node.aiObject?["marks"]?.aiArray ?? []).reversed() {
                    switch type(mark) {
                    case "bold": text = "**\(text)**"
                    case "italic": text = "*\(text)*"
                    case "strike": text = "~~\(text)~~"
                    case "code": text = "`\(text)`"
                    case "highlight": text = "==\(text)=="
                    case "link": text = "[\(text)](\(attr(mark, "href") ?? ""))"
                    default: break
                    }
                }
                out += text
            case "hardBreak":
                out += "\n"
            case "pageMention":
                out += "@[\(attr(node, "label") ?? "")](page:\(attr(node, "id") ?? ""))"
            case "mathInline":
                out += "$" + (attr(node, "latex") ?? "") + "$"
            default:
                out += inline(children(node))
            }
        }
        return out
    }

    private static func lines(_ value: String) -> [String] { (try? AIMarkdownImport.lines(value)) ?? [value] }
    static func type(_ node: JSONValue) -> String { node.aiObject?["type"]?.aiString ?? "paragraph" }
    static func attrs(_ node: JSONValue) -> [String: JSONValue]? { node.aiObject?["attrs"]?.aiObject }
    static func attr(_ node: JSONValue, _ key: String) -> String? { attrs(node)?[key]?.aiString }
    static func children(_ node: JSONValue) -> [JSONValue] { (node.aiObject?["content"]?.aiArray ?? []).filter { $0.aiObject != nil } }
}

/// Plain text of a node, as the desktop's `content::plain_text`.
public enum AIPlainText {
    public static func text(_ node: JSONValue) -> String {
        var out = ""
        collect(node, into: &out)
        return AIMarkdownImport.trim(out)
    }

    private static func collect(_ node: JSONValue, into out: inout String) {
        let attrs = AIMarkdownExport.attrs(node) ?? [:]
        func attr(_ name: String) -> String { attrs[name]?.aiString ?? "" }
        func appendSpaced(_ value: String, _ separator: String, _ out: inout String) {
            if value.isEmpty { return }
            if !out.isEmpty { out += separator }
            out += value
        }
        switch AIMarkdownExport.type(node) {
        case "text":
            out += node.aiObject?["text"]?.aiString ?? ""
        case "hardBreak":
            out += "\n"
        case "pageMention":
            out += "@" + attr("label")
        case "image", "video", "file":
            out += attr("caption")
            appendSpaced(attr("name"), " ", &out)
        case "pageLink":
            out += attr("title")
        case "slide":
            for element in attrs["elements"]?.aiArray ?? [] {
                appendSpaced(element.aiObject?["text"]?.aiString ?? "", "\n", &out)
            }
            let notes = attr("notes")
            if !notes.isEmpty { out += "\n" + notes }
        case "galleryItem":
            appendSpaced(attr("caption"), " ", &out)
            appendSpaced(attr("name"), " ", &out)
        case "embed":
            out += attr("url")
        case "discordMessage":
            out += attr("content")
        case "mathInline", "mathBlock":
            out += attr("latex")
        case "mermaid":
            out += attr("code")
        case "chart":
            out += attr("title")
        case "tab":
            out += attr("title")
            for child in AIMarkdownExport.children(node) {
                out += "\n"
                collect(child, into: &out)
            }
        default:
            let kids = AIMarkdownExport.children(node)
            let inlineTypes: Set<String> = ["text", "hardBreak", "pageMention", "mathInline"]
            let blockChildren = kids.contains { !inlineTypes.contains(AIMarkdownExport.type($0)) }
            for (index, child) in kids.enumerated() {
                if blockChildren && index > 0 { out += "\n" }
                collect(child, into: &out)
            }
        }
    }

    /// The text of a node with spaces between its paragraphs, for task items.
    public static func spaced(_ node: JSONValue) -> String {
        var out = ""
        func walk(_ value: JSONValue) {
            let type = AIMarkdownExport.type(value)
            if type == "text" { out += value.aiObject?["text"]?.aiString ?? "" }
            if type == "hardBreak" { out += " " }
            for child in AIMarkdownExport.children(value) {
                let childType = AIMarkdownExport.type(child)
                if !out.isEmpty && childType != "text" && childType != "hardBreak" && !out.hasSuffix(" ") { out += " " }
                walk(child)
            }
        }
        walk(node)
        return AIMarkdownImport.trim(out)
    }
}
