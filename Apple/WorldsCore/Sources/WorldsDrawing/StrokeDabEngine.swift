import Foundation

public struct StrokeDab: Codable, Equatable, Sendable {
    public let x: Double, y: Double, size: Double, opacity: Double, angle: Double, roundness: Double, noise: Double
}

/// Source-equivalent dab geometry for already valid brushes. This is not a
/// renderer and does not implement the source's textured pigment algorithms.
public enum StrokeDabEngine {
    public static func generate(samples: [ToolSample], brush: ToolBrush, seed: Int32 = 1) throws -> [StrokeDab] {
        guard samples.count <= 65_536, samples.allSatisfy({ [$0.x, $0.y, $0.pressure, $0.tiltX, $0.tiltY, $0.time].allSatisfy(\.isFinite) }),
              [brush.size, brush.spacing, brush.flow, brush.angle, brush.roundness, brush.pressureCurve, brush.taperStart, brush.taperEnd].allSatisfy(\.isFinite),
              (1...2048).contains(brush.size), (0.01...2).contains(brush.spacing), (0...1).contains(brush.flow),
              (0.05...1).contains(brush.roundness), (-360...360).contains(brush.angle), (0.1...4).contains(brush.pressureCurve),
              (0...0.5).contains(brush.taperStart), (0...0.5).contains(brush.taperEnd),
              ["pencil", "hard", "soft", "ink", "marker", "highlighter", "spray", "texture", "calligraphy", "oil", "crayon", "natural-pencil", "watercolor"].contains(brush.kind) else { throw DrawingToolError.invalidInput }
        guard !samples.isEmpty else { return [] }
        var lengths = [Double](repeating: 0, count: samples.count)
        for i in 1..<samples.count { lengths[i] = hypot(samples[i].x - samples[i-1].x, samples[i].y - samples[i-1].y) }
        let total = lengths.reduce(0, +)
        let spacing = max(0.25, brush.size * brush.spacing * (brush.pressureSize ? 0.1 : 1))
        let pigment: Double
        switch brush.kind {
        case "spray": pigment = max(1, ceil(brush.size / 3))
        case "crayon", "natural-pencil": pigment = min(256, max(5, ceil(brush.size * (brush.kind == "crayon" ? 5 : 4))))
        case "oil": pigment = 13
        case "watercolor": pigment = 2
        default: pigment = 1
        }
        guard total.isFinite, (2 + total / spacing) * pigment <= 1_000_000 else { throw DrawingToolError.invalidInput }
        var randomState = UInt32(bitPattern: seed == 0 ? 1 : seed)
        func random() -> Double {
            randomState ^= randomState &<< 13; randomState ^= randomState >> 17; randomState ^= randomState &<< 5
            return Double(randomState) / 4_294_967_296
        }
        var result: [StrokeDab] = []
        func add(_ p: ToolSample, at: Double) throws {
            let start = brush.taperStart != 0 && total != 0 ? at / (total * brush.taperStart) : 1
            let end = brush.taperEnd != 0 && total != 0 ? (total - at) / (total * brush.taperEnd) : 1
            let values = try PressureDynamics.values(brush: brush, pressure: p.pressure, taper: min(1, start, end))
            if brush.kind == "spray" {
                for _ in 0..<max(1, Int(ceil(values.size / 3))) {
                    let a = random() * .pi * 2, r = sqrt(random()) * values.size / 2
                    result.append(StrokeDab(x: p.x + cos(a) * r, y: p.y + sin(a) * r, size: max(1, values.size / 24), opacity: values.opacity, angle: brush.angle, roundness: 1, noise: random()))
                }
            } else {
                result.append(StrokeDab(x: p.x, y: p.y, size: values.size, opacity: values.opacity, angle: brush.angle, roundness: brush.roundness, noise: random()))
            }
        }
        try add(samples[0], at: 0)
        var travelled = 0.0, remaining = max(0.25, brush.size * brush.spacing)
        if samples.count > 1 {
            for i in 1..<samples.count {
                let start = samples[i-1], end = samples[i], length = lengths[i]
                var pos = remaining
                while pos <= length {
                    let t = length != 0 ? pos / length : 0
                    let p = ToolSample(x: start.x + (end.x-start.x)*t, y: start.y + (end.y-start.y)*t, pressure: start.pressure + (end.pressure-start.pressure)*t, tiltX: end.tiltX, tiltY: end.tiltY, time: end.time)
                    try add(p, at: travelled + pos)
                    pos += max(0.25, brush.size * brush.spacing * (brush.pressureSize ? max(0.1, p.pressure) : 1))
                }
                remaining = pos - length; travelled += length
            }
            try add(samples[samples.count-1], at: total)
        }
        return result
    }
}
