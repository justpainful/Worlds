import SwiftUI
#if os(macOS)
import AppKit
#endif

// Worlds on Apple platforms follows the Windows and web app: a translucent window
// (sidebar on the window material), one calm rounded content panel, and every
// control floating on Liquid Glass in small groups. On iOS and macOS 26 the real
// system glass is used; older systems get materials with a single hairline edge.
// One rule from the Windows glass: a control reads as one piece of glass, never
// nested rings. Selections inside a glass group get a soft lens, no edge.

// MARK: - Motion

enum WorldsMotion {
    /// The Worlds ease, cubic-bezier(0.2, 0.7, 0.2, 1).
    static func ease(_ duration: Double) -> Animation { .timingCurve(0.2, 0.7, 0.2, 1, duration: duration) }
    static let hover = ease(0.11)
    static let tab = ease(0.16)
    static let popover = ease(0.18)
    static let selection = ease(0.22)
    static let spring = Animation.spring(response: 0.32, dampingFraction: 0.82)
}

// MARK: - Window translucency

#if os(macOS)
/// Native AppKit vibrancy (NSVisualEffectView), the macOS counterpart of Windows Mica and Acrylic.
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

private struct WindowGlassBackground: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        #if os(macOS)
        if reduceTransparency {
            content.background(WorldsPalette.windowFallback(for: colorScheme).ignoresSafeArea())
        } else {
            content.background(WorldsVibrancyView(material: .underWindowBackground, blendingMode: .behindWindow).ignoresSafeArea())
        }
        #else
        content.background(WorldsPalette.windowFallback(for: colorScheme).ignoresSafeArea())
        #endif
    }
}

// MARK: - Glass surfaces

private struct NavigationGlassModifier<S: InsettableShape>: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    let shape: S
    let interactive: Bool
    let tint: Color?

    func body(content: Content) -> some View {
        if reduceTransparency {
            content
                .background(WorldsPalette.surface(for: colorScheme), in: shape)
                .overlay(shape.strokeBorder(WorldsPalette.subtleBorder(for: colorScheme, highContrast: contrast == .increased), lineWidth: contrast == .increased ? 1.0 : 0.5))
        } else if #available(iOS 26.0, macOS 26.0, *) {
            content.glassEffect(glass, in: shape)
        } else {
            content
                .background(.regularMaterial, in: shape)
                .background((tint ?? .clear).opacity(0.18), in: shape)
                .overlay(shape.strokeBorder(WorldsPalette.glassEdge(for: colorScheme), lineWidth: 0.5))
                .shadow(color: .black.opacity(colorScheme == .dark ? 0.28 : 0.10), radius: 14, y: 6)
        }
    }

    @available(iOS 26.0, macOS 26.0, *)
    private var glass: Glass {
        var glass = Glass.regular
        if let tint { glass = glass.tint(tint) }
        return interactive ? glass.interactive() : glass
    }
}

/// The calm content panel the Windows app puts beside its translucent sidebar.
private struct ContentPanelModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.colorSchemeContrast) private var contrast
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        content
            .background(WorldsPalette.panel(for: colorScheme), in: shape)
            .clipShape(shape)
            .overlay(shape.strokeBorder(WorldsPalette.subtleBorder(for: colorScheme, highContrast: contrast == .increased), lineWidth: contrast == .increased ? 1 : 0.5))
            .shadow(color: .black.opacity(colorScheme == .dark ? 0.35 : 0.08), radius: 18, y: 8)
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
    /// Translucent window background (macOS vibrancy, a matching solid on iOS). Put it on the root of a window.
    public func worldsWindowGlass() -> some View {
        modifier(WindowGlassBackground())
    }

    /// Liquid Glass for floating chrome: toolbar groups, search capsules, HUDs, tab bars, popovers.
    public func worldsFloatingGlass<S: InsettableShape>(in shape: S = RoundedRectangle(cornerRadius: 14, style: .continuous), interactive: Bool = false, tint: Color? = nil) -> some View {
        modifier(NavigationGlassModifier(shape: shape, interactive: interactive, tint: tint))
    }

    /// Glass capsule for a group of related controls (the Windows toolbar groups).
    public func worldsGlassCapsule(interactive: Bool = true, tint: Color? = nil) -> some View {
        modifier(NavigationGlassModifier(shape: Capsule(), interactive: interactive, tint: tint))
    }

    /// The rounded content panel beside the sidebar, as in the Windows app.
    public func worldsContentPanel(cornerRadius: CGFloat = 22) -> some View {
        modifier(ContentPanelModifier(cornerRadius: cornerRadius))
    }

    /// Quiet surface for document cards, list items and metrics (content is never glass).
    public func worldsContentCard(cornerRadius: CGFloat = 16) -> some View {
        modifier(CalmContentCardModifier(cornerRadius: cornerRadius))
    }

    /// Legacy entry point, routed to the calm card.
    public func worldsGlass(cornerRadius: CGFloat = 16) -> some View {
        modifier(CalmContentCardModifier(cornerRadius: cornerRadius))
    }

    /// Thin glass for floating chrome and bars.
    public func worldsGlassThin(cornerRadius: CGFloat = 12) -> some View {
        modifier(NavigationGlassModifier(shape: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous), interactive: false, tint: nil))
    }

    /// Glass button: `.glass` / `.glassProminent` on 26, a capsule bordered button before.
    @ViewBuilder
    public func worldsGlassButton(prominent: Bool = false) -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            if prominent {
                self.buttonStyle(.glassProminent)
            } else {
                self.buttonStyle(.glass)
            }
        } else {
            if prominent {
                self.buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
            } else {
                self.buttonStyle(.bordered).buttonBorderShape(.capsule)
            }
        }
    }

    /// Sheets and popovers float on glass on 26 by default; older systems get a material.
    @ViewBuilder
    public func worldsSheetGlass() -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            self
        } else {
            self.presentationBackground(.regularMaterial)
        }
    }
}

// MARK: - Glass components

/// Coordinates several glass controls so they blend and morph together on 26.
public struct WorldsGlassChromeGroup<Content: View>: View {
    let spacing: CGFloat
    @ViewBuilder public let content: () -> Content

    public init(spacing: CGFloat = 10, @ViewBuilder content: @escaping () -> Content) {
        self.spacing = spacing
        self.content = content
    }

    public var body: some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content() }
        } else {
            content()
        }
    }
}

/// Capsule status badge for toolbar and HUD use.
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

/// A choice as a glass track with a sliding lens (grid or list, day or week). The lens has no edge.
struct WorldsGlassChoice<Value: Hashable>: View {
    struct Option: Identifiable {
        let value: Value
        let symbol: String
        let label: String
        var id: String { label }
        init(_ value: Value, symbol: String, label: String) {
            self.value = value
            self.symbol = symbol
            self.label = label
        }
    }

    @Binding var selection: Value
    let options: [Option]
    let showsLabels: Bool
    @Namespace private var lens
    @Environment(\.colorScheme) private var colorScheme

    init(selection: Binding<Value>, options: [Option], showsLabels: Bool = false) {
        _selection = selection
        self.options = options
        self.showsLabels = showsLabels
    }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options) { option in
                Button {
                    withAnimation(WorldsMotion.spring) { selection = option.value }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: option.symbol)
                        if showsLabels { Text(option.label) }
                    }
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.horizontal, showsLabels ? 10 : 10)
                    .padding(.vertical, 7)
                    .contentShape(Capsule())
                    .background {
                        if selection == option.value {
                            Capsule()
                                .fill(WorldsPalette.lens(for: colorScheme))
                                .matchedGeometryEffect(id: "lens", in: lens)
                        }
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(selection == option.value ? Color.primary : Color.secondary)
                .accessibilityLabel(option.label)
                .accessibilityAddTraits(selection == option.value ? .isSelected : [])
            }
        }
        .padding(3)
        .worldsGlassCapsule(interactive: false)
    }
}

/// Glass search capsule with the shortcut hint, as at the top of the Windows home.
struct WorldsGlassSearchField: View {
    @Binding var text: String
    let prompt: String
    var shortcut: String? = nil

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField(prompt, text: $text)
                .textFieldStyle(.plain)
            if let shortcut, text.isEmpty {
                Text(shortcut)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(.secondary.opacity(0.14), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .worldsGlassCapsule()
    }
}

/// The colourful rounded app-style icon the Windows sidebar uses for Templates, Automations, Trash and the like.
struct WorldsIconTile: View {
    let symbol: String
    let colors: [Color]
    var size: CGFloat = 26

    init(_ symbol: String, colors: [Color], size: CGFloat = 26) {
        self.symbol = symbol
        self.colors = colors
        self.size = size
    }

    init(_ symbol: String, color: Color, size: CGFloat = 26) {
        self.init(symbol, colors: [color.opacity(0.95), color.opacity(0.72)], size: size)
    }

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                    .strokeBorder(.white.opacity(0.22), lineWidth: 0.5)
            )
            .overlay(
                Image(systemName: symbol)
                    .font(.system(size: size * 0.5, weight: .semibold))
                    .foregroundStyle(.white)
                    .symbolRenderingMode(.hierarchical)
            )
            .frame(width: size, height: size)
            .shadow(color: (colors.first ?? .black).opacity(0.25), radius: 3, y: 1)
            .accessibilityHidden(true)
    }
}

/// The large time-of-day greeting at the top of Home.
enum WorldsGreeting {
    static func text(for date: Date = Date(), calendar: Calendar = .current) -> String {
        let hour = calendar.component(.hour, from: date)
        switch hour {
        case 5..<12: return String(localized: "Good morning")
        case 12..<18: return String(localized: "Good afternoon")
        default: return String(localized: "Good evening")
        }
    }
}
