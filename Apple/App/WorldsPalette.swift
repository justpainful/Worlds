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

    // Roles shared with the Windows and web app (src/styles/tokens.css).
    static let surfaceDeep = Color(red: 28 / 255, green: 28 / 255, blue: 30 / 255) // #1C1C1E
    static let surfaceRaised = Color(red: 36 / 255, green: 36 / 255, blue: 38 / 255) // #242426
    static let surfaceSidebar = Color(red: 17 / 255, green: 17 / 255, blue: 19 / 255) // #111113

    /// Window behind the sidebar when transparency is off or on iOS.
    static func windowFallback(for scheme: ColorScheme) -> Color {
        scheme == .dark ? surfaceSidebar : Color(red: 235 / 255, green: 235 / 255, blue: 239 / 255) // #EBEBEF
    }

    /// The content panel beside the sidebar.
    static func panel(for scheme: ColorScheme) -> Color {
        scheme == .dark ? surfaceDeep.opacity(0.94) : Color.white.opacity(0.96)
    }

    /// Hairline edge of glass on systems before Liquid Glass.
    static func glassEdge(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color.white.opacity(0.14) : Color.white.opacity(0.65)
    }

    /// The soft selection lens inside a glass group (no edge).
    static func lens(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color.white.opacity(0.14) : Color.black.opacity(0.07)
    }

    /// Sidebar row selection, as on Windows.
    static func sidebarSelection(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color.white.opacity(0.10) : Color.black.opacity(0.06)
    }
}
