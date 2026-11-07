import SwiftUI

enum WorldsPalette {
    static func accent(for scheme: ColorScheme) -> Color {
        scheme == .dark
            ? Color(red: 210 / 255, green: 164 / 255, blue: 110 / 255)
            : Color(red: 138 / 255, green: 88 / 255, blue: 32 / 255)
    }

    static func paper(for scheme: ColorScheme) -> Color {
        scheme == .dark
            ? Color(red: 12 / 255, green: 12 / 255, blue: 14 / 255)
            : Color(red: 253 / 255, green: 253 / 255, blue: 252 / 255)
    }
}
