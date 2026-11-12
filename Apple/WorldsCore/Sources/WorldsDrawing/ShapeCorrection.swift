import Foundation
import WorldsModels

/// Shape correction as the desktop applies it when "Correct hand-drawn shapes"
/// is on (`src/drawing/Stage.tsx`, pointer up of a brush stroke, and
/// `addNode` in `src/drawing/DrawingView.tsx`).
///
/// The desktop saves the stroke first and then commits a second edit labelled
/// "Correct hand-drawn shape" that patches the same node into a shape. Undoing
/// that second edit replays the journal without it, which brings the original
/// stroke back. The functions here build exactly that patch:
///
/// - `x`, `y`, `w`, `h` become the recognized rectangle,
/// - `kind` becomes `"shape"` and `shape` the recognized name,
/// - `originalSamples` holds the stroke samples moved into the new rectangle,
/// - `points` holds the recognized corners relative to the rectangle (omitted
///   when recognition returns none, as for an axis aligned rectangle or an ellipse),
/// - `paint.stroke` and `paint.strokeWidth` take the brush colour and size.
///
/// Every other stroke field is carried over unchanged. The desktop sets
/// `samples: undefined`, which JSON drops, so the stored node keeps its samples.
/// Recognition (`ShapeRecognition`) can return line, rect, ellipse, triangle and
/// right-triangle; the desktop corrects exactly those and nothing else (no arrows).
public enum ShapeCorrection {
    /// The desktop label of the correction edit.
    public static let operationLabel = "Correct hand-drawn shape"
    /// Every shape name `ShapeRecognition` returns.
    public static let correctableShapes: Set<String> = ["line", "rect", "ellipse", "triangle", "right-triangle"]

    /// The desktop recognizes strokes only for the brush tool, never for the
    /// highlighter or the eraser.
    public static func isEligible(_ tool: StrokeTool) -> Bool {
        if case .brush = tool { return true }
        return false
    }

    /// Recognizes the stroke from its samples in drawing (world) coordinates,
    /// the same input the desktop passes to `recognizeShape`.
    public static func recognize(_ samples: [ToolSample]) -> RecognizedDrawingShape? {
        ShapeRecognition.recognize(samples.map { ToolPoint(x: $0.x, y: $0.y) })
    }

    /// The patch fields the desktop writes for `stroke` (a stored stroke node,
    /// samples in node coordinates). The node `id` is not part of the fields.
    public static func patchFields(stroke: [String: JSONValue], recognized: RecognizedDrawingShape) throws -> [String: JSONValue] {
        guard correctableShapes.contains(recognized.shape),
              [recognized.x, recognized.y, recognized.width, recognized.height].allSatisfy(\.isFinite),
              recognized.width > 0, recognized.height > 0,
              recognized.points.allSatisfy({ $0.x.isFinite && $0.y.isFinite }),
              expectedPointCounts(recognized.shape).contains(recognized.points.count),
              case .string(let id)? = stroke["id"], !id.isEmpty,
              case .string("stroke")? = stroke["kind"],
              stroke["erase"] != .bool(true),
              let nodeX = number(stroke["x"]), let nodeY = number(stroke["y"]),
              case .array(let samples)? = stroke["samples"], !samples.isEmpty,
              case .object(let brush)? = stroke["brush"],
              case .string(let color)? = brush["color"], !color.isEmpty,
              let size = brush["size"], let width = number(size), width > 0,
              case .object(var paint)? = stroke["paint"] else { throw DrawingToolError.invalidInput }

        var moved: [JSONValue] = []
        moved.reserveCapacity(samples.count)
        for value in samples {
            guard case .object(var sample) = value, let x = number(sample["x"]), let y = number(sample["y"]) else { throw DrawingToolError.invalidInput }
            // Same evaluation order as `sample.x + n.x - recognized.rect.x` on the desktop.
            sample["x"] = .number(x + nodeX - recognized.x)
            sample["y"] = .number(y + nodeY - recognized.y)
            moved.append(.object(sample))
        }

        var fields = stroke
        fields.removeValue(forKey: "id")
        fields.removeValue(forKey: "samples")
        fields["x"] = .number(recognized.x)
        fields["y"] = .number(recognized.y)
        fields["w"] = .number(recognized.width)
        fields["h"] = .number(recognized.height)
        fields["kind"] = .string("shape")
        fields["shape"] = .string(recognized.shape)
        fields["originalSamples"] = .array(moved)
        if recognized.points.isEmpty {
            fields.removeValue(forKey: "points")
        } else {
            fields["points"] = .array(recognized.points.map { point -> JSONValue in
                JSONValue.object(["x": .number(point.x - recognized.x), "y": .number(point.y - recognized.y)])
            })
        }
        paint["stroke"] = .string(color)
        paint["strokeWidth"] = size
        fields["paint"] = .object(paint)
        return fields
    }

    /// The node as stored after the patch: the stroke with the patch fields merged in.
    public static func correctedNode(stroke: [String: JSONValue], recognized: RecognizedDrawingShape) throws -> [String: JSONValue] {
        var node = stroke
        for (key, value) in try patchFields(stroke: stroke, recognized: recognized) { node[key] = value }
        return node
    }

    /// The single `patch` change of the correction edit.
    public static func patchChange(stroke: [String: JSONValue], recognized: RecognizedDrawingShape) throws -> JSONValue {
        guard case .string(let id)? = stroke["id"] else { throw DrawingToolError.invalidInput }
        return .object(["type": .string("patch"), "collection": .string("nodes"), "id": .string(id),
                        "fields": .object(try patchFields(stroke: stroke, recognized: recognized))])
    }

    /// The correction edit, based on `revision` (the revision right after the stroke was saved).
    public static func operation(stroke: [String: JSONValue], recognized: RecognizedDrawingShape, operationID: String,
                                 actor: String, revision: Int64, timestamp: Int64) throws -> JSONValue {
        guard !operationID.isEmpty, !actor.isEmpty, revision >= 1 else { throw DrawingToolError.invalidInput }
        return .object(["id": .string(operationID), "actor": .string(actor), "base": .integer(revision),
                        "at": .integer(timestamp), "label": .string(operationLabel), "type": .string("edit"),
                        "changes": .array([try patchChange(stroke: stroke, recognized: recognized)])])
    }

    private static func expectedPointCounts(_ shape: String) -> Set<Int> {
        switch shape {
        case "line": return [2]
        case "triangle", "right-triangle": return [3]
        case "rect": return [0, 4]
        default: return [0]
        }
    }
    private static func number(_ value: JSONValue?) -> Double? {
        switch value {
        case .integer(let v)?: return Double(v)
        case .number(let v)? where v.isFinite: return v
        default: return nil
        }
    }
}
