import SwiftUI

// Liquid Glass for the assistant's floating chrome, the same approach as the
// app's WorldsGlass.swift (which this package cannot see). On iOS and macOS 26
// the system glass is used; older systems get a material with one hairline.
// Messages stay calm: only the composer floats on glass.

private struct AIGlassSurface<S: InsettableShape>: ViewModifier {
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
struct AIGlassGroup<Content: View>: View {
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
    /// Floating glass in a rounded shape (a capsule when the shape is one line tall).
    func aiFloatingGlass(cornerRadius: CGFloat = 22) -> some View {
        modifier(AIGlassSurface(shape: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)))
    }

    /// A round accent button: `.glassProminent` on 26, `.borderedProminent` before.
    @ViewBuilder
    func aiRoundProminentButton() -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            self.buttonStyle(.glassProminent).buttonBorderShape(.circle)
        } else {
            self.buttonStyle(.borderedProminent).buttonBorderShape(.circle)
        }
    }
}
