import SwiftUI

/// Native vector preview for StrictFlowchart only. It does not claim Mermaid.js
/// layout or support for syntax rejected by the strict parser.
public struct StrictFlowchartView: View {
    public let graph: StrictFlowchart
    @ScaledMetric(relativeTo: .body) private var nodeHeight: CGFloat = 100
    @ScaledMetric(relativeTo: .body) private var nodeWidth: CGFloat = 220
    public init(graph: StrictFlowchart) { self.graph = graph }
    private let gap: CGFloat = 50
    private var extent: CGSize {
        let maxDepth = graph.nodes.map(\.depth).max() ?? 0, maxRow = graph.nodes.map(\.row).max() ?? 0
        switch graph.direction {
        case .leftToRight: return CGSize(width: CGFloat(maxDepth + 1) * (nodeWidth + gap), height: CGFloat(maxRow + 1) * (nodeHeight + gap))
        case .topToBottom: return CGSize(width: CGFloat(maxRow + 1) * (nodeWidth + gap), height: CGFloat(maxDepth + 1) * (nodeHeight + gap))
        }
    }
    private func origin(_ node: FlowchartNode) -> CGPoint {
        switch graph.direction {
        case .leftToRight: return CGPoint(x: CGFloat(node.depth) * (nodeWidth + gap), y: CGFloat(node.row) * (nodeHeight + gap))
        case .topToBottom: return CGPoint(x: CGFloat(node.row) * (nodeWidth + gap), y: CGFloat(node.depth) * (nodeHeight + gap))
        }
    }
    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Limited native flowchart preview").font(.caption).foregroundStyle(.secondary)
            ScrollView([.horizontal, .vertical]) {
                ZStack(alignment: .topLeading) {
                    Canvas { context, _ in
                        for edge in graph.edges {
                            guard let from = graph.nodes.first(where: { $0.id == edge.from }),
                                  let to = graph.nodes.first(where: { $0.id == edge.to }) else { continue }
                            let a = origin(from), b = origin(to)
                            let start: CGPoint, end: CGPoint
                            switch graph.direction {
                            case .leftToRight:
                                start = CGPoint(x: a.x + nodeWidth, y: a.y + nodeHeight / 2)
                                end = CGPoint(x: b.x, y: b.y + nodeHeight / 2)
                            case .topToBottom:
                                start = CGPoint(x: a.x + nodeWidth / 2, y: a.y + nodeHeight)
                                end = CGPoint(x: b.x + nodeWidth / 2, y: b.y)
                            }
                            let angle = atan2(end.y - start.y, end.x - start.x), length: CGFloat = 10
                            var path = Path(); path.move(to: start); path.addLine(to: end)
                            path.move(to: CGPoint(x: end.x - length * cos(angle - 0.5), y: end.y - length * sin(angle - 0.5)))
                            path.addLine(to: end)
                            path.addLine(to: CGPoint(x: end.x - length * cos(angle + 0.5), y: end.y - length * sin(angle + 0.5)))
                            context.stroke(path, with: .color(.secondary), style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                        }
                    }.accessibilityHidden(true)
                    ForEach(graph.nodes) { node in
                        Text(node.label).font(.body).multilineTextAlignment(.center)
                            .frame(width: nodeWidth - 20, height: nodeHeight - 20)
                            .padding(10)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(.secondary.opacity(0.4), lineWidth: 1))
                            .offset(x: origin(node).x, y: origin(node).y)
                            .accessibilityLabel("Node: \(node.label)")
                    }
                }.frame(width: extent.width, height: extent.height, alignment: .topLeading).padding(8)
            }.environment(\.layoutDirection, .leftToRight)
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(graph.edges.enumerated()), id: \.offset) { _, edge in
                    let from = graph.nodes.first(where: { $0.id == edge.from })?.label ?? edge.from
                    let to = graph.nodes.first(where: { $0.id == edge.to })?.label ?? edge.to
                    Text("\(from) → \(to)").font(.caption)
                }
            }.accessibilityLabel("Flowchart connections")
        }
    }
}

/// Applies a source edit to the in-memory binding only. The host owns storage,
/// authorization, undo and retaining drafts while dismissing.
public struct DiagramSourceEditor: View {
    @Binding private var node: DiagramSourceDocument
    @State private var baseline: DiagramSourceDocument
    @State private var draft: String
    @State private var preview: StrictFlowchart?
    @State private var previewText: String?
    @State private var error: String?
    public init(node: Binding<DiagramSourceDocument>) {
        _node = node; _baseline = State(initialValue: node.wrappedValue); _draft = State(initialValue: node.wrappedValue.text)
    }
    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Mermaid source").font(.headline)
            TextEditor(text: $draft).font(.system(.body, design: .monospaced))
                .environment(\.layoutDirection, .leftToRight).frame(minHeight: 140)
                .accessibilityLabel("Mermaid source")
            HStack {
                Button("Preview") { makePreview() }
                Button("Apply source") { apply() }.disabled(draft == baseline.text)
            }
            if let error { Text(error).foregroundStyle(.secondary).accessibilityIdentifier("diagram-error") }
            if let preview, previewText == draft { StrictFlowchartView(graph: preview) }
            else { Text("Preview supports a limited flowchart subset. The source remains unchanged.").font(.caption).foregroundStyle(.secondary) }
        }
        .onChange(of: node) { old, updated in
            if draft == old.text { baseline = updated; draft = updated.text; preview = nil; previewText = nil; error = nil }
        }
    }
    private func makePreview() {
        do { preview = try StrictFlowchartParser.parse(draft); previewText = draft; error = nil }
        catch { preview = nil; previewText = nil; self.error = "This diagram uses syntax that the native preview does not support." }
    }
    private func apply() {
        guard node == baseline else { error = "The document changed. Copy your draft before reloading."; return }
        do { var updated = node; try updated.setText(draft); node = updated; baseline = updated; error = nil }
        catch { self.error = "The source is too large to apply." }
    }
}
