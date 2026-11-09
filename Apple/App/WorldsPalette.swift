import SwiftUI

enum WorldsPalette {
    static let darkCanvas = Color(red: 12 / 255, green: 12 / 255, blue: 14 / 255) // #0C0C0E
    static let darkSidebar = Color(red: 18 / 255, green: 18 / 255, blue: 21 / 255) // #121215
    static let raisedSurface = Color(red: 36 / 255, green: 36 / 255, blue: 40 / 255) // #242428
    static let lightPaper = Color(red: 253 / 255, green: 253 / 255, blue: 252 / 255) // #FDFDFC
    static let lightPaperInk = Color(red: 28 / 255, green: 28 / 255, blue: 31 / 255) // #1C1C1F
    static let goldAccent = Color(red: 210 / 255, green: 164 / 255, blue: 110 / 255) // #D2A46E
    static let lightAccent = Color(red: 138 / 255, green: 88 / 255, blue: 32 / 255) // #8A5820

    static func accent(for scheme: ColorScheme) -> Color {
        scheme == .dark ? goldAccent : lightAccent
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
}
