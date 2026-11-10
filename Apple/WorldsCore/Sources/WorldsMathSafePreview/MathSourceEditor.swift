import SwiftUI

/// Isolated in-memory editor. The caller must protect the draft, authorize and
/// save the binding through a conflict-aware document store.
public struct MathSourceEditor: View {
    @Binding private var node: MathSourceDocument
    @State private var baseline: MathSourceDocument
    @State private var draft: String
    @State private var error: String?
    public init(node: Binding<MathSourceDocument>) {
        _node = node; _baseline = State(initialValue: node.wrappedValue); _draft = State(initialValue: node.wrappedValue.text)
    }
    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("LaTeX source").font(.headline)
            TextEditor(text: $draft).font(.system(.body, design: .monospaced))
                .environment(\.layoutDirection, .leftToRight)
                .frame(minHeight: node.display ? 140 : 70)
                .accessibilityLabel("LaTeX source").accessibilityIdentifier("math-source-input")
            Button("Apply source") { apply() }.disabled(draft == baseline.text)
            if let error { Text(error).foregroundStyle(.secondary).accessibilityIdentifier("math-source-error") }
            SafeMathPreview(source: draft, display: node.display)
        }.onChange(of: node) { old, updated in
            if draft == old.text { baseline = updated; draft = updated.text; error = nil }
        }
    }
    private func apply() {
        guard node == baseline else { error = "The document changed. Copy your draft before reloading."; return }
        do { var updated = node; try updated.setText(draft); node = updated; baseline = updated; error = nil }
        catch { self.error = "The source is too large to apply." }
    }
}
