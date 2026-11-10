import Foundation
import CoreGraphics

public enum ScreenDrawingTool: Sendable, Equatable { case pen, highlighter, eraser, laser }
public struct ScreenInk: Sendable, Equatable {
    public var red: Double, green: Double, blue: Double, alpha: Double
    public init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
        self.red = min(1, max(0, red)); self.green = min(1, max(0, green))
        self.blue = min(1, max(0, blue)); self.alpha = min(1, max(0, alpha))
    }
}
public struct ScreenSample: Sendable, Equatable {
    public let point: CGPoint
    public let pressure: Double
    public init(point: CGPoint, pressure: Double) { self.point = point; self.pressure = pressure }
}
public struct ScreenStroke: Sendable, Equatable {
    public let tool: ScreenDrawingTool
    public let ink: ScreenInk
    public let width: Double
    public let lifetime: Double
    public var samples: [ScreenSample]
    public var releasedAt: TimeInterval?
    public func opacity(at now: TimeInterval) -> Double {
        guard tool == .laser, let releasedAt else { return 1 }
        return max(0, min(1, 1 - (now - releasedAt) / max(0.1, lifetime)))
    }
}

/// Session memory only. Coordinates are points relative to the selected display.
public struct ScreenDrawingDocument: Sendable {
    public private(set) var strokes: [ScreenStroke] = []
    public private(set) var current: ScreenStroke?
    public init() {}
    public mutating func begin(tool: ScreenDrawingTool, ink: ScreenInk, width: Double, lifetime: Double, sample: ScreenSample) {
        guard [ink.red, ink.green, ink.blue, ink.alpha].allSatisfy(\.isFinite), width.isFinite, lifetime.isFinite, valid(sample), (1...256).contains(width), (0.1...60).contains(lifetime) else { return }
        if tool == .eraser { erase(at: sample.point, radius: width / 2); return }
        guard strokes.count < 1000 else { return }
        current = ScreenStroke(tool: tool, ink: ink, width: width, lifetime: lifetime, samples: [sample], releasedAt: nil)
    }
    public mutating func move(tool: ScreenDrawingTool, sample: ScreenSample, eraserWidth: Double) {
        guard valid(sample) else { return }
        if tool == .eraser { if eraserWidth.isFinite { erase(at: sample.point, radius: min(128, max(0.5, eraserWidth/2))) }; return }
        guard current?.tool == tool, (current?.samples.count ?? 0) < 30_000 else { return }
        current?.samples.append(sample)
    }
    public mutating func end(at now: TimeInterval) {
        guard var stroke = current else { return }
        if stroke.tool == .laser { stroke.releasedAt = now }
        strokes.append(stroke); current = nil
    }
    public mutating func cancelCurrent() { current = nil }
    public mutating func clear() { strokes.removeAll(); current = nil }
    public mutating func undo() { if !strokes.isEmpty { strokes.removeLast() }; current = nil }
    public mutating func prune(at now: TimeInterval) { strokes.removeAll { $0.tool == .laser && $0.opacity(at: now) <= 0 } }
    private func valid(_ sample: ScreenSample) -> Bool {
        sample.point.x.isFinite && sample.point.y.isFinite && sample.pressure.isFinite && (0...1).contains(sample.pressure)
    }
    private mutating func erase(at point: CGPoint, radius: Double) {
        func segmentDistance(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> Double {
            let dx = b.x-a.x, dy = b.y-a.y, denom = dx*dx+dy*dy
            let t = denom == 0 ? 0 : max(0,min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/denom))
            return hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)
        }
        strokes.removeAll { stroke in
            let points = stroke.samples.map(\.point), threshold = radius + stroke.width/2
            if points.count == 1 { return hypot(point.x-points[0].x,point.y-points[0].y) <= threshold }
            return zip(points,points.dropFirst()).contains { segmentDistance(point,$0.0,$0.1) <= threshold }
        }
    }
}


