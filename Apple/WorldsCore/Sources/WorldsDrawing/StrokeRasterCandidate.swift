import Foundation
import CoreGraphics

public enum StrokeRasterError: Error { case unsupportedConfiguration, invalidColor }

/// Isolated experimental rasterizer. Coordinates are caller-provided local
/// coordinates and compositing outside this stroke belongs to the caller.
public enum StrokeRasterCandidate {
    public static func draw(samples: [ToolSample], brush: ToolBrush, seed: Int32, color: CGColor, in context: CGContext) throws {
        guard ["hard", "ink", "pencil", "highlighter"].contains(brush.kind),
              brush.opacity.isFinite, (0...1).contains(brush.opacity),
              brush.hardness.isFinite, (0...1).contains(brush.hardness),
              brush.tipAssetId == nil else { throw StrokeRasterError.unsupportedConfiguration }
        if brush.kind == "highlighter" {
            guard !brush.pressureSize, brush.taperStart == 0, brush.taperEnd == 0, brush.straightLine != true else { throw StrokeRasterError.unsupportedConfiguration }
        } else if brush.hardness < 0.99 {
            throw StrokeRasterError.unsupportedConfiguration
        }
        let dabs = try StrokeDabEngine.generate(samples: samples, brush: brush, seed: seed)
        guard !samples.isEmpty else { return }
        context.saveGState(); defer { context.restoreGState() }
        context.setAlpha(CGFloat(brush.opacity * (brush.kind == "highlighter" ? brush.flow : 1)))
        context.beginTransparencyLayer(auxiliaryInfo: nil)
        defer { context.endTransparencyLayer() }
        context.setFillColor(color); context.setStrokeColor(color)
        if brush.kind == "highlighter" {
            context.setLineWidth(CGFloat(brush.size)); context.setLineCap(.butt); context.setLineJoin(.round)
            if samples.count == 1 {
                let p = samples[0], radius = brush.size / 2
                context.fill(CGRect(x: p.x-radius, y: p.y-radius, width: brush.size, height: brush.size))
            } else {
                context.beginPath(); context.move(to: CGPoint(x: samples[0].x, y: samples[0].y))
                for sample in samples.dropFirst() { context.addLine(to: CGPoint(x: sample.x, y: sample.y)) }
                context.strokePath()
            }
        } else {
            for dab in dabs {
                context.saveGState()
                context.translateBy(x: CGFloat(floor(dab.x * 256 + 0.5) / 256), y: CGFloat(floor(dab.y * 256 + 0.5) / 256))
                context.rotate(by: CGFloat(dab.angle * .pi / 180))
                context.scaleBy(x: 1, y: CGFloat(dab.roundness))
                context.setAlpha(CGFloat(dab.opacity))
                let radius = dab.size / 2
                context.fillEllipse(in: CGRect(x: -radius, y: -radius, width: dab.size, height: dab.size))
                context.restoreGState()
            }
        }
    }
}
