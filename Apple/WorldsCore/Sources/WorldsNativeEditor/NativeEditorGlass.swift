import SwiftUI

// Liquid Glass for the page formatting bar, the same approach as the app's
// WorldsGlass.swift (which this package cannot see). On iOS and macOS 26 the
// system glass is used; older systems get a material with one hairline. Buttons
// inside the bar are plain icons: one piece of glass, never glass inside glass.

private struct NativeEditorGlassSurface<S: InsettableShape>: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    let shape: S

    func body(content: Content) -> some View {
        if reduceTransparency {
            content
                .background(colorScheme == .dark ? Color(red: 32 / 255, green: 32 / 255, blue: 35 / 255) : Color(red: 253 / 255, green: 253 / 255, blue: 253 / 255), in: shape)
                .overlay(shape.strokeBorder(Color.primary.opacity(0.16), lineWidth: 0.5))
        } else if #available(iOS 26.0, macOS 26.0, *) {
            content.glassEffect(.regular.interactive(), in: shape)
        } else {
            content
                .background(.regularMaterial, in: shape)
                .overlay(shape.strokeBorder(Color.primary.opacity(colorScheme == .dark ? 0.18 : 0.10), lineWidth: 0.5))
                .shadow(color: .black.opacity(colorScheme == .dark ? 0.28 : 0.10), radius: 14, y: 6)
        }
    }
}

/// Lets glass shapes inside it blend and morph together on 26.
struct NativeEditorGlassGroup<Content: View>: View {
    let spacing: CGFloat
    let content: Content

    init(spacing: CGFloat = 8, @ViewBuilder content: () -> Content) {
        self.spacing = spacing
        self.content = content()
    }

    var body: some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content }
        } else {
            content
        }
    }
}

extension View {
    /// Floating glass in a rounded shape; with 22 pt corners a one row bar reads as a capsule.
    func nativeEditorFloatingGlass(cornerRadius: CGFloat = 22) -> some View {
        modifier(NativeEditorGlassSurface(shape: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)))
    }

    /// A menu inside the glass bar: a plain icon with no bezel or indicator, the same size as the buttons.
    func nativeEditorBarMenu() -> some View {
        self
            .menuStyle(.button)
            .buttonStyle(.borderless)
            .menuIndicator(.hidden)
            .labelStyle(.iconOnly)
            .font(.body.weight(.medium))
            .tint(Color.primary)
            .frame(minWidth: NativeEditorBarMetrics.button, minHeight: NativeEditorBarMetrics.button)
            .contentShape(Capsule())
    }
}

/// A plain icon button inside the glass bar. Hover and press show a soft lens fill with no edge.
struct NativeEditorBarButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        NativeEditorBarButtonBody(configuration: configuration)
    }
}

private struct NativeEditorBarButtonBody: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isEnabled) private var isEnabled
    @State private var hovering = false

    var body: some View {
        configuration.label
            .labelStyle(.iconOnly)
            .font(.body.weight(.medium))
            .frame(minWidth: NativeEditorBarMetrics.button, minHeight: NativeEditorBarMetrics.button)
            .contentShape(Capsule())
            .background(Color.primary.opacity(lensOpacity), in: Capsule())
            .foregroundStyle(isEnabled ? Color.primary : Color.secondary)
            .opacity(isEnabled ? 1 : 0.5)
            .onHover { hovering = $0 }
            .animation(.timingCurve(0.2, 0.7, 0.2, 1, duration: 0.11), value: hovering)
            .animation(.timingCurve(0.2, 0.7, 0.2, 1, duration: 0.11), value: configuration.isPressed)
    }

    private var lensOpacity: Double {
        guard isEnabled else { return 0 }
        if configuration.isPressed { return 0.14 }
        return hovering ? 0.08 : 0
    }
}

enum NativeEditorBarMetrics {
    #if os(macOS)
    static let button: CGFloat = 28
    #else
    static let button: CGFloat = 36
    #endif
}

/// Lays groups out in a row and wraps them onto further rows when the width runs
/// out, so every action stays reachable without a nested scroll view.
struct NativeEditorFlowLayout: Layout {
    var spacing: CGFloat = 10
    var lineSpacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let limit = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > limit {
                y += lineHeight + lineSpacing
                x = 0
                lineHeight = 0
            }
            x += size.width
            widest = max(widest, x)
            x += spacing
            lineHeight = max(lineHeight, size.height)
        }
        return CGSize(width: widest, height: y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > bounds.width {
                y += lineHeight + lineSpacing
                x = 0
                lineHeight = 0
            }
            subview.place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}
