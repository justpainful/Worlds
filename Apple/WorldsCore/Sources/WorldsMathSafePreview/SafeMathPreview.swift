import SwiftUI
import SwiftMath

/// Read-only preview keeps the original source visible for copy and accessibility.
/// Validation and drawing must be verified on Apple before enabling in the app.
public struct SafeMathPreview: View {
    public let source: String
    public let display: Bool
    public init(source: String, display: Bool) { self.source = source; self.display = display }
    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if (try? MathPreviewGate.validate(source)) != nil {
                NativeFormula(source: source, display: display)
                    .frame(minHeight: 48)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Equation source: \(source)")
                Text("Native preview may differ from the original.").font(.caption).foregroundStyle(.secondary)
            } else {
                Text("Native preview unavailable for this equation.").font(.caption).foregroundStyle(.secondary)
            }
            Text(source).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                .environment(\.layoutDirection, .leftToRight)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

#if canImport(UIKit)
import UIKit
private struct NativeFormula: UIViewRepresentable {
    let source: String; let display: Bool
    func makeUIView(context: Context) -> MTMathUILabel { MTMathUILabel() }
    func updateUIView(_ view: MTMathUILabel, context: Context) {
        view.labelMode = display ? .display : .text; view.latex = source; view.displayErrorInline = true
    }
}
#elseif canImport(AppKit)
import AppKit
private struct NativeFormula: NSViewRepresentable {
    let source: String; let display: Bool
    func makeNSView(context: Context) -> MTMathUILabel { MTMathUILabel() }
    func updateNSView(_ view: MTMathUILabel, context: Context) {
        view.labelMode = display ? .display : .text; view.latex = source; view.displayErrorInline = true
    }
}
#endif
