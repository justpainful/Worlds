import Foundation

public struct ToolPoint: Codable, Equatable, Sendable {
    public var x: Double, y: Double
    public init(x: Double, y: Double) { self.x = x; self.y = y }
}
public struct ToolSample: Codable, Equatable, Sendable {
    public var x: Double, y: Double, pressure: Double, tiltX: Double, tiltY: Double, time: Double
    public init(x: Double, y: Double, pressure: Double, tiltX: Double = 0, tiltY: Double = 0, time: Double) {
        self.x = x; self.y = y; self.pressure = pressure; self.tiltX = tiltX; self.tiltY = tiltY; self.time = time
    }
}
public struct ToolBrush: Codable, Equatable, Sendable {
    public var kind: String = "hard", size: Double = 12, opacity: Double = 1, flow: Double = 1, hardness: Double = 1
    public var spacing: Double = 0.12, angle: Double = 0, roundness: Double = 1, smoothing: Double = 0.15, stabilizer: Double = 0
    public var taperStart: Double = 0, taperEnd: Double = 0
    public var pressureSize = true, pressureOpacity = false, pressureFlow = false
    public var pressureCurve: Double = 1
    public var color: String = "#202023"
    public var tipAssetId: String? = nil
    public var straightLine: Bool? = nil
    public init() {}
}
public enum StrokeTool: Sendable { case brush, highlighter, eraser }
public enum DrawingToolError: Error, Equatable { case invalidInput, unsupportedBrush }

private struct ToolPaint: Encodable {
    let fill = "transparent", stroke = "#202023", strokeWidth = 3, dash: [Int] = [], cap = "round", radius = 16
}
private struct ToolTextStyle: Encodable {
    let font = "IBM Plex Sans Arabic", size = 28, weight = 400, italic = false
    let align = "start", direction = "auto", leading = 1.7, background = "transparent", color = "#202023", border = "transparent", resizeMode = "wrap"
}
private struct StrokeNode: Encodable {
    let id: String, kind = "stroke", name: String, layerId: String, frameId: String?
    let groupId: String? = nil, visible = true, locked = false, rotation = 0, opacity = 1, flipX = false, flipY = false
    let paint = ToolPaint(), textStyle = ToolTextStyle(), effects: [String] = []
    let x: Double, y: Double, w: Double, h: Double
    let samples: [ToolSample], brush: ToolBrush, erase: Bool, seed: Int, alphaLock: Bool
    enum CodingKeys: String, CodingKey { case id, kind, name, layerId, frameId, groupId, visible, locked, rotation, opacity, flipX, flipY, paint, textStyle, effects, x, y, w, h, samples, brush, erase, seed, alphaLock }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(kind, forKey: .kind); try c.encode(name, forKey: .name)
        try c.encode(layerId, forKey: .layerId); try c.encode(frameId, forKey: .frameId); try c.encodeNil(forKey: .groupId)
        try c.encode(visible, forKey: .visible); try c.encode(locked, forKey: .locked); try c.encode(rotation, forKey: .rotation)
        try c.encode(opacity, forKey: .opacity); try c.encode(flipX, forKey: .flipX); try c.encode(flipY, forKey: .flipY)
        try c.encode(paint, forKey: .paint); try c.encode(textStyle, forKey: .textStyle); try c.encode(effects, forKey: .effects)
        try c.encode(x, forKey: .x); try c.encode(y, forKey: .y); try c.encode(w, forKey: .w); try c.encode(h, forKey: .h)
        try c.encode(samples, forKey: .samples); try c.encode(brush, forKey: .brush); try c.encode(erase, forKey: .erase); try c.encode(seed, forKey: .seed); try c.encode(alphaLock, forKey: .alphaLock)
    }
}
private struct StrokeChange: Encodable {
    let type: String, collection: String?, id: String?, value: StrokeNode?, list: String?, ids: [String]?
}
private struct StrokeEdit: Encodable {
    let id: String, actor: String, base: Int64, at: Int64, label: String, type = "edit", changes: [StrokeChange]
}

/// Builds a schema-shaped operation. Validation and journal application remain the store's responsibility.
public enum StrokeOperationBuilder {
    public static func make(samples: [ToolSample], brush original: ToolBrush, tool: StrokeTool,
                            nodeID: String, operationID: String, actor: String, revision: Int64,
                            timestamp: Int64, layerID: String, frameID: String?, nodeOrder: [String], seed: Int, alphaLock: Bool = false) throws -> Data {
        guard !samples.isEmpty, samples.count <= 100_000, !nodeID.isEmpty, !operationID.isEmpty, !actor.isEmpty, !layerID.isEmpty,
              revision >= 0, seed >= 0, seed <= Int(Int32.max), !nodeOrder.contains(nodeID),
              Set(nodeOrder).count == nodeOrder.count,
              samples.allSatisfy({ [$0.x,$0.y,$0.pressure,$0.tiltX,$0.tiltY,$0.time].allSatisfy(\.isFinite) && (0...1).contains($0.pressure) }),
              [original.size,original.opacity,original.flow,original.hardness,original.spacing,original.angle,original.roundness,original.smoothing,original.stabilizer,original.taperStart,original.taperEnd,original.pressureCurve].allSatisfy(\.isFinite),
              (1...2048).contains(original.size), (0...1).contains(original.opacity), (0...1).contains(original.flow), (0...1).contains(original.hardness),
              (0.01...2).contains(original.spacing), (0.05...1).contains(original.roundness), (0.1...4).contains(original.pressureCurve),
              (-360...360).contains(original.angle), (0...0.95).contains(original.smoothing), (0...100).contains(original.stabilizer),
              (0...0.5).contains(original.taperStart), (0...0.5).contains(original.taperEnd), !original.color.isEmpty, original.tipAssetId.map({ !$0.isEmpty && $0.count <= 160 }) ?? true,
              original.color.count <= 128, original.color.range(of: #"[<>;{}]|url\s*\("#, options: [.regularExpression,.caseInsensitive]) == nil
        else { throw DrawingToolError.invalidInput }
        var brush = original
        if case .highlighter = tool, brush.kind != "marker" { brush.kind = "highlighter" }
        guard ["hard", "pencil", "soft", "ink", "marker", "highlighter", "spray", "texture", "calligraphy", "oil", "crayon", "natural-pencil", "watercolor"].contains(brush.kind) else { throw DrawingToolError.unsupportedBrush }
        let points = brush.straightLine == true && ["marker", "highlighter"].contains(brush.kind) && samples.count > 1 ? [samples.first!,samples.last!] : samples
        var radius = brush.size / 2
        let angle = brush.angle * .pi / 180, c = abs(cos(angle)), s = abs(sin(angle))
        let fx: Double, fy: Double
        if ["marker", "highlighter"].contains(brush.kind) { fx = radius; fy = radius }
        else if brush.kind == "spray" { fx = radius + max(0.5, brush.size / 48); fy = fx }
        else if brush.kind == "texture" { fx = radius * (c + brush.roundness * s); fy = radius * (s + brush.roundness * c) }
        else {
            if brush.kind == "crayon" || brush.kind == "natural-pencil" { radius += max(0.3, brush.size * (brush.kind == "crayon" ? 0.035 : 0.065)) }
            if brush.kind == "watercolor" { radius = max(radius, radius * 0.9 + max(0.5, radius * 0.04) / 2) }
            fx = radius * hypot(c, brush.roundness * s); fy = radius * hypot(s, brush.roundness * c)
        }
        let minX = points.map(\.x).min()!, maxX = points.map(\.x).max()!, minY = points.map(\.y).min()!, maxY = points.map(\.y).max()!
        let x = minX - fx - 2, y = minY - fy - 2
        let normalized = samples.map { ToolSample(x: $0.x - x, y: $0.y - y, pressure: $0.pressure, tiltX: $0.tiltX, tiltY: $0.tiltY, time: $0.time) }
        let name: String; let erase: Bool
        switch tool { case .brush: name = "Brush stroke"; erase = false; case .highlighter: name = "Highlighter"; erase = false; case .eraser: name = "Eraser"; erase = true }
        let node = StrokeNode(id: nodeID, name: name, layerId: layerID, frameId: frameID, x: x, y: y,
                              w: max(1,maxX-minX+2*fx+4), h: max(1,maxY-minY+2*fy+4), samples: normalized, brush: brush, erase: erase, seed: seed, alphaLock: alphaLock)
        let changes = [StrokeChange(type: "put", collection: "nodes", id: nodeID, value: node, list: nil, ids: nil),
                       StrokeChange(type: "order", collection: nil, id: nil, value: nil, list: "nodeOrder", ids: nodeOrder + [nodeID])]
        return try JSONEncoder().encode(StrokeEdit(id: operationID, actor: actor, base: revision, at: timestamp, label: name, changes: changes))
    }
}

/// Ephemeral laser traces are intentionally not encoded in a drawing scene.
public struct LaserTrace: Sendable, Equatable {
    public var id: String, actor: String, color: String
    public var width: Double, points: [ToolPoint], releasedAt: Int64?, lifetime: Int64, opacity: Double
    public init(id: String, actor: String, color: String, width: Double, points: [ToolPoint], releasedAt: Int64? = nil, lifetime: Int64, opacity: Double = 1) {
        self.id = id; self.actor = actor; self.color = color; self.width = width; self.points = points; self.releasedAt = releasedAt; self.lifetime = lifetime; self.opacity = opacity
    }
    public func fade(at now: Int64) -> Double {
        guard let releasedAt else { return 1 }
        return max(0, 1 - (Double(now) - Double(releasedAt)) / Double(max(100, lifetime)))
    }
}
public struct LaserOverlay: Sendable {
    public private(set) var traces: [String: LaserTrace] = [:]
    public init() {}
    public mutating func update(_ trace: LaserTrace) { traces[trace.id] = trace }
    public mutating func prune(at time: Int64) { traces = traces.filter { $0.value.fade(at: time) > 0 } }
    public mutating func remove(actor: String) { traces = traces.filter { $0.value.actor != actor } }
}


public struct PressureValues: Sendable, Equatable {
    public let size: Double
    public let opacity: Double
}
public enum PressureDynamics {
    /// A single source brush dab. Taper is the source-computed normalized value.
    public static func values(brush: ToolBrush, pressure: Double, taper: Double = 1) throws -> PressureValues {
        guard pressure.isFinite, taper.isFinite, brush.pressureCurve.isFinite, brush.size.isFinite, brush.flow.isFinite,
              (0.1...4).contains(brush.pressureCurve), (1...2048).contains(brush.size), (0...1).contains(brush.flow) else { throw DrawingToolError.invalidInput }
        let p = pow(max(0.01,min(1,pressure)), brush.pressureCurve)
        let size = max(0.2, brush.size * (brush.pressureSize ? p : 1) * max(0.03,min(1,taper)))
        let alpha = brush.flow * (brush.pressureOpacity ? p : 1) * (brush.pressureFlow ? p : 1)
        return PressureValues(size: size, opacity: alpha)
    }
}

