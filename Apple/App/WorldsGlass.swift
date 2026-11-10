import SwiftUI
#if os(macOS)
import AppKit
#endif

// MARK: - Authentic macOS Vibrancy (NSVisualEffectView)

#if os(macOS)
/// Native AppKit Vibrancy backing view (NSVisualEffectView) providing translucent Acrylic-like behind-window blur for macOS sidebars and inspectors.
public struct WorldsVibrancyView: NSViewRepresentable {
    public let material: NSVisualEffectView.Material
    public let blendingMode: NSVisualEffectView.BlendingMode

    public init(
        material: NSVisualEffectView.Material = .sidebar,
        blendingMode: NSVisualEffectView.BlendingMode = .behindWindow
    ) {
        self.material = material
        self.blendingMode = blendingMode
    }

    public func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        view.state = .followsWindowActiveState
        return view
    }

    public func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}
#endif

// MARK: - Native Navigation Glass vs Calm Content Surface Modifiers

private struct NavigationGlassModifier<S: InsettableShape>: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    let shape: S
    let interactive: Bool

    func body(content: Content) -> some View {
        if reduceTransparency {
            content
                .background(WorldsPalette.surface(for: colorScheme), in: shape)
                .overlay(shape.strokeBorder(WorldsPalette.subtleBorder(for: colorScheme, highContrast: contrast == .increased), lineWidth: contrast == .increased ? 1.0 : 0.5))
        } else {
            if #available(iOS 26.0, macOS 26.0, *) {
                content
                    .glassEffect(interactive ? .regular.interactive() : .regular, in: shape)
            } else {
                content
                    .background(.regularMaterial, in: shape)
                    .overlay(shape.strokeBorder(WorldsPalette.subtleBorder(for: colorScheme, highContrast: contrast == .increased), lineWidth: 0.5))
            }
        }
    }
}

private struct CalmContentCardModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.colorSchemeContrast) private var contrast
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        content
            .background(WorldsPalette.cardBackground(for: colorScheme), in: shape)
            .overlay(
                shape.strokeBorder(
                    WorldsPalette.subtleBorder(for: colorScheme, highContrast: contrast == .increased),
                    lineWidth: contrast == .increased ? 1.0 : 0.5
                )
            )
    }
}

extension View {
    /// Applies authentic system Liquid Glass exclusively for floating navigation bars, HUD popovers, and interactive chrome.
    public func worldsFloatingGlass<S: InsettableShape>(in shape: S = RoundedRectangle(cornerRadius: 14, style: .continuous), interactive: Bool = false) -> some View {
        self.modifier(NavigationGlassModifier(shape: shape, interactive: interactive))
    }

    /// Quiet, calm surface for document cards, list items, metrics, and workspaces (avoiding glass clutter over content).
    public func worldsContentCard(cornerRadius: CGFloat = 12) -> some View {
        self.modifier(CalmContentCardModifier(cornerRadius: cornerRadius))
    }

    /// Legacy-compatible entry point now cleanly routed to calm content surfaces on cards or adaptive material where appropriate.
    public func worldsGlass(cornerRadius: CGFloat = 14) -> some View {
        self.modifier(CalmContentCardModifier(cornerRadius: cornerRadius))
    }

    /// Thin glass specifically for floating chrome/bars.
    @ViewBuilder
    public func worldsGlassThin(cornerRadius: CGFloat = 12) -> some View {
        self.modifier(NavigationGlassModifier(shape: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous), interactive: false))
    }
}

/// Coordinates multiple floating Liquid Glass controls cleanly in iOS/macOS 26+.
public struct WorldsGlassChromeGroup<Content: View>: View {
    @ViewBuilder public let content: () -> Content

    public init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    public var body: some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            GlassEffectContainer {
                content()
            }
        } else {
            content()
        }
    }
}

/// Capsule-shaped floating status badge for toolbar / HUD use.
public struct WorldsGlassBadge<Label: View>: View {
    @ViewBuilder public let label: () -> Label

    public init(@ViewBuilder label: @escaping () -> Label) {
        self.label = label
    }

    public var body: some View {
        label()
            .font(.caption.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .worldsFloatingGlass(in: Capsule(), interactive: true)
    }
}
