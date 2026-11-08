import SwiftUI

/// A single material entry point, using the system glass when available.
extension View {
    @ViewBuilder
    func worldsGlass(cornerRadius: CGFloat = 14) -> some View {
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
}
