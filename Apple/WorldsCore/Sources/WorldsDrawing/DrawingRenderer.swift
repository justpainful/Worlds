import Foundation
import CoreGraphics
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

/// Partial native preview. A report with any issue must never be treated as a
/// lossless render or an authoritative export.
public struct DrawingRenderer {
    public init() {}
    public func render(scene: DrawingScene, frameID: String, in context: CGContext) throws -> DrawingRenderReport {
        guard let root = scene.source.objectValue,
              let frames = root["frames"]?.objectValue, let frame = frames[frameID]?.objectValue,
              let layers = root["layers"]?.objectValue, let nodes = root["nodes"]?.objectValue,
              let layerOrder = root["layerOrder"]?.arrayValue, let nodeOrder = root["nodeOrder"]?.arrayValue,
              let fx = number(frame, "x"), let fy = number(frame, "y"), let fw = number(frame, "w"), let fh = number(frame, "h"),
              fw > 0, fh > 0, fw <= 16384, fh <= 16384, fw * fh <= 64 * 1024 * 1024 else { throw DrawingDataError.invalidScene }
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
        for layerValue in layerOrder {
            guard let id = layerValue.stringValue, let layer = layers[id]?.objectValue else { throw DrawingDataError.invalidScene }
            if layer["visible"]?.boolValue == false { continue }
            if let parent = layer["parentId"], parent != .null {
                issues.append(.init(elementID: id, reason: "Nested layer compositing is not implemented"))
                continue
            }
            guard let alpha = number(layer, "opacity"), (0...1).contains(alpha),
                  let blendName = layer["blend"]?.stringValue, let blend = blendMode(blendName) else {
                issues.append(.init(elementID: id, reason: "Unsupported layer appearance")); continue
            }
            context.saveGState()
            context.setAlpha(alpha)
            context.setBlendMode(blend)
            context.beginTransparencyLayer(auxiliaryInfo: nil)
            for item in nodeOrder {
                guard let nodeID = item.stringValue, let node = nodes[nodeID]?.objectValue else { throw DrawingDataError.invalidScene }
                guard node["layerId"]?.stringValue == id, node["visible"]?.boolValue != false else { continue }
                if let nodeFrame = node["frameId"]?.stringValue, nodeFrame != frameID { continue }
                do {
                    let approximation = try drawNode(node, context: context)
                    count += 1
                    if let approximation { issues.append(.init(elementID: nodeID, reason: approximation)) }
                } catch {
                    issues.append(.init(elementID: nodeID, reason: String(describing: error)))
                }
            }
            context.endTransparencyLayer()
            context.restoreGState()
        }
        return DrawingRenderReport(renderedNodeCount: count, issues: issues)
    }
}

private enum PreviewError: Error { case unsupported(String), malformed }
private func number(_ value: [String: JSONValue], _ key: String) -> CGFloat? {
    guard let v = value[key]?.numberValue, v.isFinite, abs(v) <= 1_000_000_000 else { return nil }
    return CGFloat(v)
}
private func color(_ string: String) -> CGColor? {
    if string == "transparent" { return CGColor(red: 0, green: 0, blue: 0, alpha: 0) }
    let s = string.hasPrefix("#") ? String(string.dropFirst()) : ""
    guard (s.count == 6 || s.count == 8), let raw = UInt64(s, radix: 16) else { return nil }
    let shift = s.count == 8 ? 8 : 0
    return CGColor(red: CGFloat((raw >> (16 + shift)) & 255) / 255,
                   green: CGFloat((raw >> (8 + shift)) & 255) / 255,
                   blue: CGFloat((raw >> shift) & 255) / 255,
                   alpha: s.count == 8 ? CGFloat(raw & 255) / 255 : 1)
}
private func blendMode(_ value: String) -> CGBlendMode? {
    switch value { case "source-over": return .normal; case "multiply": return .multiply; case "screen": return .screen; case "overlay": return .overlay; case "darken": return .darken; case "lighten": return .lighten; default: return nil }
}

private func drawNode(_ node: [String: JSONValue], context: CGContext) throws -> String? {
    guard let kind = node["kind"]?.stringValue,
          let x = number(node, "x"), let y = number(node, "y"), let width = number(node, "w"), let height = number(node, "h"),
          width > 0, height > 0, let opacity = number(node, "opacity"), (0...1).contains(opacity),
          let rotation = number(node, "rotation") else { throw PreviewError.malformed }
    guard node["maskId"] == nil || node["maskId"] == .null,
          node["effects"]?.arrayValue?.isEmpty == true,
          node["erase"]?.boolValue != true, node["alphaLock"]?.boolValue != true else { throw PreviewError.unsupported("Masks, effects and eraser compositing are not implemented") }
    context.saveGState()
    defer { context.restoreGState() }
    context.setAlpha(opacity)
    context.translateBy(x: x + width / 2, y: y + height / 2)
    context.rotate(by: rotation * .pi / 180)
    context.scaleBy(x: node["flipX"]?.boolValue == true ? -1 : 1, y: node["flipY"]?.boolValue == true ? -1 : 1)
    context.translateBy(x: -width / 2, y: -height / 2)
    if kind == "shape" {
        guard let paint = node["paint"]?.objectValue, paint["gradient"] == nil,
              let fill = (paint["fill"]?.stringValue).flatMap(color), let stroke = (paint["stroke"]?.stringValue).flatMap(color),
              let line = number(paint, "strokeWidth"), let shape = node["shape"]?.stringValue else { throw PreviewError.unsupported("Shape style is not implemented") }
        context.setFillColor(fill); context.setStrokeColor(stroke); context.setLineWidth(line)
        let rect = CGRect(x: 0, y: 0, width: width, height: height)
        switch shape {
        case "rect": context.addRect(rect)
        case "ellipse": context.addEllipse(in: rect)
        case "roundrect": context.addPath(CGPath(roundedRect: rect, cornerWidth: number(paint, "radius") ?? 0, cornerHeight: number(paint, "radius") ?? 0, transform: nil))
        default: throw PreviewError.unsupported("Shape type is not implemented")
        }
        context.drawPath(using: .fillStroke)
        return "Preview does not reproduce all original shape styling"
    }
    if kind == "stroke" {
        guard let brush = node["brush"]?.objectValue, let ink = (brush["color"]?.stringValue).flatMap(color),
              let size = number(brush, "size"), size > 0, let samples = node["samples"]?.arrayValue,
              !samples.isEmpty, samples.count <= 65536,
              let brushKind = brush["kind"]?.stringValue, ["hard", "pencil", "ink", "marker", "highlighter"].contains(brushKind) else { throw PreviewError.unsupported("Brush type is not implemented") }
        let points = try samples.map { value -> (CGPoint, CGFloat) in
            guard let sample = value.objectValue, let px = number(sample, "x"), let py = number(sample, "y"),
                  let pressure = number(sample, "pressure"), (0...1).contains(pressure) else { throw PreviewError.malformed }
            return (CGPoint(x: px, y: py), pressure)
        }
        let curve = number(brush, "pressureCurve") ?? 1
        let flow = number(brush, "flow") ?? 1
        let brushOpacity = number(brush, "opacity") ?? 1
        guard (0.1...4).contains(curve), (0...1).contains(flow), (0...1).contains(brushOpacity) else { throw PreviewError.malformed }
        context.setStrokeColor(ink); context.setFillColor(ink)
        context.setLineCap(brushKind == "highlighter" ? .butt : .round); context.setLineJoin(.round)
        func pressure(_ raw: CGFloat) -> CGFloat { pow(max(0.01,min(1,raw)),curve) }
        func width(_ raw: CGFloat) -> CGFloat { max(0.2,size * (brush["pressureSize"]?.boolValue == true ? pressure(raw) : 1)) }
        func alpha(_ raw: CGFloat) -> CGFloat {
            let value=pressure(raw)
            return opacity * brushOpacity * flow * (brush["pressureOpacity"]?.boolValue == true ? value : 1) * (brush["pressureFlow"]?.boolValue == true ? value : 1)
        }
        if points.count == 1 {
            let (point, force) = points[0], diameter=width(force)
            context.setAlpha(alpha(force))
            context.fillEllipse(in: CGRect(x: point.x-diameter/2, y: point.y-diameter/2, width: diameter, height: diameter))
        } else {
            for i in 1..<points.count {
                let (previous, previousForce)=points[i-1], (point, force)=points[i]
                context.setLineWidth((width(previousForce)+width(force))/2)
                context.setAlpha((alpha(previousForce)+alpha(force))/2)
                context.move(to: previous); context.addLine(to: point); context.strokePath()
            }
        }
        return "Brush preview approximates pressure, flow, spacing and smoothing"
    }
    throw PreviewError.unsupported("Element type is not implemented")
}




