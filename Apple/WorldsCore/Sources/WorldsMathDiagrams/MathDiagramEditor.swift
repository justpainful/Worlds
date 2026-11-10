import SwiftUI
import SwiftMath

/// Native source editor and preview. It does not save to a Worlds document;
/// the host owns authorization, persistence, undo and conflict handling.
public struct MathDiagramEditor: View {
    @Binding private var node: MathDiagramNode
    @State private var draft: String
    @State private var error: String?
    @State private var validatedSource: String?
    @State private var validatedKind: MathDiagramKind?
    public init(node: Binding<MathDiagramNode>) {
        self._node = node
        self._draft = State(initialValue: node.wrappedValue.text)
    }
    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(node.kind == .mermaid ? "Mermaid source" : "LaTeX source").font(.headline)
            TextEditor(text: $draft)
                .font(.system(.body, design: .monospaced))
                .environment(\.layoutDirection, .leftToRight)
                .frame(minHeight: node.kind == .mathInline ? 70 : 140)
                .accessibilityLabel(node.kind == .mermaid ? "Mermaid source" : "LaTeX source")
            HStack {
                Button("Preview") { validate() }
                Button("Save Source") {
                    do { var updated = node; try updated.setText(draft); node = updated; validate() }
                    catch { self.error = String(describing: error) }
                }
            }
            if let error {
                Text(error).foregroundStyle(.red).accessibilityLabel("Preview error: \(error)")
            } else if validatedSource != draft || validatedKind != node.kind {
                ProgressView("Checking source")
            } else if node.kind == .mermaid {
                Text("Diagram preview is unavailable until Mermaid compatibility is verified. The source remains editable.").font(.caption).foregroundStyle(.secondary)
            } else {
                MathNativeLabel(source: draft.isEmpty ? "\\square" : draft, display: node.kind == .mathBlock)
                    .frame(minHeight: 50)
                Text("Native math rendering may differ from KaTeX.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .onAppear { validate() }
        .onChange(of: draft) { _, _ in validate() }
        .onChange(of: node) { _, updated in if updated.text != draft { draft = updated.text }; validate() }
    }
    private func validate() {
        do {
            if node.kind == .mermaid { _ = try NativeMathDiagramParser.validateMermaid(draft) }
            else { try NativeMathDiagramParser.validateMath(draft) }
            error = nil; validatedSource = draft; validatedKind = node.kind
        } catch { validatedSource = nil; validatedKind = nil; self.error = String(describing: error) }
    }
}

#if canImport(UIKit)
import UIKit
private struct MathNativeLabel: UIViewRepresentable {
    let source: String
    let display: Bool
    func makeUIView(context: Context) -> MTMathUILabel { MTMathUILabel() }
    func updateUIView(_ view: MTMathUILabel, context: Context) {
        view.labelMode = display ? .display : .text
        view.latex = source
        view.accessibilityLabel = source
        view.displayErrorInline = true
    }
}
#elseif canImport(AppKit)
import AppKit
private struct MathNativeLabel: NSViewRepresentable {
    let source: String
    let display: Bool
    func makeNSView(context: Context) -> MTMathUILabel { MTMathUILabel() }
    func updateNSView(_ view: MTMathUILabel, context: Context) {
        view.labelMode = display ? .display : .text
        view.latex = source
        view.setAccessibilityLabel(source)
        view.displayErrorInline = true
    }
}
#endif



