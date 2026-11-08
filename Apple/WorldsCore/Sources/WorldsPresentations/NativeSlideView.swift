import Foundation
import SwiftUI
import WorldsModels

/// Partial renderer. Attachments and unrecognized elements are represented by
/// labeled placeholders until the native attachment pipeline exists.
public struct NativeSlideView: View {
    public let slide: SlideBlock
    public init(slide: SlideBlock) { self.slide = slide }
    public var body: some View {
        GeometryReader { geometry in
            let scale = max(0, min(geometry.size.width / 1280, geometry.size.height / 720))
            ZStack(alignment: .topLeading) {
                slideColor(slide.attributes["background"]?.slideObject?["color"]?.slideString, fallback: Color(red: 0.086, green: 0.086, blue: 0.102))
                if slide.attributes["background"]?.slideObject?["attachmentId"]?.slideString != nil {
                    Text("Background image unavailable").font(.system(size: 18)).foregroundStyle(.secondary).padding(12)
                }
                ForEach(Array(slide.elements.enumerated()), id: \.offset) { _, element in
                    if valid(element) {
                        slideElement(element)
                            .frame(width: CGFloat(element.width), height: CGFloat(element.height))
                            .opacity(min(1, max(0, element.opacity)))
                            .rotationEffect(.degrees(element.rotation))
                            .position(x: CGFloat(element.x + element.width / 2), y: CGFloat(element.y + element.height / 2))
                    }
                }
            }
            .frame(width: 1280, height: 720)
            .clipped()
            .scaleEffect(scale, anchor: .topLeading)
            .frame(width: 1280 * scale, height: 720 * scale, alignment: .topLeading)
            // Coordinates and CSS left/right are physical regardless of the app direction.
            // Unicode bidirectional text remains resolved by the text renderer.
            .environment(\.layoutDirection, .leftToRight)
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .accessibilityLabel("Presentation slide")
    }
    private func valid(_ element: SlideElement) -> Bool {
        [element.x, element.y, element.width, element.height, element.rotation, element.opacity].allSatisfy(\.isFinite) && element.width > 0 && element.height > 0 && element.width <= 100_000 && element.height <= 100_000
    }
    @ViewBuilder private func slideElement(_ element: SlideElement) -> some View {
        let raw = element.source.slideObject ?? [:]
        switch element.type {
        case "text":
            let style = raw["style"]?.slideObject ?? [:]
            let size = min(2048, max(1, style["fontSize"]?.slideNumber ?? 32))
            let weight = textWeight(style["fontWeight"]?.slideNumber ?? 500)
            let alignment = textAlignment(style["align"]?.slideString)
            let font = (style["font"]?.slideString).map { Font.custom($0, size: CGFloat(size)).weight(weight) } ?? .system(size: CGFloat(size), weight: weight)
            Text(element.text ?? "")
                .font(style["italic"] == .bool(true) ? font.italic() : font)
                .foregroundStyle(slideColor(style["color"]?.slideString, fallback: .white))
                .multilineTextAlignment(alignment)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: frameAlignment(alignment))
                .clipped()
        case "shape":
            let fill = slideColor(raw["fill"]?.slideString, fallback: Color(red: 0.82, green: 0.64, blue: 0.43))
            let border = slideColor(raw["stroke"]?.slideString, fallback: .clear)
            switch raw["shape"]?.slideString {
            case "ellipse": Ellipse().fill(fill).overlay(Ellipse().strokeBorder(border, lineWidth: 2))
            case "line": Capsule().fill(slideColor(raw["stroke"]?.slideString ?? raw["fill"]?.slideString, fallback: .white)).frame(height: 4)
            case "rect", nil: RoundedRectangle(cornerRadius: CGFloat(max(0, min(raw["radius"]?.slideNumber ?? 0, 10000)))).fill(fill).overlay(RoundedRectangle(cornerRadius: CGFloat(max(0, min(raw["radius"]?.slideNumber ?? 0, 10000)))).strokeBorder(border, lineWidth: 2))
            default: placeholder("Unsupported shape")
            }
        case "image", "video":
            placeholder(element.type == "image" ? "Image unavailable" : "Video unavailable")
        default:
            placeholder("Unsupported slide element")
        }
    }
    private func placeholder(_ label: String) -> some View {
        Rectangle().fill(.gray.opacity(0.15)).overlay(Text(label).font(.system(size: 20)).foregroundStyle(.secondary))
    }
}

private func textWeight(_ value: Double) -> Font.Weight {
    if value >= 900 { return .black }
    if value >= 800 { return .heavy }
    if value >= 700 { return .bold }
    if value >= 600 { return .semibold }
    if value >= 500 { return .medium }
    if value >= 400 { return .regular }
    if value >= 300 { return .light }
    if value >= 200 { return .thin }
    return .ultraLight
}
private func textAlignment(_ value: String?) -> TextAlignment {
    switch value { case "center": return .center; case "right": return .trailing; default: return .leading }
}
private func frameAlignment(_ value: TextAlignment) -> Alignment {
    switch value { case .center: return .top; case .trailing: return .topTrailing; default: return .topLeading }
}
private func slideColor(_ value: String?, fallback: Color) -> Color {
    guard let value else { return fallback }
    if value == "transparent" { return .clear }
    if value.hasPrefix("#") {
        let hex = String(value.dropFirst())
        guard (hex.count == 6 || hex.count == 8), let raw = UInt64(hex, radix: 16) else { return fallback }
        let shift = hex.count == 8 ? 8 : 0
        return Color(red: Double((raw >> (16 + shift)) & 255) / 255,
                     green: Double((raw >> (8 + shift)) & 255) / 255,
                     blue: Double((raw >> shift) & 255) / 255,
                     opacity: hex.count == 8 ? Double(raw & 255) / 255 : 1)
    }
    if value.hasPrefix("rgba("), value.hasSuffix(")") {
        let parts = value.dropFirst(5).dropLast().split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        if parts.count == 4, parts.allSatisfy(\.isFinite) { return Color(red: min(255, max(0, parts[0])) / 255, green: min(255, max(0, parts[1])) / 255, blue: min(255, max(0, parts[2])) / 255, opacity: min(1, max(0, parts[3]))) }
    }
    return fallback
}



