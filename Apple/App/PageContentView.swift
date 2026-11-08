import SwiftUI
import WorldsPersistence

/// Read-only rendering does not rewrite or normalize the stored JSON.
private struct PageNode: Decodable {
    struct ColorValue: Decodable {
        let value: String?
        init(from decoder: Decoder) throws { value = try? decoder.singleValueContainer().decode(String.self) }
    }
    struct Attributes: Decodable {
        let level: Int?
        let start: Int?
        let href: String?
        let checked: Bool?
        let open: Bool?
        let active: Int?
        let tone: String?
        let label: String?
        let title: String?
        let latex: String?
        let code: String?
        let dir: String?
        let textAlign: String?
        let pstyle: String?
        let color: ColorValue?
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
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
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
                            .environment(\.layoutDirection, direction(for: block.direction))
                    } else {
                        UnsupportedNodeView(name: block.type)
                    }
                }
                Text("Read only")
                    .font(.body)
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .worldsGlass()
            }
            .padding(dynamicTypeSize.isAccessibilitySize ? 16 : 24)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("page-content")
        .background(WorldsPalette.paper(for: colorScheme))
        #if os(macOS)
        .navigationTitle(page.title.isEmpty ? "Untitled" : page.title)
        #else
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
    private func direction(for value: String) -> LayoutDirection {
        switch value {
        case "rtl": return .rightToLeft
        case "ltr": return .leftToRight
        default: return layoutDirection
        }
    }
}

private struct NodeView: View {
    @Environment(\.layoutDirection) private var inheritedDirection
    let node: PageNode
    var fillsWidth = true
    var allowsSelection = true

    var body: some View {
        nodeBody.environment(\.layoutDirection, nodeDirection)
    }

    private var nodeDirection: LayoutDirection {
        switch node.attrs?.dir {
        case "rtl": return .rightToLeft
        case "ltr": return .leftToRight
        default: return inheritedDirection
        }
    }

    @ViewBuilder
    private var nodeBody: some View {
        switch node.type {
        case "paragraph":
            Text(inlineContent(node))
                .font(paragraphFont(node.attrs?.pstyle))
                .multilineTextAlignment(textAlignment(node.attrs?.textAlign))
                .modifier(ReaderTextSelection(enabled: allowsSelection))
                .frame(maxWidth: fillsWidth ? .infinity : nil, alignment: frameAlignment(node.attrs?.textAlign))
        case "heading":
            Text(inlineContent(node))
                .font(headingFont(node.attrs?.level))
                .multilineTextAlignment(textAlignment(node.attrs?.textAlign))
                .accessibilityAddTraits(.isHeader)
                .modifier(ReaderTextSelection(enabled: allowsSelection))
                .frame(maxWidth: fillsWidth ? .infinity : nil, alignment: frameAlignment(node.attrs?.textAlign))
        case "callout":
            VStack(alignment: .leading, spacing: 8) {
                Label(node.attrs?.tone?.capitalized ?? "Note", systemImage: "text.bubble")
                    .font(.caption.weight(.semibold))
                children
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
        case "prompt":
            VStack(alignment: .leading, spacing: 8) {
                Text(node.attrs?.label ?? "Prompt").font(.caption.weight(.semibold))
                children
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case "columns":
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 16) { columnViews }
                VStack(alignment: .leading, spacing: 16) { columnViews }
            }
        case "column", "tab":
            children
        case "toggle":
            ToggleNodeView(node: node)
        case "tabs":
            TabsNodeView(node: node)
        case "mathBlock":
            sourceContent(label: "Equation source", source: node.attrs?.latex)
        case "mermaid":
            sourceContent(label: "Diagram source", source: node.attrs?.code)
        case "bulletList", "orderedList":
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array((node.content ?? []).enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .top, spacing: 8) {
                        Text(node.type == "orderedList" ? orderedLabel(start: node.attrs?.start, index: index) : "•")
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
        case "listItem", "doc":
            children
        case "blockquote":
            children
            .padding(.leading, 12)
            .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 1.5).fill(.secondary).frame(width: 3).accessibilityHidden(true) }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Quotation")
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

    private var columnViews: some View {
        ForEach(Array((node.content ?? []).enumerated()), id: \.offset) { _, child in
            NodeView(node: child).frame(minWidth: 180, maxWidth: .infinity, alignment: .leading)
        }
    }

    private func sourceContent(label: String, source: String?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(source ?? "").font(.system(.body, design: .monospaced)).textSelection(.enabled)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private var children: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array((node.content ?? []).enumerated()), id: \.offset) { _, child in
                NodeView(node: child)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func paragraphFont(_ style: String?) -> Font {
        switch style {
        case "title": return .title.weight(.semibold)
        case "subtitle": return .title3
        case "caption": return .caption
        default: return .body
        }
    }
    private func textAlignment(_ value: String?) -> TextAlignment {
        switch value {
        case "center": return .center
        case "left": return nodeDirection == .rightToLeft ? .trailing : .leading
        case "right": return nodeDirection == .rightToLeft ? .leading : .trailing
        default: return .leading
        }
    }
    private func frameAlignment(_ value: String?) -> Alignment {
        switch textAlignment(value) {
        case .center: return .center
        case .trailing: return .trailing
        default: return .leading
        }
    }
    private func headingFont(_ level: Int?) -> Font {
        switch level {
        case 1: return .title2.weight(.semibold)
        case 2: return .title3.weight(.semibold)
        default: return .headline
        }
    }
    private func orderedLabel(start: Int?, index: Int) -> String {
        let (number, overflow) = (start ?? 1).addingReportingOverflow(index)
        return overflow ? "\(start ?? 1) + \(index)." : "\(number)."
    }
}

private struct ReaderTextSelection: ViewModifier {
    let enabled: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if enabled { content.textSelection(.enabled) }
        else { content.textSelection(.disabled) }
    }
}

private struct ToggleNodeView: View {
    let node: PageNode
    @State private var isOpen: Bool
    init(node: PageNode) {
        self.node = node
        _isOpen = State(initialValue: node.attrs?.open ?? true)
    }
    var body: some View {
        let items = node.content ?? []
        VStack(alignment: .leading, spacing: 8) {
            #if os(macOS)
            MacReaderToggle(title: items.first.map { String(inlineContent($0).characters) } ?? "Toggle", isOpen: $isOpen).fixedSize(horizontal: true, vertical: false)
            #else
            Button {
                isOpen.toggle()
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: isOpen ? "chevron.down" : "chevron.forward")
                        .font(.caption.weight(.semibold))
                        .accessibilityHidden(true)
                    if let first = items.first { NodeView(node: first, fillsWidth: false, allowsSelection: false) }
                    else { Text("Toggle") }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("reader-toggle")
            .accessibilityValue(isOpen ? "Expanded" : "Collapsed")
            #endif
            if isOpen {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(items.dropFirst().enumerated()), id: \.offset) { _, child in NodeView(node: child) }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

#if os(macOS)
import AppKit

/// NSButton does not always take keyboard focus on click. This control does so
/// explicitly, while retaining native button activation and accessibility.
private final class FocusedReaderButton: NSButton {
    override var acceptsFirstResponder: Bool { true }
    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        super.mouseDown(with: event)
    }
}

private struct MacReaderToggle: NSViewRepresentable {
    @Environment(\.layoutDirection) private var direction
    let title: String
    @Binding var isOpen: Bool
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> FocusedReaderButton {
        let button = FocusedReaderButton(title: title, target: context.coordinator, action: #selector(Coordinator.activate(_:)))
        button.isBordered = false
        button.setButtonType(.momentaryPushIn)
        button.font = NSFont.preferredFont(forTextStyle: .body)
        button.setAccessibilityIdentifier("reader-toggle")
        return button
    }
    func updateNSView(_ button: FocusedReaderButton, context: Context) {
        context.coordinator.parent = self
        let font = NSFont.preferredFont(forTextStyle: .body)
        button.font = font
        button.attributedTitle = NSAttributedString(string: title, attributes: [.font: font, .foregroundColor: NSColor.labelColor])
        button.setAccessibilityLabel(title)
        button.contentTintColor = .labelColor
        let symbol = isOpen ? "chevron.down" : (direction == .rightToLeft ? "chevron.left" : "chevron.right")
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        button.image = image?.withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: font.pointSize, weight: .semibold))
        button.toolTip = title
        button.imagePosition = direction == .rightToLeft ? .imageRight : .imageLeft
        button.setAccessibilityValue(isOpen ? "Expanded" : "Collapsed")
    }
    final class Coordinator: NSObject {
        var parent: MacReaderToggle
        init(_ parent: MacReaderToggle) { self.parent = parent }
        @objc func activate(_ sender: NSButton) { parent.isOpen.toggle() }
    }
}
#endif

private struct TabsNodeView: View {
    let node: PageNode
    @State private var selected: Int
    init(node: PageNode) {
        self.node = node
        let count = node.content?.count ?? 0
        let active = node.attrs?.active ?? 0
        _selected = State(initialValue: active >= 0 && active < count ? active : 0)
    }
    var body: some View {
        let tabs = node.content ?? []
        VStack(alignment: .leading, spacing: 12) {
            if tabs.isEmpty {
                Text("No tabs").foregroundStyle(.secondary)
            } else {
                Picker("Tab", selection: $selected) {
                    ForEach(tabs.indices, id: \.self) { index in
                        Text(tabs[index].attrs?.title ?? "Tab").tag(index)
                    }
                }.pickerStyle(.menu)
                if tabs.indices.contains(selected) { NodeView(node: tabs[selected]) }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
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
            case "highlight":
                if let specified = mark.attrs?.color {
                    if let value = specified.value, let color = readerColor(value) { text.backgroundColor = color }
                    else { unsupported.append("highlight color") }
                } else { text.backgroundColor = .yellow.opacity(0.4) }
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
    if node.type == "mathInline" { return AttributedString("$" + (node.attrs?.latex ?? "") + "$") }
    if node.type == "pageMention" { return AttributedString("@" + (node.attrs?.label ?? "")) }
    var result = AttributedString()
    for child in node.content ?? [] {
        if ["text", "hardBreak", "mathInline", "pageMention"].contains(child.type ?? "") {
            result.append(inlineContent(child))
        } else {
            result.append(AttributedString("[Unsupported content: \(child.type ?? "unknown")]") )
        }
    }
    return result
}

/// The source editor emits six-digit hex colors and rgba marker colors.
/// Unknown CSS is not interpreted as a different color.
private func readerColor(_ value: String) -> Color? {
    let value = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if value.hasPrefix("#"), value.count == 7, let rgb = UInt32(value.dropFirst(), radix: 16) {
        return Color(red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
    }
    guard value.hasPrefix("rgba("), value.hasSuffix(")") else { return nil }
    let parts = value.dropFirst(5).dropLast().split(separator: ",", omittingEmptySubsequences: false)
    guard parts.count == 4 else { return nil }
    let values = parts.compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    guard values.count == 4, values.allSatisfy(\.isFinite), values.prefix(3).allSatisfy({ (0...255).contains($0) }), (0...1).contains(values[3]) else { return nil }
    return Color(red: values[0] / 255, green: values[1] / 255, blue: values[2] / 255, opacity: values[3])
}
