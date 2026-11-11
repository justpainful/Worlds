import SwiftUI

enum WorldsPalette {
    static let darkCanvas = Color(red: 12 / 255, green: 12 / 255, blue: 14 / 255) // #0C0C0E
    static let darkSidebar = Color(red: 18 / 255, green: 18 / 255, blue: 21 / 255) // #121215
    static let raisedSurface = Color(red: 36 / 255, green: 36 / 255, blue: 40 / 255) // #242428
    static let lightPaper = Color(red: 253 / 255, green: 253 / 255, blue: 252 / 255) // #FDFDFC
    static let lightPaperInk = Color(red: 28 / 255, green: 28 / 255, blue: 31 / 255) // #1C1C1F
    static let blueAccent = Color(red: 46 / 255, green: 146 / 255, blue: 255 / 255) // #2E92FF
    static let lightAccent = Color(red: 0 / 255, green: 102 / 255, blue: 204 / 255) // #0066CC

    static func accent(for scheme: ColorScheme) -> Color {
        scheme == .dark ? blueAccent : lightAccent
    }

    static func paper(for scheme: ColorScheme) -> Color {
        scheme == .dark ? darkCanvas : lightPaper
    }

    static func ink(for scheme: ColorScheme) -> Color {
        scheme == .dark ? lightPaper : lightPaperInk
    }

    static func surface(for scheme: ColorScheme) -> Color {
        scheme == .dark ? raisedSurface : Color(red: 245 / 255, green: 245 / 255, blue: 243 / 255)
    }

    static func groupedCanvas(for scheme: ColorScheme) -> Color {
        scheme == .dark ? darkCanvas : Color(red: 246 / 255, green: 246 / 255, blue: 244 / 255)
    }

    static func cardBackground(for scheme: ColorScheme) -> Color {
        scheme == .dark
            ? Color(red: 24 / 255, green: 24 / 255, blue: 28 / 255)
            : Color.white
    }

    static func subtleBorder(for scheme: ColorScheme, highContrast: Bool = false) -> Color {
        if highContrast {
            return scheme == .dark ? Color.white.opacity(0.28) : Color.black.opacity(0.24)
        }
        return scheme == .dark ? Color.white.opacity(0.08) : Color.black.opacity(0.07)
    }
}
