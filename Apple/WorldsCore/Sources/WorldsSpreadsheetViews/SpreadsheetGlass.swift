import SwiftUI

// Liquid Glass for the spreadsheet's chrome (formula bar and sheet bar), the
// same approach as the app's WorldsGlass.swift (which this package cannot see).
// On iOS and macOS 26 the system glass is used; older systems get a material
// with one hairline. The grid and its cells stay calm.

private struct SpreadsheetGlassSurface<S: InsettableShape>: ViewModifier {
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
                .shadow(color: .black.opacity(colorScheme == .dark ? 0.22 : 0.08), radius: 10, y: 4)
        }
    }
}

/// Lets glass shapes inside it blend and morph together on 26.
struct SpreadsheetGlassGroup<Content: View>: View {
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
    /// Floating glass capsule for a bar of controls.
    func spreadsheetGlassCapsule() -> some View {
        modifier(SpreadsheetGlassSurface(shape: Capsule()))
    }
}
