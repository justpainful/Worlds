import Foundation
import CoreGraphics
import CoreText
import WorldsModels

public struct DrawingRenderIssue: Sendable, Equatable {
    public let elementID: String
    public let reason: String
}
public struct DrawingRenderReport: Sendable {
    public let renderedNodeCount: Int
    public let issues: [DrawingRenderIssue]
    public var isExact: Bool { false }
}

private extension JSONValue {
    var objectValue: [String: JSONValue]? { if case .object(let v) = self { return v }; return nil }
    var arrayValue: [JSONValue]? { if case .array(let v) = self { return v }; return nil }
    var stringValue: String? { if case .string(let v) = self { return v }; return nil }
    var boolValue: Bool? { if case .bool(let v) = self { return v }; return nil }
    var numberValue: Double? {
        switch self { case .integer(let v): return Double(v); case .number(let v): return v; default: return nil }
    }
}

/// Native CoreGraphics preview of a schema 1 drawing, following the desktop
/// renderer in `src/drawing/renderer.ts`. Layers (including nested groups) are
/// composited in their own transparency layers, so eraser strokes
/// (destination-out) and alpha-locked elements (source-atop) only affect the
/// pixels of their own layer. Masks use alpha, as on the desktop. A report with
/// any issue must never be treated as a lossless render or an authoritative export.
public struct DrawingRenderer {
    public init() {}
    public func render(scene: DrawingScene, frameID: String, in context: CGContext) throws -> DrawingRenderReport {
        guard let root = scene.source.objectValue,
              let frames = root["frames"]?.objectValue, let frame = frames[frameID]?.objectValue,
              let layers = root["layers"]?.objectValue, let nodes = root["nodes"]?.objectValue,
              let layerOrder = root["layerOrder"]?.arrayValue, let nodeOrder = root["nodeOrder"]?.arrayValue,
              let fx = number(frame, "x"), let fy = number(frame, "y"), let fw = number(frame, "w"), let fh = number(frame, "h"),
              fw > 0, fh > 0, fw <= 16384, fh <= 16384, fw * fh <= 64 * 1024 * 1024 else { throw DrawingDataError.invalidScene }
        let environment = RenderEnvironment(nodes: nodes, masks: root["masks"]?.objectValue ?? [:])
        var issues: [DrawingRenderIssue] = []
        var count = 0
        context.saveGState()
        defer { context.restoreGState() }
        context.clip(to: CGRect(x: 0, y: 0, width: fw, height: fh))
        if let name = frame["background"]?.stringValue, let color = color(name) {
            context.setFillColor(color)
            context.fill(CGRect(x: 0, y: 0, width: fw, height: fh))
        } else { issues.append(.init(elementID: frameID, reason: "Unsupported frame background")) }
        context.translateBy(x: -fx, y: -fy)

        // Layer tree as in layers.ts `layerTree`: a parent outside layerOrder makes the layer a root.
        var layerIDs: [String] = []
        for value in layerOrder {
            guard let id = value.stringValue, layers[id]?.objectValue != nil else { throw DrawingDataError.invalidScene }
            layerIDs.append(id)
        }
        let included = Set(layerIDs)
        var children: [String: [String]] = [:]
        var roots: [String] = []
        for id in layerIDs {
            if let parent = layers[id]?.objectValue?["parentId"]?.stringValue, included.contains(parent) {
                children[parent, default: []].append(id)
            } else { roots.append(id) }
        }
        var nodesByLayer: [String: [(String, [String: JSONValue])]] = [:]
        var redactions: [(String, [String: JSONValue])] = []
        for item in nodeOrder {
            guard let nodeID = item.stringValue, let node = nodes[nodeID]?.objectValue else { throw DrawingDataError.invalidScene }
            guard let layerID = node["layerId"]?.stringValue else { continue }
            if node["redaction"]?.boolValue == true { redactions.append((nodeID, node)); continue }
            nodesByLayer[layerID, default: []].append((nodeID, node))
        }

        func renderLayer(_ id: String, depth: Int) {
            guard let layer = layers[id]?.objectValue else { return }
            if layer["visible"]?.boolValue == false { return }
            guard depth <= 64 else {
                issues.append(.init(elementID: id, reason: "Layer groups are nested too deeply to composite"))
                return
            }
            guard let alpha = number(layer, "opacity"), (0...1).contains(alpha),
                  let blendName = layer["blend"]?.stringValue, let blend = blendMode(blendName) else {
                issues.append(.init(elementID: id, reason: "Unsupported layer appearance")); return
            }
            if alpha <= 0 { return }
            context.saveGState()
            context.setAlpha(alpha)
            context.setBlendMode(blend)
            context.beginTransparencyLayer(auxiliaryInfo: nil)
            context.saveGState()
            context.setAlpha(1)
            context.setBlendMode(.normal)
            for (nodeID, node) in nodesByLayer[id] ?? [] {
                guard node["visible"]?.boolValue != false else { continue }
                if let nodeFrame = node["frameId"]?.stringValue, nodeFrame != frameID { continue }
                do {
                    let notes = try drawNode(node, environment: environment, context: context)
                    count += 1
                    issues.append(contentsOf: notes.map { DrawingRenderIssue(elementID: nodeID, reason: $0) })
                } catch {
                    issues.append(.init(elementID: nodeID, reason: String(describing: error)))
                }
            }
            // Child layers are drawn above the group's own elements, then the
            // whole group is composited with the group's opacity and blend.
            for child in children[id] ?? [] { renderLayer(child, depth: depth + 1) }
            context.restoreGState()
            context.endTransparencyLayer()
            context.restoreGState()
        }
        for id in roots { renderLayer(id, depth: 0) }

        // Redactions are painted last as opaque black device-aligned rectangles,
        // as in the desktop renderer, whatever layer opacity or blend is used.
        for (nodeID, node) in redactions {
            guard node["visible"]?.boolValue != false, let layerID = node["layerId"]?.stringValue,
                  ancestorsVisible(layerID, layers: layers) else { continue }
            if let nodeFrame = node["frameId"]?.stringValue, nodeFrame != frameID { continue }
            guard let x = number(node, "x"), let y = number(node, "y"), let w = number(node, "w"), let h = number(node, "h") else {
                issues.append(.init(elementID: nodeID, reason: String(describing: PreviewError.malformed))); continue
            }
            let left = floor(x), top = floor(y)
            context.saveGState()
            context.setAlpha(1)
            context.setBlendMode(.normal)
            context.setFillColor(CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 1))
            context.fill(CGRect(x: left, y: top, width: ceil(x + w) - left, height: ceil(y + h) - top))
            context.restoreGState()
            count += 1
        }
        return DrawingRenderReport(renderedNodeCount: count, issues: issues)
    }
}

private enum PreviewError: Error { case unsupported(String), malformed }
private struct RenderEnvironment {
    let nodes: [String: JSONValue]
    let masks: [String: JSONValue]
}

private func number(_ value: [String: JSONValue], _ key: String) -> CGFloat? {
    guard let v = value[key]?.numberValue, v.isFinite, abs(v) <= 1_000_000_000 else { return nil }
    return CGFloat(v)
}
private func ancestorsVisible(_ id: String, layers: [String: JSONValue]) -> Bool {
    var seen = Set<String>()
    var current: String? = id
    var found = false
    while let layerID = current, !seen.contains(layerID), let layer = layers[layerID]?.objectValue {
        seen.insert(layerID)
        found = true
        if layer["visible"]?.boolValue == false { return false }
        current = layer["parentId"]?.stringValue
    }
    return found
}

// MARK: Colours and blend modes

private func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: a)
}
/// Hex (3, 4, 6 or 8 digits), rgb()/rgba(), `transparent` and common names.
private func color(_ raw: String) -> CGColor? {
    let string = raw.trimmingCharacters(in: .whitespaces).lowercased()
    switch string {
    case "transparent": return CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0)
    case "black": return rgb(0, 0, 0)
    case "white": return rgb(255, 255, 255)
    case "red": return rgb(255, 0, 0)
    case "green": return rgb(0, 128, 0)
    case "lime": return rgb(0, 255, 0)
    case "blue": return rgb(0, 0, 255)
    case "yellow": return rgb(255, 255, 0)
    case "orange": return rgb(255, 165, 0)
    case "purple": return rgb(128, 0, 128)
    case "gray", "grey": return rgb(128, 128, 128)
    default: break
    }
    if string.hasPrefix("#") {
        let s = String(string.dropFirst())
        guard [3, 4, 6, 8].contains(s.count), s.allSatisfy(\.isHexDigit), let raw = UInt64(s, radix: 16) else { return nil }
        if s.count <= 4 {
            let digits = s.compactMap { Int(String($0), radix: 16) }.map { CGFloat($0 * 17) }
            guard digits.count == s.count else { return nil }
            return rgb(digits[0], digits[1], digits[2], digits.count == 4 ? digits[3] / 255 : 1)
        }
        let shift: UInt64 = s.count == 8 ? 8 : 0
        return rgb(CGFloat((raw >> (16 + shift)) & 255), CGFloat((raw >> (8 + shift)) & 255), CGFloat((raw >> shift) & 255),
                   s.count == 8 ? CGFloat(raw & 255) / 255 : 1)
    }
    if string.hasPrefix("rgb"), let open = string.firstIndex(of: "("), string.hasSuffix(")") {
        let body = string[string.index(after: open)..<string.index(before: string.endIndex)]
        let parts = body.split(whereSeparator: { $0 == "," || $0 == " " || $0 == "/" }).map(String.init)
        guard parts.count == 3 || parts.count == 4 else { return nil }
        func channel(_ text: String) -> CGFloat? {
            if text.hasSuffix("%") { return Double(text.dropLast()).map { CGFloat(min(100, max(0, $0)) * 2.55) } }
            return Double(text).map { CGFloat(min(255, max(0, $0))) }
        }
        guard let r = channel(parts[0]), let g = channel(parts[1]), let b = channel(parts[2]) else { return nil }
        var alpha: CGFloat = 1
        if parts.count == 4 {
            if parts[3].hasSuffix("%") { guard let v = Double(parts[3].dropLast()) else { return nil }; alpha = CGFloat(v / 100) }
            else { guard let v = Double(parts[3]) else { return nil }; alpha = CGFloat(v) }
        }
        return rgb(r, g, b, min(1, max(0, alpha)))
    }
    return nil
}
private func blendMode(_ value: String) -> CGBlendMode? {
    switch value { case "source-over", "normal": return .normal; case "multiply": return .multiply; case "screen": return .screen; case "overlay": return .overlay; case "darken": return .darken; case "lighten": return .lighten; default: return nil }
}

// MARK: Node geometry

/// Mirrors affine.ts `nodeMatrix` and geometry.ts `localToWorld`.
private struct NodeGeometry {
    let kind: String
    let x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat, rotation: CGFloat, opacity: CGFloat
    let flipX: Bool, flipY: Bool
    let geometrySize: CGSize?
    let appliesGeometry: Bool

    init(_ node: [String: JSONValue]) throws {
        guard let kind = node["kind"]?.stringValue,
              let x = number(node, "x"), let y = number(node, "y"), let w = number(node, "w"), let h = number(node, "h"),
              w > 0, h > 0, let opacity = number(node, "opacity"), (0...1).contains(opacity),
              let rotation = number(node, "rotation") else { throw PreviewError.malformed }
        self.kind = kind
        self.x = x; self.y = y; self.w = w; self.h = h; self.rotation = rotation; self.opacity = opacity
        flipX = node["flipX"]?.boolValue == true
        flipY = node["flipY"]?.boolValue == true
        if let size = node["geometrySize"], size != .null {
            guard let object = size.objectValue, let gw = number(object, "w"), let gh = number(object, "h"), gw > 0, gh > 0 else { throw PreviewError.malformed }
            geometrySize = CGSize(width: gw, height: gh)
        } else { geometrySize = nil }
        let wrapText = kind == "text" && node["textStyle"]?.objectValue?["resizeMode"]?.stringValue == "wrap"
        appliesGeometry = geometrySize != nil && !wrapText
    }
    /// Placement without content scaling (localToWorld).
    var placement: CGAffineTransform {
        CGAffineTransform(translationX: x + w / 2, y: y + h / 2)
            .rotated(by: rotation * .pi / 180)
            .scaledBy(x: flipX ? -1 : 1, y: flipY ? -1 : 1)
            .translatedBy(x: -w / 2, y: -h / 2)
    }
    /// Full node matrix including nondestructive content scaling (nodeMatrix).
    var transform: CGAffineTransform {
        guard appliesGeometry, let g = geometrySize else { return placement }
        return placement.scaledBy(x: w / g.width, y: h / g.height)
    }
    var contentSize: CGSize { appliesGeometry ? (geometrySize ?? CGSize(width: w, height: h)) : CGSize(width: w, height: h) }
}

// MARK: Masks and effects

/// A `Mask` record. The mask value is the alpha of white paint: the base fill
/// rectangle, then reveal strokes (source-over) and hide strokes
/// (destination-out), then optional inversion over the whole surface.
private struct MaskSpec {
    struct Stroke { let samples: [ToolSample]; let brush: ToolBrush; let reveal: Bool }
    let x: CGFloat, y: CGFloat
    let w: CGFloat?, h: CGFloat?
    let base: CGFloat?
    let linked: Bool, inverted: Bool, hasAsset: Bool
    let strokes: [Stroke]

    init(_ mask: [String: JSONValue]) throws {
        guard let x = number(mask, "x"), let y = number(mask, "y") else { throw PreviewError.malformed }
        self.x = x; self.y = y
        w = number(mask, "w"); h = number(mask, "h"); base = number(mask, "base")
        linked = mask["linked"]?.boolValue == true
        inverted = mask["inverted"]?.boolValue == true
        if let asset = mask["assetId"]?.stringValue, !asset.isEmpty { hasAsset = true } else { hasAsset = false }
        var strokes: [Stroke] = []
        if let list = mask["strokes"], list != .null {
            guard let array = list.arrayValue else { throw PreviewError.malformed }
            for value in array {
                guard let stroke = value.objectValue, let brush = stroke["brush"]?.objectValue,
                      let samples = stroke["samples"]?.arrayValue else { throw PreviewError.malformed }
                strokes.append(Stroke(samples: try parseSamples(samples), brush: normalizedBrush(brush), reveal: stroke["reveal"]?.boolValue == true))
            }
        }
        self.strokes = strokes
    }
}

/// Effects with a CSS filter equivalent in the desktop vector path (`canvasEffect`).
private enum PixelEffect {
    case brightness(Double), contrast(Double), saturate(Double), grayscale(Double), invert(Double), blur(Double)
    var blurAmount: Double { if case .blur(let v) = self { return v }; return 0 }
}
private struct PlannedEffect { let effect: PixelEffect; let mask: MaskSpec? }

private func planEffects(_ node: [String: JSONValue], environment: RenderEnvironment, notes: inout [String]) throws -> [PlannedEffect] {
    guard let list = node["effects"], list != .null else { return [] }
    guard let array = list.arrayValue else { throw PreviewError.malformed }
    var planned: [PlannedEffect] = []
    for value in array {
        guard let effect = value.objectValue else { throw PreviewError.malformed }
        guard effect["enabled"]?.boolValue == true else { continue }
        let kind = effect["kind"]?.stringValue ?? "unknown"
        guard let amount = effect["amount"]?.numberValue, amount.isFinite else {
            notes.append("The \(kind) adjustment has no valid amount and was skipped"); continue
        }
        let pixel: PixelEffect
        switch kind {
        case "brightness": pixel = .brightness(max(0, 1 + amount))
        case "contrast": pixel = .contrast(max(0, 1 + amount))
        case "saturation": pixel = .saturate(max(0, 1 + amount))
        case "grayscale", "invert", "blur":
            guard amount >= 0 else { notes.append("The \(kind) adjustment has a negative amount and was skipped"); continue }
            if kind == "grayscale" { pixel = PixelEffect.grayscale(min(1, amount)) }
            else if kind == "invert" { pixel = PixelEffect.invert(min(1, amount)) }
            else { pixel = PixelEffect.blur(amount) }
        default:
            // temperature, sharpen and pixelate only exist for images on the desktop.
            notes.append("The \(kind) adjustment is not supported on vector elements and was skipped"); continue
        }
        var mask: MaskSpec?
        if let maskValue = effect["maskId"], maskValue != .null {
            // A missing mask must never expand an adjustment to the whole element.
            guard let maskID = maskValue.stringValue, let record = environment.masks[maskID]?.objectValue else {
                notes.append("The \(kind) adjustment mask is missing, so the adjustment was skipped"); continue
            }
            if record["enabled"]?.boolValue == true {
                guard let spec = try? MaskSpec(record) else {
                    notes.append("The \(kind) adjustment mask is malformed, so the adjustment was skipped"); continue
                }
                if spec.hasAsset {
                    notes.append("The \(kind) adjustment mask uses an image the native preview does not load, so the adjustment was skipped"); continue
                }
                mask = spec
            }
        }
        planned.append(PlannedEffect(effect: pixel, mask: mask))
    }
    return planned
}

// MARK: Node compositing

private func drawNode(_ node: [String: JSONValue], environment: RenderEnvironment, context: CGContext) throws -> [String] {
    let geometry = try NodeGeometry(node)
    let erase = node["erase"]?.boolValue == true
    let alphaLock = !erase && node["alphaLock"]?.boolValue == true
    var notes: [String] = []
    var nodeMask: MaskSpec?
    if let maskValue = node["maskId"], maskValue != .null {
        guard let maskID = maskValue.stringValue, let record = environment.masks[maskID]?.objectValue else {
            throw PreviewError.unsupported("The element mask is missing")
        }
        if record["enabled"]?.boolValue == true {
            let spec = try MaskSpec(record)
            if spec.hasAsset { notes.append("The mask image is not loaded by the native preview; only the mask base and strokes are applied") }
            nodeMask = spec
        }
    }
    let effects = try planEffects(node, environment: environment, notes: &notes)

    guard erase || alphaLock || nodeMask != nil || !effects.isEmpty else {
        if let note = try drawContent(node, geometry: geometry, environment: environment, context: context) { notes.append(note) }
        return notes
    }

    // Render the element alone into a device-aligned surface, apply effects and
    // the mask there, then composite it once with the element's operation.
    let ctm = context.ctm
    let deviceScale = sqrt(abs(ctm.a * ctm.d - ctm.b * ctm.c))
    guard deviceScale.isFinite, deviceScale > 0 else { return notes }
    let blurPad = CGFloat(effects.reduce(0) { max($0, $1.effect.blurAmount) }) * 3 + 2
    var region = try contentBounds(node, geometry: geometry, environment: environment)
        .insetBy(dx: -blurPad, dy: -blurPad).applying(ctm)
    let clip = context.boundingBoxOfClipPath
    if !clip.isNull, !clip.isInfinite {
        region = region.intersection(clip.applying(ctm).insetBy(dx: -blurPad * deviceScale, dy: -blurPad * deviceScale))
    }
    guard !region.isNull, !region.isEmpty else { return notes }
    region = region.integral
    guard region.width <= 16384, region.height <= 16384, region.width * region.height <= 16 * 1024 * 1024 else {
        throw PreviewError.unsupported("The element is too large to composite in the native preview")
    }
    guard let surface = RasterSurface(width: Int(region.width), height: Int(region.height)) else {
        throw PreviewError.unsupported("The compositing surface could not be created")
    }
    let base = ctm.concatenating(CGAffineTransform(translationX: -region.minX, y: -region.minY))
    surface.context.concatenate(base)
    if let note = try drawContent(node, geometry: geometry, environment: environment, context: surface.context) { notes.append(note) }
    for planned in effects {
        if let mask = planned.mask {
            let original = surface.snapshot()
            let alpha = try maskAlpha(mask, geometry: geometry, base: base, width: surface.width, height: surface.height)
            surface.apply(planned.effect, deviceScale: Double(deviceScale))
            surface.mix(original: original, mask: alpha)
        } else {
            surface.apply(planned.effect, deviceScale: Double(deviceScale))
        }
    }
    if let nodeMask {
        let alpha = try maskAlpha(nodeMask, geometry: geometry, base: base, width: surface.width, height: surface.height)
        surface.multiply(by: alpha)
    }
    guard let image = surface.context.makeImage() else { throw PreviewError.unsupported("The compositing surface could not be read") }
    context.saveGState()
    context.concatenate(ctm.inverted())
    context.setAlpha(1)
    context.setBlendMode(erase ? .destinationOut : alphaLock ? .sourceAtop : .normal)
    context.interpolationQuality = .none
    context.draw(image, in: region)
    context.restoreGState()
    return notes
}

/// World-space bounds of everything an element can paint.
private func contentBounds(_ node: [String: JSONValue], geometry: NodeGeometry, environment: RenderEnvironment) throws -> CGRect {
    if geometry.kind == "shape", let arrow = try anchoredArrow(node, geometry: geometry, environment: environment) {
        let pad = max(10 * arrow.scale, arrow.paint.strokeWidth * 4) + arrow.paint.strokeWidth + 2
        return CGRect(x: min(arrow.start.x, arrow.end.x), y: min(arrow.start.y, arrow.end.y),
                      width: abs(arrow.end.x - arrow.start.x), height: abs(arrow.end.y - arrow.start.y)).insetBy(dx: -pad, dy: -pad)
    }
    var local = CGRect(origin: .zero, size: geometry.contentSize)
    var pad: CGFloat = 2
    if geometry.kind == "shape" {
        let paint = ShapePaint(node["paint"]?.objectValue ?? [:])
        pad += max(10, paint.strokeWidth * 4) + paint.strokeWidth
        for point in shapeControlPoints(node) { local = local.union(CGRect(origin: point, size: .zero)) }
    } else if geometry.kind == "stroke", let samples = node["samples"]?.arrayValue {
        let size = number(node["brush"]?.objectValue ?? [:], "size") ?? 12
        pad += min(4096, max(1, size)) * 1.2 + 2
        for value in samples {
            if let sample = value.objectValue, let x = number(sample, "x"), let y = number(sample, "y") {
                local = local.union(CGRect(x: x, y: y, width: 0, height: 0))
            }
        }
    }
    return local.insetBy(dx: -pad, dy: -pad).applying(geometry.transform)
}

private func maskAlpha(_ mask: MaskSpec, geometry: NodeGeometry, base: CGAffineTransform, width: Int, height: Int) throws -> [UInt8] {
    guard let surface = RasterSurface(width: width, height: height) else { throw PreviewError.unsupported("The mask surface could not be created") }
    let c = surface.context
    c.concatenate(base)
    if mask.linked { c.concatenate(geometry.transform) }
    let mw = mask.w ?? (mask.linked ? (geometry.geometrySize?.width ?? geometry.w) : geometry.w)
    let mh = mask.h ?? (mask.linked ? (geometry.geometrySize?.height ?? geometry.h) : geometry.h)
    let fill = min(1, max(0, mask.base ?? (mask.hasAsset ? 0 : 1)))
    c.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: fill))
    c.fill(CGRect(x: mask.x, y: mask.y, width: mw, height: mh))
    let white = CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)
    for stroke in mask.strokes {
        let dabs = try StrokeDabEngine.generate(samples: stroke.samples, brush: stroke.brush)
        let gradient = CGGradient(colorsSpace: drawingColorSpace(), colors: [white, white.copy(alpha: 0) ?? white] as CFArray, locations: [0, 1])
        c.saveGState()
        c.setBlendMode(stroke.reveal ? .normal : .destinationOut)
        c.setFillColor(white)
        for dab in dabs {
            c.saveGState()
            c.translateBy(x: dab.x, y: dab.y)
            c.rotate(by: dab.angle * .pi / 180)
            c.scaleBy(x: 1, y: dab.roundness)
            c.setAlpha(dab.opacity * stroke.brush.opacity)
            let r = dab.size / 2
            if stroke.brush.hardness < 0.99, let gradient {
                c.addEllipse(in: CGRect(x: -r, y: -r, width: r * 2, height: r * 2))
                c.clip()
                c.drawRadialGradient(gradient, startCenter: .zero, startRadius: r * stroke.brush.hardness, endCenter: .zero, endRadius: r, options: [.drawsBeforeStartLocation])
            } else {
                c.fillEllipse(in: CGRect(x: -r, y: -r, width: r * 2, height: r * 2))
            }
            c.restoreGState()
        }
        c.restoreGState()
    }
    var alpha = surface.alphaChannel()
    if mask.inverted { for i in alpha.indices { alpha[i] = 255 - alpha[i] } }
    return alpha
}

// MARK: Element content

private func drawContent(_ node: [String: JSONValue], geometry: NodeGeometry, environment: RenderEnvironment, context: CGContext) throws -> String? {
    context.saveGState()
    defer { context.restoreGState() }
    if geometry.kind == "shape", let arrow = try anchoredArrow(node, geometry: geometry, environment: environment) {
        context.setAlpha(geometry.opacity)
        context.translateBy(x: arrow.start.x, y: arrow.start.y)
        var paint = arrow.paint
        paint.strokeWidth *= arrow.scale
        drawArrow(context, from: .zero, to: CGPoint(x: arrow.end.x - arrow.start.x, y: arrow.end.y - arrow.start.y),
                  paint: paint, both: node["shape"]?.stringValue == "double-arrow", headScale: arrow.scale)
        return arrow.missing ? "An attached arrow endpoint is missing and uses its fallback position" : nil
    }
    context.concatenate(geometry.transform)
    let size = geometry.contentSize
    switch geometry.kind {
    case "shape":
        context.setAlpha(geometry.opacity)
        return drawShape(node, size: size, context: context)
    case "stroke":
        return try drawStroke(node, opacity: geometry.opacity, context: context)
    case "text":
        context.setAlpha(geometry.opacity)
        drawText(node, width: size.width, height: size.height, context: context)
        return nil
    default:
        throw PreviewError.unsupported("Element type is not implemented")
    }
}

// MARK: Shapes

/// `Paint` with missing fields defaulted to `DEFAULT_PAINT` in model.ts.
private struct ShapePaint {
    var fill: CGColor, stroke: CGColor, strokeWidth: CGFloat, dash: [CGFloat], cap: CGLineCap, radius: CGFloat
    var fillVisible: Bool, strokeVisible: Bool
    var gradient: [String: JSONValue]?
    var unreadable: [String] = []

    init(_ paint: [String: JSONValue]) {
        func paintColor(_ key: String, _ fallback: String) -> (CGColor, Bool) {
            let text = paint[key]?.stringValue ?? fallback
            if let parsed = color(text) { return (parsed, text.trimmingCharacters(in: .whitespaces).lowercased() != "transparent") }
            return (color(fallback) ?? rgb(32, 32, 35), fallback != "transparent")
        }
        var unreadable: [String] = []
        if let text = paint["fill"]?.stringValue, color(text) == nil { unreadable.append(text) }
        if let text = paint["stroke"]?.stringValue, color(text) == nil { unreadable.append(text) }
        let fillColor = paintColor("fill", "transparent"), strokeColor = paintColor("stroke", "#202023")
        fill = fillColor.0
        fillVisible = fillColor.1
        stroke = strokeColor.0
        strokeVisible = strokeColor.1
        strokeWidth = min(2048, max(0, number(paint, "strokeWidth") ?? 3))
        dash = (paint["dash"]?.arrayValue ?? []).compactMap { $0.numberValue }.filter { $0.isFinite && $0 >= 0 }.map { CGFloat($0) }
        switch paint["cap"]?.stringValue ?? "round" { case "butt": cap = .butt; case "square": cap = .square; default: cap = .round }
        radius = max(0, number(paint, "radius") ?? 16)
        gradient = paint["gradient"]?.objectValue
        self.unreadable = unreadable
    }
    func applyStroke(_ c: CGContext) {
        c.setStrokeColor(stroke)
        c.setLineWidth(strokeWidth)
        if dash.reduce(0, +) > 0 { c.setLineDash(phase: 0, lengths: dash) } else { c.setLineDash(phase: 0, lengths: []) }
        c.setLineCap(cap)
        c.setLineJoin(.round)
    }
}

private struct AnchoredArrow { let start: CGPoint; let end: CGPoint; let scale: CGFloat; let paint: ShapePaint; let missing: Bool }
/// Shapes attached with `anchor` are drawn as arrows between anchor points (geometry.ts `anchorPoint`).
private func anchoredArrow(_ node: [String: JSONValue], geometry: NodeGeometry, environment: RenderEnvironment) throws -> AnchoredArrow? {
    guard let anchor = node["anchor"]?.objectValue else { return nil }
    func resolve(_ anchor: [String: JSONValue]) throws -> (CGPoint, Bool) {
        let u = number(anchor, "u") ?? 0, v = number(anchor, "v") ?? 0
        if let id = anchor["nodeId"]?.stringValue, let target = environment.nodes[id]?.objectValue, let placed = try? NodeGeometry(target) {
            return (CGPoint(x: placed.w * u, y: placed.h * v).applying(placed.placement), false)
        }
        guard let fallback = anchor["fallback"]?.objectValue, let x = number(fallback, "x"), let y = number(fallback, "y") else { throw PreviewError.malformed }
        return (CGPoint(x: x, y: y), anchor["nodeId"]?.stringValue != nil)
    }
    let (start, startMissing) = try resolve(anchor)
    var end = CGPoint(x: geometry.x + geometry.w, y: geometry.y + geometry.h)
    var endMissing = false
    if let endAnchor = node["endAnchor"]?.objectValue { (end, endMissing) = try resolve(endAnchor) }
    let scale = geometry.geometrySize.map { sqrt(geometry.w / $0.width * geometry.h / $0.height) } ?? 1
    return AnchoredArrow(start: start, end: end, scale: scale, paint: ShapePaint(node["paint"]?.objectValue ?? [:]), missing: startMissing || endMissing)
}

private func drawArrow(_ c: CGContext, from a: CGPoint, to b: CGPoint, paint: ShapePaint, both: Bool, headScale: CGFloat) {
    guard paint.strokeWidth > 0, paint.strokeVisible else { return }
    paint.applyStroke(c)
    c.move(to: a); c.addLine(to: b); c.strokePath()
    func head(_ p: CGPoint, _ q: CGPoint) {
        let angle = atan2(p.y - q.y, p.x - q.x), size = max(10 * headScale, paint.strokeWidth * 4)
        c.move(to: p); c.addLine(to: CGPoint(x: p.x - size * cos(angle - 0.45), y: p.y - size * sin(angle - 0.45)))
        c.move(to: p); c.addLine(to: CGPoint(x: p.x - size * cos(angle + 0.45), y: p.y - size * sin(angle + 0.45)))
        c.strokePath()
    }
    head(b, a)
    if both { head(a, b) }
}

private func point(_ value: JSONValue?) -> CGPoint? {
    guard let object = value?.objectValue, let x = number(object, "x"), let y = number(object, "y") else { return nil }
    return CGPoint(x: x, y: y)
}
private func shapeControlPoints(_ node: [String: JSONValue]) -> [CGPoint] {
    var result: [CGPoint] = []
    for value in node["points"]?.arrayValue ?? [] { if let p = point(value) { result.append(p) } }
    for value in node["path"]?.objectValue?["vertices"]?.arrayValue ?? [] {
        guard let vertex = value.objectValue else { continue }
        for p in [point(value), point(vertex["in"]), point(vertex["out"])] { if let p { result.append(p) } }
    }
    return result
}

private let knownShapes: Set<String> = ["rect", "roundrect", "ellipse", "triangle", "right-triangle", "polygon", "star", "line", "polyline", "curve", "arrow", "double-arrow", "callout", "number", "highlight"]

/// Mirrors `drawShape` in renderer.ts, including its fallback to a rectangle.
private func drawShape(_ node: [String: JSONValue], size: CGSize, context c: CGContext) -> String? {
    let paint = ShapePaint(node["paint"]?.objectValue ?? [:])
    let w = size.width, h = size.height
    let shape = node["shape"]?.stringValue ?? ""
    var notes = ["Shape preview is not pixel matched to the original renderer"]
    if !paint.unreadable.isEmpty { notes.append("Unrecognised paint colour uses the default") }
    if shape == "arrow" || shape == "double-arrow" {
        let points = (node["points"]?.arrayValue ?? []).compactMap { point($0) }
        drawArrow(c, from: points.first ?? .zero, to: points.last ?? CGPoint(x: w, y: h), paint: paint, both: shape == "double-arrow", headScale: 1)
        return notes.joined(separator: "; ")
    }
    if !knownShapes.contains(shape) { notes.append("Unknown shape type is drawn as a rectangle") }
    let path = CGMutablePath()
    let points = (node["points"]?.arrayValue ?? []).compactMap { point($0) }
    if let editable = node["path"]?.objectValue, let vertices = editable["vertices"]?.arrayValue?.compactMap({ $0.objectValue }), let first = vertices.first.flatMap({ point(.object($0)) }) {
        let closed = editable["closed"]?.boolValue == true
        path.move(to: first)
        let count = closed ? vertices.count : vertices.count - 1
        if count > 0 {
            for index in 0..<count {
                let a = vertices[index], b = vertices[(index + 1) % vertices.count]
                guard let pa = point(.object(a)), let pb = point(.object(b)) else { continue }
                let out = point(a["out"]), into = point(b["in"])
                if out != nil || into != nil { path.addCurve(to: pb, control1: out ?? pa, control2: into ?? pb) } else { path.addLine(to: pb) }
            }
        }
        if closed { path.closeSubpath() }
    } else if !points.isEmpty {
        path.move(to: points[0])
        for p in points.dropFirst() { path.addLine(to: p) }
        if !["line", "polyline", "curve"].contains(shape) { path.closeSubpath() }
    } else {
        switch shape {
        case "ellipse", "number": path.addEllipse(in: CGRect(x: 0, y: 0, width: w, height: h))
        case "triangle": path.addLines(between: [CGPoint(x: w / 2, y: 0), CGPoint(x: w, y: h), CGPoint(x: 0, y: h)]); path.closeSubpath()
        case "right-triangle": path.addLines(between: [.zero, CGPoint(x: 0, y: h), CGPoint(x: w, y: h)]); path.closeSubpath()
        case "line": path.move(to: .zero); path.addLine(to: CGPoint(x: w, y: h))
        case "star", "polygon":
            let sides = shape == "star" ? 10 : 6
            for i in 0..<sides {
                let angle = CGFloat(i) * .pi * 2 / CGFloat(sides) - .pi / 2
                let r: CGFloat = shape == "star" && i % 2 == 1 ? 0.42 : 1
                let p = CGPoint(x: w / 2 + cos(angle) * w / 2 * r, y: h / 2 + sin(angle) * h / 2 * r)
                if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
            }
            path.closeSubpath()
        case "callout":
            let b = h * 0.75, r = min(paint.radius, w / 2, b / 2)
            path.move(to: CGPoint(x: r, y: 0))
            path.addLine(to: CGPoint(x: w - r, y: 0))
            path.addQuadCurve(to: CGPoint(x: w, y: r), control: CGPoint(x: w, y: 0))
            path.addLine(to: CGPoint(x: w, y: b - r))
            path.addQuadCurve(to: CGPoint(x: w - r, y: b), control: CGPoint(x: w, y: b))
            path.addLine(to: CGPoint(x: w * 0.55, y: b))
            path.addLine(to: CGPoint(x: w * 0.35, y: h))
            path.addLine(to: CGPoint(x: w * 0.35, y: b))
            path.addLine(to: CGPoint(x: r, y: b))
            path.addQuadCurve(to: CGPoint(x: 0, y: b - r), control: CGPoint(x: 0, y: b))
            path.addLine(to: CGPoint(x: 0, y: r))
            path.addQuadCurve(to: CGPoint(x: r, y: 0), control: .zero)
            path.closeSubpath()
        case "roundrect":
            let r = min(paint.radius, w / 2, h / 2)
            path.addPath(CGPath(roundedRect: CGRect(x: 0, y: 0, width: w, height: h), cornerWidth: r, cornerHeight: r, transform: nil))
        default: path.addRect(CGRect(x: 0, y: 0, width: w, height: h))
        }
    }
    if let gradient = paint.gradient {
        if !fillGradient(gradient, path: path, context: c) { notes.append("Malformed gradient fill was skipped") }
    } else if paint.fillVisible {
        c.setFillColor(paint.fill)
        c.addPath(path)
        c.fillPath(using: .winding)
    }
    if paint.strokeWidth > 0, paint.strokeVisible {
        paint.applyStroke(c)
        c.addPath(path)
        c.strokePath()
    }
    if shape == "number" {
        let value = node["number"]?.numberValue ?? 1
        let label = value == value.rounded() && abs(value) < 1e15 ? String(Int64(value)) : String(value)
        drawCenteredLabel(label, size: min(w, h) * 0.55, color: paint.stroke, center: CGPoint(x: w / 2, y: h / 2), context: c)
    }
    return notes.joined(separator: "; ")
}

private func fillGradient(_ gradient: [String: JSONValue], path: CGPath, context c: CGContext) -> Bool {
    guard let type = gradient["type"]?.stringValue, type == "linear" || type == "radial",
          let from = point(gradient["from"]), let to = point(gradient["to"]),
          let stopValues = gradient["stops"]?.arrayValue, stopValues.count >= 2 else { return false }
    var stops: [(CGFloat, CGColor)] = []
    for value in stopValues {
        guard let stop = value.objectValue, let at = number(stop, "at"), let text = stop["color"]?.stringValue, let parsed = color(text) else { return false }
        stops.append((min(1, max(0, at)), parsed))
    }
    // Canvas interpolates premultiplied colours, so a transparent stop fades the
    // neighbouring colour instead of passing through black.
    var colors = stops.map { $0.1 }
    for i in colors.indices where colors[i].alpha == 0 {
        let neighbour = (colors[..<i].last(where: { $0.alpha > 0 })) ?? colors[(i + 1)...].first(where: { $0.alpha > 0 })
        if let neighbour, let faded = neighbour.copy(alpha: 0) { colors[i] = faded }
    }
    guard let cg = CGGradient(colorsSpace: drawingColorSpace(), colors: colors as CFArray, locations: stops.map { $0.0 }) else { return false }
    c.saveGState()
    c.addPath(path)
    c.clip(using: .winding)
    if type == "linear" {
        c.drawLinearGradient(cg, start: from, end: to, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    } else {
        c.drawRadialGradient(cg, startCenter: from, startRadius: 0, endCenter: from, endRadius: hypot(to.x - from.x, to.y - from.y), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    }
    c.restoreGState()
    return true
}

private func drawCenteredLabel(_ text: String, size: CGFloat, color: CGColor, center: CGPoint, context c: CGContext) {
    guard size > 0 else { return }
    let regular = CTFontCreateUIFontForLanguage(.system, size, nil) ?? CTFontCreateWithName("Helvetica" as CFString, size, nil)
    let font = CTFontCreateCopyWithSymbolicTraits(regular, size, nil, .traitBold, .traitBold) ?? regular
    let attributes: [CFString: Any] = [kCTFontAttributeName: font, kCTForegroundColorAttributeName: color]
    guard let string = CFAttributedStringCreate(kCFAllocatorDefault, text as CFString, attributes as CFDictionary) else { return }
    let line = CTLineCreateWithAttributedString(string)
    var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
    let width = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, &leading))
    c.saveGState()
    c.translateBy(x: center.x, y: center.y)
    c.scaleBy(x: 1, y: -1)
    c.textMatrix = .identity
    c.textPosition = CGPoint(x: -width / 2, y: -(ascent - descent) / 2)
    CTLineDraw(line, c)
    c.restoreGState()
}

// MARK: Strokes

private let brushKinds: Set<String> = ["pencil", "hard", "soft", "ink", "marker", "highlighter", "spray", "texture", "calligraphy", "oil", "crayon", "natural-pencil", "watercolor"]

/// brushConfig.ts `normalizeBrush`.
private func normalizedBrush(_ b: [String: JSONValue]) -> ToolBrush {
    var brush = ToolBrush()
    func value(_ key: String, _ fallback: Double, _ low: Double, _ high: Double) -> Double {
        guard let v = b[key]?.numberValue, v.isFinite else { return fallback }
        return min(high, max(low, v))
    }
    if let kind = b["kind"]?.stringValue, brushKinds.contains(kind) { brush.kind = kind }
    brush.size = value("size", 12, 1, 2048); brush.opacity = value("opacity", 1, 0, 1); brush.flow = value("flow", 1, 0, 1)
    brush.hardness = value("hardness", 1, 0, 1); brush.spacing = value("spacing", 0.12, 0.01, 2)
    brush.roundness = value("roundness", 1, 0.05, 1); brush.angle = value("angle", 0, -360, 360)
    brush.smoothing = value("smoothing", 0.15, 0, 0.95); brush.stabilizer = value("stabilizer", 0, 0, 100)
    brush.taperStart = value("taperStart", 0, 0, 0.5); brush.taperEnd = value("taperEnd", 0, 0, 0.5)
    brush.pressureCurve = value("pressureCurve", 1, 0.1, 4)
    if let v = b["pressureSize"]?.boolValue { brush.pressureSize = v }
    if let v = b["pressureOpacity"]?.boolValue { brush.pressureOpacity = v }
    if let v = b["pressureFlow"]?.boolValue { brush.pressureFlow = v }
    if let c = b["color"]?.stringValue, !c.isEmpty, c.count <= 128 { brush.color = c }
    if let tip = b["tipAssetId"]?.stringValue, !tip.isEmpty, tip.count <= 160 { brush.tipAssetId = tip }
    brush.straightLine = b["straightLine"]?.boolValue
    return brush
}

private func parseSamples(_ values: [JSONValue]) throws -> [ToolSample] {
    guard values.count <= 65536 else { throw PreviewError.malformed }
    return try values.map { value in
        guard let sample = value.objectValue, let x = sample["x"]?.numberValue, let y = sample["y"]?.numberValue, x.isFinite, y.isFinite else { throw PreviewError.malformed }
        func field(_ key: String, _ fallback: Double) throws -> Double {
            guard let raw = sample[key], raw != .null else { return fallback }
            guard let v = raw.numberValue, v.isFinite else { throw PreviewError.malformed }
            return v
        }
        let pressure = try field("pressure", 1), tiltX = try field("tiltX", 0), tiltY = try field("tiltY", 0), time = try field("time", 0)
        return ToolSample(x: x, y: y, pressure: pressure, tiltX: tiltX, tiltY: tiltY, time: time)
    }
}

/// uniformStroke.ts `straightStrokeSamples`.
private func straightened(_ samples: [ToolSample]) -> [ToolSample] {
    guard samples.count >= 2, let start = samples.first, let end = samples.last else { return samples }
    var positions = [Double](repeating: 0, count: samples.count)
    for i in 1..<samples.count { positions[i] = positions[i - 1] + hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y) }
    let total = positions[samples.count - 1]
    return samples.enumerated().map { i, sample in
        let at = total != 0 ? positions[i] / total : Double(i) / Double(samples.count - 1)
        var copy = sample
        copy.x = start.x + (end.x - start.x) * at
        copy.y = start.y + (end.y - start.y) * at
        return copy
    }
}

/// uniformStroke.ts `uniformStrokeRadii`.
private func uniformRadii(_ samples: [ToolSample], _ brush: ToolBrush) -> [CGFloat] {
    var positions = [Double](repeating: 0, count: samples.count)
    for i in samples.indices.dropFirst() { positions[i] = positions[i - 1] + hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y) }
    let total = positions.last ?? 0
    return samples.indices.map { i in
        let pressure = pow(max(0.01, min(1, samples[i].pressure)), brush.pressureCurve)
        let start = brush.taperStart != 0 && total != 0 ? positions[i] / (total * brush.taperStart) : 1
        let end = brush.taperEnd != 0 && total != 0 ? (total - positions[i]) / (total * brush.taperEnd) : 1
        return CGFloat(max(0.2, brush.size * (brush.pressureSize ? pressure : 1) * max(0.03, min(1, start, end))) / 2)
    }
}

/// Strokes follow `drawStroke`: marker and highlighter are uniform vector
/// strokes; every other brush paints the source dabs (`StrokeDabEngine`) with
/// the per-kind pigment rules of `paintDab`. The stroke is grouped so the
/// element and brush opacity apply once to the whole stroke.
private func drawStroke(_ node: [String: JSONValue], opacity: CGFloat, context c: CGContext) throws -> String? {
    guard let brushObject = node["brush"]?.objectValue, let values = node["samples"]?.arrayValue, !values.isEmpty else { throw PreviewError.malformed }
    let brush = normalizedBrush(brushObject)
    let samples = try parseSamples(values)
    var notes: [String] = []
    let ink: CGColor
    if let parsed = color(brush.color) { ink = parsed } else { ink = rgb(32, 32, 35); notes.append("Unrecognised brush colour uses the default") }
    let uniform = brush.kind == "marker" || brush.kind == "highlighter"
    var dabs: [StrokeDab] = []
    if !uniform {
        let seed = node["seed"]?.numberValue.flatMap { $0.isFinite && abs($0) <= Double(Int32.max) ? Int32($0) : nil } ?? 1
        dabs = try StrokeDabEngine.generate(samples: samples, brush: brush, seed: seed)
        notes.append("Brush preview paints the source dabs but is not pixel matched to the original tile rasterizer")
        if brush.kind == "texture" { notes.append("Brush tip images are not loaded by the native preview; texture dabs are round") }
    } else {
        notes.append("Marker and highlighter preview is not pixel matched to the original renderer")
    }
    c.saveGState()
    c.setAlpha(opacity * brush.opacity * (uniform ? brush.flow : 1))
    c.beginTransparencyLayer(auxiliaryInfo: nil)
    c.saveGState()
    c.setAlpha(1)
    c.setBlendMode(.normal)
    if uniform { drawUniformStroke(brush.straightLine == true ? straightened(samples) : samples, brush: brush, ink: ink, context: c) }
    else {
        let soft = CGGradient(colorsSpace: drawingColorSpace(), colors: [ink.copy(alpha: 1) ?? ink, ink.copy(alpha: 0) ?? ink] as CFArray, locations: [0, 1])
        let wash = CGGradient(colorsSpace: drawingColorSpace(), colors: [ink, ink, ink.copy(alpha: 0) ?? ink] as CFArray, locations: [0, 0.65, 1])
        for dab in dabs { paintDab(dab, brush: brush, ink: ink, soft: soft, wash: wash, context: c) }
    }
    c.restoreGState()
    c.endTransparencyLayer()
    c.restoreGState()
    return notes.joined(separator: "; ")
}

private func drawUniformStroke(_ samples: [ToolSample], brush: ToolBrush, ink: CGColor, context c: CGContext) {
    guard !samples.isEmpty else { return }
    c.setFillColor(ink)
    c.setStrokeColor(ink)
    c.setLineWidth(brush.size)
    c.setLineJoin(.round)
    c.setLineCap(brush.kind == "highlighter" ? .butt : .round)
    let points = samples.map { CGPoint(x: $0.x, y: $0.y) }
    if samples.count == 1 {
        let r = uniformRadii(samples, brush)[0], p = points[0]
        if brush.kind == "marker" { c.fillEllipse(in: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)) }
        else { c.fill(CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)) }
    } else if !brush.pressureSize && brush.taperStart == 0 && brush.taperEnd == 0 {
        c.addLines(between: points)
        c.strokePath()
    } else {
        let radii = uniformRadii(samples, brush)
        let path = CGMutablePath()
        var segments = 0
        for i in 1..<points.count {
            let p = points[i - 1], q = points[i], dx = q.x - p.x, dy = q.y - p.y, length = hypot(dx, dy)
            guard length > 0 else { continue }
            let nx = -dy / length, ny = dx / length, a = radii[i - 1], z = radii[i]
            segments += 1
            path.move(to: CGPoint(x: p.x + nx * a, y: p.y + ny * a))
            path.addLine(to: CGPoint(x: p.x - nx * a, y: p.y - ny * a))
            path.addLine(to: CGPoint(x: q.x - nx * z, y: q.y - ny * z))
            path.addLine(to: CGPoint(x: q.x + nx * z, y: q.y + ny * z))
            path.closeSubpath()
        }
        for i in points.indices where brush.kind == "marker" || (i > 0 && i < points.count - 1) {
            let p = points[i], r = radii[i]
            path.move(to: CGPoint(x: p.x + r, y: p.y))
            path.addArc(center: p, radius: r, startAngle: 0, endAngle: .pi * 2, clockwise: false)
            path.closeSubpath()
        }
        if segments == 0 && brush.kind == "highlighter" {
            let p = points[0], r = max(0.1, radii.max() ?? 0.1)
            path.addRect(CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
        }
        c.addPath(path)
        c.fillPath(using: .winding)
    }
}

/// renderer.ts `paintDab` for one pigment dab, in the stroke's local space.
private func paintDab(_ dab: StrokeDab, brush: ToolBrush, ink: CGColor, soft: CGGradient?, wash: CGGradient?, context c: CGContext) {
    c.saveGState()
    defer { c.restoreGState() }
    c.translateBy(x: dab.x, y: dab.y)
    c.rotate(by: dab.angle * .pi / 180)
    c.scaleBy(x: 1, y: dab.roundness)
    c.setAlpha(dab.opacity)
    let scaled = (dab.noise * 4_294_967_296).rounded(.towardZero)
    var noise: UInt32 = scaled >= 1 && scaled < 4_294_967_296 ? UInt32(scaled) : 1
    func random() -> Double {
        noise ^= noise &<< 13; noise ^= noise >> 17; noise ^= noise &<< 5
        return Double(noise) / 4_294_967_296
    }
    let size = dab.size
    switch brush.kind {
    case "crayon", "natural-pencil":
        let crayon = brush.kind == "crayon"
        c.setFillColor(ink)
        let count = min(256, max(5, Int(ceil(size * (crayon ? 5 : 4)))))
        for _ in 0..<count {
            let angle = random() * .pi * 2
            let radius = sqrt(random()) * size / 2
            c.setAlpha(dab.opacity * (0.15 + random() * 0.85))
            let grain = max(0.3, size * (crayon ? 0.035 : 0.065) * random())
            c.fillEllipse(in: CGRect(x: cos(angle) * radius - grain, y: sin(angle) * radius - grain, width: grain * 2, height: grain * 2))
        }
    case "oil":
        c.addEllipse(in: CGRect(x: -size / 2, y: -size / 2, width: size, height: size))
        c.clip()
        c.setFillColor(ink)
        c.setAlpha(dab.opacity * 0.08)
        c.fill(CGRect(x: -size / 2, y: -size / 2, width: size, height: size))
        c.setStrokeColor(ink)
        c.setLineWidth(max(0.4, size / 30))
        c.setLineCap(.butt)
        for i in 0..<12 {
            let x = (Double(i) / 11 - 0.5) * size
            c.setAlpha(dab.opacity * (0.2 + random() * 0.7))
            c.move(to: CGPoint(x: x, y: -size / 2))
            c.addLine(to: CGPoint(x: x + (random() - 0.5) * size * 0.08, y: size / 2))
            c.strokePath()
        }
    case "watercolor":
        let radius = size / 2
        c.setAlpha(dab.opacity * 0.55)
        if let wash {
            c.saveGState()
            c.addEllipse(in: CGRect(x: -radius, y: -radius, width: radius * 2, height: radius * 2))
            c.clip()
            c.drawRadialGradient(wash, startCenter: .zero, startRadius: 0, endCenter: .zero, endRadius: radius, options: [])
            c.restoreGState()
        }
        c.setStrokeColor(ink)
        c.setLineWidth(max(0.5, radius * 0.04))
        c.setAlpha(dab.opacity * 0.08)
        c.strokeEllipse(in: CGRect(x: -radius * 0.9, y: -radius * 0.9, width: radius * 1.8, height: radius * 1.8))
    default:
        // hard, pencil, soft, ink, spray, calligraphy and texture without its tip image.
        let r = size / 2
        let circle = CGRect(x: -r, y: -r, width: r * 2, height: r * 2)
        if brush.hardness < 0.99, let soft {
            c.addEllipse(in: circle)
            c.clip()
            c.drawRadialGradient(soft, startCenter: .zero, startRadius: r * brush.hardness, endCenter: .zero, endRadius: r, options: [.drawsBeforeStartLocation])
        } else {
            c.setFillColor(ink)
            c.fillEllipse(in: circle)
        }
    }
}

// MARK: Text

private func drawText(_ node: [String: JSONValue], width: CGFloat, height: CGFloat, context: CGContext) {
    let text = node["text"]?.stringValue ?? ""
    let textStyle = node["textStyle"]?.objectValue
    let fontSize = (textStyle.flatMap { number($0, "size") }) ?? 16
    let textColor = (textStyle?["color"]?.stringValue).flatMap(color) ?? CGColor(srgbRed: 0.11, green: 0.11, blue: 0.12, alpha: 1)
    let bgColor = (textStyle?["background"]?.stringValue).flatMap(color)
    let borderColor = (textStyle?["border"]?.stringValue).flatMap(color)
    let rect = CGRect(x: 0, y: 0, width: width, height: height)
    if let bgColor {
        context.setFillColor(bgColor)
        context.fill(rect)
    }
    if let borderColor {
        context.setStrokeColor(borderColor)
        context.setLineWidth(1)
        context.stroke(rect.insetBy(dx: 0.5, dy: 0.5))
    }
    guard !text.isEmpty else { return }
    context.saveGState()
    context.translateBy(x: 0, y: height)
    context.scaleBy(x: 1.0, y: -1.0)

    let fontName = textStyle?["font"]?.stringValue ?? "system"
    let ctFont: CTFont
    if fontName.contains("mono") {
        ctFont = CTFontCreateWithName("Courier" as CFString, fontSize, nil)
    } else if fontName.contains("serif") {
        ctFont = CTFontCreateWithName("Times New Roman" as CFString, fontSize, nil)
    } else {
        ctFont = CTFontCreateUIFontForLanguage(.system, fontSize, nil) ?? CTFontCreateWithName("Helvetica" as CFString, fontSize, nil)
    }

    let alignStr = textStyle?["align"]?.stringValue ?? "left"
    var textAlignment: CTTextAlignment = .left
    if alignStr == "center" { textAlignment = .center }
    else if alignStr == "right" || alignStr == "end" { textAlignment = .right }

    let alignmentSetting = [
        CTParagraphStyleSetting(
            spec: .alignment,
            valueSize: MemoryLayout<CTTextAlignment>.size,
            value: &textAlignment
        )
    ]
    let paragraphStyle = CTParagraphStyleCreate(alignmentSetting, 1)

    let attributes: [CFString: Any] = [
        kCTFontAttributeName: ctFont,
        kCTForegroundColorAttributeName: textColor,
        kCTParagraphStyleAttributeName: paragraphStyle
    ]
    if let attrString = CFAttributedStringCreate(kCFAllocatorDefault, text as CFString, attributes as CFDictionary) {
        let framesetter = CTFramesetterCreateWithAttributedString(attrString)
        let path = CGPath(rect: CGRect(x: 4, y: 4, width: max(1, width - 8), height: max(1, height - 8)), transform: nil)
        let frame = CTFramesetterCreateFrame(framesetter, CFRangeMake(0, 0), path, nil)
        CTFrameDraw(frame, context)
    }
    context.restoreGState()
}

// MARK: Raster surface

/// A premultiplied RGBA bitmap in device pixels. Memory row 0 is the top row.
private struct RasterSurface {
    let context: CGContext
    let width: Int, height: Int, rowBytes: Int

    init?(width: Int, height: Int) {
        guard width > 0, height > 0,
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: drawingColorSpace(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        self.context = context
        self.width = width; self.height = height; self.rowBytes = context.bytesPerRow
    }
    private func pixels() -> UnsafeMutablePointer<UInt8>? {
        context.flush()
        return context.data?.bindMemory(to: UInt8.self, capacity: rowBytes * height)
    }
    func snapshot() -> [UInt8] {
        guard let p = pixels() else { return [] }
        return Array(UnsafeBufferPointer(start: p, count: rowBytes * height))
    }
    func alphaChannel() -> [UInt8] {
        var result = [UInt8](repeating: 0, count: width * height)
        guard let p = pixels() else { return result }
        for y in 0..<height { for x in 0..<width { result[y * width + x] = p[y * rowBytes + x * 4 + 3] } }
        return result
    }
    func multiply(by mask: [UInt8]) {
        guard let p = pixels(), mask.count == width * height else { return }
        for y in 0..<height {
            for x in 0..<width {
                let m = Int(mask[y * width + x]), at = y * rowBytes + x * 4
                if m == 255 { continue }
                for c in 0..<4 { p[at + c] = UInt8((Int(p[at + c]) * m + 127) / 255) }
            }
        }
    }
    /// original * (1 - mask) + current * mask, the desktop's masked adjustment.
    func mix(original: [UInt8], mask: [UInt8]) {
        guard let p = pixels(), mask.count == width * height, original.count == rowBytes * height else { return }
        for y in 0..<height {
            for x in 0..<width {
                let m = Int(mask[y * width + x]), at = y * rowBytes + x * 4
                for c in 0..<4 { p[at + c] = UInt8(min(255, (Int(original[at + c]) * (255 - m) + Int(p[at + c]) * m + 127) / 255)) }
            }
        }
    }
    /// Applies a colour function to unpremultiplied sRGB values in 0...1.
    func mapColors(_ transform: (Double, Double, Double) -> (Double, Double, Double)) {
        guard let p = pixels() else { return }
        for y in 0..<height {
            for x in 0..<width {
                let at = y * rowBytes + x * 4, a = Double(p[at + 3])
                guard a > 0 else { continue }
                let (r, g, b) = transform(min(1, Double(p[at]) / a), min(1, Double(p[at + 1]) / a), min(1, Double(p[at + 2]) / a))
                p[at] = UInt8((min(1, max(0, r)) * a).rounded())
                p[at + 1] = UInt8((min(1, max(0, g)) * a).rounded())
                p[at + 2] = UInt8((min(1, max(0, b)) * a).rounded())
            }
        }
    }
    /// CSS filter functions, matching the desktop `canvasEffect` mapping.
    func apply(_ effect: PixelEffect, deviceScale: Double) {
        switch effect {
        case .brightness(let k): mapColors { ($0 * k, $1 * k, $2 * k) }
        case .contrast(let k): mapColors { (($0 - 0.5) * k + 0.5, ($1 - 0.5) * k + 0.5, ($2 - 0.5) * k + 0.5) }
        case .saturate(let s):
            mapColors { r, g, b in
                ((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
                 (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
                 (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b)
            }
        case .grayscale(let amount):
            let k = 1 - amount
            mapColors { r, g, b in
                ((0.2126 + 0.7874 * k) * r + (0.7152 - 0.7152 * k) * g + (0.0722 - 0.0722 * k) * b,
                 (0.2126 - 0.2126 * k) * r + (0.7152 + 0.2848 * k) * g + (0.0722 - 0.0722 * k) * b,
                 (0.2126 - 0.2126 * k) * r + (0.7152 - 0.7152 * k) * g + (0.0722 + 0.9278 * k) * b)
            }
        case .invert(let i): mapColors { (i + $0 * (1 - 2 * i), i + $1 * (1 - 2 * i), i + $2 * (1 - 2 * i)) }
        case .blur(let amount): blur(sigma: amount * deviceScale)
        }
    }
    /// Gaussian blur approximated by three box blurs; pixels outside the surface are transparent.
    func blur(sigma: Double) {
        guard sigma.isFinite, sigma > 0, let p = pixels() else { return }
        let n = 3
        let ideal = sqrt(12 * sigma * sigma / Double(n) + 1)
        var lower = Int(ideal.rounded(.down)); if lower % 2 == 0 { lower -= 1 }
        lower = max(1, lower)
        let upper = lower + 2
        let m = Int(((12 * sigma * sigma - Double(n * lower * lower) - Double(4 * n * lower) - Double(3 * n)) / Double(-4 * lower - 4)).rounded())
        var line = [Int32](repeating: 0, count: max(width, height) * 4)
        for pass in 0..<n {
            let radius = ((pass < m ? lower : upper) - 1) / 2
            guard radius > 0 else { continue }
            boxPass(p, line: &line, count: width, lines: height, step: 4, lineStride: rowBytes, radius: radius)
            boxPass(p, line: &line, count: height, lines: width, step: rowBytes, lineStride: 4, radius: radius)
        }
    }
    private func boxPass(_ p: UnsafeMutablePointer<UInt8>, line: inout [Int32], count: Int, lines: Int, step: Int, lineStride: Int, radius: Int) {
        let d = Int32(radius * 2 + 1)
        for l in 0..<lines {
            let start = l * lineStride
            for i in 0..<count { for c in 0..<4 { line[i * 4 + c] = Int32(p[start + i * step + c]) } }
            for c in 0..<4 {
                var sum: Int32 = 0
                for k in 0...min(radius, count - 1) { sum += line[k * 4 + c] }
                for i in 0..<count {
                    p[start + i * step + c] = UInt8(min(255, (sum + d / 2) / d))
                    let add = i + radius + 1
                    if add < count { sum += line[add * 4 + c] }
                    let remove = i - radius
                    if remove >= 0 { sum -= line[remove * 4 + c] }
                }
            }
        }
    }
}

/// Drawings are sRGB on every platform, like the desktop canvas. Colours, gradients and
/// offscreen buffers all use it, so a colour comes out exactly as written.
func drawingColorSpace() -> CGColorSpace {
    CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
}
