import Foundation

/// Experimental source-shaped follow-up patch for a stroke already committed
/// at `revision`. The caller must perform the stroke and patch in that order.
/// It does not provide atomicity across the two operations.
public enum ShapeCorrectionOperationBuilder {
    public static func make(strokeOperation: Data, recognized: RecognizedDrawingShape,
                            operationID: String, actor: String, revision: Int64,
                            timestamp: Int64) throws -> Data {
        guard recognized.shape == "right-triangle", recognized.points.count == 3,
              !operationID.isEmpty, !actor.isEmpty, revision >= 1,
              [recognized.x, recognized.y, recognized.width, recognized.height].allSatisfy(\.isFinite),
              recognized.width > 0, recognized.height > 0,
              recognized.points.allSatisfy({ $0.x.isFinite && $0.y.isFinite }),
              let operation = try JSONSerialization.jsonObject(with: strokeOperation) as? [String: Any],
              operation["actor"] as? String == actor,
              let base = operation["base"] as? Int64, base == revision - 1,
              let changes = operation["changes"] as? [[String: Any]],
              let change = changes.first, change["type"] as? String == "put",
              change["collection"] as? String == "nodes",
              let id = change["id"] as? String, !id.isEmpty,
              var node = change["value"] as? [String: Any],
              node["id"] as? String == id, node["kind"] as? String == "stroke",
              let originalSamples = node["samples"] as? [[String: Any]], !originalSamples.isEmpty,
              let brush = node["brush"] as? [String: Any],
              let color = brush["color"] as? String,
              let size = brush["size"] as? Double,
              var paint = node["paint"] as? [String: Any] else { throw DrawingToolError.invalidInput }
        node.removeValue(forKey: "id")
        // JS omits `samples: undefined` from the patch JSON; existing samples
        // remain in the stored node. originalSamples keeps the original local samples.
        node.removeValue(forKey: "samples")
        node["kind"] = "shape"; node["shape"] = recognized.shape
        node["x"] = recognized.x; node["y"] = recognized.y
        node["w"] = recognized.width; node["h"] = recognized.height
        node["points"] = recognized.points.map { ["x": $0.x - recognized.x, "y": $0.y - recognized.y] }
        node["originalSamples"] = originalSamples
        paint["stroke"] = color; paint["strokeWidth"] = size; node["paint"] = paint
        let patch: [String: Any] = ["type": "patch", "collection": "nodes", "id": id, "fields": node]
        return try JSONSerialization.data(withJSONObject: ["id": operationID, "actor": actor, "base": revision,
            "at": timestamp, "label": "Correct hand-drawn shape", "type": "edit", "changes": [patch]], options: [.sortedKeys])
    }
}
