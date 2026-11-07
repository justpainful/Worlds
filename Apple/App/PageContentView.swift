import SwiftUI
import WorldsPersistence

/// Read-only rendering does not rewrite or normalize the stored JSON.
private struct PageNode: Decodable {
    struct Attributes: Decodable {
        let level: Int?
        let start: Int?
        let href: String?
        let checked: Bool?
    }
    struct Mark: Decodable {
        let type: String
        let attrs: Attributes?
    }
    let type: String?
    let text: String?
    let attrs: Attributes?
    let marks: [Mark]?
    let content: [PageNode]?
}

struct PageContentView: View {
    let page: StoredPage

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(page.title.isEmpty ? "Untitled" : page.title)
                    .font(.title.weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if page.blocks.isEmpty {
                    Text("This page has no content.")
                        .foregroundStyle(.secondary)
                }
                ForEach(page.blocks, id: \.id) { block in
                    if let data = block.contentJSON.data(using: .utf8),
                       let node = try? JSONDecoder().decode(PageNode.self, from: data) {
                        NodeView(node: node)
                            .environment(\.layoutDirection, block.direction == "rtl" ? .rightToLeft : .leftToRight)
                    } else {
                        UnsupportedNodeView(name: block.type)
                    }
                }
                Text("Read only")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .worldsGlass()
            }
            .padding(24)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        #if os(macOS)
        .navigationTitle(page.title.isEmpty ? "Untitled" : page.title)
        #else
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

private struct NodeView: View {
    let node: PageNode

    @ViewBuilder
    var body: some View {
        switch node.type {
        case "paragraph":
            Text(inlineContent(node))
                .font(.body)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        case "heading":
            Text(inlineContent(node))
                .font(headingFont(node.attrs?.level))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        case "bulletList", "orderedList":
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array((node.content ?? []).enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .top, spacing: 8) {
                        Text(node.type == "orderedList" ? "\((node.attrs?.start ?? 1) + index)." : "•")
                            .foregroundStyle(.secondary)
                        NodeView(node: item)
                    }
                }
            }
        case "taskList":
            children
        case "taskItem":
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: node.attrs?.checked == true ? "checkmark.square" : "square")
                    .accessibilityLabel(node.attrs?.checked == true ? "Completed" : "Not completed")
                children
            }
        case "listItem", "doc", "blockquote":
            children
        case "table":
            ScrollView(.horizontal) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array((node.content ?? []).enumerated()), id: \.offset) { _, row in
                        NodeView(node: row)
                    }
                }
            }
        case "tableRow":
            HStack(alignment: .top, spacing: 0) {
                ForEach(Array((node.content ?? []).enumerated()), id: \.offset) { _, cell in
                    NodeView(node: cell)
                        .frame(minWidth: 120, maxWidth: 280, alignment: .leading)
                        .padding(8)
                        .overlay { Rectangle().strokeBorder(.secondary.opacity(0.3), lineWidth: 0.5) }
                }
            }
        case "tableCell", "tableHeader":
            children
                .fontWeight(node.type == "tableHeader" ? .semibold : .regular)
        case "horizontalRule":
            Divider()
        case "codeBlock":
            Text(inlineContent(node))
                .font(.system(.body, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        default:
            UnsupportedNodeView(name: node.type ?? "unknown")
        }
    }

    private var children: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array((node.content ?? []).enumerated()), id: \.offset) { _, child in
                NodeView(node: child)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func headingFont(_ level: Int?) -> Font {
        switch level {
        case 1: return .title2.weight(.semibold)
        case 2: return .title3.weight(.semibold)
        default: return .headline
        }
    }
}

private struct UnsupportedNodeView: View {
    let name: String

    var body: some View {
        Label("Unsupported content: \(name)", systemImage: "doc.questionmark")
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private func inlineContent(_ node: PageNode) -> AttributedString {
    if node.type == "text" {
        var text = AttributedString(node.text ?? "")
        var intent: InlinePresentationIntent = []
        var unsupported: [String] = []
        for mark in node.marks ?? [] {
            switch mark.type {
            case "bold": intent.insert(.stronglyEmphasized)
            case "italic": intent.insert(.emphasized)
            case "strike": intent.insert(.strikethrough)
            case "code": intent.insert(.code)
            case "underline": text.underlineStyle = .single
            case "link":
                if let href = mark.attrs?.href, let url = URL(string: href),
                   ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                    text.link = url
                } else {
                    unsupported.append("link")
                }
            default:
                unsupported.append(mark.type)
            }
        }
        if !intent.isEmpty { text.inlinePresentationIntent = intent }
        if !unsupported.isEmpty {
            text.append(AttributedString(" [Unsupported formatting: \(unsupported.joined(separator: ", ") )]"))
        }
        return text
    }
    if node.type == "hardBreak" { return AttributedString("\n") }
    var result = AttributedString()
    for child in node.content ?? [] {
        if child.type == "text" || child.type == "hardBreak" {
            result.append(inlineContent(child))
        } else {
            result.append(AttributedString("[Unsupported content: \(child.type ?? "unknown")]") )
        }
    }
    return result
}
