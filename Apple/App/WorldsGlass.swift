import SwiftUI

/// Complete WorldsGlass Design System providing Liquid Glass and high-fidelity fallback materials.
extension View {
    /// A single material entry point, using the system glass when available.
    @ViewBuilder
    public func worldsGlass(cornerRadius: CGFloat = 14) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if #available(iOS 26.0, macOS 26.0, *) {
            self.glassEffect(.regular, in: shape)
        } else {
            self.background(.regularMaterial, in: shape)
                .overlay(shape.strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5))
                .overlay(shape.inset(by: 0.5).strokeBorder(Color.white.opacity(0.14), lineWidth: 0.5))
                .shadow(color: .black.opacity(0.06), radius: 2, y: 1)
        }
    }

    /// Applies thin glass styling for floating bars and headers.
    @ViewBuilder
    public func worldsGlassThin(cornerRadius: CGFloat = 12) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if #available(iOS 26.0, macOS 26.0, *) {
            self.glassEffect(.clear, in: shape)
        } else {
            self.background(.ultraThinMaterial, in: shape)
                .overlay(shape.strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5))
                .overlay(shape.inset(by: 0.5).strokeBorder(Color.white.opacity(0.18), lineWidth: 0.5))
                .shadow(color: .black.opacity(0.04), radius: 1, y: 0.5)
        }
    }
}

/// Reusable glass container wrapping content with adaptive Liquid Glass styling.
public struct WorldsGlassContainer<Content: View>: View {
    public let cornerRadius: CGFloat
    public let contentPadding: CGFloat
    @ViewBuilder public let content: () -> Content

    public init(
        cornerRadius: CGFloat = 14,
        contentPadding: CGFloat = 14,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.cornerRadius = cornerRadius
        self.contentPadding = contentPadding
        self.content = content
    }

    public var body: some View {
        content()
            .padding(contentPadding)
            .worldsGlass(cornerRadius: cornerRadius)
    }
}

/// ButtonStyle conforming to WorldsGlass system with interactive press feedback.
public struct WorldsGlassButtonStyle: ButtonStyle {
    public let cornerRadius: CGFloat

    public init(cornerRadius: CGFloat = 12) {
        self.cornerRadius = cornerRadius
    }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .worldsGlass(cornerRadius: cornerRadius)
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .opacity(configuration.isPressed ? 0.85 : 1.0)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == WorldsGlassButtonStyle {
    public static var worldsGlass: WorldsGlassButtonStyle {
        WorldsGlassButtonStyle()
    }

    public static func worldsGlass(cornerRadius: CGFloat = 12) -> WorldsGlassButtonStyle {
        WorldsGlassButtonStyle(cornerRadius: cornerRadius)
    }
}

/// Standalone interactive glass button component.
public struct WorldsGlassButton<Label: View>: View {
    public let action: () -> Void
    public let cornerRadius: CGFloat
    @ViewBuilder public let label: () -> Label

    public init(
        cornerRadius: CGFloat = 12,
        action: @escaping () -> Void,
        @ViewBuilder label: @escaping () -> Label
    ) {
        self.cornerRadius = cornerRadius
        self.action = action
        self.label = label
    }

    public var body: some View {
        Button(action: action) {
            label()
        }
        .buttonStyle(WorldsGlassButtonStyle(cornerRadius: cornerRadius))
    }
}

/// Capsule-shaped glass badge for stats, status indicators, and CAD metadata tags.
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
            .background(.regularMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5))
            .overlay(Capsule().inset(by: 0.5).strokeBorder(Color.white.opacity(0.16), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.05), radius: 2, y: 1)
    }
}
