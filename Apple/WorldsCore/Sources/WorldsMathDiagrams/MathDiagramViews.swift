import SwiftUI
import SwiftMath
import WorldsNativeDiagrams
import WorldsModels

#if canImport(UIKit)
import UIKit
public struct MathNativeRepresentable: UIViewRepresentable {
    public let latex: String
    public let display: Bool
    public let fontSize: CGFloat

    public init(latex: String, display: Bool = true, fontSize: CGFloat = 20) {
        self.latex = latex
        self.display = display
        self.fontSize = fontSize
    }

    public func makeUIView(context: Context) -> MTMathUILabel {
        let label = MTMathUILabel()
        label.displayErrorInline = true
        label.textAlignment = .center
        return label
    }

    public func updateUIView(_ view: MTMathUILabel, context: Context) {
        view.labelMode = display ? .display : .text
        view.latex = latex.isEmpty ? "\\square" : latex
        view.fontSize = fontSize
        view.accessibilityLabel = latex
    }
}
#elseif canImport(AppKit)
import AppKit
public struct MathNativeRepresentable: NSViewRepresentable {
    public let latex: String
    public let display: Bool
    public let fontSize: CGFloat

    public init(latex: String, display: Bool = true, fontSize: CGFloat = 20) {
        self.latex = latex
        self.display = display
        self.fontSize = fontSize
    }

    public func makeNSView(context: Context) -> MTMathUILabel {
        let label = MTMathUILabel()
        label.displayErrorInline = true
        label.textAlignment = .center
        return label
    }

    public func updateNSView(_ view: MTMathUILabel, context: Context) {
        view.labelMode = display ? .display : .text
        view.latex = latex.isEmpty ? "\\square" : latex
        view.fontSize = fontSize
        view.setAccessibilityLabel(latex)
    }
}
#endif

/// Renders a mathematical equation using SwiftMath native typesetting.
/// If an unsupported macro or syntax error is encountered, displays a styled
/// fallback showing formatted source and a warning indicator.
public struct MathBlockView: View {
    public let latex: String
    @State private var showSource: Bool = false
    @ScaledMetric(relativeTo: .body) private var mathFontSize: CGFloat = 22

    public init(latex: String) {
        self.latex = latex
    }

    private var isValid: Bool {
        do {
            try NativeMathDiagramParser.validateMath(latex)
            return true
        } catch {
            return false
        }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Equation", systemImage: "function")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if !isValid {
                    Text("Syntax fallback")
                        .font(.caption2.weight(.medium))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.orange.opacity(0.15), in: Capsule())
                        .foregroundStyle(.orange)
                }
                Button {
                    showSource.toggle()
                } label: {
                    Image(systemName: showSource ? "eye" : "chevron.left.forwardslash.chevron.right")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(showSource ? "Show rendered equation" : "Show LaTeX source")
            }

            if showSource || !isValid {
                Text(latex)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
            } else {
                #if canImport(UIKit) || canImport(AppKit)
                MathNativeRepresentable(latex: latex, display: true, fontSize: mathFontSize)
                    .frame(minHeight: 52)
                    .padding(12)
                    .frame(maxWidth: .infinity)
                    .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
                #else
                Text(latex)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                #endif
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Math equation: \(latex)")
    }
}

/// Renders a Mermaid diagram: uses StrictFlowchartView for supported flowcharts,
/// and a styled diagram viewer with diagnostics for broader Mermaid diagrams.
public struct MermaidDiagramView: View {
    public let code: String
    @State private var showRawSource: Bool = false

    public init(code: String) {
        self.code = code
    }

    private var strictFlowchart: StrictFlowchart? {
        try? StrictFlowchartParser.parse(code)
    }

    private var inspection: MermaidSourceInspection? {
        try? NativeMathDiagramParser.inspectMermaid(code)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(diagramTitle, systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if let type = inspection?.diagramType {
                    Text(type)
                        .font(.caption2.weight(.medium))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.blue.opacity(0.15), in: Capsule())
                        .foregroundStyle(.blue)
                }
                Button {
                    showRawSource.toggle()
                } label: {
                    Image(systemName: showRawSource ? "eye" : "chevron.left.forwardslash.chevron.right")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(showRawSource ? "Show diagram view" : "Show source code")
            }

            if showRawSource {
                Text(code)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
            } else if let chart = strictFlowchart {
                StrictFlowchartView(graph: chart)
                    .padding(8)
                    .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
            } else {
                // Styled diagram fallback with inspection diagnostics
                VStack(alignment: .leading, spacing: 8) {
                    if let diagnostics = inspection?.diagnostics, !diagnostics.isEmpty {
                        ForEach(Array(diagnostics.prefix(3).enumerated()), id: \.offset) { _, diag in
                            HStack(alignment: .top, spacing: 4) {
                                Image(systemName: "info.circle")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                Text(diag.message)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    Text(code)
                        .font(.system(.body, design: .monospaced))
                        .textSelection(.enabled)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Mermaid diagram: \(diagramTitle)")
    }

    private var diagramTitle: String {
        if strictFlowchart != nil {
            return "Flowchart"
        } else if let type = inspection?.diagramType {
            return "\(type.capitalized) Diagram"
        } else {
            return "Mermaid Diagram"
        }
    }
}
