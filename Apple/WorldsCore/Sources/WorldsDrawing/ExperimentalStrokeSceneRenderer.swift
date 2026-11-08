import Foundation
import CoreGraphics

/// A deliberately restricted experiment. It is not a complete Worlds renderer
/// or an authoritative export. A thrown error invalidates the entire output.
public enum ExperimentalStrokeSceneError: Error { case unsupportedScene }

public enum ExperimentalStrokeSceneRenderer {
    private struct Frame: Decodable { let x, y, w, h: Double; let background: String; let clip: Bool }
    private struct Layer: Decodable { let visible: Bool; let opacity: Double; let blend: String; let parentId: String? }
    private struct Point: Decodable { let x, y: Double }
    private struct Paint: Decodable { let fill, stroke, cap: String; let strokeWidth: Double; let dash: [Double] }
    private struct Node: Decodable {
        let shape: String?
        let points: [Point]?
        let paint: Paint
        let kind, layerId: String
        let frameId, groupId: String?
        let visible: Bool
        let x, y, w, h, rotation, opacity: Double
        let flipX, flipY, erase, alphaLock: Bool
        let effects: [EmptyEffect]
        let brush: ToolBrush
        let samples: [ToolSample]
        let seed: Int32
    }
    private struct EmptyEffect: Decodable {}
    private struct Scene: Decodable {
        let schema: Int
        let frames: [String: Frame], layers: [String: Layer], nodes: [String: Node]
        let layerOrder, nodeOrder: [String]
    }

    public static func render(scene: DrawingScene, frameID: String, in context: CGContext, allowCorrectedRightTriangles: Bool = false) throws {
        let data = try scene.json()
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let masks = root["masks"] as? [String: Any], masks.isEmpty,
              let assets = root["assets"] as? [String: Any], assets.isEmpty,
              let nodes = root["nodes"] as? [String: [String: Any]] else { throw ExperimentalStrokeSceneError.unsupportedScene }
        let allowedNodeKeys: Set<String> = ["id", "kind", "name", "layerId", "frameId", "groupId", "visible", "locked", "rotation", "opacity", "flipX", "flipY", "paint", "textStyle", "effects", "x", "y", "w", "h", "samples", "brush", "erase", "seed", "alphaLock", "shape", "points", "originalSamples"]
        guard nodes.values.allSatisfy({ Set($0.keys).isSubset(of: allowedNodeKeys) }) else { throw ExperimentalStrokeSceneError.unsupportedScene }
        for node in nodes.values where node["kind"] as? String == "shape" {
            guard let paint = node["paint"] as? [String: Any],
                  Set(paint.keys).isSubset(of: ["fill", "stroke", "strokeWidth", "dash", "cap", "radius"]) else { throw ExperimentalStrokeSceneError.unsupportedScene }
        }
        let decoded = try JSONDecoder().decode(Scene.self, from: data)
        guard decoded.schema == 1, let frame = decoded.frames[frameID], frame.clip,
              [frame.x, frame.y, frame.w, frame.h].allSatisfy(\.isFinite), frame.w > 0, frame.h > 0,
              frame.w <= 16384, frame.h <= 16384, frame.w * frame.h <= 64 * 1024 * 1024,
              Set(decoded.layerOrder).count == decoded.layers.count, Set(decoded.nodeOrder).count == decoded.nodes.count,
              Set(decoded.layerOrder) == Set(decoded.layers.keys), Set(decoded.nodeOrder) == Set(decoded.nodes.keys) else { throw ExperimentalStrokeSceneError.unsupportedScene }
        let background = try color(frame.background)
        for layer in decoded.layers.values {
            guard layer.parentId == nil, layer.blend == "source-over", layer.opacity.isFinite, (0...1).contains(layer.opacity) else { throw ExperimentalStrokeSceneError.unsupportedScene }
        }
        for node in decoded.nodes.values {
            guard (node.kind == "stroke" || (allowCorrectedRightTriangles && node.kind == "shape" && node.shape == "right-triangle")), decoded.layers[node.layerId] != nil, node.frameId == frameID,
                  node.groupId == nil, !node.erase, !node.alphaLock, node.effects.isEmpty,
                  [node.x, node.y, node.w, node.h, node.rotation, node.opacity].allSatisfy(\.isFinite),
                  node.w > 0, node.h > 0, (0...1).contains(node.opacity) else { throw ExperimentalStrokeSceneError.unsupportedScene }
            if node.kind == "stroke" { _ = try color(node.brush.color) }
            else {
                guard let points = node.points, points.count == 3, points.allSatisfy({ $0.x.isFinite && $0.y.isFinite }),
                      node.paint.fill == "transparent", node.paint.dash.isEmpty, node.paint.cap == "round",
                      node.paint.strokeWidth.isFinite, node.paint.strokeWidth > 0, node.paint.strokeWidth <= 2048 else { throw ExperimentalStrokeSceneError.unsupportedScene }
                _ = try color(node.paint.stroke)
            }
        }
        context.saveGState(); defer { context.restoreGState() }
        context.clip(to: CGRect(x: 0, y: 0, width: frame.w, height: frame.h))
        context.setFillColor(background); context.fill(CGRect(x: 0, y: 0, width: frame.w, height: frame.h))
        context.translateBy(x: -frame.x, y: -frame.y)
        for layerID in decoded.layerOrder {
            guard let layer = decoded.layers[layerID], layer.visible else { continue }
            context.saveGState(); context.setAlpha(layer.opacity); context.beginTransparencyLayer(auxiliaryInfo: nil)
            for nodeID in decoded.nodeOrder {
                guard let node = decoded.nodes[nodeID], node.layerId == layerID, node.visible else { continue }
                context.saveGState()
                if node.kind == "shape" {
                    // A Core Graphics path uses the opposite vertical bitmap
                    // orientation from the source Canvas image. Correct in frame
                    // coordinates before applying this node's own transform.
                    context.translateBy(x: 0, y: frame.y * 2 + frame.h)
                    context.scaleBy(x: 1, y: -1)
                }
                context.translateBy(x: node.x + node.w / 2, y: node.y + node.h / 2)
                context.rotate(by: node.rotation * .pi / 180)
                context.scaleBy(x: node.flipX ? -1 : 1, y: node.flipY ? -1 : 1)
                context.translateBy(x: -node.w / 2, y: -node.h / 2)
                context.setAlpha(node.opacity)
                do {
                    if node.kind == "stroke" {
                        try StrokeRasterCandidate.draw(samples: node.samples, brush: node.brush, seed: node.seed, color: color(node.brush.color), in: context)
                    } else if let points = node.points {
                        context.setStrokeColor(try color(node.paint.stroke)); context.setLineWidth(node.paint.strokeWidth)
                        context.setLineJoin(.round); context.setLineCap(.round); context.beginPath()
                        context.move(to: CGPoint(x: points[0].x, y: points[0].y))
                        context.addLine(to: CGPoint(x: points[1].x, y: points[1].y))
                        context.addLine(to: CGPoint(x: points[2].x, y: points[2].y))
                        context.closePath(); context.strokePath()
                    }
                }
                catch { context.restoreGState(); context.endTransparencyLayer(); context.restoreGState(); throw error }
                context.restoreGState()
            }
            context.endTransparencyLayer(); context.restoreGState()
        }
    }
    private static func color(_ value: String) throws -> CGColor {
        if value == "transparent" { return CGColor(red: 0, green: 0, blue: 0, alpha: 0) }
        guard value.count == 7, value.first == "#", let rgb = UInt32(value.dropFirst(), radix: 16),
              let space = CGColorSpace(name: CGColorSpace.sRGB),
              let result = CGColor(colorSpace: space, components: [CGFloat((rgb >> 16) & 255) / 255, CGFloat((rgb >> 8) & 255) / 255, CGFloat(rgb & 255) / 255, 1]) else { throw ExperimentalStrokeSceneError.unsupportedScene }
        return result
    }
}
