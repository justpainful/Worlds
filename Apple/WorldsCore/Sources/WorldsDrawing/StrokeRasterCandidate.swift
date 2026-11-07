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
        if brush.kind != "highlighter" {
            try drawCanonicalTile(dabs, opacity: brush.opacity, color: color, in: context)
            return
        }
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
        }
    }

    /// Source renderer paints pigment at one pixel per source unit before
    /// scaling the tile. This candidate accepts only strokes fully contained
    /// in one tile, so it does not pretend to implement tile seam handling.
    private static func drawCanonicalTile(_ dabs: [StrokeDab], opacity: Double, color: CGColor, in target: CGContext) throws {
        guard !dabs.isEmpty else { return }
        var left = Double.infinity, top = Double.infinity, right = -Double.infinity, bottom = -Double.infinity
        for dab in dabs {
            guard [dab.x, dab.y, dab.size, dab.opacity, dab.angle, dab.roundness].allSatisfy(\.isFinite),
                  abs(dab.x) < 100_000_000, abs(dab.y) < 100_000_000 else { throw StrokeRasterError.unsupportedConfiguration }
            let r = dab.size / 2 + 2
            left = min(left, dab.x-r); right = max(right, dab.x+r)
            top = min(top, dab.y-r); bottom = max(bottom, dab.y+r)
        }
        let tileX = floor(left / 512), tileY = floor(top / 512)
        guard floor(right / 512) == tileX, floor(bottom / 512) == tileY,
              let space = CGColorSpace(name: CGColorSpace.sRGB),
              let tile = CGContext(data: nil, width: 512, height: 512, bitsPerComponent: 8, bytesPerRow: 512 * 4,
                                   space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { throw StrokeRasterError.unsupportedConfiguration }
        tile.translateBy(x: CGFloat(-tileX * 512), y: CGFloat(512 + tileY * 512))
        tile.scaleBy(x: 1, y: -1)
        tile.setFillColor(color)
        for dab in dabs {
            tile.saveGState()
            tile.translateBy(x: CGFloat(floor(dab.x * 256 + 0.5) / 256), y: CGFloat(floor(dab.y * 256 + 0.5) / 256))
            tile.rotate(by: CGFloat(dab.angle * .pi / 180))
            tile.scaleBy(x: 1, y: CGFloat(dab.roundness))
            tile.setAlpha(CGFloat(dab.opacity))
            let radius = dab.size / 2
            tile.fillEllipse(in: CGRect(x: -radius, y: -radius, width: dab.size, height: dab.size))
            tile.restoreGState()
        }
        guard let image = tile.makeImage() else { throw StrokeRasterError.unsupportedConfiguration }
        target.saveGState(); defer { target.restoreGState() }
        target.setAlpha(CGFloat(opacity))
        target.interpolationQuality = .low
        target.translateBy(x: CGFloat(tileX * 512), y: CGFloat(tileY * 512 + 512))
        target.scaleBy(x: 1, y: -1)
        target.draw(image, in: CGRect(x: 0, y: 0, width: 512, height: 512))
    }
}
