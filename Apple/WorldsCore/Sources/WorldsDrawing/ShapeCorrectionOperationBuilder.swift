import Foundation
import WorldsModels

/// Builds the desktop's follow-up correction edit for a stroke already committed
/// at `revision - 1` (see `ShapeCorrection`). The caller performs the stroke and
/// then this patch, in that order, exactly as the desktop does. The two edits
/// are separate operations, so undoing the correction brings the stroke back.
public enum ShapeCorrectionOperationBuilder {
    public static func make(strokeOperation: Data, recognized: RecognizedDrawingShape,
                            operationID: String, actor: String, revision: Int64,
                            timestamp: Int64) throws -> Data {
        guard case .object(let operation) = try JSONDecoder().decode(JSONValue.self, from: strokeOperation),
              case .string(let author)? = operation["actor"], author == actor,
              case .integer(let base)? = operation["base"], base == revision - 1,
              case .array(let changes)? = operation["changes"],
              case .object(let change)? = changes.first,
              case .string("put")? = change["type"], case .string("nodes")? = change["collection"],
              case .string(let id)? = change["id"], !id.isEmpty,
              case .object(let node)? = change["value"],
              case .string(let nodeID)? = node["id"], nodeID == id else { throw DrawingToolError.invalidInput }
        let correction = try ShapeCorrection.operation(stroke: node, recognized: recognized, operationID: operationID,
                                                       actor: actor, revision: revision, timestamp: timestamp)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(correction)
    }
}
